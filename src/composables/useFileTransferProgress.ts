import { reactive, ref } from 'vue'

export interface FileTransferProgress {
  fileId: string
  fileName: string
  type: 'upload' | 'download'
  totalChunks: number
  receivedChunks: number
  totalBytes: number
  receivedBytes: number // 실제 받은 바이트 (동적 청크 크기 대응)
  isComplete: boolean
  startTime: number
  isResumable: boolean // 이어받기 가능 여부
}

// 전역 상태: 모든 파일 전송 진행 상태
// Map 대신 Record를 사용하여 Vue의 반응성을 더 확실하게
const transfers = reactive<Record<string, FileTransferProgress>>({})

// 변경 트리거용 카운터 (강제 리렌더링)
const updateCounter = ref(0)

// 업로드 큐 정보 (전역 상태)
const uploadQueueInfo = reactive({
  activeCount: 0,
  queuedCount: 0,
  maxConcurrent: 2,
})

// UI 업데이트 쓰로틀링 (렉 방지)
const UI_UPDATE_THROTTLE = 300 // 300ms마다만 UI 업데이트
const lastUIUpdate = new Map<string, number>() // fileId -> timestamp

/**
 * 파일 전송 진척도를 추적하는 composable
 */
export function useFileTransferProgress() {
  /**
   * 새로운 파일 전송 시작
   */
  function startTransfer(
    fileId: string,
    fileName: string,
    type: 'upload' | 'download',
    totalChunks: number,
    totalBytes: number,
    isResumable = true,
  ) {
    transfers[fileId] = {
      fileId,
      fileName,
      type,
      totalChunks,
      receivedChunks: 0,
      totalBytes,
      receivedBytes: 0,
      isComplete: false,
      startTime: Date.now(),
      isResumable: type === 'download' && isResumable,
    }
    updateCounter.value++
  }

  /**
   * 청크 수신/전송 업데이트 (쓰로틀링 적용)
   */
  function updateProgress(fileId: string, receivedChunks: number, forceUpdate = false, receivedBytes?: number) {
    const transfer = transfers[fileId]
    if (!transfer) return

    // 진행 상태는 항상 업데이트 (내부 상태)
    transfer.receivedChunks = receivedChunks
    if (receivedBytes !== undefined) {
      transfer.receivedBytes = receivedBytes
    }

    // UI 업데이트는 쓰로틀링 (렉 방지)
    const now = Date.now()
    const lastUpdate = lastUIUpdate.get(fileId) || 0
    const shouldUpdateUI = forceUpdate || (now - lastUpdate) >= UI_UPDATE_THROTTLE

    if (shouldUpdateUI) {
      updateCounter.value++
      lastUIUpdate.set(fileId, now)
    }
  }

  /**
   * 전송 완료
   */
  function completeTransfer(fileId: string) {
    const transfer = transfers[fileId]
    if (!transfer) return

    transfer.isComplete = true
    transfer.receivedChunks = transfer.totalChunks
    transfer.receivedBytes = transfer.totalBytes
    updateCounter.value++
    lastUIUpdate.delete(fileId) // 완료 시 쓰로틀 타이머 제거

    // 완료된 전송은 5초 후에 제거 (큐 UI가 사라지지 않도록)
    setTimeout(() => {
      delete transfers[fileId]
      updateCounter.value++
    }, 5000)
  }

  function failTransfer(fileId: string) {
    const transfer = transfers[fileId]
    if (!transfer) return

    delete transfers[fileId]
    lastUIUpdate.delete(fileId) // 쓰로틀 타이머 제거
    updateCounter.value++
  }

  function cancelTransfer(fileId: string) {
    const transfer = transfers[fileId]
    if (!transfer) return

    delete transfers[fileId]
    lastUIUpdate.delete(fileId) // 쓰로틀 타이머 제거
    updateCounter.value++
  }

  /**
   * 특정 파일의 전송 상태 가져오기
   */
  function getProgress(fileId: string) {
    // updateCounter를 참조하여 반응성 확보
    void updateCounter.value // 이 줄이 반응성을 트리거
    return transfers[fileId]
  }

  /**
   * 특정 파일의 진행률 (0-100%)
   * 동적 청크 크기를 위해 bytes 기반으로 계산
   */
  function getProgressPercent(fileId: string) {
    void updateCounter.value // 반응성 트리거
    const transfer = transfers[fileId]
    if (!transfer) return 0
    if (transfer.totalBytes === 0) return 0
    // 100%를 초과하지 않도록 상한 적용 (마지막 청크 크기 오차 방지)
    return Math.min((transfer.receivedBytes / transfer.totalBytes) * 100, 100)
  }

  /**
   * 특정 파일이 전송 중인지 확인
   */
  function isTransferring(fileId: string) {
    const transfer = transfers[fileId]
    return !!transfer && !transfer.isComplete
  }

  /**
   * 업로드 큐 상태 업데이트 (useFileTransfer에서 호출)
   */
  function updateUploadQueue(activeCount: number, queuedCount: number, maxConcurrent = 2) {
    uploadQueueInfo.activeCount = activeCount
    uploadQueueInfo.queuedCount = queuedCount
    uploadQueueInfo.maxConcurrent = maxConcurrent
  }

  return {
    transfers, // reactive Record
    uploadQueueInfo, // 업로드 큐 정보
    startTransfer,
    updateProgress,
    completeTransfer,
    failTransfer,
    cancelTransfer,
    getProgress,
    getProgressPercent,
    isTransferring,
    updateUploadQueue,
  }
}
