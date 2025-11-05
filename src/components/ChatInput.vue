<script setup lang="ts">
defineOptions({ name: 'ChatInput' })
import { ref, onMounted, onUnmounted } from 'vue'
import ProfileAvatar from './ProfileAvatar.vue';

defineProps<{
  disabled: boolean
  isUploading: boolean
  myProfilePicture: string | null
  userName: string
}>()

const emit = defineEmits<{
  send: [message: string]
  uploadFile: [file: File]
  openProfileSettings: []
  exportSnapshot: []
  import: []
}>()

const input = ref('')
const showSnapshotMenu = ref(false)
const snapshotMenuRef = ref<HTMLDivElement | null>(null)

const onSend = () => {
  if (!input.value.trim()) return
  emit('send', input.value)
  input.value = ''
}

const onFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  emit('uploadFile', file)
  // input 초기화
  ;(e.target as HTMLInputElement).value = ''
}

const toggleSnapshotMenu = () => {
  showSnapshotMenu.value = !showSnapshotMenu.value
}

const handleExportSnapshot = () => {
  emit('exportSnapshot')
  showSnapshotMenu.value = false
}

const handleImportSnapshot = () => {
  emit('import')
  showSnapshotMenu.value = false
}

// 외부 클릭 감지
const handleClickOutside = (event: MouseEvent) => {
  if (snapshotMenuRef.value && !snapshotMenuRef.value.contains(event.target as Node)) {
    showSnapshotMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="chat-input">
    <!-- 프로필 설정 버튼 -->
     <!-- 프로필 사진 미리보기로 원형모양 -->
    <!-- <button
      @click="emit('openProfileSettings')"
      :disabled="disabled"
      class="profile-button"
      title="프로필 설정"
    >
      👤
    </button> -->
      <button
        @click="emit('openProfileSettings')"
        :disabled="disabled"
        class="profile-button"
        title="프로필 설정"
      >
       <ProfileAvatar
        :imageUrl="myProfilePicture || null"
        :size="48"
        :clickable="false"
        :userName="userName"
        />
      </button>
    <input
      v-model="input"
      placeholder="메시지…"
      class="text-input"
      @keydown.enter="onSend"
      :disabled="disabled"
    />
    <button @click="onSend" :disabled="disabled" class="send-button">Send</button>
    <label class="file-upload-label" :class="{ disabled: disabled || isUploading }">
      {{ isUploading ? '업로드 중...' : '📎 파일' }}
      <input
        type="file"
        @change="onFileChange"
        :disabled="disabled || isUploading"
        style="display: none"
        accept="image/*"
      />
    </label>

    <!-- 스냅샷 메뉴 -->
    <div ref="snapshotMenuRef" class="snapshot-menu-container">
      <button
        @click="toggleSnapshotMenu"
        :disabled="disabled"
        class="snapshot-button"
        title="스냅샷"
      >
        💾
      </button>

      <div v-if="showSnapshotMenu" class="snapshot-dropdown">
        <button
          @click="handleExportSnapshot"
          :disabled="disabled"
          class="snapshot-menu-item"
        >
          📤 내보내기
        </button>
        <button
          @click="handleImportSnapshot"
          :disabled="disabled"
          class="snapshot-menu-item"
        >
          📥 가져오기
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.text-input {
  flex: 1;
  padding: 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.send-button {
  padding: 6px 12px;
  cursor: pointer;
  background: #0078d4;
  color: white;
  border: none;
  border-radius: 4px;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.profile-button {
  aspect-ratio: 1 / 1;
  margin: 0;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  font-size: 18px;
  transition: opacity 0.2s;
}

.profile-button:hover:not(:disabled) {
  opacity: 0.9;
}

.profile-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-upload-label {
  padding: 6px 12px;
  background: #0078d4;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: opacity 0.2s;
}

.file-upload-label:hover:not(.disabled) {
  opacity: 0.9;
}

.file-upload-label.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.snapshot-menu-container {
  position: relative;
}

.snapshot-button {
  height: 100%;
  padding: 6px 12px;
  cursor: pointer;
  background: #6c6c6c;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 18px;
  transition: opacity 0.2s;
}

.snapshot-button:hover:not(:disabled) {
  opacity: 0.9;
}

.snapshot-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.snapshot-dropdown {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 8px;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  z-index: 1000;
  min-width: 150px;
}

.snapshot-menu-item {
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  background: white;
  border: none;
  cursor: pointer;
  transition: background 0.2s;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.snapshot-menu-item:hover:not(:disabled) {
  background: #f0f0f0;
}

.snapshot-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.snapshot-menu-item + .snapshot-menu-item {
  border-top: 1px solid #eee;
}
</style>
