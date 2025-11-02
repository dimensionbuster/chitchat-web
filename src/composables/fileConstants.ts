/**
 * 파일 공유 관련 상수
 */

// 파일 데이터를 Yjs에 직접 넣지 않고 메타데이터만 넣을 크기 임계값 (256KB)
// 이미지 자동 다운로드 크기 제한도 동일하게 적용
export const FILE_DATA_THRESHOLD = 256 * 1024

/**
 * 프로필 사진 관련 상수
 */

// 프로필 사진 최대 크기 (픽셀)
export const PROFILE_PICTURE_MAX_SIZE = 300

// 프로필 사진 압축 품질 (0.0 ~ 1.0)
export const PROFILE_PICTURE_QUALITY = 0.8

// 프로필 사진 최대 파일 크기 (50KB)
// WebRTC DataChannel에서 즉시 전송 가능한 크기
export const PROFILE_PICTURE_MAX_BYTES = 80 * 1024
