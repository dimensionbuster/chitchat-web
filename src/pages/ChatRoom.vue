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

const RECENT_MESSAGES_TO_LOAD = 30

const props = defineProps<{
  roomId?: string
  name?: string
}>()

// Identity & Room Setup
if (!localStorage.getItem('uuid')) {
  localStorage.setItem('uuid', crypto.randomUUID())
}

const uuid = localStorage.getItem('uuid')!
const me = `user-${uuid}`
const myName = ref(props.name?.trim() ? `${props.name.trim()}${me.slice(-4)}` : `User ${me.slice(-4)}`)
const activeRoomId = props.roomId?.trim() || 'default-room'

const yjsReady = ref(false)
const isUploading = ref(false)
const isInitialLoad = ref(true)

// Yjs & File Systems
const { messagesRef, messages, files, sendTextMessage, attachFileMeta, provider, requestFile, respondFile, getTransferMap, forceResync } = await useYjs(activeRoomId, me)
const { prepareFile } = useFileShare()
const { setupFileRequestListener, requestFileP2P } = useFileP2P(provider, files, me, requestFile, respondFile, getTransferMap)
const { imageUrls, loadingImages, failedDownloads, downloadImage, processAutoDownload } = useImageAutoDownload(files, requestFileP2P)
const { downloadFile } = useFileDownload(files, requestFileP2P)
const { showNotification } = useNotification()
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

// Handlers
const handleSend = (message: string) => {
  if (yjsReady.value) sendTextMessage(me, myName.value, message)
}

const handleUploadFile = async (file: File) => {
  if (!yjsReady.value || isUploading.value) return

  try {
    isUploading.value = true
    console.log('파일 업로드:', file.name, file.type)
    const { fileId, meta } = await prepareFile(file)
    attachFileMeta(fileId, meta, me, myName.value)
    console.log('업로드 완료:', fileId)
  } catch (error) {
    console.error('업로드 실패:', error)
    alert('파일 업로드에 실패했습니다.')
  } finally {
    isUploading.value = false
  }
}

const handleRequestDownload = (fileId: string) => fileId && downloadImage(fileId, true)
const handleDownload = (fileId: string) => fileId && downloadFile(fileId)
const handleGoHome = () => router.push({ name: 'Home' })
const handleClearChat = () => messages.delete(0, messages.length)
const handleReload = () => window.location.reload()

const handleForceResync = async () => {
  if (!confirm('🔄 동기화 오류가 발생했나요?\n\n로컬 데이터를 삭제하고 다른 피어의 데이터로 재동기화합니다.\n\n계속하시겠습니까?')) return

  try {
    const success = await forceResync()
    if (success) {
      alert('✅ 재동기화가 완료되었습니다.')
      window.location.reload()
    } else {
      alert('❌ 재동기화에 실패했습니다.')
    }
  } catch (error) {
    console.error('[ChatRoom] 재동기화 실패:', error)
    alert('❌ 재동기화 중 오류가 발생했습니다.')
  }
}

const handleResetAll = async () => {
  if (!confirm(`⚠️ 경고: "${activeRoomId}" 방의 모든 데이터를 초기화합니다. 계속하시겠습니까?`)) return

  try {
    console.log(`[DEBUG] ${activeRoomId} 방 초기화 시작`)
    provider.disconnect()

    const dbName = `ydb-${activeRoomId}`
    await new Promise<void>((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName)
      deleteRequest.onsuccess = () => {
        console.log(`[DEBUG] ✅ IndexedDB 삭제: ${dbName}`)
        resolve()
      }
      deleteRequest.onerror = reject
      deleteRequest.onblocked = () => setTimeout(resolve, 1000)
    })

    window.location.reload()
  } catch (error) {
    console.error('[DEBUG] 초기화 실패:', error)
    alert('❌ 초기화 중 오류가 발생했습니다.')
  }
}
// Message watching
watch(messagesRef, async (newMessages, oldMessages) => {
  await nextTick()
  messageListRef.value?.scrollToBottom()

  await processAutoDownload(messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD))

  if (!isInitialLoad.value && oldMessages && newMessages.length > oldMessages.length) {
    const newMessage = newMessages[newMessages.length - 1]
    if (newMessage && newMessage.authorTrueUuid !== me) {
      const authorName = newMessage.authorName || 'Unknown'
      const text = newMessage.text || '파일을 전송했습니다'
      console.log('[알림] 새 메시지:', { authorName, text })
      showNotification(authorName, text, newMessage.id)
    }
  }
})

// Initialization
onMounted(async () => {
  yjsReady.value = provider.connected
  provider.on('status', (e) => {
    yjsReady.value = e.connected
    console.log('Yjs status', e)
  })

  setupFileRequestListener()

  await nextTick()
  setTimeout(async () => {
    await processAutoDownload(messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD))
    setTimeout(() => {
      isInitialLoad.value = false
      console.log('[알림] 초기 로드 완료')
    }, 1000)
  }, 500)
})
</script>

<template>
  <div class="chat-room">
    <ChatHeader
      :roomId="activeRoomId"
      @reload="handleReload"
      @forceResync="handleForceResync"
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
