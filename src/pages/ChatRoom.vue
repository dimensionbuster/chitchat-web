<script setup lang="ts">
defineOptions({ name: 'ChatRoomPage' })
import { ref, onMounted, nextTick, watch } from 'vue'
import { useYjs } from '../composables/useYjs'
import { useIpfs } from '../composables/useIpfs'
import router from '@/router'
import ChatHeader from '@/components/ChatHeader.vue'
import MessageList from '@/components/MessageList.vue'
import ChatInput from '@/components/ChatInput.vue'

// ========== 설정 상수 ==========
// 최근 N개 메시지의 이미지만 자동 로드
const RECENT_MESSAGES_TO_LOAD = 30

// 자동 다운로드 크기 제한 (25MB)
const MAX_AUTO_DOWNLOAD_SIZE = 25 * 1024 * 1024
// ==============================

const props = defineProps<{
  roomId?: string
  name?: string
}>()

const { addFile, getFile } = useIpfs()

// identity
if (!localStorage.getItem('uuid')) {
  localStorage.setItem('uuid', crypto.randomUUID())
}
const me = 'user-' + localStorage.getItem('uuid')
const myName = ref('User ' + me.slice(-4))

// initial name from props if provided
if (props.name && props.name.trim()) {
  myName.value = props.name.trim() + me.slice(-4)
}

const isUploading = ref(false)

// Yjs state
const yjsReady = ref(false)
const activeRoomId = props.roomId && props.roomId.trim() ? props.roomId.trim() : 'default-room'

const { messagesRef, messages, files, sendTextMessage, attachFileMeta, provider } =
  useYjs(activeRoomId)

// 이미지 URL 캐시 (CID → Blob URL)
const imageUrls = ref(new Map<string, string>())
const loadingImages = ref(new Set<string>())

// MessageList ref
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

// 메시지 전송
const handleSend = (message: string) => {
  if (!yjsReady.value) return
  sendTextMessage(me, myName.value, message)
}

// 파일 업로드
const handleUploadFile = async (file: File) => {
  if (!yjsReady.value || isUploading.value) return

  try {
    isUploading.value = true
    console.log('파일 업로드 시작:', file.name, file.type)
    const meta = await addFile(file)
    attachFileMeta(meta.cid, meta, me, myName.value)
    console.log('파일 업로드 완료:', meta.cid)
  } catch (error) {
    console.error('파일 업로드 실패:', error)
    alert('파일 업로드에 실패했습니다.')
  } finally {
    isUploading.value = false
  }
}

// 이미지 타입 체크
const isImage = (cid: string) => {
  const meta = files.get(cid)
  return meta?.type?.startsWith('image/')
}

// 이미지 크기가 자동 다운로드 임계값 이하인지 체크
const shouldAutoDownload = (cid: string) => {
  const meta = files.get(cid)

  // 크기 정보 없으면 일단 자동 다운로드 시도 (대부분 작은 이미지일 확률 높음)
  if (!meta?.size) {
    console.log(`[AutoDownload] 크기 정보 없음, 자동 다운로드 시도: ${cid}`)
    return true
  }

  const shouldDownload = meta.size <= MAX_AUTO_DOWNLOAD_SIZE
  console.log(
    `[AutoDownload] ${cid}: ${(meta.size / 1024 / 1024).toFixed(2)}MB, 자동 다운로드: ${shouldDownload}`,
  )
  return shouldDownload
}

// 다운로드 시도한 CID 추적
const attemptedDownloads = ref(new Set<string>())

// 다운로드 실패한 CID 추적
const failedDownloads = ref(new Map<string, string>()) // CID -> 에러 메시지

// 이미지 다운로드 (자동 or 수동)
const downloadImage = async (cid: string, forceDownload = false) => {
  // 이미 다운로드했거나, 다운로드 중이면 스킵
  if (imageUrls.value.has(cid) || loadingImages.value.has(cid)) {
    return
  }

  // 자동 다운로드가 아니고, 이미 시도했으면 스킵
  if (!forceDownload && attemptedDownloads.value.has(cid)) {
    return
  }

  // 강제 다운로드면 실패 기록 초기화
  if (forceDownload) {
    failedDownloads.value.delete(cid)
  }

  attemptedDownloads.value.add(cid)
  loadingImages.value.add(cid)

  try {
    const meta = files.get(cid)
    const sizeInfo = meta?.size ? `(${(meta.size / 1024 / 1024).toFixed(2)}MB)` : ''
    console.log(`이미지 다운로드 시작: ${cid} ${sizeInfo}`)

    const blob = await getFile(cid)
    const url = URL.createObjectURL(blob)
    imageUrls.value.set(cid, url)

    // 성공하면 실패 기록 제거
    failedDownloads.value.delete(cid)
    console.log('이미지 다운로드 완료:', cid)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류'
    console.error('이미지 다운로드 실패:', cid, errorMsg)

    // 실패 기록 저장
    failedDownloads.value.set(cid, errorMsg)

    // 실패한 경우 attemptedDownloads에서 제거 (수동 재시도 가능하도록)
    if (forceDownload) {
      attemptedDownloads.value.delete(cid)
    }
  } finally {
    loadingImages.value.delete(cid)
  }
}

// 메시지 변경 감지 - 스크롤 & 작은 이미지만 자동 다운로드
watch(
  messagesRef,
  async () => {
    await nextTick()
    console.log('=== 메시지 변경 감지 ===')
    messageListRef.value?.scrollToBottom()

    // 최근 N개 메시지만 가져오기
    const recentMessages = messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD)
    console.log(
      `최근 ${RECENT_MESSAGES_TO_LOAD}개 메시지 중 이미지 검색 (총 ${messagesRef.value.length}개)`,
    )

    // 자동 다운로드 대상 이미지 찾기
    for (const msg of recentMessages) {
      if (msg.cid && isImage(msg.cid)) {
        // 이미 다운로드했거나 시도 중이면 스킵
        if (imageUrls.value.has(msg.cid) || loadingImages.value.has(msg.cid)) {
          continue
        }

        if (shouldAutoDownload(msg.cid)) {
          console.log(`[Watch] 새 이미지 자동 다운로드: ${msg.cid}`)
          downloadImage(msg.cid, false)
        } else {
          console.log(`[Watch] 큰 이미지 발견 (수동 다운로드 필요): ${msg.cid}`)
        }
      }
    }
  },
  { immediate: false }, // 초기 마운트 시에는 실행 안 함 (onMounted에서 처리)
)

onMounted(async () => {
  if (provider.connected) {
    yjsReady.value = true
  }
  provider.on('status', (e) => {
    yjsReady.value = e.connected
    console.log('Yjs status', e)
  })

  // 초기 로딩 시 이미지 자동 다운로드
  await nextTick()

  // 약간의 딜레이를 주어 Yjs 동기화 완료 대기
  setTimeout(async () => {
    console.log('=== 초기 이미지 다운로드 시작 ===')
    console.log(`총 메시지: ${messagesRef.value.length}개`)

    // 최근 N개 메시지만 가져오기
    const recentMessages = messagesRef.value.slice(-RECENT_MESSAGES_TO_LOAD)
    console.log(`최근 ${RECENT_MESSAGES_TO_LOAD}개 메시지만 이미지 로드 예정`)

    for (const msg of recentMessages) {
      if (msg.cid) {
        console.log(`메시지 CID: ${msg.cid}`)
        const meta = files.get(msg.cid)
        console.log(`파일 메타:`, meta)

        if (isImage(msg.cid)) {
          console.log(`→ 이미지 타입 확인됨`)
          if (shouldAutoDownload(msg.cid)) {
            console.log(`→ 자동 다운로드 시작`)
            downloadImage(msg.cid, false)
          } else {
            console.log(`→ 크기 초과, 수동 다운로드만 가능`)
          }
        } else {
          console.log(`→ 이미지 아님`)
        }
      }
    }
  }, 500) // 500ms 대기
})

// 이미지 수동 다운로드 요청 (큰 이미지용)
const handleRequestDownload = async (cid: string) => {
  if (!cid) return
  // 강제 다운로드
  await downloadImage(cid, true)
}

// 파일 다운로드 (저장)
const handleDownload = async (cid: string) => {
  if (!cid) return
  const blob = await getFile(cid)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = files.get(cid)?.name ?? cid
  a.click()
  URL.revokeObjectURL(url)
}

// 강제 동기화
const handleForceSync = () => {
  provider.disconnect()
  setTimeout(() => provider.connect(), 1000)
}

// 홈으로 이동
const handleGoHome = () => {
  router.push({ name: 'Home' })
}
const handleClearChat = () => {
  messages.delete(0, messages.length)
}
</script>

<template>
  <div class="chat-room">
    <ChatHeader
      :roomId="activeRoomId"
      @forceSync="handleForceSync"
      @goHome="handleGoHome"
      @clearChat="handleClearChat"
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
