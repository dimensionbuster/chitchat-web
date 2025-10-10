<script setup lang="ts">
import { ref, computed } from 'vue'
import { useYjs } from './composables/useYjs'
import { useIpfs } from './composables/useIpfs'
import type { ChatMessage } from './types/types'

const { addFile, getFile } = useIpfs()

const me = 'user-' + crypto.randomUUID().slice(0, 4)
const input = ref('')

// Yjs 관련 상태

const yjsReady = ref(true)
const { messages, files, sendTextMessage, attachFileMeta } = useYjs() as {
  messages: ReturnType<typeof useYjs>['messages']
  files: ReturnType<typeof useYjs>['files']
  sendTextMessage: (author: string, text: string) => void
  attachFileMeta: (cid: string, meta: Record<string, unknown>, author: string) => void
}

const onSend = () => {
  if (!yjsReady.value) return
  sendTextMessage(me, input.value)
  input.value = ''
}

const onPick = async (e: Event) => {
  if (!yjsReady.value) return
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const meta = await addFile(file)
  attachFileMeta(meta.cid, meta, me)
}

const feed = computed<ChatMessage[]>(() =>
  yjsReady.value ? (messages.toArray() as ChatMessage[]).sort((a, b) => a.ts - b.ts) : [],
)

const download = async (cid?: string) => {
  if (!cid) return
  const blob = await getFile(cid)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = files.get(cid)?.name ?? cid
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div style="max-width: 720px; margin: 0 auto; padding: 16px">
    <h1>P2P Chat + Files (Vue SPA)</h1>

    <div style="display: flex; gap: 8px; margin-bottom: 12px">
      <input
        v-model="input"
        placeholder="메시지…"
        style="flex: 1; padding: 6px; border: 1px solid #ccc"
        @keyup.enter="onSend"
        :disabled="!yjsReady"
      />
      <button @click="onSend" :disabled="!yjsReady">Send</button>
      <input type="file" @change="onPick" :disabled="!yjsReady" />
    </div>

    <ul
      style="
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      "
    >
      <li v-if="!yjsReady" style="font-size: 14px; color: #888">Yjs 네트워크 연결 중…</li>
      <li v-for="m in feed" :key="m.id" style="font-size: 14px">
        <span style="color: #888; font-family: monospace">
          {{ new Date(m.ts).toLocaleTimeString() }}
        </span>
        <strong style="margin-left: 6px">{{ m.author }}:</strong>
        <template v-if="m.text">
          <span> {{ m.text }} </span>
        </template>
        <template v-else-if="m.cid">
          <button @click="download(m.cid)" style="margin-left: 6px">
            파일 받기 ({{ files.get(m.cid)?.name || m.cid }})
          </button>
        </template>
      </li>
    </ul>
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
}
* {
  box-sizing: border-box;
}
</style>
