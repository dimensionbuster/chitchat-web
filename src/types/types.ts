export type ChatMessage = {
  id: string
  authorTrueUuid: string
  authorName: string
  ts: number // 로컬 타임스탬프 (표시용)
  lamport: number // 논리적 시계 (정렬용)
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

export type ChatroomOption = {
  theme: 'light' | 'dark'
  fontSize: number
  showTimestamps: boolean
  showNotifications: boolean
  soundEffects: boolean
  [key: string]: unknown // 확장 가능
}

/**
 * 프로필 사진 데이터 (썸네일)
 */
export type ProfilePicture = {
  userId: string          // user-{uuid}
  imageData: string       // base64 인코딩된 이미지 데이터 (압축됨)
  timestamp: number       // 업데이트 시각
  size: number            // 데이터 크기 (bytes)
  originalFileId?: string // 원본 파일 ID (파일 전송으로 다운로드 가능)
}

/**
 * 프로필 사진 awareness 메타데이터
 */
export type ProfilePictureAwareness = {
  userId: string
  hasProfilePicture: boolean
  timestamp: number
  originalFileId?: string // 원본 파일 ID (다른 피어가 요청할 수 있도록)
}
