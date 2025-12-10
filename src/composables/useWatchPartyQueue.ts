import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import * as Y from 'yjs'
import type { WebrtcProvider } from 'y-webrtc'
import type { QueueItem } from './useYouTubePlaylist'

/**
 * 재생 상태 타입 정의
 */
interface PlaybackState {
  videoId: string | null
  playingUserId: string | null
  videoQueueIndex: number
  userIndex: number
  itemIndex: number
  currentTime: number
  isPlaying: boolean
  lastUpdate: number
}

/**
 * Watch Party 글로벌 대기열 관리
 * 각 사용자의 개인 대기열을 라운드 로빈 방식으로 무한 순환
 */
export function useWatchPartyQueue(doc: Y.Doc, currentUserId: string, currentUserName?: string, provider?: WebrtcProvider) {
  // Yjs Map: userId -> QueueItem[]
  const userQueuesMap = doc.getMap<QueueItem[]>('watchPartyQueues')

  // Yjs Map: 현재 재생 상태
  const playbackStateMap = doc.getMap<PlaybackState[keyof PlaybackState]>('watchPartyPlayback')

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

  /**
   * 현재 재생 중인 영상을 큐에서 찾기
   */
  const findCurrentVideoInQueue = (queue: QueueItem[] | undefined): QueueItem | null => {
    if (!queue || queue.length === 0) return null
    if (currentVideoQueueIndex.value >= queue.length) return null

    let currentItem = queue[currentVideoQueueIndex.value]

    // 큐가 변경되어 인덱스의 영상이 달라진 경우, videoId로 재검색
    if (currentItem && currentItem.videoId !== currentVideoId.value) {
      const actualIdx = queue.findIndex(item => item.videoId === currentVideoId.value)
      if (actualIdx !== -1) {
        currentItem = queue[actualIdx]
        playbackStateMap.set('videoQueueIndex', actualIdx)
      }
    }

    return currentItem || null
  }

  // 현재 재생 위치 (라운드로빈)
  // userIndex: 현재 사용자 인덱스 (사용자 목록에서)
  // itemIndex: 해당 라운드에서 몇 번째인지 (순환)
  const currentUserIndex = ref(0)
  const currentItemIndex = ref(0)
  const currentVideoId = ref<string | null>(null)
  const currentPlayingUserId = ref<string | null>(null) // 현재 재생중인 사용자 ID
  const currentVideoQueueIndex = ref(0) // 현재 재생중인 영상의 해당 사용자 큐 내 인덱스

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

  // 안정적인 사용자 순서 유지 (재생 순서 보장)
  // 이 배열은 사용자가 활성화된 순서를 기록하며, computed가 아닌 ref로 관리
  const stableUserOrder = ref<string[]>([])

  // 이전 활성 사용자 Set (변경 감지용)
  const previousActiveUserSet = ref<Set<string>>(new Set())

  // 각 사용자별 시작 라운드 (활성화된 시점의 itemIndex)
  // 새로 활성화된 사용자는 다음 라운드부터 참여
  const userStartRound = ref<Map<string, number>>(new Map())

  /**
   * 현재 활성화 가능한 사용자 Set 계산
   * (큐가 있고 비활성화되지 않은 사용자)
   */
  const currentActiveUserSet = computed(() => {
    return new Set(
      allUsers.value.filter(userId => !disabledUsers.value.has(userId))
    )
  })

  /**
   * stableUserOrder 업데이트 함수
   * activeUsers computed의 side effect를 제거하고 명시적으로 호출
   */
  function updateStableUserOrder() {
    const currentSet = currentActiveUserSet.value
    const prevSet = previousActiveUserSet.value

    // 새로 추가된 사용자 (이전에 없었거나 비활성화되어 있었음)
    const newlyActivated: string[] = []
    for (const userId of currentSet) {
      if (!prevSet.has(userId)) {
        newlyActivated.push(userId)
      }
    }

    // 비활성화된 사용자 (이전에는 있었는데 현재 없음)
    const deactivated: string[] = []
    for (const userId of prevSet) {
      if (!currentSet.has(userId)) {
        deactivated.push(userId)
      }
    }

    // 변경이 없으면 업데이트하지 않음
    if (newlyActivated.length === 0 && deactivated.length === 0) {
      return
    }

    // stableUserOrder 업데이트
    let newOrder = [...stableUserOrder.value]

    // 1. 비활성화된 사용자 제거
    if (deactivated.length > 0) {
      newOrder = newOrder.filter(userId => !deactivated.includes(userId))
      // 시작 라운드 정보도 제거
      deactivated.forEach(userId => userStartRound.value.delete(userId))
      console.log(`[WatchPartyQueue] Removed users from order:`, deactivated)

      // 현재 재생 중인 사용자가 비활성화되었으면 다음 곡으로 넘어가기
      if (currentPlayingUserId.value && deactivated.includes(currentPlayingUserId.value)) {
        console.log(`[WatchPartyQueue] Current playing user disabled, will skip to next`)
        // 다음 틱에서 playNext 호출 (현재 상태 업데이트 완료 후)
        setTimeout(() => {
          const users = stableUserOrder.value.filter(uid => currentActiveUserSet.value.has(uid))
          if (users.length > 0) {
            // 다음 사용자의 영상으로 이동
            const nextUserId = users[0]!
            const queue = userQueues.value.get(nextUserId)
            if (queue?.length) {
              const startRound = userStartRound.value.get(nextUserId) || 0
              const effectiveItemIdx = Math.max(0, currentItemIndex.value - startRound)
              const actualItemIdx = effectiveItemIdx % queue.length
              const nextItem = queue[actualItemIdx]!

              playbackStateMap.set('videoId', nextItem.videoId)
              playbackStateMap.set('playingUserId', nextUserId)
              playbackStateMap.set('videoQueueIndex', actualItemIdx)
              playbackStateMap.set('userIndex', 0)
              // itemIndex는 유지 (라운드 유지)
              playbackStateMap.set('currentTime', 0)
              playbackStateMap.set('isPlaying', true)
              playbackStateMap.set('lastUpdate', Date.now())
              console.log(`[WatchPartyQueue] Skipped to next user: ${nextUserId}`)
            }
          }
        }, 0)
      }
    }

    // 2. 새로 활성화된 사용자를 맨 뒤에 추가 (라운드로빈의 마지막)
    if (newlyActivated.length > 0) {
      // 정렬하여 일관된 순서 보장
      newlyActivated.sort()
      newOrder = [...newOrder, ...newlyActivated]

      // 새로 활성화된 사용자의 시작 라운드 설정
      // 현재 라운드(currentItemIndex)부터 참여하되, activeUsers 순서에서 맨 뒤이므로
      // 같은 라운드 내에서도 기존 사용자들 뒤에 배치됨
      const currentRound = currentItemIndex.value
      newlyActivated.forEach(userId => {
        userStartRound.value.set(userId, currentRound)
        console.log(`[WatchPartyQueue] User ${userId} will start from round ${currentRound}`)
      })
      console.log(`[WatchPartyQueue] Added users to order:`, newlyActivated)
    }

    // 3. 여전히 활성화된 사용자만 필터링 (안전장치)
    newOrder = newOrder.filter(userId => currentSet.has(userId))

    // 상태 업데이트
    stableUserOrder.value = newOrder
    previousActiveUserSet.value = new Set(currentSet)
    console.log(`[WatchPartyQueue] Updated stableUserOrder:`, newOrder)
  }

  // currentActiveUserSet이 변경될 때 stableUserOrder 업데이트
  // (disabledUsers 또는 allUsers 변경 시 자동으로 트리거됨)
  watch(
    currentActiveUserSet,
    () => {
      updateStableUserOrder()
    },
    { immediate: false }
  )

  /**
   * 활성 사용자 목록 (대기열이 있고 비활성화되지 않은 사용자만)
   *
   * 핵심 로직:
   * - 기존에 활성화되어 있던 사용자는 기존 순서 유지
   * - 새로 활성화된 사용자는 **맨 뒤에 추가** (라운드로빈의 마지막)
   * - 비활성화된 사용자는 목록에서 제거되고, 다시 활성화되면 맨 뒤에 추가
   */
  const activeUsers = computed(() => {
    // stableUserOrder에서 현재 활성화된 사용자만 필터링하여 반환
    // (updateStableUserOrder가 이미 순서를 관리하므로 여기서는 필터링만)
    const currentSet = currentActiveUserSet.value
    return stableUserOrder.value.filter(userId => currentSet.has(userId))
  })

  /**
   * 현재 위치에서 다음 N개 영상 미리보기 생성 (라운드로빈 무한 반복)
   *
   * 핵심 로직:
   * - 현재 재생 중인 영상은 해당 사용자가 비활성화되어도 계속 표시
   * - 다음 영상부터는 활성화된 사용자들만 라운드로빈
   * - 사용자가 다시 활성화되면 activeUsers의 맨 뒤에 추가되어 있으므로
   *   자연스럽게 라운드로빈 순서의 마지막에 배치됨
   */
  const globalQueue = computed<QueueItem[]>(() => {
    const result: QueueItem[] = []
    const users = activeUsers.value

    // 현재 재생 중인 영상 처리 (비활성화 여부와 관계없이 표시)
    if (currentVideoId.value && currentPlayingUserId.value) {
      const playingUserId = currentPlayingUserId.value
      const currentQueue = userQueues.value.get(playingUserId)
      const currentItem = findCurrentVideoInQueue(currentQueue)

      if (currentItem) {
        const userName = userNames.value.get(playingUserId) ||
                        playingUserId.replace('user-', '').slice(0, 8)

        result.push({
          ...currentItem,
          addedBy: userName,
        })
      }
    }

    // 활성 사용자가 없으면 현재 재생 중인 영상만 반환
    if (users.length === 0) return result

    // 다음 영상들 계산을 위한 시작점 결정
    // 현재 재생 중인 사용자가 활성 목록에 있으면 그 다음부터, 없으면 첫 번째부터
    let userIdx: number
    let itemIdx: number

    if (currentPlayingUserId.value) {
      const playingUserIdxInActive = users.indexOf(currentPlayingUserId.value)

      if (playingUserIdxInActive !== -1) {
        // 재생 중인 사용자가 활성 목록에 있음 -> 다음 사용자부터 시작
        userIdx = playingUserIdxInActive + 1
        itemIdx = currentItemIndex.value

        if (userIdx >= users.length) {
          userIdx = 0
          itemIdx++
        }
      } else {
        // 재생 중인 사용자가 비활성화됨 -> 활성 목록의 첫 번째부터 시작
        // 현재 라운드(itemIndex)를 유지
        userIdx = 0
        itemIdx = currentItemIndex.value
      }
    } else {
      // 재생 중인 영상이 없음 -> 처음부터
      userIdx = 0
      itemIdx = 0
    }

    // 최대 20개까지 생성
    const maxItems = 20

    for (let i = result.length; i < maxItems; i++) {
      if (users.length === 0) break

      userIdx = userIdx % users.length
      const userId = users[userIdx]!
      const queue = userQueues.value.get(userId)

      // 큐가 있고 비어있지 않은 경우에만 처리
      if (queue?.length) {
        // 해당 사용자의 시작 라운드 확인
        const startRound = userStartRound.value.get(userId) || 0

        // 현재 라운드가 시작 라운드보다 크거나 같을 때만 영상 추가
        if (itemIdx >= startRound) {
          const effectiveItemIdx = itemIdx - startRound
          const actualItemIdx = effectiveItemIdx % queue.length
          const item = queue[actualItemIdx]

          if (item) {
            const userName = userNames.value.get(userId) || userId.replace('user-', '').slice(0, 8)
            result.push({
              ...item,
              addedBy: userName,
            })
          }
        }
        // 시작 라운드 전이면 이 사용자 건너뛰고 다음 사용자로
      }

      // 다음 사용자로 이동
      userIdx++
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

    // stableUserOrder 초기화 (첫 로드 시)
    // 이미 초기화된 경우에는 activeUsers computed에서 관리
    if (stableUserOrder.value.length === 0 && newQueues.size > 0) {
      const initialUsers: string[] = []
      newQueues.forEach((queue, userId) => {
        if (queue.length > 0 && !newDisabled.has(userId)) {
          initialUsers.push(userId)
        }
      })
      initialUsers.sort() // 일관된 초기 순서
      stableUserOrder.value = initialUsers
      previousActiveUserSet.value = new Set(initialUsers)
      // 초기 사용자들은 라운드 0부터 시작
      initialUsers.forEach(userId => {
        userStartRound.value.set(userId, 0)
      })
      console.log(`[WatchPartyQueue] Initialized stableUserOrder:`, initialUsers)
    }

    // 재생 상태 동기화
    const videoId = playbackStateMap.get('videoId') as string | null
    const playingUserId = playbackStateMap.get('playingUserId') as string | null | undefined
    const videoQueueIdx = playbackStateMap.get('videoQueueIndex') as number | undefined
    const userIdx = playbackStateMap.get('userIndex') as number | undefined
    const itemIdx = playbackStateMap.get('itemIndex') as number | undefined
    const playing = playbackStateMap.get('isPlaying') as boolean | undefined
    const time = playbackStateMap.get('currentTime') as number | undefined

    if (videoId !== undefined) currentVideoId.value = videoId
    if (playingUserId !== undefined) currentPlayingUserId.value = playingUserId
    if (videoQueueIdx !== undefined) currentVideoQueueIndex.value = videoQueueIdx
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

    // 인덱스 유효성 검사
    if (index < 0 || index >= myQueue.length) return

    const newQueue = [...myQueue]
    newQueue.splice(index, 1)
    userQueuesMap.set(currentUserId, newQueue)
    console.log(`[WatchPartyQueue] Removed video at index ${index}`)
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

    // 인덱스 유효성 검사
    const isValidIndex = (idx: number) => idx >= 0 && idx < myQueue.length
    if (!isValidIndex(fromIndex) || !isValidIndex(toIndex)) return

    const newQueue = [...myQueue]
    const [movedItem] = newQueue.splice(fromIndex, 1)
    newQueue.splice(toIndex, 0, movedItem!)

    userQueuesMap.set(currentUserId, newQueue)
    console.log(`[WatchPartyQueue] Reordered: ${fromIndex} -> ${toIndex}`)
  }

  /**
   * 내 대기열에서 특정 영상을 다음 내 차례에 재생되도록 배치
   * 글로벌 큐 상에서 다음번 내 영상 순번에 해당 영상을 배치
   */
  function moveToNextMyTurn(index: number) {
    const myQueue = userQueuesMap.get(currentUserId) || []

    // 세이프가드: 인덱스 검증
    if (index < 0 || index >= myQueue.length) return

    const users = activeUsers.value
    const myUserIndex = users.indexOf(currentUserId)

    // 세이프가드: 활성 사용자 목록에 없음
    if (myUserIndex === -1) {
      console.log(`[WatchPartyQueue] Current user not in active users`)
      return
    }

    const currentVideo = globalQueue.value[0]
    const myUserName = userNames.value.get(currentUserId) || currentUserId.replace('user-', '').slice(0, 8)
    const isMyTurn = currentVideo?.addedBy === myUserName

    // 타겟 위치 계산
    const targetPosition = isMyTurn
      ? (currentItemIndex.value % myQueue.length + 1) % myQueue.length
      : findNextMyTurnPosition(users, myQueue)

    // 영상을 목표 위치로 이동
    const newQueue = [...myQueue]
    const [movedItem] = newQueue.splice(index, 1)
    newQueue.splice(targetPosition, 0, movedItem!)

    userQueuesMap.set(currentUserId, newQueue)
    console.log(`[WatchPartyQueue] Moved to next my turn: ${index} -> ${targetPosition}`)
  }

  /**
   * 글로벌 큐에서 다음 내 차례 위치 찾기
   */
  function findNextMyTurnPosition(users: string[], myQueue: QueueItem[]): number {
    let userIdx = currentUserIndex.value
    let itemIdx = currentItemIndex.value

    for (let i = 0; i < users.length * 2; i++) {
      userIdx++
      if (userIdx >= users.length) {
        userIdx = 0
        itemIdx++
      }

      if (users[userIdx] === currentUserId) {
        return itemIdx % myQueue.length
      }
    }

    return 0
  }

  /**
   * 다음 영상으로 이동 (무한 순환)
   *
   * 핵심 로직:
   * - 현재 재생 중인 사용자가 활성 목록에 있으면, 그 다음 사용자로 이동
   * - 현재 재생 중인 사용자가 비활성화되었으면, 활성 목록의 첫 번째 사용자로 이동
   * - 각 사용자의 시작 라운드를 고려하여 아직 참여하지 않은 사용자는 건너뜀
   */
  function playNext() {
    const users = activeUsers.value

    // 세이프가드: 빈 사용자 목록
    if (users.length === 0) {
      console.log(`[WatchPartyQueue] No active users with videos`)
      return false
    }

    let newUserIndex: number
    let newItemIndex: number

    // 현재 재생 중인 사용자의 위치 확인
    const currentPlayingIdx = currentPlayingUserId.value
      ? users.indexOf(currentPlayingUserId.value)
      : -1

    if (currentPlayingIdx !== -1) {
      // 현재 재생 중인 사용자가 활성 목록에 있음
      // -> 다음 사용자로 이동
      newUserIndex = currentPlayingIdx + 1
      newItemIndex = currentItemIndex.value

      if (newUserIndex >= users.length) {
        newUserIndex = 0
        newItemIndex++
      }
    } else {
      // 현재 재생 중인 사용자가 비활성화됨
      // -> 활성 목록의 첫 번째 사용자로 이동 (같은 라운드 유지)
      newUserIndex = 0
      newItemIndex = currentItemIndex.value
    }

    // 시작 라운드가 도래하지 않은 사용자는 건너뛰기
    let attempts = 0
    const maxAttempts = users.length * 2 // 무한 루프 방지

    while (attempts < maxAttempts) {
      const userId = users[newUserIndex]!
      const startRound = userStartRound.value.get(userId) || 0

      if (newItemIndex >= startRound) {
        // 이 사용자는 참여 가능
        const queue = userQueues.value.get(userId)
        if (queue?.length) {
          const effectiveItemIdx = newItemIndex - startRound
          const actualItemIdx = effectiveItemIdx % queue.length
          const nextItem = queue[actualItemIdx]!

          playbackStateMap.set('videoId', nextItem.videoId)
          playbackStateMap.set('playingUserId', userId)
          playbackStateMap.set('videoQueueIndex', actualItemIdx)
          playbackStateMap.set('userIndex', newUserIndex)
          playbackStateMap.set('itemIndex', newItemIndex)
          playbackStateMap.set('currentTime', 0)
          playbackStateMap.set('isPlaying', true)
          playbackStateMap.set('lastUpdate', Date.now())
          console.log(`[WatchPartyQueue] Playing next: ${nextItem.videoId} (user: ${userId}, userIdx: ${newUserIndex}, itemIdx: ${newItemIndex}, startRound: ${startRound})`)
          return true
        }
      }

      // 다음 사용자로 이동
      newUserIndex++
      if (newUserIndex >= users.length) {
        newUserIndex = 0
        newItemIndex++
      }
      attempts++
    }

    console.log(`[WatchPartyQueue] Failed to find next video`)
    return false
  }

  /**
   * 이전 영상으로 이동 (무한 순환, 처음으로 돌아갈 수 있음)
   *
   * 핵심 로직:
   * - 현재 재생 중인 사용자가 활성 목록에 있으면, 그 이전 사용자로 이동
   * - 현재 재생 중인 사용자가 비활성화되었으면, 활성 목록의 마지막 사용자로 이동
   */
  function playPrevious() {
    const users = activeUsers.value

    // 세이프가드: 빈 사용자 목록
    if (users.length === 0) return false

    let newUserIndex: number
    let newItemIndex: number

    // 현재 재생 중인 사용자의 위치 확인
    const currentPlayingIdx = currentPlayingUserId.value
      ? users.indexOf(currentPlayingUserId.value)
      : -1

    if (currentPlayingIdx !== -1) {
      // 현재 재생 중인 사용자가 활성 목록에 있음
      newUserIndex = currentPlayingIdx - 1
      newItemIndex = currentItemIndex.value

      if (newUserIndex < 0) {
        newUserIndex = users.length - 1
        newItemIndex = Math.max(0, newItemIndex - 1)
      }
    } else {
      // 현재 재생 중인 사용자가 비활성화됨
      // -> 활성 목록의 마지막 사용자로 이동 (이전 라운드)
      newUserIndex = users.length - 1
      newItemIndex = Math.max(0, currentItemIndex.value - 1)
    }

    // 시작 라운드가 도래하지 않은 사용자는 건너뛰기 (역방향)
    let attempts = 0
    const maxAttempts = users.length * 2

    while (attempts < maxAttempts) {
      const userId = users[newUserIndex]!
      const startRound = userStartRound.value.get(userId) || 0

      if (newItemIndex >= startRound) {
        const queue = userQueues.value.get(userId)
        if (queue?.length) {
          const effectiveItemIdx = newItemIndex - startRound
          const actualItemIdx = effectiveItemIdx % queue.length
          const prevItem = queue[actualItemIdx]!

          playbackStateMap.set('videoId', prevItem.videoId)
          playbackStateMap.set('playingUserId', userId)
          playbackStateMap.set('videoQueueIndex', actualItemIdx)
          playbackStateMap.set('userIndex', newUserIndex)
          playbackStateMap.set('itemIndex', newItemIndex)
          playbackStateMap.set('currentTime', 0)
          playbackStateMap.set('isPlaying', true)
          playbackStateMap.set('lastUpdate', Date.now())
          console.log(`[WatchPartyQueue] Playing previous: ${prevItem.videoId}`)
          return true
        }
      }

      // 이전 사용자로 이동
      newUserIndex--
      if (newUserIndex < 0) {
        newUserIndex = users.length - 1
        newItemIndex = Math.max(0, newItemIndex - 1)
      }
      attempts++
    }

    return false
  }

  /**
   * globalQueue 내에서 특정 인덱스의 영상 재생
   * (UI에서 미리보기 리스트 클릭 시 사용)
   *
   * 핵심 로직:
   * - globalQueue의 offset 위치를 기반으로 실제 재생할 영상 계산
   * - 현재 재생 중인 사용자의 활성화 상태에 따라 시작점 결정
   * - 각 사용자의 시작 라운드를 고려
   */
  function playAt(offsetInPreview: number) {
    const users = activeUsers.value

    // 세이프가드: 빈 사용자 목록 또는 유효하지 않은 오프셋
    if (users.length === 0 || offsetInPreview < 0) return false

    // offset 0은 현재 재생 중인 영상 (변경 없음)
    if (offsetInPreview === 0 && currentVideoId.value) return true

    // 시작점 결정
    let userIdx: number
    let itemIdx: number

    const currentPlayingIdx = currentPlayingUserId.value
      ? users.indexOf(currentPlayingUserId.value)
      : -1

    if (currentPlayingIdx !== -1) {
      // 현재 재생 중인 사용자가 활성 목록에 있음
      userIdx = currentPlayingIdx
      itemIdx = currentItemIndex.value
    } else {
      // 현재 재생 중인 사용자가 비활성화됨 또는 재생 중인 영상 없음
      // offset 1부터 시작해야 하므로 -1에서 시작
      userIdx = -1
      itemIdx = currentItemIndex.value
    }

    // offset만큼 이동 (시작 라운드 고려)
    let moved = 0
    let attempts = 0
    const maxAttempts = users.length * offsetInPreview * 2 // 충분한 시도 횟수

    while (moved < offsetInPreview && attempts < maxAttempts) {
      userIdx++
      if (userIdx >= users.length) {
        userIdx = 0
        itemIdx++
      }

      const userId = users[userIdx]!
      const startRound = userStartRound.value.get(userId) || 0

      // 시작 라운드가 도래한 사용자만 카운트
      if (itemIdx >= startRound) {
        moved++
      }
      attempts++
    }

    if (moved < offsetInPreview) {
      console.log(`[WatchPartyQueue] Failed to find video at offset ${offsetInPreview}`)
      return false
    }

    const userId = users[userIdx]!
    const queue = userQueues.value.get(userId)

    // 세이프가드: 빈 큐
    if (!queue?.length) return false

    const startRound = userStartRound.value.get(userId) || 0
    const effectiveItemIdx = itemIdx - startRound
    const actualItemIdx = effectiveItemIdx % queue.length
    const item = queue[actualItemIdx]!

    playbackStateMap.set('videoId', item.videoId)
    playbackStateMap.set('playingUserId', userId)
    playbackStateMap.set('videoQueueIndex', actualItemIdx)
    playbackStateMap.set('userIndex', userIdx)
    playbackStateMap.set('itemIndex', itemIdx)
    playbackStateMap.set('currentTime', 0)
    playbackStateMap.set('isPlaying', true)
    playbackStateMap.set('lastUpdate', Date.now())
    console.log(`[WatchPartyQueue] Playing at offset ${offsetInPreview}: ${item.videoId}`)
    return true
  }

  /**
   * 첫 영상 재생 시작 (재생목록이 비어있다가 첫 영상 추가 시)
   * 이미 재생 중인 영상이 있으면 아무것도 하지 않음
   */
  function playFirst() {
    // 세이프가드: 이미 재생 중
    if (currentVideoId.value) {
      console.log(`[WatchPartyQueue] Already playing: ${currentVideoId.value}, skipping playFirst`)
      return false
    }

    const users = activeUsers.value

    // 세이프가드: 빈 사용자 목록
    if (users.length === 0) return false

    const userId = users[0]!
    const queue = userQueues.value.get(userId)

    // 세이프가드: 빈 큐
    if (!queue?.length) return false

    const firstItem = queue[0]!

    playbackStateMap.set('videoId', firstItem.videoId)
    playbackStateMap.set('playingUserId', userId)
    playbackStateMap.set('videoQueueIndex', 0)
    playbackStateMap.set('userIndex', 0)
    playbackStateMap.set('itemIndex', 0)
    playbackStateMap.set('currentTime', 0)
    playbackStateMap.set('isPlaying', true)
    playbackStateMap.set('lastUpdate', Date.now())
    console.log(`[WatchPartyQueue] Playing first video: ${firstItem.videoId}`)
    return true
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
