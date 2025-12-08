/**
 * Style Settings Management Composable
 * - Store/load style settings in IndexedDB
 * - Container opacity, background overlay opacity, etc.
 * - Real-time sync between windows via BroadcastChannel
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { COLOR_TEMPLATES, DEFAULT_COLORS } from './colorTemplates'
import type { ColorTemplate } from './colorTemplates'
import { createLogger } from '@/util/logger'

const log = createLogger('StyleSettings')

// Re-export for convenience
export { COLOR_TEMPLATES, DEFAULT_COLORS }
export type { ColorTemplate }

// Debounce utility
function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

// 설정 타입 정의
export interface ColorSettings {
  // 그라데이션 색상
  gradientStart: string
  gradientMid: string
  gradientEnd: string
  // 메인 색상
  colorPrimary: string
  colorPrimaryHover: string
  colorPrimaryLight: string
  colorSecondary: string
  colorAccent: string
  // 배경 색상
  bgPrimary: string
  bgSecondary: string
  // 텍스트 색상
  textPrimary: string
  textSecondary: string
  textMuted: string
}

export interface StyleSettings {
  // 컨테이너 투명도 (0 = 완전 투명, 1 = 완전 불투명)
  containerOpacity: {
    home: number
    chat: number
  }
  // 배경 오버레이 투명도 (0 = 오버레이 없음, 1 = 완전히 덮음)
  backgroundOverlay: {
    home: number
    chat: number
    notification: number
  }
  // 배경 블러 효과 (0 = 블러 없음, 20 = 최대 블러)
  backgroundBlur: {
    home: number
    chat: number
  }
  // 색상 설정
  colors: ColorSettings
}

// 기본 설정값
const DEFAULT_SETTINGS: StyleSettings = {
  containerOpacity: {
    home: 0.85,
    chat: 0.85
  },
  backgroundOverlay: {
    home: 0.75,
    chat: 0.75,
    notification: 0.6
  },
  backgroundBlur: {
    home: 20,
    chat: 10
  },
  colors: { ...DEFAULT_COLORS }
}

// IndexedDB 상수
const DB_NAME = 'chitchat-style-settings'
const DB_VERSION = 1
const STORE_NAME = 'settings'
const SETTINGS_KEY = 'styleSettings'

// BroadcastChannel for cross-window communication
const CHANNEL_NAME = 'chitchat-style-settings-channel'
let broadcastChannel: BroadcastChannel | null = null

// 전역 상태 (싱글톤)
const settings = ref<StyleSettings>(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
const isLoaded = ref(false)
const isLoading = ref(false)

// CSS 변수 업데이트 함수
function applyCSSVariables(s: StyleSettings) {
  const root = document.documentElement
  // 투명도 설정
  root.style.setProperty('--container-opacity', String(s.containerOpacity.chat))
  root.style.setProperty('--container-opacity-home', String(s.containerOpacity.home))
  root.style.setProperty('--container-opacity-chat', String(s.containerOpacity.chat))
  root.style.setProperty('--bg-overlay-opacity', String(s.backgroundOverlay.chat))
  root.style.setProperty('--bg-overlay-opacity-home', String(s.backgroundOverlay.home))
  root.style.setProperty('--bg-overlay-opacity-chat', String(s.backgroundOverlay.chat))
  root.style.setProperty('--bg-overlay-opacity-notification', String(s.backgroundOverlay.notification))
  // 블러 설정
  root.style.setProperty('--bg-blur-home', `${s.backgroundBlur.home}px`)
  root.style.setProperty('--bg-blur-chat', `${s.backgroundBlur.chat}px`)

  // 색상 설정
  if (s.colors) {
    root.style.setProperty('--gradient-start', s.colors.gradientStart)
    root.style.setProperty('--gradient-mid', s.colors.gradientMid)
    root.style.setProperty('--gradient-end', s.colors.gradientEnd)
    root.style.setProperty('--color-primary', s.colors.colorPrimary)
    root.style.setProperty('--color-primary-hover', s.colors.colorPrimaryHover)
    root.style.setProperty('--color-primary-light', s.colors.colorPrimaryLight)
    root.style.setProperty('--color-secondary', s.colors.colorSecondary)
    root.style.setProperty('--color-accent', s.colors.colorAccent)
    root.style.setProperty('--bg-primary', s.colors.bgPrimary)
    root.style.setProperty('--bg-secondary', s.colors.bgSecondary)
    root.style.setProperty('--text-primary', s.colors.textPrimary)
    root.style.setProperty('--text-secondary', s.colors.textSecondary)
    root.style.setProperty('--text-muted', s.colors.textMuted)
    // RGB 값도 업데이트 (rgba 사용을 위해)
    root.style.setProperty('--color-primary-rgb', hexToRgb(s.colors.colorPrimary))

    // 파생 색상들 (기존 변수들과 호환성 유지)
    root.style.setProperty('--bg-tertiary', adjustBrightness(s.colors.bgSecondary, -5))
    // bg-card: 투명도 적용된 카드 배경 (배경 이미지가 비쳐보임)
    root.style.setProperty('--bg-card', `rgba(${hexToRgb(s.colors.bgPrimary)}, var(--container-opacity-chat, 0.85))`)
    // bg-card-solid: 완전 불투명 카드 배경 (팝업, 드롭다운 등)
    root.style.setProperty('--bg-card-solid', s.colors.bgPrimary)
    root.style.setProperty('--bg-input', s.colors.bgPrimary)
    root.style.setProperty('--text-tertiary', s.colors.textMuted)
    root.style.setProperty('--border-light', `rgba(${hexToRgb(s.colors.colorPrimary)}, 0.15)`)
    root.style.setProperty('--border-default', `rgba(${hexToRgb(s.colors.colorPrimary)}, 0.25)`)
    // 오버레이용 RGB 값 (다크모드 대응)
    root.style.setProperty('--bg-primary-rgb', hexToRgb(s.colors.bgPrimary))

    // 알림창 전용 변수
    root.style.setProperty('--notification-bg', `linear-gradient(135deg, ${addAlpha(s.colors.gradientStart, 0.95)} 0%, ${addAlpha(s.colors.gradientEnd, 0.95)} 100%)`)
    root.style.setProperty('--notification-border', `rgba(${hexToRgb(s.colors.colorPrimary)}, 0.3)`)
    root.style.setProperty('--color-secondary-light', adjustBrightness(s.colors.colorSecondary, 30))
  }
}

// HEX 색상에 알파값 추가
function addAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  return `rgba(${rgb}, ${alpha})`
}

// HEX 밝기 조절 함수
function adjustBrightness(hex: string, percent: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result || !result[1] || !result[2] || !result[3]) return hex

  let r = parseInt(result[1], 16)
  let g = parseInt(result[2], 16)
  let b = parseInt(result[3], 16)

  r = Math.max(0, Math.min(255, r + Math.round(r * percent / 100)))
  g = Math.max(0, Math.min(255, g + Math.round(g * percent / 100)))
  b = Math.max(0, Math.min(255, b + Math.round(b * percent / 100)))

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// HEX to RGB 변환 함수
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (result && result[1] && result[2] && result[3]) {
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
  }
  return '156, 124, 181' // 기본값
}

// 다른 창에 설정 변경 알림
function broadcastSettingsChange(newSettings: StyleSettings) {
  // Vue reactive 객체를 plain object로 변환
  const plainSettings = JSON.parse(JSON.stringify(newSettings))

  if (broadcastChannel) {
    // BroadcastChannel을 통한 전송 (file:// 프로토콜)
    broadcastChannel.postMessage({ type: 'settings-updated', settings: plainSettings })
  }

  // 로컬 서버에서 실행 중이면 main process를 통해 다른 창에 알림
  if (isRunningOnLocalServer()) {
    syncSettingsToMain(plainSettings).then(() => {
      log.debug('Settings broadcasted via main process')
    })
  }
}

// 배경 이미지 변경 알림
function broadcastBackgroundChange(bgType: string) {
  if (broadcastChannel) {
    broadcastChannel.postMessage({ type: 'background-updated', backgroundType: bgType })
  }

  // 로컬 서버에서 실행 중이면 main process를 통해 알림
  // (main process가 다른 창들에 background-changed 이벤트를 발송해야 함)
  if (isRunningOnLocalServer()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronApi = (window as any).electronApi
    if (electronApi?.notifyBackgroundChanged) {
      electronApi.notifyBackgroundChanged(bgType)
    }
  }
}

// IndexedDB init
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      log.error('Failed to open IndexedDB:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        log.debug('Created IndexedDB store')
      }
    }
  })
}

// 설정 저장 (실제 IDB 저장)
async function saveSettingsToIDB(newSettings: StyleSettings): Promise<void> {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    // Vue reactive 객체를 plain object로 변환하여 저장
    const plainSettings = JSON.parse(JSON.stringify(newSettings))

    return new Promise((resolve, reject) => {
      const request = store.put({ key: SETTINGS_KEY, value: plainSettings })

      request.onsuccess = () => {
        log.debug('Settings saved to IndexedDB')
        resolve()
      }

      request.onerror = () => {
        log.error('Failed to save settings:', request.error)
        reject(request.error)
      }

      transaction.oncomplete = () => {
        db.close()
      }
    })
  } catch (error) {
    log.error('Error saving settings:', error)
  }
}

// 디바운스된 저장 함수 (300ms 지연) - IndexedDB 저장 + main process 동기화
const debouncedSaveSettings = debounce((newSettings: StyleSettings) => {
  saveSettingsToIDB(newSettings)
  // main process에도 동기화 (WatchParty 등 로컬 서버 창에서 사용)
  syncSettingsToMain(newSettings)
}, 300)

// 설정 로드
async function loadSettingsFromDB(): Promise<StyleSettings> {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.get(SETTINGS_KEY)

      request.onsuccess = () => {
        const result = request.result
        if (result?.value) {
          log.debug('Loaded settings from IndexedDB')
          resolve(mergeWithDefaults(result.value))
        } else {
          log.debug('No saved settings, using defaults')
          resolve(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
        }
      }

      request.onerror = () => {
        log.error('Failed to load settings:', request.error)
        reject(request.error)
      }

      transaction.oncomplete = () => {
        db.close()
      }
    })
  } catch (error) {
    log.error('Error loading settings:', error)
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  }
}

// 기본값과 병합
function mergeWithDefaults(saved: Partial<StyleSettings>): StyleSettings {
  return {
    containerOpacity: {
      home: saved.containerOpacity?.home ?? DEFAULT_SETTINGS.containerOpacity.home,
      chat: saved.containerOpacity?.chat ?? DEFAULT_SETTINGS.containerOpacity.chat
    },
    backgroundOverlay: {
      home: saved.backgroundOverlay?.home ?? DEFAULT_SETTINGS.backgroundOverlay.home,
      chat: saved.backgroundOverlay?.chat ?? DEFAULT_SETTINGS.backgroundOverlay.chat,
      notification: saved.backgroundOverlay?.notification ?? DEFAULT_SETTINGS.backgroundOverlay.notification
    },
    backgroundBlur: {
      home: saved.backgroundBlur?.home ?? DEFAULT_SETTINGS.backgroundBlur.home,
      chat: saved.backgroundBlur?.chat ?? DEFAULT_SETTINGS.backgroundBlur.chat
    },
    colors: {
      gradientStart: saved.colors?.gradientStart ?? DEFAULT_COLORS.gradientStart,
      gradientMid: saved.colors?.gradientMid ?? DEFAULT_COLORS.gradientMid,
      gradientEnd: saved.colors?.gradientEnd ?? DEFAULT_COLORS.gradientEnd,
      colorPrimary: saved.colors?.colorPrimary ?? DEFAULT_COLORS.colorPrimary,
      colorPrimaryHover: saved.colors?.colorPrimaryHover ?? DEFAULT_COLORS.colorPrimaryHover,
      colorPrimaryLight: saved.colors?.colorPrimaryLight ?? DEFAULT_COLORS.colorPrimaryLight,
      colorSecondary: saved.colors?.colorSecondary ?? DEFAULT_COLORS.colorSecondary,
      colorAccent: saved.colors?.colorAccent ?? DEFAULT_COLORS.colorAccent,
      bgPrimary: saved.colors?.bgPrimary ?? DEFAULT_COLORS.bgPrimary,
      bgSecondary: saved.colors?.bgSecondary ?? DEFAULT_COLORS.bgSecondary,
      textPrimary: saved.colors?.textPrimary ?? DEFAULT_COLORS.textPrimary,
      textSecondary: saved.colors?.textSecondary ?? DEFAULT_COLORS.textSecondary,
      textMuted: saved.colors?.textMuted ?? DEFAULT_COLORS.textMuted
    }
  }
}

// 로컬 HTTP 서버에서 실행 중인지 확인 (http://localhost:xxxxx)
function isRunningOnLocalServer(): boolean {
  return window.location.protocol === 'http:' && window.location.hostname === 'localhost'
}

// main process에서 스타일 설정 로드 (IPC)
async function loadSettingsFromMain(): Promise<StyleSettings | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronApi = (window as any).electronApi
    if (electronApi?.getStyleSettings) {
      const settings = await electronApi.getStyleSettings()
      if (settings) {
        log.debug('Loaded settings from main process (IPC)')
        return mergeWithDefaults(settings as Partial<StyleSettings>)
      }
    }
  } catch (error) {
    log.error('Failed to load settings from main process:', error)
  }
  return null
}

// main process에 스타일 설정 저장 (IPC) - 비동기 동기화
async function syncSettingsToMain(newSettings: StyleSettings): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronApi = (window as any).electronApi
    if (electronApi?.setStyleSettings) {
      await electronApi.setStyleSettings(JSON.parse(JSON.stringify(newSettings)))
      log.debug('Synced settings to main process')
    }
  } catch (error) {
    log.error('Failed to sync settings to main process:', error)
  }
}

// main process에서 설정 변경 이벤트 리스너 등록
function setupMainSettingsListener(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronApi = (window as any).electronApi
    if (electronApi?.onStyleSettingsChanged) {
      electronApi.onStyleSettingsChanged((newSettings: unknown) => {
        log.debug('Received settings change from main process')
        const merged = mergeWithDefaults(newSettings as Partial<StyleSettings>)
        settings.value = merged
        applyCSSVariables(merged)
      })
    }
    // 배경 이미지 변경 이벤트 리스너
    if (electronApi?.onBackgroundChanged) {
      electronApi.onBackgroundChanged((bgType: string) => {
        log.debug('Received background change from main process:', bgType)
        window.dispatchEvent(new CustomEvent('background-changed', {
          detail: { type: bgType }
        }))
      })
    }
  } catch (error) {
    log.error('Failed to setup main settings listener:', error)
  }
}

/**
 * 스타일 설정 Composable
 */
export function useStyleSettings() {
  // BroadcastChannel message handler
  function handleBroadcastMessage(event: MessageEvent) {
    if (event.data.type === 'settings-updated') {
      log.debug('Received settings update from another window')
      settings.value = event.data.settings
      applyCSSVariables(event.data.settings)
    } else if (event.data.type === 'background-updated') {
      log.debug('Received background update:', event.data.backgroundType)
      // Background image change event - handled by each page
      window.dispatchEvent(new CustomEvent('background-changed', {
        detail: { type: event.data.backgroundType }
      }))
    }
  }

  // 초기화 - 설정 로드 및 BroadcastChannel 설정
  async function initialize(): Promise<void> {
    // main process에서 설정 변경 이벤트 리스너 등록 (모든 창에서)
    setupMainSettingsListener()

    // BroadcastChannel 설정 (file:// 프로토콜에서만 작동)
    if (!isRunningOnLocalServer() && !broadcastChannel) {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME)
      broadcastChannel.onmessage = handleBroadcastMessage
    }

    if (isLoaded.value || isLoading.value) {
      applyCSSVariables(settings.value)
      return
    }

    isLoading.value = true
    try {
      let loaded: StyleSettings

      // 로컬 서버에서 실행 중일 때는 main process에서 설정 로드
      if (isRunningOnLocalServer()) {
        const mainSettings = await loadSettingsFromMain()
        if (mainSettings) {
          loaded = mainSettings
        } else {
          // fallback: IndexedDB에서 로드 시도 (동일 origin인 경우 - 개발 환경)
          loaded = await loadSettingsFromDB()
        }
      } else {
        // file:// 프로토콜: IndexedDB에서 로드
        loaded = await loadSettingsFromDB()
      }

      settings.value = loaded
      applyCSSVariables(loaded)
      isLoaded.value = true
    } finally {
      isLoading.value = false
    }
  }

  // 컨테이너 투명도 설정
  function setContainerOpacity(type: 'home' | 'chat', value: number): void {
    const clampedValue = Math.max(0, Math.min(1, value))
    const newSettings: StyleSettings = {
      ...settings.value,
      containerOpacity: {
        ...settings.value.containerOpacity,
        [type]: clampedValue
      }
    }
    settings.value = newSettings
    applyCSSVariables(newSettings)
    debouncedSaveSettings(newSettings)  // 디바운스된 저장
    broadcastSettingsChange(newSettings)
  }

  // 배경 오버레이 투명도 설정
  function setBackgroundOverlay(type: 'home' | 'chat' | 'notification', value: number): void {
    const clampedValue = Math.max(0, Math.min(1, value))
    const newSettings: StyleSettings = {
      ...settings.value,
      backgroundOverlay: {
        ...settings.value.backgroundOverlay,
        [type]: clampedValue
      }
    }
    settings.value = newSettings
    applyCSSVariables(newSettings)
    debouncedSaveSettings(newSettings)  // 디바운스된 저장
    broadcastSettingsChange(newSettings)
  }

  // 배경 블러 효과 설정
  function setBackgroundBlur(type: 'home' | 'chat', value: number): void {
    const clampedValue = Math.max(0, Math.min(20, value))
    const newSettings: StyleSettings = {
      ...settings.value,
      backgroundBlur: {
        ...settings.value.backgroundBlur,
        [type]: clampedValue
      }
    }
    settings.value = newSettings
    applyCSSVariables(newSettings)
    debouncedSaveSettings(newSettings)  // 디바운스된 저장
    broadcastSettingsChange(newSettings)
  }

  // 기본값으로 리셋
  async function resetToDefaults(): Promise<void> {
    const newSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
    settings.value = newSettings
    applyCSSVariables(newSettings)
    await saveSettingsToIDB(newSettings)  // 리셋은 즉시 저장
    broadcastSettingsChange(newSettings)
  }

  // 색상 설정
  function setColor(colorKey: keyof ColorSettings, value: string): void {
    const newSettings: StyleSettings = {
      ...settings.value,
      colors: {
        ...settings.value.colors,
        [colorKey]: value
      }
    }
    settings.value = newSettings
    applyCSSVariables(newSettings)
    debouncedSaveSettings(newSettings)
    broadcastSettingsChange(newSettings)
  }

  // 모든 색상 일괄 설정
  function setColors(colors: Partial<ColorSettings>): void {
    const newSettings: StyleSettings = {
      ...settings.value,
      colors: {
        ...settings.value.colors,
        ...colors
      }
    }
    settings.value = newSettings
    applyCSSVariables(newSettings)
    debouncedSaveSettings(newSettings)
    broadcastSettingsChange(newSettings)
  }

  // 색상 템플릿 적용
  function applyTemplate(templateId: string): void {
    const template = COLOR_TEMPLATES.find(t => t.id === templateId)
    if (template) {
      const newSettings: StyleSettings = {
        ...settings.value,
        colors: { ...template.colors }
      }
      settings.value = newSettings
      applyCSSVariables(newSettings)
      debouncedSaveSettings(newSettings)
      broadcastSettingsChange(newSettings)
    }
  }

  // 설정 내보내기 (JSON)
  function exportSettings(): string {
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        colors: settings.value.colors,
        containerOpacity: settings.value.containerOpacity,
        backgroundOverlay: settings.value.backgroundOverlay
      }
    }
    return JSON.stringify(exportData, null, 2)
  }

  // 설정 가져오기 (JSON)
  function importSettings(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString)
      if (data.settings?.colors) {
        const newSettings: StyleSettings = {
          ...settings.value,
          colors: { ...DEFAULT_COLORS, ...data.settings.colors },
          containerOpacity: data.settings.containerOpacity || settings.value.containerOpacity,
          backgroundOverlay: data.settings.backgroundOverlay || settings.value.backgroundOverlay
        }
        settings.value = newSettings
        applyCSSVariables(newSettings)
        saveSettingsToIDB(newSettings)
        broadcastSettingsChange(newSettings)
        return true
      }
      return false
    } catch (e) {
      log.error('Failed to import settings:', e)
      return false
    }
  }

  // 배경 이미지 변경 알림 (외부에서 호출)
  function notifyBackgroundChange(bgType: string) {
    broadcastBackgroundChange(bgType)
  }

  // 컴포넌트 마운트 시 자동 초기화
  onMounted(() => {
    initialize()
  })

  // 컴포넌트 언마운트 시 정리
  onUnmounted(() => {
    // BroadcastChannel은 싱글톤이므로 닫지 않음
  })

  return {
    // 상태
    settings,
    isLoaded,
    isLoading,
    DEFAULT_SETTINGS,
    DEFAULT_COLORS,
    COLOR_TEMPLATES,

    // 메서드
    initialize,
    setContainerOpacity,
    setBackgroundOverlay,
    setBackgroundBlur,
    setColor,
    setColors,
    applyTemplate,
    exportSettings,
    importSettings,
    resetToDefaults,
    notifyBackgroundChange,
    applyCSSVariables
  }
}
