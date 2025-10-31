<script setup lang="ts">
defineOptions({ name: 'FileMessage' })
import { computed } from 'vue'
import type { FileMeta } from '@/types/types'

const props = defineProps<{
  cid: string
  fileMeta: FileMeta | undefined
}>()

const emit = defineEmits<{
  download: [cid: string]
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
</script>

<template>
  <button @click="emit('download', cid)" class="file-download-button">📎 {{ fileInfo }}</button>
</template>

<style scoped>
.file-download-button {
  margin-left: 6px;
  padding: 6px 12px;
  cursor: pointer;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  transition: background 0.2s;
}

.file-download-button:hover {
  background: #e0e0e0;
  border-color: #999;
}
</style>
