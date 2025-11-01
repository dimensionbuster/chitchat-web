<script setup lang="ts">
defineOptions({ name: 'MessageList' })
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import type { ChatMessage as ChatMessageType, FileMeta } from '@/types/types'
import type { Map as YMap } from 'yjs'
import ChatMessage from './ChatMessage.vue'

defineProps<{
  messages: readonly ChatMessageType[]
  files: YMap<FileMeta> | Map<string, FileMeta>
  imageUrls: Map<string, string>
  loadingImages: Set<string>
  failedDownloads: Map<string, string>
  isReady: boolean
}>()

const emit = defineEmits<{
  download: [fileId: string]
  requestDownload: [fileId: string]
  loadMore: []
  resetToLatest: []
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
  height: 80%;
}

.message-list {
  height: 100%;
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: scroll;
}

.status-message,
.loading-message {
  font-size: 14px;
  color: #888;
  text-align: center;
  padding: 12px;
}

.loading-message {
  color: #4a90e2;
  font-weight: 500;
}

.scroll-to-bottom-btn {
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #4a90e2;
  color: white;
  border: none;
  box-shadow: 0 4px 12px rgba(74, 144, 226, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  z-index: 100;
}

.scroll-to-bottom-btn:hover {
  background: #357abd;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(74, 144, 226, 0.5);
}

.scroll-to-bottom-btn:active {
  transform: translateY(0);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
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
