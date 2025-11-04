import { ref, onMounted, onUnmounted } from 'vue'
import type { WebrtcProvider } from 'y-webrtc'

export interface ConnectedUser {
  clientId: number
  userUuid: string
  nickname: string
}

/**
 * 채팅방에 접속한 사용자 목록을 추적하는 composable
 * awareness 상태를 모니터링하여 실시간으로 접속자 정보를 업데이트합니다.
 */
export function useConnectedUsers(provider: WebrtcProvider, currentUserUuid: string) {
  const connectedUsers = ref<ConnectedUser[]>([])
  const userCount = ref(0)

  const updateConnectedUsers = () => {
    const users: ConnectedUser[] = []
    const awarenessStates = provider.awareness.getStates()

    for (const [clientId, state] of awarenessStates) {
      const stateObj = state as Record<string, unknown>
      const userUuid = stateObj.userUuid as string | undefined

      if (userUuid && userUuid !== currentUserUuid) {
        // 닉네임은 awareness에서 가져오거나 UUID의 마지막 8자리 사용
        const nickname = (stateObj.nickname as string) || userUuid.slice(-8)

        users.push({
          clientId,
          userUuid,
          nickname,
        })
      }
    }

    connectedUsers.value = users
    userCount.value = users.length

    console.log(`[ConnectedUsers] 현재 접속자: ${userCount.value}명`, users)
  }

  const handleAwarenessChange = () => {
    updateConnectedUsers()
  }

  const handlePeersChange = () => {
    updateConnectedUsers()
  }

  onMounted(() => {
    // 초기 접속자 목록 가져오기
    updateConnectedUsers()

    // awareness 변경 및 peer 변경 이벤트 리스너 등록
    provider.awareness.on('change', handleAwarenessChange)
    provider.on('peers', handlePeersChange)
  })

  onUnmounted(() => {
    // 이벤트 리스너 해제
    provider.awareness.off('change', handleAwarenessChange)
    provider.off('peers', handlePeersChange)
  })

  return {
    connectedUsers,
    userCount,
    updateConnectedUsers,
  }
}
