/**
 * Logger Utility
 *
 * Environment-based log level system
 * - DEV: debug level and above
 * - PROD: warn level and above
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Set minimum log level based on environment
const MIN_LOG_LEVEL: LogLevel = import.meta.env.DEV ? 'debug' : 'warn'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL]
}

function formatTag(tag: string): string {
  return `[${tag}]`
}

/**
 * Logger instance
 *
 * @example
 * ```ts
 * import { logger } from '@/util/logger'
 *
 * logger.debug('FileTransfer', 'Chunk transfer started', { chunkIndex: 0 })
 * logger.info('WebRTC', 'Connection established')
 * logger.warn('Storage', 'Cache capacity low')
 * logger.error('Network', 'Connection failed', error)
 * ```
 */
export const logger = {
  debug(tag: string, message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.log(formatTag(tag), message, ...args)
    }
  },

  info(tag: string, message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.info(formatTag(tag), message, ...args)
    }
  },

  warn(tag: string, message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(formatTag(tag), message, ...args)
    }
  },

  error(tag: string, message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(formatTag(tag), message, ...args)
    }
  },
}

/**
 * Create a logger with a fixed tag
 *
 * @example
 * ```ts
 * const log = createLogger('FileTransfer')
 * log.debug('Chunk transfer started')
 * log.error('Transfer failed', error)
 * ```
 */
export function createLogger(tag: string) {
  return {
    debug: (message: string, ...args: unknown[]) => logger.debug(tag, message, ...args),
    info: (message: string, ...args: unknown[]) => logger.info(tag, message, ...args),
    warn: (message: string, ...args: unknown[]) => logger.warn(tag, message, ...args),
    error: (message: string, ...args: unknown[]) => logger.error(tag, message, ...args),
  }
}
