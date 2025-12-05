/**
 * IndexedDB Helper
 *
 * Common IndexedDB initialization and CRUD logic utility
 * - Single DB connection management
 * - Type-safe store creation
 * - Integrated error handling
 */

import { createLogger } from './logger'

const log = createLogger('IndexedDB')

export interface IndexedDBStoreConfig {
  dbName: string
  storeName: string
  version?: number
  /** If keyPath is set, use internal key; otherwise use external key */
  keyPath?: string
  /** Index configuration (optional) */
  indexes?: Array<{
    name: string
    keyPath: string
    options?: IDBIndexParameters
  }>
}

export interface IndexedDBStore<T> {
  get: (key: string) => Promise<T | null>
  set: (key: string, value: T) => Promise<void>
  setWithKeyPath: (value: T) => Promise<void>
  delete: (key: string) => Promise<void>
  getAll: () => Promise<T[]>
  getAllKeys: () => Promise<string[]>
  clear: () => Promise<void>
  /** Use when raw DB access is needed */
  getDB: () => Promise<IDBDatabase>
}

/**
 * IndexedDB store factory function
 *
 * @example
 * ```ts
 * const fileCache = createIndexedDBStore<Blob>({
 *   dbName: 'chitchat-file-cache',
 *   storeName: 'files',
 * })
 *
 * await fileCache.set('file-id', blob)
 * const cached = await fileCache.get('file-id')
 * ```
 */
export function createIndexedDBStore<T>(config: IndexedDBStoreConfig): IndexedDBStore<T> {
  const { dbName, storeName, version = 1, keyPath, indexes } = config
  let dbPromise: Promise<IDBDatabase> | null = null

  function getDB(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, version)

        request.onerror = () => {
          log.error(`Failed to open DB: ${dbName}`, request.error)
          reject(request.error)
        }

        request.onsuccess = () => {
          log.debug(`DB opened: ${dbName}`)
          resolve(request.result)
        }

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result

          if (!db.objectStoreNames.contains(storeName)) {
            const storeOptions: IDBObjectStoreParameters | undefined = keyPath ? { keyPath } : undefined
            const store = db.createObjectStore(storeName, storeOptions)

            // Create indexes
            if (indexes) {
              for (const idx of indexes) {
                store.createIndex(idx.name, idx.keyPath, idx.options)
              }
            }

            log.debug(`Store created: ${storeName}`)
          }
        }
      })
    }
    return dbPromise
  }

  async function get(key: string): Promise<T | null> {
    try {
      const db = await getDB()
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.get(key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      log.error(`Get failed for key: ${key}`, error)
      return null
    }
  }

  async function set(key: string, value: T): Promise<void> {
    try {
      const db = await getDB()
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      store.put(value, key)

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch (error) {
      log.error(`Set failed for key: ${key}`, error)
      throw error
    }
  }

  async function setWithKeyPath(value: T): Promise<void> {
    try {
      const db = await getDB()
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      store.put(value)

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch (error) {
      log.error('SetWithKeyPath failed', error)
      throw error
    }
  }

  async function deleteItem(key: string): Promise<void> {
    try {
      const db = await getDB()
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      store.delete(key)

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch (error) {
      log.error(`Delete failed for key: ${key}`, error)
      throw error
    }
  }

  async function getAll(): Promise<T[]> {
    try {
      const db = await getDB()
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.getAll()

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? [])
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      log.error('GetAll failed', error)
      return []
    }
  }

  async function getAllKeys(): Promise<string[]> {
    try {
      const db = await getDB()
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.getAllKeys()

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as string[] ?? [])
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      log.error('GetAllKeys failed', error)
      return []
    }
  }

  async function clear(): Promise<void> {
    try {
      const db = await getDB()
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      store.clear()

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch (error) {
      log.error('Clear failed', error)
      throw error
    }
  }

  return {
    get,
    set,
    setWithKeyPath,
    delete: deleteItem,
    getAll,
    getAllKeys,
    clear,
    getDB,
  }
}

/**
 * Version that opens a fresh DB connection each call (prevents closing errors)
 * Use for cases like useFileTransferState where transaction conflicts may occur
 */
export async function openFreshDB(
  dbName: string,
  version: number,
  onUpgrade?: (db: IDBDatabase, oldVersion: number) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version)

    request.onerror = () => {
      log.error(`Failed to open fresh DB: ${dbName}`, request.error)
      reject(request.error)
    }

    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (onUpgrade) {
        onUpgrade(db, event.oldVersion)
      }
    }
  })
}
