import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'
import { CID } from 'multiformats/cid'
import type { Helia } from '@helia/interface'
import { cacheFile, getCachedFile } from './useLocalFileCache'

let heliaInstance: Helia | null = null
let initializingPromise: Promise<Helia> | null = null

export async function getHelia() {
  // 이미 초기화 완료된 인스턴스가 있으면 반환
  if (heliaInstance) {
    return heliaInstance
  }

  // 초기화 중이면 같은 Promise 반환 (중복 초기화 방지)
  if (initializingPromise) {
    return initializingPromise
  }

  // 새로 초기화
  initializingPromise = (async () => {
    console.log('[IPFS] Helia 초기화 시작...')

    const helia = await createHelia({
      libp2p: {
        connectionManager: {
          // 최대 연결 수 제한
          maxConnections: 50,
        },
      },
      // Delegated Routing 비활성화 (404 에러 방지)
      routers: [],
    })

    heliaInstance = helia

    // 연결 이벤트 로깅
    helia.libp2p.addEventListener('peer:connect', (evt) => {
      console.debug(`[IPFS] 피어 연결됨:`, evt.detail.toString())
    })

    helia.libp2p.addEventListener('peer:disconnect', (evt) => {
      console.debug(`[IPFS] 피어 연결 해제됨:`, evt.detail.toString())
    })

    console.log('[IPFS] Helia 초기화 완료, Peer ID:', helia.libp2p.peerId.toString())

    return helia
  })()

  const helia = await initializingPromise
  initializingPromise = null
  return helia
}

export function useIpfs() {
  async function addFile(file: File) {
    const helia = await getHelia()
    const fs = unixfs(helia)

    console.log(`[IPFS] 파일 업로드 시작: ${file.name} (${file.size} bytes)`)

    // addBytes()를 사용 - 순수 파일 CID 반환 (디렉토리 구조 없이)
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    const cid = await fs.addBytes(uint8Array)

    const cidString = cid.toString()

    // 원본 파일을 로컬 캐시에도 저장 (빠른 재접근용)
    const blob = new Blob([arrayBuffer], { type: file.type })
    await cacheFile(cidString, blob)

    console.log(`[IPFS] ✅ 파일 업로드 완료: ${cidString}`)
    console.log(`[IPFS] 파일 크기: ${(file.size / 1024 / 1024).toFixed(2)}MB`)
    console.log(`[IPFS] 연결된 피어: ${helia.libp2p.getPeers().length}개`)

    return { cid: cidString, name: file.name, size: file.size, type: file.type }
  }

  async function getFile(cid: string) {
    // 1순위: 로컬 캐시 확인 (가장 빠름)
    const cachedBlob = await getCachedFile(cid)
    if (cachedBlob) {
      console.log(`[IPFS] ⚡ 로컬 캐시에서 즉시 로드: ${cid}`)
      return cachedBlob
    }

    const helia = await getHelia()
    const fs = unixfs(helia)

    const cidObj = CID.parse(cid)

    // 2순위: Helia Blockstore에서 검색 (로컬 + 연결된 피어)
    console.log(`[IPFS] 파일 다운로드 시도: ${cid}`)
    console.log(`[IPFS] 연결된 피어 수: ${helia.libp2p.getPeers().length}`)

    try {
      // fs.cat()으로 시도 (로컬 우선, 그 다음 연결된 피어에서 검색)
      const stream = fs.cat(cidObj, {
        // 타임아웃 설정 (10초로 단축)
        signal: AbortSignal.timeout(10000),
      })

      const chunks: Uint8Array[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      if (chunks.length === 0) {
        throw new Error('파일이 비어있습니다')
      }

      const buffers = chunks.map((chunk) => new Uint8Array(chunk).buffer)
      const totalSize = buffers.reduce((sum, buf) => sum + buf.byteLength, 0)
      const blob = new Blob(buffers)

      // 캐시에 저장
      await cacheFile(cid, blob)

      console.log(
        `[IPFS] ✅ 다운로드 완료: ${cid} (${(totalSize / 1024 / 1024).toFixed(2)}MB, ${chunks.length} 청크)`,
      )
      return blob
    } catch (error) {
      console.warn(`[IPFS] ⚠️ fs.cat 실패:`, error)

      // NotAFileError면 디렉토리일 수 있음 (기존 addFile로 업로드된 파일)
      console.log('[IPFS] 디렉토리 구조 확인 중...', cid)

      try {
        for await (const entry of fs.ls(cidObj)) {
          if (entry.type === 'file') {
            // 디렉토리 내부의 첫 번째 파일 다운로드
            console.log('[IPFS] 디렉토리 내부 파일 발견:', entry.name, entry.cid.toString())

            const fileStream = fs.cat(entry.cid, {
              signal: AbortSignal.timeout(10000),
            })
            const chunks: Uint8Array[] = []
            for await (const chunk of fileStream) chunks.push(chunk)

            const buffers = chunks.map((chunk) => new Uint8Array(chunk).buffer)
            const blob = new Blob(buffers)

            // 캐시에 저장 (원본 CID로)
            await cacheFile(cid, blob)

            console.log(`[IPFS] ✅ 디렉토리 내부 파일 다운로드 완료: ${entry.cid}`)
            return blob
          }
        }

        throw new Error('디렉토리 내부에 파일을 찾을 수 없습니다')
      } catch (lsError) {
        console.error('[IPFS] ❌ 디렉토리 읽기 실패:', lsError)

        const connectedPeers = helia.libp2p.getPeers().length
        throw new Error(
          `파일을 찾을 수 없습니다 (${cid.slice(0, 20)}...)\n\n` +
            `연결된 피어: ${connectedPeers}개\n` +
            `파일을 업로드한 사용자가 오프라인이거나\n` +
            `같은 채팅방에 접속해 있지 않습니다.\n\n` +
            `해결방법:\n` +
            `1. 파일을 업로드한 사용자에게 온라인 요청\n` +
            `2. Super Peer 설정으로 영구 저장\n` +
            `3. 나중에 "다시 시도" 버튼 클릭`,
        )
      }
    }
  }

  return { addFile, getFile }
}
