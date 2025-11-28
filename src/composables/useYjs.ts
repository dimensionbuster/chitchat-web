import * as Y from 'yjs'
import { readonly, ref } from 'vue'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { ChatMessage, FileMeta } from '@/types/types'
import { useFileTransferProgress } from './useFileTransferProgress'
import { useInitialSync } from './useInitialSync.v3'
import { useSignalingServer } from './useSignalingServer'

const DEFAULT_VISIBLE_MESSAGES = 50
const LOAD_MORE_COUNT = 30
const ROOM_ID = 'default-room'

// 성능 최적화 설정
const SORT_DEBOUNCE_MS = 100  // 디바운싱: 100ms 내 여러 변경사항을 한 번에 처리
const SORT_WINDOW = 300        // 대용량 메시지 시 최근 N개만 정렬

const SIGNAL_URLS = (import.meta.env.VITE_SIGNAL_URLS || '')
  .split(',')
  .map((url: string) => url.trim())
  .filter(Boolean)

const SIGNALING_SERVER_URL = import.meta.env.VITE_SIGNAL_URLS || 'wss://webrtc.chitchatdimension.com'

const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.l.google.com:5349" },
    { urls: "stun:stun1.l.google.com:3478" },
    { urls: "stun:stun1.l.google.com:5349" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:5349" },
    { urls: "stun:stun3.l.google.com:3478" },
    { urls: "stun:stun3.l.google.com:5349" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:5349" }
]

const yjsInstances = new Map<string, ReturnType<typeof createYjsInstance>>()

const waitForSync = (provider: WebrtcProvider) =>
  new Promise<void>((resolve) => {
    provider.on('synced', (event: { synced: boolean }) => {
      if (event.synced) resolve()
    })
    setTimeout(resolve, 3000) // 3초 타임아웃
  })

async function createYjsInstance(roomId: string) {
  const doc = new Y.Doc()

  // 🔄 마이그레이션: Y.Array → Y.Map (기존 데이터 있으면 자동 전환)
  const oldMessages = doc.getArray<ChatMessage>('messages')
  const messagesMap = doc.getMap<ChatMessage>('messagesMap')
  const files = doc.getMap<FileMeta>('files')

  // 🕐 Lamport 논리적 시계 (메시지 순서 보장)
  let lamportClock = 0

  const updateLamportClock = (receivedClock?: number) => {
    if (receivedClock !== undefined) {
      lamportClock = Math.max(lamportClock, receivedClock) + 1
    } else {
      lamportClock += 1
    }
    return lamportClock
  }

  // 정렬된 전체 메시지 배열 (타임스탬프 순)
  const sortedMessagesRef = ref<ChatMessage[]>([])

  // 현재 표시할 메시지 수 (기본 50개)
  const visibleMessageCount = ref(DEFAULT_VISIBLE_MESSAGES)

  // 표시할 메시지 (최근 N개)
  const displayedMessages = ref<ChatMessage[]>([])

  // 🔥 디바운싱을 위한 타이머
  let sortTimeout: ReturnType<typeof setTimeout> | null = null

  // 🔥 최적화된 정렬 함수 (디바운싱 + 부분 정렬)
  const updateSortedMessages = () => {
    const allMessages = Array.from(messagesMap.values())

    // Lamport 시계 값을 최대값으로 업데이트 (다른 피어의 메시지 수신 시)
    allMessages.forEach(msg => {
      if (msg.lamport > lamportClock) {
        lamportClock = msg.lamport
      }
    })

    // 하이브리드 정렬: 물리적 시간 우선, 같은 시간대(2분)면 Lamport로 인과관계 보장
    const sortMessages = (msgs: ChatMessage[]) =>
      msgs.sort((a, b) => {
        const timeDiff = Math.abs(a.ts - b.ts)
        const TIME_WINDOW = 60000 // 1분 (60,000ms)

        // 1. 시간 차이가 2분 이상이면 물리적 시간 우선
        if (timeDiff > TIME_WINDOW) return a.ts - b.ts
        // 2. 2분 이내(동시 발생)면 Lamport로 인과관계 순서 보장
        if (a.lamport !== b.lamport) return a.lamport - b.lamport
        // 3. 최종 결정자: 물리적 시간 → ID
        if (a.ts !== b.ts) return a.ts - b.ts
        return a.id.localeCompare(b.id)
      })

    // 메시지가 적으면 전체 정렬
    if (allMessages.length <= SORT_WINDOW) {
      sortedMessagesRef.value = sortMessages(allMessages)
    } else {
      // 대용량: 최근 메시지만 정렬 (오래된 메시지는 이미 정렬되어 있다고 가정)
      const oldMessages = allMessages.slice(0, -SORT_WINDOW)
      const recentMessages = sortMessages(allMessages.slice(-SORT_WINDOW))
      sortedMessagesRef.value = [...oldMessages, ...recentMessages]
    }

    // 사용자가 최신 메시지를 보고 있을 때만 자동으로 업데이트
    if (visibleMessageCount.value >= sortedMessagesRef.value.length ||
        visibleMessageCount.value === DEFAULT_VISIBLE_MESSAGES) {
      displayedMessages.value = sortedMessagesRef.value.slice(-visibleMessageCount.value)
    }
  }

  // 🔥 디바운스된 observe: 연속된 변경사항을 그룹화하여 한 번만 정렬
  messagesMap.observe(() => {
    if (sortTimeout) clearTimeout(sortTimeout)
    sortTimeout = setTimeout(() => {
      updateSortedMessages()
    }, SORT_DEBOUNCE_MS)
  })

  const messagesRef = readonly(displayedMessages)

  // IndexedDB 로드
  console.log('[#1] Yjs 초기화: IndexedDB 로드 중...')
  const persistence = new IndexeddbPersistence(`ydb-${roomId}`, doc)

  await new Promise<void>((resolve) => {
    persistence.once('synced', () => {
      // 마이그레이션: Y.Array → Y.Map + Lamport 시계 추가
      if (oldMessages.length > 0 && messagesMap.size === 0) {
        doc.transact(() => {
          oldMessages.toArray().forEach((msg, index) => {
            const messageId = msg.id || `${msg.ts}-${crypto.randomUUID()}`
            // 기존 메시지에 lamport 값이 없으면 타임스탬프 기준으로 생성
            const existingLamport = 'lamport' in msg ? (msg as ChatMessage).lamport : undefined
            const lamport = existingLamport ?? index
            messagesMap.set(messageId, { ...msg, id: messageId, lamport })
          })
        })
      }

      // Lamport 시계가 없는 기존 메시지에 추가
      let needsUpdate = false
      const updates: [string, ChatMessage][] = []
      messagesMap.forEach((msg, id) => {
        if (!('lamport' in msg)) {
          needsUpdate = true
          // 타임스탬프 기준으로 정렬된 순서를 lamport 값으로 사용
          updates.push([id, msg])
        }
      })

      if (needsUpdate) {
        doc.transact(() => {
          // 타임스탬프 순으로 정렬하여 lamport 값 할당
          updates.sort((a, b) => a[1].ts - b[1].ts)
          updates.forEach(([id, msg], index) => {
            messagesMap.set(id, { ...msg, lamport: index })
          })
        })
        console.log(`[#2-1] Lamport 마이그레이션: ${updates.length}개 메시지 업데이트`)
      }

      updateSortedMessages()
      console.log(`[#2] IndexedDB 로드 완료: 메시지 ${messagesMap.size}개, 파일 ${files.size}개`)
      resolve()
    })
  })

  // WebRTC provider 생성 (초기에는 연결하지 않음 - 초기 동기화 후 connect 호출)
  console.log('[#3] WebRTC Provider 생성')
  const provider = new WebrtcProvider(roomId, doc, {
    signaling: [SIGNAL_URLS],
    peerOpts: {
      config: {
        iceServers,
        // 연결 유지 설정 강화
        iceCandidatePoolSize: 10, // ICE 후보 미리 수집
      },
    },
  })

  // 초기 연결 방지 - 초기 동기화 후 수동 connect
  provider.disconnect()

  _setupProviderListeners(provider)
  _setupBackgroundConnectionMonitor(provider)

  const sendTextMessage = (authorTrueUuid: string, authorName: string, text: string) => {
    if (!text.trim()) return
    const timestamp = Date.now()
    const lamport = updateLamportClock()
    const messageId = `${timestamp}-${crypto.randomUUID()}`
    messagesMap.set(messageId, {
      id: messageId,
      authorTrueUuid,
      authorName,
      text,
      ts: timestamp,
      lamport,
    })
  }

  const exportSnapshot = () => {
    console.log('[Yjs] 스냅샷 내보내기 요청')
    const snapshot = Y.encodeStateAsUpdate(doc)
    return snapshot
  }

  const importSnapshot = (snapshot: Uint8Array) => {
    console.log('[Yjs] 스냅샷 가져오기 요청')
    Y.applyUpdate(doc, snapshot)
  }

  const attachFileMeta = (fileId: string, meta: FileMeta, authorTrueUuid: string, authorName = authorTrueUuid) => {
    files.set(fileId, meta)
    const timestamp = Date.now()
    const lamport = updateLamportClock()
    const messageId = `${timestamp}-${crypto.randomUUID()}`
    messagesMap.set(messageId, {
      id: messageId,
      authorTrueUuid,
      authorName,
      fileId,
      ts: timestamp,
      lamport,
    })
  }

  const requestFile = (fileId: string, requesterUuid: string, receivedChunks: number[] = [], targetUuid?: string) => {
    const resumeMsg = receivedChunks.length ? ` (이어받기: ${receivedChunks.length}개)` : ''
    const targetMsg = targetUuid ? ` → ${targetUuid.slice(-8)}` : ''
    console.log(`[#4] 파일 요청${resumeMsg}${targetMsg}: ${fileId}`)
    provider.awareness.setLocalStateField('fileRequest', { fileId, requesterUuid, timestamp: Date.now(), receivedChunks, targetUuid })
    setTimeout(() => provider.awareness.setLocalStateField('fileRequest', null), 5000)
  }

  const respondFile = (fileId: string, fileData: string, targetUuid: string, skipChunks: number[] = [], onComplete?: () => void) => {
    _respondFile(provider, doc, files, fileId, fileData, targetUuid, skipChunks, onComplete)
  }

  const getTransferMap = (key: string) => doc.getMap<string>(key)

  // 이전 메시지 로드 (스크롤 위로)
  const loadMoreMessages = () => {
    const totalMessages = sortedMessagesRef.value.length
    if (visibleMessageCount.value >= totalMessages) return false

    const newCount = Math.min(visibleMessageCount.value + LOAD_MORE_COUNT, totalMessages)
    visibleMessageCount.value = newCount
    displayedMessages.value = sortedMessagesRef.value.slice(-newCount)
    return true
  }

  // 최신 메시지로 리셋
  const resetToLatest = () => {
    visibleMessageCount.value = DEFAULT_VISIBLE_MESSAGES
    displayedMessages.value = sortedMessagesRef.value.slice(-DEFAULT_VISIBLE_MESSAGES)
  }

  // 현재 최신 메시지를 보고 있는지 확인
  const isViewingLatest = () => {
    return visibleMessageCount.value === DEFAULT_VISIBLE_MESSAGES ||
           visibleMessageCount.value >= sortedMessagesRef.value.length
  }

  const forceResync = async () => {
    try {
      provider.disconnect()
      provider.destroy()
      doc.transact(() => {
        messagesMap.clear()
        files.clear()
      })
      await persistence.clearData()
      persistence.destroy()
      yjsInstances.delete(roomId)
      doc.destroy()
      console.log('[Yjs] 재동기화 완료')
      return true
    } catch (error) {
      console.error('[Yjs] 재동기화 실패:', error)
      return false
    }
  }

  const instance = {
    doc,
    provider,
    persistence,
    messagesMap,
    messagesRef,
    files,
    sendTextMessage,
    attachFileMeta,
    requestFile,
    respondFile,
    getTransferMap,
    loadMoreMessages,
    resetToLatest,
    isViewingLatest,
    forceResync,
    exportSnapshot,
    importSnapshot,
  }

  return instance
}

const setUserAwareness = (provider: WebrtcProvider, userUuid?: string, nickname?: string) => {
  // 🔥 setLocalState로 한 번에 설정 (전파 효율성)
  const currentState = provider.awareness.getLocalState() || {}
  const newState = { ...currentState }

  if (userUuid) {
    newState.userUuid = userUuid
  }
  if (nickname) {
    newState.nickname = nickname
    // user 객체도 함께 설정 (호환성)
    newState.user = { uuid: userUuid || newState.userUuid, nickname }
  }

  provider.awareness.setLocalState(newState)
}

/**
 * Keepalive 메커니즘: 주기적으로 awareness 갱신하여 연결 유지
 *
 * WebRTC는 idle 상태가 지속되면 연결을 정리할 수 있습니다.
 * 주기적으로 작은 데이터를 전송하여 연결이 활성 상태임을 유지합니다.
 */
function _setupKeepalive(provider: WebrtcProvider) {
  const KEEPALIVE_INTERVAL = 30000 // 30초마다 keepalive

  const keepaliveInterval = setInterval(() => {
    if (provider.connected) {
      // awareness heartbeat 전송
      provider.awareness.setLocalStateField('keepalive', Date.now())

      // 디버깅용 로그 (필요시 주석 해제)
      console.log('[Yjs] Keepalive 전송')
    }
  }, KEEPALIVE_INTERVAL)

  // 정리 함수
  return () => {
    clearInterval(keepaliveInterval)
  }
}

export async function useYjs(roomId = ROOM_ID, userUuid?: string, nickname?: string) {
  const cached = yjsInstances.get(roomId)
  if (cached) {
    const instance = await cached
    setUserAwareness(instance.provider, userUuid, nickname)
    if (!instance.provider.connected) {
      instance.provider.connect()
    }
    return instance
  }

  const instancePromise = createYjsInstance(roomId)
  yjsInstances.set(roomId, instancePromise)
  const instance = await instancePromise
  setUserAwareness(instance.provider, userUuid, nickname)

  // 🔥 시그널링 서버를 통한 초기 동기화 (userUuid가 있을 때만)
  if (userUuid) {
    // 시그널링 서버 연결
    const signaling = useSignalingServer(SIGNALING_SERVER_URL)
    await signaling.connect()

    console.log('[#3-1] 시그널링 서버 연결됨')

    // y-webrtc awareness만 연결 (doc sync 없이)
    instance.provider.awareness.setLocalState({
      userUuid,
      nickname, // 🔥 최상위에도 설정 (호환성)
      user: { uuid: userUuid, nickname }
    })

    // 초기 동기화 composable 생성
    const { requestInitialSync, initializeAsProvider } = useInitialSync(
      signaling,
      userUuid,
      instance.doc,
      roomId
    )

    // 🔥 항상 요청 리스너 등록 (새 접속자의 요청에 응답하기 위해)
    initializeAsProvider()

    // 🔥 doc이 비어있는지 확인 (새 접속자 판단)
    const isNewUser = instance.messagesMap.size === 0

    console.log(`[#3-2] 초기화 상태: ${isNewUser ? '신규 접속' : '기존 데이터 있음'} (메시지 ${instance.messagesMap.size}개)`)

    if (isNewUser) {
      // 🔥 신규 접속자: 시그널링 서버를 통해 초기 상태 요청
      console.log('[#3-3] 초기 동기화 시작')

      const snapshot = await requestInitialSync()

      if (snapshot) {
        // 스냅샷 적용
        console.log(`[#3-4] 초기 스냅샷 적용 중... (${(snapshot.byteLength / 1024 / 1024).toFixed(2)}MB)`)
        try {
          const beforeSize = instance.messagesMap.size
          Y.applyUpdate(instance.doc, snapshot)
          const afterSize = instance.messagesMap.size
          const addedMessages = afterSize - beforeSize

          console.log(`[#3-5] ✅ 초기 스냅샷 적용 완료!`)
          console.log(`  - 이전 메시지: ${beforeSize}개`)
          console.log(`  - 현재 메시지: ${afterSize}개`)
          console.log(`  - 추가된 메시지: ${addedMessages}개`)

          // 적용 후 UI 업데이트 대기
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (error) {
          console.error('[#3-5] ❌ 초기 스냅샷 적용 실패:', error)
        }
      } else {
        console.log('[#3-4] 초기 스냅샷 없음 - 빈 채팅방')
      }

      // 🔥 초기 상태 받은 후 y-webrtc 연결 (증분 동기화용)
      console.log('[#3-6] y-webrtc 연결 시작 (증분 동기화)')
      instance.provider.connect()
    } else {
      // 🔥 기존 사용자: y-webrtc 증분 동기화
      console.log('[#3-3] 기존 데이터 있음 - y-webrtc 증분 동기화 시작')
      instance.provider.connect()
    }

    // Keepalive 시작
    _setupKeepalive(instance.provider)

    // y-webrtc 동기화 대기
    console.log('[#3-7] y-webrtc 동기화 대기')
    await waitForSync(instance.provider)
  }

  return instance
}

// ========== 헬퍼 함수들 ==========

function _setupProviderListeners(provider: WebrtcProvider) {
  provider.on('peers', (event: { added: string[]; removed: string[]; webrtcPeers: string[] }) => {
    if (event.added.length > 0) {
      console.log(`[#6] 피어 연결: ${event.webrtcPeers.length}명`)
    }
  })

  provider.on('synced', (event: { synced: boolean }) => {
    if (event.synced) {
      console.log('[#7] Yjs 동기화 완료')
    }
  })
}

/**
 * 백그라운드 연결 모니터링 및 자동 재연결
 *
 * 문제:
 * - 브라우저/Electron이 백그라운드 탭의 WebRTC 연결을 정리할 수 있음
 * - Y-webrtc는 연결 끊김을 자동으로 복구하지 않음
 *
 * 해결:
 * - visibility change 이벤트로 백그라운드 진입/복귀 감지
 * - 주기적 연결 상태 체크 (heartbeat)
 * - 연결 끊김 감지 시 자동 재연결
 */
function _setupBackgroundConnectionMonitor(provider: WebrtcProvider) {
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null
  let reconnectAttempts = 0
  const MAX_RECONNECT_ATTEMPTS = 5
  const HEARTBEAT_INTERVAL = 10000 // 10초마다 연결 상태 체크
  const RECONNECT_DELAY = 2000 // 2초 후 재연결 시도

  // 연결 상태 체크
  const checkConnection = () => {
    if (!provider.connected) {
      console.warn(`[Yjs] 연결 끊김 감지 (시도: ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`)

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++

        // 재연결 시도
        setTimeout(() => {
          console.log('[Yjs] 재연결 시도...')
          provider.connect()

          // 재연결 성공 여부 확인
          setTimeout(() => {
            if (provider.connected) {
              console.log('[Yjs] 재연결 성공')
              reconnectAttempts = 0
            } else {
              console.warn('[Yjs] 재연결 실패')
            }
          }, 3000)
        }, RECONNECT_DELAY)
      } else {
        console.error('[Yjs] 최대 재연결 시도 횟수 초과')
      }
    } else {
      // 연결되어 있으면 카운터 리셋
      reconnectAttempts = 0
    }
  }

  // 주기적 heartbeat 시작
  const startHeartbeat = () => {
    if (heartbeatInterval) return

    console.log('[Yjs] 연결 모니터링 시작')
    heartbeatInterval = setInterval(checkConnection, HEARTBEAT_INTERVAL)
  }

  // heartbeat 중지
  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
      console.log('[Yjs] 연결 모니터링 중지')
    }
  }

  // Page Visibility API: 백그라운드/포그라운드 전환 감지
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('[Yjs] 백그라운드로 전환')
        // 백그라운드에서도 heartbeat 유지 (연결 상태 모니터링)
      } else {
        console.log('[Yjs] 포그라운드로 복귀')
        // 즉시 연결 상태 확인
        checkConnection()
      }
    })
  }

  // provider 연결 상태 변경 이벤트
  provider.on('status', (event: { connected: boolean }) => {
    if (event.connected) {
      console.log('[Yjs] Provider 연결됨')
      reconnectAttempts = 0
    } else {
      console.warn('[Yjs] Provider 연결 끊김')
      checkConnection()
    }
  })

  // 초기 heartbeat 시작
  startHeartbeat()

  // 정리 함수 (필요시 호출)
  return () => {
    stopHeartbeat()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', checkConnection)
    }
  }
}

const CHUNK_SIZE = 64 * 1024
const SEND_DELAY = 10 // 청크 전송 간 고정 딜레이

const checkTargetPeerConnected = (provider: WebrtcProvider, targetUuid: string): boolean => {
  for (const [, state] of provider.awareness.getStates()) {
    const stateObj = state as Record<string, unknown>
    if (stateObj.userUuid === targetUuid) return true
  }
  return false
}

function _respondFile(
  provider: WebrtcProvider,
  doc: Y.Doc,
  files: Y.Map<FileMeta>,
  fileId: string,
  fileData: string,
  targetUuid: string,
  skipChunks: number[] = [],
  onComplete?: () => void,
) {
  const timestamp = Date.now()
  const skipSet = new Set(skipChunks)
  const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE)
  const chunksToSend = totalChunks - skipChunks.length

  console.log(`[#5] Yjs 파일 전송 시작: ${chunksToSend}/${totalChunks} 청크, ${(fileData.length / 1024).toFixed(0)}KB`)

  const { startTransfer, updateProgress, completeTransfer, cancelTransfer } = useFileTransferProgress()
  const meta = files.get(fileId)
  const transferKey = `${fileId}-${targetUuid}`
  startTransfer(transferKey, meta?.name || fileId, 'upload', totalChunks, fileData.length, false)

  provider.awareness.setLocalStateField('fileResponse', { fileId, targetUuid, timestamp, totalChunks, chunkSize: CHUNK_SIZE })

  const transferMap = doc.getMap(`transfer-${fileId}-${timestamp}`)
  let currentChunk = 0
  let transferCancelled = false
  let targetPeerStillConnected = true

  const abortTransfer = (reason: string) => {
    if (transferCancelled) return
    transferCancelled = true
    console.warn(`[Yjs] 전송 중단: ${reason}`)
    provider.awareness.setLocalStateField('fileResponse', null)
    transferMap.clear()
    cancelTransfer?.(transferKey)
  }

  const awarenessChangeHandler = () => {
    // Guard: 전송이 취소된 경우
    if (transferCancelled) return

    const stillConnected = checkTargetPeerConnected(provider, targetUuid)

    // Guard: 연결 상태가 변경되지 않은 경우
    if (!targetPeerStillConnected || stillConnected) return

    // 연결 끊김 감지 시작
    targetPeerStillConnected = false

    // 1초 후 재확인 (일시적 끊김 방지)
    setTimeout(() => {
      // Guard: 전송이 취소된 경우
      if (transferCancelled) return

      // 재연결 확인
      const reconnected = checkTargetPeerConnected(provider, targetUuid)

      if (reconnected) {
        // 재연결됨
        targetPeerStillConnected = true
        return
      }

      // 확실히 연결 끊김 - 전송 중단
      abortTransfer('피어 연결 끊김')
      provider.awareness.off('change', awarenessChangeHandler)
    }, 1000)
  }

  const peersChangeHandler = (event: { removed: string[]; webrtcPeers: string[] }) => {
    // Guard: 제거된 피어가 없는 경우
    if (event.removed.length === 0) return

    // Guard: 전송이 취소된 경우
    if (transferCancelled) return

    // Guard: 아직 다른 피어가 남아있는 경우
    if (event.webrtcPeers.length > 0) return

    // 모든 피어 연결 끊김 - 전송 중단
    abortTransfer('모든 피어 연결 끊김')
    provider.off('peers', peersChangeHandler)
    provider.awareness.off('change', awarenessChangeHandler)
  }

  provider.awareness.on('change', awarenessChangeHandler)
  provider.on('peers', peersChangeHandler)

  const sendNextChunk = () => {
    if (transferCancelled) return

    if (currentChunk >= totalChunks) {
      transferMap.set('complete', true)
      console.log(`[#9] Yjs 전송 완료: ${totalChunks}개 청크`)
      completeTransfer(transferKey)
      provider.off('peers', peersChangeHandler)
      provider.awareness.off('change', awarenessChangeHandler)

      setTimeout(() => {
        provider.awareness.setLocalStateField('fileResponse', null)
        setTimeout(() => transferMap.clear(), 60000)
        if (onComplete) onComplete()
      }, 5000)
      return
    }

    if (skipSet.has(currentChunk)) {
      currentChunk++
      sendNextChunk()
      return
    }

    const start = currentChunk * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, fileData.length)
    transferMap.set(`chunk-${currentChunk}`, fileData.substring(start, end))
    updateProgress(transferKey, currentChunk + 1)

    if (currentChunk % 20 === 0 || currentChunk === totalChunks - 1) {
      console.log(`[#8] Yjs 전송: ${currentChunk + 1}/${totalChunks} (${(((currentChunk + 1) / totalChunks) * 100).toFixed(0)}%)`)
    }

    currentChunk++
    setTimeout(sendNextChunk, SEND_DELAY)
  }

  sendNextChunk()
}
