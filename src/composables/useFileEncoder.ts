/**
 * useFileEncoder
 *
 * 파일 데이터 인코딩/디코딩 처리
 * - File 객체를 Base64로 인코딩
 * - Base64를 Blob으로 디코딩
 * - 파일 캐시와 메타데이터 준비
 */

import type { FileMeta } from '@/types/types'
import { cacheFile, getCachedFile } from './useStorageFileCache'
import { FILE_DATA_THRESHOLD } from './fileConstants'

export function useFileEncoder() {
  /**
   * 파일을 준비하고 메타데이터 생성
   * - 파일을 캐시에 저장
   * - 작은 파일(256KB 이하)은 Base64 인코딩하여 메타에 포함
   */
  async function prepareFile(file: File) {
    const arrayBuffer = await file.arrayBuffer()

    // 모든 파일 전송을 개별 인스턴스로 처리 (랜덤 UUID 사용)
    const fileId = crypto.randomUUID()

    const blob = new Blob([arrayBuffer], { type: file.type })

    await cacheFile(fileId, blob)

    const meta: FileMeta = {
      name: file.name,
      size: file.size,
      type: file.type,
    }

    if (file.size <= FILE_DATA_THRESHOLD) {
      meta.fileData = arrayBufferToBase64(arrayBuffer)
    }

    console.log(`[FileEncoder] 파일 준비: ${file.name}, ${(file.size / 1024).toFixed(0)}KB`)

    return { fileId, meta }
  }

  /**
   * 파일 메타데이터로부터 Blob 생성
   * - 캐시에서 먼저 조회
   * - 없으면 메타의 Base64 데이터 사용
   */
  async function getFileBlob(fileId: string, meta: FileMeta): Promise<Blob> {
    const cachedBlob = await getCachedFile(fileId)
    if (cachedBlob) return cachedBlob

    if (!meta.fileData) throw new Error('파일 데이터가 없습니다')

    const arrayBuffer = base64ToArrayBuffer(meta.fileData)
    const blob = new Blob([arrayBuffer], { type: meta.type || 'application/octet-stream' })

    await cacheFile(fileId, blob)
    return blob
  }

  /**
   * ArrayBuffer를 Base64 문자열로 인코딩
   */
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 8192

    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength))
      binary += String.fromCharCode.apply(null, Array.from(chunk))
    }

    return btoa(binary)
  }

  /**
   * Base64 문자열을 ArrayBuffer로 디코딩
   */
  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    return bytes.buffer
  }

  return {
    prepareFile,
    getFileBlob,
    arrayBufferToBase64,
    base64ToArrayBuffer
  }
}
