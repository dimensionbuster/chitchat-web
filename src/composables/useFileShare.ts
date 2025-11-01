import type { FileMeta } from '@/types/types'
import { cacheFile, getCachedFile } from './useLocalFileCache'
import { FILE_DATA_THRESHOLD } from './fileConstants'

export function useFileShare() {
  async function prepareFile(file: File) {
    console.log(`[FileShare] 준비: ${file.name} (${file.size} bytes)`)

    const arrayBuffer = await file.arrayBuffer()
    const fileId = crypto.randomUUID()
    const blob = new Blob([arrayBuffer], { type: file.type })

    await cacheFile(fileId, blob)

    const meta: FileMeta = {
      name: file.name,
      size: file.size,
      type: file.type,
    }

    const sizeMB = (file.size / 1024 / 1024).toFixed(2)

    if (file.size <= FILE_DATA_THRESHOLD) {
      meta.fileData = arrayBufferToBase64(arrayBuffer)
      console.log(`[FileShare] ✅ 작은 파일 (데이터 포함): ${fileId} (${sizeMB}MB)`)
    } else {
      console.log(`[FileShare] ✅ 큰 파일 (메타만): ${fileId} (${sizeMB}MB)`)
    }

    return { fileId, meta }
  }

  async function getFileBlob(fileId: string, meta: FileMeta): Promise<Blob> {
    const cachedBlob = await getCachedFile(fileId)
    if (cachedBlob) {
      console.log(`[FileShare] ⚡ 캐시 로드: ${fileId}`)
      return cachedBlob
    }

    if (!meta.fileData) throw new Error('파일 데이터가 없습니다')

    console.log(`[FileShare] base64 복원: ${fileId}`)
    const arrayBuffer = base64ToArrayBuffer(meta.fileData)
    const blob = new Blob([arrayBuffer], { type: meta.type || 'application/octet-stream' })

    await cacheFile(fileId, blob)
    console.log(`[FileShare] ✅ 복원 완료: ${fileId} (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB)`)

    return blob
  }

  return { prepareFile, getFileBlob }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192

  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength))
    binary += String.fromCharCode.apply(null, Array.from(chunk))
  }

  return btoa(binary)
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes.buffer
}
