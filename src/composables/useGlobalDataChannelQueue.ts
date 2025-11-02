import { reactive, computed } from 'vue'
import type { WebrtcProvider } from 'y-webrtc'

/**
 * 데이터 전송 작업의 타입
 */
export type DataChannelJobType =
  | 'file-transfer'      // 파일 전송
  | 'image-transfer'     // 이미지 전송
  | 'profile-picture'    // 프로필 사진
  | 'chunk-transfer'     // 청크 전송 (Yjs 방식)
  | 'direct-p2p'         // 직접 P2P 전송

/**
 * 데이터 전송 작업의 우선순위
 */
export enum DataChannelPriority {
  CRITICAL = 0,   // 프로필 사진, 작은 이미지 (즉시 전송)
  HIGH = 1,       // 채팅 이미지
  NORMAL = 2,     // 일반 파일
  LOW = 3,        // 대용량 파일
}

/**
 * 데이터 채널 전송 작업 정의
 */
export interface DataChannelJob {
  id: string                           // 고유 ID
  type: DataChannelJobType             // 작업 타입
  priority: DataChannelPriority        // 우선순위
  targetPeerId: string                 // 대상 피어 UUID
  dataSize: number                     // 전송할 데이터 크기 (bytes)
  createdAt: number                    // 생성 시각

  // 전송 함수: 실제 전송 로직 (Promise 반환)
  execute: (
    onProgress?: (sent: number, total: number) => void,
    checkCancelled?: () => boolean
  ) => Promise<void>

  // 취소 가능 여부
  cancellable: boolean

  // 메타데이터 (선택)
  metadata?: {
    fileName?: string
    fileId?: string
    chunkIndex?: number
    totalChunks?: number
  }
}

/**
 * 데이터 채널 상태
 */
export interface DataChannelStatus {
  bufferedAmount: number          // 현재 버퍼량
  bufferedAmountLowThreshold: number // 버퍼 임계값
  readyState: RTCDataChannelState
}

/**
 * 큐 통계
 */
export interface QueueStats {
  totalJobs: number
  activeJobs: number
  queuedJobs: number
  completedJobs: number
  failedJobs: number
  cancelledJobs: number
  totalBytesSent: number
  totalBytesQueued: number
  averageSpeed: number  // bytes/sec
}

/**
 * 전역 설정
 */
interface GlobalQueueConfig {
  maxConcurrentJobs: number           // 최대 동시 전송 작업 수
  maxBufferSize: number               // 데이터 채널 최대 버퍼 크기 (bytes)
  bufferThreshold: number             // 버퍼 임계값 (이하로 떨어지면 재개)
  chunkSize: number                   // 청크 전송 크기
  delayBetweenChunks: number          // 청크 간 딜레이 (ms)
  priorityThrottleMap: Map<DataChannelPriority, number> // 우선순위별 쓰로틀 (bytes/sec)
}

// 기본 설정
const DEFAULT_CONFIG: GlobalQueueConfig = {
  maxConcurrentJobs: 3,
  maxBufferSize: 16 * 1024 * 1024,    // 16MB
  bufferThreshold: 512 * 1024,        // 512KB
  chunkSize: 64 * 1024,               // 64KB
  delayBetweenChunks: 10,             // 10ms
  priorityThrottleMap: new Map([
    [DataChannelPriority.CRITICAL, 0],       // 무제한
    [DataChannelPriority.HIGH, 2 * 1024 * 1024],    // 2MB/s
    [DataChannelPriority.NORMAL, 1 * 1024 * 1024],  // 1MB/s
    [DataChannelPriority.LOW, 512 * 1024],          // 512KB/s
  ]),
}

/**
 * 글로벌 데이터 채널 큐 매니저 (싱글톤)
 */
class GlobalDataChannelQueueManager {
  private config: GlobalQueueConfig
  private queue: DataChannelJob[] = []
  private activeJobs = new Map<string, DataChannelJob>()

  // public으로 변경하여 직접 접근 가능하게
  public readonly stats = reactive<QueueStats>({
    totalJobs: 0,
    activeJobs: 0,
    queuedJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    cancelledJobs: 0,
    totalBytesSent: 0,
    totalBytesQueued: 0,
    averageSpeed: 0,
  })

  private dataChannels = new Map<string, RTCDataChannel>()
  private provider: WebrtcProvider | null = null

  // 속도 계산용
  private speedSamples: Array<{ bytes: number; timestamp: number }> = []
  private readonly SPEED_WINDOW = 5000 // 5초 윈도우

  constructor(config?: Partial<GlobalQueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    console.log('[Queue] 큐 매니저 초기화 - 통계:', this.stats)
  }

  /**
   * WebRTC Provider 등록
   */
  setProvider(provider: WebrtcProvider) {
    this.provider = provider
  }

  /**
   * 데이터 채널 등록 (피어별)
   */
  registerDataChannel(peerId: string, channel: RTCDataChannel) {
    this.dataChannels.set(peerId, channel)

    // 버퍼 임계값 설정
    channel.bufferedAmountLowThreshold = this.config.bufferThreshold

    channel.addEventListener('bufferedamountlow', () => {
      // 버퍼가 비면 다음 작업 처리
      this.processNextJob()
    })

    channel.addEventListener('close', () => {
      this.dataChannels.delete(peerId)
      // 해당 피어로 전송 중이던 작업 실패 처리
      this.cancelJobsForPeer(peerId)
    })
  }

  /**
   * 데이터 채널 제거
   */
  unregisterDataChannel(peerId: string) {
    this.dataChannels.delete(peerId)
    this.cancelJobsForPeer(peerId)
  }

  /**
   * 작업 추가
   */
  enqueue(job: DataChannelJob): string {
    this.queue.push(job)
    this.stats.totalJobs++
    this.stats.totalBytesQueued += job.dataSize

    // 우선순위별 정렬 (낮은 숫자 = 높은 우선순위)
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      // 같은 우선순위면 생성 시간 순
      return a.createdAt - b.createdAt
    })

    // 통계 업데이트
    this.updateQueueStats()

    console.log(`[Queue] 📥 작업 추가: ${job.id}, 타입: ${job.type}, 우선순위: ${job.priority}`)
    console.log(`[Queue] 통계 - 총: ${this.stats.totalJobs}, 활성: ${this.stats.activeJobs}, 대기: ${this.stats.queuedJobs}`)

    // 마이크로태스크로 처리 시도 (Vue 반응성 보장)
    queueMicrotask(() => this.processNextJob())

    return job.id
  }

  /**
   * 작업 취소
   */
  cancelJob(jobId: string): boolean {
    // 큐에서 제거
    const queueIndex = this.queue.findIndex(j => j.id === jobId)
    if (queueIndex !== -1) {
      const job = this.queue.splice(queueIndex, 1)[0]
      if (job) {
        this.stats.cancelledJobs++
        this.stats.totalBytesQueued = Math.max(0, this.stats.totalBytesQueued - job.dataSize)
        this.updateQueueStats()
      }
      return true
    }

    // 활성 작업 중이면 취소 불가 (이미 진행 중)
    return false
  }

  /**
   * 큐 통계 업데이트 (activeJobs, queuedJobs)
   */
  private updateQueueStats() {
    this.stats.activeJobs = this.activeJobs.size
    this.stats.queuedJobs = this.queue.length
  }

  /**
   * 특정 피어로의 모든 작업 취소
   */
  private cancelJobsForPeer(peerId: string) {
    console.log(`[Queue] 피어 ${peerId} 작업 취소 - 큐: ${this.queue.length}, 활성: ${this.activeJobs.size}`)

    // 큐에서 해당 피어 작업 제거
    const cancelledJobs = this.queue.filter(j => j.targetPeerId === peerId)
    this.queue = this.queue.filter(j => j.targetPeerId !== peerId)

    if (cancelledJobs.length > 0) {
      console.log(`[Queue] 큐에서 ${cancelledJobs.length}개 작업 취소`)
      cancelledJobs.forEach(job => {
        this.stats.cancelledJobs++
        this.stats.totalBytesQueued = Math.max(0, this.stats.totalBytesQueued - job.dataSize)
      })
    }

    // 활성 작업 처리: 작업 타입에 따라 다르게 처리
    const activeJobsForPeer: Array<{ jobId: string; job: DataChannelJob }> = []
    for (const [jobId, job] of this.activeJobs) {
      if (job.targetPeerId === peerId) {
        activeJobsForPeer.push({ jobId, job })
      }
    }

    if (activeJobsForPeer.length > 0) {
      activeJobsForPeer.forEach(({ jobId, job }) => {
        // 작업 타입에 따라 다르게 처리
        switch (job.type) {
          case 'file-transfer':
          case 'image-transfer':
          case 'direct-p2p':
            // 일회성 전송은 execute() 함수가 알아서 완료/실패 처리함
            console.log(`[Queue] 일회성 전송 작업 ${jobId} - 채널 닫힘 무시 (execute가 처리 중)`)
            // activeJobs에서 제거하지 않음 - execute()가 완료되면 자동으로 제거됨
            break

          case 'chunk-transfer':
          case 'profile-picture':
          default:
            // 영구 연결은 채널이 끊기면 실패
            console.log(`[Queue] 영구 연결 작업 ${jobId} 실패 처리`)
            this.activeJobs.delete(jobId)
            this.stats.failedJobs++
            break
        }
      })
    }

    this.updateQueueStats()
  }

  /**
   * 다음 작업 처리
   */
  private async processNextJob() {
    // 최대 동시 작업 수 체크
    if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
      console.log('[Queue] 최대 동시 작업 수 도달:', this.activeJobs.size)
      return
    }

    // 큐가 비어있으면 종료
    if (this.queue.length === 0) {
      console.log('[Queue] 큐가 비어있음')
      this.updateQueueStats()
      return
    }

    // 다음 작업 가져오기
    const job = this.queue.shift()
    if (!job) return

    // 큐에서 제거했으므로 통계 업데이트
    this.updateQueueStats()

    console.log(`[Queue] 작업 시작: ${job.id}, 큐 길이: ${this.queue.length}, 활성: ${this.activeJobs.size}`)

    // 데이터 채널 확인 (선택적)
    // 파일 전송/이미지 전송/프로필 사진은 execute 내부에서 처리하므로 체크하지 않음
    // chunk-transfer만 기존 데이터 채널 필요
    const needsExistingChannel = job.type === 'chunk-transfer'

    if (needsExistingChannel) {
      const channel = this.dataChannels.get(job.targetPeerId)
      if (!channel || channel.readyState !== 'open') {
        console.warn(`[Queue] 피어 ${job.targetPeerId}의 데이터 채널 없음 - 작업 실패`)
        this.stats.failedJobs++
        this.stats.totalBytesQueued = Math.max(0, this.stats.totalBytesQueued - job.dataSize)
        this.updateQueueStats()
        this.processNextJob() // 다음 작업 시도
        return
      }

      // 버퍼 상태 확인
      if (channel.bufferedAmount > this.config.bufferThreshold) {
        // 버퍼가 아직 많이 차있으면 다시 큐에 넣기
        this.queue.unshift(job)
        this.updateQueueStats()
        return
      }
    }

    // 작업 시작 (activeJobs에 추가하고 통계 업데이트)
    this.activeJobs.set(job.id, job)
    this.stats.totalBytesQueued = Math.max(0, this.stats.totalBytesQueued - job.dataSize)
    this.updateQueueStats()

    try {
      const startTime = Date.now()

      // 진행 상황 콜백
      const onProgress = () => {
        // 진행 상황 추적 (필요시 활용)
      }

      // 취소 확인 콜백
      const checkCancelled = () => {
        return !this.activeJobs.has(job.id)
      }

      // 작업 실행
      await job.execute(onProgress, checkCancelled)

      // 완료 처리
      if (this.activeJobs.has(job.id)) {
        this.activeJobs.delete(job.id)
      }
      this.stats.completedJobs++
      this.stats.totalBytesSent += job.dataSize
      this.updateQueueStats()

      // 속도 계산
      const elapsed = Date.now() - startTime
      this.updateSpeed(job.dataSize)

      console.log(`[Queue] ✅ 작업 완료: ${job.id} (${(job.dataSize / 1024).toFixed(1)}KB, ${elapsed}ms)`)
      console.log(`[Queue] 통계 - 완료: ${this.stats.completedJobs}, 실패: ${this.stats.failedJobs}, 활성: ${this.stats.activeJobs}, 대기: ${this.stats.queuedJobs}`)

    } catch (error) {
      // 실패 처리
      if (this.activeJobs.has(job.id)) {
        this.activeJobs.delete(job.id)
      }
      this.stats.failedJobs++
      this.updateQueueStats()

      console.error(`[Queue] ❌ 작업 실패: ${job.id}`, error)
      console.log(`[Queue] 통계 - 완료: ${this.stats.completedJobs}, 실패: ${this.stats.failedJobs}, 활성: ${this.stats.activeJobs}, 대기: ${this.stats.queuedJobs}`)
    }

    // 다음 작업 처리
    this.processNextJob()
  }

  /**
   * 속도 계산 업데이트
   */
  private updateSpeed(bytes: number) {
    const now = Date.now()
    this.speedSamples.push({ bytes, timestamp: now })

    // 오래된 샘플 제거 (5초 윈도우)
    this.speedSamples = this.speedSamples.filter(
      s => now - s.timestamp < this.SPEED_WINDOW
    )

    // 평균 속도 계산
    if (this.speedSamples.length > 0) {
      const totalBytes = this.speedSamples.reduce((sum, s) => sum + s.bytes, 0)
      const oldestSample = this.speedSamples[0]
      if (oldestSample) {
        const timeSpan = now - oldestSample.timestamp

        if (timeSpan > 0) {
          this.stats.averageSpeed = (totalBytes / timeSpan) * 1000 // bytes/sec
        }
      }
    }
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<GlobalQueueConfig>) {
    this.config = { ...this.config, ...config }
  }

  /**
   * 통계 정보 가져오기 (reactive 객체 반환)
   */
  getStats() {
    return this.stats
  }

  /**
   * 큐 상태 가져오기
   */
  getQueueState() {
    return {
      queueLength: this.queue.length,
      activeCount: this.activeJobs.size,
      maxConcurrent: this.config.maxConcurrentJobs,
      jobs: this.queue.map(j => ({
        id: j.id,
        type: j.type,
        priority: j.priority,
        size: j.dataSize,
        target: j.targetPeerId,
      })),
    }
  }

  /**
   * 모든 작업 취소 및 큐 초기화
   */
  clear() {
    this.queue = []
    this.activeJobs.clear()
    this.stats.totalBytesQueued = 0
    this.updateQueueStats()
  }
}

// 싱글톤 인스턴스
let globalQueueManager: GlobalDataChannelQueueManager | null = null

/**
 * 글로벌 큐 매니저 사용하기
 */
export function useGlobalDataChannelQueue(config?: Partial<GlobalQueueConfig>) {
  if (!globalQueueManager) {
    globalQueueManager = new GlobalDataChannelQueueManager(config)
  } else if (config) {
    globalQueueManager.updateConfig(config)
  }

  // reactive 통계 정보
  const stats = globalQueueManager!.stats
  const queueState = computed(() => globalQueueManager!.getQueueState())

  return {
    // 메서드
    enqueue: (job: DataChannelJob) => globalQueueManager!.enqueue(job),
    cancelJob: (jobId: string) => globalQueueManager!.cancelJob(jobId),
    setProvider: (provider: WebrtcProvider) => globalQueueManager!.setProvider(provider),
    registerDataChannel: (peerId: string, channel: RTCDataChannel) =>
      globalQueueManager!.registerDataChannel(peerId, channel),
    unregisterDataChannel: (peerId: string) =>
      globalQueueManager!.unregisterDataChannel(peerId),
    updateConfig: (cfg: Partial<GlobalQueueConfig>) =>
      globalQueueManager!.updateConfig(cfg),
    clear: () => globalQueueManager!.clear(),

    // 반응형 데이터
    stats,
    queueState,
  }
}

/**
 * 헬퍼: 파일 전송 작업 생성
 */
export function createFileTransferJob(
  fileId: string,
  fileName: string,
  targetPeerId: string,
  dataSize: number,
  priority: DataChannelPriority,
  executeFunc: (
    onProgress?: (sent: number, total: number) => void,
    checkCancelled?: () => boolean
  ) => Promise<void>
): DataChannelJob {
  return {
    id: `file-${fileId}-${targetPeerId}-${Date.now()}`,
    type: 'file-transfer',
    priority,
    targetPeerId,
    dataSize,
    createdAt: Date.now(),
    execute: executeFunc,
    cancellable: true,
    metadata: {
      fileId,
      fileName,
    },
  }
}

/**
 * 헬퍼: 이미지 전송 작업 생성
 */
export function createImageTransferJob(
  imageId: string,
  targetPeerId: string,
  dataSize: number,
  priority: DataChannelPriority,
  executeFunc: (
    onProgress?: (sent: number, total: number) => void,
    checkCancelled?: () => boolean
  ) => Promise<void>
): DataChannelJob {
  return {
    id: `image-${imageId}-${targetPeerId}-${Date.now()}`,
    type: 'image-transfer',
    priority,
    targetPeerId,
    dataSize,
    createdAt: Date.now(),
    execute: executeFunc,
    cancellable: true,
    metadata: {
      fileId: imageId,
    },
  }
}

/**
 * 헬퍼: 프로필 사진 전송 작업 생성
 */
export function createProfilePictureJob(
  userId: string,
  targetPeerId: string,
  dataSize: number,
  executeFunc: (
    onProgress?: (sent: number, total: number) => void,
    checkCancelled?: () => boolean
  ) => Promise<void>
): DataChannelJob {
  return {
    id: `profile-${userId}-${targetPeerId}-${Date.now()}`,
    type: 'profile-picture',
    priority: DataChannelPriority.CRITICAL, // 프로필은 항상 최우선
    targetPeerId,
    dataSize,
    createdAt: Date.now(),
    execute: executeFunc,
    cancellable: false, // 프로필은 취소 불가
  }
}
