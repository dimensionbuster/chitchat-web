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
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  min-width: 320px;
  max-width: 400px;
  z-index: 1000;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.queue-header:hover {
  background: rgba(0, 0, 0, 0.02);
}

.queue-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: #333;
  padding-right: 8px;
}

.queue-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #666;
  margin-left: auto;
  margin-right: 8px;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.summary-label {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}

.active-count {
  color: #2563eb;
  font-weight: 600;
}

.queued-count {
  color: #64748b;
  font-weight: 600;
}

.separator {
  color: #cbd5e1;
  margin: 0 2px;
}

.speed {
  margin-left: 8px;
  padding: 2px 8px;
  background: #dbeafe;
  color: #1e40af;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
}

.expand-icon {
  transition: transform 0.3s;
  color: #94a3b8;
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.queue-details {
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  padding: 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat-item {
  text-align: center;
}

.stat-label {
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
}

.stat-value.success {
  color: #16a34a;
}

.stat-value.error {
  color: #dc2626;
}

.transfer-stats {
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #64748b;
  padding: 4px 0;
}

.stat-row .value {
  font-weight: 600;
  color: #334155;
}

.active-jobs,
.queue-jobs {
  margin-top: 16px;
}

.active-jobs:first-child,
.queue-jobs:first-child {
  margin-top: 0;
}

.jobs-header {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 8px;
}

.job-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 12px;
}

.job-item.active {
  flex-direction: column;
  align-items: stretch;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}

.job-item.active.completed {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.job-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.job-item.active .job-info {
  margin-bottom: 6px;
}

.job-type {
  font-weight: 500;
  color: #334155;
  font-size: 14px;
}

.job-name {
  flex: 1;
  font-weight: 500;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-progress-text {
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  color: #2563eb;
}

.job-item.completed .job-progress-text {
  color: #16a34a;
}

.job-details {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  font-size: 11px;
  color: #64748b;
}

.chunk-info {
  font-family: monospace;
}

.job-size {
  color: #94a3b8;
}

/* 진행률 바 */
.progress-bar-wrapper {
  height: 6px;
  background: #e0e7ff;
  border-radius: 3px;
  overflow: hidden;
}

.job-item.completed .progress-bar-wrapper {
  background: #dcfce7;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%);
  border-radius: 3px;
  transition: width 0.3s ease;
  position: relative;
  overflow: hidden;
}

.progress-bar-fill.completed {
  background: linear-gradient(90deg, #16a34a 0%, #22c55e 100%);
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
    rgba(255, 255, 255, 0.3) 50%,
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
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}

.priority-0 {
  background: #fee2e2;
  color: #991b1b;
}

.priority-1 {
  background: #fef3c7;
  color: #92400e;
}

.priority-2 {
  background: #dbeafe;
  color: #1e40af;
}

.priority-3 {
  background: #e2e8f0;
  color: #475569;
}

.more-jobs {
  text-align: center;
  font-size: 11px;
  color: #94a3b8;
  padding: 8px 0;
}

/* 애니메이션 */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
  max-height: 600px;
  overflow: hidden;
}

.slide-enter-from,
.slide-leave-to {
  max-height: 0;
  opacity: 0;
}

/* 다크 모드 지원 */
@media (prefers-color-scheme: dark) {
  .queue-status {
    background: rgba(30, 41, 59, 0.95);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .queue-header:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .queue-title {
    color: #e2e8f0;
  }

  .queue-summary {
    color: #cbd5e1;
  }

  .speed {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .queue-details {
    border-top-color: rgba(255, 255, 255, 0.05);
  }

  .stat-value {
    color: #e2e8f0;
  }

  .transfer-stats {
    background: rgba(0, 0, 0, 0.2);
  }

  .stat-row {
    color: #cbd5e1;
  }

  .stat-row .value {
    color: #e2e8f0;
  }

  .job-item {
    background: rgba(0, 0, 0, 0.2);
  }

  .job-item.active {
    background: rgba(37, 99, 235, 0.15);
    border-color: rgba(59, 130, 246, 0.3);
  }

  .job-item.active.completed {
    background: rgba(22, 163, 74, 0.15);
    border-color: rgba(34, 197, 94, 0.3);
  }

  .job-type,
  .job-name {
    color: #e2e8f0;
  }

  .job-progress-text {
    color: #60a5fa;
  }

  .job-item.completed .job-progress-text {
    color: #4ade80;
  }

  .progress-bar-wrapper {
    background: rgba(0, 0, 0, 0.3);
  }

  .job-item.completed .progress-bar-wrapper {
    background: rgba(0, 0, 0, 0.3);
  }

  .progress-bar-fill {
    background: linear-gradient(90deg, #2563eb 0%, #3b82f6 100%);
  }

  .progress-bar-fill.completed {
    background: linear-gradient(90deg, #16a34a 0%, #22c55e 100%);
  }
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
