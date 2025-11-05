// Electron API 타입 정의 (Electron 환경에서만 사용 가능)
export interface ElectronApi {
  newChatMessage: (payload: { authorName: string; text: string; messageId: string }) => void
  createNotification: (authorName: string, text: string, messageId: string, roomId: string) => void
  closeNotification: (id: string) => void
  clickNotification: (roomId: string, userName?: string) => void
  sendLogMessage: (level: 'info' | 'warn' | 'error', message: string) => void
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  openChatRoom: (roomId: string, userName?: string) => void
  showMainWindow: () => void
  // 커스텀 다이얼로그 API
  showDialog: (message: string) => Promise<void>
  showConfirm: (message: string) => Promise<boolean>
  closeDialog: (dialogId: string, result: boolean) => void
  resizeAndShowDialog: (dialogId: string, width: number, height: number) => void
  // 외부 브라우저에서 링크 열기
  openExternal: (url: string) => void
}

declare global {
  interface Window {
    electronApi?: ElectronApi
  }
}

export {}
