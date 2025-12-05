<script setup lang="ts">
defineOptions({ name: 'ChatMessage' })
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import type { ChatMessage, FileMeta } from '@/types/types'
import ImageMessage from '@/components/image/ImageMessage.vue'
import FileMessage from '@/components/file/FileMessage.vue'
import ProfileAvatar from '@/components/profile/ProfileAvatar.vue'

// YouTube API 로드 상태
let ytApiLoaded = false
let ytApiLoading = false
const ytApiReadyCallbacks: (() => void)[] = []

// YouTube IFrame API 로드
const loadYouTubeApi = (): Promise<void> => {
  return new Promise((resolve) => {
    if (ytApiLoaded && window.YT && window.YT.Player) {
      resolve()
      return
    }

    ytApiReadyCallbacks.push(resolve)

    if (ytApiLoading) {
      return
    }

    ytApiLoading = true

    // 기존 콜백 저장
    const existingCallback = window.onYouTubeIframeAPIReady

    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true
      ytApiLoading = false
      if (existingCallback) existingCallback()
      ytApiReadyCallbacks.forEach(cb => cb())
      ytApiReadyCallbacks.length = 0
    }

    // 이미 로드된 스크립트가 있는지 확인
    if (!document.getElementById('youtube-iframe-api')) {
      const tag = document.createElement('script')
      tag.id = 'youtube-iframe-api'
      tag.src = 'https://www.youtube.com/iframe_api'
      const firstScriptTag = document.getElementsByTagName('script')[0]
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
      } else {
        document.head.appendChild(tag)
      }
    }
  })
}

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

// YouTube URL에서 비디오 ID 추출
const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/g

// YouTube 비디오 ID만 추출하는 함수
const extractYoutubeVideoId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) return match[1]
  }
  return null
}

// URL이 YouTube 링크인지 확인
const isYoutubeUrl = (url: string): boolean => {
  return /(?:youtube\.com|youtu\.be)/.test(url)
}

// 메시지에서 YouTube URL들을 추출
const extractYoutubeUrls = computed(() => {
  if (!props.message.text) return []
  const urls: { videoId: string; originalUrl: string }[] = []
  const matches = props.message.text.match(youtubeRegex)
  if (matches) {
    for (const match of matches) {
      const videoId = extractYoutubeVideoId(match)
      if (videoId) {
        urls.push({ videoId, originalUrl: match })
      }
    }
  }
  return urls
})

// YouTube 임베드 URL 생성 (광고 최소화 파라미터 적용)
const getYoutubeEmbedUrl = (videoId: string): string => {
  const origin = window.location.origin
  const params = new URLSearchParams({
    autoplay: '0',
    mute: '0',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    controls: '1',
    fs: '1',
    disablekb: '0',
    iv_load_policy: '3',
    cc_load_policy: '0',
    origin: origin,
    enablejsapi: '1',
    widgetid: '1',
    showinfo: '0',
    forigin: origin + '/',
    aoriginsup: '1',
    vf: '6'
  })
  // youtube-nocookie.com 사용으로 관련 동영상 및 쿠키 최소화
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
}

// YouTube 플레이어 인스턴스 저장
const youtubePlayersRef = ref<Map<string, YT.Player>>(new Map())
const youtubeContainersReady = ref<Set<string>>(new Set())

// YouTube 플레이어 생성
const createYouTubePlayer = async (videoId: string, containerId: string) => {
  await loadYouTubeApi()

  // 이미 플레이어가 있으면 제거
  const existingPlayer = youtubePlayersRef.value.get(containerId)
  if (existingPlayer) {
    try {
      existingPlayer.destroy()
    } catch {
      // ignore
    }
    youtubePlayersRef.value.delete(containerId)
  }

  const container = document.getElementById(containerId)
  if (!container) return

  const origin = window.location.origin

  const player = new window.YT.Player(containerId, {
    host: 'https://www.youtube-nocookie.com',  // 쿠키 없는 도메인 사용
    videoId: videoId,
    playerVars: {
      autoplay: 0,
      mute: 0,
      playsinline: 1,
      rel: 0,              // 관련 동영상 비활성화 (같은 채널만)
      modestbranding: 1,   // YouTube 로고 최소화
      controls: 1,
      fs: 1,
      disablekb: 0,
      iv_load_policy: 3,   // 주석 비활성화
      cc_load_policy: 0,
      origin: origin,
      enablejsapi: 1,
      showinfo: 0,         // 영상 정보 숨김 (deprecated지만 일부 효과)
      // SkipCut 스타일 파라미터
      forigin: origin + '/',
      aoriginsup: 1,
      vf: 6
    },
    events: {
      onReady: (event) => {
        console.log('YouTube player ready:', videoId)
      },
      onError: (event) => {
        console.error('YouTube player error:', event.data)
      }
    }
  })

  youtubePlayersRef.value.set(containerId, player)
}

// 컴포넌트 마운트 시 플레이어 초기화
const initializePlayers = async () => {
  await nextTick()
  for (const youtube of extractYoutubeUrls.value) {
    const containerId = `youtube-player-${props.message.id}-${youtube.videoId}`
    youtubeContainersReady.value.add(containerId)
    await createYouTubePlayer(youtube.videoId, containerId)
  }
}

// YouTube URL이 변경되면 플레이어 재생성
watch(() => extractYoutubeUrls.value, async (newUrls) => {
  if (newUrls.length > 0) {
    await initializePlayers()
  }
}, { deep: true })

onMounted(async () => {
  if (extractYoutubeUrls.value.length > 0) {
    await initializePlayers()
  }
})

onUnmounted(() => {
  // 플레이어 정리
  youtubePlayersRef.value.forEach((player) => {
    try {
      player.destroy()
    } catch {
      // ignore
    }
  })
  youtubePlayersRef.value.clear()
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

      <!-- YouTube 임베드 (IFrame Player API 사용) -->
      <div v-if="extractYoutubeUrls.length > 0" class="youtube-embeds">
        <div v-for="youtube in extractYoutubeUrls" :key="youtube.videoId" class="youtube-embed-wrapper">
          <div class="youtube-embed">
            <div :id="`youtube-player-${message.id}-${youtube.videoId}`" class="youtube-player-container"></div>
          </div>
        </div>
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

.youtube-embeds {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

.youtube-embed {
  position: relative;
  width: 100%;
  max-width: 560px;
  aspect-ratio: 16 / 9;
  border-radius: var(--border-radius-md, 8px);
  overflow: hidden;
  background-color: var(--bg-secondary, #1a1a1a);
}

.youtube-player-container {
  width: 100%;
  height: 100%;
}

.youtube-embed iframe,
.youtube-embed :deep(iframe) {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
}
</style>
