/**
 * useInitialSync v2
 *
 * 시그널링 서버를 통해 직접 초기 상태를 교환
 * y-webrtc를 완전히 우회하여 버퍼 오버플로우 문제 해결
 */

import * as Y from 'yjs'
import type { useSignalingServer } from './useSignalingServer'

const CHUNK_SIZE = 64 * 1024 // 64KB (시그널링 서버용으로 축소)

type SyncRequestMessage = {
  messageType: 'sync-request'
  requesterUuid: string
  timestamp: number
}

type SyncOfferMessage = {
  messageType: 'sync-offer'
  senderUuid: string
  targetUuid: string
  totalChunks: number
  snapshotSize: number
  timestamp: number
}

type SyncChunkMessage = {
  messageType: 'sync-chunk'
  senderUuid: string
  targetUuid: string
  chunkIndex: number
  totalChunks: number
  data: string // base64 encoded
  timestamp: number
}

type SyncCompleteMessage = {
  messageType: 'sync-complete'
  senderUuid: string
  targetUuid: string
  timestamp: number
}

type SyncAckMessage = {
  messageType: 'sync-ack'
  receiverUuid: string
  targetUuid: string
  success: boolean
  message?: string
  timestamp: number
}

type SyncMessage =
  | SyncRequestMessage
  | SyncOfferMessage
  | SyncChunkMessage
  | SyncCompleteMessage
  | SyncAckMessage

/**
 * 초기 동기화 composable (시그널링 서버 기반)
 */
export function useInitialSync(
  signaling: ReturnType<typeof useSignalingServer>,
  myUuid: string,
  doc: Y.Doc,
  roomId: string,
) {
  const syncTopic = `room-${roomId}-sync`

  // 수신 버퍼
  const receivedChunks = new Map<number, ArrayBuffer>()
  let expectedTotalChunks = 0
  let syncResolve: ((snapshot: Uint8Array | null) => void) | null = null
  let syncReject: ((error: Error) => void) | null = null

  /**
   * ArrayBuffer를 base64로 인코딩
   */
  function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      const byte = bytes[i]
      if (byte !== undefined) {
        binary += String.fromCharCode(byte)
      }
    }
    return btoa(binary)
  }

  /**
   * base64를 ArrayBuffer로 디코딩
   */
  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }

  /**
   * 메시지 핸들러
   */
  function handleSyncMessage(message: Record<string, unknown>) {
    const msg = message as unknown as SyncMessage

    switch (msg.messageType) {
      case 'sync-request':
        handleSyncRequest(msg as SyncRequestMessage)
        break
      case 'sync-offer':
        handleSyncOffer(msg as SyncOfferMessage)
        break
      case 'sync-chunk':
        handleSyncChunk(msg as SyncChunkMessage)
        break
      case 'sync-complete':
        handleSyncComplete(msg as SyncCompleteMessage)
        break
      case 'sync-ack':
        handleSyncAck(msg as SyncAckMessage)
        break
    }
  }

  /**
   * 초기 동기화 요청 (새 접속자)
   */
  async function requestInitialSync(): Promise<Uint8Array | null> {
    console.log('[InitialSync] 초기 동기화 요청 전송')

    // topic 구독
    signaling.subscribe([syncTopic])

    // 메시지 핸들러 등록
    signaling.on(syncTopic, handleSyncMessage)

    // 요청 메시지 발행
    const request: SyncRequestMessage = {
      messageType: 'sync-request',
      requesterUuid: myUuid,
      timestamp: Date.now(),
    }

    signaling.publish(syncTopic, request as Record<string, unknown>)

    // Offer 대기
    return new Promise<Uint8Array | null>((resolve, reject) => {
      syncResolve = resolve
      syncReject = reject

      setTimeout(() => {
        console.warn('[InitialSync] Offer 타임아웃 - 일반 동기화로 전환')
        cleanup()
        resolve(null)
      }, 10000) // 10초 대기
    })
  }

  /**
   * 동기화 요청 처리 (기존 피어)
   */
  async function handleSyncRequest(request: SyncRequestMessage) {
    if (request.requesterUuid === myUuid) return

    console.log(`[InitialSync] 동기화 요청 수신 from ${request.requesterUuid.slice(-8)}`)

    try {
      // Yjs 스냅샷 생성
      const snapshot = Y.encodeStateAsUpdate(doc)
      const snapshotSize = snapshot.byteLength

      // 데이터가 없으면 응답하지 않음
      if (snapshotSize === 0) {
        console.log('[InitialSync] 스냅샷이 비어있음 - 응답하지 않음')
        return
      }

      console.log(`[InitialSync] 스냅샷 생성: ${(snapshotSize / 1024 / 1024).toFixed(2)}MB`)

      // 청크 수 계산
      const totalChunks = Math.ceil(snapshotSize / CHUNK_SIZE)

      // Offer 전송
      const offer: SyncOfferMessage = {
        messageType: 'sync-offer',
        senderUuid: myUuid,
        targetUuid: request.requesterUuid,
        totalChunks,
        snapshotSize,
        timestamp: Date.now(),
      }

      signaling.publish(syncTopic, offer as Record<string, unknown>)

      // 청크 전송 (순차)
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, snapshotSize)
        const chunk = snapshot.slice(start, end)

        const chunkMessage: SyncChunkMessage = {
          messageType: 'sync-chunk',
          senderUuid: myUuid,
          targetUuid: request.requesterUuid,
          chunkIndex: i,
          totalChunks,
          data: arrayBufferToBase64(chunk),
          timestamp: Date.now(),
        }

        signaling.publish(syncTopic, chunkMessage as Record<string, unknown>)

        // 흐름 제어: 100ms 대기
        await new Promise(resolve => setTimeout(resolve, 100))

        if ((i + 1) % 10 === 0) {
          console.log(`[InitialSync] 청크 전송 진행: ${i + 1}/${totalChunks}`)
        }
      }

      // 완료 메시지
      const complete: SyncCompleteMessage = {
        messageType: 'sync-complete',
        senderUuid: myUuid,
        targetUuid: request.requesterUuid,
        timestamp: Date.now(),
      }

      signaling.publish(syncTopic, complete as Record<string, unknown>)

      console.log('[InitialSync] 스냅샷 전송 완료')
    } catch (error) {
      console.error('[InitialSync] 동기화 응답 실패:', error)
    }
  }

  /**
   * Offer 처리 (수신자)
   */
  function handleSyncOffer(offer: SyncOfferMessage) {
    if (offer.targetUuid !== myUuid) return

    console.log(`[InitialSync] Offer 수신 from ${offer.senderUuid.slice(-8)} (${(offer.snapshotSize / 1024 / 1024).toFixed(2)}MB, ${offer.totalChunks} chunks)`)

    expectedTotalChunks = offer.totalChunks
    receivedChunks.clear()
  }

  /**
   * 청크 수신 처리
   */
  function handleSyncChunk(chunk: SyncChunkMessage) {
    if (chunk.targetUuid !== myUuid) return

    try {
      const data = base64ToArrayBuffer(chunk.data)
      receivedChunks.set(chunk.chunkIndex, data)

      if ((chunk.chunkIndex + 1) % 10 === 0) {
        console.log(`[InitialSync] 청크 수신 진행: ${receivedChunks.size}/${chunk.totalChunks}`)
      }
    } catch (error) {
      console.error('[InitialSync] 청크 디코딩 실패:', error)
    }
  }

  /**
   * 완료 메시지 처리
   */
  function handleSyncComplete(complete: SyncCompleteMessage) {
    if (complete.targetUuid !== myUuid) return

    console.log(`[InitialSync] 완료 메시지 수신 from ${complete.senderUuid.slice(-8)}`)

    try {
      // 모든 청크가 도착했는지 확인
      if (receivedChunks.size !== expectedTotalChunks) {
        throw new Error(`청크 누락: ${receivedChunks.size}/${expectedTotalChunks}`)
      }

      // 청크 병합
      const chunks: ArrayBuffer[] = []
      let totalSize = 0

      for (let i = 0; i < expectedTotalChunks; i++) {
        const chunk = receivedChunks.get(i)
        if (!chunk) {
          throw new Error(`청크 ${i} 누락`)
        }
        chunks.push(chunk)
        totalSize += chunk.byteLength
      }

      const merged = new Uint8Array(totalSize)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(new Uint8Array(chunk), offset)
        offset += chunk.byteLength
      }

      console.log(`[InitialSync] 스냅샷 수신 완료: ${(totalSize / 1024 / 1024).toFixed(2)}MB`)

      // ACK 전송
      const ack: SyncAckMessage = {
        messageType: 'sync-ack',
        receiverUuid: myUuid,
        targetUuid: complete.senderUuid,
        success: true,
        timestamp: Date.now(),
      }

      signaling.publish(syncTopic, ack as Record<string, unknown>)

      // Promise resolve
      if (syncResolve) {
        syncResolve(merged)
        syncResolve = null
        syncReject = null
      }

      cleanup()
    } catch (error) {
      console.error('[InitialSync] 스냅샷 병합 실패:', error)

      // ACK 전송 (실패)
      const ack: SyncAckMessage = {
        messageType: 'sync-ack',
        receiverUuid: myUuid,
        targetUuid: complete.senderUuid,
        success: false,
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }

      signaling.publish(syncTopic, ack as Record<string, unknown>)

      if (syncReject) {
        syncReject(error instanceof Error ? error : new Error(String(error)))
        syncResolve = null
        syncReject = null
      }

      cleanup()
    }
  }

  /**
   * ACK 처리 (송신자)
   */
  function handleSyncAck(ack: SyncAckMessage) {
    if (ack.targetUuid !== myUuid) return

    if (ack.success) {
      console.log(`[InitialSync] ✅ 수신자가 적용 완료 확인: ${ack.receiverUuid.slice(-8)}`)
    } else {
      console.error(`[InitialSync] ❌ 수신자 적용 실패: ${ack.message}`)
    }
  }

  /**
   * 정리
   */
  function cleanup() {
    signaling.off(syncTopic, handleSyncMessage)
    receivedChunks.clear()
    expectedTotalChunks = 0
  }

  return {
    requestInitialSync,
    cleanup,
  }
}
