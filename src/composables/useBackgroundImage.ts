/**
 * 배경 이미지 관리 Composable
 * - Electron 환경에서 로컬 파일 시스템에 배경 이미지 저장/로드
 * - 웹 환경에서는 기본 그라데이션 사용 (커스텀 배경 미지원)
 * - BroadcastChannel을 통한 창 간 실시간 동기화
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getElectronApi } from '@/util/platform'

export type BackgroundType = 'home' | 'chat' | 'notification'

// 전역 상태 (싱글톤)
const backgroundImages = ref<Record<BackgroundType, string | null>>({
  home: null,
  chat: null,
  notification: null
})

const isLoading = ref(false)
const isElectron = computed(() => !!getElectronApi())

/**
 * 배경 이미지 관리 Composable
 */
export function useBackgroundImage(type?: BackgroundType) {
  const api = getElectronApi()

  /**
   * 배경 이미지 로드
   */
  async function loadBackgroundImage(bgType: BackgroundType): Promise<string | null> {
    if (!api) return null

    try {
      const imageUrl = await api.getBackgroundImage(bgType)
      backgroundImages.value[bgType] = imageUrl
      return imageUrl
    } catch (error) {
      console.error(`[Background] Failed to load ${bgType}:`, error)
      return null
    }
  }

  /**
   * 모든 배경 이미지 로드
   */
  async function loadAllBackgrounds(): Promise<void> {
    if (!api) return

    isLoading.value = true
    try {
      await Promise.all([
        loadBackgroundImage('home'),
        loadBackgroundImage('chat'),
        loadBackgroundImage('notification')
      ])
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 배경 이미지 설정
   */
  async function setBackgroundImage(bgType: BackgroundType, imageData: ArrayBuffer): Promise<boolean> {
    if (!api) return false

    try {
      const success = await api.setBackgroundImage(bgType, imageData)
      if (success) {
        // 새로 저장된 이미지 다시 로드
        await loadBackgroundImage(bgType)
      }
      return success
    } catch (error) {
      console.error(`[Background] Failed to set ${bgType}:`, error)
      return false
    }
  }

  /**
   * 배경 이미지 삭제
   */
  async function removeBackgroundImage(bgType: BackgroundType): Promise<boolean> {
    if (!api) return false

    try {
      const success = await api.removeBackgroundImage(bgType)
      if (success) {
        backgroundImages.value[bgType] = null
      }
      return success
    } catch (error) {
      console.error(`[Background] Failed to remove ${bgType}:`, error)
      return false
    }
  }

  /**
   * 파일 선택 다이얼로그 열기 및 배경 설정
   */
  async function selectAndSetBackground(bgType: BackgroundType): Promise<boolean> {
    if (!api) return false

    try {
      const imageData = await api.selectBackgroundImage()
      if (!imageData) return false

      return await setBackgroundImage(bgType, imageData)
    } catch (error) {
      console.error(`[Background] Failed to select and set ${bgType}:`, error)
      return false
    }
  }

  /**
   * 특정 타입의 배경 이미지 가져오기
   */
  function getBackgroundImage(bgType: BackgroundType): string | null {
    return backgroundImages.value[bgType]
  }

  /**
   * 현재 타입의 배경 이미지 (computed)
   */
  const currentBackground = computed(() => {
    if (!type) return null
    return backgroundImages.value[type]
  })

  /**
   * 배경 스타일 객체 생성
   */
  function getBackgroundStyle(bgType: BackgroundType): Record<string, string> {
    const imageUrl = backgroundImages.value[bgType]

    if (imageUrl) {
      return {
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }
    }

    // 기본 그라데이션 (CSS 변수 사용)
    return {
      background: 'var(--gradient-primary)'
    }
  }

  /**
   * 배경이 있는지 확인
   */
  function hasCustomBackground(bgType: BackgroundType): boolean {
    return !!backgroundImages.value[bgType]
  }

  // 다른 창에서 배경 변경 시 처리
  function handleBackgroundChanged(event: Event) {
    const customEvent = event as CustomEvent<{ type: string }>
    const changedType = customEvent.detail?.type as BackgroundType

    console.log('[Background] Received background change event:', changedType)

    // 변경된 타입의 배경 이미지 다시 로드
    if (changedType && api) {
      loadBackgroundImage(changedType)
    }
  }

  // 초기화 시 배경 로드 (특정 타입이 지정된 경우)
  onMounted(async () => {
    // background-changed 이벤트 리스너 등록
    window.addEventListener('background-changed', handleBackgroundChanged)

    if (type && api) {
      await loadBackgroundImage(type)
    }
  })

  onUnmounted(() => {
    window.removeEventListener('background-changed', handleBackgroundChanged)
  })

  return {
    // 상태
    backgroundImages,
    currentBackground,
    isLoading,
    isElectron,

    // 메서드
    loadBackgroundImage,
    loadAllBackgrounds,
    setBackgroundImage,
    removeBackgroundImage,
    selectAndSetBackground,
    getBackgroundImage,
    getBackgroundStyle,
    hasCustomBackground
  }
}
