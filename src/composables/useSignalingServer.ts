/**
 * useSignalingServer
 *
 * AWS API Gateway WebSocket 기반 시그널링 서버 연결 관리
 * - topic 기반 pub/sub 메시지 전송
 * - 초기 상태 동기화를 위한 직접 통신 채널
 * - y-webrtc를 우회한 데이터 전송
 */

import { ref, onUnmounted } from 'vue'

export type SignalingMessage = {
  type: 'publish'
  topic: string
  [key: string]: unknown
}

export type SignalingSubscribeMessage = {
  type: 'subscribe'
  topics: string[]
}

export type SignalingUnsubscribeMessage = {
  type: 'unsubscribe'
  topics: string[]
}

export type MessageHandler = (message: Record<string, unknown>) => void

export function useSignalingServer(signalingUrl: string) {
  const ws = ref<WebSocket | null>(null)
  const isConnected = ref(false)
  const messageHandlers = ref(new Map<string, Set<MessageHandler>>())
  const reconnectTimer = ref<number | null>(null)
  const reconnectDelay = 2000 // 2초 후 재연결
  const subscribedTopics = ref<Set<string>>(new Set()) // 구독 중인 토픽 추적

  /**
   * 시그널링 서버 연결
   */
  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.value?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      console.log('[Signaling] 연결 시도:', signalingUrl)

      const socket = new WebSocket(signalingUrl)

      socket.onopen = () => {
        console.log('[Signaling] 연결됨')
        ws.value = socket
        isConnected.value = true

        // 재연결 시 기존 구독 복원
        if (subscribedTopics.value.size > 0) {
          const topics = Array.from(subscribedTopics.value)
          console.log('[Signaling] 재연결 후 구독 복원:', topics)
          const message: SignalingSubscribeMessage = {
            type: 'subscribe',
            topics,
          }
          socket.send(JSON.stringify(message))
        }

        resolve()
      }

      socket.onerror = (error) => {
        console.error('[Signaling] 연결 오류:', error)
        reject(error)
      }

      socket.onclose = () => {
        console.log('[Signaling] 연결 종료')
        isConnected.value = false
        ws.value = null

        // 자동 재연결
        if (!reconnectTimer.value) {
          reconnectTimer.value = window.setTimeout(() => {
            reconnectTimer.value = null
            connect().catch(console.error)
          }, reconnectDelay)
        }
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          handleMessage(message)
        } catch (error) {
          console.error('[Signaling] 메시지 파싱 실패:', error)
        }
      }
    })
  }

  /**
   * 메시지 핸들러
   */
  function handleMessage(message: Record<string, unknown>) {
    if (message.type === 'pong') {
      // ping-pong은 무시
      return
    }

    // publish된 메시지인 경우 topic 핸들러 호출
    if (message.type === 'publish' && typeof message.topic === 'string') {
      const handlers = messageHandlers.value.get(message.topic)
      if (handlers) {
        handlers.forEach(handler => handler(message))
      }
    }
  }

  /**
   * topic 구독
   */
  function subscribe(topics: string[]) {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      console.error('[Signaling] WebSocket이 연결되지 않음')
      return
    }

    // 구독 토픽 추적
    topics.forEach(topic => subscribedTopics.value.add(topic))

    const message: SignalingSubscribeMessage = {
      type: 'subscribe',
      topics,
    }

    ws.value.send(JSON.stringify(message))
    console.log('[Signaling] 구독:', topics)
  }

  /**
   * topic 구독 해제
   */
  function unsubscribe(topics: string[]) {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      return
    }

    // 구독 토픽에서 제거
    topics.forEach(topic => subscribedTopics.value.delete(topic))

    const message: SignalingUnsubscribeMessage = {
      type: 'unsubscribe',
      topics,
    }

    ws.value.send(JSON.stringify(message))
    console.log('[Signaling] 구독 해제:', topics)
  }

  /**
   * 메시지 발행
   */
  function publish(topic: string, data: Record<string, unknown>) {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      console.error('[Signaling] WebSocket이 연결되지 않음')
      return false
    }

    const message: SignalingMessage = {
      type: 'publish',
      topic,
      ...data,
    }

    ws.value.send(JSON.stringify(message))
    return true
  }

  /**
   * topic 메시지 핸들러 등록
   */
  function on(topic: string, handler: MessageHandler) {
    if (!messageHandlers.value.has(topic)) {
      messageHandlers.value.set(topic, new Set())
    }
    messageHandlers.value.get(topic)!.add(handler)
  }

  /**
   * topic 메시지 핸들러 제거
   */
  function off(topic: string, handler: MessageHandler) {
    const handlers = messageHandlers.value.get(topic)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        messageHandlers.value.delete(topic)
      }
    }
  }

  /**
   * 연결 종료
   */
  function disconnect() {
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value)
      reconnectTimer.value = null
    }

    if (ws.value) {
      ws.value.close()
      ws.value = null
    }

    isConnected.value = false
    messageHandlers.value.clear()
    subscribedTopics.value.clear()
  }

  // cleanup
  onUnmounted(() => {
    disconnect()
  })

  return {
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    publish,
    on,
    off,
    isConnected,
  }
}
