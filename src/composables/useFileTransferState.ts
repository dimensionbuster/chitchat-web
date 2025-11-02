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
const DB_VERSION = 1
const STORE_NAME = 'downloads'

// IndexedDB 연결 (싱글톤)
let dbPromise: Promise<IDBDatabase> | null = null

// IndexedDB에 저장되는 데이터 구조
interface StoredDownloadState {
  fileId: string
  fileName: string
  totalChunks: number
  chunkSize: number
  totalBytes: number
  receivedChunks?: number[] // 이전 버전 호환성
  chunks?: { [key: string]: string } // 청크 데이터 포함
  timestamp: number
  transferKey: string
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
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'fileId' })
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
   * 다운로드 상태 저장
   */
  async function saveDownloadState(state: PartialDownloadState) {
    try {
      const db = await getDB()

      const serializable: StoredDownloadState = {
        fileId: state.fileId,
        fileName: state.fileName,
        totalChunks: state.totalChunks,
        chunkSize: state.chunkSize,
        totalBytes: state.totalBytes,
        receivedChunks: Array.from(state.receivedChunks),
        chunks: Object.fromEntries(state.chunks),
        timestamp: state.timestamp,
        transferKey: state.transferKey,
      }

      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(serializable)

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
   * 다운로드 상태 불러오기
   */
  async function loadDownloadState(fileId: string): Promise<PartialDownloadState | null> {
    try {
      const db = await getDB()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(fileId)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const data = request.result as StoredDownloadState | undefined

          if (!data) {
            resolve(null)
            return
          }

          const state: PartialDownloadState = {
            fileId: data.fileId,
            fileName: data.fileName,
            totalChunks: data.totalChunks,
            chunkSize: data.chunkSize,
            totalBytes: data.totalBytes,
            receivedChunks: new Set(data.receivedChunks || []),
            chunks: new Map(
              data.chunks ? Object.entries(data.chunks).map(([k, v]) => [parseInt(k), v as string]) : [],
            ),
            timestamp: data.timestamp,
            transferKey: data.transferKey,
          }

          resolve(state)
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error('[FileTransferState] 상태 불러오기 실패:', error)
      return null
    }
  }

  /**
   * 다운로드 상태 삭제
   */
  async function deleteDownloadState(fileId: string) {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(fileId)

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  }

  /**
   * 모든 다운로드 상태 조회
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
          chunks: new Map(
            data.chunks ? Object.entries(data.chunks).map(([k, v]) => [parseInt(k), v as string]) : [],
          ),
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
   * 청크 추가
   */
  function addChunk(state: PartialDownloadState, chunkIndex: number, chunkData: string) {
    state.receivedChunks.add(chunkIndex)
    state.chunks.set(chunkIndex, chunkData)
    state.timestamp = Date.now()
  }

  /**
   * 모든 청크를 받았는지 확인
   */
  function isComplete(state: PartialDownloadState): boolean {
    return state.receivedChunks.size === state.totalChunks
  }

  /**
   * 받은 청크들을 하나의 문자열로 병합
   */
  function mergeChunks(state: PartialDownloadState): string {
    const chunks: string[] = []
    for (let i = 0; i < state.totalChunks; i++) {
      const chunk = state.chunks.get(i)
      if (!chunk) {
        throw new Error(`청크 ${i}가 누락되었습니다`)
      }
      chunks.push(chunk)
    }
    return chunks.join('')
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
