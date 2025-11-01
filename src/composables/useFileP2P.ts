import { ref } from 'vue'
import type { WebrtcProvider } from 'y-webrtc'
import type { Map as YMap } from 'yjs'
import type { FileMeta, PartialDownloadState } from '@/types/types'
import { getCachedFile, cacheFile } from './useLocalFileCache'
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/util/base64'
import { useFileTransferProgress } from './useFileTransferProgress'
import { usePartialDownload } from './usePartialDownload'

type FileRequest = {
  fileId: string
  requesterUuid: string
  timestamp: number
  receivedChunks?: number[]
}

type FileResponse = {
  fileId: string
  targetUuid: string
  timestamp: number
  totalChunks: number
  chunkSize: number
}

const TIMEOUT = 30000
const CHUNK_TIMEOUT = 60000

export function useFileP2P(
  provider: WebrtcProvider,
  files: YMap<FileMeta>,
  myUuid: string,
  requestFile: (fileId: string, requesterUuid: string, receivedChunks?: number[]) => void,
  respondFile: (fileId: string, fileData: string, targetUuid: string, skipChunks?: number[]) => void,
  getTransferMap: (key: string) => YMap<string>,
) {
  const processedRequests = ref(new Set<string>())
  const { startTransfer, updateProgress, completeTransfer } = useFileTransferProgress()
  const isConnected = ref(true)

  provider.on('status', (event: { connected: boolean }) => {
    const wasConnected = isConnected.value
    isConnected.value = event.connected

    if (!event.connected && wasConnected) {
      console.warn('[P2P] ⚠️ 연결 끊김')
    } else if (event.connected && !wasConnected) {
      console.log('[P2P] 🔄 연결 복구 - 리스너 재설정')
      setupFileRequestListener()
    }
  })

  async function handleFileRequest(fileId: string, requesterUuid: string, receivedChunks: number[]) {
    const cachedBlob = await getCachedFile(fileId)
    if (!cachedBlob) {
      console.warn(`[P2P] 파일 없음: ${fileId}`)
      return
    }

    const msg = receivedChunks.length ? ` (${receivedChunks.length}개 스킵)` : ''
    console.log(`[P2P] 응답${msg}: ${fileId}`)

    const base64 = arrayBufferToBase64(await cachedBlob.arrayBuffer())
    respondFile(fileId, base64, requesterUuid, receivedChunks)
  }

  function setupFileRequestListener() {
    console.log(`[P2P] 리스너 설정 (UUID: ${myUuid})`)

    provider.awareness.on('change', async () => {
      for (const [, state] of provider.awareness.getStates()) {
        const request = state.fileRequest as FileRequest | undefined
        if (!request || request.requesterUuid === myUuid) continue

        const requestId = `${request.fileId}-${request.requesterUuid}-${request.timestamp}`
        if (processedRequests.value.has(requestId)) continue

        console.log(`[P2P] 요청: ${request.fileId} (청크: ${request.receivedChunks?.length || 0})`)
        processedRequests.value.add(requestId)
        setTimeout(() => processedRequests.value.delete(requestId), 5000)

        await handleFileRequest(request.fileId, request.requesterUuid, request.receivedChunks || [])
      }
    })
  }

  async function waitForFileResponse(fileId: string, timeout: number): Promise<Blob> {
    const { loadDownloadState, saveDownloadState, isComplete: isDownloadComplete } = usePartialDownload()

    let state = await loadDownloadState(fileId)
    if (state) {
      console.log(`[P2P] 이어받기: ${state.receivedChunks.size}/${state.totalChunks}`)

      const meta = files.get(fileId)
      startTransfer(fileId, meta?.name || fileId, 'download', state.totalChunks, state.totalBytes)
      updateProgress(fileId, state.receivedChunks.size)

      if (isDownloadComplete(state)) {
        return await completeAndCache(state, meta?.type)
      }
    }

    return new Promise<Blob>((resolve, reject) => {
      let resolved = false

      const saveProgress = async () => {
        if (state) {
          await saveDownloadState(state).catch(console.error)
          console.log(`[P2P] 💾 진행 저장: ${state.receivedChunks.size}/${state.totalChunks}`)
        }
      }

      const connectionHandler = (event: { connected: boolean }) => {
        if (!event.connected && !resolved) {
          console.warn(`[P2P] 연결 끊김: ${fileId}`)
          resolved = true
          cleanup()
          saveProgress()
          reject(new Error('연결 끊김'))
        }
      }

      const peersChangeHandler = (event: { removed: string[]; webrtcPeers?: string[] }) => {
        if (event.removed.length > 0 && !resolved && (event.webrtcPeers?.length || 0) === 0) {
          console.warn(`[P2P] 모든 피어 끊김: ${fileId}`)
          resolved = true
          cleanup()
          saveProgress()
          reject(new Error('피어 연결 끊김'))
        }
      }

      provider.on('status', connectionHandler)
      provider.on('peers', peersChangeHandler)

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          console.error(`[P2P] 타임아웃: ${fileId}`)
          saveProgress()
          reject(new Error('타임아웃'))
        }
      }, timeout)

      const handler = () => {
        if (resolved) return

        for (const [, awareState] of provider.awareness.getStates()) {
          const response = awareState.fileResponse as FileResponse | undefined
          if (!response || response.fileId !== fileId || response.targetUuid !== myUuid || resolved) continue

          console.log(`[P2P] 응답 수신: ${fileId} (${response.totalChunks}개 청크)`)
          resolved = true
          cleanup()

          const meta = files.get(fileId)
          const totalBytes = meta?.size || response.totalChunks * response.chunkSize

          if (!state) {
            startTransfer(fileId, meta?.name || fileId, 'download', response.totalChunks, totalBytes)
            state = {
              fileId,
              fileName: meta?.name || fileId,
              totalChunks: response.totalChunks,
              chunkSize: response.chunkSize,
              totalBytes,
              receivedChunks: new Set(),
              chunks: new Map(),
              timestamp: Date.now(),
              transferKey: `transfer-${fileId}-${response.timestamp}`,
            }
          } else {
            state.transferKey = `transfer-${fileId}-${response.timestamp}`
          }

          receiveChunks(state, response, meta?.type).then(resolve).catch(reject)
          return
        }
      }

      const cleanup = () => {
        clearTimeout(timer)
        provider.awareness.off('change', handler)
        provider.off('status', connectionHandler)
        provider.off('peers', peersChangeHandler)
      }

      provider.awareness.on('change', handler)
      handler()
    })
  }

  function receiveChunks(state: PartialDownloadState, response: FileResponse, fileType?: string): Promise<Blob> {
    const { saveDownloadState, deleteDownloadState, addChunk, isComplete } = usePartialDownload()

    return new Promise((resolve, reject) => {
      const transferMap = getTransferMap(state.transferKey)
      const timeout = setTimeout(() => {
        console.error(`[P2P] 청크 타임아웃: ${state.receivedChunks.size}/${response.totalChunks}`)
        saveDownloadState(state).catch(console.error)
        reject(new Error('청크 타임아웃'))
      }, CHUNK_TIMEOUT)

      const chunks = new Array<string>(response.totalChunks)

      const checkAndComplete = async () => {
        if (!transferMap.get('complete')) return

        for (let i = 0; i < response.totalChunks; i++) {
          if (!state.receivedChunks.has(i)) {
            const chunk = transferMap.get(`chunk-${i}`)
            if (chunk) {
              addChunk(state, i, chunk as string)
              chunks[i] = chunk as string
              if (state.receivedChunks.size % 10 === 0) {
                saveDownloadState(state).catch(console.error)
              }
            }
          } else if (!chunks[i]) {
            chunks[i] = state.chunks.get(i)!
          }
        }

        if (isComplete(state)) {
          clearTimeout(timeout)
          const blob = await completeAndCache(state, fileType)
          await deleteDownloadState(state.fileId)
          resolve(blob)
        }
      }

      transferMap.observe(() => {
        for (let i = 0; i < response.totalChunks; i++) {
          if (state.receivedChunks.has(i)) continue

          const chunk = transferMap.get(`chunk-${i}`)
          if (chunk) {
            addChunk(state, i, chunk as string)
            chunks[i] = chunk as string
            updateProgress(state.fileId, state.receivedChunks.size)

            if (state.receivedChunks.size % 10 === 0) {
              const progress = ((state.receivedChunks.size / response.totalChunks) * 100).toFixed(1)
              console.log(`[P2P] ${progress}% (${state.receivedChunks.size}/${response.totalChunks})`)
              saveDownloadState(state).catch(console.error)
            }
          }
        }
        checkAndComplete()
      })

      checkAndComplete()
    })
  }

  async function completeAndCache(state: PartialDownloadState, fileType?: string): Promise<Blob> {
    const { mergeChunks } = usePartialDownload()
    const fullData = mergeChunks(state)
    const arrayBuffer = base64ToArrayBuffer(fullData)
    const blob = new Blob([arrayBuffer], { type: fileType || 'application/octet-stream' })

    console.log(`[P2P] ✅ 완료: ${(blob.size / 1024 / 1024).toFixed(2)}MB`)
    await cacheFile(state.fileId, blob)
    completeTransfer(state.fileId)
    return blob
  }

  async function requestFileP2P(fileId: string): Promise<Blob> {
    console.log(`[P2P] 요청: ${fileId}`)

    const { loadDownloadState } = usePartialDownload()
    const partialState = await loadDownloadState(fileId)
    const receivedChunks = partialState ? Array.from(partialState.receivedChunks) : []

    if (receivedChunks.length) {
      console.log(`[P2P] 이어받기: ${receivedChunks.length}개 청크`)
    }

    requestFile(fileId, myUuid, receivedChunks)
    return await waitForFileResponse(fileId, TIMEOUT)
  }

  return {
    setupFileRequestListener,
    requestFileP2P,
  }
}
