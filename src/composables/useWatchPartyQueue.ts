import { ref, computed, onMounted, onUnmounted } from 'vue'
import * as Y from 'yjs'
import type { WebrtcProvider } from 'y-webrtc'
import type { QueueItem } from './useYouTubePlaylist'

/**
 * Watch Party 글로벌 대기열 관리
 * 각 사용자의 개인 대기열을 라운드 로빈 방식으로 무한 순환
 */
export function useWatchPartyQueue(doc: Y.Doc, currentUserId: string, currentUserName?: string, provider?: WebrtcProvider) {
  // Yjs Map: userId -> QueueItem[]
  const userQueuesMap = doc.getMap<QueueItem[]>('watchPartyQueues')

  // Yjs Map: 현재 재생 상태
  const playbackStateMap = doc.getMap('watchPartyPlayback')

  // Yjs Map: userId -> userName (사용자 이름 매핑)
  const userNamesMap = doc.getMap<string>('watchPartyUserNames')

  // Yjs Map: 비활성화된 사용자 목록 (userId -> boolean)
  const disabledUsersMap = doc.getMap<boolean>('watchPartyDisabledUsers')

  // 로컬 상태
  const userQueues = ref<Map<string, QueueItem[]>>(new Map())
  const userNames = ref<Map<string, string>>(new Map())
  const disabledUsers = ref<Set<string>>(new Set())
  const isPlaying = ref(false)
  const currentTime = ref(0)

  // 현재 사용자 이름 등록
  if (currentUserName) {
    userNamesMap.set(currentUserId, currentUserName)
  }

  // Awareness에서 다른 사용자들의 이름 동기화
  const syncUserNamesFromAwareness = () => {
    if (!provider) return

    const awarenessStates = provider.awareness.getStates()
    for (const [, state] of awarenessStates) {
      const stateObj = state as Record<string, unknown>
      const userUuid = stateObj.userUuid as string | undefined
      const nickname = stateObj.nickname as string | undefined

      if (userUuid && nickname) {
        const userId = `user-${userUuid}`
        const existingName = userNamesMap.get(userId)

        // Yjs Map에 다른 사용자의 이름 저장 (없거나 다른 경우만)
        if (!existingName || existingName !== nickname) {
          userNamesMap.set(userId, nickname)
          console.log(`[WatchPartyQueue] Synced user name: ${userId} -> ${nickname}`)
        }
      }
    }
  }

  const handleAwarenessChange = () => {
    syncUserNamesFromAwareness()
  }

  // 현재 재생 위치 (라운드로빈)
  // userIndex: 현재 사용자 인덱스 (사용자 목록에서)
  // itemIndex: 해당 라운드에서 몇 번째인지 (순환)
  const currentUserIndex = ref(0)
  const currentItemIndex = ref(0)
  const currentVideoId = ref<string | null>(null)

  /**
   * 모든 사용자 목록 (대기열이 있는 사용자 전체 - 비활성화 포함)
   */
  const allUsers = computed(() => {
    const users: string[] = []
    userQueues.value.forEach((queue, userId) => {
      if (queue.length > 0) {
        users.push(userId)
      }
    })
    return users.sort() // 일관된 순서를 위해 정렬
  })

  /**
   * 활성 사용자 목록 (대기열이 있고 비활성화되지 않은 사용자만)
   */
  const activeUsers = computed(() => {
    return allUsers.value.filter(userId => !disabledUsers.value.has(userId))
  })

  /**
   * 현재 위치에서 다음 N개 영상 미리보기 생성 (라운드로빈 무한 반복)
   */
  const globalQueue = computed<QueueItem[]>(() => {
    const result: QueueItem[] = []
    const users = activeUsers.value

    if (users.length === 0) return result

    let userIdx = currentUserIndex.value
    let itemIdx = currentItemIndex.value

    // 현재 재생 중인 videoId가 있으면, 해당 영상을 찾아서 시작
    if (currentVideoId.value) {
      const currentUserId = users[userIdx % users.length]
      const currentQueue = userQueues.value.get(currentUserId!)

      if (currentQueue && currentQueue.length > 0) {
        // 현재 큐에서 currentVideoId를 찾기
        const actualIdx = currentQueue.findIndex(item => item.videoId === currentVideoId.value)

        if (actualIdx !== -1) {
          // 찾았으면 그 인덱스로 시작
          const currentItem = currentQueue[actualIdx]!
          const userName = userNames.value.get(currentUserId!) || currentUserId!.replace('user-', '').slice(0, 8)
          result.push({
            ...currentItem,
            addedBy: userName,
          })

          // 다음부터는 기존 로직으로 계속
          userIdx++
          if (userIdx >= users.length) {
            userIdx = 0
            itemIdx++
          }
        }
      }
    }

    // 최대 20개까지 생성
    const maxItems = 20

    for (let i = result.length; i < maxItems; i++) {
      // 유효한 사용자 인덱스로 조정
      userIdx = userIdx % users.length

      const userId = users[userIdx]
      const queue = userQueues.value.get(userId!)
      if (queue && queue.length > 0) {
        // 순환 인덱스로 아이템 가져오기
        const actualItemIdx = itemIdx % queue.length
        const item = queue[actualItemIdx]
        if (item) {
          // 사용자 이름 가져오기 (없으면 userId 사용)
          const userName = userNames.value.get(userId!) || userId!.replace('user-', '').slice(0, 8)
          result.push({
            ...item,
            // 추가 정보: 누구의 큐에서 왔는지 (이름으로 표시)
            addedBy: userName,
          })
        }
      }

      // 다음 사용자로 이동
      userIdx++

      // 한 바퀴 돌았으면 itemIndex 증가
      if (userIdx >= users.length) {
        userIdx = 0
        itemIdx++
      }
    }

    return result
  })

  /**
   * 현재 재생중인 영상 정보
   */
  const currentVideo = computed<QueueItem | null>(() => {
    return globalQueue.value[0] || null
  })

  /**
   * 다음 영상 정보
   */
  const nextVideo = computed<QueueItem | null>(() => {
    return globalQueue.value[1] || null
  })

  /**
   * 현재 인덱스 (항상 0, globalQueue가 현재 위치부터 시작하므로)
   */
  const currentQueueIndex = computed(() => 0)

  /**
   * Yjs 상태 동기화
   */
  function syncFromYjs() {
    const newQueues = new Map<string, QueueItem[]>()

    userQueuesMap.forEach((queue, userId) => {
      newQueues.set(userId, queue || [])
    })

    userQueues.value = newQueues

    // 사용자 이름 동기화
    const newNames = new Map<string, string>()
    userNamesMap.forEach((name, userId) => {
      newNames.set(userId, name)
    })
    userNames.value = newNames

    // 비활성화된 사용자 동기화
    const newDisabled = new Set<string>()
    disabledUsersMap.forEach((disabled, userId) => {
      if (disabled) {
        newDisabled.add(userId)
      }
    })
    disabledUsers.value = newDisabled

    // 재생 상태 동기화
    const videoId = playbackStateMap.get('videoId') as string | null
    const userIdx = playbackStateMap.get('userIndex') as number | undefined
    const itemIdx = playbackStateMap.get('itemIndex') as number | undefined
    const playing = playbackStateMap.get('isPlaying') as boolean | undefined
    const time = playbackStateMap.get('currentTime') as number | undefined

    if (videoId !== undefined) currentVideoId.value = videoId
    if (userIdx !== undefined) currentUserIndex.value = userIdx
    if (itemIdx !== undefined) currentItemIndex.value = itemIdx
    if (playing !== undefined) isPlaying.value = playing
    if (time !== undefined) currentTime.value = time
  }

  /**
   * 내 대기열에 영상 추가
   */
  function addToMyQueue(videoIds: string | string[]) {
    const ids = Array.isArray(videoIds) ? videoIds : [videoIds]
    const myQueue = userQueuesMap.get(currentUserId) || []

    const newItems: QueueItem[] = ids.map((videoId) => ({
      videoId,
      addedBy: currentUserId,
      addedAt: Date.now(),
    }))

    userQueuesMap.set(currentUserId, [...myQueue, ...newItems])
    console.log(`[WatchPartyQueue] Added ${ids.length} video(s) to my queue`)
  }

  /**
   * 내 대기열에서 영상 제거
   */
  function removeFromMyQueue(index: number) {
    const myQueue = userQueuesMap.get(currentUserId) || []
    if (index >= 0 && index < myQueue.length) {
      const newQueue = [...myQueue]
      newQueue.splice(index, 1)
      userQueuesMap.set(currentUserId, newQueue)
      console.log(`[WatchPartyQueue] Removed video at index ${index}`)
    }
  }

  /**
   * 내 대기열 초기화
   */
  function clearMyQueue() {
    userQueuesMap.set(currentUserId, [])
    console.log(`[WatchPartyQueue] Cleared my queue`)
  }

  /**
   * 내 대기열 셔플
   */
  function shuffleMyQueue() {
    const myQueue = userQueuesMap.get(currentUserId) || []
    if (myQueue.length <= 1) return

    const shuffled = [...myQueue]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = shuffled[i]!
      shuffled[i] = shuffled[j]!
      shuffled[j] = temp
    }

    userQueuesMap.set(currentUserId, shuffled)
    console.log(`[WatchPartyQueue] Shuffled my queue`)
  }

  /**
   * 내 대기열에서 영상 순서 변경
   */
  function reorderMyQueue(fromIndex: number, toIndex: number) {
    const myQueue = userQueuesMap.get(currentUserId) || []
    if (fromIndex < 0 || fromIndex >= myQueue.length || toIndex < 0 || toIndex >= myQueue.length) {
      return
    }

    const newQueue = [...myQueue]
    const movedItem = newQueue[fromIndex]!
    newQueue.splice(fromIndex, 1)
    newQueue.splice(toIndex, 0, movedItem)

    userQueuesMap.set(currentUserId, newQueue)
    console.log(`[WatchPartyQueue] Reordered: ${fromIndex} -> ${toIndex}`)
  }

  /**
   * 내 대기열에서 특정 영상을 다음 내 차례에 재생되도록 배치
   * 글로벌 큐 상에서 다음번 내 영상 순번에 해당 영상을 배치
   */
  function moveToNextMyTurn(index: number) {
    const myQueue = userQueuesMap.get(currentUserId) || []
    if (index < 0 || index >= myQueue.length) {
      return
    }

    const users = activeUsers.value
    const myUserIndex = users.indexOf(currentUserId)

    if (myUserIndex === -1) {
      console.log(`[WatchPartyQueue] Current user not in active users`)
      return
    }

    // 글로벌 큐에서 다음 내 차례를 찾기
    // 현재 재생 중인 영상이 내 것인지 확인
    const currentVideo = globalQueue.value[0]
    const isMyTurn = currentVideo?.addedBy === (userNames.value.get(currentUserId) || currentUserId.replace('user-', '').slice(0, 8))

    let targetPosition = 0

    if (isMyTurn) {
      // 현재 내 영상이 재생 중이면, 내 큐에서 현재 재생 중인 다음 위치에 삽입
      // 현재 재생 중인 영상의 내 큐 내 인덱스 찾기
      const currentItemIdx = currentItemIndex.value % myQueue.length
      targetPosition = (currentItemIdx + 1) % myQueue.length
    } else {
      // 현재 다른 사람 영상이 재생 중이면, 글로벌 큐에서 다음 내 차례 찾기
      let userIdx = currentUserIndex.value
      let itemIdx = currentItemIndex.value

      // 다음 내 차례를 찾을 때까지 순회
      for (let i = 0; i < users.length * 2; i++) {
        userIdx++
        if (userIdx >= users.length) {
          userIdx = 0
          itemIdx++
        }

        if (users[userIdx] === currentUserId) {
          // 다음 내 차례를 찾음
          const queue = userQueues.value.get(currentUserId) || []
          targetPosition = itemIdx % queue.length
          break
        }
      }
    }

    // 영상을 목표 위치로 이동
    const newQueue = [...myQueue]
    const movedItem = newQueue[index]!
    newQueue.splice(index, 1)
    newQueue.splice(targetPosition, 0, movedItem)

    userQueuesMap.set(currentUserId, newQueue)
    console.log(`[WatchPartyQueue] Moved to next my turn: ${index} -> ${targetPosition}`)
  }

  /**
   * 다음 영상으로 이동 (무한 순환)
   */
  function playNext() {
    const users = activeUsers.value
    if (users.length === 0) {
      console.log(`[WatchPartyQueue] No videos in any queue`)
      return false
    }

    let newUserIndex = currentUserIndex.value + 1
    let newItemIndex = currentItemIndex.value

    // 한 바퀴 돌았으면 itemIndex 증가
    if (newUserIndex >= users.length) {
      newUserIndex = 0
      newItemIndex++
    }

    // 다음 영상 찾기 (빈 큐를 건너뜀)
    const userId = users[newUserIndex]
    const queue = userQueues.value.get(userId!)
    if (queue && queue.length > 0) {
      const actualItemIdx = newItemIndex % queue.length
      const nextItem = queue[actualItemIdx]

      if (nextItem) {
        playbackStateMap.set('videoId', nextItem.videoId)
        playbackStateMap.set('userIndex', newUserIndex)
        playbackStateMap.set('itemIndex', newItemIndex)
        playbackStateMap.set('currentTime', 0)
        playbackStateMap.set('isPlaying', true)
        playbackStateMap.set('lastUpdate', Date.now())
        console.log(`[WatchPartyQueue] Playing next: ${nextItem.videoId} (user: ${userId}, item: ${actualItemIdx})`)
        return true
      }
    }

    console.log(`[WatchPartyQueue] Failed to find next video`)
    return false
  }

  /**
   * 이전 영상으로 이동 (무한 순환, 처음으로 돌아갈 수 있음)
   */
  function playPrevious() {
    const users = activeUsers.value
    if (users.length === 0) {
      return false
    }

    let newUserIndex = currentUserIndex.value - 1
    let newItemIndex = currentItemIndex.value

    // 처음이면 이전 라운드의 마지막 사용자로
    if (newUserIndex < 0) {
      newUserIndex = users.length - 1
      newItemIndex = Math.max(0, newItemIndex - 1)
    }

    // 이전 영상 찾기
    const userId = users[newUserIndex]
    const queue = userQueues.value.get(userId!)
    if (queue && queue.length > 0) {
      const actualItemIdx = newItemIndex % queue.length
      const prevItem = queue[actualItemIdx]

      if (prevItem) {
        playbackStateMap.set('videoId', prevItem.videoId)
        playbackStateMap.set('userIndex', newUserIndex)
        playbackStateMap.set('itemIndex', newItemIndex)
        playbackStateMap.set('currentTime', 0)
        playbackStateMap.set('isPlaying', true)
        playbackStateMap.set('lastUpdate', Date.now())
        console.log(`[WatchPartyQueue] Playing previous: ${prevItem.videoId}`)
        return true
      }
    }

    return false
  }

  /**
   * globalQueue 내에서 특정 인덱스의 영상 재생
   * (UI에서 미리보기 리스트 클릭 시 사용)
   */
  function playAt(offsetInPreview: number) {
    const users = activeUsers.value
    if (users.length === 0 || offsetInPreview < 0) return false

    // 현재 위치에서 offset만큼 이동한 위치 계산
    let userIdx = currentUserIndex.value
    let itemIdx = currentItemIndex.value

    for (let i = 0; i < offsetInPreview; i++) {
      userIdx++
      if (userIdx >= users.length) {
        userIdx = 0
        itemIdx++
      }
    }

    const userId = users[userIdx]
    const queue = userQueues.value.get(userId!)
    if (queue && queue.length > 0) {
      const actualItemIdx = itemIdx % queue.length
      const item = queue[actualItemIdx]

      if (item) {
        playbackStateMap.set('videoId', item.videoId)
        playbackStateMap.set('userIndex', userIdx)
        playbackStateMap.set('itemIndex', itemIdx)
        playbackStateMap.set('currentTime', 0)
        playbackStateMap.set('isPlaying', true)
        playbackStateMap.set('lastUpdate', Date.now())
        console.log(`[WatchPartyQueue] Playing at offset ${offsetInPreview}: ${item.videoId}`)
        return true
      }
    }

    return false
  }

  /**
   * 첫 영상 재생 시작 (재생목록이 비어있다가 첫 영상 추가 시)
   * 이미 재생 중인 영상이 있으면 아무것도 하지 않음
   */
  function playFirst() {
    // 이미 재생 중인 영상이 있으면 무시
    if (currentVideoId.value) {
      console.log(`[WatchPartyQueue] Already playing: ${currentVideoId.value}, skipping playFirst`)
      return false
    }

    const users = activeUsers.value
    if (users.length === 0) return false

    const userId = users[0]
    const queue = userQueues.value.get(userId!)
    if (queue && queue.length > 0) {
      const firstItem = queue[0]

      playbackStateMap.set('videoId', firstItem!.videoId)
      playbackStateMap.set('userIndex', 0)
      playbackStateMap.set('itemIndex', 0)
      playbackStateMap.set('currentTime', 0)
      playbackStateMap.set('isPlaying', true)
      playbackStateMap.set('lastUpdate', Date.now())
      console.log(`[WatchPartyQueue] Playing first video: ${firstItem!.videoId}`)
      return true
    }

    return false
  }

  /**
   * 재생/일시정지 토글
   */
  function togglePlayback() {
    playbackStateMap.set('isPlaying', !isPlaying.value)
    playbackStateMap.set('lastUpdate', Date.now())
  }

  /**
   * 재생 시간 업데이트
   */
  function updateTime(time: number) {
    playbackStateMap.set('currentTime', time)
    playbackStateMap.set('lastUpdate', Date.now())
  }

  /**
   * 시간 이동 (seek)
   */
  function seekTo(time: number) {
    playbackStateMap.set('currentTime', time)
    playbackStateMap.set('lastUpdate', Date.now())
    console.log(`[WatchPartyQueue] Seek to ${time}s`)
  }

  // Yjs 변경 감지
  userQueuesMap.observe(() => {
    syncFromYjs()
  })

  playbackStateMap.observe(() => {
    syncFromYjs()
  })

  userNamesMap.observe(() => {
    syncFromYjs()
  })

  disabledUsersMap.observe(() => {
    syncFromYjs()
  })

  // 초기 동기화
  syncFromYjs()

  // Awareness 이벤트 리스너 설정
  if (provider) {
    onMounted(() => {
      // 초기 사용자 이름 동기화
      syncUserNamesFromAwareness()

      // Awareness 변경 이벤트 리스너
      provider.awareness.on('change', handleAwarenessChange)
    })

    onUnmounted(() => {
      provider.awareness.off('change', handleAwarenessChange)
    })
  }

  // 내 큐 상태 (computed)
  const myQueue = computed(() => userQueues.value.get(currentUserId) || [])

  /**
   * 사용자 플레이리스트 활성화/비활성화 토글
   */
  function toggleUserPlaylist(userId: string, enabled: boolean) {
    disabledUsersMap.set(userId, !enabled)
    console.log(`[WatchPartyQueue] User ${userId} playlist ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * 사용자가 비활성화되었는지 확인
   */
  function isUserDisabled(userId: string): boolean {
    return disabledUsers.value.has(userId)
  }

  /**
   * 특정 사용자의 재생목록 삭제
   */
  function deleteUserQueue(userId: string) {
    userQueuesMap.delete(userId)
    disabledUsersMap.delete(userId)
    console.log(`[WatchPartyQueue] Deleted user queue: ${userId}`)
  }

  /**
   * 내 재생목록을 JSON 파일로 내보내기
   */
  function exportMyPlaylist(): string {
    const myQueue = userQueuesMap.get(currentUserId) || []
    const data = {
      version: 1,
      exportedAt: Date.now(),
      userId: currentUserId,
      userName: currentUserName,
      playlist: myQueue.map(item => ({
        videoId: item.videoId,
        addedAt: item.addedAt,
      })),
    }
    return JSON.stringify(data, null, 2)
  }

  /**
   * JSON 파일에서 재생목록 가져오기
   * @param jsonString JSON 문자열
   * @param append true면 기존 목록에 추가, false면 대체
   */
  function importPlaylist(jsonString: string, append: boolean = true): boolean {
    try {
      const data = JSON.parse(jsonString)

      if (!data.playlist || !Array.isArray(data.playlist)) {
        console.error('[WatchPartyQueue] Invalid playlist format')
        return false
      }

      const myQueue = append ? (userQueuesMap.get(currentUserId) || []) : []

      const newItems: QueueItem[] = data.playlist.map((item: { videoId: string; addedAt?: number }) => ({
        videoId: item.videoId,
        addedBy: currentUserId,
        addedAt: item.addedAt || Date.now(),
      }))

      userQueuesMap.set(currentUserId, [...myQueue, ...newItems])
      console.log(`[WatchPartyQueue] Imported ${newItems.length} video(s)`)
      return true
    } catch (error) {
      console.error('[WatchPartyQueue] Failed to import playlist:', error)
      return false
    }
  }

  return {
    // 상태
    userQueues,
    userNames,
    globalQueue,
    currentVideo,
    nextVideo,
    myQueue,
    currentVideoId,
    currentQueueIndex,
    isPlaying,
    currentTime,
    activeUsers,
    allUsers,
    disabledUsers,

    // 메서드
    addToMyQueue,
    removeFromMyQueue,
    clearMyQueue,
    shuffleMyQueue,
    reorderMyQueue,
    moveToNextMyTurn,
    playNext,
    playPrevious,
    playAt,
    playFirst,
    togglePlayback,
    updateTime,
    seekTo,
    toggleUserPlaylist,
    isUserDisabled,
    deleteUserQueue,
    exportMyPlaylist,
    importPlaylist,
  }
}
