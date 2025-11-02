<script setup lang="ts">
defineOptions({ name: 'GlobalTransferStatus' })
import { computed } from 'vue'
import { useFileTransferProgress } from '@/composables/useFileTransferProgress'

const { transfers, uploadQueueInfo } = useFileTransferProgress()

// 활성 전송 목록 (업로드만)
const activeTransfers = computed(() => {
  return Object.values(transfers).filter(t => !t.isComplete && t.type === 'upload')
})

// 파일 이름으로 그룹화 (같은 파일을 여러 피어에게 전송 중일 때)
const groupedTransfers = computed(() => {
  const groups = new Map<string, typeof activeTransfers.value>()

  activeTransfers.value.forEach(transfer => {
    const existing = groups.get(transfer.fileName) || []
    existing.push(transfer)
    groups.set(transfer.fileName, existing)
  })

  return Array.from(groups.entries()).map(([fileName, transfers]) => {
    const first = transfers[0]
    if (!first) return null

    return {
      fileName,
      transfers,
      count: transfers.length,
      type: first.type,
      totalBytes: first.totalBytes,
      avgProgress: transfers.reduce((sum, t) => sum + (t.receivedChunks / t.totalChunks), 0) / transfers.length * 100,
    }
  }).filter((g): g is NonNullable<typeof g> => g !== null)
})

const hasActiveTransfers = computed(() => activeTransfers.value.length > 0)
const hasQueue = computed(() => uploadQueueInfo.queuedCount > 0)

const formatProgress = (transfer: { receivedChunks: number; totalChunks: number }) => {
  const percent = (transfer.receivedChunks / transfer.totalChunks * 100).toFixed(0)
  return `${percent}%`
}

const formatSize = (bytes: number) => {
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)}MB`
  const kb = bytes / 1024
  return `${kb.toFixed(0)}KB`
}
</script>

<template>
  <div v-if="hasActiveTransfers || hasQueue" class="global-transfer-status">
    <!-- 업로드 중인 파일들 -->
    <div v-if="hasActiveTransfers" class="transfer-list">
      <div class="transfer-header">
        <span class="transfer-title">⬆️ 업로드 중 ({{ activeTransfers.length }})</span>
      </div>
      <div
        v-for="group in groupedTransfers"
        :key="group.fileName"
        class="transfer-item"
      >
        <div class="transfer-info">
          <span class="transfer-type" :class="group.type">
            ⬆️
          </span>
          <span class="transfer-name">{{ group.fileName }}</span>
          <span v-if="group.count > 1" class="transfer-count">×{{ group.count }}</span>
          <span class="transfer-progress">{{ group.avgProgress.toFixed(0) }}%</span>
          <span class="transfer-size">{{ formatSize(group.totalBytes) }}</span>
        </div>
        <div class="transfer-bar">
          <div
            class="transfer-bar-fill"
            :class="group.type"
            :style="{ width: group.avgProgress.toFixed(0) + '%' }"
          ></div>
        </div>
        <!-- 여러 전송이 있을 때 개별 진행률 표시 -->
        <div v-if="group.count > 1" class="transfer-details">
          <span
            v-for="(transfer, idx) in group.transfers"
            :key="transfer.fileId"
            class="peer-progress"
          >
            피어 {{ idx + 1 }}: {{ formatProgress(transfer) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 업로드 큐 정보 -->
    <div v-if="hasQueue" class="queue-info">
      <span class="queue-icon">⏳</span>
      <span class="queue-text">
        업로드 대기: {{ uploadQueueInfo.queuedCount }}개
        (전송 중: {{ uploadQueueInfo.activeCount }}/{{ uploadQueueInfo.maxConcurrent }})
      </span>
    </div>
  </div>
</template>

<style scoped>
.global-transfer-status {
  position: fixed;
  bottom: 20px;
  right: 20px;
  min-width: 300px;
  max-width: 400px;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.transfer-list {
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.transfer-header {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e9ecef;
}

.transfer-title {
  font-weight: 600;
  font-size: 14px;
  color: #495057;
}

.transfer-item {
  margin-bottom: 12px;
  padding: 8px;
  background: #f8f9fa;
  border-radius: 6px;
}

.transfer-item:last-child {
  margin-bottom: 0;
}

.transfer-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}

.transfer-type {
  font-size: 16px;
}

.transfer-name {
  flex: 1;
  font-weight: 500;
  color: #212529;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 18px;
  padding: 0 6px;
  background: #ffc107;
  color: #000;
  font-size: 11px;
  font-weight: 700;
  border-radius: 9px;
}

.transfer-progress {
  font-family: monospace;
  font-size: 12px;
  color: #6c757d;
  font-weight: 600;
}

.transfer-size {
  font-size: 11px;
  color: #868e96;
}

.transfer-details {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #dee2e6;
}

.peer-progress {
  font-size: 11px;
  color: #495057;
  background: #e9ecef;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: monospace;
}

.transfer-bar {
  height: 4px;
  background: #e9ecef;
  border-radius: 2px;
  overflow: hidden;
}

.transfer-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.transfer-bar-fill.upload {
  background: linear-gradient(90deg, #ff6b6b 0%, #ff8787 100%);
}

.transfer-bar-fill.download {
  background: linear-gradient(90deg, #0078d4 0%, #00bcf2 100%);
}

.queue-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #fff3cd;
  border-top: 1px solid #ffeaa7;
  font-size: 13px;
  color: #856404;
}

.queue-icon {
  font-size: 16px;
}

.queue-text {
  font-weight: 500;
}

/* 스크롤바 스타일 */
.transfer-list::-webkit-scrollbar {
  width: 6px;
}

.transfer-list::-webkit-scrollbar-track {
  background: #f1f3f5;
  border-radius: 3px;
}

.transfer-list::-webkit-scrollbar-thumb {
  background: #adb5bd;
  border-radius: 3px;
}

.transfer-list::-webkit-scrollbar-thumb:hover {
  background: #868e96;
}
</style>
