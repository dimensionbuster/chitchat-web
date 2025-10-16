<script setup lang="ts">
defineOptions({ name: 'ChatRoomPage' })
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useYjs } from '../composables/useYjs'
import type { ChatMessage } from '@/types/types'
import { useIpfs } from '../composables/useIpfs'
import router from '@/router'

const props = defineProps<{
  roomId?: string
  name?: string
}>()

const { addFile, getFile } = useIpfs()

// identity
if (!localStorage.getItem('uuid')) {
  localStorage.setItem('uuid', crypto.randomUUID())
}
const me = 'user-' + localStorage.getItem('uuid')
const myName = ref('User ' + me.slice(-4))

// initial name from props if provided
if (props.name && props.name.trim()) {
  myName.value = props.name.trim() + me.slice(-4)
}

const input = ref('')

// Yjs state
const yjsReady = ref(false)
const activeRoomId = props.roomId && props.roomId.trim() ? props.roomId.trim() : 'default-room'

const { messages, messagesRef, files, sendTextMessage, attachFileMeta, provider } =
  useYjs(activeRoomId)

const onSend = async () => {
  if (!yjsReady.value) return
  if (!input.value.trim()) return
  sendTextMessage(me, myName.value, input.value)
  input.value = ''
}

const onPick = async (e: Event) => {
  if (!yjsReady.value) return
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const meta = await addFile(file)
  attachFileMeta(meta.cid, meta, me)
}

// messagesRef from the composable keeps a reactive mirror of Y.Array
const feed = computed(() => messagesRef.value)
const feedContainer = ref<HTMLElement | null>(null)
const scrollToBottom = () => {
  if (feedContainer.value) {
    feedContainer.value.scrollTop = feedContainer.value.scrollHeight
  }
}

watch(messagesRef, async () => {
  await nextTick()
  console.log('feed updated, scroll to bottom')
  scrollToBottom()
})

onMounted(() => {
  if (provider.connected) {
    yjsReady.value = true
  }
  provider.on('status', (e) => {
    yjsReady.value = e.connected
    console.log('Yjs status', e)
  })
})

type AnyMessage = ChatMessage & { author?: string }
const getAuthor = (m: AnyMessage) => m?.authorName ?? (m as AnyMessage)?.author ?? 'Unknown'

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

const debugForceSync = () => {
  provider.disconnect()
  setTimeout(() => provider.connect(), 1000)
}
const goToHome = () => {
  router.push({ name: 'Home' })
}
</script>

<template>
  <div style="height: 100%; width: 100%; padding: 12px; display: flex; flex-direction: column">
    <div
      style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      "
    >
      <h1>P2P Chat + Files (Vue SPA) - {{ activeRoomId }}</h1>
      <button @click="debugForceSync">Force Sync</button>
      <button @click="goToHome">Go Home</button>
    </div>

    <ul
      ref="feedContainer"
      style="
        height: 80%;
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: scroll;
      "
    >
      <li v-if="!yjsReady" style="font-size: 14px; color: #888">Yjs 네트워크 연결 중…</li>
      <li v-for="m in feed" :key="m.id" style="font-size: 14px">
        <span style="color: #888; font-family: monospace">
          {{ new Date(m.ts).toLocaleTimeString() }}
        </span>
        <strong style="margin-left: 6px">{{ getAuthor(m) }}:</strong>
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
    <div style="display: flex; gap: 8px; margin-top: 12px">
      <input
        v-model="input"
        placeholder="메시지…"
        style="flex: 1; padding: 6px; border: 1px solid #ccc"
        @keydown.enter="onSend"
        :disabled="!yjsReady"
      />
      <button @click="onSend" :disabled="!yjsReady">Send</button>
      <!-- <input type="file" @change="onPick" :disabled="!yjsReady" /> -->
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
</style>
