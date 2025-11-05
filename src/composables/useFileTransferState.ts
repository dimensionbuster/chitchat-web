/**
 * useFileTransferState
 *
 * 파일 전송 상태 관리 (부분 다운로드/청크 관리)
 * - 파일 전송 중단 시 상태 저장
 * - 이어받기 지원
 * - 청크 단위 진행 상황 추적
 * - IndexedDB를 통한 영구 저장
 */

import type { PartialDownloadState } from '@/types/types'

const DB_NAME = 'chitchat-partial-downloads'
const DB_VERSION = 2 // 버전 업그레이드 (새로운 스키마)
const STORE_NAME = 'downloads'
const CHUNKS_STORE_NAME = 'chunks' // 청크 전용 스토어

// IndexedDB 연결 (싱글톤)
let dbPromise: Promise<IDBDatabase> | null = null

// IndexedDB에 저장되는 메타데이터 구조 (청크 제외)
interface StoredDownloadState {
  fileId: string
  fileName: string
  totalChunks: number
  chunkSize: number
  totalBytes: number
  receivedChunks: number[] // 받은 청크 인덱스만 (데이터는 별도 저장)
  timestamp: number
  transferKey: string
}

// 청크 저장 구조 (별도 스토어)
interface StoredChunk {
  key: string // "fileId-chunkIndex"
  fileId: string
  chunkIndex: number
  data: ArrayBuffer
}

/**
 * IndexedDB 초기화
 */
async function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        const oldVersion = event.oldVersion

        // 메타데이터 스토어
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'fileId' })
        }

        // 청크 스토어 (버전 2부터)
        if (oldVersion < 2 && !db.objectStoreNames.contains(CHUNKS_STORE_NAME)) {
          const chunksStore = db.createObjectStore(CHUNKS_STORE_NAME, { keyPath: 'key' })
          chunksStore.createIndex('fileId', 'fileId', { unique: false })
        }
      }
    })
  }
  return dbPromise
}

/**
 * 부분 다운로드 상태를 관리하는 composable
 * 연결이 끊겨도 진행 상태를 유지하고 이어받기 가능
 */
export function useFileTransferState() {
  /**
   * 다운로드 상태 저장 (메타데이터만, 청크는 별도 저장)
   */
  async function saveDownloadState(state: PartialDownloadState) {
    try {
      const db = await getDB()

      // 메타데이터만 저장 (청크 제외)
      const metadata: StoredDownloadState = {
        fileId: state.fileId,
        fileName: state.fileName,
        totalChunks: state.totalChunks,
        chunkSize: state.chunkSize,
        totalBytes: state.totalBytes,
        receivedChunks: Array.from(state.receivedChunks),
        timestamp: state.timestamp,
        transferKey: state.transferKey,
      }

      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(metadata)

      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
      })
    } catch (error) {
      console.error('[FileTransferState] 상태 저장 실패:', error)
      throw error
    }
  }

  /**
   * 개별 청크 저장 (즉시 저장, 버퍼링 없음)
   */
  async function saveChunk(fileId: string, chunkIndex: number, data: ArrayBuffer) {
    try {
      const db = await getDB()

      const chunk: StoredChunk = {
        key: `${fileId}-${chunkIndex}`,
        fileId,
        chunkIndex,
        data
      }

      const tx = db.transaction(CHUNKS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(CHUNKS_STORE_NAME)
      store.put(chunk)

      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
      })
    } catch (error) {
      console.error(`[FileTransferState] 청크 저장 실패 (${chunkIndex}):`, error)
      throw error
    }
  }

  /**
   * 여러 청크 배치 저장 (성능 최적화)
   */
  async function saveChunksBatch(fileId: string, chunks: Map<number, ArrayBuffer>) {
    if (chunks.size === 0) return

    try {
      const db = await getDB()
      const tx = db.transaction(CHUNKS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(CHUNKS_STORE_NAME)

      for (const [chunkIndex, data] of chunks.entries()) {
        const chunk: StoredChunk = {
          key: `${fileId}-${chunkIndex}`,
          fileId,
          chunkIndex,
          data
        }
        store.put(chunk)
      }

      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
      })
    } catch (error) {
      console.error(`[FileTransferState] 배치 저장 실패:`, error)
      throw error
    }
  }

  /**
   * 다운로드 상태 불러오기 (메타데이터만, 청크는 필요 시 별도 로드)
   */
  async function loadDownloadState(fileId: string): Promise<PartialDownloadState | null> {
    try {
      const db = await getDB()

      // 메타데이터 로드
      const metaTx = db.transaction(STORE_NAME, 'readonly')
      const metaStore = metaTx.objectStore(STORE_NAME)
      const metaRequest = metaStore.get(fileId)

      const metadata = await new Promise<StoredDownloadState | undefined>((resolve, reject) => {
        metaRequest.onsuccess = () => resolve(metaRequest.result as StoredDownloadState | undefined)
        metaRequest.onerror = () => reject(metaRequest.error)
      })

      if (!metadata) {
        return null
      }

      // 청크 로드
      const chunksTx = db.transaction(CHUNKS_STORE_NAME, 'readonly')
      const chunksStore = chunksTx.objectStore(CHUNKS_STORE_NAME)
      const index = chunksStore.index('fileId')
      const chunksRequest = index.getAll(fileId)

      const storedChunks = await new Promise<StoredChunk[]>((resolve, reject) => {
        chunksRequest.onsuccess = () => resolve(chunksRequest.result as StoredChunk[])
        chunksRequest.onerror = () => reject(chunksRequest.error)
      })

      // 청크 맵 생성
      const chunksMap = new Map<number, ArrayBuffer>()
      for (const chunk of storedChunks) {
        chunksMap.set(chunk.chunkIndex, chunk.data)
      }

      const state: PartialDownloadState = {
        fileId: metadata.fileId,
        fileName: metadata.fileName,
        totalChunks: metadata.totalChunks,
        chunkSize: metadata.chunkSize,
        totalBytes: metadata.totalBytes,
        receivedChunks: new Set(metadata.receivedChunks || []),
        chunks: chunksMap,
        timestamp: metadata.timestamp,
        transferKey: metadata.transferKey,
      }

      return state
    } catch (error) {
      console.error('[FileTransferState] 상태 불러오기 실패:', error)
      return null
    }
  }

  /**
   * 다운로드 상태 삭제 (메타데이터 + 모든 청크)
   */
  async function deleteDownloadState(fileId: string) {
    const db = await getDB()

    // 트랜잭션 하나로 메타데이터와 청크 모두 삭제
    const tx = db.transaction([STORE_NAME, CHUNKS_STORE_NAME], 'readwrite')
    const metaStore = tx.objectStore(STORE_NAME)
    const chunksStore = tx.objectStore(CHUNKS_STORE_NAME)

    // 메타데이터 삭제
    metaStore.delete(fileId)

    // 해당 fileId의 모든 청크 삭제
    const index = chunksStore.index('fileId')
    const chunksRequest = index.openCursor(IDBKeyRange.only(fileId))

    chunksRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  }

  /**
   * 모든 다운로드 상태 조회 (청크는 로드하지 않고 메타데이터만)
   */
  async function getAllDownloadStates(): Promise<PartialDownloadState[]> {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const allData = request.result as StoredDownloadState[]

        const states = allData.map((data) => ({
          fileId: data.fileId,
          fileName: data.fileName,
          totalChunks: data.totalChunks,
          chunkSize: data.chunkSize,
          totalBytes: data.totalBytes,
          receivedChunks: new Set(data.receivedChunks || []),
          chunks: new Map<number, ArrayBuffer>(), // 빈 맵 (필요 시 loadDownloadState 사용)
          timestamp: data.timestamp,
          transferKey: data.transferKey,
        }))

        resolve(states)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * 오래된 다운로드 상태 정리 (24시간 이상 된 것)
   */
  async function cleanupOldStates() {
    const states = await getAllDownloadStates()
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000

    for (const state of states) {
      if (now - state.timestamp > ONE_DAY) {
        await deleteDownloadState(state.fileId)
      }
    }
  }

  /**
   * 특정 청크를 받았는지 확인
   */
  function hasChunk(state: PartialDownloadState, chunkIndex: number): boolean {
    return state.receivedChunks.has(chunkIndex)
  }

  /**
   * 청크 추가 (메모리 + DB에 즉시 저장)
   */
  function addChunk(state: PartialDownloadState, chunkIndex: number, chunkData: ArrayBuffer) {
    state.receivedChunks.add(chunkIndex)
    state.chunks.set(chunkIndex, chunkData)
    state.timestamp = Date.now()

    // DB에 청크 즉시 저장 (논블로킹)
    saveChunksBatch(state.fileId, new Map([[chunkIndex, chunkData]])).catch(err => {
      console.warn(`[FileTransferState] 청크 ${chunkIndex} 저장 실패:`, err)
    })
  }

  /**
   * 모든 청크를 받았는지 확인
   */
  function isComplete(state: PartialDownloadState): boolean {
    return state.receivedChunks.size === state.totalChunks
  }

  /**
   * 받은 청크들을 하나의 ArrayBuffer로 병합
   */
  function mergeChunks(state: PartialDownloadState): ArrayBuffer {
    const chunks: ArrayBuffer[] = []
    let totalSize = 0

    for (let i = 0; i < state.totalChunks; i++) {
      const chunk = state.chunks.get(i)
      if (!chunk) {
        throw new Error(`청크 ${i}가 누락되었습니다`)
      }
      chunks.push(chunk)
      totalSize += chunk.byteLength
    }

    // 모든 청크를 하나의 ArrayBuffer로 병합
    const result = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      result.set(new Uint8Array(chunk), offset)
      offset += chunk.byteLength
    }

    return result.buffer
  }

  /**
   * 진행률 계산 (0-100%)
   */
  function getProgress(state: PartialDownloadState): number {
    if (state.totalChunks === 0) return 0
    return (state.receivedChunks.size / state.totalChunks) * 100
  }

  // 앱 시작 시 오래된 상태 정리
  cleanupOldStates().catch(console.error)

  return {
    saveDownloadState,
    saveChunk,
    saveChunksBatch,
    loadDownloadState,
    deleteDownloadState,
    getAllDownloadStates,
    cleanupOldStates,
    hasChunk,
    addChunk,
    isComplete,
    mergeChunks,
    getProgress,
  }
}
