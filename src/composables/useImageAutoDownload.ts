import { ref } from 'vue'
import type { Map as YMap } from 'yjs'
import type { ChatMessage, FileMeta } from '@/types/types'
import { useFileShare } from './useFileShare'
import { getCachedFile } from './useLocalFileCache'
import { FILE_DATA_THRESHOLD } from './fileConstants'

/**
 * 이미지 자동 다운로드 관리
 */
export function useImageAutoDownload(
  files: YMap<FileMeta>,
  requestFileP2P: (fileId: string) => Promise<Blob>,
) {
  const { getFileBlob } = useFileShare()

  // 이미지 URL 캐시 (fileId → Blob URL)
  const imageUrls = ref(new Map<string, string>())
  const loadingImages = ref(new Set<string>())
  const attemptedDownloads = ref(new Set<string>())
  const failedDownloads = ref(new Map<string, string>())

  /**
   * 파일이 이미지인지 확인
   */
  function isImage(fileId: string) {
    const meta = files.get(fileId)
    return meta?.type?.startsWith('image/') ?? false
  }

  /**
   * 이미지가 자동 다운로드 대상인지 확인 (512KB 이하)
   */
  function shouldAutoDownload(fileId: string) {
    const meta = files.get(fileId)

    // 크기 정보 없으면 일단 자동 다운로드 시도
    if (!meta?.size) {
      return false
    }

    return meta.size <= FILE_DATA_THRESHOLD
  }

  /**
   * 이미지 다운로드
   */
  async function downloadImage(fileId: string, forceDownload = false) {
    // 이미 다운로드했거나, 다운로드 중이면 스킵
    if (imageUrls.value.has(fileId) || loadingImages.value.has(fileId)) {
      return
    }

    // 자동 다운로드가 아니고, 이미 시도했으면 스킵
    if (!forceDownload && attemptedDownloads.value.has(fileId)) {
      return
    }

    // 강제 다운로드면 실패 기록 초기화
    if (forceDownload) {
      failedDownloads.value.delete(fileId)
    }

    attemptedDownloads.value.add(fileId)
    loadingImages.value.add(fileId)

    try {
      const blob = await downloadImageBlob(fileId)
      const url = URL.createObjectURL(blob)
      imageUrls.value.set(fileId, url)

      // 성공하면 실패 기록 제거
      failedDownloads.value.delete(fileId)
      console.log('이미지 다운로드 완료:', fileId)
    } catch (error) {
      handleDownloadError(fileId, error, forceDownload)
    } finally {
      loadingImages.value.delete(fileId)
    }
  }

  /**
   * 이미지 Blob 다운로드 (작은 파일 vs 큰 파일)
   */
  async function downloadImageBlob(fileId: string): Promise<Blob> {
    const meta = files.get(fileId)
    if (!meta) {
      throw new Error('파일 메타데이터를 찾을 수 없습니다')
    }

    const sizeInfo = meta.size ? `(${(meta.size / 1024 / 1024).toFixed(2)}MB)` : ''
    console.log(`이미지 다운로드 시작: ${fileId} ${sizeInfo}`)

    // 1순위: 로컬 캐시 확인 (업로더가 이미 가지고 있는 경우)
    const cachedBlob = await getCachedFile(fileId)
    if (cachedBlob) {
      console.log(`[Cache] 로컬 캐시에서 즉시 로드: ${fileId}`)
      return cachedBlob
    }

    // 2순위: fileData가 있으면 (작은 파일) 바로 변환
    if (meta.fileData) {
      return await getFileBlob(fileId, meta)
    }

    // 3순위: fileData가 없으면 (큰 파일) P2P로 요청
    return await requestFileP2P(fileId)
  }

  /**
   * 다운로드 에러 처리
   */
  function handleDownloadError(fileId: string, error: unknown, forceDownload: boolean) {
    const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류'
    console.error('이미지 다운로드 실패:', fileId, errorMsg)

    // 실패 기록 저장
    failedDownloads.value.set(fileId, errorMsg)

    // 실패한 경우 attemptedDownloads에서 제거 (수동 재시도 가능하도록)
    if (forceDownload) {
      attemptedDownloads.value.delete(fileId)
    }
  }

  /**
   * 메시지 목록에서 자동 다운로드 대상 이미지 처리
   */
  async function processAutoDownload(messages: ChatMessage[]) {
    for (const msg of messages) {
      if (!msg.fileId || !isImage(msg.fileId)) {
        continue
      }

      // 이미 다운로드했거나 시도 중이면 스킵
      if (imageUrls.value.has(msg.fileId) || loadingImages.value.has(msg.fileId)) {
        continue
      }

      // 로컬 캐시에 있는지 확인 (업로더는 큰 파일도 표시해야 함)
      const cachedBlob = await getCachedFile(msg.fileId)
      if (cachedBlob) {
        console.log(`[AutoDownload] 로컬 캐시 발견, 즉시 표시: ${msg.fileId}`)
        downloadImage(msg.fileId, false)
        continue
      }

      // 캐시에 없으면 크기 기준으로 판단
      if (shouldAutoDownload(msg.fileId)) {
        console.log(`[AutoDownload] 새 이미지 자동 다운로드: ${msg.fileId}`)
        downloadImage(msg.fileId, false)
      } else {
        console.log(`[AutoDownload] 큰 이미지 발견 (수동 다운로드 필요): ${msg.fileId}`)
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
