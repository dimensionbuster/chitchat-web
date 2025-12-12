<script setup lang="ts">
defineOptions({ name: 'HomePage' })
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilePicture } from '@/composables/useProfilePicture'
import { useBackgroundImage } from '@/composables/useBackgroundImage'
import { useStyleSettings } from '@/composables/useStyleSettings'
import { showConfirm } from '@/composables/useCustomDialog'
import ProfilePictureUpload from '@/components/profile/ProfilePictureUpload.vue'
import RoomModal from '@/components/home/RoomModal.vue'

const router = useRouter()

// 저장된 방 목록 타입
interface SavedRoom {
  roomId: string
  nickname: string
  lastVisited: number
}

const ROOMS_STORAGE_KEY = 'chitchat_saved_rooms'

// 상태
const savedRooms = ref<SavedRoom[]>([])
const showAddModal = ref(false)
const editingRoom = ref<SavedRoom | null>(null)

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

// 방 목록 로드
const loadSavedRooms = () => {
  try {
    const stored = localStorage.getItem(ROOMS_STORAGE_KEY)
    if (stored) {
      savedRooms.value = JSON.parse(stored)
      savedRooms.value.sort((a, b) => b.lastVisited - a.lastVisited)
    }
  } catch (e) {
    console.error('방 목록 로드 실패:', e)
  }
}

// 방 목록 저장
const saveRoomsList = () => {
  try {
    localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(savedRooms.value))
  } catch (e) {
    console.error('방 목록 저장 실패:', e)
  }
}

// 기본 닉네임 (localStorage 접근용 computed)
const defaultNickname = computed(() => {
  try {
    return localStorage.getItem('name') || ''
  } catch {
    return ''
  }
})

// 방 추가/수정 모달 열기
const openAddModal = (room?: SavedRoom) => {
  editingRoom.value = room || null
  showAddModal.value = true
}

// 방 저장 (모달에서 호출)
const handleSaveRoom = (roomId: string, nickname: string) => {
  localStorage.setItem('name', nickname)

  if (editingRoom.value) {
    const index = savedRooms.value.findIndex(r =>
      r.roomId === editingRoom.value!.roomId &&
      r.nickname === editingRoom.value!.nickname
    )
    if (index !== -1) {
      savedRooms.value[index] = { roomId, nickname, lastVisited: editingRoom.value.lastVisited }
    }
  } else {
    const exists = savedRooms.value.find(r => r.roomId === roomId && r.nickname === nickname)
    if (!exists) {
      savedRooms.value.unshift({ roomId, nickname, lastVisited: Date.now() })
    }
  }

  saveRoomsList()
  showAddModal.value = false
}

// 방 삭제
const deleteRoom = async (room: SavedRoom) => {
  const confirmed = await showConfirm(`"${room.roomId}" 방을 삭제하시겠습니까?`)
  if (confirmed) {
    savedRooms.value = savedRooms.value.filter(r =>
      !(r.roomId === room.roomId && r.nickname === room.nickname)
    )
    saveRoomsList()
  }
}

// 방 입장
const joinRoom = (room: SavedRoom) => {
  localStorage.setItem('name', room.nickname)
  localStorage.setItem('roomId', room.roomId)

  room.lastVisited = Date.now()
  saveRoomsList()

  if (window.electronApi) {
    window.electronApi.openChatRoom(room.roomId, room.nickname || undefined)
  } else {
    router.push({ name: 'ChatRoom', query: { roomId: room.roomId, name: room.nickname } })
  }
}

// 빠른 입장 (모달에서 호출)
const handleQuickJoin = (roomId: string, nickname: string) => {
  localStorage.setItem('name', nickname)
  localStorage.setItem('roomId', roomId)

  const exists = savedRooms.value.find(r => r.roomId === roomId && r.nickname === nickname)
  if (!exists) {
    savedRooms.value.unshift({ roomId, nickname, lastVisited: Date.now() })
  } else {
    exists.lastVisited = Date.now()
  }
  saveRoomsList()

  showAddModal.value = false

  if (window.electronApi) {
    window.electronApi.openChatRoom(roomId, nickname || undefined)
  } else {
    router.push({ name: 'ChatRoom', query: { roomId, name: nickname } })
  }
}

// 설정 창 열기
const openSettings = () => {
  window.electronApi?.openSettings()
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
  await initializeProfilePictures()
  loadSavedRooms()

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

        <!-- 방 목록 섹션 -->
        <div class="rooms-section">
          <div class="rooms-header">
            <h3 class="section-title">저장된 채팅방</h3>
            <button class="add-room-btn" @click="openAddModal()">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              새 방
            </button>
          </div>

          <!-- 저장된 방 목록 -->
          <div v-if="savedRooms.length > 0" class="room-list">
            <div
              v-for="room in savedRooms"
              :key="`${room.roomId}-${room.nickname}`"
              class="room-item"
              @click="joinRoom(room)"
            >
              <div class="room-info">
                <div class="room-id">{{ room.roomId }}</div>
                <span class="room-nickname">{{ room.nickname }}</span>
              </div>
              <div class="room-actions">
                <button class="room-action-btn edit-btn" @click.stop="openAddModal(room)" title="수정">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
                <button class="room-action-btn delete-btn" @click.stop="deleteRoom(room)" title="삭제">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- 빈 상태 -->
          <div v-else class="empty-state">
            <p>저장된 채팅방이 없습니다</p>
            <button class="add-first-room-btn" @click="openAddModal()">첫 채팅방 추가하기</button>
          </div>
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

    <!-- 방 추가/수정 모달 -->
    <RoomModal
      :show="showAddModal"
      :editingRoom="editingRoom"
      :defaultNickname="defaultNickname"
      @close="showAddModal = false"
      @save="handleSaveRoom"
      @quickJoin="handleQuickJoin"
    />
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
  max-width: 420px;
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

/* 방 목록 섹션 */
.rooms-section {
  margin-bottom: var(--spacing-md);
}

.rooms-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-sm);
}

.add-room-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.add-room-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  max-height: 250px;
  overflow-y: auto;
}

.room-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.room-item:hover {
  background: var(--color-primary-light);
  border-color: var(--color-accent);
}

.room-info {
  flex: 1;
  min-width: 0;
}

.room-id {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.room-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: 2px;
}

.room-nickname {
  font-size: var(--font-size-xs);
  color: var(--color-accent);
}

.room-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.room-item:hover .room-actions {
  opacity: 1;
}

.room-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.edit-btn {
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.edit-btn:hover {
  background: var(--color-primary);
  color: white;
}

.delete-btn {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.delete-btn:hover {
  background: #ef4444;
  color: white;
}

/* 빈 상태 */
.empty-state {
  text-align: center;
  padding: var(--spacing-lg);
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 2px dashed var(--border-default);
}

.empty-state p {
  margin: 0 0 var(--spacing-sm);
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}

.add-first-room-btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.add-first-room-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(var(--color-primary-rgb), 0.4);
}
</style>
