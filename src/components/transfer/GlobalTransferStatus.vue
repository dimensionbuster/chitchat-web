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

    // 각 전송의 진행률 계산 시 100%를 초과하지 않도록 제한
    const avgProgress = transfers.reduce((sum, t) => {
      const progress = t.totalBytes > 0 ? Math.min((t.receivedBytes / t.totalBytes) * 100, 100) : 0
      return sum + progress
    }, 0) / transfers.length

    return {
      fileName,
      transfers,
      count: transfers.length,
      type: first.type,
      totalBytes: first.totalBytes,
      avgProgress,
    }
  }).filter((g): g is NonNullable<typeof g> => g !== null)
})

const hasActiveTransfers = computed(() => activeTransfers.value.length > 0)
const hasQueue = computed(() => uploadQueueInfo.queuedCount > 0)

const formatProgress = (transfer: { receivedBytes: number; totalBytes: number }) => {
  // 100%를 초과하지 않도록 제한 (마지막 청크 크기 오차 방지)
  const percent = Math.min((transfer.receivedBytes / transfer.totalBytes * 100), 100).toFixed(0)
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
  background: var(--bg-glass);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  overflow: hidden;
  backdrop-filter: blur(12px);
}

.transfer-list {
  padding: var(--spacing-md);
  max-height: 300px;
  overflow-y: auto;
}

.transfer-header {
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--border-light);
}

.transfer-title {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-base);
  color: var(--text-primary);
}

.transfer-item {
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-sm);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
}

.transfer-item:last-child {
  margin-bottom: 0;
}

.transfer-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
  font-size: var(--font-size-sm);
}

.transfer-type {
  font-size: var(--font-size-lg);
}

.transfer-name {
  flex: 1;
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
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
  background: var(--gradient-primary);
  color: var(--text-on-gradient);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  border-radius: var(--radius-full);
}

.transfer-progress {
  font-family: monospace;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  font-weight: var(--font-weight-semibold);
}

.transfer-size {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.transfer-details {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xs);
  padding-top: var(--spacing-xs);
  border-top: 1px solid var(--border-light);
}

.peer-progress {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  background: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-family: monospace;
}

.transfer-bar {
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.transfer-bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width 0.3s ease;
}

.transfer-bar-fill.upload {
  background: var(--gradient-primary);
}

.transfer-bar-fill.download {
  background: var(--gradient-accent);
}

.queue-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-warning-bg);
  border-top: 1px solid var(--color-warning);
  font-size: var(--font-size-sm);
  color: var(--color-warning-text);
}

.queue-icon {
  font-size: var(--font-size-lg);
}

.queue-text {
  font-weight: var(--font-weight-medium);
}

/* 스크롤바 스타일 */
.transfer-list::-webkit-scrollbar {
  width: 6px;
}

.transfer-list::-webkit-scrollbar-track {
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
}

.transfer-list::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: var(--radius-sm);
}

.transfer-list::-webkit-scrollbar-thumb:hover {
  background: var(--color-primary-light);
}
</style>
