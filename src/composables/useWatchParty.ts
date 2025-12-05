import { ref, computed, readonly } from 'vue'
import * as Y from 'yjs'

// Watch Party 상태 인터페이스
export interface WatchPartyState {
  isActive: boolean
  videoId: string | null
  videoUrl: string | null
  hostId: string | null
  hostName: string | null
  currentTime: number
  isPlaying: boolean
  lastEventTime: number
  eventType: 'play' | 'pause' | 'seek' | 'start' | 'end' | null
}

// 동기화 허용 오차 (초)
export const SYNC_THRESHOLD = 2

// Watch Party 인스턴스 캐시
const watchPartyInstances = new Map<string, ReturnType<typeof createWatchPartyInstance>>()

function createWatchPartyInstance(doc: Y.Doc, currentUserId: string, currentUserName: string) {
  const watchPartyMap = doc.getMap<unknown>('watchParty')

  // 상태
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
  const isParticipant = computed(() => state.value.isActive && !isHost.value)

  // 외부 이벤트 콜백
  let onRemoteEvent: ((state: WatchPartyState) => void) | null = null

  // Yjs에서 상태 로드
  const loadStateFromYjs = () => {
    const yjsState = watchPartyMap.get('state') as WatchPartyState | undefined
    if (yjsState) {
      state.value = { ...yjsState }
    }
  }

  // Yjs에 상태 저장
  const saveStateToYjs = () => {
    watchPartyMap.set('state', { ...state.value })
  }

  // Yjs 상태 변경 감지
  watchPartyMap.observe(() => {
    const yjsState = watchPartyMap.get('state') as WatchPartyState | undefined
    if (yjsState) {
      const prevEventTime = state.value.lastEventTime
      state.value = { ...yjsState }

      // 참가자에게 원격 이벤트 전달 (새 이벤트인 경우만)
      if (!isHost.value && onRemoteEvent && yjsState.lastEventTime !== prevEventTime) {
        onRemoteEvent(yjsState)
      }
    }
  })

  // 원격 이벤트 리스너 등록
  const setRemoteEventListener = (callback: (state: WatchPartyState) => void) => {
    onRemoteEvent = callback
  }

  // Watch Party 시작 (호스트)
  const startWatchParty = (videoId: string, videoUrl: string) => {
    doc.transact(() => {
      state.value = {
        isActive: true,
        videoId,
        videoUrl,
        hostId: currentUserId,
        hostName: currentUserName,
        currentTime: 0,
        isPlaying: false,
        lastEventTime: Date.now(),
        eventType: 'start'
      }
      saveStateToYjs()
    })
    console.log('[WatchParty] Started:', videoId)
    return { ...state.value }
  }

  // Watch Party 종료
  const endWatchParty = () => {
    doc.transact(() => {
      state.value = {
        isActive: false,
        videoId: null,
        videoUrl: null,
        hostId: null,
        hostName: null,
        currentTime: 0,
        isPlaying: false,
        lastEventTime: Date.now(),
        eventType: 'end'
      }
      saveStateToYjs()
    })
    console.log('[WatchParty] Ended')
  }

  // 플레이어 이벤트 브로드캐스트 (호스트만)
  const broadcastEvent = (eventType: 'play' | 'pause' | 'seek', currentTime: number) => {
    if (!isHost.value || !state.value.isActive) return

    doc.transact(() => {
      state.value.eventType = eventType
      state.value.currentTime = currentTime
      state.value.isPlaying = eventType === 'play'
      state.value.lastEventTime = Date.now()
      saveStateToYjs()
    })
    console.log('[WatchParty] Broadcast:', eventType, currentTime)
  }

  // 시간 동기화 필요 여부 확인
  const needsTimeSync = (localTime: number): boolean => {
    return Math.abs(localTime - state.value.currentTime) > SYNC_THRESHOLD
  }

  // 초기 로드
  loadStateFromYjs()

  return {
    state: readonly(state),
    isHost,
    isParticipant,
    startWatchParty,
    endWatchParty,
    broadcastEvent,
    needsTimeSync,
    setRemoteEventListener,
    SYNC_THRESHOLD
  }
}

// Watch Party 컴포저블
export function useWatchParty(doc: Y.Doc, currentUserId: string, currentUserName: string) {
  // 캐시 키에 doc.guid 포함 → 채팅방마다 별도 인스턴스
  const roomId = doc.guid || 'default'
  const cacheKey = `${roomId}:${currentUserId}`

  if (!watchPartyInstances.has(cacheKey)) {
    watchPartyInstances.set(cacheKey, createWatchPartyInstance(doc, currentUserId, currentUserName))
  }

  return watchPartyInstances.get(cacheKey)!
}

// YouTube URL에서 Video ID 추출
export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/  // Video ID만 입력한 경우
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) return match[1]
  }
  return null
}

// 인스턴스 정리 (언마운트 시)
export function clearWatchPartyInstance(roomId: string, currentUserId: string) {
  const cacheKey = `${roomId}:${currentUserId}`
  watchPartyInstances.delete(cacheKey)
}
