<script setup lang="ts">
defineOptions({ name: 'ChatMessage' })
import { computed } from 'vue'
import type { ChatMessage, FileMeta } from '@/types/types'
import ImageMessage from '@/components/image/ImageMessage.vue'
import FileMessage from '@/components/file/FileMessage.vue'
import ProfileAvatar from '@/components/profile/ProfileAvatar.vue'

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

// YouTube URL 정규식
const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/g

// URL이 YouTube 링크인지 확인
const isYoutubeUrl = (url: string): boolean => {
  return /(?:youtube\.com|youtu\.be)/.test(url)
}

// 메시지에서 YouTube URL들을 추출
const extractYoutubeUrls = computed(() => {
  if (!props.message.text) return []
  const urls: string[] = []
  const matches = props.message.text.match(youtubeRegex)
  if (matches) {
    urls.push(...matches)
  }
  return urls
})

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

// Watch Party 버튼 클릭 핸들러
const handleWatchParty = (youtubeUrl: string) => {
  console.log('[ChatMessage] Opening Watch Party with URL:', youtubeUrl)
  console.log('[ChatMessage] Current location hash:', window.location.hash)

  // roomId는 채팅방 URL에서 가져오기 - 여러 패턴 시도
  let roomId = 'default'

  // 패턴 1: #/chat/roomId 또는 #/chat?roomId=xxx
  const hashMatch = window.location.hash.match(/\/chat[\/\?](?:roomId=)?([^&\/\?]+)/)
  if (hashMatch && hashMatch[1]) {
    roomId = decodeURIComponent(hashMatch[1])
  }

  console.log('[ChatMessage] Extracted roomId:', roomId)

  if (window.electronApi?.openWatchParty) {
    // 채팅방의 이름만 전달
    const name = localStorage.getItem('name') || ''
    window.electronApi.openWatchParty(roomId, youtubeUrl, name)
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
  <li class="chat-message" :class="{ 'continuation': showOnlyMessage }">
    <ProfileAvatar
      v-if="!showOnlyMessage"
      :imageUrl="profilePicture || null"
      :userName="getAuthor(message)"
      :size="40"
      :clickable="true"
      class="message-avatar"
      @click="emit('viewProfile', message.authorTrueUuid)"
    />
    <div v-else class="avatar-placeholder"></div>
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

      <!-- YouTube Watch Party 버튼 -->
      <div v-if="extractYoutubeUrls.length > 0" class="youtube-buttons">
        <button
          v-for="(youtubeUrl, index) in extractYoutubeUrls"
          :key="index"
          class="watch-party-btn"
          @click="handleWatchParty(youtubeUrl)"
        >
          <span class="icon">📺</span>
          <span class="text">Watch Party로 보기</span>
        </button>
      </div>

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
  gap: var(--spacing-sm);
  align-items: flex-start;
  font-size: var(--font-size-base);
  padding-top: var(--spacing-sm);
}

/* 연속 메시지일 때 간격 줄이기 */
.chat-message.continuation {
  padding-top: 1px;
}

.message-avatar {
  flex-shrink: 0;
  margin-top: 2px;
}

.avatar-placeholder {
  width: 40px;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.message-header {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
}

.author {
  font-weight: var(--font-weight-semibold);
  color: var(--color-secondary);
}

.timestamp {
  color: var(--color-accent);
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  opacity: 0.8;
}

.message-text {
  word-wrap: break-word;
  word-break: break-word;
  user-select: text;
  color: var(--text-primary);
  line-height: var(--line-height-normal);
}

.message-text :deep(.message-link) {
  color: var(--color-primary);
  text-decoration: none;
  border-bottom: 1px solid var(--color-accent);
  transition: all var(--transition-fast);
}

.message-text :deep(.message-link:hover) {
  color: var(--color-accent);
  border-bottom-color: var(--color-secondary);
}

.youtube-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.watch-party-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: linear-gradient(135deg, var(--accent-primary, #667eea) 0%, var(--accent-secondary, #764ba2) 100%);
  color: white;
  border: none;
  border-radius: var(--radius-md, 8px);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  max-width: 250px;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.watch-party-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.watch-party-btn:active {
  transform: translateY(0);
}

.watch-party-btn .icon {
  font-size: 18px;
}

.watch-party-btn .text {
  flex: 1;
}
</style>
