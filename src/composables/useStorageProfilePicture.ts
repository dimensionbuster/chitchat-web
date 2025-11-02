/**
 * useStorageProfilePicture
 *
 * IndexedDB를 사용하여 사용자별 프로필 사진을 로컬에 저장하는 스토리지 관리
 * - 프로필 사진 저장/조회
 * - Base64 형태로 저장
 */

import type { ProfilePicture } from '@/types/types'

const DB_NAME = 'chitchat-profile-pictures'
const STORE_NAME = 'profiles'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // userId를 키로 사용하는 ObjectStore 생성
          db.createObjectStore(STORE_NAME, { keyPath: 'userId' })
        }
      }
    })
  }
  return dbPromise
}

/**
 * 프로필 사진 저장
 */
export async function saveProfilePicture(profile: ProfilePicture): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(profile)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    console.log(`[ProfileStorage] 프로필 저장: ${profile.userId}`)
  } catch (error) {
    console.error('[ProfileStorage] 프로필 저장 실패:', error)
    throw error
  }
}

/**
 * 프로필 사진 조회
 */
export async function getProfilePicture(userId: string): Promise<ProfilePicture | null> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(userId)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('[ProfileStorage] 프로필 로드 실패:', error)
    return null
  }
}

/**
 * 프로필 사진 존재 여부 확인
 */
export async function hasProfilePicture(userId: string): Promise<boolean> {
  const profile = await getProfilePicture(userId)
  return profile !== null
}

/**
 * 프로필 사진 삭제
 */
export async function deleteProfilePicture(userId: string): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(userId)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    console.log(`[ProfileStorage] 프로필 삭제: ${userId}`)
  } catch (error) {
    console.error('[ProfileStorage] 프로필 삭제 실패:', error)
    throw error
  }
}

/**
 * 모든 프로필 사진 조회
 */
export async function getAllProfilePictures(): Promise<ProfilePicture[]> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('[ProfileStorage] 전체 프로필 로드 실패:', error)
    return []
  }
}
