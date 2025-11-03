/**
 * useProfilePicture
 *
 * 프로필 사진 처리 및 전송 관리
 * - 이미지 리사이징 및 압축
 * - 글로벌 큐를 통한 업로드/다운로드
 * - awareness를 통한 프로필 동기화
 */

import { ref, reactive, computed } from 'vue'
import type { WebrtcProvider } from 'y-webrtc'
import type { Map as YMap } from 'yjs'
import type { ProfilePicture, ProfilePictureAwareness, FileMeta } from '@/types/types'
import {
  saveProfilePicture,
  getProfilePicture,
  hasProfilePicture,
  deleteProfilePicture
} from './useStorageProfilePicture'
import { cacheFile, getCachedFile } from './useStorageFileCache'
import {
  useGlobalDataChannelQueue,
  createProfilePictureJob
} from './useGlobalDataChannelQueue'
import {
  PROFILE_PICTURE_MAX_SIZE,
  PROFILE_PICTURE_QUALITY,
  PROFILE_PICTURE_MAX_BYTES
} from './fileConstants'
import { showAlert } from './useCustomDialog'

/**
 * 이미지 파일을 리사이징하고 압축
 * @param file 원본 이미지 파일
 * @returns base64 인코딩된 이미지 데이터
 */
async function resizeAndCompressImage(file: File): Promise<{ data: string; size: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      img.src = e.target?.result as string
    }

    reader.onerror = reject

    img.onload = () => {
      try {
        // 캔버스 생성
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas context not available'))
          return
        }

        // 원본 비율 유지하며 리사이징
        let { width, height } = img
        const maxSize = PROFILE_PICTURE_MAX_SIZE

        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width
            width = maxSize
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height
            height = maxSize
          }
        }

        canvas.width = width
        canvas.height = height

        // 이미지 그리기
        ctx.drawImage(img, 0, 0, width, height)

        // JPEG로 압축 (품질 조정)
        let quality = PROFILE_PICTURE_QUALITY
        let dataUrl = canvas.toDataURL('image/jpeg', quality)

        // 크기 제한을 초과하면 품질을 낮춤
        while (dataUrl.length > PROFILE_PICTURE_MAX_BYTES * 1.37 && quality > 0.1) {
          // base64는 원본보다 약 1.37배 크므로 보정
          quality -= 0.1
          dataUrl = canvas.toDataURL('image/jpeg', quality)
        }

        // base64에서 헤더 제거 (data:image/jpeg;base64, 부분)
        const base64Data = dataUrl.split(',')[1] || dataUrl
        const byteSize = Math.ceil((base64Data.length * 3) / 4)

        console.log(`[ProfilePicture] 이미지 압축 완료: ${file.size} -> ${byteSize} bytes (품질: ${quality})`)

        resolve({
          data: base64Data,
          size: byteSize
        })
      } catch (error) {
        reject(error)
      }
    }

    img.onerror = reject

    reader.readAsDataURL(file)
  })
}

export function useProfilePicture(
  provider: WebrtcProvider | null,
  myUserId: string,
  files?: YMap<FileMeta>,
  registerFileAvailability?: (fileId: string) => Promise<void>
) {
  const { enqueue } = useGlobalDataChannelQueue()

  // 로컬 프로필 사진 캐시 (userId -> base64 data URL)
  const profilePictures = reactive<Map<string, string>>(new Map())

  // 내 프로필 사진
  const myProfilePicture = ref<string | null>(null)

  // 프로필 사진 요청 처리 중 목록 및 전송 이력
  const requestingProfiles = reactive<Set<string>>(new Set())

  // 이미 처리한 전송 (무한 루프 방지)
  const processedTransfers = reactive<Set<string>>(new Set())

  /**
   * 프로필 사진을 data URL로 변환
   */
  const toDataUrl = (base64: string): string => {
    if (base64.startsWith('data:')) return base64
    return `data:image/jpeg;base64,${base64}`
  }

  /**
   * 사용자 프로필 사진 가져오기 (캐시된 경우)
   */
  const getUserProfilePicture = computed(() => {
    return (userId: string): string | null => {
      const cached = profilePictures.get(userId)
      return cached ? toDataUrl(cached) : null
    }
  })

  /**
   * 내 프로필 사진 설정
   */
  const setMyProfilePicture = async (file: File): Promise<void> => {
    try {
      console.log(`[ProfilePicture] 프로필 사진 설정 시작: ${file.name}`)

      // 원본 파일 저장 (파일 전송 시스템 활용)
      const originalFileId = `profile-original-${myUserId}-${Date.now()}`
      const blob = new Blob([file], { type: file.type })
      await cacheFile(originalFileId, blob)

      console.log(`[ProfilePicture] 원본 파일 저장: ${originalFileId}, 크기: ${file.size} bytes`)

      // 파일 메타데이터 등록 (메시지로 추가하지 않고 files에만 추가)
      if (files) {
        const meta: FileMeta = {
          name: file.name,
          size: file.size,
          type: file.type
        }
        files.set(originalFileId, meta)
        console.log(`[ProfilePicture] 원본 파일 메타 등록: ${originalFileId}`)

        // 파일 소유권 awareness에 브로드캐스트 (다른 피어가 찾을 수 있도록)
        if (registerFileAvailability) {
          await registerFileAvailability(originalFileId)
          console.log(`[ProfilePicture] 원본 파일 소유권 브로드캐스트: ${originalFileId}`)
        }
      }

      // 이미지 리사이징 및 압축 (썸네일)
      const { data, size } = await resizeAndCompressImage(file)

      // 로컬 저장
      const profile: ProfilePicture = {
        userId: myUserId,
        imageData: data,
        timestamp: Date.now(),
        size,
        originalFileId // 원본 파일 ID 저장
      }

      await saveProfilePicture(profile)

      // 캐시 업데이트
      myProfilePicture.value = toDataUrl(data)
      profilePictures.set(myUserId, data)

      console.log(`[ProfilePicture] 프로필 사진 로컬 저장 완료: ${size} bytes`)

      // awareness에 프로필 사진 존재 알림 (originalFileId 포함)
      if (provider && provider.awareness) {
        provider.awareness.setLocalStateField('profilePicture', {
          userId: myUserId,
          hasProfilePicture: true,
          timestamp: profile.timestamp,
          originalFileId // 원본 파일 ID 포함하여 다른 피어가 요청할 수 있도록
        } as ProfilePictureAwareness)

        console.log('[ProfilePicture] awareness 업데이트 완료 (originalFileId 포함)')

        // 연결된 모든 피어에게 프로필 전송
        const peers = Array.from(provider.awareness.getStates().keys())
          .filter(clientId => {
            const state = provider.awareness!.getStates().get(clientId)
            const userUuid = (state as Record<string, unknown>)?.userUuid as string | undefined
            return userUuid && userUuid !== myUserId
          })
          .map(clientId => {
            const state = provider.awareness!.getStates().get(clientId)
            return (state as Record<string, unknown>)?.userUuid as string
          })

        console.log(`[ProfilePicture] 연결된 피어 ${peers.length}명에게 프로필 전송`)

        for (const peerId of peers) {
          if (peerId) {
            await sendProfilePicture(peerId)
          }
        }
      }
    } catch (error) {
      console.error('[ProfilePicture] 프로필 사진 설정 실패:', error)
      throw error
    }
  }

  /**
   * 내 프로필 사진 삭제
   */
  const deleteMyProfilePicture = async (): Promise<void> => {
    try {
      await deleteProfilePicture(myUserId)
      myProfilePicture.value = null
      profilePictures.delete(myUserId)

      // awareness 업데이트 (삭제도 전파)
      if (provider && provider.awareness) {
        const deleteTimestamp = Date.now()

        provider.awareness.setLocalStateField('profilePicture', {
          userId: myUserId,
          hasProfilePicture: false,
          timestamp: deleteTimestamp,
          originalFileId: undefined // 삭제 시에도 명시적으로 undefined 전달
        } as ProfilePictureAwareness)

        console.log('[ProfilePicture] awareness 업데이트 완료 (삭제 전파)')

        // 연결된 모든 피어에게 삭제 이벤트 전송
        const peers = Array.from(provider.awareness.getStates().keys())
          .filter(clientId => {
            const state = provider.awareness!.getStates().get(clientId)
            const userUuid = (state as Record<string, unknown>)?.userUuid as string | undefined
            return userUuid && userUuid !== myUserId
          })
          .map(clientId => {
            const state = provider.awareness!.getStates().get(clientId)
            return (state as Record<string, unknown>)?.userUuid as string
          })

        console.log(`[ProfilePicture] 연결된 피어 ${peers.length}명에게 삭제 이벤트 전송`)

        // 각 피어에게 삭제 이벤트 전송
        for (const peerId of peers) {
          if (peerId) {
            const transferKey = `profileDelete-${myUserId}-${peerId}-${deleteTimestamp}`

            provider.awareness.setLocalStateField(transferKey, {
              userId: myUserId,
              targetUserId: peerId,
              deleted: true,
              timestamp: deleteTimestamp
            })

            console.log(`[ProfilePicture] 삭제 이벤트 전송: ${peerId.slice(-8)}`)

            // 2초 후 정리
            setTimeout(() => {
              provider.awareness?.setLocalStateField(transferKey, null)
            }, 2000)
          }
        }
      }

      console.log(`[ProfilePicture] 프로필 사진 삭제 완료`)
    } catch (error) {
      console.error('[ProfilePicture] 프로필 사진 삭제 실패:', error)
      throw error
    }
  }

  /**
   * 프로필 사진 전송 (특정 피어에게) - 글로벌 큐 사용
   */
  const sendProfilePicture = async (targetPeerId: string): Promise<void> => {
    if (!provider || !provider.awareness) {
      console.warn('[ProfilePicture] Provider 없음 - 전송 불가')
      return
    }

    const profile = await getProfilePicture(myUserId)
    if (!profile) {
      console.warn('[ProfilePicture] 내 프로필 사진 없음 - 전송 불가')
      return
    }

    console.log(`[ProfilePicture] 프로필 사진 전송 큐에 추가: ${targetPeerId.slice(-8)}, 크기: ${profile.size} bytes`)

    // 글로벌 큐에 전송 작업 추가
    const job = createProfilePictureJob(
      myUserId,
      targetPeerId,
      profile.size,
      async () => {
        // awareness를 통해 프로필 사진 전송
        const transferKey = `profileTransfer-${myUserId}-${targetPeerId}-${Date.now()}`

        console.log(`[ProfilePicture] 실제 전송 시작: ${transferKey}`)

        provider.awareness!.setLocalStateField(transferKey, {
          userId: myUserId,
          targetUserId: targetPeerId,
          imageData: profile.imageData,
          timestamp: profile.timestamp,
          size: profile.size,
          originalFileId: profile.originalFileId
        })

        // 전송 완료 대기
        await new Promise<void>((resolve) => {
          // 2초 후 자동 완료 (브로드캐스트 방식이므로 ACK 불필요)
          setTimeout(() => {
            provider.awareness?.setLocalStateField(transferKey, null)
            console.log(`[ProfilePicture] 전송 완료: ${targetPeerId.slice(-8)}`)
            resolve()
          }, 2000)
        })
      }
    )

    enqueue(job)
  }

  /**
   * 프로필 사진 수신 설정 (awareness 리스너)
   */
  const setupProfilePictureReceiver = () => {
    if (!provider || !provider.awareness) {
      console.warn('[ProfilePicture] Provider 없음 - 수신기 설정 불가')
      return
    }

    console.log('[ProfilePicture] 수신 리스너 등록')

    provider.awareness.on('change', async () => {
      for (const [, state] of provider.awareness!.getStates()) {
        const stateObj = state as Record<string, unknown>

        // 프로필 전송 및 삭제 데이터 확인
        for (const key in stateObj) {
          // 프로필 삭제 이벤트 처리
          if (key.startsWith('profileDelete-')) {
            const deleteData = stateObj[key]

            // Guard: 데이터가 없거나 객체가 아니면 스킵
            if (!deleteData || typeof deleteData !== 'object') continue

            const deleteEvent = deleteData as {
              userId: string
              targetUserId: string
              deleted: boolean
              timestamp: number
            }

            // Guard: 이미 처리한 삭제인지 확인
            const deleteId = `delete-${deleteEvent.userId}-${deleteEvent.timestamp}`
            if (processedTransfers.has(deleteId)) continue

            console.log(`[ProfilePicture] 프로필 삭제 감지: ${key}, from: ${deleteEvent.userId?.slice(-8)}, to: ${deleteEvent.targetUserId?.slice(-8)}`)

            // Guard: 내가 수신자가 아니거나 내가 발신자인 경우 스킵
            if (deleteEvent.targetUserId !== myUserId) continue
            if (deleteEvent.userId === myUserId) continue

            // 삭제 처리 마커 추가
            processedTransfers.add(deleteId)

            if (deleteEvent.deleted) {
              console.log(`[ProfilePicture] 프로필 사진 삭제 수신: ${deleteEvent.userId.slice(-8)}`)

              // 로컬에서 삭제
              await deleteProfilePicture(deleteEvent.userId)
              profilePictures.delete(deleteEvent.userId)

              console.log(`[ProfilePicture] 프로필 사진 삭제 완료: ${deleteEvent.userId.slice(-8)}`)
            }
            continue
          }

          // Guard: 프로필 전송 키가 아니면 스킵
          if (!key.startsWith('profileTransfer-')) continue

          const transferData = stateObj[key]

          // Guard: 데이터가 없거나 객체가 아니면 스킵
          if (!transferData || typeof transferData !== 'object') continue

          const transfer = transferData as {
            userId: string
            targetUserId: string
            imageData: string
            timestamp: number
            size: number
            originalFileId?: string
          }

          // Guard: 이미 처리한 전송인지 확인 (무한 루프 방지)
          const transferId = `${transfer.userId}-${transfer.timestamp}`
          if (processedTransfers.has(transferId)) continue

          console.log(`[ProfilePicture] 프로필 전송 감지: ${key}, from: ${transfer.userId?.slice(-8)}, to: ${transfer.targetUserId?.slice(-8)}, 내 ID: ${myUserId.slice(-8)}`)

          // Guard: 내가 수신자가 아니거나 내가 발신자인 경우 스킵
          if (transfer.targetUserId !== myUserId) continue
          if (transfer.userId === myUserId) continue

          // 전송 처리 마커 추가
          processedTransfers.add(transferId)

          // Guard: 이미 최신 프로필을 보유한 경우 스킵
          if (profilePictures.has(transfer.userId)) {
            const cached = await getProfilePicture(transfer.userId)
            if (cached && cached.timestamp >= transfer.timestamp) {
              console.log(`[ProfilePicture] 이미 최신 프로필 보유: ${transfer.userId.slice(-8)}`)
              continue
            }
          }

          console.log(`[ProfilePicture] 프로필 사진 수신: ${transfer.userId.slice(-8)}, 크기: ${transfer.size} bytes, 원본ID: ${transfer.originalFileId || '없음'}`)

          // 프로필 저장
          const profile: ProfilePicture = {
            userId: transfer.userId,
            imageData: transfer.imageData,
            timestamp: transfer.timestamp,
            size: transfer.size,
            originalFileId: transfer.originalFileId
          }

          await saveProfilePicture(profile)
          profilePictures.set(transfer.userId, transfer.imageData)

          console.log(`[ProfilePicture] 프로필 사진 저장 완료: ${transfer.userId.slice(-8)}, 캐시 크기: ${profilePictures.size}`)
        }
      }
    })
  }

  /**
   * 피어 연결 시 프로필 사진 요청 및 전송
   */
  const handlePeerConnected = async (peerId: string) => {
    if (!provider || !provider.awareness) {
      console.warn('[ProfilePicture] Provider 없음 - 피어 연결 처리 불가')
      return
    }

    // 중복 전송 방지 - 최근 5초 내에 이미 전송했으면 스킵
    const recentlySent = requestingProfiles.has(`sent-${peerId}`)
    if (recentlySent) {
      console.log(`[ProfilePicture] 최근에 이미 전송함: ${peerId.slice(-8)}`)
      return
    }

    console.log(`[ProfilePicture] 피어 연결 처리: ${peerId.slice(-8)}`)

    // 내 프로필 사진이 있으면 전송
    const hasMyProfile = await hasProfilePicture(myUserId)
    if (hasMyProfile) {
      console.log(`[ProfilePicture] 내 프로필 전송 시작: ${peerId.slice(-8)}`)

      // 중복 전송 방지 마커 추가
      requestingProfiles.add(`sent-${peerId}`)
      setTimeout(() => requestingProfiles.delete(`sent-${peerId}`), 5000)

      await sendProfilePicture(peerId)
    } else {
      console.log(`[ProfilePicture] 내 프로필 없음 - 전송 스킵`)
    }

    // 상대방의 프로필 사진 확인 및 요청
    for (const [, state] of provider.awareness.getStates()) {
      const stateObj = state as Record<string, unknown>
      const profileAwareness = stateObj.profilePicture as ProfilePictureAwareness | undefined
      const userUuid = stateObj.userUuid as string | undefined

      // Guard: 프로필 awareness가 없거나 조건에 맞지 않으면 스킵
      if (!profileAwareness) continue
      if (!profileAwareness.hasProfilePicture) continue
      if (profileAwareness.userId !== peerId) continue
      if (userUuid !== peerId) continue

      // 로컬에 없거나 오래된 경우 요청
      const cached = await getProfilePicture(peerId)
      const needsUpdate = !cached || cached.timestamp < profileAwareness.timestamp

      if (needsUpdate) {
        // Guard: 이미 요청 중인 경우 스킵
        if (requestingProfiles.has(peerId)) continue

        requestingProfiles.add(peerId)
        console.log(`[ProfilePicture] 프로필 사진 요청: ${peerId.slice(-8)}`)

        // awareness로 요청
        provider.awareness.setLocalStateField(`profileRequest-${Date.now()}`, {
          requesterUserId: myUserId,
          targetUserId: peerId,
          timestamp: Date.now()
        })

        // 5초 후 요청 목록에서 제거
        setTimeout(() => requestingProfiles.delete(peerId), 5000)
      } else {
        // 캐시된 프로필 사용
        console.log(`[ProfilePicture] 캐시된 프로필 사용: ${peerId.slice(-8)}`)
        profilePictures.set(peerId, cached.imageData)
      }
    }
  }

  /**
   * 프로필 사진 요청 리스너
   */
  const setupProfilePictureRequestListener = () => {
    if (!provider || !provider.awareness) return

    const processedRequests = new Set<string>()

    provider.awareness.on('change', async () => {
      for (const [, state] of provider.awareness!.getStates()) {
        const stateObj = state as Record<string, unknown>

        for (const key in stateObj) {
          // Guard: 프로필 요청 키가 아니면 스킵
          if (!key.startsWith('profileRequest-')) continue

          const requestData = stateObj[key]

          // Guard: 데이터가 없거나 객체가 아니면 스킵
          if (!requestData || typeof requestData !== 'object') continue

          const request = requestData as {
            requesterUserId: string
            targetUserId: string
            timestamp: number
          }

          // Guard: 이미 처리한 요청인지 확인
          const requestId = `${request.requesterUserId}-${request.timestamp}`
          if (processedRequests.has(requestId)) continue

          // Guard: 내가 대상이 아니거나 내가 요청자인 경우 스킵
          if (request.targetUserId !== myUserId) continue
          if (request.requesterUserId === myUserId) continue

          // 요청 처리
          processedRequests.add(requestId)
          console.log(`[ProfilePicture] 프로필 요청 받음: ${request.requesterUserId.slice(-8)}`)

          // 프로필 전송
          await sendProfilePicture(request.requesterUserId)
        }
      }
    })
  }

  /**
   * 초기화: 로컬 프로필 로드
   */
  const initializeProfilePictures = async () => {
    console.log('[ProfilePicture] 초기화 시작')

    // 내 프로필 로드
    const myProfile = await getProfilePicture(myUserId)
    if (myProfile) {
      myProfilePicture.value = toDataUrl(myProfile.imageData)
      profilePictures.set(myUserId, myProfile.imageData)
      console.log(`[ProfilePicture] 내 프로필 로드 완료: ${myProfile.size} bytes`)

      // 🔥 채팅방에서 초기화할 때: 원본 파일 메타데이터 등록 (Home에서 설정한 경우)
      if (files && myProfile.originalFileId) {
        // 원본 파일이 캐시에 있는지 확인
        const cachedBlob = await getCachedFile(myProfile.originalFileId)
        if (cachedBlob && !files.has(myProfile.originalFileId)) {
          const meta: FileMeta = {
            name: 'profile.jpg',
            size: cachedBlob.size,
            type: cachedBlob.type
          }
          files.set(myProfile.originalFileId, meta)
          console.log(`[ProfilePicture] 원본 파일 메타 등록 (채팅방 진입 시): ${myProfile.originalFileId}`)

          // 파일 소유권 브로드캐스트
          if (registerFileAvailability) {
            await registerFileAvailability(myProfile.originalFileId)
            console.log(`[ProfilePicture] 원본 파일 소유권 브로드캐스트 (채팅방 진입 시)`)
          }
        }
      }
    } else {
      console.log('[ProfilePicture] 내 프로필 없음')
    }

    // awareness에 프로필 존재 알림 (originalFileId 포함)
    if (provider && provider.awareness && myProfile) {
      provider.awareness.setLocalStateField('profilePicture', {
        userId: myUserId,
        hasProfilePicture: true,
        timestamp: myProfile.timestamp,
        originalFileId: myProfile.originalFileId // 원본 파일 ID 포함
      } as ProfilePictureAwareness)
      console.log('[ProfilePicture] awareness에 프로필 존재 알림 (originalFileId 포함)')
    }

    // 수신 리스너 설정
    if (provider && provider.awareness) {
      setupProfilePictureReceiver()
      setupProfilePictureRequestListener()
      console.log('[ProfilePicture] 수신 리스너 설정 완료')
    } else {
      console.warn('[ProfilePicture] Provider 없음 - 리스너 설정 불가')
    }
  }

  /**
   * 프로필 원본 파일 ID 가져오기
   */
  const getProfileOriginalFileId = async (userId: string): Promise<string | null> => {
    const profile = await getProfilePicture(userId)
    return profile?.originalFileId || null
  }

  /**
   * UI 핸들러 생성 (공통 로직 캡슐화)
   * Vue 컴포넌트에서 사용할 수 있는 핸들러 반환
   */
  const createProfileHandlers = () => {
    const handleUpload = async (file: File): Promise<void> => {
      try {
        await setMyProfilePicture(file)
        await showAlert('프로필 사진이 설정되었습니다.')
      } catch (error) {
        console.error('[ProfilePicture] 업로드 실패:', error)
        await showAlert('프로필 사진 설정에 실패했습니다.')
      }
    }

    const handleDelete = async (): Promise<void> => {
      try {
        await deleteMyProfilePicture()
        await showAlert('프로필 사진이 삭제되었습니다.')
      } catch (error) {
        console.error('[ProfilePicture] 삭제 실패:', error)
        await showAlert('프로필 사진 삭제에 실패했습니다.')
      }
    }

    return {
      handleUpload,
      handleDelete
    }
  }

  return {
    // 상태
    myProfilePicture,
    profilePictures,
    getUserProfilePicture,

    // 메서드
    setMyProfilePicture,
    deleteMyProfilePicture,
    sendProfilePicture,
    handlePeerConnected,
    initializeProfilePictures,
    getProfileOriginalFileId,
    createProfileHandlers,
  }
}
