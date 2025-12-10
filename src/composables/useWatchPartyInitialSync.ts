/**
 * useWatchPartyInitialSync
 *
 * WatchParty 전용 초기 동기화 composable
 * 시그널링 서버를 통해 WebRTC 연결을 수립하고,
 * 브라우저 간 직접 DataChannel로 Y.Doc 스냅샷 전송
 *
 * Based on useInitialSync.v3.ts patterns
 */

import * as Y from 'yjs'
import type { useSignalingServer } from './useSignalingServer'

// ===== Constants =====
const CHUNK_SIZE = 32 * 1024 // 32KB
const MAX_BUFFER_SIZE = 4 * 1024 * 1024 // 4MB
const BUFFER_LOW_WATERMARK = 512 * 1024 // 512KB
const BUFFER_CRITICAL = 128 * 1024 // 128KB
const ACK_WINDOW = 10 // 청크 단위
const ACK_TIMEOUT = 5000 // ms
const PERIODIC_ACK_INTERVAL = 4000 // ms
const BUFFER_CHECK_INTERVAL = 100 // ms
const HANDSHAKE_TIMEOUT = 5000 // ms
const TRANSFER_TIMEOUT = 5 * 60 * 1000 // 5분
const RECEIVE_TIMEOUT = 30000 // 30초
const REQUEST_TIMEOUT = 5000 // 요청 응답 대기
const MAX_RETRIES = 3

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.gongbbu.com:3478', username: 'gongbbu', credential: 'gongbbu' },
  { urls: 'turns:turn.gongbbu.com:5349', username: 'gongbbu', credential: 'gongbbu' },
]

// ===== Types =====
/**
 * 시그널링 메시지 타입 (시그널링 서버를 통해서만 전송)
 */
type WPSyncRequestMessage = {
  messageType: 'wp-sync-request'
  requesterUuid: string
  timestamp: number
}

type WPSyncOfferMessage = {
  messageType: 'wp-sync-offer'
  senderUuid: string
  targetUuid: string
  totalChunks: number
  snapshotSize: number
  sdp: RTCSessionDescriptionInit
  timestamp: number
}

type WPSyncAnswerMessage = {
  messageType: 'wp-sync-answer'
  receiverUuid: string
  targetUuid: string
  sdp: RTCSessionDescriptionInit
  timestamp: number
}

type WPSyncIceMessage = {
  messageType: 'wp-sync-ice'
  fromUuid: string
  toUuid: string
  candidate: RTCIceCandidateInit
  timestamp: number
}

type SignalingMessage = WPSyncRequestMessage | WPSyncOfferMessage | WPSyncAnswerMessage | WPSyncIceMessage

/**
 * DataChannel 메시지 타입 (브라우저 간 직접 전송)
 */
type StartMessage = {
  type: 'start'
  totalChunks: number
  snapshotSize: number
  chunkSize: number
}

type CompleteMessage = { type: 'complete' }
type ErrorMessage = { type: 'error'; message: string }
type AckMessage = {
  type: 'ack'
  receivedCount: number
  nextChunkIndex: number
  lastContinuousIndex: number
}
type RequestAckMessage = { type: 'request-ack' }
type ReRequestMessage = { type: 'reRequest'; missingChunks: number[] }

type TransferMessage =
  | StartMessage
  | CompleteMessage
  | ErrorMessage
  | AckMessage
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
        console.warn('[WPInitialSync:ResourceManager] Cleanup error:', error)
      }
    })
    this.cleanupFns = []
  }
}

// ===== 송신자 클래스 =====
class SnapshotSender {
  private state: TransferState = 'idle'
  private resources = new ResourceManager()
  private aborted = false
  private confirmedNextChunk = 0
  private lastProgressTime = Date.now()
  private lastAckRequestTime = Date.now()
  private currentChunkIndex = 0

  constructor(
    private snapshot: Uint8Array,
    private totalChunks: number,
    private snapshotSize: number
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
    const startMsg: StartMessage = {
      type: 'start',
      totalChunks: this.totalChunks,
      snapshotSize: this.snapshotSize,
      chunkSize: CHUNK_SIZE
    }
    channel.send(JSON.stringify(startMsg))

    // Setup message handler for ACK
    const messageHandler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return

      try {
        const msg = JSON.parse(event.data) as TransferMessage

        if (msg.type === 'start') {
          // Receiver ready
        } else if (msg.type === 'ack') {
          if (msg.nextChunkIndex > this.confirmedNextChunk) {
            this.confirmedNextChunk = msg.nextChunkIndex
          }
        }
      } catch (error) {
        console.warn('[WPInitialSync:Sender] Message parse error:', error)
      }
    }

    channel.addEventListener('message', messageHandler)
    this.resources.add(() => channel.removeEventListener('message', messageHandler))

    // Wait a bit for receiver to process start message
    await this.sleep(100)
  }

  private async transferChunks(channel: RTCDataChannel): Promise<void> {
    this.currentChunkIndex = this.confirmedNextChunk
    const ackHandler = this.createAckHandler(channel)

    try {
      while (this.currentChunkIndex < this.totalChunks) {
        this.checkAbort()
        this.checkTimeout()

        // Flow control: ACK-based backpressure
        await this.waitForAck(channel, this.currentChunkIndex)

        // Flow control: Buffer management
        await this.waitForBuffer(channel)

        // Send chunk
        await this.sendChunk(channel, this.currentChunkIndex)
        this.currentChunkIndex++

        // Update progress
        this.lastProgressTime = Date.now()

        if ((this.currentChunkIndex % 50 === 0) || this.currentChunkIndex === this.totalChunks) {
          const progress = ((this.currentChunkIndex / this.totalChunks) * 100).toFixed(0)
          console.log(`[WPInitialSync:Sender] Progress: ${this.currentChunkIndex}/${this.totalChunks} (${progress}%)`)
        }

        // Periodic ACK request
        if (Date.now() - this.lastAckRequestTime > PERIODIC_ACK_INTERVAL) {
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
          }
        } else if (msg.type === 'reRequest') {
          // Backtrack to minimum missing chunk
          const minMissing = Math.min(...msg.missingChunks)
          if (this.confirmedNextChunk > minMissing) {
            this.confirmedNextChunk = minMissing
          }
        }
      } catch (error) {
        console.warn('[WPInitialSync:Sender] ACK handler error:', error)
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
        this.requestAck(channel)
        await this.sleep(1000)

        if (currentChunkIndex - this.confirmedNextChunk >= ACK_WINDOW) {
          console.warn('[WPInitialSync:Sender] ACK timeout, backtracking')
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
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, this.snapshotSize)
    const chunkData = this.snapshot.slice(chunkStart, chunkEnd)

    // Combine index + data
    const combinedBuffer = new ArrayBuffer(4 + chunkData.byteLength)
    const view = new DataView(combinedBuffer)
    view.setUint32(0, chunkIndex, true)
    new Uint8Array(combinedBuffer, 4).set(chunkData)

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
        console.warn('[WPInitialSync:Sender] ReRequest handler error:', error)
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
        console.log('[WPInitialSync:Sender] Transfer completed successfully')
        return
      }

      // Resend missing chunks
      console.log(`[WPInitialSync:Sender] Resending ${missingChunks.length} chunks`)
      for (const chunkIndex of missingChunks) {
        this.checkAbort()
        await this.sendChunk(channel, chunkIndex)
      }

      retryCount++
    }

    if (retryCount >= MAX_RETRIES) {
      console.warn('[WPInitialSync:Sender] Max retries reached, forcing completion')
    }
  }

  private requestAck(channel: RTCDataChannel): void {
    if (channel.readyState !== 'open') return

    try {
      const msg: RequestAckMessage = { type: 'request-ack' }
      channel.send(JSON.stringify(msg))
    } catch (error) {
      console.warn('[WPInitialSync:Sender] ACK request failed:', error)
    }
  }

  private checkAbort(): void {
    if (this.aborted) {
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
class SnapshotReceiver {
  private state: TransferState = 'idle'
  private resources = new ResourceManager()
  private aborted = false
  private lastChunkReceiveTime = Date.now()
  private receivedChunks = new Map<number, ArrayBuffer>()
  private expectedTotalChunks = 0
  private expectedSnapshotSize = 0

  constructor() {}

  async receive(channel: RTCDataChannel): Promise<Uint8Array> {
    try {
      this.state = 'handshake'
      await this.waitForChannelOpen(channel)
      await this.performHandshake(channel)

      this.state = 'transferring'
      const snapshot = await this.receiveChunks(channel)

      this.state = 'completed'
      return snapshot
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
    // Wait for start message
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout'))
      }, HANDSHAKE_TIMEOUT)

      const messageHandler = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return

        try {
          const msg = JSON.parse(event.data) as TransferMessage

          if (msg.type === 'start') {
            this.expectedTotalChunks = msg.totalChunks
            this.expectedSnapshotSize = msg.snapshotSize

            // Send start response
            const response: StartMessage = {
              type: 'start',
              totalChunks: msg.totalChunks,
              snapshotSize: msg.snapshotSize,
              chunkSize: CHUNK_SIZE
            }
            channel.send(JSON.stringify(response))

            clearTimeout(timeout)
            channel.removeEventListener('message', messageHandler)
            resolve()
          }
        } catch (error) {
          console.warn('[WPInitialSync:Receiver] Handshake message parse error:', error)
        }
      }

      channel.addEventListener('message', messageHandler)

      this.resources.add(() => {
        clearTimeout(timeout)
        channel.removeEventListener('message', messageHandler)
      })
    })
  }

  private async receiveChunks(channel: RTCDataChannel): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const periodicAck = this.setupPeriodicAck(channel)
      const timeoutChecker = this.setupTimeoutChecker()
      let isResolved = false

      const resolveOnce = (result: Uint8Array | Error) => {
        if (isResolved) return
        isResolved = true

        clearInterval(periodicAck)
        clearInterval(timeoutChecker)

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

      const errorHandler = () => {
        resolveOnce(new Error('Channel error'))
      }

      const closeHandler = () => {
        if (!this.isComplete()) {
          resolveOnce(new Error('Channel closed before completion'))
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
        console.error('[WPInitialSync:Receiver] Receive timeout')
        this.abort()
      }
    }, 5000)

    this.resources.add(() => clearInterval(interval))
    return interval
  }

  private async handleControlMessage(
    data: string,
    channel: RTCDataChannel,
    resolveOnce: (result: Uint8Array | Error) => void
  ): Promise<void> {
    try {
      const msg = JSON.parse(data) as TransferMessage

      if (msg.type === 'request-ack') {
        this.sendAck(channel)
      } else if (msg.type === 'complete') {
        await this.handleComplete(channel, resolveOnce)
      } else if (msg.type === 'error') {
        resolveOnce(new Error(msg.message))
      }
    } catch (error) {
      console.warn('[WPInitialSync:Receiver] Control message error:', error)
    }
  }

  private async handleChunkData(buffer: ArrayBuffer, channel: RTCDataChannel): Promise<void> {
    if (buffer.byteLength < 5) return

    // Extract index
    const view = new DataView(buffer)
    const chunkIndex = view.getUint32(0, true)

    if (chunkIndex < 0 || chunkIndex >= this.expectedTotalChunks) {
      console.warn(`[WPInitialSync:Receiver] Invalid chunk index: ${chunkIndex}`)
      return
    }

    // Check duplicate
    const isDuplicate = this.receivedChunks.has(chunkIndex)

    if (!isDuplicate) {
      // Extract data
      const chunkData = buffer.slice(4)
      this.receivedChunks.set(chunkIndex, chunkData)

      if ((this.receivedChunks.size % 50 === 0) || this.receivedChunks.size === this.expectedTotalChunks) {
        const progress = ((this.receivedChunks.size / this.expectedTotalChunks) * 100).toFixed(0)
        console.log(`[WPInitialSync:Receiver] Progress: ${this.receivedChunks.size}/${this.expectedTotalChunks} (${progress}%)`)
      }
    }

    // Always send ACK
    this.sendAck(channel)
  }

  private async handleComplete(
    channel: RTCDataChannel,
    resolveOnce: (result: Uint8Array | Error) => void
  ): Promise<void> {
    // Find missing chunks
    const missingChunks: number[] = []
    for (let i = 0; i < this.expectedTotalChunks; i++) {
      if (!this.receivedChunks.has(i)) {
        missingChunks.push(i)
      }
    }

    // Request missing chunks
    if (missingChunks.length > 0 && channel.readyState === 'open') {
      console.log(`[WPInitialSync:Receiver] Requesting ${missingChunks.length} missing chunks`)

      const reRequestMsg: ReRequestMessage = {
        type: 'reRequest',
        missingChunks
      }
      channel.send(JSON.stringify(reRequestMsg))
      return
    }

    // Merge chunks
    try {
      const merged = new Uint8Array(this.expectedSnapshotSize)
      let offset = 0

      for (let i = 0; i < this.expectedTotalChunks; i++) {
        const chunk = this.receivedChunks.get(i)
        if (!chunk) {
          throw new Error(`Chunk ${i} missing`)
        }
        merged.set(new Uint8Array(chunk), offset)
        offset += chunk.byteLength
      }

      const finalSnapshot = offset === this.expectedSnapshotSize ? merged : merged.slice(0, offset)

      console.log('[WPInitialSync:Receiver] Snapshot merged successfully')
      resolveOnce(finalSnapshot)
    } catch (error) {
      console.error('[WPInitialSync:Receiver] Snapshot merge failed:', error)
      resolveOnce(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private sendAck(channel: RTCDataChannel): void {
    if (channel.readyState !== 'open') return

    try {
      let nextChunkIndex = 0
      while (nextChunkIndex < this.expectedTotalChunks && this.receivedChunks.has(nextChunkIndex)) {
        nextChunkIndex++
      }

      const ackMsg: AckMessage = {
        type: 'ack',
        receivedCount: this.receivedChunks.size,
        nextChunkIndex,
        lastContinuousIndex: nextChunkIndex - 1
      }

      channel.send(JSON.stringify(ackMsg))
    } catch (error) {
      console.warn('[WPInitialSync:Receiver] ACK send failed:', error)
    }
  }

  private isComplete(): boolean {
    return this.receivedChunks.size === this.expectedTotalChunks
  }
}

// ===== WebRTC 연결 관리 클래스 =====
class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null
  private dataChannel: RTCDataChannel | null = null
  private pendingIceCandidates: RTCIceCandidateInit[] = []
  private resources = new ResourceManager()

  constructor(
    private signaling: ReturnType<typeof useSignalingServer>,
    private myUuid: string,
    private targetUuid: string,
    private syncTopic: string
  ) {}

  async createOfferConnection(onChannelOpen: (channel: RTCDataChannel) => void): Promise<void> {
    this.peerConnection = this.createPeerConnection()

    // Create DataChannel
    this.dataChannel = this.peerConnection.createDataChannel('wp-initial-sync', {
      ordered: true,
      maxRetransmits: 3
    })

    this.dataChannel.onopen = () => {
      console.log('[WPInitialSync:WebRTC] DataChannel opened')
      if (this.dataChannel) {
        onChannelOpen(this.dataChannel)
      }
    }

    this.dataChannel.onerror = (error) => {
      console.error('[WPInitialSync:WebRTC] DataChannel error:', error)
    }

    this.dataChannel.onclose = () => {
      console.log('[WPInitialSync:WebRTC] DataChannel closed')
    }

    // Create offer
    const offer = await this.peerConnection.createOffer()
    await this.peerConnection.setLocalDescription(offer)

    // Send offer via signaling
    const offerMessage: WPSyncOfferMessage = {
      messageType: 'wp-sync-offer',
      senderUuid: this.myUuid,
      targetUuid: this.targetUuid,
      totalChunks: 0, // Will be set by sender
      snapshotSize: 0, // Will be set by sender
      sdp: offer,
      timestamp: Date.now()
    }

    this.signaling.publish(this.syncTopic, offerMessage as unknown as Record<string, unknown>)
    console.log('[WPInitialSync:WebRTC] Offer sent')
  }

  async createAnswerConnection(
    offer: WPSyncOfferMessage,
    onChannelReceived: (channel: RTCDataChannel) => void
  ): Promise<void> {
    this.peerConnection = this.createPeerConnection()

    // Handle incoming DataChannel
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel
      console.log('[WPInitialSync:WebRTC] DataChannel received')

      this.dataChannel.onopen = () => {
        console.log('[WPInitialSync:WebRTC] DataChannel opened')
        if (this.dataChannel) {
          onChannelReceived(this.dataChannel)
        }
      }

      this.dataChannel.onerror = (error) => {
        console.error('[WPInitialSync:WebRTC] DataChannel error:', error)
      }

      this.dataChannel.onclose = () => {
        console.log('[WPInitialSync:WebRTC] DataChannel closed')
      }
    }

    // Set remote description
    await this.peerConnection.setRemoteDescription(offer.sdp)

    // Create answer
    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)

    // Send answer via signaling
    const answerMessage: WPSyncAnswerMessage = {
      messageType: 'wp-sync-answer',
      receiverUuid: this.myUuid,
      targetUuid: offer.senderUuid,
      sdp: answer,
      timestamp: Date.now()
    }

    this.signaling.publish(this.syncTopic, answerMessage as unknown as Record<string, unknown>)
    console.log('[WPInitialSync:WebRTC] Answer sent')

    // Add pending ICE candidates
    this.addPendingIceCandidates()
  }

  async handleAnswer(answer: WPSyncAnswerMessage): Promise<void> {
    if (!this.peerConnection) {
      console.warn('[WPInitialSync:WebRTC] No peer connection for answer')
      return
    }

    await this.peerConnection.setRemoteDescription(answer.sdp)
    console.log('[WPInitialSync:WebRTC] Answer processed')

    // Add pending ICE candidates
    this.addPendingIceCandidates()
  }

  handleIceCandidate(candidate: RTCIceCandidateInit): void {
    if (this.peerConnection && this.peerConnection.remoteDescription) {
      this.peerConnection.addIceCandidate(candidate).catch(console.error)
    } else {
      this.pendingIceCandidates.push(candidate)
    }
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const iceMessage: WPSyncIceMessage = {
          messageType: 'wp-sync-ice',
          fromUuid: this.myUuid,
          toUuid: this.targetUuid,
          candidate: event.candidate.toJSON(),
          timestamp: Date.now()
        }
        this.signaling.publish(this.syncTopic, iceMessage as unknown as Record<string, unknown>)
      }
    }

    pc.oniceconnectionstatechange = () => {
      console.log(`[WPInitialSync:WebRTC] ICE state: ${pc.iceConnectionState}`)
    }

    pc.onconnectionstatechange = () => {
      console.log(`[WPInitialSync:WebRTC] Connection state: ${pc.connectionState}`)
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.cleanup()
      }
    }

    return pc
  }

  private addPendingIceCandidates(): void {
    if (this.pendingIceCandidates.length > 0) {
      console.log(`[WPInitialSync:WebRTC] Adding ${this.pendingIceCandidates.length} pending ICE candidates`)
      this.pendingIceCandidates.forEach((candidate) => {
        this.peerConnection?.addIceCandidate(candidate).catch(console.error)
      })
      this.pendingIceCandidates.length = 0
    }
  }

  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel
  }

  cleanup(): void {
    if (this.dataChannel) {
      if (this.dataChannel.readyState === 'open') {
        this.dataChannel.close()
      }
      this.dataChannel = null
    }

    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
    }

    this.pendingIceCandidates.length = 0
    this.resources.cleanup()
  }
}

// ===== Main Composable =====
export function useWatchPartyInitialSync(
  signaling: ReturnType<typeof useSignalingServer>,
  myUuid: string,
  doc: Y.Doc,
  roomId: string
) {
  const syncTopic = `watchparty-${roomId}-sync`
  let webrtcManager: WebRTCManager | null = null
  let currentSender: SnapshotSender | null = null
  let currentReceiver: SnapshotReceiver | null = null
  let syncResolve: ((snapshot: Uint8Array | null) => void) | null = null
  let syncReject: ((error: Error) => void) | null = null

  /**
   * 시그널링 메시지 핸들러
   */
  function handleSignalingMessage(message: Record<string, unknown>) {
    const msg = message as unknown as SignalingMessage

    switch (msg.messageType) {
      case 'wp-sync-request':
        handleSyncRequest(msg as WPSyncRequestMessage)
        break
      case 'wp-sync-offer':
        handleSyncOffer(msg as WPSyncOfferMessage)
        break
      case 'wp-sync-answer':
        handleSyncAnswer(msg as WPSyncAnswerMessage)
        break
      case 'wp-sync-ice':
        handleSyncIce(msg as WPSyncIceMessage)
        break
    }
  }

  /**
   * 초기 동기화 요청 (새 접속자)
   */
  async function requestInitialSync(): Promise<Uint8Array | null> {
    console.log('[WPInitialSync] 🔄 Requesting initial sync')
    console.log(`[WPInitialSync] - My UUID: ${myUuid.slice(-8)}`)
    console.log(`[WPInitialSync] - Topic: ${syncTopic}`)

    // Subscribe to topic
    signaling.subscribe([syncTopic])
    signaling.on(syncTopic, handleSignalingMessage)

    // Wait for subscription to propagate
    console.log('[WPInitialSync] ⏳ Waiting for subscription to propagate (1s)...')
    await sleep(1000)

    // Send request
    const request: WPSyncRequestMessage = {
      messageType: 'wp-sync-request',
      requesterUuid: myUuid,
      timestamp: Date.now()
    }

    console.log('[WPInitialSync] 📤 Publishing request')
    signaling.publish(syncTopic, request as unknown as Record<string, unknown>)
    console.log(`[WPInitialSync] ⏳ Waiting for response (timeout: ${REQUEST_TIMEOUT}ms)...`)

    // Wait for offer
    return new Promise<Uint8Array | null>((resolve, reject) => {
      syncResolve = resolve
      syncReject = reject

      const timeoutId = setTimeout(() => {
        if (syncResolve) {
          console.warn('[WPInitialSync] ⏰ Request timeout - starting with empty room')
          cleanup()
          resolve(null)
          syncResolve = null
          syncReject = null
        }
      }, REQUEST_TIMEOUT)

      // Cancel timeout on resolve/reject
      const originalResolve = syncResolve
      const originalReject = syncReject
      syncResolve = (snapshot) => {
        clearTimeout(timeoutId)
        originalResolve?.(snapshot)
      }
      syncReject = (error) => {
        clearTimeout(timeoutId)
        originalReject?.(error)
      }
    })
  }

  /**
   * 동기화 요청 처리 (기존 피어)
   */
  async function handleSyncRequest(request: WPSyncRequestMessage) {
    console.log(`[WPInitialSync] 📥 Sync request received from ${request.requesterUuid.slice(-8)}`)

    if (request.requesterUuid === myUuid) {
      console.log('[WPInitialSync] ↩️ Ignoring own request')
      return
    }

    // Ignore if already handling a transfer
    if (webrtcManager || currentSender) {
      console.warn('[WPInitialSync] ⚠️ Already handling transfer - ignoring request')
      return
    }

    try {
      // Create snapshot
      const snapshot = Y.encodeStateAsUpdate(doc)
      const snapshotSize = snapshot.byteLength

      console.log(`[WPInitialSync] 📦 Snapshot created: ${(snapshotSize / 1024).toFixed(2)}KB`)

      if (snapshotSize === 0) {
        console.warn('[WPInitialSync] ⚠️ Empty snapshot - not responding')
        return
      }

      const totalChunks = Math.ceil(snapshotSize / CHUNK_SIZE)
      console.log(`[WPInitialSync] - Total chunks: ${totalChunks}`)

      // Create sender
      currentSender = new SnapshotSender(snapshot, totalChunks, snapshotSize)

      // Create WebRTC connection
      webrtcManager = new WebRTCManager(signaling, myUuid, request.requesterUuid, syncTopic)

      await webrtcManager.createOfferConnection(async (channel) => {
        try {
          if (currentSender) {
            await currentSender.send(channel)
            console.log('[WPInitialSync] ✅ Transfer completed')
          }
        } catch (error) {
          console.error('[WPInitialSync] ❌ Transfer failed:', error)
        } finally {
          setTimeout(() => {
            cleanup()
          }, 1000)
        }
      })
    } catch (error) {
      console.error('[WPInitialSync] ❌ Failed to handle sync request:', error)
      cleanup()
    }
  }

  /**
   * Offer 처리 (수신자)
   */
  async function handleSyncOffer(offer: WPSyncOfferMessage) {
    console.log(`[WPInitialSync] 📥 Offer received from ${offer.senderUuid.slice(-8)}`)

    if (offer.targetUuid !== myUuid) {
      console.log('[WPInitialSync] ↩️ Ignoring offer for different peer')
      return
    }

    // Ignore if already receiving
    if (webrtcManager || currentReceiver) {
      console.warn('[WPInitialSync] ⚠️ Already receiving - ignoring offer')
      return
    }

    console.log('[WPInitialSync] ✅ Accepting offer')
    console.log(`[WPInitialSync] - Size: ${(offer.snapshotSize / 1024).toFixed(2)}KB`)
    console.log(`[WPInitialSync] - Chunks: ${offer.totalChunks}`)

    try {
      // Create receiver
      currentReceiver = new SnapshotReceiver()

      // Create WebRTC connection
      webrtcManager = new WebRTCManager(signaling, myUuid, offer.senderUuid, syncTopic)

      await webrtcManager.createAnswerConnection(offer, async (channel) => {
        try {
          if (currentReceiver) {
            const snapshot = await currentReceiver.receive(channel)
            console.log('[WPInitialSync] ✅ Snapshot received successfully')

            if (syncResolve) {
              syncResolve(snapshot)
              syncResolve = null
              syncReject = null
            }
          }
        } catch (error) {
          console.error('[WPInitialSync] ❌ Receive failed:', error)
          if (syncReject) {
            syncReject(error instanceof Error ? error : new Error(String(error)))
            syncResolve = null
            syncReject = null
          }
        } finally {
          setTimeout(() => {
            cleanup()
          }, 1000)
        }
      })
    } catch (error) {
      console.error('[WPInitialSync] ❌ Failed to handle offer:', error)
      if (syncReject) {
        syncReject(error instanceof Error ? error : new Error(String(error)))
        syncResolve = null
        syncReject = null
      }
      cleanup()
    }
  }

  /**
   * Answer 처리 (송신자)
   */
  async function handleSyncAnswer(answer: WPSyncAnswerMessage) {
    console.log(`[WPInitialSync] 📥 Answer received from ${answer.receiverUuid.slice(-8)}`)

    if (answer.targetUuid !== myUuid) {
      console.log('[WPInitialSync] ↩️ Ignoring answer for different peer')
      return
    }

    if (!webrtcManager) {
      console.warn('[WPInitialSync] ⚠️ No WebRTC manager - ignoring answer')
      return
    }

    console.log('[WPInitialSync] ✅ Processing answer')

    try {
      await webrtcManager.handleAnswer(answer)
      console.log('[WPInitialSync] ✅ Answer processed successfully')
    } catch (error) {
      console.error('[WPInitialSync] ❌ Failed to process answer:', error)
    }
  }

  /**
   * ICE candidate 처리
   */
  function handleSyncIce(ice: WPSyncIceMessage) {
    if (ice.toUuid !== myUuid) return

    if (webrtcManager) {
      webrtcManager.handleIceCandidate(ice.candidate)
    }
  }

  /**
   * 정리 (연결만 정리, 리스너는 유지)
   */
  function cleanup() {
    console.log('[WPInitialSync] 🧹 Cleaning up connections')

    if (currentSender) {
      currentSender.abort()
      currentSender = null
    }

    if (currentReceiver) {
      currentReceiver.abort()
      currentReceiver = null
    }

    if (webrtcManager) {
      webrtcManager.cleanup()
      webrtcManager = null
    }
  }

  /**
   * 완전 정리 (리스너까지 제거)
   */
  function dispose() {
    console.log('[WPInitialSync] 🗑️ Disposing all resources')
    signaling.off(syncTopic, handleSignalingMessage)
    cleanup()
  }

  /**
   * 기존 피어로 초기화 (요청 리스너 등록)
   */
  function initializeAsProvider() {
    console.log('[WPInitialSync] 📡 Initializing as provider')
    console.log(`[WPInitialSync] - My UUID: ${myUuid.slice(-8)}`)
    console.log(`[WPInitialSync] - Topic: ${syncTopic}`)

    // Subscribe to topic
    signaling.subscribe([syncTopic])
    signaling.on(syncTopic, handleSignalingMessage)

    console.log('[WPInitialSync] ✅ Listener registered - waiting for requests')
  }

  function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  return {
    requestInitialSync,
    initializeAsProvider,
    cleanup,
    dispose
  }
}
