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

const { saveChunksBatch } = useFileTransferState()

const CHUNK_SIZE = 128 * 1024 // 128KB
const MAX_BUFFER_SIZE = 8 * 1024 * 1024 // 8MB
const FLOW_CONTROL_WINDOW = 50 // 50개 청크마다 ACK 대기 (12.8MB) - 더 빈번하게
const DB_SAVE_CHUNK_INTERVAL = 200 // 200개 청크마다 DB 저장 (50MB)
const ACK_TIMEOUT = 5000 // ACK 타임아웃 5초
const MAX_ACK_RETRIES = 3 // ACK 재전송 최대 횟수
const RESUME_ACK_TIMEOUT = 2000 // Resume ACK 타임아웃

type StartMessage = {
  type: 'start'
  totalChunks: number
  fileSize: number
}

type CompleteMessage = {
  type: 'complete'
}

type ErrorMessage = {
  type: 'error'
  message: string
}

type AckMessage = {
  type: 'ack'
  upToIndex: number // 이 인덱스까지 수신 완료
  receivedCount: number // 실제 받은 청크 수
}

type ResumeMessage = {
  type: 'resume'
  receivedChunks: number[]
}

type ResumeAckMessage = {
  type: 'resume_ack'
  acknowledged: boolean
}

type ChunkMessage = {
  type: 'chunk'
  index: number
  data: ArrayBuffer
  checksum: number // 간단한 체크섬
}

type AckRetryMessage = {
  type: 'ack_retry'
  sentUpTo: number
}

type TransferMessage = StartMessage | CompleteMessage | ErrorMessage | AckMessage | ResumeMessage | ResumeAckMessage | AckRetryMessage

/**
 * 간단한 체크섬 계산 (FNV-1a 해시)
 */
function calculateChecksum(buffer: ArrayBuffer): number {
  const data = new Uint8Array(buffer)
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]!
    hash = (hash * 16777619) >>> 0 // FNV prime
  }
  return hash
}

/**
 * 청크 메시지 생성 (인덱스 + 데이터 + 체크섬을 하나의 메시지로)
 */
function createChunkMessage(index: number, chunkData: ArrayBuffer): ArrayBuffer {
  const checksum = calculateChecksum(chunkData)
  const indexBuffer = new Uint32Array([index])
  const checksumBuffer = new Uint32Array([checksum])

  // 단일 ArrayBuffer로 결합: [index(4), checksum(4), data(...)]
  const totalSize = 8 + chunkData.byteLength
  const combinedBuffer = new Uint8Array(totalSize)

  combinedBuffer.set(new Uint8Array(indexBuffer.buffer), 0)
  combinedBuffer.set(new Uint8Array(checksumBuffer.buffer), 4)
  combinedBuffer.set(new Uint8Array(chunkData), 8)

  return combinedBuffer.buffer
}

/**
 * 청크 메시지 파싱
 */
function parseChunkMessage(buffer: ArrayBuffer): { index: number, data: ArrayBuffer, checksum: number } | null {
  if (buffer.byteLength < 8) return null

  const view = new Uint32Array(buffer, 0, 2)
  const index = view[0]!
  const expectedChecksum = view[1]!
  const data = buffer.slice(8)

  const actualChecksum = calculateChecksum(data)
  if (actualChecksum !== expectedChecksum) {
    console.warn(`[DirectTransfer] 체크섬 불일치: 예상=${expectedChecksum}, 실제=${actualChecksum}, 인덱스=${index}`)
    return null // 체크섬 불일치 시 무시
  }

  return { index, data, checksum: actualChecksum }
}

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

  // 전송/수신 중인 파일 추적 (중복 방지)
  const activeTransfers = new Map<string, 'sending' | 'receiving'>()

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
    const transferKey = `${fileId}-${targetUuid}`

    // 이미 전송 중이면 무시
    if (activeTransfers.has(transferKey)) {
      console.log(`[#15-guard] 이미 전송 중: ${fileId}`)
      return
    }

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

    // 전송 중 표시
    activeTransfers.set(transferKey, 'sending')

    try {
      const totalChunks = Math.ceil(fileData.byteLength / CHUNK_SIZE)

      const transferStartTime = performance.now()
      console.log(`[#15] P2P 전송 시작 (큐 관리): ${totalChunks}개 청크, ${(fileData.byteLength / 1024 / 1024).toFixed(2)}MB`)

      // 진행 상태 초기화
      const meta = files.get(fileId)
      startTransfer(transferKey, meta?.name || fileId, 'upload', totalChunks, fileData.byteLength, false)

      // Offer 생성 및 연결 (이어받기 정보는 Answer에서 전달됨)
      const channel = await createOffer(fileId, targetUuid, totalChunks, fileData.byteLength)

      // 에러 핸들러 등록 (버퍼 오버플로우 감지)
      channel.onerror = (event) => {
        console.error(`[#15] DataChannel 에러:`, event)
        if (event instanceof RTCErrorEvent) {
          console.error(`[#15] RTCErrorEvent - errorDetail: ${event.error?.errorDetail}, message: ${event.error?.message}`)
        }
      }

      // 채널 열릴 때까지 대기
      if (channel.readyState !== 'open') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('채널 열림 타임아웃')), 10000)
          const openHandler = () => {
            clearTimeout(timeout)
            resolve()
          }
          const errorHandler = (error: Event) => {
            clearTimeout(timeout)
            console.error('[#15] 채널 열기 실패:', error)
            reject(new Error('채널 에러'))
          }
          channel.addEventListener('open', openHandler, { once: true })
          channel.addEventListener('error', errorHandler, { once: true })
        })
      }

      // 청크 전송 (이어받기: 수신자가 이미 받은 청크는 건너뜀)
      let skippedChunks = 0

            // 이어받기 정보 수신 및 ACK 핸들러
      let receivedChunksSet: Set<number> | null = null
      let resumeAcknowledged = false
      let lastAckedIndex = -1
      let ackRetries = 0

      const messageHandler = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data) as TransferMessage
            if (msg.type === 'resume') {
              receivedChunksSet = new Set(msg.receivedChunks)
              skippedChunks = receivedChunksSet.size
              console.log(`[#15-1] 이어받기: ${skippedChunks}개 청크 건너뜀`)

              // Resume 수신 즉시 ACK 전송
              const resumeAckMsg: ResumeAckMessage = { type: 'resume_ack', acknowledged: true }
              channel.send(JSON.stringify(resumeAckMsg))
              resumeAcknowledged = true
              console.log(`[#15-2] Resume ACK 전송`)
            } else if (msg.type === 'ack') {
              lastAckedIndex = Math.max(lastAckedIndex, msg.upToIndex)
              ackRetries = 0 // ACK 수신 시 리트라이 카운트 리셋
              console.log(`[#16] ACK 수신: ${msg.upToIndex} (받은 청크: ${msg.receivedCount})`)
            }
          } catch {
            // 파싱 실패 무시
          }
        }
      }
      channel.addEventListener('message', messageHandler)

      // 전송 시작 메시지 전송
      const startMsg: StartMessage = {
        type: 'start',
        totalChunks,
        fileSize: fileData.byteLength
      }
      channel.send(JSON.stringify(startMsg))

      // Resume 정보 대기 (최대 3초)
      let resumeWaitTime = 0
      while (!resumeAcknowledged && resumeWaitTime < 3000) {
        await new Promise(resolve => setTimeout(resolve, 100))
        resumeWaitTime += 100
      }

      if (!resumeAcknowledged) {
        console.log(`[#15-3] Resume ACK 타임아웃 - 새 전송으로 진행`)
      }

      try {
        for (let i = 0; i < totalChunks; i++) {
          // 취소 확인
          if (checkCancelled && checkCancelled()) {
            throw new Error('전송 취소됨')
          }

          // 이미 받은 청크는 건너뜀
          if (receivedChunksSet && receivedChunksSet.has(i)) {
            continue
          }

          // Flow control: FLOW_CONTROL_WINDOW개 청크마다 ACK 대기
          if (i > 0 && i % FLOW_CONTROL_WINDOW === 0) {
            let waitTime = 0
            const expectedAckIndex = i - 1

            // ACK가 올 때까지 대기 (최대 ACK_TIMEOUT + 리트라이)
            while (lastAckedIndex < expectedAckIndex && waitTime < ACK_TIMEOUT && ackRetries < MAX_ACK_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, 100))
              waitTime += 100

              // ACK 타임아웃 시 재전송 요청
              if (waitTime >= ACK_TIMEOUT) {
                ackRetries++
                console.warn(`[#16] ACK 타임아웃 (${ackRetries}/${MAX_ACK_RETRIES}) - 마지막 ACK: ${lastAckedIndex}, 예상: ${expectedAckIndex}`)

                if (ackRetries < MAX_ACK_RETRIES) {
                  // 재전송 요청 메시지 (현재까지 보낸 청크 수 알림)
                  const retryMsg = { type: 'ack_retry', sentUpTo: i - 1 }
                  channel.send(JSON.stringify(retryMsg))
                  waitTime = 0 // 타이머 리셋
                }
              }
            }

            if (lastAckedIndex < expectedAckIndex && ackRetries >= MAX_ACK_RETRIES) {
              console.warn(`[#16] ACK 재전송 최대 횟수 초과 - 계속 진행`)
              // 최대 리트라이 초과 시 계속 진행 (네트워크 문제 감수)
            }
          }

          const start = i * CHUNK_SIZE
          const end = Math.min(start + CHUNK_SIZE, fileData.byteLength)
          const chunk = fileData.slice(start, end)

          // 청크를 단일 메시지로 결합 (인덱스 + 체크섬 + 데이터)
          const chunkMessage = createChunkMessage(i, chunk)

          // 버퍼 대기: 버퍼가 임계값 이하로 떨어질 때까지 대기
          while (channel.bufferedAmount + chunkMessage.byteLength > MAX_BUFFER_SIZE) {
            await new Promise(resolve => setTimeout(resolve, 50))
          }

          // 단일 메시지로 전송 (메시지 순서 보장)
          channel.send(chunkMessage)

          // UI 업데이트 최적화: 100청크마다만 업데이트
          const shouldUpdate = (i + 1) % 100 === 0 || i === totalChunks - 1
          updateProgress(transferKey, i + 1, shouldUpdate)

          // 진행 상황 콜백
          if (onProgress) {
            onProgress(end, fileData.byteLength)
          }

          // 로그 최적화: 100청크마다만 출력
          if (shouldUpdate) {
            console.log(`[#16] P2P 전송: ${i + 1}/${totalChunks} (${(((i + 1) / totalChunks) * 100).toFixed(0)}%)`)
          }
        }
      } finally {
        // 메시지 핸들러 정리
        channel.removeEventListener('message', messageHandler)
      }

      const transferElapsed = performance.now() - transferStartTime
      const speedMBps = (fileData.byteLength / 1024 / 1024) / (transferElapsed / 1000)

      if (skippedChunks > 0) {
        console.log(`[#17] P2P 전송 완료 (이어받기: ${skippedChunks}개 건너뜀) - ${transferElapsed.toFixed(0)}ms, ${speedMBps.toFixed(2)} MB/s`)
      } else {
        console.log(`[#17] P2P 전송 완료 - ${transferElapsed.toFixed(0)}ms, ${speedMBps.toFixed(2)} MB/s`)
      }
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
    } finally {
      // 전송 완료 또는 실패 시 상태 제거
      activeTransfers.delete(transferKey)
    }
  }

  /**
   * 파일 수신 (수신자)
   */
  async function receiveFileDirect(offer: FileTransferOffer): Promise<Blob> {
    const connectionId = getConnectionId(offer.fileId, offer.senderUuid)
    const transferKey = offer.fileId // 수신자는 fileId만 사용

    // 이미 수신 중이면 무시 (중복 Offer 방지)
    if (activeTransfers.has(transferKey)) {
      console.log(`[#18-guard] 이미 수신 중: ${offer.fileId}`)
      throw new Error('이미 수신 중입니다')
    }

    // 수신 중 표시
    activeTransfers.set(transferKey, 'receiving')

    try {
      const receiveStartTime = performance.now()
      console.log(`[#18] P2P 수신 시작: ${offer.totalChunks}개 청크, ${(offer.fileSize / 1024 / 1024).toFixed(2)}MB`)

      // 이어받기: 기존 다운로드 상태 확인
      const { loadDownloadState, saveDownloadState, deleteDownloadState, isComplete: isDownloadComplete } =
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

      // 채널이 열리면 이어받기 정보 전송
      const sendResumeInfo = () => {
        if (partialState!.receivedChunks.size > 0) {
          const resumeMsg: ResumeMessage = {
            type: 'resume',
            receivedChunks: Array.from(partialState!.receivedChunks)
          }
          channel.send(JSON.stringify(resumeMsg))
          console.log(`[#18-2] 이어받기 정보 전송: ${partialState!.receivedChunks.size}개 청크`)
        }
      }

      // 채널 열릴 때까지 대기
      if (channel.readyState !== 'open') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('채널 열림 타임아웃')), 10000)
          const openHandler = () => {
            clearTimeout(timeout)
            sendResumeInfo() // 채널 열리면 이어받기 정보 전송
            resolve()
          }
          const errorHandler = (error: Event) => {
            clearTimeout(timeout)
            console.error('[#18] 채널 열기 실패:', error)
            if (error instanceof RTCErrorEvent) {
              console.error(`[#18] RTCErrorEvent - errorDetail: ${error.error?.errorDetail}, message: ${error.error?.message}`)
            }
            reject(new Error('채널 에러'))
          }
          channel.addEventListener('open', openHandler, { once: true })
          channel.addEventListener('error', errorHandler, { once: true })
        })
      } else {
        sendResumeInfo() // 이미 열려있으면 즉시 전송
      }

      // 청크 수신
      return new Promise<Blob>(async (resolve, reject) => {
        const chunks = new Array<ArrayBuffer | null>(offer.totalChunks)
        let pendingSaveChunks = 0 // 저장되지 않은 청크 수
        const pendingChunksBuffer = new Map<number, ArrayBuffer>() // 배치 저장용 버퍼
        let isSaving = false // DB 저장 중 플래그
        const timeout = setTimeout(async () => {
          // 타임아웃 시 진행 상태 저장
          if (pendingChunksBuffer.size > 0) {
            await saveChunksBatch(offer.fileId, pendingChunksBuffer)
            await saveDownloadState(partialState!)
          }
          reject(new Error('수신 타임아웃'))
        }, 60000)

        // 기존에 받은 청크 복원
        if (partialState) {
          for (const [index, buffer] of partialState.chunks.entries()) {
            chunks[index] = buffer
          }
        }

        channel.onmessage = async (event) => {
          if (typeof event.data === 'string') {
            // 제어 메시지 (JSON)
            const msg: TransferMessage = JSON.parse(event.data)

            switch (msg.type) {
              case 'start':
                // 전송 시작 - 이미 Offer에 정보가 있으므로 무시 가능
                console.log(`[#19] 전송 시작: ${msg.totalChunks}개 청크`)
                break

              case 'complete': {
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

                const receiveElapsed = performance.now() - receiveStartTime
                const speedMBps = (blob.size / 1024 / 1024) / (receiveElapsed / 1000)
                console.log(`[#19] P2P 수신 완료: ${(blob.size / 1024 / 1024).toFixed(2)}MB - ${receiveElapsed.toFixed(0)}ms, ${speedMBps.toFixed(2)} MB/s`)

                // 캐시 저장 및 상태 삭제 (완료 시 최종 저장 보장)
                try {
                  await cacheFile(offer.fileId, blob)
                  // 완료 시 DB에서 삭제 (더 이상 이어받기 필요 없음)
                  await deleteDownloadState(offer.fileId)
                  completeTransfer(transferKey)
                  channel.close()
                  setTimeout(() => cleanup(connectionId), 1000)
                  resolve(blob)
                } catch (error) {
                  reject(error)
                }
                break
              }

              case 'error':
                clearTimeout(timeout)
                // 에러 시 최종 저장 (이어받기 가능하도록)
                if (pendingChunksBuffer.size > 0) {
                  await saveChunksBatch(offer.fileId, pendingChunksBuffer)
                  await saveDownloadState(partialState!)
                }
                channel.close()
                cleanup(connectionId)
                reject(new Error(msg.message))
                break

              case 'ack_retry':
                // 송신자가 ACK를 받지 못했으므로 현재까지 받은 청크 수 재전송
                console.log(`[#20] ACK 재요청 수신 - 현재까지 받은 청크: ${partialState!.receivedChunks.size}`)
                const maxIndex = partialState!.receivedChunks.size > 0
                  ? Math.max(...Array.from(partialState!.receivedChunks))
                  : -1
                const retryAckMsg: AckMessage = {
                  type: 'ack',
                  upToIndex: maxIndex,
                  receivedCount: partialState!.receivedChunks.size
                }
                channel.send(JSON.stringify(retryAckMsg))
                break
            }
          } else {
            // ArrayBuffer - 결합된 청크 메시지 (인덱스 + 체크섬 + 데이터)
            const buffer = event.data as ArrayBuffer

            // 청크 메시지 파싱
            const parsedChunk = parseChunkMessage(buffer)
            if (!parsedChunk) {
              console.warn(`[DirectTransfer] 청크 메시지 파싱 실패 또는 체크섬 불일치`)
              return
            }

            const { index, data } = parsedChunk

            // Guard: 청크 인덱스 유효성 검증
            if (index < 0 || index >= offer.totalChunks) {
              console.warn(`[DirectTransfer] 잘못된 청크 인덱스: ${index}`)
              return
            }

            // Guard: 이미 받은 청크는 건너뛰기 (중복 전송 방지)
            if (partialState!.receivedChunks.has(index)) {
              console.log(`[DirectTransfer] 중복 청크 무시: ${index}`)
              return
            }

            // 청크 저장 (메모리에만, DB 저장은 배치로)
            chunks[index] = data
            partialState!.receivedChunks.add(index)
            partialState!.chunks.set(index, data)
            partialState!.timestamp = Date.now()

            // 배치 버퍼에 추가
            pendingChunksBuffer.set(index, data)
            pendingSaveChunks++

            // Flow control: FLOW_CONTROL_WINDOW개 청크마다 ACK 전송
            if (partialState!.receivedChunks.size % FLOW_CONTROL_WINDOW === 0) {
              const ackMsg: AckMessage = {
                type: 'ack',
                upToIndex: index,
                receivedCount: partialState!.receivedChunks.size
              }
              try {
                if (channel.readyState === 'open') {
                  channel.send(JSON.stringify(ackMsg))
                  console.log(`[#20] ACK 전송: ${index} (총 ${partialState!.receivedChunks.size}개)`)
                }
              } catch (error) {
                console.warn(`[#20] ACK 전송 실패:`, error)
              }
            }

            // UI 업데이트 최적화: 100청크마다만 업데이트
            const shouldUpdate = partialState!.receivedChunks.size % 100 === 0 || isDownloadComplete(partialState!)
            updateProgress(transferKey, partialState!.receivedChunks.size, shouldUpdate)

            // 배치 DB 저장 (DB_SAVE_CHUNK_INTERVAL개마다)
            if (pendingSaveChunks >= DB_SAVE_CHUNK_INTERVAL && !isSaving) {
              isSaving = true
              const chunksToSave = new Map(pendingChunksBuffer) // 복사
              const count = chunksToSave.size
              pendingChunksBuffer.clear()
              pendingSaveChunks = 0

              // 백그라운드 배치 저장 (전송 블로킹 없음)
              Promise.all([
                saveChunksBatch(offer.fileId, chunksToSave),
                saveDownloadState(partialState!)
              ]).then(() => {
                isSaving = false
                console.log(`[#20] DB 배치 저장 완료: ${count}개 청크`)
              }).catch((err) => {
                isSaving = false
                // 실패 시 버퍼에 다시 추가
                chunksToSave.forEach((data, idx) => {
                  pendingChunksBuffer.set(idx, data)
                })
                pendingSaveChunks += count
                console.error('[DirectTransfer] DB 저장 실패:', err)
              })
            }

            // 로그 최적화: 100청크마다만 출력
            if (shouldUpdate) {
              console.log(`[#20] P2P 수신: ${partialState!.receivedChunks.size}/${offer.totalChunks} (${((partialState!.receivedChunks.size / offer.totalChunks) * 100).toFixed(0)}%)`)
            }
          }
        }

        channel.onerror = async (error) => {
          clearTimeout(timeout)
          // 에러 시 최종 저장 (이어받기 가능하도록)
          if (pendingChunksBuffer.size > 0) {
            await saveChunksBatch(offer.fileId, pendingChunksBuffer)
            await saveDownloadState(partialState!)
          }
          cleanup(connectionId)
          reject(error)
        }

        channel.onclose = async () => {
          if (!isDownloadComplete(partialState!)) {
            clearTimeout(timeout)
            // 채널 종료 시 최종 저장 (이어받기 가능하도록)
            if (pendingChunksBuffer.size > 0) {
              await saveChunksBatch(offer.fileId, pendingChunksBuffer)
              await saveDownloadState(partialState!)
            }
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
    } finally {
      // 수신 완료 또는 실패 시 상태 제거
      activeTransfers.delete(transferKey)
    }
  }

  return {
    sendFileViaQueue,        // 큐 기반 전송
    receiveFileDirect,
    activeTransfers,         // 디버깅용
  }
}
