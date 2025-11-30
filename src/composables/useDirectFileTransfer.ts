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
const BUFFER_LOW_WATERMARK = 2 * 1024 * 1024 // 2MB - 버퍼가 이 이하로 떨어지면 전송 재개
const ACK_WINDOW = 20 // 20개 청크마다 ACK 요청 (2.56MB)
const ACK_TIMEOUT = 10000 // ACK 대기 타임아웃 10초
const DB_SAVE_CHUNK_INTERVAL = 50 // 50개 청크마다 DB 저장 (6.4MB)
const DB_SAVE_META_INTERVAL = 10 // 10개 청크마다 메타데이터 저장 (가벼움)
const BUFFER_WAIT_TIMEOUT = 30000 // 버퍼 대기 최대 30초
const BUFFER_CHECK_INTERVAL = 100 // 버퍼 체크 간격 100ms

type StartMessage = {
  type: 'start'
  totalChunks: number
  fileSize: number
  hasPartialData?: boolean // 수신자가 이어받기 데이터를 가지고 있는지 여부
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
  receivedCount: number // 수신자가 실제로 받은 총 청크 수
  nextChunkIndex: number // 수신자가 다음에 받고 싶은 청크 인덱스 (이어받기 정보 포함)
  lastContinuousIndex: number // 0부터 연속으로 받은 마지막 청크 인덱스 (-1이면 아직 없음)
}

type ResumeMessage = {
  type: 'resume'
  receivedChunks: number[]
}

type RequestAckMessage = {
  type: 'request-ack'
}

type TransferMessage = StartMessage | CompleteMessage | ErrorMessage | AckMessage | ResumeMessage | RequestAckMessage

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
      const receivedChunksSet = new Set<number>()
      let skippedChunks = 0
      let resumeInfoReceived = false
      let receiverHasPartialData = false // 수신자가 이어받기 데이터를 가지고 있는지

      // 전송 시작 메시지 전송
      const startMsg: StartMessage = {
        type: 'start',
        totalChunks,
        fileSize: fileData.byteLength
      }
      channel.send(JSON.stringify(startMsg))

      // ACK 및 Resume 메시지 핸들러
      // 순서 보장 안되므로 최대값만 추적 (더 최신 정보 우선)
      let confirmedNextChunk = skippedChunks // 수신자가 다음에 받고 싶은 청크 인덱스

      const messageHandler = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data) as TransferMessage
            if (msg.type === 'start') {
              // 수신자의 start 응답 (이어받기 여부 포함)
              receiverHasPartialData = msg.hasPartialData || false
              console.log(`[#15-start] 수신자 응답: hasPartialData=${receiverHasPartialData}`)
            } else if (msg.type === 'ack') {
              // ACK 순서 보장 안되므로 더 큰 값(최신 정보)만 반영
              const wasUpdated = msg.nextChunkIndex > confirmedNextChunk
              if (wasUpdated) {
                confirmedNextChunk = msg.nextChunkIndex

                // 백트래킹 시나리오: 수신자가 연속으로 받은 청크들을 receivedChunksSet에 반영
                // (0부터 lastContinuousIndex까지는 확실히 받았음)
                if (msg.lastContinuousIndex >= 0) {
                  for (let idx = 0; idx <= msg.lastContinuousIndex; idx++) {
                    if (!receivedChunksSet.has(idx)) {
                      receivedChunksSet.add(idx)
                      skippedChunks++
                    }
                  }
                }
              }
              // 타임아웃 디버깅을 위해 모든 ACK 로깅 (업데이트 안된 경우도 표시)
              console.log(`[#15-ack] ACK 수신${!wasUpdated ? '(무시)' : ''}: nextChunk=${msg.nextChunkIndex}, received=${msg.receivedCount}, continuous=${msg.lastContinuousIndex}, confirmed=${confirmedNextChunk}`)
            } else if (msg.type === 'resume' && !resumeInfoReceived) {
              msg.receivedChunks.forEach(idx => receivedChunksSet.add(idx))
              skippedChunks = receivedChunksSet.size

              // confirmedNextChunk: 0부터 연속으로 받은 다음 인덱스 계산
              let nextChunk = 0
              while (nextChunk < totalChunks && receivedChunksSet.has(nextChunk)) {
                nextChunk++
              }
              confirmedNextChunk = nextChunk

              resumeInfoReceived = true
              console.log(`[#15-1] 이어받기: 총 ${skippedChunks}개 청크 보유, 연속=${confirmedNextChunk - 1}, 다음요청=${confirmedNextChunk}`)
            }
          } catch (error) {
            console.warn('[#15] 메시지 파싱 실패:', error)
          }
        }
      }
      channel.addEventListener('message', messageHandler)

      // Resume 정보 대기: 수신자가 이어받기 데이터가 있을 때만 대기
      if (receiverHasPartialData) {
        const resumeWaitStart = Date.now()
        const RESUME_WAIT_TIMEOUT = 3000
        console.log(`[#15-resume] 수신자가 이어받기 데이터 보유 - Resume 정보 대기 중...`)
        while (!resumeInfoReceived && Date.now() - resumeWaitStart < RESUME_WAIT_TIMEOUT) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }

        if (resumeInfoReceived) {
          console.log(`[#15-resume] Resume 정보 수신 완료 (${Date.now() - resumeWaitStart}ms) - 스킵=${skippedChunks}`)
        } else {
          console.warn(`[#15-resume] Resume 정보 타임아웃 - 처음부터 전송`)
        }
      } else {
        console.log(`[#15-resume] 처음 받는 파일 - 즉시 전송 시작`)
      }

      // 주기적인 ACK 요청 (5초마다)
      let lastAckRequestTime = Date.now()
      const ACK_REQUEST_INTERVAL = 5000
      let actualSentChunks = 0 // 실제로 전송한 청크 수 (스킵 제외)

      try {
        for (let i = 0; i < totalChunks; i++) {
          // 취소 확인
          if (checkCancelled && checkCancelled()) {
            throw new Error('전송 취소됨')
          }

          // 주기적 ACK 요청
          const now = Date.now()
          if (now - lastAckRequestTime > ACK_REQUEST_INTERVAL) {
            try {
              const requestMsg: RequestAckMessage = { type: 'request-ack' }
              channel.send(JSON.stringify(requestMsg))
              console.log(`[#16-ack] ACK 요청 전송 (chunk=${i}, sent=${actualSentChunks}, skipped=${skippedChunks})`)
              lastAckRequestTime = now
            } catch (error) {
              console.warn('[#16-ack] ACK 요청 전송 실패:', error)
            }
          }

          // 이미 받은 청크는 건너뜀
          if (receivedChunksSet.has(i)) {
            // 스킵한 청크도 진행률에 반영
            const shouldUpdate = (i + 1) % 100 === 0 || i === totalChunks - 1
            updateProgress(transferKey, i + 1, shouldUpdate)
            if (onProgress) {
              const end = Math.min((i + 1) * CHUNK_SIZE, fileData.byteLength)
              onProgress(end, fileData.byteLength)
            }
            continue
          }

          // 실제 전송 카운트 증가
          actualSentChunks++

          // Flow control 1: ACK 기반 백프레셔 (수신자 실제 처리 상태 확인)
          // 수신자가 원하는 다음 청크보다 ACK_WINDOW개 이상 앞서 나가면 대기
          const gap = i - confirmedNextChunk // 현재 전송하려는 청크 - 수신자가 받고 싶은 다음 청크

          if (gap >= ACK_WINDOW) {
            const waitStart = Date.now()
            const oldConfirmed = confirmedNextChunk
            console.log(`[#16-ack] 백프레셔 대기 시작: 전송할청크=${i}, 수신자요청=${confirmedNextChunk}, 차이=${gap}`)

            // 차이가 ACK_WINDOW 미만이 될 때까지 대기
            let waitCount = 0
            let timeoutOccurred = false
            while (i - confirmedNextChunk >= ACK_WINDOW) {
              await new Promise((resolve) => setTimeout(resolve, BUFFER_CHECK_INTERVAL))
              waitCount++

              // 1초마다 상태 로깅
              if (waitCount % 10 === 0) {
                console.log(`[#16-ack] 대기 중... (${Date.now() - waitStart}ms) confirmed=${confirmedNextChunk}`)
              }

              // ACK 타임아웃 - 수신자 상태 재측정 및 백트래킹
              if (Date.now() - waitStart > ACK_TIMEOUT) {
                console.warn(`[#16-ack] ⚠️ ACK 대기 타임아웃! 수신자 상태 재측정 시작 (전송=${i}, 이전요청=${confirmedNextChunk})`)

                // 즉시 ACK 요청하여 수신자 실제 상태 확인
                try {
                  const requestMsg: RequestAckMessage = { type: 'request-ack' }
                  channel.send(JSON.stringify(requestMsg))
                  console.log(`[#16-backtrack] 백트래킹용 ACK 요청 전송`)
                } catch (error) {
                  console.warn('[#16-backtrack] ACK 요청 실패:', error)
                }

                // ACK 응답 대기 (최대 2초)
                const ackWaitStart = Date.now()
                const oldConfirmedBeforeWait = confirmedNextChunk
                while (confirmedNextChunk === oldConfirmedBeforeWait && Date.now() - ackWaitStart < 2000) {
                  await new Promise(resolve => setTimeout(resolve, 100))
                }

                if (confirmedNextChunk > oldConfirmedBeforeWait) {
                  // ACK 받음 - 수신자가 실제로 받은 위치로 백트래킹
                  console.warn(`[#16-backtrack] ✅ ACK 수신: 수신자는 ${confirmedNextChunk}까지 받음 - 백트래킹 시작`)

                  // 현재 위치가 수신자가 받은 위치보다 앞서있으면 백트래킹
                  if (i > confirmedNextChunk) {
                    const backtrackTo = confirmedNextChunk
                    console.warn(`[#16-backtrack] 백트래킹: ${i} → ${backtrackTo} (${i - backtrackTo}개 청크 되돌림)`)
                    i = backtrackTo - 1 // for문에서 i++되므로 -1
                    timeoutOccurred = true
                    break
                  } else {
                    console.log(`[#16-backtrack] 백트래킹 불필요 - 현재 위치=${i}, 수신자=${confirmedNextChunk}`)
                    timeoutOccurred = true
                    break
                  }
                } else {
                  // ACK 못받음 - 윈도우만 리셋하여 계속 진행
                  console.warn(`[#16-backtrack] ⚠️ ACK 응답 없음 - 윈도우만 리셋`)
                  confirmedNextChunk = Math.max(i - Math.floor(ACK_WINDOW / 2), skippedChunks)
                  console.warn(`[#16-backtrack] 새로운 confirmed=${confirmedNextChunk}, gap=${i - confirmedNextChunk}`)
                  timeoutOccurred = true
                  break
                }
              }

              // 취소 확인
              if (checkCancelled && checkCancelled()) {
                throw new Error('전송 취소됨')
              }
            }

            const waitTime = Date.now() - waitStart
            if (timeoutOccurred) {
              if (i < oldConfirmed) {
                // 백트래킹 발생
                console.log(`[#16-ack] 타임아웃 후 백트래킹 (${waitTime}ms) - 전송 위치 조정 (${i + 1} ← ${oldConfirmed + 1})`)
              } else {
                // 윈도우만 리셋
                console.log(`[#16-ack] 타임아웃 후 복구 (${waitTime}ms) - 윈도우 리셋 (confirmed: ${oldConfirmed} → ${confirmedNextChunk})`)
              }
            } else {
              console.log(`[#16-ack] 수신 확인 완료 (${waitTime}ms) - 계속 전송 (요청=${confirmedNextChunk})`)
            }
          }

          // Flow control 2: bufferedAmount 기반 (로컬 버퍼 관리)
          if (channel.bufferedAmount > MAX_BUFFER_SIZE) {
            const waitStart = Date.now()
            const initialBuffered = channel.bufferedAmount
            console.log(`[#16-buf] 버퍼 대기: ${(initialBuffered / 1024 / 1024).toFixed(2)}MB / ${(MAX_BUFFER_SIZE / 1024 / 1024).toFixed(2)}MB`)

            while (channel.bufferedAmount > BUFFER_LOW_WATERMARK) {
              await new Promise((resolve) => setTimeout(resolve, BUFFER_CHECK_INTERVAL))

              // 타임아웃 체크
              if (Date.now() - waitStart > BUFFER_WAIT_TIMEOUT) {
                console.warn(`[#16-buf] 버퍼 대기 타임아웃 - 계속 전송 (buffered: ${(channel.bufferedAmount / 1024 / 1024).toFixed(2)}MB)`)
                break
              }

              // 취소 확인
              if (checkCancelled && checkCancelled()) {
                throw new Error('전송 취소됨')
              }
            }

            const waitTime = Date.now() - waitStart
            const drainedAmount = initialBuffered - channel.bufferedAmount
            console.log(`[#16-buf] 버퍼 정리 완료: ${waitTime}ms, ${(drainedAmount / 1024 / 1024).toFixed(2)}MB 전송됨, 현재: ${(channel.bufferedAmount / 1024 / 1024).toFixed(2)}MB`)
          }

          const start = i * CHUNK_SIZE
          const end = Math.min(start + CHUNK_SIZE, fileData.byteLength)
          const chunk = fileData.slice(start, end)

          // 청크 인덱스(4바이트) + 데이터를 하나의 버퍼로 결합 (순서 보장)
          const combinedBuffer = new ArrayBuffer(4 + chunk.byteLength)
          const view = new DataView(combinedBuffer)
          view.setUint32(0, i, true) // 리틀 엔디안으로 인덱스 저장
          new Uint8Array(combinedBuffer, 4).set(new Uint8Array(chunk))

          // 결합된 버퍼 전송 (한 번에 전송하여 순서 보장)
          try {
            channel.send(combinedBuffer)
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
      }

      // 실제로 전송한 청크가 있을 때만 완료 메시지 전송
      if (actualSentChunks > 0) {
        // 완료 메시지 전송 전 버퍼 비우기
        while (channel.bufferedAmount > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        const completeMsg: CompleteMessage = { type: 'complete' }
        channel.send(JSON.stringify(completeMsg))
        console.log(`[#16] 완료 메시지 전송 (실제전송=${actualSentChunks}, 스킵=${skippedChunks}, 전체=${totalChunks})`)
      } else {
        console.log(`[#16] ⚠️ 전송할 청크 없음 - 수신자가 이미 모두 보유 (스킵=${skippedChunks}, 전체=${totalChunks})`)
        // 채널 닫지 않고 열어둠 - 수신자가 아직 완료 안됐을 수 있음
        return
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

      console.log(`[#18-resume] fileId로 이어받기 상태 조회: ${offer.fileId}`)
      let partialState = await loadDownloadState(offer.fileId)

      // 진행 상태 초기화
      const meta = files.get(offer.fileId)

      if (partialState) {
        console.log(`[#18-1] ✅ 이어받기 가능: ${partialState.receivedChunks.size}/${offer.totalChunks} 청크 보유 (fileId: ${offer.fileId})`)

        // 이미 완료된 파일인지 확인 (메타데이터 + 실제 청크 데이터)
        if (isDownloadComplete(partialState)) {
          console.log(`[#18-complete] 메타데이터 완료 - 실제 청크 데이터 확인 중...`)

          // 실제 청크 데이터가 모두 있는지 확인
          const chunks: ArrayBuffer[] = []
          let hasAllChunks = true
          for (let i = 0; i < offer.totalChunks; i++) {
            const chunk = partialState.chunks.get(i)
            if (!chunk) {
              console.warn(`[#18-complete] 청크 ${i} 데이터 누락 - 메타데이터만 있고 실제 데이터 없음`)
              hasAllChunks = false
              // receivedChunks에서 제거 (메타데이터 수정)
              partialState.receivedChunks.delete(i)
            } else {
              chunks.push(chunk)
            }
          }

          if (hasAllChunks && chunks.length === offer.totalChunks) {
            console.log(`[#18-complete] 🎉 모든 청크 데이터 확인 - 바로 반환`)
            const blob = new Blob(chunks, { type: meta?.type || 'application/octet-stream' })
            await cacheFile(offer.fileId, blob)
            await deleteDownloadState(offer.fileId)
            activeTransfers.delete(transferKey)
            return blob
          } else {
            console.warn(`[#18-complete] 실제 청크: ${chunks.length}/${offer.totalChunks} - 메타데이터 수정 후 이어받기`)
            // 메타데이터 업데이트 (누락된 청크 제외)
            await saveDownloadState(partialState)
          }
        }

        startTransfer(transferKey, meta?.name || offer.fileId, 'download', offer.totalChunks, offer.fileSize, true)
        updateProgress(transferKey, partialState.receivedChunks.size)
      } else {
        console.log(`[#18-1] ℹ️ 처음 받는 파일 (fileId: ${offer.fileId})`)
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

      // 채널이 열리면 시작 메시지 + 이어받기 정보 전송
      const hasPartialData = partialState!.receivedChunks.size > 0
      const sendStartAndResumeInfo = () => {
        // 먼저 start 메시지 전송 (이어받기 여부 포함)
        const startResponseMsg: StartMessage = {
          type: 'start',
          totalChunks: offer.totalChunks,
          fileSize: offer.fileSize,
          hasPartialData: hasPartialData
        }
        channel.send(JSON.stringify(startResponseMsg))
        console.log(`[#18-2] start 응답 전송 (hasPartialData=${hasPartialData})`)

        // 이어받기 정보가 있으면 resume 메시지 전송
        if (hasPartialData) {
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
            sendStartAndResumeInfo() // 채널 열리면 시작+이어받기 정보 전송
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
        sendStartAndResumeInfo() // 이미 열려있으면 즉시 전송
      }

      // 청크 수신
      return new Promise<Blob>(async (resolve, reject) => {
        const chunks = new Array<ArrayBuffer | null>(offer.totalChunks)
        let pendingSaveChunks = 0 // 저장되지 않은 청크 수
        const pendingChunksBuffer = new Map<number, ArrayBuffer>() // 배치 저장용 버퍼
        let isSaving = false // DB 저장 중 플래그

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

              case 'request-ack': {
                // 송신자가 ACK 요청 - 즉시 현재 상태 전송
                let nextChunkIndex = 0
                while (nextChunkIndex < offer.totalChunks && partialState!.receivedChunks.has(nextChunkIndex)) {
                  nextChunkIndex++
                }
                const lastContinuousIndex = nextChunkIndex - 1

                const ackMsg: AckMessage = {
                  type: 'ack',
                  receivedCount: partialState!.receivedChunks.size,
                  nextChunkIndex: nextChunkIndex,
                  lastContinuousIndex: lastContinuousIndex
                }

                if (channel.readyState === 'open') {
                  try {
                    channel.send(JSON.stringify(ackMsg))
                    console.log(`[#20-ack] ACK 요청에 응답: received=${partialState!.receivedChunks.size}, next=${nextChunkIndex}, continuous=${lastContinuousIndex}`)
                  } catch (error) {
                    console.warn(`[#20-ack] ACK 응답 전송 실패:`, error)
                  }
                }
                break
              }

              case 'complete': {
                // 모든 청크가 도착했는지 확인
                if (!isDownloadComplete(partialState!)) {
                  await saveDownloadState(partialState!)
                  reject(new Error(`청크 누락: ${partialState!.receivedChunks.size}/${offer.totalChunks}`))
                  return
                }

                // Blob 생성 - 모든 청크가 순서대로 있는지 확인 (ordered: false 환경)
                const validChunks: ArrayBuffer[] = []
                for (let i = 0; i < offer.totalChunks; i++) {
                  if (!chunks[i]) {
                    await saveDownloadState(partialState!)
                    reject(new Error(`청크 ${i}가 누락되었습니다 (받은: ${partialState!.receivedChunks.size}/${offer.totalChunks})`))
                    return
                  }
                  validChunks.push(chunks[i]!)
                }
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
                // 에러 시 최종 저장 (이어받기 가능하도록)
                if (pendingChunksBuffer.size > 0) {
                  await saveChunksBatch(offer.fileId, pendingChunksBuffer)
                  await saveDownloadState(partialState!)
                }
                channel.close()
                cleanup(connectionId)
                reject(new Error(msg.message))
                break
            }
          } else {
            // ArrayBuffer - 결합된 버퍼 (인덱스 4바이트 + 청크 데이터)
            const buffer = event.data as ArrayBuffer

            // 최소 5바이트 이상이어야 함 (인덱스 4바이트 + 데이터 최소 1바이트)
            if (buffer.byteLength < 5) {
              console.warn(`[DirectTransfer] 잘못된 버퍼 크기: ${buffer.byteLength}`)
              return
            }

            // 인덱스 추출 (첫 4바이트)
            const view = new DataView(buffer)
            const chunkIndex = view.getUint32(0, true) // 리틀 엔디안

            // Guard: 청크 인덱스 유효성 검증
            if (chunkIndex < 0 || chunkIndex >= offer.totalChunks) {
              console.warn(`[DirectTransfer] 잘못된 청크 인덱스: ${chunkIndex}`)
              return
            }

            // 중복 체크 - 중복이어도 ACK는 보내야 함 (송신자가 재전송 = ACK 못받음)
            const isDuplicate = partialState!.receivedChunks.has(chunkIndex)
            let shouldUpdate = false

            if (!isDuplicate) {
              // 데이터 추출 (4바이트 이후)
              const chunkData = buffer.slice(4)

              // 청크 저장 (메모리에만, DB 저장은 배치로)
              chunks[chunkIndex] = chunkData
              partialState!.receivedChunks.add(chunkIndex)
              partialState!.chunks.set(chunkIndex, chunkData)
              partialState!.timestamp = Date.now()

              // 배치 버퍼에 추가
              pendingChunksBuffer.set(chunkIndex, chunkData)
              pendingSaveChunks++

              // UI 업데이트 최적화: 100청크마다만 업데이트
              shouldUpdate = partialState!.receivedChunks.size % 100 === 0 || isDownloadComplete(partialState!)
              updateProgress(transferKey, partialState!.receivedChunks.size, shouldUpdate)
            } else {
              console.log(`[#20-dup] 중복 청크 수신: ${chunkIndex} - ACK는 재전송`)
            }

            // ACK 전송: 중복이든 아니든 항상 전송 (송신자가 ACK 못받아서 재전송했을 수 있음)
            // nextChunkIndex: 다음에 받고 싶은 청크 (0부터 연속으로 채운 다음 인덱스)
            let nextChunkIndex = 0
            while (nextChunkIndex < offer.totalChunks && partialState!.receivedChunks.has(nextChunkIndex)) {
              nextChunkIndex++
            }

            // lastContinuousIndex: 0부터 연속으로 받은 마지막 인덱스
            const lastContinuousIndex = nextChunkIndex - 1 // -1이면 아직 0번도 못받음

            const ackMsg: AckMessage = {
              type: 'ack',
              receivedCount: partialState!.receivedChunks.size,
              nextChunkIndex: nextChunkIndex,
              lastContinuousIndex: lastContinuousIndex
            }

            if (channel.readyState === 'open') {
              try {
                channel.send(JSON.stringify(ackMsg))
                // 타임아웃 디버깅을 위해 더 자주 로깅 (10청크마다 또는 중복일 때)
                if (isDuplicate || partialState!.receivedChunks.size % 10 === 0) {
                  console.log(`[#20-ack] ACK 전송${isDuplicate ? '(중복)' : ''}: received=${partialState!.receivedChunks.size}, next=${nextChunkIndex}, continuous=${lastContinuousIndex}`)
                }
              } catch (error) {
                console.warn(`[#20-ack] ACK 전송 실패:`, error)
              }
            }

            // 로그 최적화: 100청크마다만 출력
            if (shouldUpdate) {
              console.log(`[#20] P2P 수신: 청크 ${chunkIndex}, 총 ${partialState!.receivedChunks.size}/${offer.totalChunks} (${((partialState!.receivedChunks.size / offer.totalChunks) * 100).toFixed(0)}%)`)
            }

            // 메타데이터 저장 (10개마다) - 가볍고 빠름, 새로고침 시 이어받기 가능
            if (!isDuplicate && partialState!.receivedChunks.size % DB_SAVE_META_INTERVAL === 0) {
              saveDownloadState(partialState!).catch(err => {
                console.warn('[#20-meta] 메타데이터 저장 실패:', err)
              })
            }

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
          }
        }

        channel.onerror = async (error) => {
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
