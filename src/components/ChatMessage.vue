<script setup lang="ts">
defineOptions({ name: 'ChatMessage' })
import { computed } from 'vue'
import type { ChatMessage, FileMeta } from '@/types/types'
import ImageMessage from './ImageMessage.vue'
import FileMessage from './FileMessage.vue'
import ProfileAvatar from './ProfileAvatar.vue'

const props = defineProps<{
  prevMessage?: ChatMessage
  message: ChatMessage
  fileMeta: FileMeta | undefined
  imageUrl: string | undefined
  isImageLoading: boolean
  errorMessage?: string
  profilePicture?: string | null
}>()

const emit = defineEmits<{
  download: [fileId: string]
  requestDownload: [fileId: string]
  viewProfile: [userId: string]
}>()

type AnyMessage = ChatMessage & { author?: string }
const getAuthor = (m: AnyMessage) => m?.authorName ?? (m as AnyMessage)?.author ?? 'Unknown'

const isImage = computed(() => {
  return props.fileMeta?.type?.startsWith('image/')
})

// URL 정규식 (http, https, ftp 등)
const urlRegex = /(https?:\/\/[^\s]+)|(ftp:\/\/[^\s]+)/g

// 텍스트에서 URL을 찾아서 HTML로 변환
const formatMessageWithLinks = (text: string) => {
  if (!text) return ''
  return text.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="message-link">${url}</a>`
  })
}

// 링크 클릭 핸들러 (Electron에서 외부 브라우저로 열기)
const handleLinkClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.tagName === 'A') {
    event.preventDefault()
    const href = target.getAttribute('href')
    if (href && window.electronApi?.openExternal) {
      window.electronApi.openExternal(href)
    } else if (href) {
      // 웹 환경에서는 새 탭으로
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }
}
const showOnlyMessage = computed(() => {
  const prev = props.prevMessage
  const curr = props.message
  return (
    prev &&
    prev.authorTrueUuid === curr.authorTrueUuid &&
    curr.ts - prev.ts < 3 * 60 * 1000 // 3분 이내
  )
})
</script>

<template>
  <li class="chat-message">
    <ProfileAvatar
      v-if="!showOnlyMessage"
      :imageUrl="profilePicture || null"
      :userName="getAuthor(message)"
      :size="45"
      :clickable="true"
      class="message-avatar"
      @click="emit('viewProfile', message.authorTrueUuid)"
    />
    <div v-else style="width: 45px; flex-shrink: 0;"></div>
    <div class="message-content">
      <div class="message-header" v-if="!showOnlyMessage">
        <strong class="author">{{ getAuthor(message) }}</strong>
        <span class="timestamp">
          {{ new Date(message.ts).toLocaleTimeString() }}
        </span>
      </div>

      <!-- 텍스트 메시지 -->
      <span
        v-if="message.text"
        class="message-text"
        v-html="formatMessageWithLinks(message.text)"
        @click="handleLinkClick"
      ></span>

      <!-- 이미지 메시지 -->
      <ImageMessage
        v-else-if="message.fileId && isImage"
        :fileId="message.fileId"
        :imageUrl="imageUrl"
        :isLoading="isImageLoading"
        :fileMeta="fileMeta"
        :errorMessage="errorMessage"
        @download="emit('download', $event)"
        @requestDownload="emit('requestDownload', $event)"
      />

      <!-- 일반 파일 메시지 -->
      <FileMessage
        v-else-if="message.fileId"
        :fileId="message.fileId"
        :fileMeta="fileMeta"
        @download="emit('download', $event)"
      />
    </div>
  </li>
</template>

<style scoped>
.chat-message {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 14px;
  padding: 2px 0;
}

.message-avatar {
  flex-shrink: 0;
  margin-top: 2px;
}

.message-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: space-between;
  height: 100%;
}

.message-header {
  display: flex;
  align-items: baseline;
  padding-top: 5px;
  gap: 8px;
}

.author {
  font-weight: 600;
  color: #333;
}

.timestamp {
  color: #888;
  font-size: 12px;
  font-family: monospace;
}

.message-text {
  word-wrap: break-word;
  word-break: break-word;
  user-select: text;
}
</style>
