<script setup lang="ts">
defineOptions({ name: 'MessageList' })
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import type { ChatMessage as ChatMessageType, FileMeta } from '@/types/types'
import type { Map as YMap } from 'yjs'
import ChatMessage from '@/components/message/ChatMessage.vue'

defineProps<{
  messages: readonly ChatMessageType[]
  files: YMap<FileMeta> | Map<string, FileMeta>
  imageUrls: Map<string, string>
  loadingImages: Set<string>
  failedDownloads: Map<string, string>
  isReady: boolean
  getUserProfilePicture?: (userId: string) => string | null
}>()

const emit = defineEmits<{
  download: [fileId: string]
  requestDownload: [fileId: string]
  loadMore: []
  resetToLatest: []
  viewProfile: [userId: string]
}>()

const feedContainer = ref<HTMLElement | null>(null)
const showScrollToBottom = ref(false)
const isLoading = ref(false)
const prevScrollHeight = ref(0)

const scrollToBottom = () => {
  if (feedContainer.value) {
    feedContainer.value.scrollTop = feedContainer.value.scrollHeight
    showScrollToBottom.value = false
  }
}

const handleScroll = () => {
  if (!feedContainer.value) return

  const { scrollTop, scrollHeight, clientHeight } = feedContainer.value
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 100

  // 최하단이 아니면 플로팅 버튼 표시
  showScrollToBottom.value = !isAtBottom

  // 최상단 근처에서 이전 메시지 로드
  if (scrollTop < 100 && !isLoading.value) {
    isLoading.value = true
    prevScrollHeight.value = scrollHeight
    emit('loadMore')

    // 로딩 완료 후 스크롤 위치 복원
    nextTick(() => {
      setTimeout(() => {
        if (feedContainer.value) {
          const newScrollHeight = feedContainer.value.scrollHeight
          const scrollDiff = newScrollHeight - prevScrollHeight.value
          feedContainer.value.scrollTop = scrollTop + scrollDiff
        }
        isLoading.value = false
      }, 100)
    })
  }
}

const handleScrollToBottom = () => {
  emit('resetToLatest')
  nextTick(() => {
    scrollToBottom()
  })
}

onMounted(() => {
  if (feedContainer.value) {
    feedContainer.value.addEventListener('scroll', handleScroll)
  }
})

onUnmounted(() => {
  if (feedContainer.value) {
    feedContainer.value.removeEventListener('scroll', handleScroll)
  }
})

defineExpose({ scrollToBottom })
</script>

<template>
  <div class="message-list-container">
    <ul ref="feedContainer" class="message-list">
      <li v-if="isLoading" class="loading-message">이전 메시지 로드 중...</li>
      <li v-if="!isReady" class="status-message">Yjs 네트워크 연결 중…</li>
      <ChatMessage
        v-for="m, index in messages"
        :key="m.id"
        :prev-message="messages[index - 1]"
        :message="m"
        :fileMeta="m.fileId ? files.get(m.fileId) : undefined"
        :imageUrl="m.fileId ? imageUrls.get(m.fileId) : undefined"
        :isImageLoading="m.fileId ? loadingImages.has(m.fileId) : false"
        :errorMessage="m.fileId ? failedDownloads.get(m.fileId) : undefined"
        :profilePicture="getUserProfilePicture ? getUserProfilePicture(m.authorTrueUuid) : null"
        @download="emit('download', $event)"
        @requestDownload="emit('requestDownload', $event)"
        @viewProfile="emit('viewProfile', $event)"
      />
    </ul>

    <Transition name="fade">
      <button
        v-if="showScrollToBottom"
        class="scroll-to-bottom-btn"
        @click="handleScrollToBottom"
        title="최신 메시지로 돌아가기"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M19 12l-7 7-7-7"/>
        </svg>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.message-list-container {
  position: relative;
  flex: 1;
  min-height: 0;
}

.message-list {
  height: 100%;
  list-style: none;
  padding: var(--spacing-md);
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(10px);
}

.status-message,
.loading-message {
  font-size: var(--font-size-sm);
  color: var(--text-muted);
  text-align: center;
  padding: var(--spacing-md);
}

.loading-message {
  color: var(--color-secondary);
  font-weight: var(--font-weight-medium);
  background: linear-gradient(90deg, var(--color-primary-light), var(--color-accent), var(--color-primary-light));
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.scroll-to-bottom-btn {
  position: absolute;
  bottom: var(--spacing-xl);
  right: var(--spacing-xl);
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%);
  color: white;
  border: none;
  box-shadow: 0 4px 16px rgba(var(--color-primary-rgb), 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  z-index: var(--z-dropdown);
}

.scroll-to-bottom-btn:hover {
  transform: translateY(-2px);
  background: linear-gradient(135deg, var(--color-secondary) 0%, var(--color-primary) 100%);
  box-shadow: 0 6px 24px rgba(var(--color-primary-rgb), 0.5);
}

.scroll-to-bottom-btn:active {
  transform: translateY(0);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--transition-normal), transform var(--transition-normal);
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
