/**
 * useStorageFileCache
 *
 * IndexedDB-based file cache storage management
 * - File cache save/retrieve
 * - Stored as Blob
 */

import { createIndexedDBStore } from '@/util/indexedDB'
import { createLogger } from '@/util/logger'

const log = createLogger('StorageFileCache')

const fileStore = createIndexedDBStore<Blob>({
  dbName: 'chitchat-file-cache',
  storeName: 'files',
})

/**
 * Cache a file
 */
export async function cacheFile(cid: string, blob: Blob): Promise<void> {
  try {
    await fileStore.set(cid, blob)
    log.debug(`Cache saved: ${cid}`)
  } catch (error) {
    log.error('Cache save failed:', error)
  }
}

/**
 * Get cached file
 */
export async function getCachedFile(cid: string): Promise<Blob | null> {
  try {
    return await fileStore.get(cid)
  } catch (error) {
    log.error('Cache load failed:', error)
    return null
  }
}

/**
 * Check if file is cached
 */
export async function hasCachedFile(cid: string): Promise<boolean> {
  const blob = await getCachedFile(cid)
  return blob !== null
}

/**
 * Delete cached file
 */
export async function deleteCachedFile(cid: string): Promise<void> {
  try {
    await fileStore.delete(cid)
    log.debug(`Cache deleted: ${cid}`)
  } catch (error) {
    log.error('Cache delete failed:', error)
  }
}

/**
 * Clear all cache
 */
export async function clearCache(): Promise<void> {
  try {
    await fileStore.clear()
    log.info('All cache cleared')
  } catch (error) {
    log.error('Cache clear failed:', error)
  }
}
