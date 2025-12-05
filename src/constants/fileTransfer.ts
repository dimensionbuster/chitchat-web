/**
 * File Transfer Constants
 *
 * Constants for file transfer operations
 * Used for P2P file transfer via WebRTC DataChannel
 */

/** Chunk size (64KB) - Optimal for DataChannel */
export const CHUNK_SIZE = 64 * 1024

/** Max buffer size (12MB) - Prevents buffer overflow */
export const MAX_BUFFER_SIZE = 12 * 1024 * 1024

/** ACK window size - Send ACK every N chunks */
export const ACK_WINDOW = 20

/** Max retry count */
export const MAX_RETRY_COUNT = 3

/** Retry delay (ms) */
export const RETRY_DELAY = 1000

/** Transfer timeout (ms) */
export const TRANSFER_TIMEOUT = 30000

/** File cache expiry time (24 hours) */
export const FILE_CACHE_EXPIRY = 24 * 60 * 60 * 1000

/** Partial download state expiry time (24 hours) */
export const PARTIAL_DOWNLOAD_EXPIRY = 24 * 60 * 60 * 1000

/** Supported image MIME types */
export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]

/** Image preview max size (5MB) */
export const IMAGE_PREVIEW_MAX_SIZE = 5 * 1024 * 1024

/** Message type constants */
export const MESSAGE_TYPES = {
  // File metadata
  FILE_META: 'file-meta',
  FILE_META_ACK: 'file-meta-ack',

  // Chunk transfer
  FILE_CHUNK: 'file-chunk',
  FILE_CHUNK_ACK: 'file-chunk-ack',

  // Transfer control
  FILE_COMPLETE: 'file-complete',
  FILE_ERROR: 'file-error',
  FILE_CANCEL: 'file-cancel',

  // Resume transfer
  FILE_RESUME_REQUEST: 'file-resume-request',
  FILE_RESUME_RESPONSE: 'file-resume-response',
} as const

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES]
