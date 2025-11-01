<script setup lang="ts">
defineOptions({ name: 'ChatRoomPage' })
import { ref, onMounted, nextTick, watch } from 'vue'
import { useYjs } from '../composables/useYjs'
import { useFileShare } from '../composables/useFileShare'
import { useFileP2P } from '../composables/useFileP2P'
import { useImageAutoDownload } from '../composables/useImageAutoDownload'
import { useFileDownload } from '../composables/useFileDownload'
import { useNotification } from '../composables/useNotification'
import router from '@/router'
import ChatHeader from '@/components/ChatHeader.vue'
import MessageList from '@/components/MessageList.vue'
import ChatInput from '@/components/ChatInput.vue'

// ========== 설정 상수 ==========
// 최근 N개 메시지의 이미지만 자동 로드
const RECENT_MESSAGES_TO_LOAD = 30
// ==============================

const props = defineProps<{
  roomId?: string
  name?: string
}>()

// ========== Identity & Room Setup ==========
if (!localStorage.getItem('uuid')) {
  localStorage.setItem('uuid', crypto.randomUUID())
}
const me = 'user-' + localStorage.getItem('uuid')
const myName = ref('User ' + me.slice(-4))

if (props.name && props.name.trim()) {
  myName.value = props.name.trim() + me.slice(-4)
}

const activeRoomId = props.roomId?.trim() || 'default-room'
const yjsReady = ref(false)
const isUploading = ref(false)
const isInitialLoad = ref(true) // 초기 로드 플래그

// ========== Yjs & File Systems ==========
const {
  messagesRef,
  messages,
  files,
  sendTextMessage,
  attachFileMeta,
  provider,
  requestFile,
  respondFile,
  getTransferMap,
} = useYjs(activeRoomId)

const { prepareFile } = useFileShare()

// P2P 파일 전송
const { setupFileRequestListener, requestFileP2P } = useFileP2P(
  provider,
  files,
  me,
  requestFile,
  respondFile,
  getTransferMap,
)

// 이미지 자동 다운로드
const { imageUrls, loadingImages, failedDownloads, downloadImage, processAutoDownload } =
  useImageAutoDownload(files, requestFileP2P)

// 파일 다운로드
const { downloadFile } = useFileDownload(files, requestFileP2P)

// 알림
const { showNotification } = useNotification()

// MessageList ref
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

// ========== 핸들러 함수들 ==========
const handleSend = (message: string) => {
  if (!yjsReady.value) return
  sendTextMessage(me, myName.value, message)
}

const handleUploadFile = async (file: File) => {
  if (!yjsReady.value || isUploading.value) return

  try {
    isUploading.value = true
    console.log('파일 업로드 시작:', file.name, file.type)
    const { fileId, meta } = await prepareFile(file)
    attachFileMeta(fileId, meta, me, myName.value)
    console.log('파일 업로드 완료:', fileId)
  } catch (error) {
    console.error('파일 업로드 실패:', error)
    alert('파일 업로드에 실패했습니다.')
  } finally {
    isUploading.value = false
  }
}

const handleRequestDownload = async (fileId: string) => {
  if (!fileId) return
  await downloadImage(fileId, true)
}

const handleDownload = async (fileId: string) => {
  if (!fileId) return
  await downloadFile(fileId)
}

const handleForceSync = () => {
  provider.disconnect()
  setTimeout(() => provider.connect(), 1000)
}

const handleGoHome = () => {
  router.push({ name: 'Home' })
}

const handleClearChat = () => {
  messages.delete(0, messages.length)
}

const handleResetAll = async () => {
  if (!confirm(`⚠️ 경고: "${activeRoomId}" 방의 모든 데이터를 초기화합니다. 계속하시겠습니까?`)) {
    return
  }

  try {
    console.log(`[DEBUG] ${activeRoomId} 방 초기화 시작...`)

    // 1. Provider 연결 해제
    console.log('[DEBUG] Provider 연결 해제 중...')
    provider.disconnect()

    // 2. 해당 room의 IndexedDB 삭제
    console.log(`[DEBUG] IndexedDB 삭제 중: ydb-${activeRoomId}`)
    const dbName = `ydb-${activeRoomId}`

    await new Promise<void>((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName)

      deleteRequest.onsuccess = () => {
        console.log(`[DEBUG] ✅ IndexedDB 삭제 완료: ${dbName}`)
        resolve()
      }

      deleteRequest.onerror = (event) => {
        console.error(`[DEBUG] ❌ IndexedDB 삭제 실패: ${dbName}`, event)
        reject(event)
      }

      deleteRequest.onblocked = () => {
        console.warn(`[DEBUG] ⚠️ IndexedDB 삭제 차단됨: ${dbName} (다른 탭에서 사용 중일 수 있음)`)
        // blocked 상태에서도 계속 진행
        setTimeout(() => resolve(), 1000)
      }
    })

    // 3. 페이지 새로고침으로 깨끗하게 재시작
    console.log('[DEBUG] 페이지 새로고침...')
    window.location.reload()
  } catch (error) {
    console.error('[DEBUG] 초기화 중 오류 발생:', error)
    alert('❌ 초기화 중 오류가 발생했습니다. 콘솔을 확인해주세요.')
  }
}

// ========== 메시지 변경 감지 ==========
watch(
  messagesRef,
  async (newMessages, oldMessages) => {
    await nextTick()
    messageListRef.value?.scrollToBottom()

    // 최근 N개 메시지의 이미지 자동 다운로드
    const recentMessages = messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD)
    await processAutoDownload(recentMessages)

    // 새 메시지 알림 (초기 로드가 아니고, 본인 메시지가 아니고, 메시지가 증가한 경우)
    if (!isInitialLoad.value && oldMessages && newMessages.length > oldMessages.length) {
      const newMessage = newMessages[newMessages.length - 1]
      // 본인이 보낸 메시지가 아닐 때만 알림 표시
      if (newMessage && newMessage.authorTrueUuid !== me) {
        const authorName = newMessage.authorName || 'Unknown'
        const text = newMessage.text || '파일을 전송했습니다'
        console.log('[알림] 새 메시지 알림 표시:', { authorName, text })
        showNotification(authorName, text, newMessage.id)
      }
    }
  },
  { immediate: false },
)

// ========== 초기화 ==========
onMounted(async () => {
  // Yjs 연결 상태 설정
  yjsReady.value = provider.connected
  provider.on('status', (e) => {
    yjsReady.value = e.connected
    console.log('Yjs status', e)
  })

  // P2P 파일 요청 리스너 설정
  setupFileRequestListener()

  // 초기 이미지 자동 다운로드 및 초기 로드 완료 처리
  await nextTick()
  setTimeout(async () => {
    const recentMessages = messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD)
    await processAutoDownload(recentMessages)

    // 초기 동기화 완료 후 플래그 해제 (이후부터 알림 활성화)
    setTimeout(() => {
      isInitialLoad.value = false
      console.log('[알림] 초기 로드 완료 - 알림 활성화')
    }, 1000)
  }, 500)
})
</script>

<template>
  <div class="chat-room">
    <ChatHeader
      :roomId="activeRoomId"
      @forceSync="handleForceSync"
      @goHome="handleGoHome"
      @clearChat="handleClearChat"
      @resetAll="handleResetAll"
    />

    <MessageList
      ref="messageListRef"
      :messages="messagesRef"
      :files="files"
      :imageUrls="imageUrls"
      :loadingImages="loadingImages"
      :failedDownloads="failedDownloads"
      :isReady="yjsReady"
      @download="handleDownload"
      @requestDownload="handleRequestDownload"
    />

    <ChatInput
      :disabled="!yjsReady"
      :isUploading="isUploading"
      @send="handleSend"
      @uploadFile="handleUploadFile"
    />
  </div>
</template>

<style scoped>
.chat-room {
  height: 100%;
  width: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
</style>
