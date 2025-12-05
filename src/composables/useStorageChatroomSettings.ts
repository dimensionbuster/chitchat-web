/**
 * useStorageChatroomSettings
 *
 * IndexedDB-based chatroom settings management
 * - Per-chatroom settings save/retrieve
 * - JSON export/import support
 */

import type { ChatroomOption } from '@/types/types'
import { createIndexedDBStore } from '@/util/indexedDB'
import { createLogger } from '@/util/logger'

const log = createLogger('StorageChatroomSettings')

const optionStore = createIndexedDBStore<ChatroomOption>({
  dbName: 'chitchat-chatroom-options',
  storeName: 'options',
})

/**
 * Save chatroom option
 */
export async function saveChatroomOption(roomId: string, option: ChatroomOption): Promise<void> {
  try {
    await optionStore.set(roomId, option)
    log.debug(`Option saved: ${roomId}`)
  } catch (error) {
    log.error('Option save failed:', error)
  }
}

/**
 * Get chatroom option
 */
export async function getChatroomOption(roomId: string): Promise<ChatroomOption | null> {
  try {
    const option = await optionStore.get(roomId)
    if (option) {
      log.debug(`Option loaded: ${roomId}`)
    }
    return option
  } catch (error) {
    log.error('Option load failed:', error)
    return null
  }
}

/**
 * Export all options as JSON
 */
export async function exportOptionAsJSON(): Promise<string> {
  try {
    const keys = await optionStore.getAllKeys()
    const allOptions: Record<string, ChatroomOption> = {}

    for (const key of keys) {
      const option = await optionStore.get(key)
      if (option) {
        allOptions[key] = option
      }
    }

    return JSON.stringify(allOptions, null, 2)
  } catch (error) {
    log.error('Option export failed:', error)
    return '{}'
  }
}

/**
 * Import options from JSON
 */
export async function importOptionFromJSON(jsonString: string): Promise<void> {
  try {
    const allOptions: Record<string, ChatroomOption> = JSON.parse(jsonString)

    for (const [key, option] of Object.entries(allOptions)) {
      await optionStore.set(key, option)
    }

    log.info('Option import completed')
  } catch (error) {
    log.error('Option import failed:', error)
  }
}
