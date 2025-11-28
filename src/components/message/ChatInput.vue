<script setup lang="ts">
defineOptions({ name: 'ChatInput' })
import { ref } from 'vue'
import ProfileAvatar from '@/components/profile/ProfileAvatar.vue';

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
}>()

const input = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const onSend = () => {
  if (!input.value.trim()) return
  emit('send', input.value)
  input.value = ''
}

const onPaste = async (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    // 이미지 타입 체크
    if (item.type.indexOf('image') !== -1) {
      e.preventDefault() // 기본 붙여넣기 동작 방지

      const file = item.getAsFile()
      if (file) {
        emit('uploadFile', file)
        return
      }
    }
  }
}

const onFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  emit('uploadFile', file)
  // input 초기화
  ;(e.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div class="chat-input">
    <!-- 프로필 버튼 -->
    <button
      @click="emit('openProfileSettings')"
      :disabled="disabled"
      class="profile-button"
      title="프로필 설정"
    >
      <ProfileAvatar
        :imageUrl="myProfilePicture || null"
        :size="44"
        :clickable="false"
        :userName="userName"
      />
    </button>

    <!-- 입력 필드 -->
    <input
      ref="inputRef"
      v-model="input"
      placeholder="메시지를 입력하세요..."
      class="text-input"
      @keydown.enter="onSend"
      @paste="onPaste"
      :disabled="disabled"
    />

    <!-- 전송 버튼 -->
    <button @click="onSend" :disabled="disabled" class="send-button">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    </button>

    <!-- 파일 업로드 버튼 -->
    <label class="file-upload-label" :class="{ disabled: disabled || isUploading }">
      <span class="file-icon">📎</span>
      <span class="file-text">{{ isUploading ? '업로드 중...' : '파일' }}</span>
      <input
        type="file"
        @change="onFileChange"
        :disabled="disabled || isUploading"
        style="display: none"
        accept="image/*"
      />
    </label>
  </div>
</template>

<style scoped>
.chat-input {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
  padding: var(--spacing-sm);
  background: rgba(255, 255, 255, var(--container-opacity-chat, 0.85));
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(10px);
}

.text-input {
  flex: 1;
  padding: var(--spacing-md) var(--spacing-lg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  transition: all var(--transition-fast);
}

.text-input::placeholder {
  color: var(--text-muted);
}

.text-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-accent-light);
}

.text-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-button {
  width: 44px;
  height: 44px;
  padding: 0;
  cursor: pointer;
  background: var(--gradient-primary);
  color: var(--text-on-gradient);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.send-button:hover:not(:disabled) {
  box-shadow: var(--shadow-md);
  transform: scale(1.05);
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.profile-button {
  padding: 0;
  margin: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  transition: all var(--transition-fast);
}

.profile-button:hover:not(:disabled) {
  transform: scale(1.05);
}

.profile-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-upload-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  transition: all var(--transition-fast);
}

.file-upload-label:hover:not(.disabled) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.file-upload-label.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-icon {
  font-size: var(--font-size-base);
}

.file-text {
  display: none;
}

@media (min-width: 480px) {
  .file-text {
    display: inline;
  }
}
</style>
