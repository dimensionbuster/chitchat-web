import * as Y from 'yjs'
import { ref } from 'vue'

import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { ChatMessage, FileMeta } from '@/types/types'

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
const ROOM_ID = 'default-room' // fallback room id

export function useYjs(roomId: string = ROOM_ID) {
  const doc = new Y.Doc()
  const messages = doc.getArray<ChatMessage>('messages')
  const files = doc.getMap<FileMeta>('files')

  // Reactive mirror for Vue components: updated whenever the Y.Array changes
  const messagesRef = ref<ChatMessage[]>(messages.toArray())
  try {
    messages.observe(() => {
      messagesRef.value = messages.toArray()
    })
  } catch (e) {
    // if observe fails, ignore — best-effort
    console.debug('[useYjs] messages.observe not available', e)
  }

  const provider = new WebrtcProvider(roomId, doc, {
    signaling: SIGNAL_URLS,
    peerOpts: { config: { iceServers } },
  })
  const persistence = new IndexeddbPersistence(`ydb-${roomId}`, doc)

  function sendTextMessage(authorTrueUuid: string, authorName: string, text: string) {
    if (!text.trim()) return
    const msg = { id: crypto.randomUUID(), authorTrueUuid, authorName, text, ts: Date.now() }
    console.debug('[useYjs] sendTextMessage ->', msg)
    messages.push([msg])
  }

  function attachFileMeta(
    cid: string,
    meta: FileMeta,
    authorTrueUuid: string,
    authorName?: string,
  ) {
    console.debug('[useYjs] attachFileMeta ->', { cid, meta, authorTrueUuid, authorName })
    files.set(cid, meta)
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      authorTrueUuid,
      authorName: authorName ?? authorTrueUuid,
      cid,
      ts: Date.now(),
    }
    messages.push([msg])
  }

  return {
    doc,
    provider,
    persistence,
    messages,
    messagesRef,
    files,
    sendTextMessage,
    attachFileMeta,
  }
}
