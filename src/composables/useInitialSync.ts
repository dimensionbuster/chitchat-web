/**
 * useInitialSync
 *
 * 새 접속자가 기존 피어로부터 Yjs 문서 초기 상태를 받는 composable
 * y-webrtc의 동기화 실패 문제를 해결하기 위해 큰 데이터는 직접 WebRTC로 전송
 */

import type { WebrtcProvider } from 'y-webrtc'
import * as Y from 'yjs'
import {
  type InitialSyncRequest,
  type InitialSyncOffer,
  type InitialSyncAnswer,
  type InitialSyncIce,
} from './useWebrtcConnection'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.gongbbu.com:3478', username: 'gongbbu', credential: 'gongbbu' },
  { urls: 'turns:turn.gongbbu.com:5349', username: 'gongbbu', credential: 'gongbbu' },
]

const CHUNK_SIZE = 128 * 1024 // 128KB
const MAX_BUFFER_SIZE = 8 * 1024 * 1024 // 8MB
const SYNC_TIMEOUT = 60000 // 60초 타임아웃

type SyncStartMessage = {
  type: 'sync-start'
  totalChunks: number
  snapshotSize: number
}

type SyncCompleteMessage = {
  type: 'sync-complete'
}

type SyncErrorMessage = {
  type: 'sync-error'
  message: string
}

type SyncAckMessage = {
  type: 'sync-ack'
  success: boolean
  message?: string
}

type SyncMessage = SyncStartMessage | SyncCompleteMessage | SyncErrorMessage | SyncAckMessage

/**
 * 초기 동기화 composable
 */
export function useInitialSync(provider: WebrtcProvider, myUuid: string, doc: Y.Doc) {
  // PeerConnection 관리
  const activeConnection = { value: null as RTCPeerConnection | null }
  const activeChannel = { value: null as RTCDataChannel | null }
  const pendingIceCandidates: RTCIceCandidateInit[] = []

  /**
   * 초기 동기화 요청 (새 접속자)
   * 기존 피어들에게 초기 상태를 요청
   */
  async function requestInitialSync(): Promise<Uint8Array | null> {
    console.log('[InitialSync] 초기 동기화 요청 전송')

    // 🔥 피어 연결 대기 (awareness로 확인)
    // 최대 5초 대기
    let waitTime = 0
    const MAX_WAIT = 5000

    while (waitTime < MAX_WAIT) {
      const states = Array.from(provider.awareness.getStates().entries())
      const peerCount = states.filter(([, state]) => {
        const stateObj = state as Record<string, unknown>
        const userUuid = stateObj.userUuid as string | undefined
        return userUuid && userUuid !== myUuid
      }).length

      if (peerCount > 0) {
        console.log(`[InitialSync] ${peerCount}명의 피어 발견`)
        break
      }

      // 100ms 대기
      await new Promise(resolve => setTimeout(resolve, 100))
      waitTime += 100
    }

    // 다시 한 번 확인
    const states = Array.from(provider.awareness.getStates().entries())
    const connectedPeers = states.filter(([, state]) => {
      const stateObj = state as Record<string, unknown>
      const userUuid = stateObj.userUuid as string | undefined
      return userUuid && userUuid !== myUuid
    })

    if (connectedPeers.length === 0) {
      console.log('[InitialSync] 연결된 피어가 없음 - 일반 동기화 진행')
      return null
    }

    console.log(`[InitialSync] 최종 확인: ${connectedPeers.length}명의 피어`)

    // 🔥 초기 동기화 요청 메시지 전송 (awareness 사용)
    const requestMessage: InitialSyncRequest = {
      requesterUuid: myUuid,
      timestamp: Date.now(),
    }

    provider.awareness.setLocalStateField('initialSyncRequest', requestMessage)

    // Offer 대기
    return new Promise<Uint8Array | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.warn('[InitialSync] Offer 타임아웃 - 일반 동기화로 전환')
        provider.awareness.setLocalStateField('initialSyncRequest', null)
        provider.awareness.off('change', checkOffer)
        resolve(null) // null 반환하여 일반 동기화 진행
      }, 10000) // 10초 대기

      const checkOffer = () => {
        for (const [, state] of provider.awareness.getStates()) {
          const stateObj = state as Record<string, unknown>

          // 모든 'initialSyncOffer-'로 시작하는 키 탐색
          for (const key in stateObj) {
            if (!key.startsWith('initialSyncOffer-')) continue

            const offer = stateObj[key] as InitialSyncOffer | undefined

            // 내게 온 Offer인지 확인
            if (offer && offer.targetUuid === myUuid) {
              clearTimeout(timeout)
              provider.awareness.setLocalStateField('initialSyncRequest', null)
              provider.awareness.off('change', checkOffer)

              console.log(`[InitialSync] Offer 수신 from ${offer.senderUuid.slice(-8)} (${(offer.snapshotSize / 1024 / 1024).toFixed(2)}MB)`)

              // Offer 수락 및 스냅샷 수신
              receiveSnapshot(offer)
                .then(resolve)
                .catch(reject)

              return
            }
          }
        }
      }

      provider.awareness.on('change', checkOffer)
      checkOffer() // 즉시 한 번 체크
    })
  }

  /**
   * 초기 동기화 응답 (기존 피어)
   * 새 접속자에게 현재 문서 상태를 전송
   */
  async function respondToSyncRequest(request: InitialSyncRequest) {
    console.log(`[InitialSync] 동기화 요청 수신 from ${request.requesterUuid.slice(-8)}`)

    try {
      // Yjs 스냅샷 생성
      const snapshot = Y.encodeStateAsUpdate(doc)
      const snapshotSize = snapshot.byteLength

      console.log(`[InitialSync] 스냅샷 생성: ${(snapshotSize / 1024 / 1024).toFixed(2)}MB`)

      // PeerConnection 생성
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      activeConnection.value = pc

      // ICE candidate 수집
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const iceMessage: InitialSyncIce = {
            fromUuid: myUuid,
            toUuid: request.requesterUuid,
            candidate: event.candidate.toJSON(),
            timestamp: Date.now(),
          }
          provider.awareness.setLocalStateField('initialSyncIce', iceMessage)
          setTimeout(() => provider.awareness.setLocalStateField('initialSyncIce', null), 100)
        }
      }

      // DataChannel 생성
      const channel = pc.createDataChannel('initial-sync', {
        ordered: true,
        maxPacketLifeTime: 3000,
      })
      activeChannel.value = channel

      channel.onopen = () => {
        console.log('[InitialSync] 채널 열림 - 스냅샷 전송 시작')
        sendSnapshot(channel, snapshot, request.requesterUuid).catch((error) => {
          console.error('[InitialSync] 스냅샷 전송 실패:', error)
          cleanup()
        })
      }

      // 🔥 수신자로부터 ACK 대기
      channel.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg: SyncMessage = JSON.parse(event.data)
            if (msg.type === 'sync-ack') {
              if (msg.success) {
                console.log(`[InitialSync] ✅ 수신자가 적용 완료 확인: ${request.requesterUuid.slice(-8)}`)
              } else {
                console.error(`[InitialSync] ❌ 수신자 적용 실패: ${msg.message}`)
              }
              // ACK 받으면 채널 닫기
              setTimeout(() => cleanup(), 1000)
            }
          } catch (error) {
            console.warn('[InitialSync] ACK 파싱 실패:', error)
          }
        }
      }

      channel.onclose = () => {
        console.log('[InitialSync] 채널 닫힘')
        cleanup()
      }

      channel.onerror = (error) => {
        console.error('[InitialSync] 채널 에러:', error)
        cleanup()
      }

      // Offer 생성
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // Offer 전송
      const offerMessage: InitialSyncOffer = {
        senderUuid: myUuid,
        targetUuid: request.requesterUuid,
        snapshotSize,
        sdp: offer,
        timestamp: Date.now(),
      }

      const offerKey = `initialSyncOffer-${Date.now()}`
      provider.awareness.setLocalStateField(offerKey, offerMessage)

      console.log(`[InitialSync] Offer 전송: ${offerKey}`)

      // Answer 대기
      const answer = await waitForAnswer(request.requesterUuid)
      if (answer) {
        await pc.setRemoteDescription(answer.sdp)

        // 대기 중인 ICE candidate 추가
        pendingIceCandidates.forEach((candidate) => {
          pc.addIceCandidate(candidate).catch(console.error)
        })
        pendingIceCandidates.length = 0
      }

      // Offer 정리
      setTimeout(() => {
        provider.awareness.setLocalStateField(offerKey, null)
      }, 5000)
    } catch (error) {
      console.error('[InitialSync] 동기화 응답 실패:', error)
      cleanup()
    }
  }

  /**
   * Answer 대기
   */
  function waitForAnswer(targetUuid: string): Promise<InitialSyncAnswer | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[InitialSync] Answer 타임아웃')
        provider.awareness.off('change', checkAnswer)
        resolve(null)
      }, 30000)

      const checkAnswer = () => {
        for (const [, state] of provider.awareness.getStates()) {
          const stateObj = state as Record<string, unknown>

          for (const key in stateObj) {
            if (!key.startsWith('initialSyncAnswer-')) continue

            const answer = stateObj[key] as InitialSyncAnswer | undefined

            if (answer && answer.targetUuid === myUuid && answer.receiverUuid === targetUuid) {
              clearTimeout(timeout)
              provider.awareness.off('change', checkAnswer)
              console.log('[InitialSync] Answer 수신')
              resolve(answer)
              return
            }
          }
        }
      }

      provider.awareness.on('change', checkAnswer)
      checkAnswer()
    })
  }

  /**
   * 스냅샷 전송 (송신자)
   */
  async function sendSnapshot(channel: RTCDataChannel, snapshot: Uint8Array, targetUuid: string): Promise<void> {
    const totalChunks = Math.ceil(snapshot.byteLength / CHUNK_SIZE)

    console.log(`[InitialSync] 스냅샷 전송 시작: ${totalChunks}개 청크 → ${targetUuid.slice(-8)}`)

    // 전송 시작 메시지
    const startMsg: SyncStartMessage = {
      type: 'sync-start',
      totalChunks,
      snapshotSize: snapshot.byteLength,
    }
    channel.send(JSON.stringify(startMsg))

    // 청크 전송
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, snapshot.byteLength)
      const chunk = snapshot.slice(start, end)

      // 청크 인덱스 전송 (4바이트)
      const indexBuffer = new Uint32Array([i])
      channel.send(indexBuffer.buffer)

      // 버퍼 대기
      while (channel.bufferedAmount + chunk.byteLength > MAX_BUFFER_SIZE) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // 청크 데이터 전송
      channel.send(chunk.buffer)

      // 진행 상황 로그
      if ((i + 1) % 50 === 0 || i === totalChunks - 1) {
        console.log(`[InitialSync] 전송: ${i + 1}/${totalChunks} (${(((i + 1) / totalChunks) * 100).toFixed(0)}%)`)
      }
    }

    // 버퍼 비우기 대기
    while (channel.bufferedAmount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // 완료 메시지
    const completeMsg: SyncCompleteMessage = { type: 'sync-complete' }
    channel.send(JSON.stringify(completeMsg))

    console.log(`[InitialSync] 스냅샷 전송 완료 → ACK 대기 중...`)
  }

  /**
   * 스냅샷 수신 (수신자)
   */
  async function receiveSnapshot(offer: InitialSyncOffer): Promise<Uint8Array> {
    console.log(`[InitialSync] 스냅샷 수신 시작: ${(offer.snapshotSize / 1024 / 1024).toFixed(2)}MB`)

    try {
      // PeerConnection 생성
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      activeConnection.value = pc

      // ICE candidate 수집
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const iceMessage: InitialSyncIce = {
            fromUuid: myUuid,
            toUuid: offer.senderUuid,
            candidate: event.candidate.toJSON(),
            timestamp: Date.now(),
          }
          provider.awareness.setLocalStateField('initialSyncIce', iceMessage)
          setTimeout(() => provider.awareness.setLocalStateField('initialSyncIce', null), 100)
        }
      }

      // DataChannel 대기
      const channelPromise = new Promise<RTCDataChannel>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('DataChannel 타임아웃')), 30000)

        pc.ondatachannel = (event) => {
          clearTimeout(timeout)
          const ch = event.channel
          activeChannel.value = ch
          resolve(ch)
        }
      })

      // Remote description 설정
      await pc.setRemoteDescription(offer.sdp)

      // Answer 생성
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      // Answer 전송
      const answerMessage: InitialSyncAnswer = {
        receiverUuid: myUuid,
        targetUuid: offer.senderUuid,
        sdp: answer,
        timestamp: Date.now(),
      }

      const answerKey = `initialSyncAnswer-${Date.now()}`
      provider.awareness.setLocalStateField(answerKey, answerMessage)

      console.log(`[InitialSync] Answer 전송: ${answerKey}`)

      // Answer 정리
      setTimeout(() => {
        provider.awareness.setLocalStateField(answerKey, null)
      }, 5000)

      // 대기 중인 ICE candidate 추가
      pendingIceCandidates.forEach((candidate) => {
        pc.addIceCandidate(candidate).catch(console.error)
      })
      pendingIceCandidates.length = 0

      // DataChannel 대기
      const channel = await channelPromise

      // 채널 열릴 때까지 대기
      if (channel.readyState !== 'open') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('채널 열림 타임아웃')), 10000)
          const openHandler = () => {
            clearTimeout(timeout)
            resolve()
          }
          channel.addEventListener('open', openHandler, { once: true })
        })
      }

      console.log('[InitialSync] 채널 열림 - 스냅샷 수신 대기')

      // 🔥 스냅샷 수신 (순서 무관)
      return new Promise<Uint8Array>((resolve, reject) => {
        const chunksMap = new Map<number, ArrayBuffer>() // 순서 무관 청크 저장
        let nextExpectedIndex: number | null = null
        let totalChunks = 0
        const timeout = setTimeout(() => {
          cleanup()
          reject(new Error('스냅샷 수신 타임아웃'))
        }, SYNC_TIMEOUT)

        channel.onmessage = (event) => {
          if (typeof event.data === 'string') {
            // 제어 메시지
            const msg: SyncMessage = JSON.parse(event.data)

            switch (msg.type) {
              case 'sync-start':
                totalChunks = msg.totalChunks
                console.log(`[InitialSync] 수신 시작: ${totalChunks}개 청크`)
                break

              case 'sync-complete': {
                clearTimeout(timeout)

                // 🔥 청크를 순서대로 정렬하여 스냅샷 조합
                if (chunksMap.size !== totalChunks) {
                  const errorMsg = `청크 누락: ${chunksMap.size}/${totalChunks}`

                  // ❌ 실패 ACK 전송
                  const failAck: SyncAckMessage = {
                    type: 'sync-ack',
                    success: false,
                    message: errorMsg
                  }
                  try {
                    channel.send(JSON.stringify(failAck))
                  } catch (e) {
                    console.error('[InitialSync] ACK 전송 실패:', e)
                  }

                  cleanup()
                  reject(new Error(errorMsg))
                  return
                }

                try {
                  const sortedChunks: ArrayBuffer[] = []
                  for (let i = 0; i < totalChunks; i++) {
                    const chunk = chunksMap.get(i)
                    if (!chunk) {
                      throw new Error(`청크 ${i}가 누락되었습니다`)
                    }
                    sortedChunks.push(chunk)
                  }

                  const totalSize = sortedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
                  const snapshot = new Uint8Array(totalSize)
                  let offset = 0
                  for (const chunk of sortedChunks) {
                    snapshot.set(new Uint8Array(chunk), offset)
                    offset += chunk.byteLength
                  }

                  console.log(`[InitialSync] 수신 완료: ${(snapshot.byteLength / 1024 / 1024).toFixed(2)}MB`)

                  // ✅ 성공 ACK 전송
                  const successAck: SyncAckMessage = {
                    type: 'sync-ack',
                    success: true
                  }
                  try {
                    channel.send(JSON.stringify(successAck))
                    console.log('[InitialSync] ✅ ACK 전송: 수신 성공')
                  } catch (e) {
                    console.error('[InitialSync] ACK 전송 실패:', e)
                  }

                  // 약간의 지연 후 정리 (ACK가 전송될 시간)
                  setTimeout(() => cleanup(), 500)
                  resolve(snapshot)
                } catch (error) {
                  const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류'

                  // ❌ 실패 ACK 전송
                  const failAck: SyncAckMessage = {
                    type: 'sync-ack',
                    success: false,
                    message: errorMsg
                  }
                  try {
                    channel.send(JSON.stringify(failAck))
                  } catch (e) {
                    console.error('[InitialSync] ACK 전송 실패:', e)
                  }

                  cleanup()
                  reject(error)
                }
                break
              }

              case 'sync-error':
                clearTimeout(timeout)
                cleanup()
                reject(new Error(msg.message))
                break
            }
          } else {
            // 🔥 ArrayBuffer - 청크 인덱스 또는 데이터 (순서 무관 수신)
            const buffer = event.data as ArrayBuffer

            if (buffer.byteLength === 4) {
              // 청크 인덱스
              const index = new Uint32Array(buffer)[0]
              if (index !== undefined) {
                nextExpectedIndex = index
              }
            } else {
              // 청크 데이터
              if (nextExpectedIndex !== null && nextExpectedIndex >= 0) {
                // 이미 받은 청크는 건너뛰기 (중복 방지)
                if (!chunksMap.has(nextExpectedIndex)) {
                  chunksMap.set(nextExpectedIndex, buffer)

                  // 진행 상황 로그
                  if (totalChunks > 0 && chunksMap.size % 50 === 0) {
                    console.log(`[InitialSync] 수신: ${chunksMap.size}/${totalChunks} (${((chunksMap.size / totalChunks) * 100).toFixed(0)}%)`)
                  }
                }

                nextExpectedIndex = null
              }
            }
          }
        }

        channel.onerror = (error) => {
          clearTimeout(timeout)
          cleanup()
          reject(error)
        }

        channel.onclose = () => {
          clearTimeout(timeout)
          cleanup()
          if (chunksMap.size < totalChunks) {
            reject(new Error('채널이 완료 전에 닫혔습니다'))
          }
        }
      })
    } catch (error) {
      console.error('[InitialSync] 스냅샷 수신 실패:', error)
      cleanup()
      throw error
    }
  }

  /**
   * ICE candidate 처리
   */
  function handleIceCandidate(ice: InitialSyncIce) {
    if (ice.toUuid !== myUuid) return

    const pc = activeConnection.value
    if (pc && pc.remoteDescription) {
      pc.addIceCandidate(ice.candidate).catch(console.error)
    } else {
      pendingIceCandidates.push(ice.candidate)
    }
  }

  /**
   * 연결 정리
   */
  function cleanup() {
    if (activeChannel.value) {
      if (activeChannel.value.readyState === 'open') {
        activeChannel.value.close()
      }
      activeChannel.value = null
    }

    if (activeConnection.value) {
      activeConnection.value.close()
      activeConnection.value = null
    }

    pendingIceCandidates.length = 0
  }

  // ICE candidate 리스너 설정
  provider.awareness.on('change', () => {
    for (const [, state] of provider.awareness.getStates()) {
      const stateObj = state as Record<string, unknown>
      const ice = stateObj.initialSyncIce as InitialSyncIce | undefined
      if (ice) {
        handleIceCandidate(ice)
      }
    }
  })

  return {
    requestInitialSync,
    respondToSyncRequest,
    cleanup,
  }
}
