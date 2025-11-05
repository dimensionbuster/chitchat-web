/**
 * useFileTransfer
 *
 * 파일 전송 총괄 관리자 (오케스트레이터)
 * - 파일 크기에 따라 전송 방식 자동 선택
 *   · 256KB 미만: Yjs awareness + YMap 전송
 *   · 256KB 이상: WebRTC DataChannel 직접 전송
 * - 업로드 큐 관리 (동시 전송 제한)
 * - 청크 availability 추적
 * - 이어받기 지원
 */

import { ref } from 'vue'
import type { WebrtcProvider } from 'y-webrtc'
import type { Map as YMap } from 'yjs'
import type { FileMeta, PartialDownloadState } from '@/types/types'
import { getCachedFile, cacheFile } from './useStorageFileCache'
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/util/base64'
import { useFileTransferProgress } from './useFileTransferProgress'
import { useFileTransferState } from './useFileTransferState'
import { useDirectFileTransfer } from './useDirectFileTransfer'
import type { FileTransferOffer } from './useWebrtcConnection'
import { FILE_DATA_THRESHOLD } from './fileConstants'
import {
  useGlobalDataChannelQueue,
  createFileTransferJob,
  DataChannelPriority
} from './useGlobalDataChannelQueue'

type FileRequest = {
  fileId: string
  requesterUuid: string
  timestamp: number
  receivedChunks?: number[]
  targetUuid?: string  // 지정된 발신자 (없으면 브로드캐스트)
}

type FileResponse = {
  fileId: string
  targetUuid: string
  timestamp: number
  totalChunks: number
  chunkSize: number
}

const TIMEOUT = 5000
const CHUNK_TIMEOUT = 60000

export function useFileTransfer(
  provider: WebrtcProvider,
  files: YMap<FileMeta>,
  myUuid: string,
  requestFile: (fileId: string, requesterUuid: string, receivedChunks?: number[], targetUuid?: string) => void,
  respondFile: (fileId: string, fileData: string, targetUuid: string, skipChunks?: number[], onComplete?: () => void) => void,
  getTransferMap: (key: string) => YMap<string>,
) {
  const processedRequests = ref(new Set<string>())
  const { startTransfer, updateProgress, completeTransfer } = useFileTransferProgress()
  const isConnected = ref(true)

  // 글로벌 큐 매니저 초기화
  const {
    enqueue,
    cancelJob,
    setProvider,
    stats: queueStats,
    queueState
  } = useGlobalDataChannelQueue()

  // Provider 등록
  setProvider(provider)

  // 내가 보유한 파일 목록 (awareness 브로드캐스트용)
  const myFileOwnership = ref(new Set<string>())

  // 직접 전송 모듈 초기화
  const filesMap = new Map<string, FileMeta>()
  files.observe(() => {
    filesMap.clear()
    files.forEach((value, key) => {
      filesMap.set(key, value)
    })
  })
  files.forEach((value, key) => {
    filesMap.set(key, value)
  })
  const { sendFileViaQueue, receiveFileDirect } = useDirectFileTransfer(provider, myUuid, filesMap)

  // awareness에 파일 소유 정보 업데이트
  const updateFileOwnership = (fileId: string) => {
    myFileOwnership.value.add(fileId)
    provider.awareness.setLocalStateField('ownedFiles', Array.from(myFileOwnership.value))
  }

  // 파일을 가진 피어 중 큐가 가장 짧은 피어 찾기
  const findBestSender = (fileId: string): string | null => {
    const peers: Array<{ uuid: string; queueLength: number }> = []

    for (const [, state] of provider.awareness.getStates()) {
      const stateObj = state as Record<string, unknown>
      const userUuid = stateObj.userUuid as string | undefined
      const ownedFiles = stateObj.ownedFiles as string[] | undefined

      if (!userUuid || userUuid === myUuid || !ownedFiles) continue
      if (!ownedFiles.includes(fileId)) continue

      // 해당 파일을 가진 피어의 큐 길이 확인
      // (awareness에서 실시간으로 가져올 수 없으므로 기본값 0 사용)
      peers.push({
        uuid: userUuid,
        queueLength: 0, // 실제로는 awareness에 추가로 전달할 수 있음
      })
    }

    if (peers.length === 0) return null

    // 랜덤하게 선택 (여러 피어에 분산)
    return peers[Math.floor(Math.random() * peers.length)]?.uuid || null
  }

  provider.on('status', (event: { connected: boolean }) => {
    const wasConnected = isConnected.value
    isConnected.value = event.connected

    if (event.connected && !wasConnected) {
      setupFileRequestListener()
      // 연결 복구 시 중단된 다운로드 재개
      resumeInterruptedDownloads()
    }
  })

  /**
   * 중단된 다운로드 재개
   */
  async function resumeInterruptedDownloads() {
    const { getAllDownloadStates } = useFileTransferState()
    const interruptedDownloads = await getAllDownloadStates()

    if (interruptedDownloads.length === 0) return

    console.log(`[FileTransfer] 중단된 다운로드 ${interruptedDownloads.length}개 발견`)

    for (const state of interruptedDownloads) {
      try {
        // 파일 메타가 있는지 확인
        const meta = files.get(state.fileId)
        if (!meta) {
          console.warn(`[FileTransfer] 파일 메타 없음: ${state.fileId}`)
          continue
        }

        console.log(`[FileTransfer] 다운로드 재개: ${state.fileName} (${state.receivedChunks.size}/${state.totalChunks} 청크)`)

        // 다운로드 재시도 (백그라운드에서)
        requestFileP2P(state.fileId).catch(error => {
          console.error(`[FileTransfer] 재개 실패: ${state.fileId}`, error)
        })
      } catch (error) {
        console.error(`[FileTransfer] 재개 처리 오류:`, error)
      }
    }
  }

  async function handleFileRequest(fileId: string, requesterUuid: string, receivedChunks: number[]) {
    const cachedBlob = await getCachedFile(fileId)
    if (!cachedBlob) return

    const meta = files.get(fileId)

    // FILE_DATA_THRESHOLD (256KB) 이상이면 글로벌 큐를 통한 직접 P2P 전송
    if (cachedBlob.size >= FILE_DATA_THRESHOLD) {
      try {
        await sendFileViaQueue(fileId, requesterUuid)
      } catch (error) {
        console.error(`[FileTransfer] 전송 실패:`, error)
      }
      return
    }

    // FILE_DATA_THRESHOLD (256KB) 미만이면 Yjs 전송 (큐 사용하지 않음)
    const base64 = arrayBufferToBase64(await cachedBlob.arrayBuffer())

    // 파일 크기에 따라 우선순위 결정
    let priority = DataChannelPriority.NORMAL
    if (cachedBlob.size < 50 * 1024) {
      priority = DataChannelPriority.HIGH // 50KB 미만은 높은 우선순위
    }

    // 작은 파일도 큐에 추가 (일관성 유지)
    const job = createFileTransferJob(
      fileId,
      meta?.name || fileId,
      requesterUuid,
      cachedBlob.size,
      priority,
      async () => {
        return new Promise<void>((resolve) => {
          respondFile(fileId, base64, requesterUuid, receivedChunks, () => {
            resolve()
          })
        })
      }
    )

    enqueue(job)
  }

  function setupFileRequestListener() {
    // 초기 파일 등록: 캐시된 파일들을 awareness에 브로드캐스트
    ;(async () => {
      for (const [fileId] of files.entries()) {
        const cached = await getCachedFile(fileId)
        if (cached) {
          updateFileOwnership(fileId)
        }
      }
      console.log(`[FileTransfer] 초기 파일 소유권 등록 완료: ${myFileOwnership.value.size}개`)
    })()

    provider.awareness.on('change', async () => {
      for (const [, state] of provider.awareness.getStates()) {
        const request = state.fileRequest as FileRequest | undefined

        // Guard: 요청이 없거나 내가 요청한 경우 스킵
        if (!request || request.requesterUuid === myUuid) continue

        // Guard: 타겟이 지정되어 있는데 내가 아닌 경우 스킵
        if (request.targetUuid && request.targetUuid !== myUuid) continue

        // Guard: 이미 처리한 요청인 경우 스킵
        const requestId = `${request.fileId}-${request.requesterUuid}-${request.timestamp}`
        if (processedRequests.value.has(requestId)) continue

        processedRequests.value.add(requestId)
        setTimeout(() => processedRequests.value.delete(requestId), 5000)

        console.log(`[FileTransfer] 파일 요청 처리: ${request.fileId} from ${request.requesterUuid.slice(-8)}`)
        await handleFileRequest(request.fileId, request.requesterUuid, request.receivedChunks || [])
      }
    })
  }

  async function waitForFileResponse(fileId: string, timeout: number): Promise<Blob> {
    const { loadDownloadState, saveDownloadState, isComplete: isDownloadComplete } = useFileTransferState()

    let state = await loadDownloadState(fileId)
    if (state) {
      const meta = files.get(fileId)
      startTransfer(fileId, meta?.name || fileId, 'download', state.totalChunks, state.totalBytes)
      updateProgress(fileId, state.receivedChunks.size)

      if (isDownloadComplete(state)) {
        return await completeAndCache(state, meta?.type)
      }
    }

    return new Promise<Blob>((resolve, reject) => {
      let resolved = false

      const saveProgress = async () => {
        if (state) {
          await saveDownloadState(state).catch(console.error)
        }
      }

      const connectionHandler = (event: { connected: boolean }) => {
        if (!event.connected && !resolved) {
          resolved = true
          cleanup()
          saveProgress()
          reject(new Error('연결 끊김'))
        }
      }

      const peersChangeHandler = (event: { removed: string[]; webrtcPeers?: string[] }) => {
        if (event.removed.length > 0 && !resolved && (event.webrtcPeers?.length || 0) === 0) {
          resolved = true
          cleanup()
          saveProgress()
          reject(new Error('피어 연결 끊김'))
        }
      }

      provider.on('status', connectionHandler)
      provider.on('peers', peersChangeHandler)

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          console.error(`[FileTransfer] 타임아웃: ${fileId}`)
          saveProgress()
          reject(new Error('타임아웃'))
        }
      }, timeout)

      const handler = () => {
        // Guard: 이미 처리된 경우
        if (resolved) return

        for (const [, awareState] of provider.awareness.getStates()) {
          const response = awareState.fileResponse as FileResponse | undefined

          // Guard: 응답이 없거나 조건에 맞지 않으면 스킵
          if (!response || response.fileId !== fileId || response.targetUuid !== myUuid || resolved) continue

          // 응답 처리 시작
          resolved = true
          cleanup()

          const meta = files.get(fileId)
          const totalBytes = meta?.size || response.totalChunks * response.chunkSize

          // 상태 초기화 또는 업데이트
          if (!state) {
            startTransfer(fileId, meta?.name || fileId, 'download', response.totalChunks, totalBytes)
            state = {
              fileId,
              fileName: meta?.name || fileId,
              totalChunks: response.totalChunks,
              chunkSize: response.chunkSize,
              totalBytes,
              receivedChunks: new Set(),
              chunks: new Map(),
              timestamp: Date.now(),
              transferKey: `transfer-${fileId}-${response.timestamp}`,
            }
          } else {
            state.transferKey = `transfer-${fileId}-${response.timestamp}`
          }

          receiveChunks(state, response, meta?.type).then(resolve).catch(reject)
          return
        }
      }

      const cleanup = () => {
        clearTimeout(timer)
        provider.awareness.off('change', handler)
        provider.off('status', connectionHandler)
        provider.off('peers', peersChangeHandler)
      }

      provider.awareness.on('change', handler)
      handler()
    })
  }

  function receiveChunks(state: PartialDownloadState, response: FileResponse, fileType?: string): Promise<Blob> {
    const { saveDownloadState, deleteDownloadState, addChunk, isComplete } = useFileTransferState()

    return new Promise((resolve, reject) => {
      const transferMap = getTransferMap(state.transferKey)
      const timeout = setTimeout(() => {
        console.error(`[FileTransfer] 청크 타임아웃: ${state.receivedChunks.size}/${response.totalChunks}`)
        saveDownloadState(state).catch(console.error)
        reject(new Error('청크 타임아웃'))
      }, CHUNK_TIMEOUT)

      const chunks = new Array<ArrayBuffer>(response.totalChunks)

      const checkAndComplete = async () => {
        // Guard: 전송이 완료되지 않았으면 리턴
        if (!transferMap.get('complete')) return

        // 모든 청크 수집
        for (let i = 0; i < response.totalChunks; i++) {
          if (!state.receivedChunks.has(i)) {
            const chunk = transferMap.get(`chunk-${i}`)
            if (chunk) {
              // Yjs에서 온 base64 문자열을 ArrayBuffer로 변환
              const arrayBuffer = base64ToArrayBuffer(chunk as string)
              addChunk(state, i, arrayBuffer)
              chunks[i] = arrayBuffer
            }
          } else if (!chunks[i]) {
            chunks[i] = state.chunks.get(i)!
          }
        }

        // Guard: 모든 청크가 도착하지 않았으면 리턴
        if (!isComplete(state)) return

        // 완료 처리 (DB에서 삭제)
        clearTimeout(timeout)
        const blob = await completeAndCache(state, fileType)
        await deleteDownloadState(state.fileId)
        resolve(blob)
      }

      let pendingSaveChunks = 0
      let isSaving = false

      transferMap.observe(() => {
        for (let i = 0; i < response.totalChunks; i++) {
          if (state.receivedChunks.has(i)) continue

          const chunk = transferMap.get(`chunk-${i}`)
          if (chunk) {
            // Yjs에서 온 base64 문자열을 ArrayBuffer로 변환
            const arrayBuffer = base64ToArrayBuffer(chunk as string)
            addChunk(state, i, arrayBuffer)
            chunks[i] = arrayBuffer

            // UI 업데이트 최적화: 10청크마다만 UI 업데이트 (작은 파일이므로 더 자주)
            const shouldUpdate = state.receivedChunks.size % 10 === 0
            updateProgress(state.fileId, state.receivedChunks.size, shouldUpdate)

            // 청크 기반 저장 (Yjs는 작은 파일이므로 50개마다)
            pendingSaveChunks++
            if (pendingSaveChunks >= 50 && !isSaving) {
              isSaving = true
              pendingSaveChunks = 0
              saveDownloadState(state).then(() => {
                isSaving = false
              }).catch((err) => {
                isSaving = false
                console.error('[FileTransfer] DB 저장 실패:', err)
              })
            }
          }
        }
        checkAndComplete()
      })

      checkAndComplete()
    })
  }

  async function completeAndCache(state: PartialDownloadState, fileType?: string): Promise<Blob> {
    const { mergeChunks } = useFileTransferState()
    const arrayBuffer = mergeChunks(state)
    const blob = new Blob([arrayBuffer], { type: fileType || 'application/octet-stream' })

    await cacheFile(state.fileId, blob)
    completeTransfer(state.fileId)

    // 파일 다운로드 완료 - 소유권 브로드캐스트
    updateFileOwnership(state.fileId)

    return blob
  }

  async function requestFileP2P(fileId: string): Promise<Blob> {
    const meta = files.get(fileId)
    if (!meta || !meta.size) {
      throw new Error('파일 메타데이터 없음')
    }

    // FILE_DATA_THRESHOLD (256KB) 미만이면 Yjs 방식
    if (meta.size < FILE_DATA_THRESHOLD) {
      const { loadDownloadState } = useFileTransferState()
      const partialState = await loadDownloadState(fileId)
      const receivedChunks = partialState ? Array.from(partialState.receivedChunks) : []

      // 최적의 발신자 선택
      const bestSender = findBestSender(fileId)

      // 타겟을 지정하여 요청 (일대일)
      requestFile(fileId, myUuid, receivedChunks as number[], bestSender || undefined)
      return await waitForFileResponse(fileId, TIMEOUT)
    }

    // FILE_DATA_THRESHOLD (256KB) 이상이면 직접 P2P
    const bestSender = findBestSender(fileId)
    if (!bestSender) {
      throw new Error('파일을 가진 피어를 찾을 수 없습니다')
    }

    console.log(`[FileTransfer] 최적 발신자 선택: ${bestSender.slice(-8)}`)

    // 타겟을 지정하여 요청 (일대일)
    console.log(`[FileTransfer] P2P 다운로드 요청: ${fileId} → ${bestSender.slice(-8)}`)

    // Offer 대기 및 수신
    return new Promise<Blob>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('파일 전송 타임아웃'))
      }, TIMEOUT)

      const handler = async () => {
        for (const [, state] of provider.awareness.getStates()) {
          const stateObj = state as Record<string, unknown>

          // 🔥 모든 'fileTransferOffer-'로 시작하는 키 탐색
          for (const key in stateObj) {
            if (!key.startsWith('fileTransferOffer-')) continue

            const transferOffer = stateObj[key] as FileTransferOffer | undefined

            // Guard: Offer가 없거나 조건에 맞지 않으면 스킵
            if (!transferOffer) continue
            if (transferOffer.fileId !== fileId) continue
            if (transferOffer.targetUuid !== myUuid) continue
            if (transferOffer.senderUuid !== bestSender) continue // 선택된 발신자인지 확인

            console.log(`[FileTransfer] Offer 감지: ${key}`)

            // Offer 처리
            clearTimeout(timeout)
            cleanup()

            try {
              const blob = await receiveFileDirect(transferOffer)
              resolve(blob)
            } catch (error) {
              reject(error)
            }
            return
          }
        }
      }

      const cleanup = () => {
        clearTimeout(timeout)
        provider.awareness.off('change', handler)
      }

      provider.awareness.on('change', handler)
      // 타겟 지정하여 요청
      requestFile(fileId, myUuid, [], bestSender)
      handler()
    }).then(async (blob) => {
      // P2P 다운로드 완료 후 파일 소유권 브로드캐스트
      updateFileOwnership(fileId)
      console.log(`[FileTransfer] P2P 다운로드 완료 후 소유권 브로드캐스트: ${fileId}`)
      return blob
    })
  }

  // 외부에서 파일 캐시 완료 시 호출 (예: 업로드 후)
  const registerFileAvailability = async (fileId: string) => {
    const cachedBlob = await getCachedFile(fileId)
    if (!cachedBlob) return

    updateFileOwnership(fileId)
  }

  // 현재 전송 상태 정보 (글로벌 큐 통계 사용)
  const getUploadStats = () => ({
    activeCount: queueStats.activeJobs,
    queuedCount: queueStats.queuedJobs,
    maxConcurrent: queueState.value.maxConcurrent,
    totalJobs: queueStats.totalJobs,
    completedJobs: queueStats.completedJobs,
    failedJobs: queueStats.failedJobs,
    totalBytesSent: queueStats.totalBytesSent,
    averageSpeed: queueStats.averageSpeed,
  })

  return {
    setupFileRequestListener,
    requestFileP2P,
    registerFileAvailability,
    getUploadStats,
    queueStats,     // 글로벌 큐 통계
    queueState,     // 글로벌 큐 상태
    cancelJob,      // 작업 취소
  }
}
