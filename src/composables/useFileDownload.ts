import type { Map as YMap } from 'yjs'
import type { FileMeta } from '@/types/types'
import { useFileShare } from './useFileShare'
import { getCachedFile } from './useLocalFileCache'

/**
 * 파일 다운로드 (저장) 유틸리티
 */
export function useFileDownload(
  files: YMap<FileMeta>,
  requestFileP2P: (fileId: string) => Promise<Blob>,
) {
  const { getFileBlob } = useFileShare()

  /**
   * 파일을 다운로드하여 저장
   */
  async function downloadFile(fileId: string): Promise<void> {
    const meta = files.get(fileId)
    if (!meta) {
      console.error('파일 메타데이터를 찾을 수 없습니다:', fileId)
      return
    }

    let blob: Blob

    // fileData가 없으면 (큰 파일) P2P로 요청
    if (!meta.fileData) {
      console.log(`[P2P] 큰 파일 요청 (다운로드): ${fileId}`)

      // 캐시에서 먼저 확인
      const cached = await getCachedFile(fileId)
      if (cached) {
        blob = cached
      } else {
        // P2P로 파일 요청
        blob = await requestFileP2P(fileId)
      }
    } else {
      // fileData가 있으면 (작은 파일) 바로 변환
      blob = await getFileBlob(fileId, meta)
    }

    // 파일 다운로드 트리거
    triggerDownload(blob, meta.name ?? fileId)
  }

  /**
   * Blob을 파일로 다운로드
   */
  function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return {
    downloadFile,
  }
}
