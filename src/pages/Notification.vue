<script setup lang="ts">
/**
 * 알림창 컴포넌트
 * - 새 메시지가 도착하면 화면 우측 하단에 표시
 * - 자동으로 5초 후 사라짐
 * - 마우스 오버 시 타이머 일시정지
 * - 클릭 시 메인 창 포커스
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { getElectronApi } from '@/util/platform'

defineOptions({ name: 'NotificationPage' })

const props = defineProps<{
  authorName: string
  text: string
  messageId: string
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
 * 알림 클릭 시: 메인 창 포커스 및 알림 닫기
 */
function onNotificationClick(): void {
  const api = getElectronApi()

  // 메인 창 표시 요청
  if (api?.clickNotification) {
    api.clickNotification(props.messageId)
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

onMounted(() => {
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
    @mouseenter="pauseAutoClose"
    @mouseleave="resumeAutoClose"
    @click="onNotificationClick"
  >
    <div class="avatar-container">
      <div class="avatar">💬</div>
    </div>

    <div class="content">
      <div class="header">
        <div class="title">{{ displayTitle }}</div>
        <button class="close-button" @click="closeNotification">✕</button>
      </div>

      <div class="message">{{ displayMessage }}</div>

      <div class="progress-bar-container">
        <div class="progress-bar" ref="progressBarRef"></div>
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
  font-family: system-ui, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif;
  overflow: hidden;
}

/* 알림 컨테이너 */
.notification {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  padding: 10px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.87), rgba(0, 0, 0, 0.658));
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  transition: transform 160ms ease-out, opacity 160ms ease-out;
}

/* 아바타 영역 */
.avatar-container {
  margin-right: 8px;
  flex-shrink: 0;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: rgba(255, 255, 255, 0.04);
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
  gap: 6px;
  margin-bottom: 3px;
}

.title {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 180px;
}

.close-button {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  cursor: pointer;
  opacity: 0.9;
  flex-shrink: 0;
  padding: 0;
  width: 16px;
  height: 16px;
}

.close-button:hover {
  opacity: 1;
}

/* 메시지 */
.message {
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  line-height: 1.3;
  max-height: 28px;
  margin-bottom: 4px;
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
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
  width: 100%;
}

.progress-bar {
  width: 100%;
  height: 100%;
  transform-origin: left;
  transform: scaleX(1);
  transition: transform linear;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.08));
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
