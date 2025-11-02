/**
 * useStorageChatroomSettings
 *
 * IndexedDB를 사용하여 채팅방 설정을 저장/관리
 * - 채팅방별 설정 저장/조회
 * - JSON 내보내기/가져오기 지원
 */

import type { ChatroomOption } from "@/types/types"

const DB_NAME = 'chitchat-chatroom-options'
const STORE_NAME = 'options'
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
          db.createObjectStore(STORE_NAME)
        }
      }
    })
  }
  return dbPromise
}

export async function saveChatroomOption(roomId: string, option: ChatroomOption) {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(option, roomId)
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    console.log(`[StorageChatroomSettings] ✅ 옵션 저장: ${roomId}`)
  } catch (error) {
    console.error('[StorageChatroomSettings] 옵션 저장 실패:', error)
  }
}

export async function getChatroomOption(roomId: string): Promise<ChatroomOption | null> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(roomId)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const option = request.result
        if (option) {
          console.log(`[StorageChatroomSettings] ✅ 옵션 로드: ${roomId}`)
        }
        resolve(option || null)
      }
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('[StorageChatroomSettings] 옵션 조회 실패:', error)
    return null
  }
}

export async function exportOptionAsJSON(): Promise<string> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAllKeys()

    const keys: string[] = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as string[])
      request.onerror = () => reject(request.error)
    })

    const allOptions: Record<string, ChatroomOption> = {}
    for (const key of keys) {
      const getRequest = store.get(key)
      const option: ChatroomOption = await new Promise((resolve, reject) => {
        getRequest.onsuccess = () => resolve(getRequest.result)
        getRequest.onerror = () => reject(getRequest.error)
      })
      allOptions[key] = option
    }

    return JSON.stringify(allOptions, null, 2)
  } catch (error) {
    console.error('[StorageChatroomSettings] 옵션 내보내기 실패:', error)
    return '{}'
  }
}

export async function importOptionFromJSON(jsonString: string) {
  try {
    const allOptions: Record<string, ChatroomOption> = JSON.parse(jsonString)
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    for (const [key, option] of Object.entries(allOptions)) {
      store.put(option, key)
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })

    console.log('[StorageChatroomSettings] ✅ 옵션 가져오기 완료')
  } catch (error) {
    console.error('[StorageChatroomSettings] 옵션 가져오기 실패:', error)
  }
}
