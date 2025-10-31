import { isElectron, getElectronApi } from '@/util/platform'

/**
 * 플랫폼별 알림 표시를 관리하는 composable
 * - Electron: 커스텀 알림창 사용
 * - Web: 브라우저 Notification API 사용 (또는 무시)
 */
export function useNotification() {
  /**
   * 새 메시지 알림을 표시합니다
   * @param authorName 보낸 사람 이름
   * @param text 메시지 내용
   */
  const showNotification = (authorName: string, text: string) => {
    if (isElectron()) {
      // Electron 환경: 커스텀 알림창 표시
      const api = getElectronApi()
      if (api?.createNotification) {
        console.log('[useNotification] Electron 알림 표시:', { authorName, text })
        api.createNotification(authorName, text)
      } else {
        console.warn('[useNotification] Electron API가 사용 불가능합니다')
      }
    } else {
      // Web 환경: 브라우저 알림 또는 무시
      console.log('[useNotification] Web 환경 - 알림 무시:', { authorName, text })
      // 필요시 브라우저 Notification API 사용:
      // if ('Notification' in window && Notification.permission === 'granted') {
      //   new Notification(authorName, { body: text })
      // }
    }
  }

  return {
    showNotification,
  }
}
