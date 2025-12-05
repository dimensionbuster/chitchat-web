/**
 * useStorageProfilePicture
 *
 * IndexedDB-based profile picture storage management
 * - Profile picture save/retrieve per user
 * - Stored as Base64
 */

import type { ProfilePicture } from '@/types/types'
import { createIndexedDBStore } from '@/util/indexedDB'
import { createLogger } from '@/util/logger'

const log = createLogger('ProfileStorage')

const profileStore = createIndexedDBStore<ProfilePicture>({
  dbName: 'chitchat-profile-pictures',
  storeName: 'profiles',
  keyPath: 'userId',
})

/**
 * Save profile picture
 */
export async function saveProfilePicture(profile: ProfilePicture): Promise<void> {
  try {
    await profileStore.setWithKeyPath(profile)
    log.debug(`Profile saved: ${profile.userId}`)
  } catch (error) {
    log.error('Profile save failed:', error)
    throw error
  }
}

/**
 * Get profile picture
 */
export async function getProfilePicture(userId: string): Promise<ProfilePicture | null> {
  try {
    return await profileStore.get(userId)
  } catch (error) {
    log.error('Profile load failed:', error)
    return null
  }
}

/**
 * Check if profile picture exists
 */
export async function hasProfilePicture(userId: string): Promise<boolean> {
  const profile = await getProfilePicture(userId)
  return profile !== null
}

/**
 * Delete profile picture
 */
export async function deleteProfilePicture(userId: string): Promise<void> {
  try {
    await profileStore.delete(userId)
    log.debug(`Profile deleted: ${userId}`)
  } catch (error) {
    log.error('Profile delete failed:', error)
    throw error
  }
}

/**
 * Get all profile pictures
 */
export async function getAllProfilePictures(): Promise<ProfilePicture[]> {
  try {
    return await profileStore.getAll()
  } catch (error) {
    log.error('All profiles load failed:', error)
    return []
  }
}
