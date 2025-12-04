/**
 * 알림 소리 관리 Composable
 * - 새 메시지 수신 시 알림 소리 재생
 * - 음량 조절 및 커스텀 소리 파일 설정 지원
 * - Electron 환경에서 로컬 파일 시스템에 커스텀 소리 파일 저장/로드
 * - 웹 환경에서는 기본 소리만 사용
 */
import { ref, computed, onMounted } from 'vue'
import { getElectronApi } from '@/util/platform'

// 기본 알림 소리를 정적 import로 가져오기 (Vite가 올바르게 처리)
import defaultSoundUrl from '@/assets/nope.mp3?url'

// 기본 알림 소리 경로
const DEFAULT_SOUND_PATH = defaultSoundUrl

// 전역 상태 (싱글톤)
const volume = ref<number>(0.5) // 0.0 ~ 1.0
const customSoundUrl = ref<string | null>(null)
const isEnabled = ref<boolean>(true)

// 오디오 인스턴스
let audioInstance: HTMLAudioElement | null = null

// BroadcastChannel for cross-window communication
let broadcastChannel: BroadcastChannel | null = null

// Initialize BroadcastChannel
try {
  broadcastChannel = new BroadcastChannel('notification-settings')
} catch (e) {
  console.warn('[NotificationSound] BroadcastChannel not supported:', e)
}

/**
 * 알림 소리 관리 Composable
 */
export function useNotificationSound() {
  const api = getElectronApi()
  const isElectron = computed(() => !!api)

  /**
   * 다른 창들에게 설정 변경 알림
   */
  function notifySettingsChange() {
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'settings-changed' })
    }
  }

  /**
   * 커스텀 소리 URL 다시 로드
   */
  async function reloadCustomSound() {
    if (!api) return

    try {
      const soundUrl = await api.getNotificationSound?.()
      customSoundUrl.value = soundUrl || null
    } catch (error) {
      console.error('[NotificationSound] Failed to reload custom sound:', error)
    }
  }

  /**
   * 설정 로드
   */
  async function loadSettings() {
    if (!api) {
      // 웹 환경: localStorage 사용
      const savedVolume = localStorage.getItem('notification-volume')
      const savedEnabled = localStorage.getItem('notification-enabled')

      if (savedVolume !== null) {
        volume.value = parseFloat(savedVolume)
      }
      if (savedEnabled !== null) {
        isEnabled.value = savedEnabled === 'true'
      }
      return
    }

    // Electron 환경: 파일 시스템 사용
    try {
      const savedVolume = await api.getNotificationVolume?.()
      if (savedVolume !== undefined && savedVolume !== null) {
        volume.value = savedVolume
      }

      const savedEnabled = await api.getNotificationEnabled?.()
      if (savedEnabled !== undefined && savedEnabled !== null) {
        isEnabled.value = savedEnabled
      }

      const savedSoundUrl = await api.getNotificationSound?.()
      if (savedSoundUrl) {
        customSoundUrl.value = savedSoundUrl
      }
    } catch (error) {
      console.error('[NotificationSound] Failed to load settings:', error)
    }
  }

  /**
   * 음량 설정
   */
  async function setVolume(newVolume: number) {
    volume.value = Math.max(0, Math.min(1, newVolume))

    if (!api) {
      // 웹 환경: localStorage에 저장
      localStorage.setItem('notification-volume', volume.value.toString())
      return
    }

    // Electron 환경: 파일 시스템에 저장
    try {
      await api.setNotificationVolume?.(volume.value)

      // 다른 창들에게 설정 변경 알림
      notifySettingsChange()
    } catch (error) {
      console.error('[NotificationSound] Failed to save volume:', error)
    }
  }

  /**
   * 활성화 상태 설정
   */
  async function setEnabled(enabled: boolean) {
    isEnabled.value = enabled

    if (!api) {
      // 웹 환경: localStorage에 저장
      localStorage.setItem('notification-enabled', enabled.toString())
      return
    }

    // Electron 환경: 파일 시스템에 저장
    try {
      await api.setNotificationEnabled?.(enabled)

      // 다른 창들에게 설정 변경 알림
      notifySettingsChange()
    } catch (error) {
      console.error('[NotificationSound] Failed to save enabled state:', error)
    }
  }

  /**
   * 커스텀 소리 파일 설정
   */
  async function setCustomSound(audioData: ArrayBuffer): Promise<boolean> {
    if (!api) {
      console.warn('[NotificationSound] Custom sound is only supported in Electron')
      return false
    }

    try {
      const success = await api.setNotificationSound?.(audioData)
      if (success) {
        await reloadCustomSound()

        // 다른 창들에게 소리 설정 변경 알림 (BroadcastChannel)
        notifySettingsChange()
      }
      return success || false
    } catch (error) {
      console.error('[NotificationSound] Failed to set custom sound:', error)
      return false
    }
  }

  /**
   * 커스텀 소리 파일 삭제
   */
  async function removeCustomSound(): Promise<boolean> {
    if (!api) return false

    try {
      const success = await api.removeNotificationSound?.()
      if (success) {
        customSoundUrl.value = null

        // 기존 오디오 인스턴스 제거하여 다음 재생 시 새로운 URL로 생성되도록 함
        if (audioInstance) {
          audioInstance.pause()
          audioInstance.src = ''
          audioInstance = null
        }

        // 다른 창들에게 소리 설정 변경 알림
        notifySettingsChange()
      }
      return success || false
    } catch (error) {
      console.error('[NotificationSound] Failed to remove custom sound:', error)
      return false
    }
  }

  /**
   * 파일 선택 다이얼로그 열기 및 커스텀 소리 설정
   */
  async function selectAndSetCustomSound(): Promise<boolean> {
    if (!api) {
      console.warn('[NotificationSound] Custom sound is only supported in Electron')
      return false
    }

    try {
      const audioData = await api.selectNotificationSound?.()
      if (!audioData) return false

      return await setCustomSound(audioData)
    } catch (error) {
      console.error('[NotificationSound] Failed to select and set sound:', error)
      return false
    }
  }

  /**
   * 알림 소리 재생
   */
  function playSound() {
    if (!isEnabled.value) return

    try {
      // 기존 오디오 정리
      if (audioInstance) {
        audioInstance.pause()
        audioInstance.currentTime = 0
      }

      // 소리 URL 결정 (커스텀 > 기본)
      const soundUrl = customSoundUrl.value || DEFAULT_SOUND_PATH

      // 새 오디오 인스턴스 생성 및 재생
      audioInstance = new Audio(soundUrl)
      audioInstance.volume = volume.value
      audioInstance.play().catch(error => {
        console.error('[NotificationSound] Play failed:', error)
      })
    } catch (error) {
      console.error('[NotificationSound] Failed to play sound:', error)
    }
  }

  /**
   * 테스트 재생 (설정 화면에서 사용)
   */
  function testSound() {
    playSound()
  }

  // 초기화
  onMounted(() => {
    loadSettings()

    // BroadcastChannel 메시지 수신 (다른 창에서 설정 변경 시)
    if (broadcastChannel) {
      broadcastChannel.onmessage = async (event) => {
        if (event.data?.type === 'settings-changed') {
          // 설정이 변경되었으므로 다시 로드
          await loadSettings()
        }
      }
    }
  })

  return {
    // 상태
    volume,
    isEnabled,
    customSoundUrl,
    isElectron,
    hasCustomSound: computed(() => !!customSoundUrl.value),

    // 메서드
    loadSettings,
    setVolume,
    setEnabled,
    setCustomSound,
    removeCustomSound,
    selectAndSetCustomSound,
    playSound,
    testSound
  }
}
