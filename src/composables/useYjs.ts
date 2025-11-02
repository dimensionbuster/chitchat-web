import * as Y from 'yjs'
import { readonly, ref } from 'vue'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { ChatMessage, FileMeta } from '@/types/types'
import { useFileTransferProgress } from './useFileTransferProgress'

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

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.gongbbu.com:3478', username: 'gongbbu', credential: 'gongbbu' },
  { urls: 'turns:turn.gongbbu.com:5349', username: 'gongbbu', credential: 'gongbbu' },
]

const yjsInstances = new Map<string, ReturnType<typeof createYjsInstance>>()

const waitForSync = (provider: WebrtcProvider) =>
  new Promise<void>((resolve) => {
    provider.on('synced', (event: { synced: boolean }) => {
      if (event.synced) resolve()
    })
    setTimeout(resolve, 1000) // 1초 타임아웃
  })

async function createYjsInstance(roomId: string) {
  const doc = new Y.Doc()

  // 🔄 마이그레이션: Y.Array → Y.Map (기존 데이터 있으면 자동 전환)
  const oldMessages = doc.getArray<ChatMessage>('messages')
  const messagesMap = doc.getMap<ChatMessage>('messagesMap')
  const files = doc.getMap<FileMeta>('files')

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

    // 메시지가 적으면 전체 정렬
    if (allMessages.length <= SORT_WINDOW) {
      sortedMessagesRef.value = allMessages.sort((a, b) => a.ts - b.ts)
    } else {
      // 대용량: 최근 메시지만 정렬 (오래된 메시지는 이미 정렬되어 있다고 가정)
      const oldMessages = allMessages.slice(0, -SORT_WINDOW)
      const recentMessages = allMessages.slice(-SORT_WINDOW).sort((a, b) => a.ts - b.ts)
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
      // 마이그레이션: Y.Array → Y.Map
      if (oldMessages.length > 0 && messagesMap.size === 0) {
        doc.transact(() => {
          oldMessages.toArray().forEach(msg => {
            const messageId = msg.id || `${msg.ts}-${crypto.randomUUID()}`
            messagesMap.set(messageId, { ...msg, id: messageId })
          })
        })
      }

      updateSortedMessages()
      console.log(`[#2] IndexedDB 로드 완료: 메시지 ${messagesMap.size}개, 파일 ${files.size}개`)
      resolve()
    })
  })

  // WebRTC provider 시작 (백그라운드 동기화)
  console.log('[#3] WebRTC Provider 생성 - 백그라운드 동기화 시작')
  const provider = new WebrtcProvider(roomId, doc, {
    signaling: SIGNAL_URLS,
    peerOpts: { config: { iceServers } },
    maxConns: 20,
    filterBcConns: true,
  })

  waitForSync(provider)

  _setupProviderListeners(provider)

  const sendTextMessage = (authorTrueUuid: string, authorName: string, text: string) => {
    if (!text.trim()) return
    const timestamp = Date.now()
    const messageId = `${timestamp}-${crypto.randomUUID()}`
    messagesMap.set(messageId, {
      id: messageId,
      authorTrueUuid,
      authorName,
      text,
      ts: timestamp,
    })
  }

  const attachFileMeta = (fileId: string, meta: FileMeta, authorTrueUuid: string, authorName = authorTrueUuid) => {
    files.set(fileId, meta)
    const timestamp = Date.now()
    const messageId = `${timestamp}-${crypto.randomUUID()}`
    messagesMap.set(messageId, {
      id: messageId,
      authorTrueUuid,
      authorName,
      fileId,
      ts: timestamp,
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
  }

  return instance
}

const setUserAwareness = (provider: WebrtcProvider, userUuid?: string) => {
  if (userUuid) {
    provider.awareness.setLocalStateField('userUuid', userUuid)
  }
}

export async function useYjs(roomId = ROOM_ID, userUuid?: string) {
  const cached = yjsInstances.get(roomId)
  if (cached) {
    const instance = await cached
    setUserAwareness(instance.provider, userUuid)
    if (!instance.provider.connected) {
      instance.provider.connect()
    }
    return instance
  }

  const instancePromise = createYjsInstance(roomId)
  yjsInstances.set(roomId, instancePromise)
  const instance = await instancePromise
  setUserAwareness(instance.provider, userUuid)
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
