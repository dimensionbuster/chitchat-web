/**
 * base64 인코딩/디코딩 유틸리티
 */

/**
 * ArrayBuffer를 base64 문자열로 변환
 */
export function arrayBufferToBase64(buffer: ArrayBuffer) {
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
export function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)

  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes.buffer
}
