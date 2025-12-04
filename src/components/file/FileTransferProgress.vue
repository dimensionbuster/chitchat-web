<script setup lang="ts">
defineOptions({ name: 'FileTransferProgress' })
import { computed } from 'vue'
import { useFileTransferProgress } from '@/composables/useFileTransferProgress'

const props = defineProps<{
  fileId: string
  fileName?: string
}>()

const { getProgress, getProgressPercent } = useFileTransferProgress()

const transfer = computed(() => getProgress(props.fileId))
const progressPercent = computed(() => getProgressPercent(props.fileId))

const isTransferring = computed(() => {
  return transfer.value && !transfer.value.isComplete
})

const displayName = computed(() => {
  return props.fileName || transfer.value?.fileName || 'file'
})

const displayType = computed(() => {
  if (!transfer.value) return ''
  return transfer.value.type === 'upload' ? '업로드' : '다운로드'
})

const formatSpeed = computed(() => {
  if (!transfer.value) return ''
  const elapsed = Date.now() - transfer.value.startTime
  if (elapsed < 100) return '' // 너무 빠르면 표시 안 함

  const bytesTransferred = transfer.value.receivedBytes
  const speed = bytesTransferred / (elapsed / 1000) // bytes/sec
  const mbps = speed / 1024 / 1024

  if (mbps >= 1) return `${mbps.toFixed(2)} MB/s`
  const kbps = speed / 1024
  return `${kbps.toFixed(0)} KB/s`
})
</script>

<template>
  <div v-if="isTransferring" class="progress-container">
    <div class="progress-header">
      <span class="progress-label"
        >{{ displayType }} 중... ({{ progressPercent.toFixed(0) }}%)</span
      >
      <span v-if="formatSpeed" class="progress-speed">{{ formatSpeed }}</span>
    </div>
    <div class="progress-bar-wrapper">
      <div class="progress-bar" :style="{ width: progressPercent + '%' }">
        <div class="progress-bar-shimmer"></div>
      </div>
    </div>
    <div class="progress-info">
      <span class="file-name">{{ displayName }}</span>
      <span class="chunk-info"
        >{{ (transfer?.receivedBytes! / 1024 / 1024).toFixed(1) }}MB / {{ (transfer?.totalBytes! / 1024 / 1024).toFixed(1) }}MB</span
      >
    </div>
  </div>
</template>

<style scoped>
.progress-container {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-md);
  background: var(--bg-glass);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-sm);
  backdrop-filter: blur(8px);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-xs);
}

.progress-label {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.progress-speed {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  font-family: monospace;
}

.progress-bar-wrapper {
  height: 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
  position: relative;
}

.progress-bar {
  height: 100%;
  background: var(--gradient-primary);
  border-radius: var(--radius-full);
  transition: width 0.3s ease;
  position: relative;
  overflow: hidden;
}

/* 애니메이션 효과 */
.progress-bar-shimmer {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 100%
  );
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% {
    left: -100%;
  }
  100% {
    left: 200%;
  }
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.file-name {
  font-weight: var(--font-weight-medium);
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chunk-info {
  font-family: monospace;
}
</style>
