<script setup lang="ts">
defineOptions({ name: 'FileMessage' })
import { computed } from 'vue'
import type { FileMeta } from '@/types/types'
import FileTransferProgress from '@/components/file/FileTransferProgress.vue'
import { useFileTransferProgress } from '@/composables/useFileTransferProgress'

const props = defineProps<{
  fileId: string
  fileMeta: FileMeta | undefined
}>()

const emit = defineEmits<{
  download: [fileId: string]
}>()

// 파일 크기를 읽기 쉬운 형식으로 변환
const formatFileSize = (bytes: number | undefined) => {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(2)}MB`
  const kb = bytes / 1024
  return `${kb.toFixed(2)}KB`
}

const fileInfo = computed(() => {
  const name = props.fileMeta?.name || 'file'
  const size = formatFileSize(props.fileMeta?.size)
  return size ? `${name} (${size})` : name
})

// 전송 중인지 확인
const { isTransferring } = useFileTransferProgress()
const showProgress = computed(() => isTransferring(props.fileId))
</script>

<template>
  <div class="file-message">
    <!-- 전송 진척도 -->
    <FileTransferProgress v-if="showProgress" :fileId="fileId" :fileName="fileMeta?.name" />

    <!-- 다운로드 버튼 -->
    <button @click="emit('download', fileId)" class="file-download-button">
      📎 {{ fileInfo }}
    </button>
  </div>
</template>

<style scoped>
.file-message {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.file-download-button {
  margin-left: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-md);
  cursor: pointer;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  transition: all var(--transition-fast);
  align-self: flex-start;
}

.file-download-button:hover {
  background: var(--bg-tertiary);
  border-color: var(--color-primary-light);
  color: var(--color-primary);
}
</style>
