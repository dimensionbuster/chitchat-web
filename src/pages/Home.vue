<script setup lang="ts">
defineOptions({ name: 'HomePage' })
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilePicture } from '@/composables/useProfilePicture'
import { useBackgroundImage } from '@/composables/useBackgroundImage'
import { useStyleSettings } from '@/composables/useStyleSettings'
import { showAlert } from '@/composables/useCustomDialog'
import ProfilePictureUpload from '@/components/profile/ProfilePictureUpload.vue'

const router = useRouter()

const roomId = ref(localStorage.getItem('roomId') || '')
const name = ref(localStorage.getItem('name') || '')
const appVersion = ref('')
const updateCheckMessage = ref('')
const isCheckingUpdate = ref(false)
const updateAvailable = ref(false)
const releaseUrl = ref<string | null>(null)

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

// 배경 이미지
const { currentBackground, isElectron } = useBackgroundImage('home')

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

// 설정 창 열기
const openSettings = () => {
  window.electronApi?.openSettings()
}

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

const checkForUpdates = async () => {
  if (!window.electronApi) return

  isCheckingUpdate.value = true
  updateCheckMessage.value = ''
  updateAvailable.value = false
  releaseUrl.value = null

  try {
    const result = await window.electronApi.checkForUpdates()
    updateCheckMessage.value = result.message
    updateAvailable.value = result.available
    releaseUrl.value = result.releaseUrl || null

    // 업데이트가 없으면 3초 후 메시지 제거
    if (!result.available) {
      setTimeout(() => {
        updateCheckMessage.value = ''
      }, 3000)
    }
  } catch (error) {
    console.error('Failed to check for updates:', error)
    updateCheckMessage.value = '업데이트 확인 실패'
  } finally {
    isCheckingUpdate.value = false
  }
}

const openReleaseUrl = () => {
  if (releaseUrl.value && window.electronApi) {
    window.electronApi.openExternal(releaseUrl.value)
  }
}

onMounted(async () => {
  // 로컬 프로필 로드
  await initializeProfilePictures()

  // 앱 버전 가져오기
  if (window.electronApi) {
    try {
      appVersion.value = await window.electronApi.getAppVersion()
    } catch (error) {
      console.error('Failed to get app version:', error)
    }
  }
})
</script>

<template>
  <div class="home-page" :style="backgroundStyle">
    <!-- 오버레이 (커스텀 배경이 있을 때만) -->
    <div v-if="currentBackground" class="background-overlay"></div>

    <div class="home-container">
      <div class="home-card">
        <!-- 로고/타이틀 영역 -->
        <div class="header-section">
          <div class="logo-icon">💬</div>
          <h1 class="app-title">ChitChat</h1>
          <p class="app-subtitle">분산형 P2P 채팅</p>
        </div>

        <!-- 프로필 사진 설정 -->
        <div class="profile-section">
          <h3 class="section-title">프로필 사진</h3>
          <ProfilePictureUpload
            :currentImage="myProfilePicture"
            @upload="handleUpload"
            @delete="handleDelete"
          />
        </div>

        <!-- 입력 폼 -->
        <div class="form-section">
          <label class="input-group">
            <span class="input-label">Room ID</span>
            <input
              v-model="roomId"
              placeholder="채팅방 ID를 입력하세요"
              class="text-input"
            />
          </label>

          <label class="input-group">
            <span class="input-label">이름</span>
            <input
              v-model="name"
              placeholder="닉네임을 입력하세요"
              class="text-input"
              @keypress.enter="goChat"
            />
          </label>

          <button @click="goChat" class="enter-button">
            <span>채팅방 입장</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>

        <!-- 설정 및 업데이트 (Electron 전용) -->
        <div v-if="isElectron" class="settings-section-home">
          <button @click="openSettings" class="settings-button">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>설정</span>
          </button>

          <button
            @click="checkForUpdates"
            class="update-button"
            :disabled="isCheckingUpdate"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ 'spin': isCheckingUpdate }">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            <span>{{ isCheckingUpdate ? '확인 중...' : '업데이트 확인' }}</span>
          </button>

          <div v-if="updateCheckMessage" class="update-message" :class="{ 'has-update': updateAvailable }">
            {{ updateCheckMessage }}
            <button
              v-if="updateAvailable && releaseUrl"
              @click="openReleaseUrl"
              class="download-button"
            >
              다운로드 페이지 열기
            </button>
          </div>

          <div v-if="appVersion" class="version-info">
            v{{ appVersion }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-md);
  background: var(--gradient-primary);
  position: relative;
}

.background-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--bg-primary-rgb, 255, 255, 255), var(--bg-overlay-opacity-home, 0.75));
  pointer-events: none;
}

.home-container {
  width: 100%;
  max-width: 380px;
  position: relative;
  z-index: 1;
}

.home-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  padding: var(--spacing-lg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(var(--bg-blur-home, 20px));
}

/* 헤더 섹션 */
.header-section {
  text-align: center;
  margin-bottom: var(--spacing-md);
}

.logo-icon {
  font-size: 36px;
  margin-bottom: var(--spacing-xs);
  filter: drop-shadow(0 4px 8px rgba(156, 124, 181, 0.3));
}

.app-title {
  margin: 0;
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: var(--letter-spacing-tight);
}

.app-subtitle {
  margin: 2px 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-accent);
  font-weight: var(--font-weight-medium);
}

/* 프로필 섹션 */
.profile-section {
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-sm);
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-accent);
}

.section-title {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-secondary);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}

/* 폼 섹션 */
.form-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.input-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.text-input {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  transition: all var(--transition-fast);
}

.text-input::placeholder {
  color: var(--text-muted);
}

.text-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.15);
  background: var(--bg-primary);
}

.enter-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-lg);
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: all var(--transition-fast);
  margin-top: var(--spacing-xs);
  box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
}

.enter-button:hover {
  background: linear-gradient(135deg, var(--color-secondary) 0%, var(--color-accent) 100%);
  box-shadow: 0 6px 20px rgba(var(--color-primary-rgb), 0.4);
  transform: translateY(-2px);
}

.enter-button:active {
  transform: translateY(0);
}

/* 스타일 설정 섹션 */
.settings-section-home {
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--border-light);
}

.settings-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-secondary);
  color: var(--color-accent);
  border: 1px dashed var(--color-primary-light);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.settings-button:hover {
  background: var(--color-primary-light);
  color: var(--color-primary);
  border-color: var(--color-secondary);
  border-style: solid;
}

.settings-button svg {
  opacity: 0.7;
}

.settings-button:hover svg {
  opacity: 1;
}

/* 업데이트 버튼 */
.update-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-secondary);
  color: var(--color-accent);
  border: 1px dashed var(--color-primary-light);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
  margin-top: var(--spacing-sm);
}

.update-button:hover:not(:disabled) {
  background: var(--color-primary-light);
  color: var(--color-primary);
  border-color: var(--color-secondary);
  border-style: solid;
}

.update-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.update-button svg {
  opacity: 0.7;
  transition: all var(--transition-fast);
}

.update-button:hover:not(:disabled) svg {
  opacity: 1;
}

.update-button svg.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 업데이트 메시지 */
.update-message {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-sm);
  background: var(--color-primary-light);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  text-align: center;
  animation: fadeIn 0.3s ease-in;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.update-message.has-update {
  background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
  color: white;
  font-weight: var(--font-weight-semibold);
}

.download-button {
  padding: var(--spacing-xs) var(--spacing-md);
  background: white;
  color: #4CAF50;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: all var(--transition-fast);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.download-button:hover {
  background: #f5f5f5;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.download-button:active {
  transform: translateY(0);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 버전 정보 */
.version-info {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  text-align: center;
  font-family: monospace;
}
</style>
