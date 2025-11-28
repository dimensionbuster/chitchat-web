<script setup lang="ts">
/**
 * 알림창 컴포넌트
 * - 새 메시지가 도착하면 화면 우측 하단에 표시
 * - 자동으로 5초 후 사라짐
 * - 마우스 오버 시 타이머 일시정지
 * - 클릭 시 메인 창 포커스
 */
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { getElectronApi } from '@/util/platform'
import { useBackgroundImage } from '@/composables/useBackgroundImage'
import { useStyleSettings } from '@/composables/useStyleSettings'

defineOptions({ name: 'NotificationPage' })

const props = defineProps<{
  authorName: string
  text: string
  messageId: string
  roomId: string
}>()

// 상수
const DISPLAY_DURATION = 5000 // 알림 표시 시간 (5초)
const EXIT_ANIMATION_DURATION = 220 // 닫힐 때 애니메이션 시간

// DOM 참조
const progressBarRef = ref<HTMLDivElement | null>(null)

// 반응형 상태
const displayTitle = ref<string>('New message')
const displayMessage = ref<string>('')
const animationState = ref<'entering' | 'shown' | 'hiding' | ''>('')

// 배경 이미지
const { currentBackground } = useBackgroundImage('notification')

// 스타일 설정 (실시간 CSS 변수 업데이트)
const { initialize: initStyleSettings } = useStyleSettings()

const backgroundStyle = computed(() => {
  if (currentBackground.value) {
    return {
      backgroundImage: `url(${currentBackground.value})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    }
  }
  return {}
})

// 타이머 관련
let autoCloseTimer: number | null = null
let isVisible = false
let remainingTime = DISPLAY_DURATION

/**
 * 프로그레스 바 애니메이션 시작
 */
function startProgressBarAnimation(durationMs: number): void {
  const bar = progressBarRef.value
  if (!bar) return

  // 초기화
  bar.style.transitionDuration = '0ms'
  bar.style.transform = 'scaleX(1)'

  // 다음 프레임에서 애니메이션 시작
  requestAnimationFrame(() => {
    bar.style.transitionDuration = `${durationMs}ms`
    bar.style.transform = 'scaleX(0)'
  })
}

/**
 * 알림 표시
 */
function showNotification(): void {
  displayTitle.value = props.authorName || 'New message'
  displayMessage.value = props.text || ''

  // 입장 애니메이션
  animationState.value = 'entering'
  requestAnimationFrame(() => {
    animationState.value = 'shown'
  })

  // 프로그레스 바 시작 및 자동 닫기 예약
  startProgressBarAnimation(DISPLAY_DURATION)
  scheduleAutoClose(DISPLAY_DURATION)
  isVisible = true
}

/**
 * 자동 닫기 예약
 */
function scheduleAutoClose(delayMs: number): void {
  clearAutoCloseTimer()
  autoCloseTimer = window.setTimeout(closeNotification, delayMs)
}

/**
 * 자동 닫기 타이머 취소
 */
function clearAutoCloseTimer(): void {
  if (autoCloseTimer !== null) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
}

/**
 * 알림 닫기
 */
function closeNotification(): void {
  if (!isVisible) return

  isVisible = false
  animationState.value = 'hiding'

  // 닫힘 애니메이션 후 창 닫기
  window.setTimeout(() => {
    window.close()
  }, EXIT_ANIMATION_DURATION)
}

/**
 * 알림 클릭 시: 해당 채팅방 창 열기 및 알림 닫기
 */
function onNotificationClick(): void {
  const api = getElectronApi()

  // 해당 채팅방 창 열기 요청
  if (api?.clickNotification) {
    // userName은 localStorage에서 가져오기 (알림창에는 전달되지 않으므로)
    const userName = localStorage.getItem('name') || undefined
    api.clickNotification(props.roomId, userName)
  }

  // 알림 닫기
  closeNotification()
}

/**
 * 마우스 오버 시: 타이머 일시정지 및 프로그레스 바 멈춤
 */
function pauseAutoClose(): void {
  clearAutoCloseTimer()

  const bar = progressBarRef.value
  if (!bar) return

  // 현재 프로그레스 바의 transform 값 가져오기
  const computed = window.getComputedStyle(bar)
  const transform = computed.transform
  let currentScale = 1

  if (transform && transform !== 'none') {
    const matrixMatch = transform.match(/matrix\(([^)]+)\)/)
    if (matrixMatch?.[1]) {
      const values = matrixMatch[1].split(',').map((s) => parseFloat(s.trim()))
      if (values[0] !== undefined && !Number.isNaN(values[0])) {
        currentScale = values[0]
      }
    }
  }

  // 남은 시간 계산 (프로그레스 비율에 비례)
  remainingTime = Math.max(0, Math.round(DISPLAY_DURATION * currentScale))

  // 애니메이션 멈춤
  bar.style.transitionDuration = '0ms'
}

/**
 * 마우스 아웃 시: 타이머 재개 및 프로그레스 바 재시작
 */
function resumeAutoClose(): void {
  const bar = progressBarRef.value
  if (!bar) return

  // 프로그레스 바 애니메이션 재개
  requestAnimationFrame(() => {
    bar.style.transitionDuration = `${remainingTime}ms`
    bar.style.transform = 'scaleX(0)'
  })

  // 자동 닫기 재예약
  scheduleAutoClose(remainingTime)
}

onMounted(async () => {
  // 스타일 설정 먼저 로드
  await initStyleSettings()
  // 그 다음 알림 표시
  showNotification()
})

onBeforeUnmount(() => {
  clearAutoCloseTimer()
})
</script>

<template>
  <div
    class="notification"
    :class="animationState"
    :style="backgroundStyle"
    @mouseenter="pauseAutoClose"
    @mouseleave="resumeAutoClose"
    @click="onNotificationClick"
  >
    <!-- 오버레이 (커스텀 배경이 있을 때) -->
    <div v-if="currentBackground" class="notification-bg-overlay"></div>

    <div class="notification-inner">
      <div class="avatar-container">
        <div class="avatar">💬</div>
      </div>

      <div class="content">
        <div class="header">
          <div class="title">{{ displayTitle }}</div>
          <button class="close-button" @click.stop="closeNotification">✕</button>
        </div>

        <div class="message">{{ displayMessage }}</div>

        <div class="progress-bar-container">
          <div class="progress-bar" ref="progressBarRef"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* 전역 스타일 */
html,
body {
  margin: 0;
  padding: 0;
  background: transparent;
  user-select: none;
  -webkit-user-select: none;
  font-family: var(--font-family, system-ui, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif);
  overflow: hidden;
}

/* 알림 컨테이너 */
.notification {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: var(--radius-lg, 14px);
  background: var(--notification-bg, linear-gradient(135deg, rgba(232, 213, 242, 0.95) 0%, rgba(252, 228, 236, 0.95) 100%));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(156, 124, 181, 0.25));
  border: 1px solid var(--notification-border, rgba(156, 124, 181, 0.3));
  overflow: hidden;
  transition: transform 160ms ease-out, opacity 160ms ease-out;
  position: relative;
}

.notification-bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--bg-primary-rgb, 255, 255, 255), var(--bg-overlay-opacity-notification, 0.6));
  pointer-events: none;
  z-index: 0;
}

.notification-inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  padding: var(--spacing-md, 12px);
  height: 100%;
  box-sizing: border-box;
}

/* 아바타 영역 */
.avatar-container {
  margin-right: var(--spacing-sm, 10px);
  flex-shrink: 0;
}

.avatar {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md, 10px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  background: linear-gradient(135deg, var(--color-primary, #9c7cb5) 0%, var(--color-accent, #b8a5d4) 100%);
  box-shadow: 0 4px 12px rgba(var(--color-primary-rgb, 156, 124, 181), 0.3);
}

/* 콘텐츠 영역 */
.content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

/* 헤더 (제목 + 닫기 버튼) */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs, 6px);
  margin-bottom: var(--spacing-xs, 4px);
}

.title {
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-secondary, #d4a5c9);
  font-size: var(--font-size-sm, 13px);
  line-height: var(--line-height-tight, 1.2);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 180px;
}

.close-button {
  background: rgba(var(--color-primary-rgb, 156, 124, 181), 0.15);
  border: none;
  color: var(--color-accent, #b8a5d4);
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm, 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast, 0.15s ease);
}

.close-button:hover {
  background: var(--color-primary, #9c7cb5);
  color: white;
}

/* 메시지 */
.message {
  color: var(--text-secondary, #7a6b8a);
  font-size: var(--font-size-xs, 11px);
  line-height: var(--line-height-normal, 1.4);
  max-height: 28px;
  margin-bottom: var(--spacing-xs, 6px);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* 프로그레스 바 */
.progress-bar-container {
  height: 3px;
  background: var(--border-light, rgba(156, 124, 181, 0.15));
  border-radius: var(--radius-full, 9999px);
  overflow: hidden;
  width: 100%;
}

.progress-bar {
  width: 100%;
  height: 100%;
  transform-origin: left;
  transform: scaleX(1);
  transition: transform linear;
  background: linear-gradient(90deg, var(--color-accent, #b8a5d4) 0%, var(--color-primary, #9c7cb5) 50%, var(--color-secondary, #d4a5c9) 100%);
  border-radius: var(--radius-full, 9999px);
}

/* 애니메이션 상태 */
.entering {
  transform: translateY(20px);
  opacity: 0;
}

.shown {
  transform: translateY(0);
  opacity: 1;
}

.hiding {
  transform: translateY(20px);
  opacity: 0;
  transition-duration: 220ms;
}
</style>
