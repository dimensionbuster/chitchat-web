<script setup lang="ts">
defineOptions({ name: 'MessageList' })
import { ref } from 'vue'
import type { ChatMessage as ChatMessageType, FileMeta } from '@/types/types'
import type { Map as YMap } from 'yjs'
import ChatMessage from './ChatMessage.vue'

defineProps<{
  messages: ChatMessageType[]
  files: YMap<FileMeta> | Map<string, FileMeta>
  imageUrls: Map<string, string>
  loadingImages: Set<string>
  failedDownloads: Map<string, string>
  isReady: boolean
}>()

const emit = defineEmits<{
  download: [fileId: string]
  requestDownload: [fileId: string]
}>()

const feedContainer = ref<HTMLElement | null>(null)

const scrollToBottom = () => {
  if (feedContainer.value) {
    feedContainer.value.scrollTop = feedContainer.value.scrollHeight
  }
}

defineExpose({ scrollToBottom })
</script>

<template>
  <ul ref="feedContainer" class="message-list">
    <li v-if="!isReady" class="status-message">Yjs 네트워크 연결 중…</li>

    <ChatMessage
      v-for="m in messages"
      :key="m.id"
      :message="m"
      :fileMeta="m.fileId ? files.get(m.fileId) : undefined"
      :imageUrl="m.fileId ? imageUrls.get(m.fileId) : undefined"
      :isImageLoading="m.fileId ? loadingImages.has(m.fileId) : false"
      :errorMessage="m.fileId ? failedDownloads.get(m.fileId) : undefined"
      @download="emit('download', $event)"
      @requestDownload="emit('requestDownload', $event)"
    />
  </ul>
</template>

<style scoped>
.message-list {
  height: 80%;
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: scroll;
}

.status-message {
  font-size: 14px;
  color: #888;
}
</style>
