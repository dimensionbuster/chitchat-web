<script setup lang="ts">
defineOptions({ name: 'ImageMessage' })
import { computed, ref } from 'vue'
import type { FileMeta } from '@/types/types'
import FileTransferProgress from '@/components/file/FileTransferProgress.vue'
import ImageModal from '@/components/image/ImageModal.vue'
import { useFileTransferProgress } from '@/composables/useFileTransferProgress'
import { FILE_DATA_THRESHOLD } from '@/composables/fileConstants'

const props = defineProps<{
  fileId: string
  imageUrl: string | undefined
  isLoading: boolean
  fileMeta: FileMeta | undefined
  errorMessage?: string
}>()

const emit = defineEmits<{
  download: [fileId: string]
  requestDownload: [fileId: string]
}>()

// 5MB 임계값

// 모달 상태
const showModal = ref(false)

// 파일 크기가 큰지 체크
const isLargeImage = computed(() => {
  if (!props.fileMeta?.size) return false
  return props.fileMeta.size > FILE_DATA_THRESHOLD
})

// 파일 크기를 읽기 쉬운 형식으로 변환
const formatFileSize = (bytes: number | undefined) => {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(2)}MB`
  const kb = bytes / 1024
  return `${kb.toFixed(2)}KB`
}

const handleImageClick = () => {
  showModal.value = true
}

const handleDownload = () => {
  emit('download', props.fileId)
}

const handleLoadImage = () => {
  emit('requestDownload', props.fileId)
}

const closeModal = () => {
  showModal.value = false
}

// 전송 중인지 확인
const { isTransferring } = useFileTransferProgress()
const showProgress = computed(() => isTransferring(props.fileId))
</script>

<template>
  <div class="image-message">
    <!-- 전송 진척도 -->
    <FileTransferProgress v-if="showProgress" :fileId="fileId" :fileName="fileMeta?.name" />

    <!-- 로딩 중 -->
    <div v-if="isLoading && !showProgress" class="loading-text">이미지 로딩 중...</div>

    <!-- 이미지 표시 (이미 다운로드됨) -->
    <div v-else-if="imageUrl" class="image-container">
      <img
        :src="imageUrl"
        :alt="fileMeta?.name || 'image'"
        class="image-preview"
        @click="handleImageClick"
        :title="'클릭하여 크게 보기: ' + (fileMeta?.name || fileId)"
      />
    </div>

    <!-- 큰 이미지 (25MB 이상) - 수동 다운로드 버튼 -->
    <div v-else-if="isLargeImage" class="large-image-placeholder">
      <div class="large-image-info">
        <span class="image-icon">🖼️</span>
        <div class="info-text">
          <div class="filename-large">{{ fileMeta?.name || 'image.jpg' }}</div>
          <div class="file-size">{{ formatFileSize(fileMeta?.size) }}</div>
        </div>
      </div>
      <button class="load-button" @click="handleLoadImage">이미지 불러오기</button>
      <div class="large-image-hint">클릭하여 이미지를 불러옵니다 (대용량 파일)</div>
    </div>

    <!-- 다운로드 실패 -->
    <div v-else class="error-container">
      <div class="error-text">⚠️ 이미지를 불러올 수 없습니다</div>
      <div v-if="errorMessage" class="error-details">{{ errorMessage }}</div>
      <button class="retry-button" @click="handleLoadImage">🔄 다시 시도</button>
    </div>

    <!-- 파일명 표시 (작은 이미지용) -->
    <div v-if="imageUrl && !isLargeImage" class="filename">
      {{ fileMeta?.name || 'image.jpg' }}
    </div>

    <!-- 이미지 모달 -->
    <ImageModal
      v-if="showModal && imageUrl"
      :imageUrl="imageUrl"
      :fileName="fileMeta?.name || 'image.jpg'"
      @close="closeModal"
      @download="handleDownload"
    />
  </div>
</template>

<style scoped>
.image-message {
  margin-top: var(--spacing-sm);
}

.loading-text {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}

.error-container {
  margin-top: var(--spacing-xs);
  padding: var(--spacing-md);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-md);
  max-width: 400px;
}

.error-text {
  color: var(--color-warning-text);
  font-weight: var(--font-weight-medium);
}

.error-details {
  font-size: var(--font-size-xs);
  color: var(--color-warning-text);
  margin-top: var(--spacing-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

.retry-button {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--color-warning);
  color: var(--color-warning-text);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
}

.retry-button:hover {
  filter: brightness(0.9);
}

.image-container {
  margin-top: var(--spacing-xs);
}

.image-preview {
  max-width: 400px;
  max-height: 300px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: block;
  transition: all var(--transition-fast);
  border: 2px solid var(--border-light);
}

.image-preview:hover {
  transform: scale(1.02);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-primary-light);
}

.filename {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  margin-top: var(--spacing-xs);
}

/* 큰 이미지 플레이스홀더 */
.large-image-placeholder {
  margin-top: var(--spacing-xs);
  padding: var(--spacing-lg);
  border: 2px dashed var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  max-width: 400px;
  text-align: center;
}

.large-image-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.image-icon {
  font-size: 32px;
}

.info-text {
  text-align: left;
}

.filename-large {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  word-break: break-word;
}

.file-size {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  margin-top: 2px;
}

.load-button {
  padding: var(--spacing-sm) var(--spacing-lg);
  background: var(--gradient-primary);
  color: var(--text-on-gradient);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  transition: all var(--transition-fast);
}

.load-button:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.large-image-hint {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  margin-top: var(--spacing-sm);
}
</style>
