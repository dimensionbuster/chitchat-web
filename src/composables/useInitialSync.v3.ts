/**
 * useInitialSync v3
 *
 * 시그널링 서버를 통해 WebRTC 연결을 수립하고,
 * 브라우저 간 직접 DataChannel로 초기 상태 전송
 */

import * as Y from 'yjs'
import type { useSignalingServer } from './useSignalingServer'

const CHUNK_SIZE = 128 * 1024 // 128KB
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.gongbbu.com:3478', username: 'gongbbu', credential: 'gongbbu' },
  { urls: 'turns:turn.gongbbu.com:5349', username: 'gongbbu', credential: 'gongbbu' },
]

/**
 * 시그널링 메시지 타입 (시그널링 서버를 통해서만 전송)
 */
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
  sdp: RTCSessionDescriptionInit
  timestamp: number
}

type SyncAnswerMessage = {
  messageType: 'sync-answer'
  receiverUuid: string
  targetUuid: string
  sdp: RTCSessionDescriptionInit
  timestamp: number
}

type SyncIceMessage = {
  messageType: 'sync-ice'
  fromUuid: string
  toUuid: string
  candidate: RTCIceCandidateInit
  timestamp: number
}

type SignalingMessage = SyncRequestMessage | SyncOfferMessage | SyncAnswerMessage | SyncIceMessage

/**
 * DataChannel 메시지 타입 (브라우저 간 직접 전송)
 */
type SyncChunkMessage = {
  type: 'sync-chunk'
  chunkIndex: number
  totalChunks: number
  data: ArrayBuffer
}

type SyncCompleteMessage = {
  type: 'sync-complete'
}

type SyncAckMessage = {
  type: 'sync-ack'
  success: boolean
  message?: string
}

type DataChannelMessage = SyncChunkMessage | SyncCompleteMessage | SyncAckMessage

/**
 * 초기 동기화 composable
 */
export function useInitialSync(
  signaling: ReturnType<typeof useSignalingServer>,
  myUuid: string,
  doc: Y.Doc,
  roomId: string,
) {
  const syncTopic = `room-${roomId}-sync`

  // WebRTC 연결 관리
  let peerConnection: RTCPeerConnection | null = null
  let dataChannel: RTCDataChannel | null = null
  const pendingIceCandidates: RTCIceCandidateInit[] = []

  // 수신 버퍼
  const receivedChunks = new Map<number, ArrayBuffer>()
  let expectedTotalChunks = 0
  let syncResolve: ((snapshot: Uint8Array | null) => void) | null = null
  let syncReject: ((error: Error) => void) | null = null

  /**
   * PeerConnection 생성
   */
  function createPeerConnection(targetUuid: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const iceMessage: SyncIceMessage = {
          messageType: 'sync-ice',
          fromUuid: myUuid,
          toUuid: targetUuid,
          candidate: event.candidate.toJSON(),
          timestamp: Date.now(),
        }
        signaling.publish(syncTopic, iceMessage as unknown as Record<string, unknown>)
      }
    }

    pc.oniceconnectionstatechange = () => {
      console.log(`[InitialSync] ICE 상태: ${pc.iceConnectionState}`)
    }

    pc.onconnectionstatechange = () => {
      console.log(`[InitialSync] 연결 상태: ${pc.connectionState}`)
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanup()
      }
    }

    return pc
  }

  /**
   * 시그널링 메시지 핸들러
   */
  function handleSignalingMessage(message: Record<string, unknown>) {
    const msg = message as unknown as SignalingMessage

    console.log('[InitialSync] 시그널링 메시지 수신:', msg.messageType)

    switch (msg.messageType) {
      case 'sync-request':
        handleSyncRequest(msg as SyncRequestMessage)
        break
      case 'sync-offer':
        handleSyncOffer(msg as SyncOfferMessage)
        break
      case 'sync-answer':
        handleSyncAnswer(msg as SyncAnswerMessage)
        break
      case 'sync-ice':
        handleSyncIce(msg as SyncIceMessage)
        break
    }
  }

  /**
   * DataChannel 메시지 핸들러
   */
  function handleDataChannelMessage(event: MessageEvent) {
    if (event.data instanceof ArrayBuffer) {
      // 바이너리 데이터 = 청크
      // 첫 4바이트: chunkIndex, 다음 4바이트: totalChunks
      const view = new DataView(event.data)
      const chunkIndex = view.getUint32(0)
      const totalChunks = view.getUint32(4)
      const data = event.data.slice(8)

      receivedChunks.set(chunkIndex, data)

      if ((chunkIndex + 1) % 10 === 0) {
        console.log(`[InitialSync] 청크 수신: ${receivedChunks.size}/${totalChunks}`)
      }

      // 모든 청크 수신 완료 확인
      if (receivedChunks.size === totalChunks) {
        mergeAndApplySnapshot(totalChunks)
      }
    } else if (typeof event.data === 'string') {
      try {
        const msg: DataChannelMessage = JSON.parse(event.data)

        switch (msg.type) {
          case 'sync-complete':
            // 송신자가 완료 신호 보냄 (예비용)
            if (receivedChunks.size === expectedTotalChunks) {
              mergeAndApplySnapshot(expectedTotalChunks)
            }
            break
          case 'sync-ack':
            console.log(`[InitialSync] ACK 수신: ${msg.success ? '성공' : '실패'}`)
            if (!msg.success) {
              console.error(`[InitialSync] 수신자 에러: ${msg.message}`)
            }
            cleanup()
            break
        }
      } catch (error) {
        console.error('[InitialSync] DataChannel 메시지 파싱 실패:', error)
      }
    }
  }

  /**
   * 스냅샷 병합 및 적용
   */
  function mergeAndApplySnapshot(totalChunks: number) {
    try {
      console.log(`[InitialSync] 스냅샷 병합 시작: ${totalChunks}개 청크`)

      const chunks: ArrayBuffer[] = []
      let totalSize = 0

      for (let i = 0; i < totalChunks; i++) {
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

      console.log(`[InitialSync] 스냅샷 병합 완료: ${(totalSize / 1024 / 1024).toFixed(2)}MB`)

      // ACK 전송
      if (dataChannel && dataChannel.readyState === 'open') {
        const ack: SyncAckMessage = {
          type: 'sync-ack',
          success: true,
        }
        dataChannel.send(JSON.stringify(ack))
      }

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
      if (dataChannel && dataChannel.readyState === 'open') {
        const ack: SyncAckMessage = {
          type: 'sync-ack',
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
        dataChannel.send(JSON.stringify(ack))
      }

      if (syncReject) {
        syncReject(error instanceof Error ? error : new Error(String(error)))
        syncResolve = null
        syncReject = null
      }

      cleanup()
    }
  }

  /**
   * 초기 동기화 요청 (새 접속자)
   */
  async function requestInitialSync(): Promise<Uint8Array | null> {
    console.log('[InitialSync] 초기 동기화 요청')

    // topic 구독
    signaling.subscribe([syncTopic])
    signaling.on(syncTopic, handleSignalingMessage)

    // 🔥 구독이 서버에 전파될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 500))

    // 요청 메시지 발행
    const request: SyncRequestMessage = {
      messageType: 'sync-request',
      requesterUuid: myUuid,
      timestamp: Date.now(),
    }

    console.log('[InitialSync] 요청 메시지 발행:', syncTopic)
    signaling.publish(syncTopic, request as unknown as Record<string, unknown>)

    // Offer 대기 (10초)
    return new Promise<Uint8Array | null>((resolve, reject) => {
      syncResolve = resolve
      syncReject = reject

      setTimeout(() => {
        console.warn('[InitialSync] Offer 타임아웃')
        cleanup()
        resolve(null)
      }, 10000)
    })
  }

  /**
   * 동기화 요청 처리 (기존 피어)
   */
  async function handleSyncRequest(request: SyncRequestMessage) {
    console.log(`[InitialSync] 동기화 요청 수신:`, {
      from: request.requesterUuid.slice(-8),
      myUuid: myUuid.slice(-8),
      isSelf: request.requesterUuid === myUuid
    })

    if (request.requesterUuid === myUuid) {
      console.log('[InitialSync] 자기 자신의 요청 - 무시')
      return
    }

    console.log(`[InitialSync] ✅ 다른 피어의 요청 - 응답 시작`)

    try {
      // 스냅샷 생성
      const snapshot = Y.encodeStateAsUpdate(doc)
      const snapshotSize = snapshot.byteLength

      if (snapshotSize === 0) {
        console.log('[InitialSync] 빈 스냅샷 - 응답하지 않음')
        return
      }

      console.log(`[InitialSync] 스냅샷 생성: ${(snapshotSize / 1024 / 1024).toFixed(2)}MB`)

      const totalChunks = Math.ceil(snapshotSize / CHUNK_SIZE)

      // PeerConnection 생성
      peerConnection = createPeerConnection(request.requesterUuid)

      // DataChannel 생성 (송신자)
      dataChannel = peerConnection.createDataChannel('initial-sync', {
        ordered: true,
        maxPacketLifeTime: 3000,
      })

      dataChannel.onopen = () => {
        console.log('[InitialSync] DataChannel 열림 - 청크 전송 시작')
        sendSnapshotChunks(snapshot, totalChunks)
      }

      dataChannel.onmessage = handleDataChannelMessage
      dataChannel.onclose = () => {
        console.log('[InitialSync] DataChannel 닫힘')
        cleanup()
      }

      // Offer 생성
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      // Offer 전송 (시그널링 서버 경유)
      const offerMessage: SyncOfferMessage = {
        messageType: 'sync-offer',
        senderUuid: myUuid,
        targetUuid: request.requesterUuid,
        totalChunks,
        snapshotSize,
        sdp: offer,
        timestamp: Date.now(),
      }

      signaling.publish(syncTopic, offerMessage as unknown as Record<string, unknown>)
      console.log('[InitialSync] Offer 전송')

      // Answer 대기
      // handleSyncAnswer에서 처리됨
    } catch (error) {
      console.error('[InitialSync] 동기화 응답 실패:', error)
      cleanup()
    }
  }

  /**
   * 청크 전송 (DataChannel 직접 전송)
   */
  async function sendSnapshotChunks(snapshot: Uint8Array, totalChunks: number) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[InitialSync] DataChannel이 열리지 않음')
      return
    }

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, snapshot.byteLength)
      const chunk = snapshot.slice(start, end)

      // 헤더 추가: chunkIndex(4) + totalChunks(4) + data
      const header = new ArrayBuffer(8)
      const view = new DataView(header)
      view.setUint32(0, i)
      view.setUint32(4, totalChunks)

      const message = new Uint8Array(header.byteLength + chunk.byteLength)
      message.set(new Uint8Array(header), 0)
      message.set(chunk, header.byteLength)

      // DataChannel 버퍼 체크
      while (dataChannel.bufferedAmount > 8 * 1024 * 1024) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      dataChannel.send(message)

      if ((i + 1) % 10 === 0) {
        console.log(`[InitialSync] 청크 전송: ${i + 1}/${totalChunks}`)
      }
    }

    // 완료 메시지
    const complete: SyncCompleteMessage = {
      type: 'sync-complete',
    }
    dataChannel.send(JSON.stringify(complete))

    console.log('[InitialSync] 모든 청크 전송 완료')
  }

  /**
   * Offer 처리 (수신자)
   */
  async function handleSyncOffer(offer: SyncOfferMessage) {
    if (offer.targetUuid !== myUuid) return

    console.log(`[InitialSync] Offer 수신 from ${offer.senderUuid.slice(-8)}`)
    console.log(`  - 크기: ${(offer.snapshotSize / 1024 / 1024).toFixed(2)}MB`)
    console.log(`  - 청크: ${offer.totalChunks}개`)

    expectedTotalChunks = offer.totalChunks

    try {
      // PeerConnection 생성
      peerConnection = createPeerConnection(offer.senderUuid)

      // DataChannel 핸들러 (수신자)
      peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel
        console.log('[InitialSync] DataChannel 수신')

        dataChannel.onopen = () => {
          console.log('[InitialSync] DataChannel 열림 - 수신 대기')
        }

        dataChannel.onmessage = handleDataChannelMessage
        dataChannel.onclose = () => {
          console.log('[InitialSync] DataChannel 닫힘')
          cleanup()
        }
      }

      // Remote description 설정
      await peerConnection.setRemoteDescription(offer.sdp)

      // Answer 생성
      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)

      // Answer 전송 (시그널링 서버 경유)
      const answerMessage: SyncAnswerMessage = {
        messageType: 'sync-answer',
        receiverUuid: myUuid,
        targetUuid: offer.senderUuid,
        sdp: answer,
        timestamp: Date.now(),
      }

      signaling.publish(syncTopic, answerMessage as unknown as Record<string, unknown>)
      console.log('[InitialSync] Answer 전송')

      // 대기 중인 ICE candidate 추가
      pendingIceCandidates.forEach((candidate) => {
        peerConnection?.addIceCandidate(candidate).catch(console.error)
      })
      pendingIceCandidates.length = 0
    } catch (error) {
      console.error('[InitialSync] Offer 처리 실패:', error)
      cleanup()
    }
  }

  /**
   * Answer 처리 (송신자)
   */
  async function handleSyncAnswer(answer: SyncAnswerMessage) {
    if (answer.targetUuid !== myUuid) return

    console.log(`[InitialSync] Answer 수신 from ${answer.receiverUuid.slice(-8)}`)

    try {
      if (peerConnection) {
        await peerConnection.setRemoteDescription(answer.sdp)

        // 대기 중인 ICE candidate 추가
        pendingIceCandidates.forEach((candidate) => {
          peerConnection?.addIceCandidate(candidate).catch(console.error)
        })
        pendingIceCandidates.length = 0

        console.log('[InitialSync] Answer 처리 완료')
      }
    } catch (error) {
      console.error('[InitialSync] Answer 처리 실패:', error)
    }
  }

  /**
   * ICE candidate 처리
   */
  function handleSyncIce(ice: SyncIceMessage) {
    if (ice.toUuid !== myUuid) return

    if (peerConnection && peerConnection.remoteDescription) {
      peerConnection.addIceCandidate(ice.candidate).catch(console.error)
    } else {
      pendingIceCandidates.push(ice.candidate)
    }
  }

  /**
   * 정리 (연결만 정리, 리스너는 유지)
   */
  function cleanup() {
    console.log('[InitialSync] cleanup 호출 - 연결만 정리')

    if (dataChannel) {
      if (dataChannel.readyState === 'open') {
        dataChannel.close()
      }
      dataChannel = null
    }

    if (peerConnection) {
      peerConnection.close()
      peerConnection = null
    }

    receivedChunks.clear()
    expectedTotalChunks = 0
    pendingIceCandidates.length = 0
  }

  /**
   * 완전 정리 (리스너까지 제거)
   */
  function dispose() {
    console.log('[InitialSync] dispose 호출 - 리스너 제거')
    signaling.off(syncTopic, handleSignalingMessage)
    cleanup()
  }

  /**
   * 기존 피어로 초기화 (요청 리스너 등록)
   */
  function initializeAsProvider() {
    console.log('[InitialSync] 기존 피어로 초기화 - 요청 리스너 등록')

    // topic 구독
    signaling.subscribe([syncTopic])
    signaling.on(syncTopic, handleSignalingMessage)
  }

  return {
    requestInitialSync,
    initializeAsProvider,
    cleanup,
    dispose,
  }
}
