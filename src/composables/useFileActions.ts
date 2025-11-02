/**
 * useFileActions
 *
 * 파일 관련 사용자 액션 처리
 * - 파일 다운로드 (저장)
 * - 파일 요청 및 다운로드 트리거
 */

import type { Map as YMap } from 'yjs'
import type { FileMeta } from '@/types/types'
import { useFileEncoder } from './useFileEncoder'
import { getCachedFile } from './useStorageFileCache'

export function useFileActions(
  files: YMap<FileMeta>,
  requestFileP2P: (fileId: string) => Promise<Blob>,
) {
  const { getFileBlob } = useFileEncoder()

  /**
   * 파일을 다운로드하여 로컬에 저장
   * 1. 캐시 확인
   * 2. 없으면 P2P로 요청
   * 3. 메타데이터에서 직접 추출
   */
  async function downloadFile(fileId: string) {
    const meta = files.get(fileId)
    if (!meta) return

    let blob: Blob

    if (!meta.fileData) {
      // 큰 파일: 캐시 또는 P2P 요청
      const cached = await getCachedFile(fileId)
      if (cached) {
        blob = cached
      } else {
        blob = await requestFileP2P(fileId)
      }
    } else {
      // 작은 파일: 메타데이터에서 직접 추출
      blob = await getFileBlob(fileId, meta)
    }

    triggerDownload(blob, meta.name ?? fileId)
  }

  /**
   * Blob을 파일로 다운로드 (브라우저 저장 대화상자)
   */
  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return {
    downloadFile,
    triggerDownload,
  }
}
