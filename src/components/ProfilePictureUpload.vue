<script setup lang="ts">
defineOptions({ name: 'ProfilePictureUpload' })
import { ref } from 'vue'
import { showAlert, showConfirm } from '../composables/useCustomDialog'

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

    <div class="controls">
      <button
        @click="handleClick"
        :disabled="disabled || isProcessing"
        class="upload-button"
      >
        {{ isProcessing ? '처리 중...' : currentImage ? '사진 변경' : '사진 등록' }}
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
      권장: 정사각형 이미지, 최대 {{ Math.round(50) }}KB로 자동 압축됩니다.
    </p>
  </div>
</template>

<style scoped>
.profile-picture-upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px;
}

.preview {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid #ddd;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview.empty {
  border-style: dashed;
  border-color: #ccc;
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
  font-size: 48px;
  opacity: 0.3;
}

.controls {
  display: flex;
  gap: 8px;
}

.upload-button,
.delete-button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: opacity 0.2s;
}

.upload-button {
  background: #0078d4;
  color: white;
}

.upload-button:hover:not(:disabled) {
  opacity: 0.9;
}

.upload-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.delete-button {
  background: #d13438;
  color: white;
}

.delete-button:hover:not(:disabled) {
  opacity: 0.9;
}

.delete-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.help-text {
  font-size: 12px;
  color: #666;
  margin: 0;
  text-align: center;
}
</style>
