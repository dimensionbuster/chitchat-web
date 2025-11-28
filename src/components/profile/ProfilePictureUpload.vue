<script setup lang="ts">
defineOptions({ name: 'ProfilePictureUpload' })
import { ref } from 'vue'
import { showAlert, showConfirm } from '@/composables/useCustomDialog'

const props = defineProps<{
  currentImage: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  upload: [file: File]
  delete: []
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const isProcessing = ref(false)

const handleClick = () => {
  if (props.disabled || isProcessing.value) return
  fileInputRef.value?.click()
}

const handleFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  // 이미지 파일만 허용
  if (!file.type.startsWith('image/')) {
    await showAlert('이미지 파일만 업로드할 수 있습니다.')
    return
  }

  isProcessing.value = true
  try {
    emit('upload', file)
  } finally {
    isProcessing.value = false
    // input 초기화
    ;(e.target as HTMLInputElement).value = ''
  }
}

const handleDelete = async () => {
  if (props.disabled || isProcessing.value) return
  const confirmed = await showConfirm('프로필 사진을 삭제하시겠습니까?')
  if (confirmed) {
    emit('delete')
  }
}
</script>

<template>
  <div class="profile-picture-upload">
    <div class="preview" :class="{ empty: !currentImage }">
      <img v-if="currentImage" :src="currentImage" alt="Profile" class="profile-image" />
      <div v-else class="placeholder">
        <span class="icon">👤</span>
      </div>
    </div>

    <div class="right-section">
      <div class="controls">
        <button
          @click="handleClick"
          :disabled="disabled || isProcessing"
          class="upload-button"
        >
          {{ isProcessing ? '처리중' : currentImage ? '변경' : '등록' }}
        </button>

        <button
          v-if="currentImage"
          @click="handleDelete"
          :disabled="disabled || isProcessing"
          class="delete-button"
        >
          삭제
        </button>

        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          @change="handleFileChange"
          :disabled="disabled || isProcessing"
          style="display: none"
        />
      </div>

      <p class="help-text">
        정사각형 이미지 권장, 최대 50KB로 압축
      </p>
    </div>
  </div>
</template>

<style scoped>
.profile-picture-upload {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xs);
}

.preview {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  overflow: hidden;
  border: 2px solid var(--border-default);
  background: var(--bg-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
}

.preview.empty {
  border-style: dashed;
  border-color: var(--border-light);
}

.profile-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.placeholder .icon {
  font-size: 28px;
  opacity: 0.3;
}

.right-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  flex: 1;
  min-width: 0;
}

.controls {
  display: flex;
  gap: var(--spacing-xs);
}

.upload-button,
.delete-button {
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  transition: all var(--transition-fast);
}

.upload-button {
  background: var(--gradient-primary);
  color: var(--text-on-gradient);
  border-color: var(--border-default);
}

.upload-button:hover:not(:disabled) {
  box-shadow: var(--shadow-sm);
}

.upload-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.delete-button {
  background: var(--btn-danger-bg);
  color: var(--btn-danger-text);
  border-color: var(--btn-danger-border);
}

.delete-button:hover:not(:disabled) {
  box-shadow: var(--shadow-sm);
}

.delete-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.help-text {
  font-size: 10px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.3;
}
</style>
