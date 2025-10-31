import type { FileMeta } from '@/types/types'
import { cacheFile, getCachedFile } from './useLocalFileCache'

// 파일 데이터를 Yjs에 직접 넣지 않고 메타데이터만 넣을 크기 임계값 (5MB)
const FILE_DATA_THRESHOLD = 5 * 1024 * 1024

/**
 * y-webrtc를 통한 파일 공유를 위한 유틸리티
 * 작은 파일(5MB 이하): 메타데이터와 함께 전송
 * 큰 파일(5MB 초과): 메타데이터만 전송, 파일 데이터는 P2P 요청 시 전송
 */
export function useFileShare() {
  /**
   * 파일을 준비하여 FileMeta 생성
   * 큰 파일은 fileData를 포함하지 않음 (메타데이터만)
   */
  async function prepareFile(file: File) {
    console.log(`[FileShare] 파일 준비 시작: ${file.name} (${file.size} bytes)`)

    // 파일을 ArrayBuffer로 읽기
    const arrayBuffer = await file.arrayBuffer()

    // 고유 ID 생성
    const fileId = crypto.randomUUID()

    // 로컬 캐시에 저장 (항상 저장 - 업로더는 파일을 가지고 있어야 함)
    const blob = new Blob([arrayBuffer], { type: file.type })
    await cacheFile(fileId, blob)

    // 메타데이터 생성
    const meta: FileMeta = {
      name: file.name,
      size: file.size,
      type: file.type,
    }

    // 작은 파일만 fileData 포함 (5MB 이하)
    if (file.size <= FILE_DATA_THRESHOLD) {
      const base64 = arrayBufferToBase64(arrayBuffer)
      meta.fileData = base64
      console.log(
        `[FileShare] ✅ 작은 파일 - 데이터 포함: ${fileId} (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
      )
    } else {
      console.log(
        `[FileShare] ✅ 큰 파일 - 메타데이터만: ${fileId} (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
      )
    }

    return { fileId, meta }
  }

  /**
   * FileMeta에서 Blob 생성
   */
  async function getFileBlob(fileId: string, meta: FileMeta): Promise<Blob> {
    // 1순위: 로컬 캐시 확인 (가장 빠름)
    const cachedBlob = await getCachedFile(fileId)
    if (cachedBlob) {
      console.log(`[FileShare] ⚡ 로컬 캐시에서 즉시 로드: ${fileId}`)
      return cachedBlob
    }

    // 2순위: base64 데이터에서 복원
    if (!meta.fileData) {
      throw new Error('파일 데이터가 없습니다')
    }

    console.log(`[FileShare] base64에서 파일 복원: ${fileId}`)

    const arrayBuffer = base64ToArrayBuffer(meta.fileData)
    const blob = new Blob([arrayBuffer], { type: meta.type || 'application/octet-stream' })

    // 캐시에 저장
    await cacheFile(fileId, blob)

    console.log(
      `[FileShare] ✅ 파일 복원 완료: ${fileId} (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB)`,
    )

    return blob
  }

  return { prepareFile, getFileBlob }
}

/**
 * ArrayBuffer를 base64 문자열로 변환
 */
function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const len = bytes.byteLength

  // 청크 단위로 처리하여 스택 오버플로우 방지
  const chunkSize = 8192
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len))
    binary += String.fromCharCode.apply(null, Array.from(chunk))
  }

  return btoa(binary)
}

/**
 * base64 문자열을 ArrayBuffer로 변환
 */
function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)

  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes.buffer
}
