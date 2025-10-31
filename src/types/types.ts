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
