/**
 * useStorageFileCache
 *
 * IndexedDB를 사용하여 파일을 로컬에 캐시하는 스토리지 관리
 * - 파일 캐시 저장/조회
 * - Blob 형태로 저장
 */

const DB_NAME = 'chitchat-file-cache'
const STORE_NAME = 'files'
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

export async function cacheFile(cid: string, blob: Blob) {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(blob, cid)
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } catch (error) {
    console.error('[StorageFileCache] 캐시 저장 실패:', error)
  }
}

export async function getCachedFile(cid: string): Promise<Blob | null> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(cid)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('[StorageFileCache] 캐시 로드 실패:', error)
    return null
  }
}

export async function hasCachedFile(cid: string) {
  const blob = await getCachedFile(cid)
  return blob !== null
}
