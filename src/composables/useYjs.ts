import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { ChatMessage } from '@/types/types'

const SIGNAL_URLS = (import.meta.env.VITE_SIGNAL_URLS || '')
  .split(',')
  .map((url: string) => url.trim())
  .filter(Boolean) // .env에서 불러옴
const ROOM_ID = 'default-room' // 채팅방 ID, 필요에 따라 변경 가능

export function useYjs() {
  const doc = new Y.Doc()
  const messages = doc.getArray<ChatMessage>('messages')
  const files = doc.getMap<any>('files')

  const provider = new WebrtcProvider(ROOM_ID, doc, { signaling: SIGNAL_URLS })
  const persistence = new IndexeddbPersistence(`ydb-${ROOM_ID}`, doc)

  function sendTextMessage(author: string, text: string) {
    if (!text.trim()) return
    messages.push([{ id: crypto.randomUUID(), author, text, ts: Date.now() }])
  }

  function attachFileMeta(cid: string, meta: any, author: string) {
    files.set(cid, meta)
    messages.push([{ id: crypto.randomUUID(), author, cid, ts: Date.now() }])
  }

  return { doc, provider, persistence, messages, files, sendTextMessage, attachFileMeta }
}
