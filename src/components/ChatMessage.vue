<script setup lang="ts">
defineOptions({ name: 'ChatMessage' })
import { computed } from 'vue'
import type { ChatMessage, FileMeta } from '@/types/types'
import ImageMessage from './ImageMessage.vue'
import FileMessage from './FileMessage.vue'

const props = defineProps<{
  message: ChatMessage
  fileMeta: FileMeta | undefined
  imageUrl: string | undefined
  isImageLoading: boolean
  errorMessage?: string
}>()

const emit = defineEmits<{
  download: [cid: string]
  requestDownload: [cid: string]
}>()

type AnyMessage = ChatMessage & { author?: string }
const getAuthor = (m: AnyMessage) => m?.authorName ?? (m as AnyMessage)?.author ?? 'Unknown'

const isImage = computed(() => {
  return props.fileMeta?.type?.startsWith('image/')
})
</script>

<template>
  <li class="chat-message">
    <span class="timestamp">
      {{ new Date(message.ts).toLocaleTimeString() }}
    </span>
    <strong class="author">{{ getAuthor(message) }}:</strong>

    <!-- 텍스트 메시지 -->
    <span v-if="message.text"> {{ message.text }} </span>

    <!-- 이미지 메시지 -->
    <ImageMessage
      v-else-if="message.cid && isImage"
      :cid="message.cid"
      :imageUrl="imageUrl"
      :isLoading="isImageLoading"
      :fileMeta="fileMeta"
      :errorMessage="errorMessage"
      @download="emit('download', $event)"
      @requestDownload="emit('requestDownload', $event)"
    />

    <!-- 일반 파일 메시지 -->
    <FileMessage
      v-else-if="message.cid"
      :cid="message.cid"
      :fileMeta="fileMeta"
      @download="emit('download', $event)"
    />
  </li>
</template>

<style scoped>
.chat-message {
  font-size: 14px;
}

.timestamp {
  color: #888;
  font-family: monospace;
}

.author {
  margin-left: 6px;
}
</style>
