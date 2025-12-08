import type { WebrtcProvider } from 'y-webrtc'
import { useWebrtcConnection, type FileTransferOffer } from './useWebrtcConnection'
import { useFileTransferProgress } from './useFileTransferProgress'
import { getCachedFile, cacheFile } from './useStorageFileCache'
import type { FileMeta } from '@/types/types'
import {
  useGlobalDataChannelQueue,
  createFileTransferJob,
  DataChannelPriority
} from './useGlobalDataChannelQueue'
import { useFileTransferState } from './useFileTransferState'

// ===== Constants =====
const CHUNK_SIZE = 32 * 1024 // 32KB
const MAX_BUFFER_SIZE = 4 * 1024 * 1024 // 4MB
const BUFFER_LOW_WATERMARK = 512 * 1024 // 512KB
const BUFFER_CRITICAL = 128 * 1024 // 128KB
const ACK_WINDOW = 10 // 청크 단위
const ACK_TIMEOUT = 5000 // ms
const ACK_REQUEST_INTERVAL = 10000 // ms
const DB_SAVE_CHUNK_INTERVAL = 100 // 청크 단위
const DB_SAVE_META_INTERVAL = 20 // 청크 단위
const HANDSHAKE_TIMEOUT = 5000 // ms
const RESUME_INFO_TIMEOUT = 3000 // ms
const TRANSFER_TIMEOUT = 5 * 60 * 1000 // 5분
const RECEIVE_TIMEOUT = 30000 // 30초
const PERIODIC_ACK_INTERVAL = 4000 // ms
const BUFFER_CHECK_INTERVAL = 100 // ms
const MAX_RETRIES = 3

// ===== Types =====
type StartMessage = {
  type: 'start'
  totalChunks: number
  fileSize: number
  chunkSize: number
  hasPartialData?: boolean
}

type CompleteMessage = { type: 'complete' }
type ErrorMessage = { type: 'error'; message: string }
type AckMessage = {
  type: 'ack'
  receivedCount: number
  nextChunkIndex: number
  lastContinuousIndex: number
}
type ResumeMessage = { type: 'resume'; receivedChunks: number[] }
type RequestAckMessage = { type: 'request-ack' }
type ReRequestMessage = { type: 'reRequest'; missingChunks: number[] }

type TransferMessage =
  | StartMessage
  | CompleteMessage
  | ErrorMessage
  | AckMessage
  | ResumeMessage
  | RequestAckMessage
  | ReRequestMessage

type TransferState = 'idle' | 'handshake' | 'transferring' | 'completing' | 'completed' | 'failed'

// ===== 리소스 관리 클래스 =====
class ResourceManager {
  private cleanupFns: Array<() => void> = []

  add(cleanup: () => void): void {
    this.cleanupFns.push(cleanup)
  }

  cleanup(): void {
    this.cleanupFns.forEach(fn => {
      try {
        fn()
      } catch (error) {
        console.warn('[ResourceManager] Cleanup error:', error)
      }
    })
    this.cleanupFns = []
  }
}

// ===== 송신자 클래스 =====
class FileSender {
  private state: TransferState = 'idle'
  private resources = new ResourceManager()
  private aborted = false
  private confirmedNextChunk = 0
  private receivedChunksSet = new Set<number>()
  private lastProgressTime = Date.now()
  private lastAckRequestTime = Date.now()
  private currentChunkIndex = 0 // 현재 전송 중인 청크 인덱스

  constructor(
    private fileId: string,
    private targetUuid: string,
    private fileBlob: Blob,
    private totalChunks: number,
    private fileSize: number,
    private transferKey: string,
    private onProgress?: (sent: number, total: number) => void,
    private checkCancelled?: () => boolean
  ) {}

  async send(channel: RTCDataChannel): Promise<void> {
    try {
      this.state = 'handshake'
      await this.waitForChannelOpen(channel)
      await this.performHandshake(channel)

      this.state = 'transferring'
      await this.transferChunks(channel)

      this.state = 'completing'
      await this.handleCompletion(channel)

      this.state = 'completed'
    } catch (error) {
      this.state = 'failed'
      throw error
    } finally {
      this.resources.cleanup()
    }
  }

  abort(): void {
    this.aborted = true
    this.state = 'failed'
  }

  private async waitForChannelOpen(channel: RTCDataChannel): Promise<void> {
    if (channel.readyState === 'open') return

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Channel open timeout'))
      }, HANDSHAKE_TIMEOUT)

      const openHandler = () => {
        clearTimeout(timeout)
        resolve()
      }

      const errorHandler = () => {
        clearTimeout(timeout)
        reject(new Error('Channel error'))
      }

      channel.addEventListener('open', openHandler, { once: true })
      channel.addEventListener('error', errorHandler, { once: true })

      this.resources.add(() => {
        clearTimeout(timeout)
        channel.removeEventListener('open', openHandler)
        channel.removeEventListener('error', errorHandler)
      })
    })
  }

  private async performHandshake(channel: RTCDataChannel): Promise<void> {
    // Send start message
    const startMsg: StartMessage = {
      type: 'start',
      totalChunks: this.totalChunks,
      fileSize: this.fileSize,
      chunkSize: CHUNK_SIZE
    }
    channel.send(JSON.stringify(startMsg))

    // Setup message handler for handshake
    let receiverReady = false
    let resumeReceived = false
    let receiverHasPartialData = false

    const messageHandler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return

      try {
        const msg = JSON.parse(event.data) as TransferMessage

        if (msg.type === 'start') {
          receiverHasPartialData = msg.hasPartialData || false
          receiverReady = true
        } else if (msg.type === 'resume') {
          msg.receivedChunks.forEach(idx => this.receivedChunksSet.add(idx))

          // Calculate next chunk
          let nextChunk = 0
          while (nextChunk < this.totalChunks && this.receivedChunksSet.has(nextChunk)) {
            nextChunk++
          }
          this.confirmedNextChunk = nextChunk
          resumeReceived = true
        } else if (msg.type === 'ack') {
          if (msg.nextChunkIndex > this.confirmedNextChunk) {
            this.confirmedNextChunk = msg.nextChunkIndex
          }
        }
      } catch (error) {
        console.warn('[Sender] Message parse error:', error)
      }
    }

    channel.addEventListener('message', messageHandler)
    this.resources.add(() => channel.removeEventListener('message', messageHandler))

    // Wait for receiver ready
    const startWaitStart = Date.now()
    while (!receiverReady && Date.now() - startWaitStart < HANDSHAKE_TIMEOUT) {
      this.checkAbort()
      await this.sleep(50)
    }

    if (!receiverReady) {
      throw new Error('Handshake timeout: receiver not ready')
    }

    // Wait for resume info if receiver has partial data
    if (receiverHasPartialData) {
      const resumeWaitStart = Date.now()
      while (!resumeReceived && Date.now() - resumeWaitStart < RESUME_INFO_TIMEOUT) {
        this.checkAbort()
        await this.sleep(50)
      }

      if (resumeReceived) {
        console.log(`[Sender] Resume from chunk ${this.confirmedNextChunk}`)
      }
    }
  }

  private async transferChunks(channel: RTCDataChannel): Promise<void> {
    this.currentChunkIndex = this.confirmedNextChunk
    const ackHandler = this.createAckHandler(channel)

    try {
      while (this.currentChunkIndex < this.totalChunks) {
        this.checkAbort()
        this.checkTimeout()

        // Skip already received chunks
        if (this.receivedChunksSet.has(this.currentChunkIndex)) {
          this.currentChunkIndex++
          this.updateProgressUI()
          continue
        }

        // Flow control: ACK-based backpressure
        await this.waitForAck(channel, this.currentChunkIndex)

        // Flow control: Buffer management
        await this.waitForBuffer(channel)

        // Send chunk
        await this.sendChunk(channel, this.currentChunkIndex)
        this.currentChunkIndex++

        // Update progress
        this.lastProgressTime = Date.now()
        this.updateProgressUI()

        // Periodic ACK request
        if (Date.now() - this.lastAckRequestTime > ACK_REQUEST_INTERVAL) {
          this.requestAck(channel)
          this.lastAckRequestTime = Date.now()
        }
      }
    } finally {
      channel.removeEventListener('message', ackHandler)
    }
  }

  private createAckHandler(channel: RTCDataChannel): (event: MessageEvent) => void {
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return

      try {
        const msg = JSON.parse(event.data) as TransferMessage

        if (msg.type === 'ack') {
          if (msg.nextChunkIndex > this.confirmedNextChunk) {
            this.confirmedNextChunk = msg.nextChunkIndex

            // Update received chunks set
            if (msg.lastContinuousIndex >= 0) {
              for (let idx = 0; idx <= msg.lastContinuousIndex; idx++) {
                this.receivedChunksSet.add(idx)
              }
            }
          }
        } else if (msg.type === 'reRequest') {
          const missingChunks = msg.missingChunks
          missingChunks.forEach(idx => this.receivedChunksSet.delete(idx))

          // Backtrack to minimum missing chunk
          const minMissing = Math.min(...missingChunks)
          if (this.confirmedNextChunk > minMissing) {
            this.confirmedNextChunk = minMissing
          }
        }
      } catch (error) {
        console.warn('[Sender] ACK handler error:', error)
      }
    }

    channel.addEventListener('message', handler)
    return handler
  }

  private async waitForAck(channel: RTCDataChannel, currentChunkIndex: number): Promise<void> {
    const gap = currentChunkIndex - this.confirmedNextChunk

    if (gap < ACK_WINDOW) return

    const waitStart = Date.now()
    while (currentChunkIndex - this.confirmedNextChunk >= ACK_WINDOW) {
      this.checkAbort()

      if (Date.now() - waitStart > ACK_TIMEOUT) {
        // Request ACK and wait
        this.requestAck(channel)
        await this.sleep(1000)

        // If still no progress, backtrack
        if (currentChunkIndex - this.confirmedNextChunk >= ACK_WINDOW) {
          console.warn('[Sender] ACK timeout, backtracking')
          break
        }
      }

      await this.sleep(100)
    }
  }

  private async waitForBuffer(channel: RTCDataChannel): Promise<void> {
    if (channel.bufferedAmount <= MAX_BUFFER_SIZE) return

    const waitStart = Date.now()
    while (channel.bufferedAmount > BUFFER_LOW_WATERMARK) {
      this.checkAbort()

      if (Date.now() - waitStart > TRANSFER_TIMEOUT) {
        throw new Error('Buffer wait timeout')
      }

      await this.sleep(BUFFER_CHECK_INTERVAL)
    }
  }

  private async sendChunk(channel: RTCDataChannel, chunkIndex: number): Promise<void> {
    // Wait for buffer before send
    while (channel.bufferedAmount > BUFFER_CRITICAL) {
      this.checkAbort()
      await this.sleep(20)
    }

    // Slice and send
    const chunkStart = chunkIndex * CHUNK_SIZE
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, this.fileSize)
    const chunkBlob = this.fileBlob.slice(chunkStart, chunkEnd)
    const chunkData = await chunkBlob.arrayBuffer()

    // Combine index + data
    const combinedBuffer = new ArrayBuffer(4 + chunkData.byteLength)
    const view = new DataView(combinedBuffer)
    view.setUint32(0, chunkIndex, true)
    new Uint8Array(combinedBuffer, 4).set(new Uint8Array(chunkData))

    channel.send(combinedBuffer)
  }

  private async handleCompletion(channel: RTCDataChannel): Promise<void> {
    let retryCount = 0
    let reRequestReceived = false
    let missingChunks: number[] = []

    const reRequestHandler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return

      try {
        const msg = JSON.parse(event.data) as TransferMessage
        if (msg.type === 'reRequest') {
          missingChunks = msg.missingChunks
          reRequestReceived = true
        }
      } catch (error) {
        console.warn('[Sender] ReRequest handler error:', error)
      }
    }

    channel.addEventListener('message', reRequestHandler)
    this.resources.add(() => channel.removeEventListener('message', reRequestHandler))

    while (retryCount < MAX_RETRIES) {
      // Wait for buffer to clear
      while (channel.bufferedAmount > 0) {
        await this.sleep(100)
      }

      // Send complete message
      const completeMsg: CompleteMessage = { type: 'complete' }
      channel.send(JSON.stringify(completeMsg))

      // Wait for reRequest
      reRequestReceived = false
      missingChunks = []
      const waitStart = Date.now()

      while (!reRequestReceived && Date.now() - waitStart < 3000) {
        this.checkAbort()
        await this.sleep(100)

        if (channel.readyState !== 'open') break
      }

      // No reRequest means success
      if (!reRequestReceived || missingChunks.length === 0) {
        console.log('[Sender] Transfer completed successfully')
        return
      }

      // Resend missing chunks
      console.log(`[Sender] Resending ${missingChunks.length} chunks`)
      for (const chunkIndex of missingChunks) {
        this.checkAbort()
        await this.sendChunk(channel, chunkIndex)
      }

      retryCount++
    }

    if (retryCount >= MAX_RETRIES) {
      console.warn('[Sender] Max retries reached, forcing completion')
    }
  }

  private requestAck(channel: RTCDataChannel): void {
    if (channel.readyState !== 'open') return

    try {
      const msg: RequestAckMessage = { type: 'request-ack' }
      channel.send(JSON.stringify(msg))
    } catch (error) {
      console.warn('[Sender] ACK request failed:', error)
    }
  }

  private updateProgressUI(): void {
    if (this.onProgress) {
      const sentBytes = Math.min(this.currentChunkIndex * CHUNK_SIZE, this.fileSize)
      this.onProgress(sentBytes, this.fileSize)
    }
  }

  getCurrentProgress(): { sent: number; total: number } {
    const sentBytes = Math.min(this.currentChunkIndex * CHUNK_SIZE, this.fileSize)
    return { sent: sentBytes, total: this.fileSize }
  }

  private checkAbort(): void {
    if (this.aborted || (this.checkCancelled && this.checkCancelled())) {
      throw new Error('Transfer aborted')
    }
  }

  private checkTimeout(): void {
    if (Date.now() - this.lastProgressTime > TRANSFER_TIMEOUT) {
      throw new Error('Transfer timeout')
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ===== 수신자 클래스 =====
class FileReceiver {
  private state: TransferState = 'idle'
  private resources = new ResourceManager()
  private aborted = false
  private lastChunkReceiveTime = Date.now()
  private partialState: {
    fileId: string
    fileName: string
    totalChunks: number
    chunkSize: number
    totalBytes: number
    receivedChunks: Set<number>
    chunks: Map<number, ArrayBuffer>
    timestamp: number
    transferKey: string
  } | null = null
  private pendingChunksBuffer = new Map<number, ArrayBuffer>()
  private isSaving = false

  constructor(
    private offer: FileTransferOffer,
    private transferKey: string
  ) {}

  async receive(channel: RTCDataChannel): Promise<Blob> {
    try {
      this.state = 'handshake'
      await this.loadPartialState()
      await this.waitForChannelOpen(channel)
      await this.performHandshake(channel)

      this.state = 'transferring'
      const blob = await this.receiveChunks(channel)

      this.state = 'completed'
      return blob
    } catch (error) {
      this.state = 'failed'
      throw error
    } finally {
      this.resources.cleanup()
    }
  }

  abort(): void {
    this.aborted = true
    this.state = 'failed'
  }

  private async loadPartialState(): Promise<void> {
    const { loadDownloadState } = useFileTransferState()
    const loaded = await loadDownloadState(this.offer.fileId)

    if (loaded) {
      // Validate chunks
      const validChunks = new Set<number>()
      for (const idx of loaded.receivedChunks) {
        if (loaded.chunks.has(idx)) {
          validChunks.add(idx)
        }
      }

      loaded.receivedChunks = validChunks
      this.partialState = loaded
      console.log(`[Receiver] Resume from ${validChunks.size} chunks`)
    } else {
      // Create new state
      this.partialState = {
        fileId: this.offer.fileId,
        fileName: this.offer.fileId,
        totalChunks: this.offer.totalChunks,
        chunkSize: CHUNK_SIZE,
        totalBytes: this.offer.fileSize,
        receivedChunks: new Set(),
        chunks: new Map(),
        timestamp: Date.now(),
        transferKey: this.transferKey
      }
    }
  }

  private async waitForChannelOpen(channel: RTCDataChannel): Promise<void> {
    if (channel.readyState === 'open') return

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Channel open timeout'))
      }, HANDSHAKE_TIMEOUT)

      const openHandler = () => {
        clearTimeout(timeout)
        resolve()
      }

      const errorHandler = () => {
        clearTimeout(timeout)
        reject(new Error('Channel error'))
      }

      channel.addEventListener('open', openHandler, { once: true })
      channel.addEventListener('error', errorHandler, { once: true })

      this.resources.add(() => {
        clearTimeout(timeout)
        channel.removeEventListener('open', openHandler)
        channel.removeEventListener('error', errorHandler)
      })
    })
  }

  private async performHandshake(channel: RTCDataChannel): Promise<void> {
    if (!this.partialState) throw new Error('State not loaded')

    const hasPartialData = this.partialState.receivedChunks.size > 0

    // Send start response
    const startMsg: StartMessage = {
      type: 'start',
      totalChunks: this.offer.totalChunks,
      fileSize: this.offer.fileSize,
      chunkSize: CHUNK_SIZE,
      hasPartialData
    }
    channel.send(JSON.stringify(startMsg))

    // Send resume info if needed
    if (hasPartialData) {
      const resumeMsg: ResumeMessage = {
        type: 'resume',
        receivedChunks: Array.from(this.partialState.receivedChunks)
      }
      channel.send(JSON.stringify(resumeMsg))
    }
  }

  private async receiveChunks(channel: RTCDataChannel): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      const periodicAck = this.setupPeriodicAck(channel)
      const timeoutChecker = this.setupTimeoutChecker()
      let isResolved = false

      const resolveOnce = async (result: Blob | Error) => {
        if (isResolved) return
        isResolved = true

        clearInterval(periodicAck)
        clearInterval(timeoutChecker)

        // Save pending chunks
        if (this.pendingChunksBuffer.size > 0) {
          await this.saveChunksBatch()
          await this.saveDownloadState()
        }

        if (result instanceof Error) {
          reject(result)
        } else {
          resolve(result)
        }
      }

      const messageHandler = async (event: MessageEvent) => {
        this.lastChunkReceiveTime = Date.now()

        if (typeof event.data === 'string') {
          await this.handleControlMessage(event.data, channel, resolveOnce)
        } else if (event.data instanceof ArrayBuffer) {
          await this.handleChunkData(event.data, channel)
        }
      }

      const errorHandler = async () => {
        await resolveOnce(new Error('Channel error'))
      }

      const closeHandler = async () => {
        if (!this.isComplete()) {
          await resolveOnce(new Error('Channel closed before completion'))
        }
      }

      channel.addEventListener('message', messageHandler)
      channel.addEventListener('error', errorHandler)
      channel.addEventListener('close', closeHandler)

      this.resources.add(() => {
        channel.removeEventListener('message', messageHandler)
        channel.removeEventListener('error', errorHandler)
        channel.removeEventListener('close', closeHandler)
      })
    })
  }

  private setupPeriodicAck(channel: RTCDataChannel): number {
    const interval = setInterval(() => {
      if (this.state === 'completed' || channel.readyState !== 'open') return

      if (Date.now() - this.lastChunkReceiveTime > 1000) {
        this.sendAck(channel)
      }
    }, PERIODIC_ACK_INTERVAL)

    this.resources.add(() => clearInterval(interval))
    return interval
  }

  private setupTimeoutChecker(): number {
    const interval = setInterval(() => {
      if (this.state === 'completed') return

      if (Date.now() - this.lastChunkReceiveTime > RECEIVE_TIMEOUT) {
        console.error('[Receiver] Receive timeout')
        this.abort()
      }
    }, 5000)

    this.resources.add(() => clearInterval(interval))
    return interval
  }

  private async handleControlMessage(
    data: string,
    channel: RTCDataChannel,
    resolveOnce: (result: Blob | Error) => Promise<void>
  ): Promise<void> {
    try {
      const msg = JSON.parse(data) as TransferMessage

      if (msg.type === 'start') {
        // Already handled in handshake
      } else if (msg.type === 'request-ack') {
        this.sendAck(channel)
      } else if (msg.type === 'complete') {
        await this.handleComplete(channel, resolveOnce)
      } else if (msg.type === 'error') {
        await resolveOnce(new Error(msg.message))
      }
    } catch (error) {
      console.warn('[Receiver] Control message error:', error)
    }
  }

  private async handleChunkData(buffer: ArrayBuffer, channel: RTCDataChannel): Promise<void> {
    if (!this.partialState) return
    if (buffer.byteLength < 5) return

    // Extract index
    const view = new DataView(buffer)
    const chunkIndex = view.getUint32(0, true)

    if (chunkIndex < 0 || chunkIndex >= this.offer.totalChunks) {
      console.warn(`[Receiver] Invalid chunk index: ${chunkIndex}`)
      return
    }

    // Check duplicate
    const isDuplicate = this.partialState.receivedChunks.has(chunkIndex)

    if (!isDuplicate) {
      // Extract data
      const chunkData = buffer.slice(4)

      // Update state
      this.partialState.receivedChunks.add(chunkIndex)
      this.partialState.timestamp = Date.now()
      this.pendingChunksBuffer.set(chunkIndex, chunkData)

      // Periodic save
      if (this.partialState.receivedChunks.size % DB_SAVE_META_INTERVAL === 0 && !this.isSaving) {
        this.isSaving = true
        this.saveDownloadState().finally(() => {
          this.isSaving = false
        })
      }

      // Batch save
      if (this.pendingChunksBuffer.size >= DB_SAVE_CHUNK_INTERVAL && !this.isSaving) {
        this.isSaving = true
        const chunksToSave = new Map(this.pendingChunksBuffer)
        this.pendingChunksBuffer.clear()

        Promise.all([
          this.saveChunksBatch(chunksToSave),
          this.saveDownloadState()
        ]).finally(() => {
          this.isSaving = false
        })
      }
    }

    // Always send ACK
    this.sendAck(channel)
  }

  private async handleComplete(
    channel: RTCDataChannel,
    resolveOnce: (result: Blob | Error) => Promise<void>
  ): Promise<void> {
    // Final save
    if (this.pendingChunksBuffer.size > 0) {
      await this.saveChunksBatch()
      await this.saveDownloadState()
    }

    // Reload full state
    const { loadDownloadState } = useFileTransferState()
    const fullState = await loadDownloadState(this.offer.fileId)

    if (!fullState) {
      await resolveOnce(new Error('Failed to load state'))
      return
    }

    // Find missing chunks
    const missingChunks: number[] = []
    for (let i = 0; i < this.offer.totalChunks; i++) {
      if (!fullState.chunks.has(i)) {
        missingChunks.push(i)
        if (this.partialState) {
          this.partialState.receivedChunks.delete(i)
        }
      }
    }

    // Request missing chunks
    if (missingChunks.length > 0 && channel.readyState === 'open') {
      console.log(`[Receiver] Requesting ${missingChunks.length} missing chunks`)
      await this.saveDownloadState()

      const reRequestMsg: ReRequestMessage = {
        type: 'reRequest',
        missingChunks
      }
      channel.send(JSON.stringify(reRequestMsg))
      return
    }

    // Create blob
    const chunks: ArrayBuffer[] = []
    for (let i = 0; i < this.offer.totalChunks; i++) {
      const chunk = fullState.chunks.get(i)
      if (chunk) {
        chunks.push(chunk)
      }
    }

    const blob = new Blob(chunks)

    // Cache and cleanup
    await cacheFile(this.offer.fileId, blob)
    const { deleteDownloadState } = useFileTransferState()
    await deleteDownloadState(this.offer.fileId)

    await resolveOnce(blob)
  }

  private sendAck(channel: RTCDataChannel): void {
    if (!this.partialState || channel.readyState !== 'open') return

    try {
      let nextChunkIndex = 0
      while (nextChunkIndex < this.offer.totalChunks && this.partialState.receivedChunks.has(nextChunkIndex)) {
        nextChunkIndex++
      }

      const ackMsg: AckMessage = {
        type: 'ack',
        receivedCount: this.partialState.receivedChunks.size,
        nextChunkIndex,
        lastContinuousIndex: nextChunkIndex - 1
      }

      channel.send(JSON.stringify(ackMsg))
    } catch (error) {
      console.warn('[Receiver] ACK send failed:', error)
    }
  }

  private isComplete(): boolean {
    return this.partialState?.receivedChunks.size === this.offer.totalChunks
  }

  private async saveChunksBatch(chunks?: Map<number, ArrayBuffer>): Promise<void> {
    const { saveChunksBatch } = useFileTransferState()
    await saveChunksBatch(this.offer.fileId, chunks || this.pendingChunksBuffer)
  }

  private async saveDownloadState(): Promise<void> {
    if (!this.partialState) return
    const { saveDownloadState } = useFileTransferState()
    await saveDownloadState(this.partialState)
  }

  getCurrentProgress(): { received: number; total: number } {
    if (!this.partialState) return { received: 0, total: this.offer.fileSize }
    const receivedBytes = Math.min(this.partialState.receivedChunks.size * CHUNK_SIZE, this.offer.fileSize)
    return { received: receivedBytes, total: this.offer.fileSize }
  }
}

// ===== Main Composable =====
export function useDirectFileTransfer(
  provider: WebrtcProvider,
  myUuid: string,
  files: Map<string, FileMeta>
) {
  const {
    createOffer,
    createAnswer,
    cleanup,
    cancelTransfer,
    getConnectionId,
    activeChannels
  } = useWebrtcConnection(provider, myUuid)

  const { startTransfer, updateProgress, completeTransfer, cancelTransfer: cancelProgress } =
    useFileTransferProgress()

  const { enqueue, registerDataChannel, unregisterDataChannel } = useGlobalDataChannelQueue()

  const activeTransfers = new Map<string, FileSender | FileReceiver>()

  // Register existing channels
  activeChannels.value.forEach((channel, connectionId) => {
    const userIndex = connectionId.lastIndexOf('-user-')
    if (userIndex !== -1) {
      const peerId = connectionId.substring(userIndex + 1)
      registerDataChannel(peerId, channel)
    }
  })

  async function sendFileViaQueue(fileId: string, targetUuid: string): Promise<void> {
    const transferKey = `${fileId}-${targetUuid}`

    if (activeTransfers.has(transferKey)) {
      console.warn('[Transfer] Already active:', transferKey)
      return
    }

    const cachedBlob = await getCachedFile(fileId)
    if (!cachedBlob) {
      throw new Error('File not found')
    }

    const meta = files.get(fileId)
    const fileSize = cachedBlob.size

    // Determine priority
    let priority = DataChannelPriority.NORMAL
    if (fileSize < 100 * 1024) {
      priority = DataChannelPriority.HIGH
    } else if (fileSize > 10 * 1024 * 1024) {
      priority = DataChannelPriority.LOW
    }

    const job = createFileTransferJob(
      fileId,
      meta?.name || fileId,
      targetUuid,
      fileSize,
      priority,
      async (onProgress, checkCancelled) => {
        await sendFileDirectInternal(fileId, targetUuid, cachedBlob, onProgress, checkCancelled)
      }
    )

    enqueue(job)
  }

  async function sendFileDirectInternal(
    fileId: string,
    targetUuid: string,
    fileBlob: Blob,
    onProgress?: (sent: number, total: number) => void,
    checkCancelled?: () => boolean
  ): Promise<void> {
    const connectionId = getConnectionId(fileId, targetUuid)
    const transferKey = `${fileId}-${targetUuid}`
    const fileSize = fileBlob.size
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)

    const sender = new FileSender(
      fileId,
      targetUuid,
      fileBlob,
      totalChunks,
      fileSize,
      transferKey,
      onProgress,
      checkCancelled
    )

    activeTransfers.set(transferKey, sender)

    try {
      const meta = files.get(fileId)
      startTransfer(transferKey, meta?.name || fileId, 'upload', totalChunks, fileSize, false)

      const channel = await createOffer(fileId, targetUuid, totalChunks, fileSize)

      // Progress updater
      const progressInterval = setInterval(() => {
        const progress = sender.getCurrentProgress()
        updateProgress(transferKey, Math.floor(progress.sent / CHUNK_SIZE), false, progress.sent)
      }, 1000)

      try {
        await sender.send(channel)
        completeTransfer(transferKey)
        console.log('[Transfer] Send completed:', transferKey)
      } finally {
        clearInterval(progressInterval)
      }

      // Wait for channel close
      if (channel.readyState !== 'closed') {
        await new Promise<void>(resolve => {
          const closeHandler = () => {
            channel.removeEventListener('close', closeHandler)
            resolve()
          }
          channel.addEventListener('close', closeHandler)
          setTimeout(resolve, 5000)
        })
      }

      unregisterDataChannel(targetUuid)
      cleanup(connectionId)
    } catch (error) {
      console.error('[Transfer] Send failed:', error)
      cancelProgress(transferKey)
      unregisterDataChannel(targetUuid)
      cancelTransfer(fileId, targetUuid, error instanceof Error ? error.message : 'Unknown error')
      throw error
    } finally {
      activeTransfers.delete(transferKey)
    }
  }

  async function receiveFileDirect(offer: FileTransferOffer): Promise<Blob> {
    const connectionId = getConnectionId(offer.fileId, offer.senderUuid)
    const transferKey = offer.fileId

    if (activeTransfers.has(transferKey)) {
      throw new Error('Already receiving')
    }

    const receiver = new FileReceiver(offer, transferKey)
    activeTransfers.set(transferKey, receiver)

    try {
      const meta = files.get(offer.fileId)

      // Check if already complete
      const { loadDownloadState, isComplete, deleteDownloadState } = useFileTransferState()
      const partialState = await loadDownloadState(offer.fileId)

      if (partialState && isComplete(partialState)) {
        console.log('[Transfer] Already completed, loading from cache')

        const chunks: ArrayBuffer[] = []
        let hasAllChunks = true

        for (let i = 0; i < offer.totalChunks; i++) {
          const chunk = partialState.chunks.get(i)
          if (!chunk) {
            hasAllChunks = false
            partialState.receivedChunks.delete(i)
          } else {
            chunks.push(chunk)
          }
        }

        if (hasAllChunks) {
          const blob = new Blob(chunks, { type: meta?.type || 'application/octet-stream' })
          await cacheFile(offer.fileId, blob)
          await deleteDownloadState(offer.fileId)
          activeTransfers.delete(transferKey)
          return blob
        }
      }

      startTransfer(transferKey, meta?.name || offer.fileId, 'download', offer.totalChunks, offer.fileSize, !!partialState)

      const channel = await createAnswer(offer)

      // Progress updater
      const progressInterval = setInterval(() => {
        const progress = receiver.getCurrentProgress()
        const chunkCount = Math.floor(progress.received / CHUNK_SIZE)
        updateProgress(transferKey, chunkCount, false, progress.received)
      }, 1000)

      try {
        const blob = await receiver.receive(channel)
        completeTransfer(transferKey)
        console.log('[Transfer] Receive completed:', transferKey)
        return blob
      } finally {
        clearInterval(progressInterval)
      }
    } catch (error) {
      console.error('[Transfer] Receive failed:', error)
      cancelProgress(transferKey)
      throw error
    } finally {
      cleanup(connectionId)
      activeTransfers.delete(transferKey)
    }
  }

  return {
    sendFileViaQueue,
    receiveFileDirect,
    activeTransfers
  }
}
