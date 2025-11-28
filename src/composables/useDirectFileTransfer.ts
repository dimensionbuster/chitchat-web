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
const FLOW_CONTROL_WINDOW = 50 // 50개 청크마다 ACK 대기 (6.4MB) - 백프레셔 개선
const MIN_FLOW_CONTROL_WINDOW = 10 // 최소 윈도우 (느린 네트워크용)
const MAX_UNACKED_CHUNKS = 100 // 최대 미확인 청크 수 (12.8MB)
const DB_SAVE_CHUNK_INTERVAL = 10 // 10개 청크마다 DB 저장 (1.28MB) - 연결 끊김 시 손실 최소화
const ACK_TIMEOUT = 10000 // ACK 대기 타임아웃 10초
const ACK_WAIT_INTERVAL = 50 // ACK 대기 체크 주기
const BUFFER_WAIT_TIMEOUT = 30000 // 버퍼 대기 최대 30초

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
}

type ResumeMessage = {
  type: 'resume'
  receivedChunks: number[]
}

type TransferMessage = StartMessage | CompleteMessage | ErrorMessage | AckMessage | ResumeMessage

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

      // 이어받기 정보 수신
      let receivedChunksSet: Set<number> | null = null as Set<number> | null
      let skippedChunks = 0
      let resumeInfoReceived = false
      let resumeWaitTimeout: number | null = null

      // 전송 시작 메시지 전송
      const startMsg: StartMessage = {
        type: 'start',
        totalChunks,
        fileSize: fileData.byteLength
      }
      channel.send(JSON.stringify(startMsg))

      // 🔥 Resume 메시지 대기 (최대 3초)
      const resumePromise = new Promise<void>((resolve) => {
        resumeWaitTimeout = window.setTimeout(() => {
          console.log('[#15-0] Resume 메시지 타임아웃 - 새 전송으로 진행')
          resumeInfoReceived = true
          resolve()
        }, 3000)
      })

      // 🔥 백프레셔: ACK 기반 흐름 제어
      let lastAckedIndex = -1 // 수신자가 확인한 마지막 연속 청크 인덱스
      let lastAckTime = Date.now() // 마지막 ACK 수신 시간
      let currentWindow = FLOW_CONTROL_WINDOW // 동적 윈도우 크기

      // ACK 및 Resume 메시지 핸들러 (단일 핸들러로 통합)
      const messageHandler = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data) as TransferMessage
            if (msg.type === 'ack') {
              const prevAckedIndex = lastAckedIndex
              lastAckedIndex = msg.upToIndex
              lastAckTime = Date.now()

              // 🔥 동적 윈도우 조정: ACK가 빠르게 오면 윈도우 증가, 느리면 감소
              const ackGap = msg.upToIndex - prevAckedIndex
              if (ackGap >= currentWindow && currentWindow < FLOW_CONTROL_WINDOW) {
                currentWindow = Math.min(currentWindow + 10, FLOW_CONTROL_WINDOW)
              } else if (ackGap < currentWindow / 2 && currentWindow > MIN_FLOW_CONTROL_WINDOW) {
                currentWindow = Math.max(currentWindow - 10, MIN_FLOW_CONTROL_WINDOW)
              }

              console.log(`[#16-ack] ACK 수신: ${msg.upToIndex} (gap: ${ackGap}, window: ${currentWindow})`)
            } else if (msg.type === 'resume' && !resumeInfoReceived) {
              if (resumeWaitTimeout !== null) {
                clearTimeout(resumeWaitTimeout)
                resumeWaitTimeout = null
              }
              receivedChunksSet = new Set(msg.receivedChunks)
              skippedChunks = receivedChunksSet.size
              resumeInfoReceived = true
              console.log(`[#15-1] 이어받기: ${skippedChunks}개 청크 건너뜀`)
            }
          } catch (error) {
            console.warn('[#15] 메시지 파싱 실패:', error)
          }
        }
      }
      channel.addEventListener('message', messageHandler)

      // 🔥 Resume 메시지 대기 (이어받기 체크)
      await resumePromise

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

          // 🔥 백프레셔: 미확인 청크가 너무 많으면 ACK 대기
          const unackedChunks = i - lastAckedIndex - 1
          if (unackedChunks >= MAX_UNACKED_CHUNKS) {
            const targetAck = i - currentWindow
            let waitTime = 0
            const waitStartTime = Date.now()

            console.log(`[#16-wait] 백프레셔 대기 시작: unacked=${unackedChunks}, target=${targetAck}, lastAck=${lastAckedIndex}`)

            while (lastAckedIndex < targetAck && waitTime < ACK_TIMEOUT) {
              await new Promise((resolve) => setTimeout(resolve, ACK_WAIT_INTERVAL))
              waitTime = Date.now() - waitStartTime

              // 취소 확인
              if (checkCancelled && checkCancelled()) {
                throw new Error('전송 취소됨')
              }
            }

            if (lastAckedIndex >= targetAck) {
              console.log(`[#16-resume] 백프레셔 해제: lastAck=${lastAckedIndex} (waited ${waitTime}ms)`)
            } else {
              console.warn(`[#16-timeout] ACK 타임아웃 - 강제 진행 (lastAck: ${lastAckedIndex}, target: ${targetAck})`)
              // 타임아웃 시에도 최소한의 대기
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
          }

          // 🔥 주기적 ACK 상태 로깅 (동적 윈도우 기준)
          if (i > 0 && i % currentWindow === 0) {
            const lag = i - lastAckedIndex - 1
            const ackAge = Date.now() - lastAckTime
            console.log(`[#16-status] 청크 ${i}: ACK lag=${lag}, age=${ackAge}ms, window=${currentWindow}`)
          }

          const start = i * CHUNK_SIZE
          const end = Math.min(start + CHUNK_SIZE, fileData.byteLength)
          const chunk = fileData.slice(start, end)

          // 청크 인덱스를 4바이트로 인코딩 (Uint32)
          const indexBuffer = new Uint32Array([i])

          // 버퍼 대기: 버퍼가 임계값 이하로 떨어질 때까지 대기 (타임아웃 추가)
          const requiredSpace = 4 + chunk.byteLength // 인덱스(4) + 청크 데이터
          const bufferWaitStart = Date.now()
          while (channel.bufferedAmount + requiredSpace > MAX_BUFFER_SIZE) {
            await new Promise((resolve) => setTimeout(resolve, 50))

            // 버퍼 대기 타임아웃
            if (Date.now() - bufferWaitStart > BUFFER_WAIT_TIMEOUT) {
              throw new Error(`버퍼 대기 타임아웃 (buffered: ${channel.bufferedAmount}, required: ${requiredSpace})`)
            }

            // 취소 확인
            if (checkCancelled && checkCancelled()) {
              throw new Error('전송 취소됨')
            }
          }

          // 청크 인덱스 + 데이터 전송
          try {
            channel.send(indexBuffer.buffer)
            channel.send(chunk)
          } catch (error) {
            console.error(`[#16] 청크 전송 실패 (index: ${i}):`, error)
            throw error
          }

          // UI 업데이트 최적화: 100청크마다만 업데이트
          const shouldUpdate = (i + 1) % 100 === 0 || i === totalChunks - 1
          updateProgress(transferKey, i + 1, shouldUpdate)

          // 진행 상황 콜백
          if (onProgress) {
            onProgress(end, fileData.byteLength)
          }

          // 로그 최적화: 100청크마다만 출력
          if (shouldUpdate) {
            console.log(`[#16] P2P 전송: ${i + 1}/${totalChunks} (${(((i + 1) / totalChunks) * 100).toFixed(0)}%), buffered: ${(channel.bufferedAmount / 1024).toFixed(0)}KB`)
          }
        }
      } finally {
        // 메시지 핸들러 정리
        channel.removeEventListener('message', messageHandler)
        // 타임아웃 정리
        if (resumeWaitTimeout !== null) {
          clearTimeout(resumeWaitTimeout)
        }
      }

      // 완료 메시지 전송
      while (channel.bufferedAmount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const completeMsg: CompleteMessage = { type: 'complete' }
      channel.send(JSON.stringify(completeMsg))

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

      // 청크 수신 (순서 무관)
      return new Promise<Blob>(async (resolve, reject) => {
        // 🔥 청크를 Map으로 관리 (순서와 무관하게 수신)
        const receivedChunksMap = new Map<number, ArrayBuffer>()
        let nextExpectedIndex: number | null = null // 다음 청크 인덱스 대기 (null이면 아직 수신 안함)
        let pendingSaveChunks = 0 // 저장되지 않은 청크 수
        const pendingChunksBuffer = new Map<number, ArrayBuffer>() // 배치 저장용 버퍼
        let isSaving = false // DB 저장 중 플래그

        // 기존에 받은 청크 복원
        if (partialState) {
          for (const [index, buffer] of partialState.chunks.entries()) {
            receivedChunksMap.set(index, buffer)
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
                // 🔥 모든 청크가 도착했는지 확인 (receivedChunksMap 사용)
                if (receivedChunksMap.size !== offer.totalChunks) {
                  // 🔥 마지막 저장 시도 (논블로킹)
                  if (pendingChunksBuffer.size > 0) {
                    Promise.all([
                      saveChunksBatch(offer.fileId, pendingChunksBuffer),
                      saveDownloadState(partialState!)
                    ]).catch(console.error)
                  }
                  reject(new Error(`청크 누락: ${receivedChunksMap.size}/${offer.totalChunks}`))
                  return
                }

                const receiveElapsed = performance.now() - receiveStartTime
                console.log(`[#19] P2P 수신 완료: ${receivedChunksMap.size}개 청크`)

                // 🔥 백그라운드에서 Blob 생성 및 저장 (논블로킹)
                Promise.resolve().then(async () => {
                  // 청크를 순서대로 정렬하여 Blob 생성
                  const sortedChunks: ArrayBuffer[] = []
                  for (let i = 0; i < offer.totalChunks; i++) {
                    const chunk = receivedChunksMap.get(i)
                    if (!chunk) {
                      throw new Error(`청크 ${i}가 누락되었습니다`)
                    }
                    sortedChunks.push(chunk)
                  }

                  const blob = new Blob(sortedChunks, { type: meta?.type || 'application/octet-stream' })
                  const speedMBps = (blob.size / 1024 / 1024) / (receiveElapsed / 1000)
                  console.log(`[#19] Blob 생성 완료: ${(blob.size / 1024 / 1024).toFixed(2)}MB - ${receiveElapsed.toFixed(0)}ms, ${speedMBps.toFixed(2)} MB/s`)

                  // 캐시 저장 및 상태 삭제 (백그라운드)
                  await cacheFile(offer.fileId, blob)
                  await deleteDownloadState(offer.fileId)

                  completeTransfer(transferKey)
                  console.log(`[#19] 캐시 저장 완료: ${offer.fileId}`)

                  return blob
                }).then((blob) => {
                  channel.close()
                  setTimeout(() => cleanup(connectionId), 1000)
                  resolve(blob)
                }).catch((error) => {
                  console.error('[#19] 완료 처리 실패:', error)
                  channel.close()
                  cleanup(connectionId)
                  reject(error)
                })

                break
              }

              case 'error':
                // 🔥 에러 시 최종 저장 (논블로킹)
                if (pendingChunksBuffer.size > 0) {
                  Promise.all([
                    saveChunksBatch(offer.fileId, pendingChunksBuffer),
                    saveDownloadState(partialState!)
                  ]).catch(console.error)
                }
                channel.close()
                cleanup(connectionId)
                reject(new Error(msg.message))
                break
            }
          } else {
            // 🔥 ArrayBuffer - 청크 인덱스 또는 청크 데이터 (순서 무관 수신)
            const buffer = event.data as ArrayBuffer

            if (buffer.byteLength === 4) {
              // 4바이트면 청크 인덱스 (Uint32)
              const index = new Uint32Array(buffer)[0]
              if (index !== undefined) {
                nextExpectedIndex = index
              }
            } else {
              // 그 외는 청크 데이터
              // Guard: 청크 인덱스 유효성 검증
              if (nextExpectedIndex === null || nextExpectedIndex < 0 || nextExpectedIndex >= offer.totalChunks) {
                console.warn(`[DirectTransfer] 잘못된 청크 인덱스: ${nextExpectedIndex}`)
                nextExpectedIndex = null
                return
              }

              // Guard: 이미 받은 청크는 건너뛰기
              if (receivedChunksMap.has(nextExpectedIndex)) {
                nextExpectedIndex = null
                return
              }

              // 🔥 청크 저장 (순서와 무관하게 Map에 저장)
              receivedChunksMap.set(nextExpectedIndex, buffer)
              partialState!.receivedChunks.add(nextExpectedIndex)
              partialState!.chunks.set(nextExpectedIndex, buffer)
              partialState!.timestamp = Date.now()

              // 배치 버퍼에 추가
              pendingChunksBuffer.set(nextExpectedIndex, buffer)
              pendingSaveChunks++

              // 🔥 백프레셔: 적응적 ACK 전송 (받은 청크 수 기반)
              // 빠른 네트워크: 50개마다, 느린 네트워크: 10개마다 ACK
              const ackInterval = receivedChunksMap.size > 500 ? FLOW_CONTROL_WINDOW : MIN_FLOW_CONTROL_WINDOW

              if (receivedChunksMap.size % ackInterval === 0) {
                // 최대 연속 인덱스 계산 (빈틈 없이 받은 마지막 청크)
                let consecutiveIndex = -1
                for (let idx = 0; idx < offer.totalChunks; idx++) {
                  if (receivedChunksMap.has(idx)) {
                    consecutiveIndex = idx
                  } else {
                    break // 첫 번째 빠진 청크에서 중단
                  }
                }

                const ackMsg: AckMessage = {
                  type: 'ack',
                  upToIndex: consecutiveIndex
                }

                // ACK 전송을 비동기로 처리하여 수신 블로킹 방지
                Promise.resolve().then(() => {
                  if (channel.readyState === 'open') {
                    try {
                      channel.send(JSON.stringify(ackMsg))
                      console.log(`[#20-ack] ACK 전송: ${consecutiveIndex} (받은: ${receivedChunksMap.size}/${offer.totalChunks}, 간격: ${ackInterval})`)
                    } catch (error) {
                      console.warn(`[#20] ACK 전송 실패:`, error)
                    }
                  }
                }).catch((error) => {
                  console.warn(`[#20] ACK 전송 에러:`, error)
                })
              }

              // UI 업데이트 최적화: 100청크마다만 업데이트
              const shouldUpdate = receivedChunksMap.size % 100 === 0 || receivedChunksMap.size === offer.totalChunks
              updateProgress(transferKey, receivedChunksMap.size, shouldUpdate)

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
                  for (const [idx, data] of chunksToSave) {
                    pendingChunksBuffer.set(idx, data)
                  }
                  pendingSaveChunks += count
                  console.error('[DirectTransfer] DB 저장 실패:', err)
                })
              }

              // 로그 최적화: 100청크마다만 출력
              if (shouldUpdate) {
                console.log(`[#20] P2P 수신: ${receivedChunksMap.size}/${offer.totalChunks} (${((receivedChunksMap.size / offer.totalChunks) * 100).toFixed(0)}%)`)
              }

              // 다음 청크 인덱스 초기화
              nextExpectedIndex = null
            }
          }
        }

        channel.onerror = (error) => {
          console.error('[#20] 채널 에러 감지 - 즉시 저장 시작')

          // 🔥 에러 시 즉시 저장 (동기적으로 완료 대기)
          const savePromise = Promise.all([
            pendingChunksBuffer.size > 0 ? saveChunksBatch(offer.fileId, pendingChunksBuffer) : Promise.resolve(),
            saveDownloadState(partialState!)
          ])

          savePromise
            .then(() => {
              console.log(`[#20] ✅ 에러 시 저장 완료: ${pendingChunksBuffer.size}개 청크`)
              cleanup(connectionId)
              reject(error)
            })
            .catch((saveErr) => {
              console.error('[#20] ❌ 에러 시 저장 실패:', saveErr)
              cleanup(connectionId)
              reject(error)
            })
        }

        channel.onclose = () => {
          console.log('[#20] 채널 닫힘 감지')

          // 🔥 완료 검증: receivedChunksMap 사용
          if (receivedChunksMap.size !== offer.totalChunks) {
            console.warn(`[#20] 불완전 수신 감지: ${receivedChunksMap.size}/${offer.totalChunks} - 즉시 저장`)

            // 🔥 채널 종료 시 즉시 저장 (동기적으로 완료 대기)
            const savePromise = Promise.all([
              pendingChunksBuffer.size > 0 ? saveChunksBatch(offer.fileId, pendingChunksBuffer) : Promise.resolve(),
              saveDownloadState(partialState!)
            ])

            savePromise
              .then(() => {
                console.log(`[#20] ✅ 닫힘 시 저장 완료: ${pendingChunksBuffer.size}개 청크`)
                cleanup(connectionId)
                reject(new Error('채널이 완료 전에 닫혔습니다'))
              })
              .catch((saveErr) => {
                console.error('[#20] ❌ 닫힘 시 저장 실패:', saveErr)
                cleanup(connectionId)
                reject(new Error('채널이 완료 전에 닫혔습니다'))
              })
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
