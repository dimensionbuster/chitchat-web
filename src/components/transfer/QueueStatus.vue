<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGlobalDataChannelQueue } from '@/composables/useGlobalDataChannelQueue'
import type { DataChannelJobType } from '@/composables/useGlobalDataChannelQueue'
import { useFileTransferProgress } from '@/composables/useFileTransferProgress'

const { stats, queueState } = useGlobalDataChannelQueue()
const { transfers } = useFileTransferProgress()

const expanded = ref(false)

const showQueue = computed(() => {
  // 활성/대기 작업이 있거나, 활성 전송이 있을 때 표시
  return stats.activeJobs > 0 ||
         stats.queuedJobs > 0 ||
         activeTransfers.value.length > 0
})

// 활성 전송 목록 (진행률 표시용 - 완료된 것도 포함)
const activeTransfers = computed(() => {
  return Object.values(transfers).filter(t => t.type === 'upload')
})

function toggleExpanded() {
  expanded.value = !expanded.value
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k))
  return `${(bytesPerSec / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function getJobTypeLabel(type: DataChannelJobType): string {
  const labels: Record<DataChannelJobType, string> = {
    'file-transfer': '파일',
    'image-transfer': '이미지',
    'profile-picture': '프로필',
    'chunk-transfer': '청크',
    'direct-p2p': 'P2P',
  }
  return labels[type] || type
}

function getPriorityLabel(priority: number): string {
  const labels = ['최우선', '높음', '보통', '낮음']
  return labels[priority] || '보통'
}
</script>
<template>
  <div v-if="showQueue" class="queue-status">
    <div class="queue-header" @click="toggleExpanded">
      <div class="queue-title">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
        <span>전송 큐</span>
      </div>
      <div class="queue-summary">
        <span class="summary-item">
          <span class="summary-label">활성</span>
          <span class="active-count">{{ stats.activeJobs }}</span>
        </span>
        <span class="separator">/</span>
        <span class="summary-item">
          <span class="summary-label">대기</span>
          <span class="queued-count">{{ stats.queuedJobs }}</span>
        </span>
        <span class="speed" v-if="stats.averageSpeed > 0">
          {{ formatSpeed(stats.averageSpeed) }}
        </span>
      </div>
      <svg
        :class="['expand-icon', { expanded }]"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>

    <transition name="slide">
      <div v-if="expanded" class="queue-details">
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">활성 작업</div>
            <div class="stat-value">{{ stats.activeJobs }}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">대기 중</div>
            <div class="stat-value">{{ stats.queuedJobs }}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">완료</div>
            <div class="stat-value success">{{ stats.completedJobs }}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">실패</div>
            <div class="stat-value error">{{ stats.failedJobs }}</div>
          </div>
        </div>

        <div class="transfer-stats">
          <div class="stat-row">
            <span>전송량:</span>
            <span class="value">{{ formatBytes(stats.totalBytesSent) }}</span>
          </div>
          <div class="stat-row">
            <span>대기량:</span>
            <span class="value">{{ formatBytes(stats.totalBytesQueued) }}</span>
          </div>
          <div class="stat-row">
            <span>평균 속도:</span>
            <span class="value">{{ formatSpeed(stats.averageSpeed) }}</span>
          </div>
        </div>

        <!-- 활성 작업 (진행률 표시) -->
        <div v-if="activeTransfers.length > 0" class="active-jobs">
          <div class="jobs-header">전송 중</div>
          <div
            v-for="transfer in activeTransfers"
            :key="transfer.fileId"
            :class="['job-item', 'active', { completed: transfer.isComplete }]"
          >
            <div class="job-info">
              <div class="job-type">
                {{ transfer.isComplete ? '✅' : '⬆️' }}
              </div>
              <div class="job-name">{{ transfer.fileName }}</div>
              <div class="job-progress-text">
                {{ transfer.isComplete ? '완료' : ((transfer.receivedChunks / transfer.totalChunks) * 100).toFixed(0) + '%' }}
              </div>
            </div>
            <div class="progress-bar-wrapper">
              <div
                class="progress-bar-fill"
                :class="{ completed: transfer.isComplete }"
                :style="{ width: ((transfer.receivedChunks / transfer.totalChunks) * 100) + '%' }"
              ></div>
            </div>
            <div class="job-details">
              <span class="chunk-info">
                {{ transfer.receivedChunks }} / {{ transfer.totalChunks }} 청크
              </span>
              <span class="job-size">{{ formatBytes(transfer.totalBytes) }}</span>
            </div>
          </div>
        </div>

        <!-- 대기 중인 작업 -->
        <div v-if="queueState.jobs.length > 0" class="queue-jobs">
          <div class="jobs-header">대기 중</div>
          <div
            v-for="job in queueState.jobs.slice(0, 5)"
            :key="job.id"
            class="job-item"
          >
            <div class="job-info">
              <div class="job-type">
                {{ getJobTypeLabel(job.type) }}
              </div>
              <div class="job-size">{{ formatBytes(job.size) }}</div>
            </div>
            <div :class="['job-priority', `priority-${job.priority}`]">
              {{ getPriorityLabel(job.priority) }}
            </div>
          </div>
          <div v-if="queueState.jobs.length > 5" class="more-jobs">
            +{{ queueState.jobs.length - 5 }}개 더...
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>



<style scoped>
.queue-status {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: var(--bg-glass);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  min-width: 320px;
  max-width: 400px;
  z-index: 1000;
  overflow: hidden;
  border: 1px solid var(--border-light);
}

.queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) var(--spacing-lg);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.queue-header:hover {
  background: var(--bg-secondary);
}

.queue-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  padding-right: var(--spacing-sm);
}

.queue-title svg {
  color: var(--color-primary);
}

.queue-summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-left: auto;
  margin-right: var(--spacing-sm);
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.summary-label {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  font-weight: var(--font-weight-medium);
}

.active-count {
  color: var(--color-primary);
  font-weight: var(--font-weight-semibold);
}

.queued-count {
  color: var(--text-secondary);
  font-weight: var(--font-weight-semibold);
}

.separator {
  color: var(--border-default);
  margin: 0 2px;
}

.speed {
  margin-left: var(--spacing-sm);
  padding: 2px 8px;
  background: var(--gradient-primary);
  color: var(--text-on-gradient);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.expand-icon {
  transition: transform var(--transition-normal);
  color: var(--text-muted);
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.queue-details {
  border-top: 1px solid var(--border-light);
  padding: var(--spacing-lg);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.stat-item {
  text-align: center;
}

.stat-label {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  margin-bottom: 4px;
}

.stat-value {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.stat-value.success {
  color: var(--color-success);
}

.stat-value.error {
  color: var(--color-error);
}

.transfer-stats {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  padding: 4px 0;
}

.stat-row .value {
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.active-jobs,
.queue-jobs {
  margin-top: var(--spacing-lg);
}

.active-jobs:first-child,
.queue-jobs:first-child {
  margin-top: 0;
}

.jobs-header {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  margin-bottom: var(--spacing-sm);
}

.job-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-xs);
  font-size: var(--font-size-xs);
}

.job-item.active {
  flex-direction: column;
  align-items: stretch;
  background: rgba(var(--color-primary-rgb), 0.1);
  border: 1px solid var(--color-primary-light);
}

.job-item.active.completed {
  background: rgba(var(--color-success-rgb), 0.1);
  border-color: var(--color-success);
}

.job-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.job-item.active .job-info {
  margin-bottom: var(--spacing-xs);
}

.job-type {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  font-size: var(--font-size-base);
}

.job-name {
  flex: 1;
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-progress-text {
  font-family: monospace;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary);
}

.job-item.completed .job-progress-text {
  color: var(--color-success);
}

.job-details {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.chunk-info {
  font-family: monospace;
}

.job-size {
  color: var(--text-muted);
}

/* 진행률 바 */
.progress-bar-wrapper {
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.job-item.completed .progress-bar-wrapper {
  background: rgba(var(--color-success-rgb), 0.2);
}

.progress-bar-fill {
  height: 100%;
  background: var(--gradient-primary);
  border-radius: var(--radius-full);
  transition: width 0.3s ease;
  position: relative;
  overflow: hidden;
}

.progress-bar-fill.completed {
  background: linear-gradient(135deg, var(--color-success) 0%, #22c55e 100%);
}

.progress-bar-fill::after {
  content: '';
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

.job-priority {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
}

.priority-0 {
  background: rgba(var(--color-error-rgb), 0.15);
  color: var(--color-error);
}

.priority-1 {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
}

.priority-2 {
  background: rgba(var(--color-primary-rgb), 0.15);
  color: var(--color-primary);
}

.priority-3 {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.more-jobs {
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  padding: var(--spacing-sm) 0;
}

/* 애니메이션 */
.slide-enter-active,
.slide-leave-active {
  transition: all var(--transition-normal);
  max-height: 600px;
  overflow: hidden;
}

.slide-enter-from,
.slide-leave-to {
  max-height: 0;
  opacity: 0;
}

/* 모바일 반응형 */
@media (max-width: 640px) {
  .queue-status {
    bottom: 10px;
    right: 10px;
    min-width: 280px;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
