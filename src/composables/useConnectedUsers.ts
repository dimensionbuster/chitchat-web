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
      const isWatchParty = stateObj.isWatchParty as boolean | undefined

      // WatchParty 피어는 제외 (같은 사용자의 별도 창이므로)
      if (userUuid && userUuid !== currentUserUuid && !isWatchParty) {
        // 닉네임은 awareness에서 가져오기 (여러 위치 확인)
        const userObj = stateObj.user as { uuid?: string; nickname?: string } | undefined
        const nickname =
          (stateObj.nickname as string) || // setLocalStateField로 설정된 경우
          userObj?.nickname ||              // setLocalState로 설정된 경우
          userUuid.slice(-8)                // fallback

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
