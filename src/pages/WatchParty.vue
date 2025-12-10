<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useWatchPartyQueue } from '@/composables/useWatchPartyQueue'
import { useYouTubePlaylist, extractYouTubeVideoId, fetchMultipleVideoMetadata, type VideoMetadata } from '@/composables/useYouTubePlaylist'
import { useStyleSettings } from '@/composables/useStyleSettings'
import { showConfirm } from '@/composables/useCustomDialog'
import { useSignalingServer } from '@/composables/useSignalingServer'
import { useWatchPartyInitialSync } from '@/composables/useWatchPartyInitialSync'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'

defineOptions({ name: 'WatchPartyPage' })

// 스타일 설정 적용 (컬러 템플릿)
useStyleSettings()

const props = defineProps<{
  roomId: string
  youtubeUrl?: string
  userName?: string
}>()

// 디버깅: props 확인
console.log('[WatchParty] Props received:', {
  roomId: props.roomId,
  youtubeUrl: props.youtubeUrl,
  userName: props.userName
})

// YouTube API Key (.env에서 가져오기)
const YOUTUBE_API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || ''

// Yjs 설정
// WatchParty 전용 Y.Doc 생성 (채팅 메시지와 분리)
// 같은 roomId를 사용하지만 문서를 분리하여 불필요한 데이터 동기화 방지
const doc = new Y.Doc({gc: true})
const SIGNALING_SERVER_URL = import.meta.env.VITE_SIGNAL_URLS || 'wss://webrtc.chitchatdimension.com'

let provider: WebrtcProvider | null = null
let persistence: IndexeddbPersistence | null = null

// 시그널링 서버 및 초기 동기화
const SIGNALING_WS_URL = import.meta.env.VITE_SIGNAL_URLS || 'wss://webrtc.chitchatdimension.com'
const signaling = useSignalingServer(SIGNALING_WS_URL)
let initialSync: ReturnType<typeof useWatchPartyInitialSync> | null = null

// 초기 동기화 상태
const isSyncing = ref(false)
const syncStatus = ref<'idle' | 'requesting' | 'receiving' | 'completed' | 'failed'>('idle')
const isResyncingData = ref(false) // 재동기화 중 여부

// 사용자 ID 및 이름
// WatchParty는 자체 UUID 생성 (채팅방과 별개)
const uuid = localStorage.getItem('uuid') || crypto.randomUUID()
if (!localStorage.getItem('uuid')) {
  localStorage.setItem('uuid', uuid)
}
const currentUserId = `user-${uuid}`

// URL 파라미터로 전달된 이름이 있으면 사용, 없으면 localStorage에서
const currentUserName = props.userName || localStorage.getItem('name') || undefined
if (props.userName && localStorage.getItem('name') !== props.userName) {
  localStorage.setItem('name', props.userName)
}
console.log('[WatchParty] Using userName:', currentUserName)

// YouTube IFrame Player (타입은 라이브러리에서 자동 제공)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let player: any = null
const playerReady = ref(false)
const isPlayerSyncing = ref(false) // 동기화 중인지 (무한 루프 방지)

// Queue composable
const queue = ref<ReturnType<typeof useWatchPartyQueue> | null>(null)

// Playlist composable
const { isLoading: isLoadingPlaylist, fetchFromUrl } = useYouTubePlaylist()

// UI 상태
const urlInput = ref('')
const showAddDialog = ref(false)
const videoMetadataCache = ref<Map<string, VideoMetadata>>(new Map())

// 플레이리스트 접기/펼치기 상태
const myQueueCollapsed = ref(false)
const playlistControlCollapsed = ref(false)
const globalQueueCollapsed = ref(false)

// 리사이저 드래그 상태
const isResizing = ref(false)
const myQueueHeight = ref(250) // 기본 높이 (px)
const isResizingPlaylistControl = ref(false)
const playlistControlHeight = ref(200) // 플레이리스트 제어 기본 높이 (px)
const isResizingPlaylist = ref(false)
const playlistWidth = ref(400) // 재생목록 기본 너비 (px)

// 내 대기열 검색 필터
const myQueueFilter = ref('')

// 우클릭 메뉴 상态
const contextMenu = ref<{ x: number; y: number; index: number } | null>(null)

// YouTube Player 초기화
function initYouTubePlayer() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any

  // YouTube IFrame API 로드
  if (!win.YT) {
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    const firstScriptTag = document.getElementsByTagName('script')[0]
    if (firstScriptTag && firstScriptTag.parentNode) {
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
    } else {
      document.head.appendChild(tag)
    }
  }

  // API 준비 대기
  win.onYouTubeIframeAPIReady = () => {
    player = new win.YT.Player('youtube-player', {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        controls: 1,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
      },
    })
  }

  // 이미 로드되어 있으면 바로 생성
  if (win.YT && win.YT.Player) {
    player = new win.YT.Player('youtube-player', {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        controls: 1,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
      },
    })
  }
}

function onPlayerReady() {
  console.log('[Player] Ready')
  playerReady.value = true

  // 현재 재생중인 영상이 있으면 로드 (항상 0초부터 시작)
  if (queue.value?.currentVideo) {
    const videoId = queue.value.currentVideo.videoId
    console.log(`[Player] Loading video from start: ${videoId}`)
    player?.loadVideoById(videoId)
  }
}

function onPlayerStateChange(event: { data: number }) {
  if (isPlayerSyncing.value) return // 동기화 중이면 무시

  const state = event.data
  console.log('[Player] State changed:', state)

  // YouTube Player States:
  // -1 (unstarted)
  // 0 (ended)
  // 1 (playing)
  // 2 (paused)
  // 3 (buffering)
  // 5 (video cued)

  if (state === 0) {
    // 영상 종료 - 다음 곡 재생
    console.log('[Player] Video ended - playing next')
    queue.value?.playNext()
  } else if (state === 1) {
    // 재생
    if (!queue.value?.isPlaying) {
      queue.value?.togglePlayback()
    }
  } else if (state === 2) {
    // 일시정지
    if (queue.value?.isPlaying) {
      queue.value?.togglePlayback()
    }
  }
}

// 큐 상태 변화 감지 -> 플레이어에 반영
watch(
  () => queue.value?.currentVideo,
  (newVideo, oldVideo) => {
    if (!player || !playerReady.value || !newVideo) return
    if (newVideo.videoId === oldVideo?.videoId) return

    console.log('[Player] Loading new video:', newVideo.videoId)
    isPlayerSyncing.value = true

    // 새 영상 로드 시 항상 0초부터 시작
    player.loadVideoById(newVideo.videoId)

    setTimeout(() => {
      isPlayerSyncing.value = false
    }, 1000)
  }
)

watch(
  () => queue.value?.isPlaying,
  (isPlaying) => {
    if (!player || !playerReady.value || isPlayerSyncing.value) return

    console.log('[Player] Sync playback state:', isPlaying)
    isPlayerSyncing.value = true

    if (isPlaying) {
      player.playVideo()
    } else {
      player.pauseVideo()
    }

    setTimeout(() => {
      isPlayerSyncing.value = false
    }, 500)
  }
)

watch(
  () => queue.value?.currentTime,
  (time) => {
    if (!player || !playerReady.value || isPlayerSyncing.value || !time) return

    const currentPlayerTime = player.getCurrentTime()
    const diff = Math.abs(currentPlayerTime - time)

    // 3초 이상 차이나면 동기화
    if (diff > 3) {
      console.log('[Player] Seek to:', time)
      isPlayerSyncing.value = true
      player.seekTo(time, true)

      setTimeout(() => {
        isPlayerSyncing.value = false
      }, 500)
    }
  }
)

// 주기적으로 현재 재생 시간 업데이트
// 모든 사용자가 업데이트하지만, Yjs가 자동으로 충돌 해결
let timeUpdateInterval: number | null = null
let lastReportedTime = 0

function startTimeUpdate() {
  if (timeUpdateInterval) return

  timeUpdateInterval = window.setInterval(() => {
    if (player && playerReady.value && queue.value) {
      const currentTime = player.getCurrentTime()

      // 재생 중이거나, 사용자가 seek해서 시간이 크게 변했을 때 업데이트
      const timeDiff = Math.abs(currentTime - lastReportedTime)
      if (queue.value.isPlaying || timeDiff > 2) {
        queue.value.updateTime(currentTime)
        lastReportedTime = currentTime
      }
    }
  }, 2000) // 2초마다 체크
}

// URL 추가
async function handleAddUrl() {
  if (!urlInput.value.trim() || !queue.value) return

  try {
    const url = urlInput.value.trim()
    const wasEmpty = !queue.value.currentVideoId

    // 재생목록인지 단일 영상인지 확인
    if (url.includes('list=')) {
      // 재생목록
      console.log('[AddUrl] Fetching playlist...')
      const videoIds = await fetchFromUrl(url, YOUTUBE_API_KEY)
      queue.value.addToMyQueue(videoIds)
      console.log(`[AddUrl] Added ${videoIds.length} videos from playlist`)
    } else {
      // 단일 영상
      const videoId = extractYouTubeVideoId(url)
      if (videoId) {
        queue.value.addToMyQueue(videoId)
        console.log('[AddUrl] Added single video:', videoId)
      } else {
        alert('유효한 YouTube URL을 입력해주세요')
        return
      }
    }

    // 현재 재생 중인 영상이 없을 때만 자동 재생 시작
    if (wasEmpty) {
      setTimeout(() => {
        if (queue.value && !queue.value.currentVideoId) {
          queue.value.playFirst()
        }
      }, 100)
    }

    urlInput.value = ''
    showAddDialog.value = false
  } catch (error) {
    console.error('[AddUrl] Error:', error)
    alert('영상을 추가하는데 실패했습니다')
  }
}

// 리사이저 드래그 시작 (내 대기열)
function startResize(e: MouseEvent) {
  isResizing.value = true
  e.preventDefault()

  const startY = e.clientY
  const startHeight = myQueueHeight.value

  const onMouseMove = (moveEvent: MouseEvent) => {
    if (!isResizing.value) return

    const deltaY = moveEvent.clientY - startY
    const newHeight = Math.max(100, Math.min(600, startHeight + deltaY))
    myQueueHeight.value = newHeight
  }

  const onMouseUp = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 플레이리스트 제어 리사이저 드래그 시작
function startResizePlaylistControl(e: MouseEvent) {
  isResizingPlaylistControl.value = true
  e.preventDefault()

  const startY = e.clientY
  const startHeight = playlistControlHeight.value

  const onMouseMove = (moveEvent: MouseEvent) => {
    if (!isResizingPlaylistControl.value) return

    const deltaY = moveEvent.clientY - startY
    const newHeight = Math.max(100, Math.min(400, startHeight + deltaY))
    playlistControlHeight.value = newHeight
  }

  const onMouseUp = () => {
    isResizingPlaylistControl.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 재생목록 너비 조절 리사이저 드래그 시작
function startResizePlaylist(e: MouseEvent) {
  isResizingPlaylist.value = true
  e.preventDefault()

  const startX = e.clientX
  const startWidth = playlistWidth.value

  const onMouseMove = (moveEvent: MouseEvent) => {
    if (!isResizingPlaylist.value) return

    const deltaX = startX - moveEvent.clientX // 반대 방향 (왼쪽으로 드래그하면 넓어짐)
    const newWidth = Math.max(300, Math.min(800, startWidth + deltaX))
    playlistWidth.value = newWidth
  }

  const onMouseUp = () => {
    isResizingPlaylist.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 우클릭 메뉴 표시
function showContextMenu(e: MouseEvent, index: number) {
  e.preventDefault()
  contextMenu.value = {
    x: e.clientX,
    y: e.clientY,
    index
  }
}

// 우클릭 메뉴 숨기기
function hideContextMenu() {
  contextMenu.value = null
}

// 다음 내 차례에 재생하기
function handleMoveToNextMyTurn() {
  if (contextMenu.value !== null && queue.value) {
    queue.value.moveToNextMyTurn(contextMenu.value.index)
  }
  hideContextMenu()
}

// 사용자 재생목록 삭제
async function handleDeleteUserQueue(userId: string) {
  if (!queue.value) return

  const userName = queue.value.userNames.get(userId) || userId.replace('user-', '').slice(0, 8)
  const queueLength = queue.value.userQueues.get(userId)?.length || 0

  const confirmed = await showConfirm(
    `⚠️ "${userName}"의 재생목록(${queueLength}개)을 완전히 삭제합니다.\n\n이 작업은 취소할 수 없습니다. 계속하시겠습니까?`
  )

  if (confirmed) {
    queue.value.deleteUserQueue(userId)
    console.log(`[WatchParty] Deleted queue for user: ${userId}`)
  }
}

// 재생목록 내보내기
function handleExportPlaylist() {
  if (!queue.value) return

  try {
    const jsonData = queue.value.exportMyPlaylist()
    const blob = new Blob([jsonData], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    a.download = `watchparty-playlist-${timestamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    console.log('[WatchParty] Playlist exported')
  } catch (error) {
    console.error('[WatchParty] Failed to export playlist:', error)
    alert('재생목록 내보내기에 실패했습니다')
  }
}

// 재생목록 가져오기
function handleImportPlaylist() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file || !queue.value) return

    try {
      const text = await file.text()
      const success = queue.value.importPlaylist(text, true) // append mode

      if (success) {
        console.log('[WatchParty] Playlist imported')
        // 현재 재생 중인 영상이 없을 때만 자동 재생 시작
        const wasEmpty = !queue.value.currentVideoId
        if (wasEmpty) {
          setTimeout(() => {
            if (queue.value && !queue.value.currentVideoId) {
              queue.value.playFirst()
            }
          }, 100)
        }
      } else {
        alert('유효하지 않은 재생목록 파일입니다')
      }
    } catch (error) {
      console.error('[WatchParty] Failed to import playlist:', error)
      alert('재생목록 가져오기에 실패했습니다')
    }
  }
  input.click()
}

// 메타데이터 로드
async function loadMetadata(videoIds: string[]) {
  const unknownIds = videoIds.filter(id => !videoMetadataCache.value.has(id))

  if (unknownIds.length > 0) {
    console.log(`[Metadata] Loading ${unknownIds.length} videos...`)
    const metadataMap = await fetchMultipleVideoMetadata(unknownIds, YOUTUBE_API_KEY)

    metadataMap.forEach((metadata, videoId) => {
      videoMetadataCache.value.set(videoId, metadata)
    })
  }
}

// 글로벌 큐 변화 감지 -> 메타데이터 로드
watch(
  () => queue.value?.globalQueue,
  async (newQueue) => {
    if (!newQueue) return
    const videoIds = newQueue.map((item: { videoId: string }) => item.videoId)
    await loadMetadata(videoIds)
  },
  { deep: true }
)

// 내 큐 변화 감지 -> 메타데이터 로드
watch(
  () => queue.value?.myQueue,
  async (newQueue) => {
    if (!newQueue) return
    const videoIds = newQueue.map((item: { videoId: string }) => item.videoId)
    await loadMetadata(videoIds)
  },
  { deep: true }
)

// 창 제어
const handleClose = () => {
  window.electronApi?.windowClose()
}

const handleMinimize = () => {
  window.electronApi?.windowMinimize()
}

// 데이터 재동기화 (피어 기준) - IndexedDB 삭제 후 새로고침
async function handleResyncData() {
  if (isResyncingData.value) return

  const confirmed = await showConfirm(
    '🔄 데이터를 피어로부터 다시 동기화합니다.\n\n로컬 데이터가 삭제되고 페이지가 새로고침됩니다.\n계속하시겠습니까?'
  )

  if (!confirmed) return

  try {
    isResyncingData.value = true
    isSyncing.value = true
    syncStatus.value = 'requesting'
    console.log('[WatchParty] Starting data resync...')

    // 1. Queue composable 정리
    queue.value = null

    // 2. 기존 초기 동기화 정리
    if (initialSync) {
      initialSync.dispose()
      initialSync = null
    }

    // 3. WebRTC Provider 정리
    if (provider) {
      provider.disconnect()
      provider.destroy()
      provider = null
    }

    // 4. IndexedDB Persistence 삭제
    if (persistence) {
      persistence.destroy()
      persistence = null
    }

    // 5. Y.Doc 파괴
    doc.destroy()

    // 6. IndexedDB 데이터베이스 삭제
    const dbName = `watchparty-${props.roomId}`
    console.log(`[WatchParty] Deleting IndexedDB: ${dbName}`)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName)
      request.onsuccess = () => {
        console.log('[WatchParty] IndexedDB deleted successfully')
        resolve()
      }
      request.onerror = () => {
        console.error('[WatchParty] Failed to delete IndexedDB')
        reject(request.error)
      }
      request.onblocked = () => {
        console.warn('[WatchParty] IndexedDB deletion blocked')
        resolve() // 차단되어도 계속 진행
      }
    })

    // 7. 시그널링 서버 연결 종료
    signaling.disconnect()

    console.log('[WatchParty] Reloading page for fresh sync...')

    // 8. 페이지 새로고침 - onMounted에서 initialSync가 자동으로 실행됨
    window.location.reload()
  } catch (error) {
    console.error('[WatchParty] Resync failed:', error)
    syncStatus.value = 'failed'
    isResyncingData.value = false
    isSyncing.value = false
    window.electronApi?.showDialog('❌ 데이터 재동기화에 실패했습니다.\n\n페이지를 수동으로 새로고침해주세요.')
  }
}

// 초기화 완료 여부 (렌더링 제어용)
const isInitialized = ref(false)

// 초기화
onMounted(async () => {
  // 1. 먼저 시그널링 서버 연결 및 초기 동기화 시도 (렌더링 전)
  try {
    isSyncing.value = true
    syncStatus.value = 'requesting'
    console.log('[WatchParty] Connecting to signaling server...')
    await signaling.connect()
    console.log('[WatchParty] Signaling server connected')

    // 초기 동기화 composable 생성
    initialSync = useWatchPartyInitialSync(signaling, uuid, doc, props.roomId)

    // 초기 동기화 요청
    console.log('[WatchParty] Requesting initial sync...')
    syncStatus.value = 'receiving'
    const snapshot = await initialSync.requestInitialSync()

    if (snapshot && snapshot.byteLength > 0) {
      console.log(`[WatchParty] Received snapshot: ${(snapshot.byteLength / 1024).toFixed(2)}KB`)
      Y.applyUpdate(doc, snapshot)
      console.log('[WatchParty] Snapshot applied successfully')
      syncStatus.value = 'completed'
    } else {
      console.log('[WatchParty] No existing data - starting fresh')
      syncStatus.value = 'completed'
    }

    // 이후 새 접속자에게 데이터 제공하는 역할
    initialSync.initializeAsProvider()
  } catch (error) {
    console.error('[WatchParty] Initial sync failed:', error)
    syncStatus.value = 'failed'
  } finally {
    isSyncing.value = false
  }

  // 2. 초기 동기화 완료 후 IndexedDB persistence 연결
  // (동기화된 데이터가 있으면 그것을 저장, 없으면 로컬 데이터 로드)
  persistence = new IndexeddbPersistence(`watchparty-${props.roomId}`, doc)

  // 3. WebRTC provider 연결 (실시간 동기화용)
  provider = new WebrtcProvider(`watchparty-${props.roomId}`, doc, {
    signaling: [SIGNALING_SERVER_URL],
  })

  // Awareness에 사용자 정보 설정 (다른 사용자들이 볼 수 있도록)
  // isWatchParty 플래그를 추가하여 접속자 목록에서 필터링
  if (provider) {
    provider.awareness.setLocalStateField('userUuid', uuid)
    if (currentUserName) {
      // 채팅방과 동일한 형식으로 닉네임 생성 (닉네임 + UUID 뒷부분)
      const formattedName = currentUserName.trim() ? `${currentUserName.trim()}${currentUserId.slice(-4)}` : `User ${currentUserId.slice(-4)}`
      provider.awareness.setLocalStateField('nickname', formattedName)
    }
    // WatchParty 피어임을 표시 (접속자 목록에서 제외하기 위함)
    provider.awareness.setLocalStateField('isWatchParty', true)
  }

  // 4. 동기화 완료 후 Queue 초기화 (사용자 이름 전달)
  queue.value = useWatchPartyQueue(doc, currentUserId, currentUserName, provider)

  // 5. 초기화 완료 표시
  isInitialized.value = true

  // 6. YouTube Player 초기화
  await nextTick()
  initYouTubePlayer()

  // 시간 업데이트 시작
  startTimeUpdate()

  // props로 URL이 전달되면 자동 추가
  if (props.youtubeUrl) {
    urlInput.value = props.youtubeUrl
    await handleAddUrl()
  }

  console.log('[WatchParty] Initialized - roomId:', props.roomId)

  // 전역 클릭 이벤트로 컨텍스트 메뉴 닫기
  document.addEventListener('click', hideContextMenu)
})

onUnmounted(() => {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval)
  }
  if (player) {
    player.destroy()
  }
  if (provider) {
    provider.disconnect()
    provider.destroy()
  }
  if (persistence) {
    persistence.destroy()
  }
  // 초기 동기화 정리
  if (initialSync) {
    initialSync.dispose()
    initialSync = null
  }
  // 시그널링 서버 연결 종료
  signaling.disconnect()

  // 이벤트 리스너 제거
  document.removeEventListener('click', hideContextMenu)
})
</script>

<template>
  <div class="watch-party-page">
    <!-- 타이틀 바 -->
    <div class="title-bar">
      <div class="title">
        <span class="icon">📺</span>
        <span>Watch Party - {{ roomId }}</span>
        <!-- 동기화 상태 표시 -->
        <span v-if="isSyncing" class="sync-indicator syncing" title="동기화 중..."></span>
        <span v-else-if="syncStatus === 'completed'" class="sync-indicator connected" title="연결됨"></span>
        <span v-else-if="syncStatus === 'failed'" class="sync-indicator disconnected" title="연결 실패"></span>
      </div>
      <div class="window-controls">
        <button
          @click="handleResyncData"
          class="control-btn resync"
          :disabled="isResyncingData || !isInitialized"
          title="피어 기준 데이터 재동기화"
        >
          🔄
        </button>
        <button @click="handleMinimize" class="control-btn minimize">─</button>
        <button @click="handleClose" class="control-btn close">✕</button>
      </div>
    </div>

    <!-- 초기화 중 로딩 화면 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="!isInitialized" class="loading-overlay">
          <div class="loading-container">
            <div class="loading-spinner-ring"></div>
            <div class="loading-text">
              {{ syncStatus === 'requesting' ? '피어 연결 중...' : syncStatus === 'receiving' ? '데이터 동기화 중...' : '초기화 중...' }}
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <div v-if="isInitialized" class="content" :class="{ resizing: isResizing || isResizingPlaylistControl || isResizingPlaylist }">
      <!-- 왼쪽: 플레이어 -->
      <div class="player-section">
        <div class="player-container">
          <div id="youtube-player"></div>
          <!-- 드래그 중 iframe 이벤트 차단용 오버레이 -->
          <div v-if="isResizing || isResizingPlaylistControl || isResizingPlaylist" class="drag-overlay"></div>
        </div>

        <!-- 재생 컨트롤 -->
        <div class="playback-controls">
          <button @click="queue?.playPrevious()" :disabled="!queue?.currentVideo" class="control-btn prev-btn" title="이전">
            <span class="icon-prev"></span>
          </button>
          <button @click="queue?.togglePlayback()" :disabled="!queue?.currentVideo" class="control-btn play-btn" :title="queue?.isPlaying ? '일시정지' : '재생'">
            <span :class="queue?.isPlaying ? 'icon-pause' : 'icon-play'"></span>
          </button>
          <button @click="queue?.playNext()" :disabled="!queue?.nextVideo" class="control-btn next-btn" title="다음">
            <span class="icon-next"></span>
          </button>

          <div class="current-info">
            <template v-if="queue?.currentVideo">
              <span class="video-title">
                {{ videoMetadataCache.get(queue.currentVideo.videoId)?.title || '로딩 중...' }}
              </span>
            </template>
            <template v-else>
              <span class="no-video">재생 목록이 비어있습니다</span>
            </template>
          </div>
        </div>
      </div>

      <!-- 수직 리사이저 (영상 ↔ 재생목록) -->
      <div
        class="vertical-resizer"
        @mousedown="startResizePlaylist"
        title="드래그하여 크기 조절"
      ></div>

      <!-- 오른쪽: 재생목록들 -->
      <div class="playlist-section" :style="{ width: `${playlistWidth}px` }">
        <div class="playlist-header">
          <h3>재생 목록</h3>
          <div class="header-buttons">
            <button @click="handleImportPlaylist" class="import-btn" title="재생목록 가져오기">📥</button>
            <button @click="handleExportPlaylist" class="export-btn" title="재생목록 내보내기">📤</button>
            <button @click="showAddDialog = true" class="add-btn">+ 추가</button>
          </div>
        </div>

        <div class="queues-container">
          <!-- 내 대기열 -->
          <div class="my-queue" :style="{ height: myQueueCollapsed ? 'auto' : `${myQueueHeight}px` }">
            <div class="queue-header">
              <input type="text" v-model="myQueueFilter" :placeholder="`내 대기열 (${queue?.myQueue.length || 0})`" class="search-input" />
              <div class="header-actions">
                <button
                  @click="queue?.clearMyQueue()"
                  class="clear-btn"
                  :disabled="!queue?.myQueue || queue.myQueue.length === 0"
                  title="비우기"
                >
                  🗑️
                </button>
                <button
                  @click="queue?.shuffleMyQueue()"
                class="shuffle-btn"
                :disabled="!queue?.myQueue || queue.myQueue.length <= 1"
                title="셔플"
              >
                🔀
              </button>
              <button
                @click="myQueueCollapsed = !myQueueCollapsed"
                class="collapse-btn"
                title="접기/펼치기"
              >
                {{ myQueueCollapsed ? '▼' : '▲' }}
              </button>
            </div>
          </div>
          <div v-if="!myQueueCollapsed" class="queue-list">
            <div
              v-for="(item, index) in queue?.myQueue"
              :key="`my-${index}`"
              @contextmenu="showContextMenu($event, index)"
            >
              <div class="queue-item" v-if="!myQueueFilter || videoMetadataCache.get(item.videoId)?.title?.toLowerCase().includes(myQueueFilter.toLowerCase())">
                <div class="reorder-controls">
                  <button
                    @click="queue?.reorderMyQueue(index, index - 1)"
                    class="reorder-btn"
                    :disabled="index === 0"
                    title="위로"
                  >
                    ↑
                  </button>
                  <button
                    @click="queue?.reorderMyQueue(index, index + 1)"
                    class="reorder-btn"
                    :disabled="!queue?.myQueue || index === queue.myQueue.length - 1"
                    title="아래로"
                  >
                    ↓
                  </button>
                </div>
                <img
                  v-if="videoMetadataCache.get(item.videoId)?.thumbnailUrl"
                  :src="videoMetadataCache.get(item.videoId)?.thumbnailUrl"
                  class="thumbnail"
                />
                <div class="item-info">
                  <div class="item-title">
                    {{ videoMetadataCache.get(item.videoId)?.title || item.videoId }}
                  </div>
                  <div class="item-channel">
                    {{ videoMetadataCache.get(item.videoId)?.channelTitle || '' }}
                  </div>
                </div>
                <button @click="queue?.removeFromMyQueue(index)" class="remove-btn">✕</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 수평 리사이저 (내 대기열 ↔ 플레이리스트 제어) -->
        <div
          v-if="!myQueueCollapsed"
          class="resizer"
          @mousedown="startResize"
          title="드래그하여 크기 조절"
        ></div>

        <!-- 플레이리스트 제어 -->
        <div class="playlist-control" :style="{ height: playlistControlCollapsed ? 'auto' : `${playlistControlHeight}px` }">
          <div class="queue-header">
            <h4>플레이리스트 제어 ({{ queue?.allUsers?.length || 0 }})</h4>
            <button
              @click="playlistControlCollapsed = !playlistControlCollapsed"
              class="collapse-btn"
              title="접기/펼치기"
            >
              {{ playlistControlCollapsed ? '▼' : '▲' }}
            </button>
          </div>
          <div v-if="!playlistControlCollapsed" class="user-playlist-toggles">
            <div
              v-for="userId in queue?.allUsers"
              :key="userId"
              class="user-toggle"
            >
              <label class="toggle-label">
                <input
                  type="checkbox"
                  :checked="!queue?.isUserDisabled(userId)"
                  @change="(e) => queue?.toggleUserPlaylist(userId, (e.target as HTMLInputElement).checked)"
                  class="toggle-checkbox"
                />
                <span class="toggle-text">
                  {{ queue?.userNames.get(userId) || userId.replace('user-', '').slice(0, 8) }}
                  <span class="queue-count">({{ queue?.userQueues.get(userId)?.length || 0 }})</span>
                </span>
              </label>
              <button
                @click="handleDeleteUserQueue(userId)"
                class="delete-user-btn"
                title="이 사용자의 재생목록 삭제"
              >
                🗑️
              </button>
            </div>
            <div v-if="!queue?.allUsers || queue.allUsers.length === 0" class="no-users">
              아직 대기열이 없습니다
            </div>
          </div>
        </div>

        <!-- 수평 리사이저 (플레이리스트 제어 ↔ 다음 재생 예정) -->
        <div
          v-if="!playlistControlCollapsed"
          class="resizer"
          @mousedown="startResizePlaylistControl"
          title="드래그하여 크기 조절"
        ></div>

        <!-- 다음 재생 예정 (무한 순환 미리보기) -->
        <div class="global-queue">
          <div class="queue-header">
            <h4>다음 재생 예정 ({{ queue?.globalQueue.length || 0 }}개 미리보기)</h4>
            <button
              @click="globalQueueCollapsed = !globalQueueCollapsed"
              class="collapse-btn"
              title="접기/펼치기"
            >
              {{ globalQueueCollapsed ? '▼' : '▲' }}
            </button>
          </div>
          <div v-if="!globalQueueCollapsed" class="queue-list">
            <div
              v-for="(item, index) in queue?.globalQueue"
              :key="`global-${index}`"
              class="queue-item"
              :class="{
                current: index === 0,
                playing: index === 0 && queue?.isPlaying
              }"
              @click="queue?.playAt(index)"
            >
              <div class="item-index">{{ index === 0 ? '▶' : index }}</div>
              <img
                v-if="videoMetadataCache.get(item.videoId)?.thumbnailUrl"
                :src="videoMetadataCache.get(item.videoId)?.thumbnailUrl"
                class="thumbnail"
              />
              <div class="item-info">
                <div class="item-title">
                  {{ videoMetadataCache.get(item.videoId)?.title || item.videoId }}
                </div>
                <div class="item-channel">
                  {{ videoMetadataCache.get(item.videoId)?.channelTitle || '' }}
                  <span v-if="item.addedBy" class="added-by">• {{ item.addedBy }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>

    <!-- 우클릭 컨텍스트 메뉴 -->
    <div
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <button @click="handleMoveToNextMyTurn" class="context-menu-item">
        ⏭️ 다음 내 차례에 재생
      </button>
    </div>

    <!-- URL 추가 다이얼로그 -->
    <div v-if="showAddDialog" class="dialog-overlay" @click.self="showAddDialog = false">
      <div class="dialog">
        <h3>영상 추가</h3>
        <input
          v-model="urlInput"
          type="text"
          placeholder="YouTube URL 또는 재생목록 URL"
          @keyup.enter="handleAddUrl"
        />
        <div class="dialog-actions">
          <button @click="showAddDialog = false" class="cancel-btn">취소</button>
          <button @click="handleAddUrl" :disabled="isLoadingPlaylist || !urlInput.trim()" class="confirm-btn">
            {{ isLoadingPlaylist ? '로딩 중...' : '추가' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 컬러 템플릿 CSS 변수 매핑 (useStyleSettings가 설정한 변수 사용) */
.watch-party-page {
  /* useStyleSettings의 변수를 WatchParty 내부 변수로 매핑 */
  --wp-bg-primary: var(--bg-primary, #1a1a2e);
  --wp-bg-secondary: var(--bg-secondary, #16213e);
  --wp-bg-tertiary: var(--bg-tertiary, #0f3460);
  --wp-bg-hover: rgba(255, 255, 255, 0.1);
  --wp-accent-primary: var(--color-primary, #818cf8);
  --wp-accent-secondary: var(--color-secondary, #a78bfa);
  --wp-border-color: var(--border-default, rgba(255, 255, 255, 0.1));
  --wp-text-primary: var(--text-primary, #ffffff);
  --wp-text-secondary: var(--text-secondary, rgba(255, 255, 255, 0.7));
  --wp-gradient-start: var(--gradient-start, #667eea);
  --wp-gradient-end: var(--gradient-end, #764ba2);

  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-primary);
  color: var(--wp-text-primary);
  overflow: hidden;
}

.title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-primary);
  color: var(--wp-text-primary);
  -webkit-app-region: drag;
  user-select: none;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  overflow: visible;
}

.title .icon {
  font-size: 18px;
}

/* 동기화 상태 인디케이터 */
.sync-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 8px;
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.sync-indicator.syncing {
  background: #fbbf24;
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.6);
  animation: pulse-glow 1.5s ease-in-out infinite;
}

.sync-indicator.connected {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
}

.sync-indicator.disconnected {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
}

@keyframes pulse-glow {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.2);
  }
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
  color: var(--wp-text-primary);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
}

.control-btn.resync {
  font-size: 14px;
}

.control-btn.resync:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.5);
}

.control-btn.resync:disabled {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.control-btn.close:hover {
  background: #e74c3c;
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 로딩 오버레이 */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.loading-spinner-ring {
  width: 50px;
  height: 50px;
  border: 4px solid var(--color-primary-light);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-text {
  font-size: 16px;
  color: var(--text-primary);
  font-weight: 500;
  text-align: center;
  max-width: 280px;
}

/* 페이드 트랜지션 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  min-height: 0;
  width: 100%;
}

.player-section {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  background: #000;
  min-width: 300px;
  overflow: hidden;
}

.player-container {
  flex: 1 1 0;
  position: relative;
  min-height: 0;
}

#youtube-player {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

/* 드래그 중 iframe 이벤트 차단용 오버레이 */
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 100;
  cursor: ew-resize;
}

/* 리사이징 중 전체 커서 변경 */
.content.resizing {
  cursor: ew-resize;
}

.content.resizing * {
  cursor: ew-resize !important;
}

.playback-controls {
  padding: 12px;
  background: var(--wp-bg-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--wp-border-color);
}

.playback-controls .control-btn {
  width: 40px;
  height: 40px;
  font-size: 18px;
  background: var(--wp-accent-primary);
  color: var(--wp-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.playback-controls .control-btn:hover:not(:disabled) {
  background: var(--wp-accent-secondary);
  transform: scale(1.05);
}

.playback-controls .control-btn:active:not(:disabled) {
  transform: scale(0.95);
}

/* 이전 버튼 아이콘 */
.icon-prev {
  display: flex;
  align-items: center;
  gap: 1px;
}

.icon-prev::before {
  content: '';
  display: block;
  width: 2px;
  height: 10px;
  background: currentColor;
}

.icon-prev::after {
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 5px 7px 5px 0;
  border-color: transparent currentColor transparent transparent;
}

/* 다음 버튼 아이콘 */
.icon-next {
  display: flex;
  align-items: center;
  gap: 1px;
}

.icon-next::before {
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 5px 0 5px 7px;
  border-color: transparent transparent transparent currentColor;
}

.icon-next::after {
  content: '';
  display: block;
  width: 2px;
  height: 10px;
  background: currentColor;
}

/* 재생 버튼 아이콘 */
.icon-play {
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 6px 0 6px 10px;
  border-color: transparent transparent transparent currentColor;
  margin-left: 2px;
}

/* 일시정지 버튼 아이콘 */
.icon-pause {
  display: flex;
  gap: 3px;
}

.icon-pause::before,
.icon-pause::after {
  content: '';
  display: block;
  width: 3px;
  height: 10px;
  background: currentColor;
  border-radius: 1px;
}

.current-info {
  flex: 1;
  margin-left: 12px;
  overflow: hidden;
}

.video-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wp-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.no-video {
  font-size: 14px;
  color: var(--wp-text-secondary);
}

.vertical-resizer {
  flex: 0 0 8px;
  background: var(--wp-bg-tertiary);
  cursor: ew-resize;
  border-left: 1px solid var(--wp-border-color);
  border-right: 1px solid var(--wp-border-color);
  transition: background 0.2s;
}

.vertical-resizer:hover {
  background: var(--wp-accent-primary);
}

.playlist-section {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-secondary);
  overflow: hidden;
  min-width: 300px;
  max-width: 800px;
  height: 100%;
}

.playlist-header {
  flex-shrink: 0;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--wp-border-color);
}

.playlist-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--wp-text-primary);
}

.queues-container {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.header-buttons {
  display: flex;
  gap: 6px;
  align-items: center;
}

.add-btn,
.import-btn,
.export-btn {
  padding: 6px 12px;
  background: var(--wp-accent-primary);
  color: var(--wp-text-primary);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.import-btn,
.export-btn {
  padding: 6px 10px;
  font-size: 16px;
}

.add-btn:hover,
.import-btn:hover,
.export-btn:hover {
  opacity: 0.9;
  transform: scale(1.05);
}

.my-queue {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 60px;
  overflow: hidden;
}

.global-queue {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 60px;
  overflow: hidden;
}

.resizer {
  width: 100%;
  height: 8px;
  background: var(--wp-bg-tertiary);
  cursor: ns-resize;
  flex-shrink: 0;
  border-top: 1px solid var(--wp-border-color);
  border-bottom: 1px solid var(--wp-border-color);
  transition: background 0.2s;
}

.resizer:hover {
  background: rgba(129, 140, 248, 0.2);
}

.queue-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--wp-border-color);
  background: var(--wp-bg-secondary);
}

.queue-header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--wp-text-primary);
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.search-input {
  padding: 6px 12px;
  border: 1px solid var(--wp-border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  width: 100%;
  margin-right: 6px;
}

.clear-btn {
  padding: 4px 12px;
  background: #e74c3c;
  color: var(--wp-text-primary);
  border: none;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-btn:hover:not(:disabled) {
  opacity: 0.8;
  transform: scale(1.05);
}

.clear-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.shuffle-btn {
  padding: 4px 12px;
  background: var(--wp-accent-primary);
  color: var(--wp-text-primary);
  border: none;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.shuffle-btn:hover:not(:disabled) {
  opacity: 0.8;
  transform: scale(1.05);
}

.shuffle-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.collapse-btn {
  padding: 4px 8px;
  background: var(--wp-bg-tertiary);
  color: var(--wp-text-primary);
  border: 1px solid var(--wp-border-color);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1;
}

.collapse-btn:hover {
  background: var(--wp-bg-hover);
  transform: scale(1.05);
}

.my-queue h4,
.global-queue h4 {
  margin: 0;
  font-size: 14px;
  color: var(--wp-text-secondary);
}

.queue-list {
  flex: 1 1 0;
  overflow-y: auto;
  min-height: 0;
}

.queue-item {
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--wp-border-color);
  cursor: pointer;
  transition: background 0.2s;
}

.queue-item:hover {
  background: var(--wp-bg-hover);
}

.queue-item.current {
  background: rgba(129, 140, 248, 0.1);
  border-left: 3px solid var(--wp-accent-primary);
}

.queue-item.playing {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.item-index {
  width: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--wp-text-secondary);
  font-weight: 600;
}

.thumbnail {
  width: 60px;
  height: 34px;
  object-fit: cover;
  border-radius: 4px;
  background: #000;
}

.item-info {
  flex: 1;
  overflow: hidden;
}

.item-title {
  font-size: 13px;
  color: var(--wp-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.item-channel {
  font-size: 11px;
  color: var(--wp-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.added-by {
  font-size: 10px;
  color: var(--wp-accent-secondary);
  opacity: 0.9;
}

.reorder-controls {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.reorder-btn {
  width: 20px;
  height: 16px;
  border: none;
  background: var(--wp-bg-secondary);
  color: var(--wp-text-primary);
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 0;
  line-height: 1;
}

.reorder-btn:hover:not(:disabled) {
  background: var(--wp-accent-primary);
  color: var(--wp-text-primary);
}

.reorder-btn:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}

.remove-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: #e74c3c;
  color: var(--wp-text-primary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.queue-item:hover .remove-btn {
  opacity: 1;
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--wp-bg-primary);
  padding: 24px;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.dialog h3 {
  margin: 0 0 16px;
  font-size: 18px;
  color: var(--wp-text-primary);
}

.dialog input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--wp-border-color);
  border-radius: 4px;
  font-size: 14px;
  background: var(--wp-bg-secondary);
  color: var(--wp-text-primary);
  margin-bottom: 16px;
}

.dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.cancel-btn,
.confirm-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: opacity 0.2s;
}

.cancel-btn {
  background: var(--wp-bg-secondary);
  color: var(--wp-text-primary);
}

.confirm-btn {
  background: var(--wp-accent-primary);
  color: var(--wp-text-primary);
}

.cancel-btn:hover,
.confirm-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 우클릭 컨텍스트 메뉴 */
.context-menu {
  position: fixed;
  background: var(--wp-bg-secondary);
  border: 1px solid var(--wp-border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  min-width: 180px;
  padding: 4px 0;
  overflow: hidden;
}

.context-menu-item {
  width: 100%;
  padding: 10px 16px;
  background: none;
  border: none;
  color: var(--wp-text-primary);
  text-align: left;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.context-menu-item:hover {
  background: var(--wp-bg-hover);
}

/* 플레이리스트 제어 */
.playlist-control {
  background: var(--wp-bg-secondary);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  min-height: 50px;
  overflow: hidden;
}

.user-playlist-toggles {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  overflow-y: auto;
  flex: 1;
}

.user-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 4px;
  transition: background 0.2s;
  flex: 1;
}

.toggle-label:hover {
  background: var(--wp-bg-hover);
}

.delete-user-btn {
  padding: 4px 8px;
  background: #e74c3c;
  color: var(--wp-text-primary);
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.delete-user-btn:hover {
  opacity: 0.8;
  transform: scale(1.05);
}

.toggle-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--wp-accent-primary);
}

.toggle-text {
  font-size: 13px;
  color: var(--wp-text-primary);
  user-select: none;
}

.queue-count {
  font-size: 11px;
  color: var(--wp-text-secondary);
  margin-left: 4px;
}

.no-users {
  text-align: center;
  color: var(--wp-text-secondary);
  font-size: 12px;
  padding: 12px;
}
</style>
