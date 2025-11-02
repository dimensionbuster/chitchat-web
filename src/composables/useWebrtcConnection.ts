/**
 * useWebrtcConnection
 *
 * WebRTC PeerConnection 및 DataChannel 관리
 * - Offer/Answer 교환 (SDP 시그널링)
 * - ICE Candidate 수집 및 교환
 * - 연결 생명주기 관리
 * - Y-webrtc awareness를 통한 시그널링
 * - 글로벌 큐 매니저와 데이터 채널 연동
 */

import { ref } from 'vue'
import type { WebrtcProvider } from 'y-webrtc'
import { useGlobalDataChannelQueue } from './useGlobalDataChannelQueue'

/**
 * 파일 전송을 위한 시그널링 메시지 타입
 */
export type FileTransferOffer = {
  fileId: string
  senderUuid: string
  targetUuid: string
  totalChunks: number
  fileSize: number
  sdp: RTCSessionDescriptionInit
  timestamp: number
}

export type FileTransferAnswer = {
  fileId: string
  receiverUuid: string
  targetUuid: string
  sdp: RTCSessionDescriptionInit
  timestamp: number
}

export type FileTransferIce = {
  fileId: string
  fromUuid: string
  toUuid: string
  candidate: RTCIceCandidateInit
  timestamp: number
}

export type FileTransferCancel = {
  fileId: string
  fromUuid: string
  reason: string
  timestamp: number
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.gongbbu.com:3478', username: 'gongbbu', credential: 'gongbbu' },
  { urls: 'turns:turn.gongbbu.com:5349', username: 'gongbbu', credential: 'gongbbu' },
]

/**
 * WebRTC 연결 관리자
 * PeerConnection과 DataChannel의 생명주기를 관리
 */
export function useWebrtcConnection(provider: WebrtcProvider, myUuid: string) {
  // 활성 연결 관리
  const activeConnections = ref(new Map<string, RTCPeerConnection>())
  const activeChannels = ref(new Map<string, RTCDataChannel>())
  const pendingIceCandidates = ref(new Map<string, RTCIceCandidateInit[]>())

  // 글로벌 큐 매니저 연동
  const { registerDataChannel, unregisterDataChannel } = useGlobalDataChannelQueue()

  /**
   * 연결 ID 생성 (fileId-peerUuid)
   */
  function getConnectionId(fileId: string, peerUuid: string): string {
    return `${fileId}-${peerUuid}`
  }

  /**
   * 새로운 PeerConnection 생성
   */
  function createPeerConnection(connectionId: string, targetUuid: string, fileId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    // ICE candidate 수집 및 전송
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const iceMessage: FileTransferIce = {
          fileId,
          fromUuid: myUuid,
          toUuid: targetUuid,
          candidate: event.candidate.toJSON(),
          timestamp: Date.now(),
        }
        provider.awareness.setLocalStateField('fileTransferIce', iceMessage)
        setTimeout(() => provider.awareness.setLocalStateField('fileTransferIce', null), 100)
      }
    }

    activeConnections.value.set(connectionId, pc)
    return pc
  }

  /**
   * Offer 생성 (발신자)
   */
  async function createOffer(
    fileId: string,
    targetUuid: string,
    totalChunks: number,
    fileSize: number,
  ): Promise<RTCDataChannel> {
    const connectionId = getConnectionId(fileId, targetUuid)

    // 이미 연결 있으면 재사용
    if (activeChannels.value.has(connectionId)) {
      return activeChannels.value.get(connectionId)!
    }

    console.log(`[WebRTC] Offer 생성: ${fileId}`)

    // PeerConnection 생성
    const pc = createPeerConnection(connectionId, targetUuid, fileId)

    // DataChannel 생성
    const channel = pc.createDataChannel('file-transfer', {
      ordered: true,
      maxPacketLifeTime: 3000,
    })

    channel.onclose = () => cleanup(connectionId)
    activeChannels.value.set(connectionId, channel)

    // 글로벌 큐 매니저에 채널 등록
    registerDataChannel(targetUuid, channel)

    // Offer 생성
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    // awareness로 Offer 전송
    const offerMessage: FileTransferOffer = {
      fileId,
      senderUuid: myUuid,
      targetUuid,
      totalChunks,
      fileSize,
      sdp: offer,
      timestamp: Date.now(),
    }

    provider.awareness.setLocalStateField('fileTransferOffer', offerMessage)

    // Offer를 수신자가 받을 수 있도록 잠시 유지
    setTimeout(() => {
      provider.awareness.setLocalStateField('fileTransferOffer', null)
    }, 3000)

    // Answer 대기
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Answer 타임아웃'))
        cleanup(connectionId)
      }, 30000) // 타임아웃 30초로 증가

      const checkAnswer = () => {
        for (const [, state] of provider.awareness.getStates()) {
          const answer = state.fileTransferAnswer as FileTransferAnswer | undefined

          if (answer) {
            console.log(`[WebRTC] Answer 감지:`, {
              fileId: answer.fileId,
              targetUuid: answer.targetUuid,
              receiverUuid: answer.receiverUuid,
              expected: { fileId, myUuid, targetUuid }
            })
          }

          // Guard: Answer가 없거나 조건에 맞지 않으면 스킵
          if (!answer) return
          if (answer.fileId !== fileId) return
          if (answer.targetUuid !== myUuid) return
          if (answer.receiverUuid !== targetUuid) return

          // Answer 처리
          clearTimeout(timeout)
          provider.awareness.off('change', checkAnswer)

          // Remote description 설정
          pc.setRemoteDescription(answer.sdp)
            .then(() => {
              console.log(`[WebRTC] Answer 수락`)

              // 대기 중인 ICE candidate 추가
              const pending = pendingIceCandidates.value.get(connectionId) || []
              pending.forEach((candidate) => {
                pc.addIceCandidate(candidate).catch(console.error)
              })
              pendingIceCandidates.value.delete(connectionId)

              // 채널이 열릴 때까지 대기
              if (channel.readyState === 'open') {
                resolve(channel)
                return
              }

              const openHandler = () => {
                channel.removeEventListener('open', openHandler)
                console.log(`[WebRTC] DataChannel 연결 완료`)
                resolve(channel)
              }
              channel.addEventListener('open', openHandler)

              setTimeout(() => {
                if (channel.readyState !== 'open') {
                  channel.removeEventListener('open', openHandler)
                  reject(new Error('채널 열림 타임아웃'))
                }
              }, 15000)
            })
            .catch(reject)
          return
        }
      }

      provider.awareness.on('change', checkAnswer)
      checkAnswer()
    })
  }

  /**
   * Answer 생성 (수신자)
   */
  async function createAnswer(offer: FileTransferOffer): Promise<RTCDataChannel> {
    const connectionId = getConnectionId(offer.fileId, offer.senderUuid)

    console.log(`[WebRTC] Answer 생성: ${offer.fileId}`, {
      senderUuid: offer.senderUuid,
      targetUuid: offer.targetUuid,
      myUuid
    })

    // PeerConnection 생성
    const pc = createPeerConnection(connectionId, offer.senderUuid, offer.fileId)

    // DataChannel 핸들러 설정
    const channelPromise = new Promise<RTCDataChannel>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DataChannel 타임아웃')), 30000) // 30초로 증가

      pc.ondatachannel = (event) => {
        clearTimeout(timeout)
        const ch = event.channel
        ch.onclose = () => cleanup(connectionId)
        console.log(`[WebRTC] DataChannel 수신됨`)
        resolve(ch)
      }
    })

    // Remote description 설정
    await pc.setRemoteDescription(offer.sdp)

    // Answer 생성
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    // awareness로 Answer 전송 (DataChannel 대기 전에!)
    const answerMessage: FileTransferAnswer = {
      fileId: offer.fileId,
      receiverUuid: myUuid,
      targetUuid: offer.senderUuid,
      sdp: answer,
      timestamp: Date.now(),
    }

    provider.awareness.setLocalStateField('fileTransferAnswer', answerMessage)

    // Answer를 송신자가 받을 수 있도록 잠시 유지
    setTimeout(() => {
      provider.awareness.setLocalStateField('fileTransferAnswer', null)
    }, 3000)

    // 대기 중인 ICE candidate 추가
    const pending = pendingIceCandidates.value.get(connectionId) || []
    pending.forEach((candidate) => pc.addIceCandidate(candidate).catch(console.error))
    pendingIceCandidates.value.delete(connectionId)

    // DataChannel 대기
    const channel = await channelPromise
    activeChannels.value.set(connectionId, channel)

    // 글로벌 큐 매니저에 채널 등록
    registerDataChannel(offer.senderUuid, channel)

    // 채널이 열릴 때까지 대기
    if (channel.readyState === 'open') {
      return channel
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('수신 채널 열림 타임아웃')), 15000)

      const openHandler = () => {
        clearTimeout(timeout)
        console.log(`[WebRTC] 수신 채널 열림`)
        channel.removeEventListener('open', openHandler)
        resolve()
      }

      channel.addEventListener('open', openHandler)
    })

    return channel
  }

  /**
   * ICE candidate 처리
   */
  function handleIceCandidate(ice: FileTransferIce) {
    if (ice.toUuid !== myUuid) return

    const connectionId = getConnectionId(ice.fileId, ice.fromUuid)
    const pc = activeConnections.value.get(connectionId)

    if (pc && pc.remoteDescription) {
      pc.addIceCandidate(ice.candidate).catch(console.error)
    } else {
      const pending = pendingIceCandidates.value.get(connectionId) || []
      pending.push(ice.candidate)
      pendingIceCandidates.value.set(connectionId, pending)
    }
  }

  /**
   * 연결 정리
   */
  function cleanup(connectionId: string) {
    const pc = activeConnections.value.get(connectionId)
    const channel = activeChannels.value.get(connectionId)

    // 글로벌 큐에서 채널 등록 해제
    const peerUuid = connectionId.split('-')[1]
    if (peerUuid) {
      unregisterDataChannel(peerUuid)
    }

    if (channel && channel.readyState === 'open') channel.close()
    if (pc) pc.close()

    activeConnections.value.delete(connectionId)
    activeChannels.value.delete(connectionId)
    pendingIceCandidates.value.delete(connectionId)
  }

  /**
   * 특정 파일 전송 취소
   */
  function cancelTransfer(fileId: string, peerUuid: string, reason: string) {
    const connectionId = getConnectionId(fileId, peerUuid)

    // 취소 메시지 전송
    const cancelMessage: FileTransferCancel = {
      fileId,
      fromUuid: myUuid,
      reason,
      timestamp: Date.now(),
    }
    provider.awareness.setLocalStateField('fileTransferCancel', cancelMessage)

    cleanup(connectionId)
  }

  /**
   * 모든 연결 정리
   */
  function cleanupAll() {
    const connectionIds = Array.from(activeConnections.value.keys())
    connectionIds.forEach(cleanup)
  }

  // ICE candidate 리스너 설정
  provider.awareness.on('change', () => {
    for (const [, state] of provider.awareness.getStates()) {
      const ice = state.fileTransferIce as FileTransferIce | undefined
      if (ice) {
        handleIceCandidate(ice)
      }
    }
  })

  return {
    createOffer,
    createAnswer,
    handleIceCandidate,
    cleanup,
    cleanupAll,
    cancelTransfer,
    activeConnections,
    activeChannels,
    getConnectionId,
  }
}
