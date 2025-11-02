/**
 * useImageAutoLoader
 *
 * 이미지 자동 로드 및 표시 관리
 * - 작은 이미지(256KB 이하) 자동 다운로드
 * - 이미지 URL 캐싱 및 로딩 상태 관리
 * - 실패한 다운로드 재시도 지원
 */

import { ref } from 'vue'
import type { Map as YMap } from 'yjs'
import type { ChatMessage, FileMeta } from '@/types/types'
import { useFileEncoder } from './useFileEncoder'
import { getCachedFile } from './useStorageFileCache'
import { FILE_DATA_THRESHOLD } from './fileConstants'

export function useImageAutoLoader(
  files: YMap<FileMeta>,
  requestFileP2P: (fileId: string) => Promise<Blob>,
) {
  const { getFileBlob } = useFileEncoder()

  // 이미지 URL 캐시 (fileId -> Object URL)
  const imageUrls = ref(new Map<string, string>())

  // 현재 로딩 중인 이미지
  const loadingImages = ref(new Set<string>())

  // 다운로드 시도한 이미지
  const attemptedDownloads = ref(new Set<string>())

  // 실패한 다운로드 (fileId -> 에러 메시지)
  const failedDownloads = ref(new Map<string, string>())

  /**
   * 이미지 파일인지 확인
   */
  const isImage = (fileId: string) => {
    return files.get(fileId)?.type?.startsWith('image/') ?? false
  }

  /**
   * 자동 다운로드 대상인지 확인 (256KB 이하)
   */
  const shouldAutoDownload = (fileId: string) => {
    return (files.get(fileId)?.size || 0) <= FILE_DATA_THRESHOLD
  }

  /**
   * 이미지 다운로드 및 URL 생성
   * @param fileId 파일 ID
   * @param forceDownload 강제 다운로드 (재시도)
   */
  async function downloadImage(fileId: string, forceDownload = false) {
    // 이미 로드된 경우 스킵
    if (imageUrls.value.has(fileId)) return

    // 로딩 중이면 스킵 (강제가 아닐 경우)
    if (!forceDownload && loadingImages.value.has(fileId)) return

    // 이미 시도했고 성공한 경우 스킵 (강제가 아닐 경우)
    if (!forceDownload && attemptedDownloads.value.has(fileId) && !failedDownloads.value.has(fileId)) {
      return
    }

    // 강제 다운로드 시 상태 초기화
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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류'
      failedDownloads.value.set(fileId, errorMsg)
      attemptedDownloads.value.delete(fileId)
    } finally {
      loadingImages.value.delete(fileId)
    }
  }

  /**
   * 이미지 Blob 다운로드
   * 1. 캐시 확인
   * 2. 메타데이터에서 추출
   * 3. P2P로 요청
   */
  async function downloadImageBlob(fileId: string): Promise<Blob> {
    const meta = files.get(fileId)
    if (!meta) throw new Error('파일 메타데이터를 찾을 수 없습니다')

    // 캐시 확인
    const cachedBlob = await getCachedFile(fileId)
    if (cachedBlob) return cachedBlob

    // 작은 파일: 메타데이터에서 추출
    if (meta.fileData) return await getFileBlob(fileId, meta)

    // 큰 파일: P2P 요청
    return await requestFileP2P(fileId)
  }

  /**
   * 메시지 목록에서 자동 다운로드 대상 처리
   * - 캐시된 이미지 즉시 로드
   * - 작은 이미지 자동 다운로드
   */
  async function processAutoDownload(messages: ChatMessage[]) {
    for (const msg of messages) {
      if (!msg.fileId || !isImage(msg.fileId)) continue
      if (imageUrls.value.has(msg.fileId) || loadingImages.value.has(msg.fileId)) continue

      // 캐시 확인
      const cachedBlob = await getCachedFile(msg.fileId)
      if (cachedBlob) {
        downloadImage(msg.fileId, false)
        continue
      }

      // 자동 다운로드 대상인지 확인
      if (shouldAutoDownload(msg.fileId)) {
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
