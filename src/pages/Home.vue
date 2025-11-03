<script setup lang="ts">
defineOptions({ name: 'HomePage' })
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilePicture } from '@/composables/useProfilePicture'
import { showAlert } from '@/composables/useCustomDialog'
import ProfilePictureUpload from '@/components/ProfilePictureUpload.vue'

const router = useRouter()

const roomId = ref(localStorage.getItem('roomId') || '')
const name = ref(localStorage.getItem('name') || '')

if (!localStorage.getItem('uuid')) {
  localStorage.setItem('uuid', crypto.randomUUID())
}

const uuid = localStorage.getItem('uuid')!
const myUserId = `user-${uuid}`

// 프로필 사진 기능 (네트워크 연결 전이므로 provider는 null)
const {
  myProfilePicture,
  initializeProfilePictures,
  createProfileHandlers
} = useProfilePicture(null, myUserId)

// 공통 핸들러 생성 (캡슐화)
const { handleUpload, handleDelete } = createProfileHandlers()

const goChat = async () => {
  const trimmedRoomId = roomId.value.trim()
  if (trimmedRoomId === '') {
    await showAlert('room id is required')
    return
  }

  const trimmedName = name.value.trim()
  localStorage.setItem('name', trimmedName)
  localStorage.setItem('roomId', trimmedRoomId)

  // Electron 환경에서는 새 창으로 열기
  if (window.electronApi) {
    window.electronApi.openChatRoom(trimmedRoomId, trimmedName || undefined)
  } else {
    // 웹 환경에서는 라우터로 이동
    const q: Record<string, string> = { roomId: trimmedRoomId }
    if (trimmedName) q.name = trimmedName
    router.push({ name: 'ChatRoom', query: q })
  }
}

onMounted(async () => {
  // 로컬 프로필 로드
  await initializeProfilePictures()
})
</script>

<template>
  <div style="height: 100%; display: grid; place-items: center; padding: 24px">
    <div style="width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 16px">
      <h1>ChitChat - decentralized</h1>

      <!-- 프로필 사진 설정 -->
      <div style="display: flex; flex-direction: column; gap: 8px">
        <h3 style="margin: 0; font-size: 16px">프로필 사진</h3>
        <ProfilePictureUpload
          :currentImage="myProfilePicture"
          @upload="handleUpload"
          @delete="handleDelete"
        />
      </div>

      <label style="display: flex; flex-direction: column; gap: 6px">
        <span>Room ID</span>
        <input
          v-model="roomId"
          placeholder="Enter room id"
          style="padding: 8px; border: 1px solid #ccc"
        />
      </label>
      <label style="display: flex; flex-direction: column; gap: 6px">
        <span>이름</span>
        <input
          v-model="name"
          placeholder="너의 이름은"
          style="padding: 8px; border: 1px solid #ccc"
          @keypress.enter="goChat"
        />
      </label>
      <button @click="goChat" style="padding: 10px 12px">들어가기</button>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
</style>
