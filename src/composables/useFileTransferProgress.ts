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
    isResumable = true, // 기본적으로 다운로드는 이어받기 가능
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
      isResumable: type === 'download' && isResumable, // 다운로드만 이어받기 지원
    }
    updateCounter.value++
    console.log(`[Progress] ${type} 시작: ${fileName} (${totalChunks} 청크)`)
  }

  /**
   * 청크 수신/전송 업데이트
   */
  function updateProgress(fileId: string, receivedChunks: number) {
    const transfer = transfers[fileId]
    if (!transfer) return

    transfer.receivedChunks = receivedChunks
    updateCounter.value++

    // 10% 단위로만 로그 출력 (로그 스팸 방지)
    const progress = (receivedChunks / transfer.totalChunks) * 100
    if (receivedChunks % Math.ceil(transfer.totalChunks / 10) === 0) {
      console.log(`[Progress] ${transfer.type} 진행: ${transfer.fileName} ${progress.toFixed(1)}%`)
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
    updateCounter.value++

    const elapsed = Date.now() - transfer.startTime
    const speed = (transfer.totalBytes / 1024 / 1024 / (elapsed / 1000)).toFixed(2)

    console.log(
      `[Progress] ✅ ${transfer.type} 완료: ${transfer.fileName} (${elapsed}ms, ${speed}MB/s)`,
    )

    // 3초 후 목록에서 제거
    setTimeout(() => {
      delete transfers[fileId]
      updateCounter.value++
    }, 3000)
  }

  /**
   * 전송 실패
   */
  function failTransfer(fileId: string) {
    const transfer = transfers[fileId]
    if (!transfer) return

    console.error(`[Progress] ❌ ${transfer.type} 실패: ${transfer.fileName}`)

    // 즉시 제거
    delete transfers[fileId]
    updateCounter.value++
  }

  /**
   * 전송 취소
   */
  function cancelTransfer(fileId: string) {
    const transfer = transfers[fileId]
    if (!transfer) return

    console.warn(`[Progress] 🚫 ${transfer.type} 취소: ${transfer.fileName}`)

    // 즉시 제거
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

  return {
    transfers, // reactive Record
    startTransfer,
    updateProgress,
    completeTransfer,
    failTransfer,
    cancelTransfer,
    getProgress,
    getProgressPercent,
    isTransferring,
  }
}
