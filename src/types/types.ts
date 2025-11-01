export type ChatMessage = {
  id: string
  authorTrueUuid: string
  authorName: string
  ts: number
  text?: string
  fileId?: string // CID 대신 고유한 파일 ID 사용
}

export type FileMeta = {
  name?: string
  size?: number
  type?: string
  fileData?: string // base64 인코딩된 파일 데이터
  // allow extra metadata fields
  [key: string]: unknown
}

/**
 * 부분 다운로드 상태 (이어받기용)
 * IndexedDB에 저장하여 연결이 끊겨도 복구 가능
 */
export type PartialDownloadState = {
  fileId: string
  fileName: string
  totalChunks: number
  chunkSize: number
  totalBytes: number
  receivedChunks: Set<number> // 수신 완료된 청크 인덱스들
  chunks: Map<number, string> // 청크 인덱스 → base64 데이터
  timestamp: number // 마지막 업데이트 시각
  transferKey: string // transfer-{fileId}-{timestamp}
}
