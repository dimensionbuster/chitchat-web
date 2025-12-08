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
  windowDestroy: () => void
  openChatRoom: (roomId: string, userName?: string) => void
  showMainWindow: () => void
  // 커스텀 다이얼로그 API
  showDialog: (message: string) => Promise<void>
  showConfirm: (message: string) => Promise<boolean>
  closeDialog: (dialogId: string, result: boolean) => void
  resizeAndShowDialog: (dialogId: string, width: number, height: number) => void
  // 외부 브라우저에서 링크 열기
  openExternal: (url: string) => void
  // 배경 이미지 API
  setBackgroundImage: (type: 'home' | 'chat' | 'notification', imageData: ArrayBuffer) => Promise<boolean>
  getBackgroundImage: (type: 'home' | 'chat' | 'notification') => Promise<string | null>
  removeBackgroundImage: (type: 'home' | 'chat' | 'notification') => Promise<boolean>
  selectBackgroundImage: () => Promise<ArrayBuffer | null>
  // 설정 창 API
  openSettings: () => void
  // Watch Party API
  openWatchParty: (roomId: string, youtubeUrl?: string, userName?: string) => void
  sendWatchPartyCommand: (command: string, data: string) => void
  // 알림 소리 API
  setNotificationSound: (audioData: ArrayBuffer) => Promise<boolean>
  getNotificationSound: () => Promise<string | null>
  removeNotificationSound: () => Promise<boolean>
  selectNotificationSound: () => Promise<ArrayBuffer | null>
  setNotificationVolume: (volume: number) => Promise<void>
  getNotificationVolume: () => Promise<number>
  setNotificationEnabled: (enabled: boolean) => Promise<void>
  getNotificationEnabled: () => Promise<boolean>
  // 업데이트 API
  checkForUpdates: () => Promise<{
    available: boolean
    message: string
    currentVersion: string
    latestVersion: string | null
    releaseUrl: string | null
  }>
  getAppVersion: () => Promise<string>
}

// YouTube IFrame API 타입
declare global {
  interface Window {
    electronApi?: ElectronApi
    YT: typeof YT
    onYouTubeIframeAPIReady: () => void
  }

  namespace YT {
    class Player {
      constructor(elementId: string, options: PlayerOptions)
      playVideo(): void
      pauseVideo(): void
      seekTo(seconds: number, allowSeekAhead: boolean): void
      getCurrentTime(): number
      loadVideoById(videoId: string): void
      destroy(): void
      getIframe(): HTMLIFrameElement
    }

    interface PlayerOptions {
      height?: string | number
      width?: string | number
      videoId?: string
      host?: string
      playerVars?: PlayerVars
      events?: PlayerEvents
    }

    interface PlayerVars {
      autoplay?: 0 | 1
      controls?: 0 | 1
      rel?: 0 | 1
      modestbranding?: 0 | 1
      iv_load_policy?: 1 | 3
      fs?: 0 | 1
      mute?: 0 | 1
      playsinline?: 0 | 1
      disablekb?: 0 | 1
      cc_load_policy?: 0 | 1
      origin?: string
      enablejsapi?: 0 | 1
      showinfo?: 0 | 1
      forigin?: string
      aoriginsup?: 0 | 1
      vf?: number
    }

    interface PlayerEvents {
      onReady?: (event: PlayerEvent) => void
      onStateChange?: (event: OnStateChangeEvent) => void
      onError?: (event: OnErrorEvent) => void
    }

    interface PlayerEvent {
      target: Player
    }

    interface OnStateChangeEvent {
      target: Player
      data: number
    }

    interface OnErrorEvent {
      target: Player
      data: number
    }

    const PlayerState: {
      ENDED: number
      PLAYING: number
      PAUSED: number
      BUFFERING: number
      CUED: number
    }
  }
}

export {}
