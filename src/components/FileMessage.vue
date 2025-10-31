<script setup lang="ts">
defineOptions({ name: 'FileMessage' })
import { computed } from 'vue'
import type { FileMeta } from '@/types/types'
import FileTransferProgress from './FileTransferProgress.vue'
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
  gap: 8px;
}

.file-download-button {
  margin-left: 6px;
  padding: 6px 12px;
  cursor: pointer;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  transition: background 0.2s;
  align-self: flex-start;
}

.file-download-button:hover {
  background: #e0e0e0;
  border-color: #999;
}
</style>
