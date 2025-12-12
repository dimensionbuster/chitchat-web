/**
 * useFirebaseMessaging (Web/Electron 버전)
 *
 * 데스크톱에서 메시지 전송 시 Firebase에 알림 요청을 보내
 * 모바일 앱 (백그라운드)에 푸시 알림이 가도록 함
 *
 * 아키텍처:
 * 1. 메시지 전송 시 Firebase Realtime DB의 notificationQueue에 기록
 * 2. Cloud Functions가 트리거되어 오프라인 모바일 사용자에게 FCM 전송
 */

import { ref } from 'vue'
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getDatabase,
  ref as dbRef,
  set,
  push,
  serverTimestamp,
  onDisconnect,
  type Database
} from 'firebase/database'

// Firebase 설정 (환경변수에서 로드)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
}

// 싱글톤 인스턴스
let firebaseApp: FirebaseApp | null = null
let database: Database | null = null

/**
 * Firebase 설정이 유효한지 확인
 */
function isFirebaseConfigured(): boolean {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.databaseURL &&
    firebaseConfig.apiKey !== 'your-api-key'
  )
}

/**
 * Firebase 초기화
 */
function initFirebase(): boolean {
  if (!isFirebaseConfigured()) {
    console.log('[FirebaseMessaging] Firebase 설정이 없음 - 푸시 알림 비활성화')
    return false
  }

  if (!firebaseApp) {
    try {
      firebaseApp = initializeApp(firebaseConfig)
      database = getDatabase(firebaseApp)
      console.log('[FirebaseMessaging] Firebase 초기화 완료')
    } catch (e) {
      console.error('[FirebaseMessaging] Firebase 초기화 실패:', e)
      return false
    }
  }
  return true
}

export function useFirebaseMessaging(userId: string, userName: string) {
  const isInitialized = ref(false)
  const currentRoomId = ref<string | null>(null)

  /**
   * 사용자 정보를 Firebase DB에 등록 (온라인 상태)
   */
  async function registerUser() {
    if (!database) return

    const userRef = dbRef(database, `users/${userId}`)
    await set(userRef, {
      name: userName,
      platform: 'desktop', // electron/web
      lastSeen: serverTimestamp(),
      online: true
    })

    // 연결 끊김 시 online: false 설정
    const onlineRef = dbRef(database, `users/${userId}/online`)
    onDisconnect(onlineRef).set(false)

    console.log('[FirebaseMessaging] 사용자 등록:', userId)
  }

  /**
   * 채팅방 참여 (roomId에 사용자 등록)
   */
  async function joinRoom(roomId: string) {
    if (!database) return

    currentRoomId.value = roomId

    // 채팅방 참여자 목록에 추가 (FCM 토큰 없이 - 데스크톱은 푸시 받을 필요 없음)
    const memberRef = dbRef(database, `rooms/${roomId}/members/${userId}`)
    await set(memberRef, {
      name: userName,
      joinedAt: serverTimestamp(),
      online: true,
      platform: 'desktop'
    })

    // 연결 끊김 시 online: false
    const onlineRef = dbRef(database, `rooms/${roomId}/members/${userId}/online`)
    onDisconnect(onlineRef).set(false)

    console.log(`[FirebaseMessaging] 채팅방 참여: ${roomId}`)
  }

  /**
   * 채팅방 나가기
   */
  async function leaveRoom(roomId: string) {
    if (!database) return

    const memberRef = dbRef(database, `rooms/${roomId}/members/${userId}/online`)
    await set(memberRef, false)

    currentRoomId.value = null
    console.log(`[FirebaseMessaging] 채팅방 나감: ${roomId}`)
  }

  /**
   * 새 메시지 알림 요청 (Cloud Functions가 처리)
   *
   * Firebase DB에 알림 요청을 기록하면
   * Cloud Functions가 트리거되어 해당 room의 오프라인 모바일 사용자에게 FCM 전송
   */
  async function notifyNewMessage(
    roomId: string,
    messageText: string,
    messageId: string
  ) {
    if (!database) return

    try {
      // 알림 요청 큐에 추가 (Cloud Functions가 처리 후 삭제)
      const notificationRef = dbRef(database, `notificationQueue`)
      await push(notificationRef, {
        type: 'new_message',
        roomId,
        senderId: userId,
        senderName: userName,
        messagePreview: messageText.substring(0, 100),
        messageId,
        timestamp: serverTimestamp()
      })

      console.log('[FirebaseMessaging] 알림 요청 전송:', { roomId, messageId: messageId.slice(-8) })
    } catch (e) {
      console.error('[FirebaseMessaging] 알림 요청 실패:', e)
    }
  }

  /**
   * 파일 전송 알림 요청
   */
  async function notifyFileTransfer(
    roomId: string,
    fileName: string,
    fileId: string
  ) {
    if (!database) return

    try {
      const notificationRef = dbRef(database, `notificationQueue`)
      await push(notificationRef, {
        type: 'file_received',
        roomId,
        senderId: userId,
        senderName: userName,
        fileName,
        fileId,
        timestamp: serverTimestamp()
      })
    } catch (e) {
      console.error('[FirebaseMessaging] 파일 알림 요청 실패:', e)
    }
  }

  /**
   * 초기화
   */
  function initialize(): boolean {
    if (!initFirebase()) {
      return false
    }

    registerUser()
    isInitialized.value = true
    return true
  }

  /**
   * 정리
   */
  async function cleanup() {
    if (currentRoomId.value) {
      await leaveRoom(currentRoomId.value)
    }

    if (database) {
      const userOnlineRef = dbRef(database, `users/${userId}/online`)
      await set(userOnlineRef, false)
    }
  }

  return {
    isInitialized,
    currentRoomId,
    initialize,
    joinRoom,
    leaveRoom,
    notifyNewMessage,
    notifyFileTransfer,
    cleanup
  }
}
