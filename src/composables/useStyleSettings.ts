/**
 * 스타일 설정 관리 Composable
 * - IndexedDB에 스타일 설정 저장/로드
 * - 컨테이너 투명도, 배경 오버레이 투명도 등
 * - BroadcastChannel을 통한 창 간 실시간 동기화
 */
import { ref, onMounted, onUnmounted } from 'vue'

// 디바운스 유틸리티
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
  // 색상 설정
  colors: ColorSettings
}

// 기본 색상값 (Milkyway - 기본)
const DEFAULT_COLORS: ColorSettings = {
  gradientStart: '#e8d5f2',
  gradientMid: '#f0d4e8',
  gradientEnd: '#fce4ec',
  colorPrimary: '#9c7cb5',
  colorPrimaryHover: '#8b6aa3',
  colorPrimaryLight: '#d4c4e0',
  colorSecondary: '#d4a5c9',
  colorAccent: '#b8a5d4',
  bgPrimary: '#faf8fc',
  bgSecondary: '#f5f0f8',
  textPrimary: '#4a3f5c',
  textSecondary: '#7a6b8a',
  textMuted: '#b8adc4'
}

// 색상 템플릿 정의
export interface ColorTemplate {
  id: string
  name: string
  description: string
  colors: ColorSettings
}

export const COLOR_TEMPLATES: ColorTemplate[] = [
  {
    id: 'milkyway',
    name: '🌌 Milkyway',
    description: '부드러운 파스텔 보라-핑크 그라데이션',
    colors: { ...DEFAULT_COLORS }
  },
  {
    id: 'galaxy',
    name: '🌙 Galaxy',
    description: '어두운 파스텔톤의 나이트 모드',
    colors: {
      gradientStart: '#2d2640',
      gradientMid: '#3d3154',
      gradientEnd: '#4a3d5c',
      colorPrimary: '#9d8ec2',
      colorPrimaryHover: '#8a7bb0',
      colorPrimaryLight: '#5c4f73',
      colorSecondary: '#b794c9',
      colorAccent: '#7eb8c9',
      bgPrimary: '#1e1a26',
      bgSecondary: '#2a2533',
      textPrimary: '#e8e4f0',
      textSecondary: '#b8b0c8',
      textMuted: '#7a7290'
    }
  },
  {
    id: 'redwine',
    name: '🍷 Red Wine',
    description: '우아한 와인 레드 톤',
    colors: {
      gradientStart: '#f2d5d8',
      gradientMid: '#e8c4c9',
      gradientEnd: '#f5e0e3',
      colorPrimary: '#a64d5e',
      colorPrimaryHover: '#8f3d4d',
      colorPrimaryLight: '#e0c4c9',
      colorSecondary: '#c98a94',
      colorAccent: '#d4a5a5',
      bgPrimary: '#fcf8f8',
      bgSecondary: '#f8f0f1',
      textPrimary: '#5c3a40',
      textSecondary: '#8a6a70',
      textMuted: '#c4adb0'
    }
  },
  {
    id: 'popsicle',
    name: '🍭 Popsicle',
    description: '톡톡 튀는 비비드 컬러',
    colors: {
      gradientStart: '#ffd6e8',
      gradientMid: '#c8f0ff',
      gradientEnd: '#fff0c8',
      colorPrimary: '#ff6b9d',
      colorPrimaryHover: '#e85a8a',
      colorPrimaryLight: '#ffb8d0',
      colorSecondary: '#4ecdc4',
      colorAccent: '#ffe66d',
      bgPrimary: '#fffbfc',
      bgSecondary: '#fff5f8',
      textPrimary: '#4a3545',
      textSecondary: '#7a6575',
      textMuted: '#b8a8b4'
    }
  },
  {
    id: 'applejack',
    name: '🍎 Applejack',
    description: '사과 과수원의 따뜻한 오렌지 톤',
    colors: {
      gradientStart: '#ffe8d5',
      gradientMid: '#ffd4b8',
      gradientEnd: '#fff0e0',
      colorPrimary: '#e07830',
      colorPrimaryHover: '#c86820',
      colorPrimaryLight: '#f5d4b8',
      colorSecondary: '#7cb342',
      colorAccent: '#d32f2f',
      bgPrimary: '#fffcf8',
      bgSecondary: '#fff8f0',
      textPrimary: '#5c4030',
      textSecondary: '#8a7060',
      textMuted: '#c4b0a0'
    }
  },
  {
    id: 'mint',
    name: '🌿 Mint Fresh',
    description: '상쾌한 민트 그린 테마',
    colors: {
      gradientStart: '#d5f2e8',
      gradientMid: '#c4e8dc',
      gradientEnd: '#e0f5f0',
      colorPrimary: '#4db6ac',
      colorPrimaryHover: '#3d9e94',
      colorPrimaryLight: '#b2dfdb',
      colorSecondary: '#80cbc4',
      colorAccent: '#a5d6d0',
      bgPrimary: '#f8fcfb',
      bgSecondary: '#f0f8f6',
      textPrimary: '#2e4a45',
      textSecondary: '#5a7a74',
      textMuted: '#a0c4bc'
    }
  },
  {
    id: 'sakura',
    name: '🌸 Sakura',
    description: '벚꽃이 흩날리는 봄날',
    colors: {
      gradientStart: '#ffeef2',
      gradientMid: '#ffd9e4',
      gradientEnd: '#fff5f7',
      colorPrimary: '#e91e63',
      colorPrimaryHover: '#c2185b',
      colorPrimaryLight: '#f8bbd9',
      colorSecondary: '#f06292',
      colorAccent: '#ff80ab',
      bgPrimary: '#fffbfc',
      bgSecondary: '#fff0f4',
      textPrimary: '#4a2c36',
      textSecondary: '#7a5a66',
      textMuted: '#c4a0ac'
    }
  },
  {
    id: 'ocean',
    name: '🌊 Ocean Blue',
    description: '깊고 고요한 바다의 블루',
    colors: {
      gradientStart: '#d5e8f2',
      gradientMid: '#c4dce8',
      gradientEnd: '#e0f0f5',
      colorPrimary: '#1976d2',
      colorPrimaryHover: '#1565c0',
      colorPrimaryLight: '#bbdefb',
      colorSecondary: '#42a5f5',
      colorAccent: '#64b5f6',
      bgPrimary: '#f8fbfc',
      bgSecondary: '#f0f6f8',
      textPrimary: '#1a3a52',
      textSecondary: '#4a6a82',
      textMuted: '#90b0c4'
    }
  }
]

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
  }
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
  if (broadcastChannel) {
    // Vue reactive 객체를 plain object로 변환하여 전송
    const plainSettings = JSON.parse(JSON.stringify(newSettings))
    broadcastChannel.postMessage({ type: 'settings-updated', settings: plainSettings })
  }
}

// 배경 이미지 변경 알림
function broadcastBackgroundChange(bgType: string) {
  if (broadcastChannel) {
    broadcastChannel.postMessage({ type: 'background-updated', backgroundType: bgType })
  }
}

// IndexedDB 초기화
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('[StyleSettings] Failed to open IndexedDB:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        console.log('[StyleSettings] Created IndexedDB store')
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
        console.log('[StyleSettings] Settings saved to IndexedDB')
        resolve()
      }

      request.onerror = () => {
        console.error('[StyleSettings] Failed to save settings:', request.error)
        reject(request.error)
      }

      transaction.oncomplete = () => {
        db.close()
      }
    })
  } catch (error) {
    console.error('[StyleSettings] Error saving settings:', error)
  }
}

// 디바운스된 저장 함수 (300ms 지연)
const debouncedSaveSettings = debounce((newSettings: StyleSettings) => {
  saveSettingsToIDB(newSettings)
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
          console.log('[StyleSettings] Loaded settings from IndexedDB')
          resolve(mergeWithDefaults(result.value))
        } else {
          console.log('[StyleSettings] No saved settings, using defaults')
          resolve(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
        }
      }

      request.onerror = () => {
        console.error('[StyleSettings] Failed to load settings:', request.error)
        reject(request.error)
      }

      transaction.oncomplete = () => {
        db.close()
      }
    })
  } catch (error) {
    console.error('[StyleSettings] Error loading settings:', error)
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

/**
 * 스타일 설정 Composable
 */
export function useStyleSettings() {
  // BroadcastChannel 메시지 핸들러
  function handleBroadcastMessage(event: MessageEvent) {
    if (event.data.type === 'settings-updated') {
      console.log('[StyleSettings] Received settings update from another window')
      settings.value = event.data.settings
      applyCSSVariables(event.data.settings)
    } else if (event.data.type === 'background-updated') {
      console.log('[StyleSettings] Received background update:', event.data.backgroundType)
      // 배경 이미지 변경 이벤트 발생 - 각 페이지에서 처리
      window.dispatchEvent(new CustomEvent('background-changed', {
        detail: { type: event.data.backgroundType }
      }))
    }
  }

  // 초기화 - 설정 로드 및 BroadcastChannel 설정
  async function initialize(): Promise<void> {
    // BroadcastChannel 설정
    if (!broadcastChannel) {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME)
      broadcastChannel.onmessage = handleBroadcastMessage
    }

    if (isLoaded.value || isLoading.value) {
      applyCSSVariables(settings.value)
      return
    }

    isLoading.value = true
    try {
      const loaded = await loadSettingsFromDB()
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
      console.error('[StyleSettings] Failed to import settings:', e)
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
