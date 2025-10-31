// IndexedDB를 사용한 로컬 파일 캐시
// Helia의 Blockstore와 별도로 원본 파일을 저장

const DB_NAME = 'chitchat-file-cache'
const STORE_NAME = 'files'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
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

export async function cacheFile(cid: string, blob: Blob): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(blob, cid)
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    console.log(`[FileCache] ✅ 파일 캐시 저장: ${cid}`)
  } catch (error) {
    console.error('[FileCache] 캐시 저장 실패:', error)
  }
}

export async function getCachedFile(cid: string): Promise<Blob | null> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(cid)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const blob = request.result
        if (blob) {
          console.log(`[FileCache] ✅ 캐시에서 로드: ${cid}`)
        }
        resolve(blob || null)
      }
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('[FileCache] 캐시 로드 실패:', error)
    return null
  }
}

export async function hasCachedFile(cid: string): Promise<boolean> {
  const blob = await getCachedFile(cid)
  return blob !== null
}
