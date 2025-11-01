import * as Y from 'yjs'
import { readonly, ref } from 'vue'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { ChatMessage, FileMeta } from '@/types/types'
import { useFileTransferProgress } from './useFileTransferProgress'

const MAX_MESSAGES = 50
const ROOM_ID = 'default-room'

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

const getRecentMessages = (messages: Y.Array<ChatMessage>) => {
  const start = Math.max(0, messages.length - MAX_MESSAGES)
  return messages.toArray().slice(start)
}

const waitForSync = (provider: WebrtcProvider) =>
  new Promise<void>((resolve) => {
    let resolved = false
    const resolveOnce = () => {
      if (!resolved) {
        resolved = true
        resolve()
      }
    }

    provider.on('synced', (event: { synced: boolean }) => {
      if (event.synced) {
        console.log('[useYjs] WebRTC 동기화 완료')
        resolveOnce()
      }
    })

    setTimeout(() => {
      console.log('[useYjs] WebRTC 동기화 타임아웃 - 계속 진행')
      resolveOnce()
    }, 5000)
  })

async function createYjsInstance(roomId: string) {
  const doc = new Y.Doc()
  const messages = doc.getArray<ChatMessage>('messages')
  const files = doc.getMap<FileMeta>('files')

  const internalMessagesRef = ref(getRecentMessages(messages))

  messages.observe(() => {
    internalMessagesRef.value = getRecentMessages(messages)
    console.debug('[useYjs] messages updated:', messages.length)
  })

  const messagesRef = readonly(internalMessagesRef)

  const provider = new WebrtcProvider(roomId, doc, {
    signaling: SIGNAL_URLS,
    peerOpts: { config: { iceServers } },
    maxConns: 20,
    filterBcConns: true,
  })

  console.log('[useYjs] WebRTC provider 생성됨')
  await waitForSync(provider)

  console.log('[useYjs] 문서 상태:', {
    messages: messages.length,
    files: files.size,
  })

  const persistence = new IndexeddbPersistence(`ydb-${roomId}`, doc)
  _setupProviderListeners(provider)

  const sendTextMessage = (authorTrueUuid: string, authorName: string, text: string) => {
    if (!text.trim()) return
    messages.push([{ id: crypto.randomUUID(), authorTrueUuid, authorName, text, ts: Date.now() }])
  }

  const attachFileMeta = (fileId: string, meta: FileMeta, authorTrueUuid: string, authorName = authorTrueUuid) => {
    files.set(fileId, meta)
    messages.push([{ id: crypto.randomUUID(), authorTrueUuid, authorName, fileId, ts: Date.now() }])
  }

  const requestFile = (fileId: string, requesterUuid: string, receivedChunks: number[] = []) => {
    console.log('[Yjs] 파일 요청:', { fileId, requesterUuid, receivedChunksCount: receivedChunks.length })
    provider.awareness.setLocalStateField('fileRequest', { fileId, requesterUuid, timestamp: Date.now(), receivedChunks })
    setTimeout(() => provider.awareness.setLocalStateField('fileRequest', null), 5000)
  }

  const respondFile = (fileId: string, fileData: string, targetUuid: string, skipChunks: number[] = []) => {
    _respondFile(provider, doc, files, fileId, fileData, targetUuid, skipChunks)
  }

  const getTransferMap = (key: string) => doc.getMap<string>(key)

  const forceResync = async () => {
    console.log('[useYjs] 🔄 강제 재동기화 시작')
    try {
      provider.disconnect()
      provider.destroy()

      doc.transact(() => {
        messages.delete(0, messages.length)
        files.clear()
      })

      await persistence.clearData()
      persistence.destroy()
      yjsInstances.delete(roomId)
      doc.destroy()

      console.log('[useYjs] ✅ 재동기화 준비 완료')
      return true
    } catch (error) {
      console.error('[useYjs] ❌ 재동기화 실패:', error)
      return false
    }
  }

  const instance = {
    doc,
    provider,
    persistence,
    messages,
    messagesRef,
    files,
    sendTextMessage,
    attachFileMeta,
    requestFile,
    respondFile,
    getTransferMap,
    forceResync,
  }

  return instance
}

const setUserAwareness = (provider: WebrtcProvider, userUuid?: string) => {
  if (userUuid) {
    provider.awareness.setLocalStateField('userUuid', userUuid)
    console.log(`[useYjs] UUID 설정: ${userUuid}`)
  }
}

export async function useYjs(roomId = ROOM_ID, userUuid?: string) {
  const cached = yjsInstances.get(roomId)
  if (cached) {
    console.log(`[useYjs] ✅ 기존 연결 재사용: ${roomId}`)
    const instance = await cached
    setUserAwareness(instance.provider, userUuid)

    if (!instance.provider.connected) {
      console.log(`[useYjs] 🔄 재연결: ${roomId}`)
      instance.provider.connect()
    }
    return instance
  }

  console.log(`[useYjs] 🆕 새 연결 생성: ${roomId}`)
  const instancePromise = createYjsInstance(roomId)
  yjsInstances.set(roomId, instancePromise)
  const instance = await instancePromise
  setUserAwareness(instance.provider, userUuid)

  return instance
}

// ========== 헬퍼 함수들 ==========

function _setupProviderListeners(provider: WebrtcProvider) {
  let wasConnected = false

  provider.on('peers', (event: { added: string[]; removed: string[]; webrtcPeers: string[] }) => {
    console.log('[WebRTC] Peers:', { added: event.added.length, removed: event.removed.length, total: event.webrtcPeers.length })

    if (event.added.length > 0) {
      const messages = provider.doc.getArray('messages')
      console.log(`[WebRTC] ✅ 새 피어 연결 (메시지: ${messages.length}개)`)

      if (wasConnected && event.webrtcPeers.length > 0) {
        const currentState = provider.awareness.getLocalState()
        if (currentState && Object.keys(currentState).length > 0) {
          provider.awareness.setLocalState(currentState)
        }
      }
    }

    wasConnected = event.webrtcPeers.length > 0
  })

  provider.on('synced', (event: { synced: boolean }) => {
    if (event.synced) {
      const messages = provider.doc.getArray('messages')
      const files = provider.doc.getMap('files')
      console.log(`[WebRTC] ✅ 동기화 완료 (메시지: ${messages.length}, 파일: ${files.size})`)
    }
  })

  provider.on('status', (event: { connected: boolean }) => {
    console.log(`[WebRTC] ${event.connected ? '🟢 연결됨' : '🔴 끊김'}`)

    if (event.connected && wasConnected === false) {
      setTimeout(() => {
        const messages = provider.doc.getArray('messages')
        console.log(`[WebRTC] 연결 복구 (메시지: ${messages.length}개)`)
      }, 1000)
    }
  })

  provider.awareness.on('change', () => {
    const clientIds = Array.from(provider.awareness.getStates().keys())
    console.log(`[WebRTC] Awareness 변경 (clients: ${clientIds.length})`)
  })
}

const CHUNK_SIZE = 64 * 1024
const BASE_DELAY = 10
const MAX_DELAY = 100

const checkTargetPeerConnected = (provider: WebrtcProvider, targetUuid: string): boolean => {
  for (const [clientId, state] of provider.awareness.getStates()) {
    if (clientId === provider.awareness.clientID) continue
    const stateObj = state as Record<string, unknown>
    const fileRequest = stateObj.fileRequest as { requesterUuid?: string } | undefined
    const user = stateObj.user as { uuid?: string } | undefined

    if (fileRequest?.requesterUuid === targetUuid || user?.uuid === targetUuid || stateObj.userUuid === targetUuid) {
      return true
    }
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
) {
  const timestamp = Date.now()
  const skipSet = new Set(skipChunks)
  const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE)
  const chunksToSend = totalChunks - skipChunks.length

  console.log(`[useYjs] 파일 전송: ${fileId} to ${targetUuid} (${chunksToSend}/${totalChunks} 청크, ${(fileData.length / 1024 / 1024).toFixed(2)}MB)`)

  const { startTransfer, updateProgress, completeTransfer, cancelTransfer } = useFileTransferProgress()
  const meta = files.get(fileId)
  startTransfer(fileId, meta?.name || fileId, 'upload', totalChunks, fileData.length, false)

  provider.awareness.setLocalStateField('fileResponse', { fileId, targetUuid, timestamp, totalChunks, chunkSize: CHUNK_SIZE })

  const transferMap = doc.getMap(`transfer-${fileId}-${timestamp}`)
  let currentChunk = 0
  let lastSendTime = Date.now()
  let transferCancelled = false
  let targetPeerStillConnected = true

  const abortTransfer = (reason: string) => {
    if (transferCancelled) return
    transferCancelled = true
    console.warn(`[useYjs] ⚠️ 전송 중단: ${fileId} - ${reason}`)
    provider.awareness.setLocalStateField('fileResponse', null)
    transferMap.clear()
    cancelTransfer?.(fileId)
  }

  const awarenessChangeHandler = () => {
    if (transferCancelled) return
    const stillConnected = checkTargetPeerConnected(provider, targetUuid)

    if (targetPeerStillConnected && !stillConnected) {
      console.warn(`[useYjs] 대상 피어 끊김: ${targetUuid}`)
      targetPeerStillConnected = false

      setTimeout(() => {
        if (!transferCancelled && !checkTargetPeerConnected(provider, targetUuid)) {
          abortTransfer(`대상 피어 연결 끊김`)
          provider.awareness.off('change', awarenessChangeHandler)
        } else {
          targetPeerStillConnected = true
        }
      }, 1000)
    }
  }

  const peersChangeHandler = (event: { removed: string[]; webrtcPeers: string[] }) => {
    if (event.removed.length > 0 && !transferCancelled && event.webrtcPeers.length === 0) {
      abortTransfer('모든 피어 연결 끊김')
      provider.off('peers', peersChangeHandler)
      provider.awareness.off('change', awarenessChangeHandler)
    }
  }

  provider.awareness.on('change', awarenessChangeHandler)
  provider.on('peers', peersChangeHandler)

  const calculateDelay = (chunkIndex: number) => {
    const now = Date.now()
    const elapsed = now - lastSendTime
    lastSendTime = now

    const adaptiveDelay = Math.min(BASE_DELAY + Math.floor(totalChunks / 20), MAX_DELAY)
    const backoffDelay = elapsed > 20 ? elapsed * 0.5 : 0
    const finalDelay = Math.min(adaptiveDelay + backoffDelay, MAX_DELAY)

    if (chunkIndex % 50 === 0) {
      console.log(`[useYjs] 딜레이: ${finalDelay.toFixed(1)}ms (이전: ${elapsed}ms)`)
    }

    return finalDelay
  }

  const sendNextChunk = () => {
    if (transferCancelled) return

    if (currentChunk >= totalChunks) {
      transferMap.set('complete', true)
      console.log(`[useYjs] ✅ 전송 완료: ${fileId} (${totalChunks}개 청크)`)
      completeTransfer(fileId)
      provider.off('peers', peersChangeHandler)
      provider.awareness.off('change', awarenessChangeHandler)

      setTimeout(() => {
        provider.awareness.setLocalStateField('fileResponse', null)
        setTimeout(() => transferMap.clear(), 60000)
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
    updateProgress(fileId, currentChunk + 1)

    if (currentChunk % 10 === 0 || currentChunk === totalChunks - 1) {
      console.log(`[useYjs] 청크 ${currentChunk + 1}/${totalChunks} (${(((currentChunk + 1) / totalChunks) * 100).toFixed(1)}%)`)
    }

    const delay = calculateDelay(currentChunk)
    currentChunk++
    setTimeout(sendNextChunk, delay)
  }

  sendNextChunk()
}
