import { reactive, ref } from 'vue'

export interface FileTransferProgress {
  fileId: string
  fileName: string
  type: 'upload' | 'download'
  totalChunks: number
  receivedChunks: number
  totalBytes: number
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
      isComplete: false,
      startTime: Date.now(),
      isResumable: type === 'download' && isResumable,
    }
    updateCounter.value++
  }

  /**
   * 청크 수신/전송 업데이트
   */
  function updateProgress(fileId: string, receivedChunks: number) {
    const transfer = transfers[fileId]
    if (!transfer) return

    transfer.receivedChunks = receivedChunks
    updateCounter.value++
  }

  /**
   * 전송 완료
   */
  function completeTransfer(fileId: string) {
    const transfer = transfers[fileId]
    if (!transfer) return

    transfer.isComplete = true
    transfer.receivedChunks = transfer.totalChunks
    updateCounter.value++

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
    updateCounter.value++
  }

  function cancelTransfer(fileId: string) {
    const transfer = transfers[fileId]
    if (!transfer) return

    delete transfers[fileId]
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
   */
  function getProgressPercent(fileId: string) {
    void updateCounter.value // 반응성 트리거
    const transfer = transfers[fileId]
    if (!transfer) return 0
    if (transfer.totalChunks === 0) return 0
    return (transfer.receivedChunks / transfer.totalChunks) * 100
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
