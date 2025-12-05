<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useWatchParty, extractYouTubeVideoId, type WatchPartyState } from '@/composables/useWatchParty'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'

defineOptions({ name: 'WatchPartyPage' })

const props = defineProps<{
  roomId: string
}>()

// Yjs 설정
const doc = new Y.Doc()
const SIGNALING_SERVER_URL = import.meta.env.VITE_SIGNAL_URLS || 'wss://webrtc.chitchatdimension.com'

let provider: WebrtcProvider | null = null
let persistence: IndexeddbPersistence | null = null

// 사용자 ID (로컬 스토리지에서)
const uuid = localStorage.getItem('uuid') || crypto.randomUUID()
if (!localStorage.getItem('uuid')) {
  localStorage.setItem('uuid', uuid)
}
const currentUserId = `user-${uuid}`
const currentUserName = `User ${currentUserId.slice(-4)}`

// Watch Party 상태
const isReady = ref(false)
const urlInput = ref('')
const playerReady = ref(false)
const iframeRef = ref<HTMLIFrameElement | null>(null)

// BroadcastChannel for cross-window communication
const broadcastChannel = new BroadcastChannel(`watch-party-${props.roomId}`)

// Watch Party composable (Yjs 연결 후 초기화)
let watchParty: ReturnType<typeof useWatchParty> | null = null

const state = ref<WatchPartyState>({
  isActive: false,
  videoId: null,
  videoUrl: null,
  hostId: null,
  hostName: null,
  currentTime: 0,
  isPlaying: false,
  lastEventTime: 0,
  eventType: null
})

const isHost = computed(() => state.value.hostId === currentUserId)

// iframe URL 생성
const iframeUrl = computed(() => {
  if (!state.value.videoId) return ''
  const params = new URLSearchParams({
    autoplay: '0',
    controls: '1',
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    fs: '1',
    enablejsapi: '0'  // API 비활성화 - 순수 iframe만 사용
  })
  return `https://www.youtube-nocookie.com/embed/${state.value.videoId}?${params.toString()}`
})

// 플레이어 생성 (직접 iframe)
const createPlayer = (videoId: string) => {
  state.value.videoId = videoId
  playerReady.value = true
  console.log('[WatchParty] Player ready (iframe mode)')
}

// 호스트 - 플레이어 상태 변화 처리 (iframe에선 제한적)
// 참고: 순수 iframe 모드에서는 재생 상태 감지가 불가능
// 동기화가 필요하면 수동 버튼을 통해 처리

// 참가자 - 원격 이벤트 처리
const handleRemoteEvent = (remoteState: WatchPartyState) => {
  state.value = { ...remoteState }

  // iframe 모드에서는 postMessage로 제어 (제한적)
  // start/end 이벤트만 처리
  if (remoteState.eventType === 'start' && remoteState.videoId) {
    createPlayer(remoteState.videoId)
  } else if (remoteState.eventType === 'end') {
    window.close()
  }
}

// Watch Party 시작
const handleStartWatchParty = () => {
  const videoId = extractYouTubeVideoId(urlInput.value)
  if (!videoId) {
    alert('유효한 YouTube URL을 입력해주세요')
    return
  }

  if (watchParty) {
    const newState = watchParty.startWatchParty(videoId, urlInput.value)
    state.value = { ...newState }
    createPlayer(videoId)

    // BroadcastChannel로 알림
    broadcastChannel.postMessage({ type: 'started', videoId, videoUrl: urlInput.value })
  }
}

// Watch Party 참가 (이미 진행 중인 경우)
const joinExistingWatchParty = () => {
  if (state.value.isActive && state.value.videoId) {
    createPlayer(state.value.videoId)
  }
}

// Watch Party 종료
const handleEndWatchParty = () => {
  if (watchParty && isHost.value) {
    watchParty.endWatchParty()
    broadcastChannel.postMessage({ type: 'ended' })
  }
  window.close()
}

// 창 닫기
const handleClose = () => {
  window.electronApi?.windowDestroy()
}

// 창 최소화
const handleMinimize = () => {
  window.electronApi?.windowMinimize()
}

// Yjs 초기화
onMounted(async () => {
  // IndexedDB persistence
  persistence = new IndexeddbPersistence(`chitchat-${props.roomId}`, doc)

  // WebRTC provider
  provider = new WebrtcProvider(props.roomId, doc, {
    signaling: [SIGNALING_SERVER_URL],
  })

  // Watch Party composable 초기화
  watchParty = useWatchParty(doc, currentUserId, currentUserName)

  // 상태 동기화
  state.value = { ...watchParty.state.value }

  // 원격 이벤트 리스너 등록
  watchParty.setRemoteEventListener(handleRemoteEvent)

  isReady.value = true

  // 이미 Watch Party가 진행 중이면 자동 참가
  if (state.value.isActive && state.value.videoId) {
    joinExistingWatchParty()
  }
})

onUnmounted(() => {
  broadcastChannel.close()
  if (provider) {
    provider.disconnect()
    provider.destroy()
  }
  if (persistence) {
    persistence.destroy()
  }
})
</script>

<template>
  <div class="watch-party-page">
    <!-- 타이틀 바 -->
    <div class="title-bar">
      <div class="title">
        <span class="icon">📺</span>
        <span>Watch Party - {{ roomId }}</span>
        <span v-if="state.isActive" class="badge" :class="{ host: isHost }">
          {{ isHost ? '호스트' : `${state.hostName}의 방` }}
        </span>
      </div>
      <div class="window-controls">
        <button @click="handleMinimize" class="control-btn minimize">─</button>
        <button @click="handleClose" class="control-btn close">✕</button>
      </div>
    </div>

    <!-- 메인 콘텐츠 -->
    <div class="content">
      <!-- Watch Party가 없을 때 - 시작 UI -->
      <div v-if="!state.isActive" class="start-panel">
        <div class="start-content">
          <h2>🎬 Watch Party</h2>
          <p>YouTube 영상을 함께 시청해보세요!</p>
          <div class="input-group">
            <input
              v-model="urlInput"
              type="text"
              placeholder="YouTube URL을 입력하세요"
              @keyup.enter="handleStartWatchParty"
            />
            <button @click="handleStartWatchParty" class="start-btn" :disabled="!isReady">
              시작
            </button>
          </div>
        </div>
      </div>

      <!-- Watch Party 진행 중 - 플레이어 -->
      <div v-else class="player-panel">
        <div class="player-container">
          <iframe
            v-if="state.videoId"
            ref="iframeRef"
            :src="iframeUrl"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
          <div v-if="!playerReady" class="player-loading">
            <div class="spinner"></div>
            <p>플레이어 로딩 중...</p>
          </div>
        </div>

        <!-- 상태 바 -->
        <div class="status-bar">
          <div class="status-left">
            <span v-if="isHost" class="host-badge">호스트</span>
            <span class="info-text">동일한 영상을 함께 시청 중</span>
          </div>
          <div class="status-right">
            <button v-if="isHost" @click="handleEndWatchParty" class="end-btn">
              종료
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.watch-party-page {
  height: 100vh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
}

.title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
  -webkit-app-region: drag;
  user-select: none;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.title .icon {
  font-size: 18px;
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.2);
}

.badge.host {
  background: rgba(255, 215, 0, 0.3);
}

.window-controls {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.control-btn {
  width: 32px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.control-btn.close:hover {
  background: var(--color-error, #e74c3c);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.start-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.start-content {
  text-align: center;
  max-width: 400px;
}

.start-content h2 {
  margin: 0 0 8px;
  font-size: 24px;
  color: var(--text-primary);
}

.start-content p {
  margin: 0 0 24px;
  color: var(--text-secondary);
  font-size: 14px;
}

.input-group {
  display: flex;
  gap: 8px;
}

.input-group input {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 14px;
  outline: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.input-group input:focus {
  border-color: var(--accent-primary);
}

.start-btn {
  padding: 12px 24px;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.start-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.player-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.player-container {
  flex: 1;
  position: relative;
  background: #000;
}

.player-container iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
}

.player-container :deep(iframe) {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.player-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
  color: white;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-bar {
  padding: 10px 16px;
  background: var(--bg-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--border-color);
}

.status-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.host-badge {
  font-size: var(--font-size-xs, 11px);
  padding: 4px 10px;
  border-radius: var(--radius-full, 12px);
  background: var(--gradient-warning, linear-gradient(135deg, #f1c40f 0%, #f39c12 100%));
  color: var(--text-on-warning, #333);
  font-weight: var(--font-weight-semibold, 600);
}

.info-text {
  font-size: var(--font-size-xs, 11px);
  color: var(--text-secondary);
}

.end-btn {
  padding: 6px 16px;
  background: var(--color-error, #e74c3c);
  color: var(--text-on-error, white);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm, 13px);
  font-weight: var(--font-weight-medium, 500);
  cursor: pointer;
  transition: background var(--transition-fast, 0.2s);
}

.end-btn:hover {
  background: var(--color-error-hover, #c0392b);
}
</style>
