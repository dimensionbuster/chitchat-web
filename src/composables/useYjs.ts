import * as Y from 'yjs'
import { readonly, ref } from 'vue'

import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { ChatMessage, FileMeta } from '@/types/types'
import { useFileTransferProgress } from './useFileTransferProgress'

const MAX_MESSAGES = 50

const SIGNAL_URLS = (import.meta.env.VITE_SIGNAL_URLS || '')
  .split(',')
  .map((url: string) => url.trim())
  .filter(Boolean)

const iceServers = [
  // 1. Google STUN
  { urls: 'stun:stun.l.google.com:19302' },
  // 2. TURN (3478)
  {
    urls: 'turn:turn.gongbbu.com:3478',
    username: 'gongbbu', // 필요에 따라 수정
    credential: 'gongbbu', // 필요에 따라 수정
  },
  // 3. TURN (5349)
  {
    urls: 'turns:turn.gongbbu.com:5349',
    username: 'gongbbu', // 필요에 따라 수정
    credential: 'gongbbu', // 필요에 따라 수정
  },
]
const ROOM_ID = 'default-room'
const yjsInstances = new Map<string, ReturnType<typeof createYjsInstance>>()

function createYjsInstance(roomId: string) {
  const doc = new Y.Doc()
  const messages = doc.getArray<ChatMessage>('messages')
  const files = doc.getMap<FileMeta>('files')

  const messageToArray = (messages: Y.Array<ChatMessage>, length: number) => {
    //slice from the end
    const start = Math.max(0, messages.length - length)
    return messages.toArray().slice(start)
  }

  const internalMessagesRef = ref(messageToArray(messages, MAX_MESSAGES))

  try {
    messages.observe(() => {
      internalMessagesRef.value = messageToArray(messages, MAX_MESSAGES)
      console.debug('[useYjs] messages updated, total:', messages.length)
      console.debug(internalMessagesRef.value.length, 'messages in ref')
    })
  } catch (e) {
    console.debug('[useYjs] messages.observe not available', e)
  }
  const messagesRef = readonly(internalMessagesRef)

  const provider = new WebrtcProvider(roomId, doc, {
    signaling: SIGNAL_URLS,
    peerOpts: { config: { iceServers } },
    maxConns: 20,
    filterBcConns: true,
  })
  const persistence = new IndexeddbPersistence(`ydb-${roomId}`, doc)

  _setupProviderListeners(provider)

  const sendTextMessage = (authorTrueUuid: string, authorName: string, text: string) => {
    if (!text.trim()) return
    messages.push([{ id: crypto.randomUUID(), authorTrueUuid, authorName, text, ts: Date.now() }])
  }

  const attachFileMeta = (
    fileId: string,
    meta: FileMeta,
    authorTrueUuid: string,
    authorName?: string,
  ) => {
    files.set(fileId, meta)
    messages.push([
      {
        id: crypto.randomUUID(),
        authorTrueUuid,
        authorName: authorName ?? authorTrueUuid,
        fileId,
        ts: Date.now(),
      },
    ])
  }

  const requestFile = (fileId: string, requesterUuid: string) => {
    provider.awareness.setLocalStateField('fileRequest', {
      fileId,
      requesterUuid,
      timestamp: Date.now(),
    })
    setTimeout(() => provider.awareness.setLocalStateField('fileRequest', null), 5000)
  }

  const respondFile = (fileId: string, fileData: string, targetUuid: string) => {
    _respondFile(provider, doc, files, fileId, fileData, targetUuid)
  }

  const getTransferMap = (key: string) => doc.getMap<string>(key)

  return {
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
  }
}

export function useYjs(roomId = ROOM_ID) {
  const cached = yjsInstances.get(roomId)
  if (cached) {
    console.log(`[useYjs] ✅ 기존 연결 재사용: ${roomId}`)
    if (!cached.provider.connected) {
      console.log(`[useYjs] 🔄 재연결: ${roomId}`)
      cached.provider.connect()
    }
    return cached
  }

  console.log(`[useYjs] 🆕 새 연결 생성: ${roomId}`)
  const instance = createYjsInstance(roomId)
  yjsInstances.set(roomId, instance)
  return instance
}

// ========== 헬퍼 함수들 ==========

// Provider 리스너 설정
function _setupProviderListeners(provider: WebrtcProvider) {
  provider.on('peers', (event: { added: string[]; removed: string[]; webrtcPeers: string[] }) => {
    console.log(`[WebRTC] Peers 변경:`, {
      added: event.added,
      removed: event.removed,
      total: event.webrtcPeers.length,
      peers: event.webrtcPeers,
    })

    if (event.removed.length > 0) {
      console.warn(`[WebRTC] ⚠️ 피어 연결 끊김:`, event.removed)
    }
    if (event.added.length > 0) {
      console.log(`[WebRTC] ✅ 새 피어 연결:`, event.added)
    }
  })

  provider.on('synced', (event: { synced: boolean }) => {
    console.log(`[WebRTC] Sync 상태:`, event.synced ? '✅ 동기화됨' : '⏳ 동기화 중...')
  })

  // Awareness 상태 변경 모니터링
  provider.awareness.on('change', () => {
    const states = provider.awareness.getStates()
    const clientIds = Array.from(states.keys())
    console.log(`[WebRTC] Awareness 변경 - clientIds:`, clientIds, `(total: ${clientIds.length})`)
  })
}

// 파일 응답 로직 (분리된 함수)
function _respondFile(
  provider: WebrtcProvider,
  doc: Y.Doc,
  files: Y.Map<FileMeta>,
  fileId: string,
  fileData: string,
  targetUuid: string,
) {
  const timestamp = Date.now()
  const myClientId = provider.awareness.clientID
  console.log(
    `[useYjs] 파일 응답 시작: ${fileId} to ${targetUuid} (myClientId: ${myClientId}, ts: ${timestamp}, dataSize: ${fileData.length})`,
  )

  // 청크 크기: 64KB - WebRTC MTU와 브라우저 메모리를 고려한 최적값
  // - 너무 작으면: 오버헤드 증가 (네트워크 왕복 횟수 증가)
  // - 너무 크면: 버퍼 오버플로우 위험
  const CHUNK_SIZE = 64 * 1024
  const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE)

  console.log(
    `[useYjs] 파일을 ${totalChunks}개 청크로 분할 전송 (총 ${(fileData.length / 1024 / 1024).toFixed(2)}MB)`,
  )

  // 진척도 추적 시작 (업로드)
  const { startTransfer, updateProgress, completeTransfer } = useFileTransferProgress()
  const meta = files.get(fileId)
  startTransfer(fileId, meta?.name || fileId, 'upload', totalChunks, fileData.length)

  // 1. 먼저 메타데이터를 awareness로 알림
  provider.awareness.setLocalStateField('fileResponse', {
    fileId,
    targetUuid,
    timestamp,
    totalChunks,
    chunkSize: CHUNK_SIZE,
  })

  // 2. 실제 데이터는 Yjs Map에 청크로 천천히 저장 (적응형 백프레셔)
  const transferMap = doc.getMap(`transfer-${fileId}-${timestamp}`)

  let currentChunk = 0
  let lastSendTime = Date.now()

  // 적응형 딜레이 계산
  // - 초기: 10ms (빠른 시작)
  // - 청크 수가 많으면: 더 긴 대기 (네트워크 부하 분산)
  // - 네트워크 상태에 따라 동적 조정
  const calculateDelay = (chunkIndex: number) => {
    const BASE_DELAY = 10 // ms
    const MAX_DELAY = 100 // ms

    // 전송 속도 측정: 이전 청크 전송에 걸린 시간
    const now = Date.now()
    const elapsed = now - lastSendTime
    lastSendTime = now

    // 청크 수에 비례한 기본 딜레이
    // 100개 청크 이하: 10ms
    // 200개 청크: 20ms
    // 1000개 청크: 50ms (최대)
    const adaptiveDelay = Math.min(BASE_DELAY + Math.floor(totalChunks / 20), MAX_DELAY)

    // 이전 전송이 느렸다면 (>20ms) 약간 더 기다림
    const backoffDelay = elapsed > 20 ? elapsed * 0.5 : 0

    const finalDelay = Math.min(adaptiveDelay + backoffDelay, MAX_DELAY)

    if (chunkIndex % 50 === 0) {
      console.log(`[useYjs] 적응형 딜레이: ${finalDelay.toFixed(1)}ms (이전 전송: ${elapsed}ms)`)
    }

    return finalDelay
  }

  // 청크를 순차적으로 전송
  const sendNextChunk = () => {
    if (currentChunk >= totalChunks) {
      transferMap.set('complete', true)
      console.log(`[useYjs] ✅ 파일 전송 완료: ${fileId} (${totalChunks}개 청크)`)

      // 진척도 완료 표시
      completeTransfer(fileId)

      // 전송 완료 후 정리
      setTimeout(() => {
        provider.awareness.setLocalStateField('fileResponse', null)
        // 전송 맵은 60초 후 제거 (수신자가 다운로드할 충분한 시간 확보)
        setTimeout(() => {
          doc.getMap(`transfer-${fileId}-${timestamp}`).clear()
          console.log(`[useYjs] 전송 맵 정리됨: transfer-${fileId}-${timestamp}`)
        }, 60000)
      }, 5000)
      return
    }

    const start = currentChunk * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, fileData.length)
    const chunk = fileData.substring(start, end)

    transferMap.set(`chunk-${currentChunk}`, chunk)

    // 진척도 업데이트
    updateProgress(fileId, currentChunk + 1)

    if (currentChunk % 10 === 0 || currentChunk === totalChunks - 1) {
      console.log(
        `[useYjs] 청크 ${currentChunk + 1}/${totalChunks} 전송됨 ` +
          `(${(((currentChunk + 1) / totalChunks) * 100).toFixed(1)}% 완료)`,
      )
    }

    const delay = calculateDelay(currentChunk)
    currentChunk++

    // 다음 청크는 적응형 딜레이 후에 전송
    setTimeout(sendNextChunk, delay)
  }

  // 첫 청크부터 시작
  sendNextChunk()
}
