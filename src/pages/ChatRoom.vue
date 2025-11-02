<script setup lang="ts">
defineOptions({ name: 'ChatRoomPage' })
import { ref, onMounted, nextTick, watch } from 'vue'
import { useYjs } from '../composables/useYjs'
import { useFileEncoder } from '../composables/useFileEncoder'
import { useFileTransfer } from '../composables/useFileTransfer'
import { useImageAutoLoader } from '../composables/useImageAutoLoader'
import { useFileActions } from '../composables/useFileActions'
import { useNotification } from '../composables/useNotification'
import { useGlobalDataChannelQueue } from '../composables/useGlobalDataChannelQueue'
import { useProfilePicture } from '../composables/useProfilePicture'
import { getCachedFile } from '../composables/useStorageFileCache'
import router from '@/router'
import ChatHeader from '@/components/ChatHeader.vue'
import MessageList from '@/components/MessageList.vue'
import ChatInput from '@/components/ChatInput.vue'
import QueueStatus from '@/components/QueueStatus.vue'
import ProfilePictureUpload from '@/components/ProfilePictureUpload.vue'
import ImageModal from '@/components/ImageModal.vue'
import FileTransferProgress from '@/components/FileTransferProgress.vue'

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
const { messagesRef, messagesMap, files, sendTextMessage, attachFileMeta, provider, requestFile, respondFile, getTransferMap, loadMoreMessages, resetToLatest, isViewingLatest, forceResync } = await useYjs(activeRoomId, me)

// 글로벌 큐 매니저 초기화
const { setProvider } = useGlobalDataChannelQueue({
  maxConcurrentJobs: 3,
  maxBufferSize: 16 * 1024 * 1024,
  bufferThreshold: 512 * 1024,
})
setProvider(provider)

const { prepareFile } = useFileEncoder()
const { setupFileRequestListener, requestFileP2P, registerFileAvailability } = useFileTransfer(provider, files, me, requestFile, respondFile, getTransferMap)
const { imageUrls, loadingImages, failedDownloads, downloadImage, processAutoDownload } = useImageAutoLoader(files, requestFileP2P)
const { downloadFile } = useFileActions(files, requestFileP2P)
const { showNotification } = useNotification()

// 프로필 사진 기능
const {
  myProfilePicture,
  profilePictures,
  getUserProfilePicture,
  setMyProfilePicture,
  deleteMyProfilePicture,
  handlePeerConnected,
  initializeProfilePictures,
  getProfileOriginalFileId
} = useProfilePicture(provider, me, files, registerFileAvailability)

const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)
const showProfileModal = ref(false)
const showProfileImageModal = ref(false)
const viewingProfileUserId = ref<string | null>(null)
const viewingProfileImageUrl = ref<string | null>(null)
const downloadingProfileFileId = ref<string | null>(null)

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

    // 파일 청크 정보를 awareness에 등록 (다른 피어가 받을 수 있도록)
    await registerFileAvailability(fileId)

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
const handleLoadMore = () => loadMoreMessages()
const handleResetToLatest = () => resetToLatest()

// 프로필 원본 보기
const handleViewProfile = async (userId: string) => {
  try {
    viewingProfileUserId.value = userId

    // 원본 파일 ID 가져오기
    const originalFileId = await getProfileOriginalFileId(userId)

    if (!originalFileId) {
      alert('원본 프로필 사진이 없습니다.')
      return
    }

    // 먼저 캐시에 있는지 확인 (본인/타인 구분 없이)
    const cachedBlob = await getCachedFile(originalFileId)
    if (cachedBlob) {
      console.log(`[ChatRoom] 캐시에서 프로필 원본 로드: ${originalFileId}`)
      viewingProfileImageUrl.value = URL.createObjectURL(cachedBlob)
      showProfileImageModal.value = true
      return
    }

    // 캐시에 없으면 다운로드
    console.log(`[ChatRoom] 프로필 원본 다운로드 시작: ${originalFileId}`)
    downloadingProfileFileId.value = originalFileId
    const blob = await requestFileP2P(originalFileId)
    downloadingProfileFileId.value = null
    viewingProfileImageUrl.value = URL.createObjectURL(blob)
    showProfileImageModal.value = true
  } catch (error) {
    console.error('[ChatRoom] 프로필 원본 로드 실패:', error)
    downloadingProfileFileId.value = null

    // 원본 다운로드 실패 시 압축된 썸네일을 대신 표시
    console.log(`[ChatRoom] 원본 실패, 썸네일로 대체: ${userId}`)
    const thumbnailUrl = getUserProfilePicture.value(userId)

    if (thumbnailUrl) {
      // data URL을 Blob으로 변환
      try {
        const response = await fetch(thumbnailUrl)
        const blob = await response.blob()
        viewingProfileImageUrl.value = URL.createObjectURL(blob)
        showProfileImageModal.value = true
        console.log('[ChatRoom] 썸네일로 표시 완료')
      } catch (thumbError) {
        console.error('[ChatRoom] 썸네일 표시 실패:', thumbError)
        alert('프로필 사진을 불러올 수 없습니다.')
      }
    } else {
      alert('프로필 사진을 불러올 수 없습니다.')
    }
  }
}

const handleCloseProfileImage = () => {
  if (viewingProfileImageUrl.value) {
    URL.revokeObjectURL(viewingProfileImageUrl.value)
  }
  showProfileImageModal.value = false
  viewingProfileImageUrl.value = null
  viewingProfileUserId.value = null
}

const handleDownloadProfileImage = async () => {
  if (!viewingProfileImageUrl.value || !viewingProfileUserId.value) return

  try {
    const response = await fetch(viewingProfileImageUrl.value)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `profile_${viewingProfileUserId.value}_original.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('[ChatRoom] 프로필 다운로드 실패:', error)
  }
}
const handleGoHome = () => {
  // Electron 환경에서는 메인 윈도우 표시
  if (window.electronApi) {
    window.electronApi.showMainWindow()
  } else {
    // 웹 환경에서는 라우터로 이동
    router.push({ name: 'Home' })
  }
}

// 프로필 사진 핸들러
const handleOpenProfileSettings = () => {
  showProfileModal.value = true
}

const handleCloseProfileSettings = () => {
  showProfileModal.value = false
}

const handleProfileUpload = async (file: File) => {
  try {
    await setMyProfilePicture(file)
    alert('프로필 사진이 설정되었습니다.')
  } catch (error) {
    console.error('[ChatRoom] 프로필 설정 실패:', error)
    alert('프로필 사진 설정에 실패했습니다.')
  }
}

const handleProfileDelete = async () => {
  try {
    await deleteMyProfilePicture()
    alert('프로필 사진이 삭제되었습니다.')
  } catch (error) {
    console.error('[ChatRoom] 프로필 삭제 실패:', error)
    alert('프로필 사진 삭제에 실패했습니다.')
  }
}
const handleClearChat = () => messagesMap.clear()
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
let previousTotalMessageCount = 0
watch(messagesRef, async (newMessages) => {
  await nextTick()

  // 최신 메시지를 보고 있을 때만 자동 스크롤
  if (isViewingLatest()) {
    messageListRef.value?.scrollToBottom()
  }

  await processAutoDownload(messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD))

  const currentTotalCount = messagesMap.size // Y.Map의 실제 크기
  if (!isInitialLoad.value && currentTotalCount > previousTotalMessageCount) {
    const newMessage = newMessages[newMessages.length - 1]
    if (newMessage && newMessage.authorTrueUuid !== me) {
      const authorName = newMessage.authorName || 'Unknown'
      const text = newMessage.text || '파일을 전송했습니다'
      console.log('[알림] 새 메시지:', { authorName, text, totalCount: currentTotalCount })
      showNotification(authorName, text, newMessage.id, activeRoomId)
    }
  }
  previousTotalMessageCount = currentTotalCount
})

// Initialization
onMounted(async () => {
  yjsReady.value = provider.connected
  provider.on('status', (e) => {
    yjsReady.value = e.connected
    console.log('Yjs status', e)
  })

  // 프로필 사진 초기화
  await initializeProfilePictures()

  // 피어 연결 이벤트 리스너
  provider.on('peers', (event: { added: string[]; removed: string[]; webrtcPeers: string[] }) => {
    console.log('[ChatRoom] Peers changed:', event)

    // 새로 연결된 피어의 userId를 찾아서 프로필 전송
    if (event.added.length > 0) {
      // awareness에서 새로 연결된 피어들의 userId 찾기
      for (const [clientId, state] of provider.awareness.getStates()) {
        const stateObj = state as Record<string, unknown>
        const userUuid = stateObj.userUuid as string | undefined

        // 새로 추가된 클라이언트인지 확인 (clientId는 숫자일 수 있음)
        if (userUuid && userUuid !== me && event.webrtcPeers.includes(clientId.toString())) {
          console.log(`[ChatRoom] 새 피어 감지: ${userUuid.slice(-8)}`)
          handlePeerConnected(userUuid).catch(error => {
            console.error(`[ChatRoom] 피어 연결 처리 실패: ${userUuid}`, error)
          })
        }
      }
    }
  })

  // 처리된 피어 추적 (중복 방지)
  const processedPeers = new Set<string>()

  // awareness 변경 이벤트도 감지 (피어가 연결되고 나서 awareness가 업데이트될 수 있음)
  provider.awareness.on('change', () => {
    // 연결된 모든 피어의 프로필 상태 확인
    for (const [, state] of provider.awareness.getStates()) {
      const stateObj = state as Record<string, unknown>
      const userUuid = stateObj.userUuid as string | undefined
      const profileAwareness = stateObj.profilePicture as { userId: string; hasProfilePicture: boolean; timestamp: number } | undefined

      // 내가 아닌 피어가 프로필을 가지고 있다고 알림
      if (userUuid && userUuid !== me && profileAwareness?.hasProfilePicture) {
        // 이미 처리한 피어는 스킵
        const peerKey = `${userUuid}-${profileAwareness.timestamp}`
        if (!processedPeers.has(peerKey)) {
          processedPeers.add(peerKey)

          // 해당 피어에게 내 프로필 전송 (한 번만)
          handlePeerConnected(userUuid).catch(error => {
            console.error(`[ChatRoom] awareness 피어 처리 실패: ${userUuid}`, error)
          })
        }
      }
    }
  })

  setupFileRequestListener()

  // 캐시된 파일들을 awareness에 등록 (다른 피어가 요청할 수 있도록)
  console.log('[ChatRoom] 캐시된 파일 등록 시작')
  for (const [fileId] of files) {
    try {
      await registerFileAvailability(fileId)
    } catch (error) {
      console.warn(`[ChatRoom] 파일 등록 실패: ${fileId}`, error)
    }
  }
  console.log('[ChatRoom] 캐시된 파일 등록 완료')

  // 초기 메시지 로드 및 스크롤
  await nextTick()

  // 최초 로딩 시 스크롤을 맨 아래로
  messageListRef.value?.scrollToBottom()

  // 이미지 자동 다운로드 시작
  await processAutoDownload(messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD))

  // 초기 로드 완료 표시 (알림 활성화)
  isInitialLoad.value = false
  console.log('[알림] 초기 로드 완료')
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
      :getUserProfilePicture="getUserProfilePicture"
      @download="handleDownload"
      @requestDownload="handleRequestDownload"
      @loadMore="handleLoadMore"
      @resetToLatest="handleResetToLatest"
      @viewProfile="handleViewProfile"
    />

    <ChatInput
      :disabled="!yjsReady"
      :isUploading="isUploading"
      @send="handleSend"
      @uploadFile="handleUploadFile"
      @openProfileSettings="handleOpenProfileSettings"
    />

    <!-- 프로필 설정 모달 -->
    <div v-if="showProfileModal" class="modal-overlay" @click="handleCloseProfileSettings">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h2>프로필 설정</h2>
          <button class="close-button" @click="handleCloseProfileSettings">✕</button>
        </div>
        <ProfilePictureUpload
          :currentImage="myProfilePicture"
          :disabled="!yjsReady"
          @upload="handleProfileUpload"
          @delete="handleProfileDelete"
        />
      </div>
    </div>

    <!-- 전송 큐 상태 표시 (화면 우측 하단) -->
    <QueueStatus />

    <!-- 프로필 원본 다운로드 진행률 -->
    <FileTransferProgress
      v-if="downloadingProfileFileId"
      :fileId="downloadingProfileFileId"
      fileName="프로필 사진"
    />

    <!-- 프로필 원본 이미지 모달 -->
    <ImageModal
      v-if="showProfileImageModal && viewingProfileImageUrl"
      :imageUrl="viewingProfileImageUrl"
      :fileName="`Profile_${viewingProfileUserId}`"
      @close="handleCloseProfileImage"
      @download="handleDownloadProfileImage"
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

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.modal-header h2 {
  margin: 0;
  font-size: 20px;
}

.close-button {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s;
}

.close-button:hover {
  background: #f0f0f0;
}
</style>
