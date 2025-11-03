import { ref } from 'vue'

interface DialogOptions {
  message: string
  type: 'alert' | 'confirm'
}

/**
 * 커스텀 다이얼로그 관리 (웹 환경용)
 * Electron 환경에서는 window.electronApi.showDialog/showConfirm 사용
 */
export function useCustomDialog() {
  const isOpen = ref(false)
  const dialogMessage = ref('')
  const dialogType = ref<'alert' | 'confirm'>('alert')
  let resolvePromise: ((value: boolean) => void) | null = null

  const showDialog = async (options: DialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      dialogMessage.value = options.message
      dialogType.value = options.type
      isOpen.value = true
      resolvePromise = resolve
    })
  }

  const confirm = () => {
    isOpen.value = false
    if (resolvePromise) {
      resolvePromise(true)
      resolvePromise = null
    }
  }

  const cancel = () => {
    isOpen.value = false
    if (resolvePromise) {
      resolvePromise(false)
      resolvePromise = null
    }
  }

  return {
    isOpen,
    dialogMessage,
    dialogType,
    showDialog,
    confirm,
    cancel
  }
}

/**
 * 플랫폼에 맞는 alert 표시
 * Electron: 새 창으로 열기
 * Web: 인라인 모달
 */
export async function showAlert(message: string): Promise<void> {
  if (window.electronApi?.showDialog) {
    await window.electronApi.showDialog(message)
  } else {
    // 웹 환경에서는 네이티브 alert 사용 (또는 전역 dialog 컴포넌트)
    alert(message)
  }
}

/**
 * 플랫폼에 맞는 confirm 표시
 * Electron: 새 창으로 열기
 * Web: 인라인 모달
 */
export async function showConfirm(message: string): Promise<boolean> {
  if (window.electronApi?.showConfirm) {
    return await window.electronApi.showConfirm(message)
  } else {
    // 웹 환경에서는 네이티브 confirm 사용 (또는 전역 dialog 컴포넌트)
    return confirm(message)
  }
}
