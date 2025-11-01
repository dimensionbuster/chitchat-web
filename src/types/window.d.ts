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
}

declare global {
  interface Window {
    electronApi?: ElectronApi
  }
}

export {}
