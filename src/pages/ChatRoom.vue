<script setup lang="ts">
defineOptions({ name: 'ChatRoomPage' })
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import { useYjs } from '../composables/useYjs'
import { useFileEncoder } from '../composables/useFileEncoder'
import { useFileTransfer } from '../composables/useFileTransfer'
import { useImageAutoLoader } from '../composables/useImageAutoLoader'
import { useFileActions } from '../composables/useFileActions'
import { useNotification } from '../composables/useNotification'
import { useNotificationSound } from '../composables/useNotificationSound'
import { useGlobalDataChannelQueue } from '../composables/useGlobalDataChannelQueue'
import { useProfilePicture } from '../composables/useProfilePicture'
import { useBackgroundImage } from '../composables/useBackgroundImage'
import { useStyleSettings } from '../composables/useStyleSettings'
import { getCachedFile } from '../composables/useStorageFileCache'
import { showAlert, showConfirm } from '../composables/useCustomDialog'
import { useConnectedUsers } from '../composables/useConnectedUsers'
import router from '@/router'
import ChatHeader from '@/components/layout/ChatHeader.vue'
import MessageList from '@/components/message/MessageList.vue'
import ChatInput from '@/components/message/ChatInput.vue'
import QueueStatus from '@/components/transfer/QueueStatus.vue'
import ProfilePictureUpload from '@/components/profile/ProfilePictureUpload.vue'
import ImageModal from '@/components/image/ImageModal.vue'
import FileTransferProgress from '@/components/file/FileTransferProgress.vue'

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
const isSendingMessage = ref(false) // 내가 메시지를 보내는 중인지 추적

// Yjs & File Systems
const { messagesRef, messagesMap, files, sendTextMessage, attachFileMeta, provider, requestFile, respondFile, getTransferMap, loadMoreMessages, resetToLatest, isViewingLatest, forceResync, importSnapshot, exportSnapshot } = await useYjs(activeRoomId, me, myName.value)

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

// 알림 소리
const { playSound } = useNotificationSound()

// 프로필 사진 기능
const {
  myProfilePicture,
  getUserProfilePicture,
  handlePeerConnected,
  initializeProfilePictures,
  getProfileOriginalFileId,
  createProfileHandlers
} = useProfilePicture(provider, me, files, registerFileAvailability)

// 공통 핸들러 생성 (캡슐화)
const { handleUpload: handleProfileUpload, handleDelete: handleProfileDelete } = createProfileHandlers()

// 접속자 목록 기능
const { connectedUsers, userCount } = useConnectedUsers(provider, me)

// 배경 이미지
const { currentBackground, isElectron } = useBackgroundImage('chat')

// 스타일 설정 (실시간 CSS 변수 업데이트)
useStyleSettings()

const backgroundStyle = computed(() => {
  if (currentBackground.value) {
    return {
      backgroundImage: `url(${currentBackground.value})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    }
  }
  return {}
})

const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)
const showProfileModal = ref(false)
const showProfileImageModal = ref(false)
const viewingProfileUserId = ref<string | null>(null)
const viewingProfileImageUrl = ref<string | null>(null)
const downloadingProfileFileId = ref<string | null>(null)
const isDraggingOver = ref(false)

// Watch Party - Electron에서 별도 창으로 열기
const handleOpenWatchParty = () => {
  if (window.electronApi?.openWatchParty) {
    // 채팅방의 이름만 전달 (localStorage의 순수 닉네임)
    const pureName = localStorage.getItem('name') || ''
    console.log('[ChatRoom] Opening WatchParty with:', {
      roomId: activeRoomId,
      name: pureName
    })
    window.electronApi.openWatchParty(activeRoomId, undefined, pureName)
  }
}

// 드래그 앤 드롭 핸들러
const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
  isDraggingOver.value = true
}

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault()
  isDraggingOver.value = false
}

const handleDrop = async (e: DragEvent) => {
  e.preventDefault()
  isDraggingOver.value = false

  if (!yjsReady.value || isUploading.value) {
    await showAlert('현재 파일을 업로드할 수 없습니다.')
    return
  }

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  // 첫 번째 파일만 업로드
  const file = files[0]
  if (file) {
    await handleUploadFile(file)
  }
}

// Handlers
const handleSend = (message: string) => {
  if (yjsReady.value) {
    // 메시지 전송 시작 플래그 설정 (watch에서 알림이 울리지 않도록)
    isSendingMessage.value = true
    sendTextMessage(me, myName.value, message)
    // 본인이 메시지를 보낼 때는 항상 최신 메시지로 이동
    resetToLatest()
    nextTick(() => {
      messageListRef.value?.scrollToBottom()
      // 스크롤 완료 후 플래그 해제 (약간의 지연을 두어 watch 트리거가 완료되도록)
      setTimeout(() => {
        isSendingMessage.value = false
      }, 150)
    })
  }
}

const handleUploadFile = async (file: File) => {
  if (!yjsReady.value || isUploading.value) return

  try {
    isUploading.value = true
    // 파일 전송 시작 플래그 설정 (watch에서 알림이 울리지 않도록)
    isSendingMessage.value = true
    console.log('파일 업로드:', file.name, file.type)
    const { fileId, meta } = await prepareFile(file)
    attachFileMeta(fileId, meta, me, myName.value)

    // 파일 청크 정보를 awareness에 등록 (다른 피어가 받을 수 있도록)
    await registerFileAvailability(fileId)

    // 본인이 파일을 보낼 때는 항상 최신 메시지로 이동
    resetToLatest()
    await nextTick()
    messageListRef.value?.scrollToBottom()

    // 스크롤 완료 후 플래그 해제
    setTimeout(() => {
      isSendingMessage.value = false
    }, 150)

    console.log('업로드 완료:', fileId)
  } catch (error) {
    console.error('업로드 실패:', error)
    await showAlert('파일 업로드에 실패했습니다.')
    isSendingMessage.value = false // 에러 발생 시에도 플래그 해제
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
      await showAlert('원본 프로필 사진이 없습니다.')
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
        await showAlert('프로필 사진을 불러올 수 없습니다.')
      }
    } else {
      await showAlert('프로필 사진을 불러올 수 없습니다.')
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

const handleCloseChatRoom = () => {
  // Electron 환경에서만 채팅방을 완전히 닫을 수 있음
  if (window.electronApi) {
    // close()가 아니라 destroy()를 호출해야 완전히 닫힙
    window.electronApi.windowDestroy()
  }
}

// 프로필 사진 핸들러
const handleOpenProfileSettings = () => {
  showProfileModal.value = true
}

const handleCloseProfileSettings = () => {
  showProfileModal.value = false
}

const handleClearChat = () => messagesMap.clear()
const handleReload = () => window.location.reload()

const handleForceResync = async () => {
  const confirmed = await showConfirm('🔄 동기화 오류가 발생했나요?\n\n로컬 데이터를 삭제하고 다른 피어의 데이터로 재동기화합니다.\n\n계속하시겠습니까?')
  if (!confirmed) return

  try {
    const success = await forceResync()
    if (success) {
      await showAlert('✅ 재동기화가 완료되었습니다.')
      window.location.reload()
    } else {
      await showAlert('❌ 재동기화에 실패했습니다.')
    }
  } catch (error) {
    console.error('[ChatRoom] 재동기화 실패:', error)
    await showAlert('❌ 재동기화 중 오류가 발생했습니다.')
  }
}

const handleResetAll = async () => {
  const confirmed = await showConfirm(`⚠️ 경고: "${activeRoomId}" 방의 모든 데이터를 초기화합니다. 계속하시겠습니까?`)
  if (!confirmed) return

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
    await showAlert('❌ 초기화 중 오류가 발생했습니다.')
  }
}
// Message watching
let previousTotalMessageCount = 0
let notifiedMessageIds = new Set<string>() // 이미 알림을 보낸 메시지 ID 추적

watch(messagesRef, async (newMessages) => {
  await nextTick()

  // 최신 메시지를 보고 있을 때만 자동 스크롤
  if (isViewingLatest()) {
    messageListRef.value?.scrollToBottom()
  }

  await processAutoDownload(messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD))

  const currentTotalCount = messagesMap.size // Y.Map의 실제 크기

  // 내가 메시지를 보내는 중이면 알림을 울리지 않음 (중복 알림 방지)
  if (!isInitialLoad.value && currentTotalCount > previousTotalMessageCount && !isSendingMessage.value) {
    const newMessage = newMessages[newMessages.length - 1]
    if (newMessage && newMessage.authorTrueUuid !== me) {
      // 이미 알림을 보낸 메시지인지 확인
      if (notifiedMessageIds.has(newMessage.id)) {
        console.log('[알림] 이미 알림을 보낸 메시지, 스킵:', newMessage.id)
      } else {
        const authorName = newMessage.authorName || 'Unknown'
        const text = newMessage.text || '파일을 전송했습니다'
        console.log('[알림] 새 메시지:', { authorName, text, totalCount: currentTotalCount })
        showNotification(authorName, text, newMessage.id, activeRoomId)
        // 알림 소리 재생
        playSound()
        // 알림을 보낸 메시지 ID 기록
        notifiedMessageIds.add(newMessage.id)
        // Set이 너무 커지지 않도록 오래된 항목 정리 (최근 100개만 유지)
        if (notifiedMessageIds.size > 100) {
          const idsArray = Array.from(notifiedMessageIds)
          notifiedMessageIds = new Set(idsArray.slice(-50))
        }
      }
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
const handleExportSnapshot = async () => {
  try {
    const snapshotUint8Array = exportSnapshot()
    const snapshotBlob = new Blob([snapshotUint8Array as BlobPart], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(snapshotBlob)
    const a = document.createElement('a')
    a.href = url
    //date as YYYYMMDDHHMMSS
    a.download = `chatroom_${activeRoomId}_${new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '')}_snapshot.chitchat`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('[ChatRoom] 스냅샷 내보내기 실패:', error)
    await showAlert('❌ 스냅샷 내보내기에 실패했습니다.')
  }
}
const handleImportSnapshot = async () => {
  try {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.chitchat'
    input.onchange = async () => {
      if (input.files && input.files.length > 0) {
        const file = input.files[0]
        if (!file) return

        // File을 Uint8Array로 변환
        const arrayBuffer = await file.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        importSnapshot(uint8Array)
        await showAlert('✅ 스냅샷 가져오기가 완료되었습니다. 페이지를 새로고침합니다.')
        window.location.reload()
      }
    }
    document.body.appendChild(input)
    input.click()
    document.body.removeChild(input)
  } catch (error) {
    console.error('[ChatRoom] 스냅샷 가져오기 실패:', error)
    await showAlert('❌ 스냅샷 가져오기에 실패했습니다.')
  }
}
</script>

<template>
  <div
    class="chat-room"
    :style="backgroundStyle"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- 배경 오버레이 (커스텀 배경이 있을 때) -->
    <div v-if="currentBackground" class="background-overlay"></div>

    <!-- 드래그 앤 드롭 오버레이 -->
    <div v-if="isDraggingOver" class="drop-overlay">
      <div class="drop-message">
        <div class="drop-icon">📎</div>
        <div class="drop-text">파일을 여기에 놓으세요</div>
      </div>
    </div>

    <ChatHeader
      :roomId="activeRoomId"
      :userCount="userCount"
      :connectedUsers="connectedUsers"
      :isElectron="isElectron"
      @export="handleExportSnapshot"
      @import="handleImportSnapshot"
      @reload="handleReload"
      @forceResync="handleForceResync"
      @goHome="handleGoHome"
      @clearChat="handleClearChat"
      @resetAll="handleResetAll"
      @closeChatRoom="handleCloseChatRoom"
      @openWatchParty="handleOpenWatchParty"
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
      :myProfilePicture="myProfilePicture"
      :userName="myName"
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
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  position: relative;
  background: var(--gradient-primary);
}

.background-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--bg-primary-rgb, 255, 255, 255), var(--bg-overlay-opacity-chat, 0.75));
  pointer-events: none;
  z-index: 0;
}

.drop-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(156, 124, 181, 0.9) 0%, rgba(212, 165, 201, 0.9) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  pointer-events: none;
  backdrop-filter: blur(var(--bg-blur-chat, 4px));
}

.drop-message {
  text-align: center;
  color: var(--text-on-primary);
}

.drop-icon {
  font-size: 64px;
  margin-bottom: var(--spacing-lg);
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
}

.drop-text {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  backdrop-filter: blur(var(--bg-blur-chat, 4px));
}

.modal-content {
  background: var(--bg-primary);
  border-radius: var(--radius-xl);
  padding: var(--spacing-xl);
  max-width: 400px;
  width: 90%;
  box-shadow: var(--shadow-xl);
  border: 1px solid var(--border-light);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-lg);
}

.modal-header h2 {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.close-button {
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  font-size: var(--font-size-lg);
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.close-button:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
</style>
