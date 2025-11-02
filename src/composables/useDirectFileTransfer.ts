import type { WebrtcProvider } from 'y-webrtc'
import { useWebrtcConnection, type FileTransferOffer } from './useWebrtcConnection'
import { useFileTransferProgress } from './useFileTransferProgress'
import { getCachedFile, cacheFile } from './useStorageFileCache'
import type { FileMeta } from '@/types/types'
import {
  useGlobalDataChannelQueue,
  createFileTransferJob,
  DataChannelPriority
} from './useGlobalDataChannelQueue'
import { useFileTransferState } from './useFileTransferState'
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/util/base64'

const CHUNK_SIZE = 64 * 1024 // 64KB
const MAX_BUFFER_SIZE = 8 * 1024 * 1024 // 8MB (안전한 임계값)

type ChunkMessage = {
  type: 'chunk'
  index: number
  total: number
}

type CompleteMessage = {
  type: 'complete'
}

type ErrorMessage = {
  type: 'error'
  message: string
}

type TransferMessage = ChunkMessage | CompleteMessage | ErrorMessage

/**
 * 직접 P2P로 파일 전송
 */
export function useDirectFileTransfer(
  provider: WebrtcProvider,
  myUuid: string,
  files: Map<string, FileMeta>,
) {
  const {
    createOffer,
    createAnswer,
    cleanup,
    cancelTransfer,
    getConnectionId,
    activeChannels,
  } = useWebrtcConnection(provider, myUuid)

  const { startTransfer, updateProgress, completeTransfer, cancelTransfer: cancelProgress } =
    useFileTransferProgress()

  const { enqueue, registerDataChannel, unregisterDataChannel } = useGlobalDataChannelQueue()

  /**
   * 데이터 채널 생성 시 큐 매니저에 등록
   */
  activeChannels.value.forEach((channel, connectionId) => {
    const peerId = connectionId.split('-')[1] // "fileId-peerId" 형식
    if (peerId) {
      registerDataChannel(peerId, channel)
    }
  })

  /**
   * 파일 전송 (큐를 통한 전송 - 권장)
   */
  async function sendFileViaQueue(
    fileId: string,
    targetUuid: string,
  ): Promise<void> {
    // 캐시에서 파일 정보 로드
    const cachedBlob = await getCachedFile(fileId)
    if (!cachedBlob) {
      throw new Error('파일을 찾을 수 없습니다')
    }

    const meta = files.get(fileId)
    const fileData = await cachedBlob.arrayBuffer()

    // 파일 크기에 따라 우선순위 결정
    let priority = DataChannelPriority.NORMAL
    if (cachedBlob.size < 100 * 1024) {
      priority = DataChannelPriority.HIGH // 100KB 미만: 높음
    } else if (cachedBlob.size > 10 * 1024 * 1024) {
      priority = DataChannelPriority.LOW // 10MB 초과: 낮음
    }

    // 전송 작업 생성
    const job = createFileTransferJob(
      fileId,
      meta?.name || fileId,
      targetUuid,
      fileData.byteLength,
      priority,
      async (onProgress, checkCancelled) => {
        // 실제 전송 로직
        await sendFileDirectInternal(
          fileId,
          targetUuid,
          fileData,
          onProgress,
          checkCancelled
        )
      }
    )

    // 큐에 등록
    enqueue(job)
  }

  /**
   * 내부 전송 함수 (큐 매니저가 호출)
   */
  async function sendFileDirectInternal(
    fileId: string,
    targetUuid: string,
    fileData: ArrayBuffer,
    onProgress?: (sent: number, total: number) => void,
    checkCancelled?: () => boolean
  ): Promise<void> {
    const connectionId = getConnectionId(fileId, targetUuid)
    const transferKey = `${fileId}-${targetUuid}`

    try {
      const totalChunks = Math.ceil(fileData.byteLength / CHUNK_SIZE)

      console.log(`[#15] P2P 전송 시작 (큐 관리): ${totalChunks}개 청크, ${(fileData.byteLength / 1024).toFixed(0)}KB`)

      // 진행 상태 초기화
      const meta = files.get(fileId)
      startTransfer(transferKey, meta?.name || fileId, 'upload', totalChunks, fileData.byteLength, false)

      // Offer 생성 및 연결
      const channel = await createOffer(fileId, targetUuid, totalChunks, fileData.byteLength)

      // 채널 열릴 때까지 대기
      if (channel.readyState !== 'open') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('채널 열림 타임아웃')), 10000)
          channel.onopen = () => {
            clearTimeout(timeout)
            resolve()
          }
          channel.onerror = () => {
            clearTimeout(timeout)
            reject(new Error('채널 에러'))
          }
        })
      }

      // 청크 전송
      const startTime = Date.now()
      for (let i = 0; i < totalChunks; i++) {
        // 취소 확인
        if (checkCancelled && checkCancelled()) {
          throw new Error('전송 취소됨')
        }

        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, fileData.byteLength)
        const chunk = fileData.slice(start, end)

        // 청크 메타데이터 생성
        const chunkMeta: ChunkMessage = {
          type: 'chunk',
          index: i,
          total: totalChunks,
        }
        const metaStr = JSON.stringify(chunkMeta)
        const metaSize = new Blob([metaStr]).size

        // 버퍼 대기 (큐 매니저가 관리)
        const requiredSpace = metaSize + chunk.byteLength
        while (channel.bufferedAmount + requiredSpace > MAX_BUFFER_SIZE) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          if (Date.now() - startTime > 60000) {
            throw new Error('버퍼 대기 타임아웃')
          }
        }

        // 메타데이터 + 데이터 전송
        channel.send(metaStr)
        await new Promise((resolve) => setTimeout(resolve, 0))
        channel.send(chunk)

        updateProgress(transferKey, i + 1)

        // 진행 상황 콜백
        if (onProgress) {
          onProgress(end, fileData.byteLength)
        }

        if (i % 20 === 0 || i === totalChunks - 1) {
          console.log(`[#16] P2P 전송: ${i + 1}/${totalChunks} (${(((i + 1) / totalChunks) * 100).toFixed(0)}%)`)
        }
      }

      // 완료 메시지 전송
      while (channel.bufferedAmount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const completeMsg: CompleteMessage = { type: 'complete' }
      channel.send(JSON.stringify(completeMsg))

      console.log(`[#17] P2P 전송 완료`)
      completeTransfer(transferKey)

      // 채널 정리
      await new Promise<void>((resolve) => {
        if (channel.readyState === 'closed') {
          resolve()
          return
        }

        const closeHandler = () => {
          channel.removeEventListener('close', closeHandler)
          resolve()
        }

        channel.addEventListener('close', closeHandler)
        setTimeout(() => {
          channel.removeEventListener('close', closeHandler)
          resolve()
        }, 5000)
      })

      unregisterDataChannel(targetUuid)
      cleanup(connectionId)
    } catch (error) {
      console.error(`[P2P] 전송 실패:`, error)
      cancelProgress(transferKey)
      unregisterDataChannel(targetUuid)
      cancelTransfer(fileId, targetUuid, error instanceof Error ? error.message : '알 수 없는 오류')
      throw error
    }
  }

  /**
   * 파일 수신 (수신자)
   */
  async function receiveFileDirect(offer: FileTransferOffer): Promise<Blob> {
    const connectionId = getConnectionId(offer.fileId, offer.senderUuid)
    const transferKey = offer.fileId // 수신자는 fileId만 사용

    try {
      console.log(`[#18] P2P 수신 시작: ${offer.totalChunks}개 청크, ${(offer.fileSize / 1024).toFixed(0)}KB`)

      // 이어받기: 기존 다운로드 상태 확인
      const { loadDownloadState, saveDownloadState, deleteDownloadState, addChunk, isComplete: isDownloadComplete } =
        useFileTransferState()

      let partialState = await loadDownloadState(offer.fileId)

      // 진행 상태 초기화
      const meta = files.get(offer.fileId)

      if (partialState) {
        console.log(`[#18-1] 이어받기: ${partialState.receivedChunks.size}/${offer.totalChunks} 청크 보유`)
        startTransfer(transferKey, meta?.name || offer.fileId, 'download', offer.totalChunks, offer.fileSize, true)
        updateProgress(transferKey, partialState.receivedChunks.size)
      } else {
        startTransfer(transferKey, meta?.name || offer.fileId, 'download', offer.totalChunks, offer.fileSize)

        // 새로운 다운로드 상태 생성
        partialState = {
          fileId: offer.fileId,
          fileName: meta?.name || offer.fileId,
          totalChunks: offer.totalChunks,
          chunkSize: CHUNK_SIZE,
          totalBytes: offer.fileSize,
          receivedChunks: new Set(),
          chunks: new Map(),
          timestamp: Date.now(),
          transferKey: `direct-${offer.fileId}-${Date.now()}`,
        }
      }

      // Answer 생성 및 연결
      const channel = await createAnswer(offer)

      // 채널 열릴 때까지 대기
      if (channel.readyState !== 'open') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('채널 열림 타임아웃')), 10000)
          channel.onopen = () => {
            clearTimeout(timeout)
            resolve()
          }
          channel.onerror = () => {
            clearTimeout(timeout)
            reject(new Error('채널 에러'))
          }
        })
      }

      // 청크 수신
      return new Promise<Blob>(async (resolve, reject) => {
        const chunks = new Array<ArrayBuffer | null>(offer.totalChunks)
        let currentIndex = -1
        const timeout = setTimeout(async () => {
          // 타임아웃 시 진행 상태 저장
          await saveDownloadState(partialState!)
          reject(new Error('수신 타임아웃'))
        }, 60000)

        // 기존에 받은 청크 복원
        if (partialState) {
          for (const [index, base64Chunk] of partialState.chunks.entries()) {
            const buffer = base64ToArrayBuffer(base64Chunk)
            chunks[index] = buffer
          }
        }

        channel.onmessage = async (event) => {
          if (typeof event.data === 'string') {
            // 메타데이터 메시지
            const msg: TransferMessage = JSON.parse(event.data)

            if (msg.type === 'chunk') {
              currentIndex = msg.index
            } else if (msg.type === 'complete') {
              clearTimeout(timeout)

              // 모든 청크가 도착했는지 확인
              if (!isDownloadComplete(partialState!)) {
                await saveDownloadState(partialState!)
                reject(new Error(`청크 누락: ${partialState!.receivedChunks.size}/${offer.totalChunks}`))
                return
              }

              // Blob 생성
              const validChunks = chunks.filter((c): c is ArrayBuffer => c !== null)
              const blob = new Blob(validChunks, { type: meta?.type || 'application/octet-stream' })
              console.log(`[#19] P2P 수신 완료: ${(blob.size / 1024).toFixed(0)}KB`)

              // 캐시 저장 및 상태 삭제
              try {
                await cacheFile(offer.fileId, blob)
                await deleteDownloadState(offer.fileId)
                completeTransfer(transferKey)
                channel.close()
                setTimeout(() => cleanup(connectionId), 1000)
                resolve(blob)
              } catch (error) {
                reject(error)
              }
            } else if (msg.type === 'error') {
              clearTimeout(timeout)
              await saveDownloadState(partialState!)
              channel.close()
              cleanup(connectionId)
              reject(new Error(msg.message))
            }
          } else {
            // ArrayBuffer (청크 데이터)
            if (currentIndex >= 0 && currentIndex < offer.totalChunks) {
              // 이미 받은 청크는 건너뛰기
              if (partialState!.receivedChunks.has(currentIndex)) {
                return
              }

              chunks[currentIndex] = event.data

              // 청크를 base64로 저장 (이어받기용)
              const base64Chunk = arrayBufferToBase64(event.data as ArrayBuffer)
              addChunk(partialState!, currentIndex, base64Chunk)

              updateProgress(transferKey, partialState!.receivedChunks.size)

              // 주기적으로 상태 저장
              if (partialState!.receivedChunks.size % 10 === 0) {
                await saveDownloadState(partialState!)
              }

              if (partialState!.receivedChunks.size % 20 === 0 || isDownloadComplete(partialState!)) {
                console.log(`[#20] P2P 수신: ${partialState!.receivedChunks.size}/${offer.totalChunks} (${((partialState!.receivedChunks.size / offer.totalChunks) * 100).toFixed(0)}%)`)
              }
            } else {
              console.warn(`[DirectTransfer] 잘못된 청크 인덱스: ${currentIndex}`)
            }
          }
        }

        channel.onerror = async (error) => {
          clearTimeout(timeout)
          await saveDownloadState(partialState!)
          cleanup(connectionId)
          reject(error)
        }

        channel.onclose = async () => {
          if (!isDownloadComplete(partialState!)) {
            clearTimeout(timeout)
            await saveDownloadState(partialState!)
            cleanup(connectionId)
            reject(new Error('채널이 완료 전에 닫혔습니다'))
          }
        }
      })
    } catch (error) {
      console.error(`[P2P] 수신 실패:`, error)
      cancelProgress(transferKey)
      cleanup(connectionId)
      throw error
    }
  }

  return {
    sendFileViaQueue,        // 큐 기반 전송
    receiveFileDirect,
  }
}
