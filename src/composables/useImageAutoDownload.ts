import { ref } from 'vue'
import type { Map as YMap } from 'yjs'
import type { ChatMessage, FileMeta } from '@/types/types'
import { useFileShare } from './useFileShare'
import { getCachedFile } from './useLocalFileCache'
import { FILE_DATA_THRESHOLD } from './fileConstants'

export function useImageAutoDownload(
  files: YMap<FileMeta>,
  requestFileP2P: (fileId: string) => Promise<Blob>,
) {
  const { getFileBlob } = useFileShare()
  const imageUrls = ref(new Map<string, string>())
  const loadingImages = ref(new Set<string>())
  const attemptedDownloads = ref(new Set<string>())
  const failedDownloads = ref(new Map<string, string>())

  const isImage = (fileId: string) => files.get(fileId)?.type?.startsWith('image/') ?? false
  const shouldAutoDownload = (fileId: string) => (files.get(fileId)?.size || 0) <= FILE_DATA_THRESHOLD

  async function downloadImage(fileId: string, forceDownload = false) {
    if (imageUrls.value.has(fileId)) return
    if (!forceDownload && loadingImages.value.has(fileId)) return
    if (!forceDownload && attemptedDownloads.value.has(fileId) && !failedDownloads.value.has(fileId)) return

    if (forceDownload) {
      failedDownloads.value.delete(fileId)
      attemptedDownloads.value.delete(fileId)
      loadingImages.value.delete(fileId)
    }

    attemptedDownloads.value.add(fileId)
    loadingImages.value.add(fileId)

    try {
      const blob = await downloadImageBlob(fileId)
      imageUrls.value.set(fileId, URL.createObjectURL(blob))
      failedDownloads.value.delete(fileId)
      console.log('다운로드 완료:', fileId)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류'
      console.error('다운로드 실패:', fileId, errorMsg)
      failedDownloads.value.set(fileId, errorMsg)
      attemptedDownloads.value.delete(fileId)
    } finally {
      loadingImages.value.delete(fileId)
    }
  }

  async function downloadImageBlob(fileId: string): Promise<Blob> {
    const meta = files.get(fileId)
    if (!meta) throw new Error('파일 메타데이터를 찾을 수 없습니다')

    const sizeInfo = meta.size ? `(${(meta.size / 1024 / 1024).toFixed(2)}MB)` : ''
    console.log(`다운로드 시작: ${fileId} ${sizeInfo}`)

    const cachedBlob = await getCachedFile(fileId)
    if (cachedBlob) {
      console.log(`[Cache] 로컬 캐시: ${fileId}`)
      return cachedBlob
    }

    if (meta.fileData) return await getFileBlob(fileId, meta)
    return await requestFileP2P(fileId)
  }

  async function processAutoDownload(messages: ChatMessage[]) {
    for (const msg of messages) {
      if (!msg.fileId || !isImage(msg.fileId)) continue
      if (imageUrls.value.has(msg.fileId) || loadingImages.value.has(msg.fileId)) continue

      const cachedBlob = await getCachedFile(msg.fileId)
      if (cachedBlob) {
        console.log(`[AutoDownload] 캐시 발견: ${msg.fileId}`)
        downloadImage(msg.fileId, false)
        continue
      }

      if (shouldAutoDownload(msg.fileId)) {
        console.log(`[AutoDownload] 자동 다운로드: ${msg.fileId}`)
        downloadImage(msg.fileId, false)
      }
    }
  }

  return {
    imageUrls,
    loadingImages,
    failedDownloads,
    isImage,
    shouldAutoDownload,
    downloadImage,
    processAutoDownload,
  }
}
