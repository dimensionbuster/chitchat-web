<script setup lang="ts">
// Notification renderer script: reads data from URL, animates, and auto-closes
// Runs in a BrowserWindow; no Electron imports needed.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { getElectronApi } from '@/util/platform'

defineOptions({ name: 'NotificationPage' })

const props = defineProps<{
  authorName: string
  text: string
}>()

// Types
interface NotificationPayload {
  authorName?: string
  text?: string
}

// Config
const DISPLAY_MS = 5000 // how long to keep it visible
const EXIT_MS = 220 // exit transition (matches CSS .hiding)

// Refs to DOM elements
const rootEl = ref<HTMLDivElement | null>(null)
const barEl = ref<HTMLDivElement | null>(null)

// Reactive state
const titleText = ref<string>('New message')
const messageText = ref<string>('')
const stateClass = ref<'entering' | 'shown' | 'hiding' | ''>('')
let hideTimer: number | null = null
let shown = false
let remaining = DISPLAY_MS

function startProgress(durationMs: number): void {
  const bar = barEl.value
  if (!bar) return
  // Reset first
  bar.style.transitionDuration = '0ms'
  bar.style.transform = 'scaleX(1)'
  // Next frame, animate to 0
  requestAnimationFrame(() => {
    bar.style.transitionDuration = `${durationMs}ms`
    bar.style.transform = 'scaleX(0)'
  })
}

function show(data?: NotificationPayload): void {
  if (!data) return
  titleText.value = data.authorName || 'New message'
  messageText.value = data.text || ''

  // Enter animation
  stateClass.value = 'entering'
  requestAnimationFrame(() => {
    stateClass.value = 'shown'
  })

  // Start progress bar and schedule close
  startProgress(DISPLAY_MS)
  scheduleHide(DISPLAY_MS)
  shown = true
}

function scheduleHide(afterMs: number): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  hideTimer = window.setTimeout(hide, afterMs)
}

function hide(): void {
  if (!shown) return
  shown = false
  stateClass.value = 'hiding'
  // Close after exit animation
  window.setTimeout(() => {
    window.close()
  }, EXIT_MS)
}

function onMouseEnter(): void {
  // Pause timer and freeze bar
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  const bar = barEl.value
  if (!bar) return
  const computed = window.getComputedStyle(bar)
  const transform = computed.transform // matrix(a, b, c, d, tx, ty)
  let scaleX = 1
  if (transform && transform !== 'none') {
    const m = transform.match(/matrix\(([^)]+)\)/)
    if (m && m[1]) {
      const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
      if (parts[0] !== undefined && !Number.isNaN(parts[0])) scaleX = parts[0]
    }
  }
  // remaining time proportional to current scaleX
  remaining = Math.max(0, Math.round(DISPLAY_MS * scaleX))
  bar.style.transitionDuration = '0ms'
}

function onMouseLeave(): void {
  const bar = barEl.value
  if (!bar) return
  // resume bar animation
  requestAnimationFrame(() => {
    bar.style.transitionDuration = `${remaining}ms`
    bar.style.transform = 'scaleX(0)'
  })
  scheduleHide(remaining)
}

onMounted(() => {
  try {
    const { authorName, text } = props
    const api = getElectronApi()
    if (api?.sendLogMessage) {
      api.sendLogMessage('info', `Notification props: ${authorName}, ${text}`)
    }
    show({ authorName, text })
  } catch (e) {
    const api = getElectronApi()
    if (api?.sendLogMessage) {
      api.sendLogMessage('error', `Failed to initialize notification: ${e}`)
    }
    window.setTimeout(() => window.close(), 2000)
  }
})

onBeforeUnmount(() => {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
})
</script>

<template>
  <div
    id="root"
    class="notification"
    :class="stateClass"
    ref="rootEl"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="left">
      <div class="avatar">💬</div>
    </div>
    <div class="content">
      <div class="title-row">
        <div class="title" id="title">{{ titleText }}</div>
        <button id="closeBtn" class="close" @click="hide">✕</button>
      </div>
      <div class="message" id="message">{{ messageText }}</div>
      <div class="progress" id="progress">
        <div class="bar" id="bar" ref="barEl"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
:root {
  --bg: rgba(30, 30, 30, 0.94);
  --accent: rgba(255, 255, 255, 0.9);
  --muted: rgba(255, 255, 255, 0.7);
}

html,
body {
  margin: 0;
  padding: 0;
  background: transparent;
  user-select: none;
  -webkit-user-select: none;
  font-family:
    system-ui,
    'Segoe UI',
    Roboto,
    'Noto Sans KR',
    sans-serif;
}

.notification {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.87), rgba(0, 0, 0, 0.658));
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  opacity: 1;
  transition:
    transform 160ms ease-out,
    opacity 160ms ease-out;
}

.left {
  margin-right: 10px;
}
.avatar {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  background: rgba(255, 255, 255, 0.04);
}

.content {
  flex: 1;
  min-width: 0;
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.title {
  font-weight: 600;
  color: var(--accent);
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 240px;
}
.close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
  opacity: 0.9;
}
.message {
  color: var(--muted);
  font-size: 12px;
  margin-top: 6px;
  max-height: 36px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.progress {
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 8px;
  width: 100%;
}
.bar {
  width: 100%;
  height: 100%;
  transform-origin: left;
  transform: scaleX(1);
  transition: transform linear;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.08));
}

/* initial hidden position (moved below) */
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
