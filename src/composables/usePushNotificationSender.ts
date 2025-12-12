/**
 * usePushNotificationSender
 *
 * 메시지 전송 시 Firebase Realtime Database의 notificationQueue에
 * 알림을 추가하여 오프라인 모바일 사용자에게 푸시 알림을 전송합니다.
 *
 * Firebase Cloud Functions가 notificationQueue를 감시하고
 * 오프라인 멤버에게 FCM 푸시를 전송합니다.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getDatabase, ref, push, serverTimestamp, type Database } from 'firebase/database'

// Firebase 설정 - 실제 프로젝트 값으로 교체 필요
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}

let app: FirebaseApp | null = null
let database: Database | null = null

/**
 * Firebase 초기화
 */
function initFirebase(): boolean {
  // 설정이 비어있으면 초기화하지 않음
  if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
    console.warn('[PushNotificationSender] Firebase 설정이 없습니다. .env 파일을 확인하세요.')
    return false
  }

  try {
    // 이미 초기화된 앱이 있으면 재사용
    if (getApps().length > 0) {
      app = getApps()[0] ?? null
    } else {
      app = initializeApp(firebaseConfig)
    }
    database = getDatabase(app ?? undefined)
    console.log('[PushNotificationSender] Firebase 초기화 완료')
    return true
  } catch (error) {
    console.error('[PushNotificationSender] Firebase 초기화 실패:', error)
    return false
  }
}

// 모듈 로드 시 Firebase 초기화
const isFirebaseEnabled = initFirebase()

export interface NotificationPayload {
  roomId: string
  senderId: string
  senderName: string
  type: 'new_message' | 'file_received'
  messagePreview?: string
  fileName?: string
  fileSize?: number
  messageId?: string
}

/**
 * 푸시 알림 전송을 위해 Firebase에 알림 등록
 */
export async function sendPushNotification(payload: NotificationPayload): Promise<boolean> {
  if (!isFirebaseEnabled || !database) {
    // Firebase가 비활성화되어 있으면 조용히 무시 (P2P 전용 모드)
    return false
  }

  try {
    const notificationRef = ref(database, 'notificationQueue')

    await push(notificationRef, {
      ...payload,
      timestamp: serverTimestamp(),
    })

    console.log('[PushNotificationSender] 알림 등록 완료:', payload.type)
    return true
  } catch (error) {
    console.error('[PushNotificationSender] 알림 등록 실패:', error)
    return false
  }
}

/**
 * 텍스트 메시지 알림 전송
 */
export async function notifyNewMessage(
  roomId: string,
  senderId: string,
  senderName: string,
  message: string,
  messageId?: string
): Promise<boolean> {
  // 메시지 미리보기 (최대 100자)
  const messagePreview = message.length > 100
    ? message.substring(0, 100) + '...'
    : message

  return sendPushNotification({
    roomId,
    senderId,
    senderName,
    type: 'new_message',
    messagePreview,
    messageId,
  })
}

/**
 * 파일 수신 알림 전송
 */
export async function notifyFileReceived(
  roomId: string,
  senderId: string,
  senderName: string,
  fileName: string,
  fileSize: number,
  messageId?: string
): Promise<boolean> {
  return sendPushNotification({
    roomId,
    senderId,
    senderName,
    type: 'file_received',
    fileName,
    fileSize,
    messageId,
  })
}

/**
 * Firebase 활성화 여부 확인
 */
export function isPushNotificationEnabled(): boolean {
  return isFirebaseEnabled
}

/**
 * usePushNotificationSender composable
 */
export function usePushNotificationSender() {
  return {
    sendPushNotification,
    notifyNewMessage,
    notifyFileReceived,
    isPushNotificationEnabled,
    isEnabled: isFirebaseEnabled,
  }
}
