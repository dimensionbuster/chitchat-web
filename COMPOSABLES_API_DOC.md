# Composables API 문서

이 문서는 ChitChat 애플리케이션의 모든 composable 함수들의 사용법을 설명합니다. **초보자도 이해할 수 있도록** 각 함수가 언제, 어디서, 어떻게 사용되는지 자세히 설명합니다.

---

## 목차
1. [fileConstants](#1-fileconstants)
2. [useYjs](#2-useyjs)
3. [useFileEncoder](#3-usefileencoder)
4. [useStorageFileCache](#4-usestoragefilecache)
5. [useFileTransferState](#5-usefiletransferstate)
6. [useFileTransferProgress](#6-usefiletransferprogress)
7. [useGlobalDataChannelQueue](#7-useglobaldatachannelqueue)
8. [useWebrtcConnection](#8-usewebrtcconnection)
9. [useDirectFileTransfer](#9-usedirectfiletransfer)
10. [useFileTransfer](#10-usefiletransfer)
11. [useFileActions](#11-usefileactions)
12. [useImageAutoLoader](#12-useimageautoloader)
13. [useNotification](#13-usenotification)
14. [useStorageChatroomSettings](#14-usestoragechatroomsettings)
15. [useProfilePicture](#15-useprofilepicture)
16. [useStorageProfilePicture](#16-usestorageprofilepicture)

---

## 1. fileConstants

### 개요
파일 공유 관련 상수를 정의합니다.

### 상수

#### `FILE_DATA_THRESHOLD`
- **타입**: `number` (256KB = 256 * 1024 bytes)
- **설명**: 파일을 처리하는 방식을 결정하는 크기 임계값
- **용도**:
  - **256KB 미만**: Yjs 메타데이터에 Base64로 직접 포함 + 자동 다운로드
  - **256KB 이상**: 메타데이터만 저장하고 P2P로 별도 전송

### 사용 시점
- 파일 업로드 시 전송 방식을 결정할 때
- 이미지 자동 다운로드 여부를 판단할 때

---

## 2. useYjs

### 개요
**Yjs를 사용한 P2P 실시간 동기화**를 관리합니다. 채팅 메시지, 파일 메타데이터, 실시간 파일 전송을 모두 처리하는 **핵심 composable**입니다.

### 초기화

```typescript
const {
  messagesRef,      // 표시할 메시지 (ref)
  files,            // 파일 메타데이터 (Y.Map)
  sendTextMessage,
  attachFileMeta,
  requestFile,
  respondFile,
  loadMoreMessages,
  resetToLatest,
  isViewingLatest,
  forceResync
} = await useYjs('room-123', 'my-user-uuid')
```

### 함수

#### `sendTextMessage(authorTrueUuid: string, authorName: string, text: string)`
- **용도**: 텍스트 메시지 전송
- **시점**: 사용자가 채팅 입력란에서 엔터를 누를 때
- **예시**:
```typescript
sendTextMessage('user-123', 'Alice', '안녕하세요!')
```

#### `attachFileMeta(fileId: string, meta: FileMeta, authorTrueUuid: string, authorName?: string)`
- **용도**: 파일 메타데이터를 Yjs에 등록하고 채팅에 파일 메시지 추가
- **시점**: 파일을 선택하고 업로드 버튼을 누를 때
- **예시**:
```typescript
const { fileId, meta } = await prepareFile(file) // useFileEncoder
attachFileMeta(fileId, meta, 'user-123', 'Alice')
```

#### `requestFile(fileId: string, requesterUuid: string, receivedChunks?: number[], targetUuid?: string)`
- **용도**: 파일 다운로드 요청 (작은 파일용 - 256KB 미만)
- **시점**: 사용자가 파일 메시지를 클릭하여 다운로드할 때
- **파라미터**:
  - `receivedChunks`: 이어받기 시 이미 받은 청크 번호 배열
  - `targetUuid`: 특정 피어에게만 요청 (없으면 브로드캐스트)
- **예시**:
```typescript
// 처음 다운로드
requestFile('file-123', 'my-uuid')

// 이어받기
requestFile('file-123', 'my-uuid', [0, 1, 2, 5, 6], 'sender-uuid')
```

#### `respondFile(fileId: string, fileData: string, targetUuid: string, skipChunks?: number[], onComplete?: () => void)`
- **용도**: 파일 요청에 응답하여 Yjs 청크로 전송
- **시점**: `requestFile` 요청을 awareness에서 감지했을 때 (자동 호출됨)
- **파라미터**:
  - `fileData`: Base64 인코딩된 파일 데이터
  - `skipChunks`: 이어받기 시 건너뛸 청크 (상대방이 이미 가진 것)
- **참고**: 일반적으로 직접 호출할 필요 없음 (`useFileTransfer`가 처리)

#### `getTransferMap(key: string): Y.Map<string>`
- **용도**: 파일 전송용 임시 Y.Map 생성 (청크 저장용)
- **시점**: 파일 전송 시작 시
- **예시**:
```typescript
const transferMap = getTransferMap('transfer-file-123-1234567890')
transferMap.set('chunk-0', 'base64data...')
```

#### `loadMoreMessages(): boolean`
- **용도**: 이전 메시지를 더 불러오기 (스크롤 위로)
- **시점**: 사용자가 채팅창 맨 위로 스크롤할 때
- **반환값**: `true`면 더 불러올 메시지가 있음, `false`면 끝
- **예시**:
```typescript
const hasMore = loadMoreMessages() // 30개 더 로드
```

#### `resetToLatest()`
- **용도**: 최신 메시지로 돌아가기 (기본 50개만 표시)
- **시점**: 사용자가 "최신 메시지 보기" 버튼을 누를 때

#### `isViewingLatest(): boolean`
- **용도**: 현재 최신 메시지를 보고 있는지 확인
- **반환값**: `true`면 최신 메시지 표시 중
- **예시**:
```typescript
if (!isViewingLatest()) {
  // "새 메시지 있음" 배지 표시
}
```

#### `forceResync(): Promise<boolean>`
- **용도**: Yjs 데이터 초기화 및 재동기화
- **시점**: 동기화 오류 발생 시 또는 관리자가 강제 초기화할 때
- **주의**: 로컬 데이터를 모두 지우므로 신중하게 사용

### 사용 예시 (채팅방 컴포넌트)

```typescript
// 초기화
const yjs = await useYjs(roomId, myUuid)

// 메시지 표시
<MessageList :messages="yjs.messagesRef" />

// 텍스트 전송
function sendMessage(text: string) {
  yjs.sendTextMessage(myUuid, myName, text)
}

// 파일 업로드
async function uploadFile(file: File) {
  const { fileId, meta } = await prepareFile(file)
  await cacheFile(fileId, file)
  yjs.attachFileMeta(fileId, meta, myUuid, myName)
}
```

---

## 3. useFileEncoder

### 개요
**파일과 Base64 간 변환**을 처리합니다. 작은 파일을 Yjs 메타데이터에 포함시키거나 추출할 때 사용합니다.

### 함수

#### `prepareFile(file: File): Promise<{ fileId: string, meta: FileMeta }>`
- **용도**: File 객체를 준비하고 메타데이터 생성
  - 캐시에 저장
  - 256KB 이하면 Base64 인코딩하여 메타에 포함
- **시점**: 사용자가 파일을 선택했을 때
- **예시**:
```typescript
async function handleFileSelect(file: File) {
  const { fileId, meta } = await prepareFile(file)
  console.log(meta) // { name, size, type, fileData?: string }
  
  // Yjs에 등록
  attachFileMeta(fileId, meta, myUuid, myName)
}
```

#### `getFileBlob(fileId: string, meta: FileMeta): Promise<Blob>`
- **용도**: 메타데이터에서 Blob 생성
  - 캐시 우선 조회
  - 없으면 `meta.fileData` (Base64) 디코딩
- **시점**: 작은 파일을 다운로드하거나 표시할 때
- **예시**:
```typescript
const meta = files.get(fileId)
if (meta?.fileData) {
  const blob = await getFileBlob(fileId, meta)
  const url = URL.createObjectURL(blob)
  imgElement.src = url
}
```

#### `arrayBufferToBase64(buffer: ArrayBuffer): string`
- **용도**: ArrayBuffer를 Base64 문자열로 변환
- **시점**: 파일 데이터를 Yjs에 포함시킬 때

#### `base64ToArrayBuffer(base64: string): ArrayBuffer`
- **용도**: Base64 문자열을 ArrayBuffer로 변환
- **시점**: Yjs에서 파일 데이터를 추출할 때

### 사용 예시

```typescript
const { prepareFile, getFileBlob } = useFileEncoder()

// 업로드
const { fileId, meta } = await prepareFile(selectedFile)

// 다운로드
if (meta.fileData) {
  const blob = await getFileBlob(fileId, meta)
  triggerDownload(blob, meta.name)
}
```

---

## 4. useStorageFileCache

### 개요
**IndexedDB를 사용한 파일 캐시 관리**입니다. 한 번 다운로드한 파일을 로컬에 저장하여 재다운로드를 방지합니다.

### 함수

#### `cacheFile(fileId: string, blob: Blob): Promise<void>`
- **용도**: 파일을 IndexedDB에 저장
- **시점**: 파일 업로드 시 또는 다운로드 완료 시
- **예시**:
```typescript
await cacheFile('file-123', new Blob([arrayBuffer]))
```

#### `getCachedFile(fileId: string): Promise<Blob | null>`
- **용도**: 캐시에서 파일 조회
- **시점**: 파일 다운로드 전에 캐시 확인
- **반환값**: 캐시된 Blob 또는 `null`
- **예시**:
```typescript
const cached = await getCachedFile(fileId)
if (cached) {
  console.log('캐시 히트!')
  return cached
} else {
  // P2P 다운로드 시작
}
```

#### `hasCachedFile(fileId: string): Promise<boolean>`
- **용도**: 파일이 캐시에 있는지 확인
- **예시**:
```typescript
if (await hasCachedFile(fileId)) {
  showCachedBadge()
}
```

### 사용 예시

```typescript
// 다운로드 전 캐시 확인
async function downloadFile(fileId: string) {
  const cached = await getCachedFile(fileId)
  if (cached) return cached
  
  // 캐시 없으면 P2P 다운로드
  const blob = await requestFileP2P(fileId)
  await cacheFile(fileId, blob)
  return blob
}
```

---

## 5. useFileTransferState

### 개요
**이어받기(Resume) 기능**을 지원하기 위한 다운로드 상태 관리입니다. 연결이 끊겨도 진행 상황을 IndexedDB에 저장하여 나중에 재개할 수 있습니다.

### 함수

#### `saveDownloadState(state: PartialDownloadState): Promise<void>`
- **용도**: 다운로드 진행 상태를 IndexedDB에 저장
- **시점**: 청크를 10개 받을 때마다 또는 연결 끊김 시
- **예시**:
```typescript
const state = {
  fileId: 'file-123',
  fileName: 'document.pdf',
  totalChunks: 100,
  receivedChunks: new Set([0, 1, 2, 5]),
  chunks: new Map([[0, 'base64...'], [1, 'base64...']]),
  // ...
}
await saveDownloadState(state)
```

#### `loadDownloadState(fileId: string): Promise<PartialDownloadState | null>`
- **용도**: 저장된 다운로드 상태 불러오기
- **시점**: 파일 다운로드 시작 전에 이어받기 가능 여부 확인
- **반환값**: 저장된 상태 또는 `null`
- **예시**:
```typescript
const partialState = await loadDownloadState(fileId)
if (partialState) {
  console.log(`이어받기: ${partialState.receivedChunks.size}/${partialState.totalChunks}`)
}
```

#### `deleteDownloadState(fileId: string): Promise<void>`
- **용도**: 다운로드 완료 후 상태 삭제
- **시점**: 파일 다운로드가 100% 완료되었을 때

#### `getAllDownloadStates(): Promise<PartialDownloadState[]>`
- **용도**: 중단된 모든 다운로드 조회
- **시점**: 앱 시작 시 또는 "중단된 다운로드" 목록 표시 시

#### `cleanupOldStates(): Promise<void>`
- **용도**: 24시간 이상 된 다운로드 상태 자동 삭제
- **시점**: 앱 시작 시 자동 호출됨

#### `hasChunk(state: PartialDownloadState, chunkIndex: number): boolean`
- **용도**: 특정 청크를 이미 받았는지 확인

#### `addChunk(state: PartialDownloadState, chunkIndex: number, chunkData: string)`
- **용도**: 청크를 상태에 추가

#### `isComplete(state: PartialDownloadState): boolean`
- **용도**: 모든 청크를 받았는지 확인

#### `mergeChunks(state: PartialDownloadState): string`
- **용도**: 모든 청크를 순서대로 결합하여 하나의 Base64 문자열 생성
- **시점**: 다운로드 완료 후 Blob 생성 전

#### `getProgress(state: PartialDownloadState): number`
- **용도**: 진행률 계산 (0-100%)

### 사용 예시

```typescript
// 다운로드 시작 전 이어받기 확인
const partialState = await loadDownloadState(fileId)
if (partialState) {
  console.log('이어받기 가능!')
  // 이미 받은 청크 건너뛰고 나머지만 요청
  requestFile(fileId, myUuid, Array.from(partialState.receivedChunks))
}

// 다운로드 중 상태 저장
if (state.receivedChunks.size % 10 === 0) {
  await saveDownloadState(state)
}

// 완료 시 상태 삭제
if (isComplete(state)) {
  const fullData = mergeChunks(state)
  await deleteDownloadState(fileId)
}
```

---

## 6. useFileTransferProgress

### 개요
**파일 전송 진행 상황을 UI에 표시**하기 위한 전역 상태 관리입니다. 업로드/다운로드 진행률을 실시간으로 추적합니다.

### 반환값

```typescript
const {
  transfers,        // Record<fileId, FileTransferProgress>
  uploadQueueInfo,  // { activeCount, queuedCount, maxConcurrent }
  startTransfer,
  updateProgress,
  completeTransfer,
  failTransfer,
  cancelTransfer,
  getProgress,
  getProgressPercent,
  isTransferring,
  updateUploadQueue
}
```

### 함수

#### `startTransfer(fileId, fileName, type, totalChunks, totalBytes, isResumable?)`
- **용도**: 새로운 파일 전송 시작 (진행 상태 초기화)
- **파라미터**:
  - `type`: `'upload'` 또는 `'download'`
  - `isResumable`: 이어받기 가능 여부 (기본 `true`)
- **시점**: 파일 전송을 시작할 때
- **예시**:
```typescript
startTransfer('file-123', 'document.pdf', 'download', 100, 5242880)
```

#### `updateProgress(fileId: string, receivedChunks: number)`
- **용도**: 전송된 청크 수 업데이트
- **시점**: 청크를 받거나 보낼 때마다
- **예시**:
```typescript
updateProgress('file-123', 45) // 45/100 청크 완료
```

#### `completeTransfer(fileId: string)`
- **용도**: 전송 완료 표시 (5초 후 자동 제거)
- **시점**: 모든 청크 전송 완료 시

#### `cancelTransfer(fileId: string)`
- **용도**: 전송 취소 및 상태 제거
- **시점**: 사용자가 "취소" 버튼을 누를 때

#### `getProgress(fileId: string): FileTransferProgress | undefined`
- **용도**: 특정 파일의 진행 상태 조회
- **반환값**: `{ fileId, fileName, type, totalChunks, receivedChunks, totalBytes, isComplete, startTime, isResumable }`

#### `getProgressPercent(fileId: string): number`
- **용도**: 진행률 계산 (0-100)
- **예시**:
```typescript
const percent = getProgressPercent('file-123') // 45.0
```

#### `isTransferring(fileId: string): boolean`
- **용도**: 현재 전송 중인지 확인

### 사용 예시 (Vue 컴포넌트)

```vue
<template>
  <div v-for="[fileId, progress] in Object.entries(transfers)" :key="fileId">
    <div>{{ progress.fileName }}</div>
    <div>{{ progress.type === 'upload' ? '업로드' : '다운로드' }}</div>
    <progress :value="getProgressPercent(fileId)" max="100"></progress>
    <button @click="cancelTransfer(fileId)">취소</button>
  </div>
</template>

<script setup>
const { transfers, getProgressPercent, cancelTransfer } = useFileTransferProgress()
</script>
```

---

## 7. useGlobalDataChannelQueue

### 개요
**모든 데이터 전송을 우선순위 큐로 관리**하는 싱글톤 매니저입니다. 동시 전송 수를 제한하고 중요한 파일을 먼저 보내도록 스케줄링합니다.

### 초기화

```typescript
const {
  enqueue,
  cancelJob,
  setProvider,
  registerDataChannel,
  unregisterDataChannel,
  stats,      // reactive 통계
  queueState  // reactive 큐 상태
} = useGlobalDataChannelQueue()
```

### 함수

#### `setProvider(provider: WebrtcProvider)`
- **용도**: WebRTC Provider 등록
- **시점**: Yjs 초기화 직후
- **예시**:
```typescript
const yjs = await useYjs(roomId)
setProvider(yjs.provider)
```

#### `registerDataChannel(peerId: string, channel: RTCDataChannel)`
- **용도**: 데이터 채널을 큐 매니저에 등록
- **시점**: WebRTC 연결 생성 후
- **자동 처리**: `useWebrtcConnection`이 자동으로 호출

#### `unregisterDataChannel(peerId: string)`
- **용도**: 데이터 채널 등록 해제
- **시점**: 연결 종료 시
- **자동 처리**: 채널이 닫히면 자동 호출

#### `enqueue(job: DataChannelJob): string`
- **용도**: 전송 작업을 큐에 추가
- **반환값**: 작업 ID
- **시점**: 파일 전송 시작 시
- **예시**:
```typescript
const job = createFileTransferJob(
  fileId,
  fileName,
  targetPeerId,
  fileSize,
  DataChannelPriority.NORMAL,
  async (onProgress, checkCancelled) => {
    // 실제 전송 로직
  }
)
const jobId = enqueue(job)
```

#### `cancelJob(jobId: string): boolean`
- **용도**: 큐에 있는 작업 취소 (아직 시작 안 된 것만)
- **반환값**: `true`면 취소 성공

### 헬퍼 함수

#### `createFileTransferJob(...): DataChannelJob`
- **용도**: 파일 전송 작업 생성
- **파라미터**:
  - `fileId`, `fileName`, `targetPeerId`, `dataSize`
  - `priority`: `DataChannelPriority.HIGH` 등
  - `executeFunc`: 실제 전송 함수
- **예시**:
```typescript
const job = createFileTransferJob(
  'file-123',
  'image.png',
  'peer-456',
  102400, // 100KB
  DataChannelPriority.HIGH,
  async (onProgress, checkCancelled) => {
    // 전송 로직
    await sendFileDirectInternal(fileId, targetPeerId, fileData, onProgress, checkCancelled)
  }
)
```

#### `createImageTransferJob(...): DataChannelJob`
- **용도**: 이미지 전송 작업 생성 (우선순위 높음)

#### `createProfilePictureJob(...): DataChannelJob`
- **용도**: 프로필 사진 전송 작업 생성 (최우선 순위, 취소 불가)

### 우선순위

```typescript
enum DataChannelPriority {
  CRITICAL = 0,  // 프로필 사진 (즉시 전송)
  HIGH = 1,      // 채팅 이미지, 100KB 미만 파일
  NORMAL = 2,    // 일반 파일
  LOW = 3        // 10MB 초과 대용량 파일
}
```

### 통계 정보 (stats)

```typescript
{
  totalJobs: 10,          // 총 작업 수
  activeJobs: 2,          // 현재 전송 중
  queuedJobs: 5,          // 대기 중
  completedJobs: 3,       // 완료
  failedJobs: 0,          // 실패
  cancelledJobs: 0,       // 취소
  totalBytesSent: 5242880,// 전송된 바이트
  totalBytesQueued: 10485760, // 대기 중 바이트
  averageSpeed: 1048576   // 평균 속도 (bytes/sec)
}
```

### 사용 예시

```typescript
// 초기화
const { enqueue, stats, queueState } = useGlobalDataChannelQueue()
setProvider(yjsProvider)

// 파일 전송
async function sendFile(fileId: string, targetPeerId: string) {
  const job = createFileTransferJob(
    fileId,
    'document.pdf',
    targetPeerId,
    1048576, // 1MB
    DataChannelPriority.NORMAL,
    async (onProgress, checkCancelled) => {
      // 전송 로직
    }
  )
  enqueue(job)
}

// UI에서 통계 표시
console.log(`활성: ${stats.activeJobs}, 대기: ${stats.queuedJobs}`)
console.log(`평균 속도: ${(stats.averageSpeed / 1024).toFixed(0)} KB/s`)
```

---

## 8. useWebrtcConnection

### 개요
**WebRTC PeerConnection 및 DataChannel을 관리**합니다. Offer/Answer 교환, ICE 후보 수집, 연결 생명주기를 담당합니다.

### 초기화

```typescript
const {
  createOffer,
  createAnswer,
  cleanup,
  cancelTransfer,
  activeChannels
} = useWebrtcConnection(provider, myUuid)
```

### 함수

#### `createOffer(fileId, targetUuid, totalChunks, fileSize): Promise<RTCDataChannel>`
- **용도**: Offer를 생성하고 데이터 채널 반환 (발신자)
- **시점**: 파일 전송을 시작할 때
- **반환값**: 열린 데이터 채널
- **예시**:
```typescript
const channel = await createOffer('file-123', 'peer-456', 100, 5242880)
// 이제 channel.send()로 데이터 전송 가능
```

#### `createAnswer(offer: FileTransferOffer): Promise<RTCDataChannel>`
- **용도**: Offer에 응답하고 데이터 채널 반환 (수신자)
- **시점**: awareness에서 Offer를 감지했을 때
- **반환값**: 열린 데이터 채널
- **예시**:
```typescript
// Offer 수신
const offer = awarenessState.fileTransferOffer
if (offer && offer.targetUuid === myUuid) {
  const channel = await createAnswer(offer)
  // channel.onmessage로 데이터 수신
}
```

#### `cleanup(connectionId: string)`
- **용도**: PeerConnection과 DataChannel 정리
- **시점**: 파일 전송 완료 또는 실패 시
- **자동 처리**: 채널이 닫히면 자동 호출됨

#### `cancelTransfer(fileId, peerUuid, reason)`
- **용도**: 파일 전송 취소 메시지 전송 및 연결 정리
- **시점**: 사용자가 전송을 취소할 때

### 시그널링 메시지 타입

#### `FileTransferOffer`
```typescript
{
  fileId: string
  senderUuid: string
  targetUuid: string    // 수신자
  totalChunks: number
  fileSize: number
  sdp: RTCSessionDescriptionInit
  timestamp: number
}
```

#### `FileTransferAnswer`
```typescript
{
  fileId: string
  receiverUuid: string
  targetUuid: string    // 발신자
  sdp: RTCSessionDescriptionInit
  timestamp: number
}
```

### 사용 예시 (일반적으로 직접 사용 안 함)

```typescript
// useDirectFileTransfer가 자동으로 처리하므로
// 대부분의 경우 직접 사용할 필요 없음
```

---

## 9. useDirectFileTransfer

### 개요
**대용량 파일(256KB 이상)을 WebRTC DataChannel로 P2P 직접 전송**합니다. 청크 단위 전송, 이어받기, 버퍼 관리를 자동으로 처리합니다.

### 초기화

```typescript
const {
  sendFileViaQueue,
  receiveFileDirect
} = useDirectFileTransfer(provider, myUuid, filesMap)
```

### 함수

#### `sendFileViaQueue(fileId: string, targetUuid: string): Promise<void>`
- **용도**: 파일을 글로벌 큐를 통해 전송 (권장)
- **시점**: 256KB 이상 파일을 보낼 때
- **자동 처리**: 
  - 파일 크기에 따라 우선순위 자동 결정
  - 큐에 등록하여 순차 전송
- **예시**:
```typescript
await sendFileViaQueue('file-123', 'peer-456')
```

#### `receiveFileDirect(offer: FileTransferOffer): Promise<Blob>`
- **용도**: Offer를 받아 파일 수신
- **시점**: awareness에서 FileTransferOffer를 감지했을 때
- **반환값**: 수신한 파일 Blob
- **자동 처리**: 
  - 이어받기 자동 지원
  - 청크 누락 감지
  - 캐시 저장
- **예시**:
```typescript
const offer = awarenessState.fileTransferOffer
if (offer && offer.targetUuid === myUuid) {
  const blob = await receiveFileDirect(offer)
  await cacheFile(offer.fileId, blob)
}
```

### 내부 동작 (알아두면 좋은 정보)

1. **청크 크기**: 64KB
2. **버퍼 관리**: 8MB 임계값, 버퍼 가득 차면 자동 대기
3. **이어받기**: IndexedDB에 진행 상태 자동 저장
4. **완료 메시지**: 모든 청크 전송 후 `{ type: 'complete' }` 전송

### 사용 예시

```typescript
// 전송 (useFileTransfer가 자동 호출)
const { sendFileViaQueue } = useDirectFileTransfer(provider, myUuid, filesMap)
await sendFileViaQueue(fileId, targetUuid)

// 수신 (useFileTransfer가 자동 호출)
const blob = await receiveFileDirect(offer)
```

---

## 10. useFileTransfer

### 개요
**파일 전송의 최상위 오케스트레이터**입니다. 파일 크기에 따라 전송 방식을 자동 선택하고, 업로드 큐를 관리하며, 이어받기를 지원합니다.

이것이 **가장 중요한 composable**이며, 대부분의 경우 이것만 사용하면 됩니다.

### 초기화

```typescript
const {
  setupFileRequestListener,  // 필수: 앱 시작 시 호출
  requestFileP2P,
  registerFileAvailability,
  getUploadStats,
  queueStats,
  queueState,
  cancelJob
} = useFileTransfer(
  provider,
  files,          // Y.Map<FileMeta>
  myUuid,
  requestFile,    // useYjs의 함수
  respondFile,    // useYjs의 함수
  getTransferMap  // useYjs의 함수
)
```

### 함수

#### `setupFileRequestListener()`
- **용도**: 파일 요청 리스너 설정 (필수!)
- **시점**: **채팅방 입장 직후 무조건 호출**
- **역할**:
  - 다른 사용자의 파일 요청을 감지
  - 자동으로 파일 전송 시작
  - 파일 소유권을 awareness에 브로드캐스트
- **예시**:
```typescript
const yjs = await useYjs(roomId, myUuid)
const fileTransfer = useFileTransfer(/* ... */)
fileTransfer.setupFileRequestListener() // 필수!
```

#### `requestFileP2P(fileId: string): Promise<Blob>`
- **용도**: 파일 다운로드 요청 및 수신
- **시점**: 사용자가 파일을 다운로드하려고 할 때
- **자동 처리**:
  - 캐시 확인
  - 파일 크기에 따라 방식 선택 (Yjs 또는 P2P)
  - 최적의 발신자 선택
  - 이어받기 자동 시도
- **반환값**: 다운로드된 파일 Blob
- **예시**:
```typescript
async function downloadFile(fileId: string) {
  try {
    const blob = await requestFileP2P(fileId)
    const meta = files.get(fileId)
    triggerDownload(blob, meta?.name || fileId)
  } catch (error) {
    console.error('다운로드 실패:', error)
  }
}
```

#### `registerFileAvailability(fileId: string): Promise<void>`
- **용도**: 파일 업로드 후 소유권 브로드캐스트
- **시점**: 파일 업로드가 완료되었을 때
- **역할**: 다른 사용자들에게 "내가 이 파일을 가지고 있음"을 알림
- **예시**:
```typescript
// 파일 업로드
await cacheFile(fileId, blob)
attachFileMeta(fileId, meta, myUuid, myName)
await registerFileAvailability(fileId) // 소유권 브로드캐스트
```

#### `getUploadStats()`
- **용도**: 현재 업로드 통계 조회
- **반환값**: `{ activeCount, queuedCount, maxConcurrent, totalJobs, completedJobs, ... }`

#### `cancelJob(jobId: string): boolean`
- **용도**: 큐에 있는 전송 작업 취소

### 파일 전송 방식 (자동 선택)

#### 256KB 미만 파일
- **방식**: Yjs awareness + YMap 청크 전송
- **장점**: 간단, 여러 피어에게 자동 동기화
- **단점**: 대용량 파일에는 부적합

#### 256KB 이상 파일
- **방식**: WebRTC DataChannel 직접 P2P 전송
- **장점**: 빠르고 효율적, 이어받기 지원
- **단점**: 일대일 전송만 가능

### 사용 예시 (완전한 파일 업로드/다운로드)

```typescript
// === 초기화 (ChatRoom.vue) ===
const yjs = await useYjs(roomId, myUuid)
const fileTransfer = useFileTransfer(
  yjs.provider,
  yjs.files,
  myUuid,
  yjs.requestFile,
  yjs.respondFile,
  yjs.getTransferMap
)
fileTransfer.setupFileRequestListener() // 필수!

// === 파일 업로드 ===
async function uploadFile(file: File) {
  // 1. 파일 준비 및 캐시
  const { fileId, meta } = await prepareFile(file)
  
  // 2. Yjs에 등록
  yjs.attachFileMeta(fileId, meta, myUuid, myName)
  
  // 3. 소유권 브로드캐스트
  await fileTransfer.registerFileAvailability(fileId)
  
  console.log('업로드 완료!')
}

// === 파일 다운로드 ===
async function downloadFile(fileId: string) {
  try {
    // 1. P2P 다운로드 (캐시 자동 확인)
    const blob = await fileTransfer.requestFileP2P(fileId)
    
    // 2. 브라우저 저장
    const meta = yjs.files.get(fileId)
    triggerDownload(blob, meta?.name || fileId)
  } catch (error) {
    alert('다운로드 실패: ' + error.message)
  }
}
```

---

## 11. useFileActions

### 개요
**파일 다운로드 및 저장 액션**을 처리합니다. 브라우저의 파일 저장 대화상자를 띄웁니다.

### 초기화

```typescript
const {
  downloadFile,
  triggerDownload
} = useFileActions(
  files,           // Y.Map<FileMeta>
  requestFileP2P   // useFileTransfer의 함수
)
```

### 함수

#### `downloadFile(fileId: string): Promise<void>`
- **용도**: 파일을 다운로드하여 로컬에 저장
- **시점**: 사용자가 파일 메시지에서 "다운로드" 버튼을 누를 때
- **자동 처리**:
  1. 캐시 확인
  2. 없으면 P2P 요청
  3. 작은 파일이면 메타데이터에서 추출
  4. 브라우저 저장 대화상자 표시
- **예시**:
```typescript
<button @click="downloadFile(message.fileId)">다운로드</button>
```

#### `triggerDownload(blob: Blob, filename: string)`
- **용도**: Blob을 파일로 저장 (브라우저 다운로드)
- **시점**: 이미 Blob이 있을 때
- **예시**:
```typescript
const blob = await requestFileP2P(fileId)
triggerDownload(blob, 'document.pdf')
```

### 사용 예시

```vue
<template>
  <div v-for="msg in messages" :key="msg.id">
    <div v-if="msg.fileId">
      <span>{{ files.get(msg.fileId)?.name }}</span>
      <button @click="downloadFile(msg.fileId)">다운로드</button>
    </div>
  </div>
</template>

<script setup>
const { downloadFile } = useFileActions(files, requestFileP2P)
</script>
```

---

## 12. useImageAutoLoader

### 개요
**이미지 자동 로드 및 표시**를 관리합니다. 작은 이미지(256KB 이하)를 자동으로 다운로드하고 URL을 생성합니다.

### 초기화

```typescript
const {
  imageUrls,        // ref: Map<fileId, Object URL>
  loadingImages,    // ref: Set<fileId>
  failedDownloads,  // ref: Map<fileId, errorMessage>
  isImage,
  shouldAutoDownload,
  downloadImage,
  processAutoDownload
} = useImageAutoLoader(files, requestFileP2P)
```

### 함수

#### `isImage(fileId: string): boolean`
- **용도**: 파일이 이미지인지 확인 (MIME 타입 체크)

#### `shouldAutoDownload(fileId: string): boolean`
- **용도**: 자동 다운로드 대상인지 확인 (256KB 이하)

#### `downloadImage(fileId: string, forceDownload?: boolean): Promise<void>`
- **용도**: 이미지 다운로드 및 Object URL 생성
- **시점**: 
  - 자동: `processAutoDownload`에서 호출
  - 수동: 사용자가 "이미지 로드" 버튼을 누를 때
- **파라미터**:
  - `forceDownload`: `true`면 재시도 (실패한 다운로드)
- **자동 처리**:
  - 캐시 우선 확인
  - 메타데이터에서 추출 또는 P2P 요청
  - `imageUrls`에 Object URL 저장
- **예시**:
```typescript
await downloadImage('image-123')
const url = imageUrls.value.get('image-123')
imgElement.src = url
```

#### `processAutoDownload(messages: ChatMessage[]): Promise<void>`
- **용도**: 메시지 목록에서 자동 다운로드 대상 이미지 찾아서 다운로드
- **시점**: 
  - 메시지 목록이 업데이트될 때 (watch)
  - 채팅방 입장 시
- **예시**:
```typescript
watch(() => messages.value, (newMessages) => {
  processAutoDownload(newMessages)
}, { immediate: true })
```

### 사용 예시

```vue
<template>
  <div v-for="msg in messages" :key="msg.id">
    <div v-if="msg.fileId && isImage(msg.fileId)">
      <!-- 자동 로드됨 -->
      <img v-if="imageUrls.get(msg.fileId)" 
           :src="imageUrls.get(msg.fileId)" 
           alt="image" />
      
      <!-- 로딩 중 -->
      <div v-else-if="loadingImages.has(msg.fileId)">
        로딩 중...
      </div>
      
      <!-- 실패 시 재시도 -->
      <div v-else-if="failedDownloads.has(msg.fileId)">
        <span>{{ failedDownloads.get(msg.fileId) }}</span>
        <button @click="downloadImage(msg.fileId, true)">재시도</button>
      </div>
      
      <!-- 큰 이미지는 수동 다운로드 -->
      <button v-else-if="!shouldAutoDownload(msg.fileId)"
              @click="downloadImage(msg.fileId)">
        이미지 로드 ({{ (files.get(msg.fileId)?.size / 1024).toFixed(0) }}KB)
      </button>
    </div>
  </div>
</template>

<script setup>
const {
  imageUrls,
  loadingImages,
  failedDownloads,
  isImage,
  shouldAutoDownload,
  downloadImage,
  processAutoDownload
} = useImageAutoLoader(files, requestFileP2P)

// 자동 다운로드
watch(() => messages.value, (newMessages) => {
  processAutoDownload(newMessages)
}, { immediate: true })
</script>
```

---

## 13. useNotification

### 개요
**플랫폼별 알림 표시**를 관리합니다. Electron에서는 커스텀 알림창, 웹에서는 브라우저 알림을 사용합니다.

### 함수

#### `showNotification(authorName, text, messageId, roomId)`
- **용도**: 새 메시지 알림 표시
- **시점**: 
  - 새 메시지가 도착했을 때
  - 앱이 백그라운드에 있을 때
  - 다른 채팅방에 있을 때
- **파라미터**:
  - `authorName`: 보낸 사람 이름
  - `text`: 메시지 내용
  - `messageId`: 메시지 ID (클릭 시 스크롤용)
  - `roomId`: 채팅방 ID
- **플랫폼별 동작**:
  - **Electron**: 커스텀 알림창 표시 (`window.electronAPI.createNotification`)
  - **Web**: 콘솔 로그 (또는 브라우저 Notification API 사용 가능)
- **예시**:
```typescript
// Yjs 메시지 observe
messagesMap.observe(() => {
  const latestMessage = sortedMessages[sortedMessages.length - 1]
  if (latestMessage.authorTrueUuid !== myUuid) {
    showNotification(
      latestMessage.authorName,
      latestMessage.text || '[파일]',
      latestMessage.id,
      roomId
    )
  }
})
```

### 사용 예시

```typescript
const { showNotification } = useNotification()

// 새 메시지 도착 시
watch(() => messages.value, (newMessages, oldMessages) => {
  if (newMessages.length > oldMessages.length) {
    const latestMsg = newMessages[newMessages.length - 1]
    if (latestMsg.authorTrueUuid !== myUuid && !isWindowFocused) {
      showNotification(
        latestMsg.authorName,
        latestMsg.text || '[파일]',
        latestMsg.id,
        roomId
      )
    }
  }
})
```

---

## 14. useStorageChatroomSettings

### 개요
**IndexedDB를 사용한 채팅방 설정 저장/관리**입니다. 채팅방별로 사용자 설정을 저장합니다.

### 함수

#### `saveChatroomOption(roomId: string, option: ChatroomOption): Promise<void>`
- **용도**: 채팅방 설정 저장
- **시점**: 사용자가 설정을 변경할 때
- **예시**:
```typescript
const option = {
  userName: 'Alice',
  roomName: '팀 채팅방',
  notifications: true,
  autoDownload: true
}
await saveChatroomOption('room-123', option)
```

#### `getChatroomOption(roomId: string): Promise<ChatroomOption | null>`
- **용도**: 채팅방 설정 불러오기
- **시점**: 채팅방 입장 시
- **반환값**: 저장된 설정 또는 `null`
- **예시**:
```typescript
const option = await getChatroomOption('room-123')
if (option) {
  userName.value = option.userName
  roomName.value = option.roomName
}
```

#### `exportOptionAsJSON(): Promise<string>`
- **용도**: 모든 채팅방 설정을 JSON으로 내보내기
- **시점**: 설정 백업 시
- **반환값**: JSON 문자열
- **예시**:
```typescript
const json = await exportOptionAsJSON()
const blob = new Blob([json], { type: 'application/json' })
triggerDownload(blob, 'chatroom-settings.json')
```

#### `importOptionFromJSON(jsonString: string): Promise<void>`
- **용도**: JSON에서 채팅방 설정 가져오기
- **시점**: 설정 복원 시
- **예시**:
```typescript
const file = await selectFile()
const text = await file.text()
await importOptionFromJSON(text)
alert('설정 복원 완료!')
```

### 사용 예시

```vue
<template>
  <div>
    <input v-model="userName" @change="saveSettings" />
    <input v-model="roomName" @change="saveSettings" />
    <button @click="exportSettings">설정 내보내기</button>
    <button @click="importSettings">설정 가져오기</button>
  </div>
</template>

<script setup>
const userName = ref('')
const roomName = ref('')

// 설정 불러오기
onMounted(async () => {
  const option = await getChatroomOption(roomId)
  if (option) {
    userName.value = option.userName
    roomName.value = option.roomName
  }
})

// 설정 저장
async function saveSettings() {
  await saveChatroomOption(roomId, {
    userName: userName.value,
    roomName: roomName.value
  })
}

// 내보내기
async function exportSettings() {
  const json = await exportOptionAsJSON()
  const blob = new Blob([json], { type: 'application/json' })
  triggerDownload(blob, 'settings.json')
}

// 가져오기
async function importSettings() {
  const file = await selectFile()
  const text = await file.text()
  await importOptionFromJSON(text)
  location.reload()
}
</script>
```

---

## 15. useProfilePicture

### 개요
**프로필 사진 처리 및 전송 관리**를 담당합니다. 이미지 리사이징, 압축, 글로벌 큐를 통한 업로드/다운로드, awareness를 통한 프로필 동기화를 모두 처리합니다.

### 초기화

```typescript
const {
  myProfilePicture,
  profilePictures,
  getUserProfilePicture,
  setMyProfilePicture,
  deleteMyProfilePicture,
  sendProfilePicture,
  handlePeerConnected,
  initializeProfilePictures,
  getProfileOriginalFileId
} = useProfilePicture(
  provider,                    // WebrtcProvider
  myUuid,                      // 내 사용자 ID
  files,                       // Y.Map<FileMeta> (선택)
  registerFileAvailability     // 파일 소유권 브로드캐스트 함수 (선택)
)
```

### 상태

#### `myProfilePicture`
- **타입**: `ref<string | null>`
- **설명**: 내 프로필 사진 (data URL)
- **예시**: `data:image/jpeg;base64,/9j/4AAQSkZJRg...`

#### `profilePictures`
- **타입**: `reactive<Map<userId, base64Data>>`
- **설명**: 모든 사용자의 프로필 사진 캐시

#### `getUserProfilePicture`
- **타입**: `computed<(userId: string) => string | null>`
- **용도**: 특정 사용자의 프로필 사진 가져오기
- **예시**:
```typescript
const avatarUrl = getUserProfilePicture('user-123')
if (avatarUrl) {
  imgElement.src = avatarUrl
}
```

### 함수

#### `initializeProfilePictures(): Promise<void>`
- **용도**: 프로필 사진 시스템 초기화 (필수!)
- **시점**: 채팅방 입장 직후 무조건 호출
- **역할**:
  - 내 프로필 사진 IndexedDB에서 로드
  - awareness에 프로필 존재 알림
  - 수신 리스너 설정
- **예시**:
```typescript
await initializeProfilePictures() // 필수!
```

#### `setMyProfilePicture(file: File): Promise<void>`
- **용도**: 내 프로필 사진 설정
- **시점**: 사용자가 프로필 사진 업로드 버튼을 누를 때
- **자동 처리**:
  1. 원본 파일을 파일 전송 시스템에 저장 (고해상도 원본)
  2. 이미지 리사이징 (최대 256px x 256px)
  3. JPEG 압축 (품질 자동 조정, 최대 100KB)
  4. IndexedDB에 저장
  5. awareness에 프로필 존재 알림
  6. 연결된 모든 피어에게 자동 전송
- **예시**:
```typescript
async function uploadProfilePicture(file: File) {
  try {
    await setMyProfilePicture(file)
    alert('프로필 사진 설정 완료!')
  } catch (error) {
    alert('프로필 사진 설정 실패: ' + error.message)
  }
}
```

#### `deleteMyProfilePicture(): Promise<void>`
- **용도**: 내 프로필 사진 삭제
- **시점**: 사용자가 프로필 사진 삭제 버튼을 누를 때
- **예시**:
```typescript
await deleteMyProfilePicture()
```

#### `sendProfilePicture(targetPeerId: string): Promise<void>`
- **용도**: 특정 피어에게 프로필 사진 전송
- **시점**: 
  - 피어 연결 시 자동 호출됨
  - 수동으로 재전송 필요 시
- **자동 처리**: 글로벌 큐를 통해 최우선 순위로 전송
- **예시**:
```typescript
await sendProfilePicture('peer-456')
```

#### `handlePeerConnected(peerId: string): Promise<void>`
- **용도**: 피어 연결 시 프로필 사진 교환
- **시점**: WebRTC 연결이 성립했을 때
- **역할**:
  - 내 프로필 사진이 있으면 자동 전송
  - 상대방 프로필 사진이 있으면 자동 요청
  - 중복 전송/요청 방지
- **예시**:
```typescript
// useWebrtcConnection에서 자동 호출됨
provider.awareness.on('change', () => {
  for (const [, state] of provider.awareness.getStates()) {
    const peerId = state.userUuid
    if (peerId && peerId !== myUuid) {
      handlePeerConnected(peerId)
    }
  }
})
```

#### `getProfileOriginalFileId(userId: string): Promise<string | null>`
- **용도**: 프로필 원본 파일 ID 가져오기
- **시점**: 고해상도 원본 이미지를 다운로드하려고 할 때
- **반환값**: 원본 파일 ID 또는 `null`
- **예시**:
```typescript
const originalFileId = await getProfileOriginalFileId('user-123')
if (originalFileId) {
  // 파일 전송 시스템을 통해 원본 다운로드
  await downloadFile(originalFileId)
}
```

### 이미지 처리 상세

#### 리사이징 및 압축
1. **최대 크기**: 256px x 256px (긴 쪽 기준, 비율 유지)
2. **포맷**: JPEG
3. **초기 품질**: 0.85
4. **최대 크기**: 100KB
5. **자동 조정**: 크기가 100KB를 초과하면 품질을 자동으로 낮춤 (최소 0.1)

#### 저장 형태
- **썸네일**: Base64로 IndexedDB에 저장 (빠른 로드)
- **원본**: 파일 전송 시스템에 Blob으로 저장 (고해상도)

### 사용 예시

```vue
<template>
  <div class="profile-section">
    <!-- 내 프로필 사진 -->
    <div class="my-profile">
      <img v-if="myProfilePicture" 
           :src="myProfilePicture" 
           alt="내 프로필" />
      <div v-else class="no-profile">프로필 없음</div>
      
      <input type="file" 
             ref="fileInput"
             accept="image/*"
             @change="handleFileSelect"
             style="display: none" />
      
      <button @click="$refs.fileInput.click()">
        {{ myProfilePicture ? '변경' : '설정' }}
      </button>
      
      <button v-if="myProfilePicture" 
              @click="deleteMyProfilePicture">
        삭제
      </button>
    </div>
    
    <!-- 다른 사용자 프로필 -->
    <div v-for="msg in messages" :key="msg.id" class="message">
      <img v-if="getUserProfilePicture(msg.authorTrueUuid)"
           :src="getUserProfilePicture(msg.authorTrueUuid)"
           alt="프로필"
           class="avatar" />
      <div v-else class="default-avatar">
        {{ msg.authorName[0] }}
      </div>
      <div class="message-content">
        <strong>{{ msg.authorName }}</strong>
        <p>{{ msg.text }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useProfilePicture } from '@/composables/useProfilePicture'

const {
  myProfilePicture,
  getUserProfilePicture,
  setMyProfilePicture,
  deleteMyProfilePicture,
  initializeProfilePictures,
  handlePeerConnected
} = useProfilePicture(
  provider,
  myUuid,
  files,
  registerFileAvailability
)

// 초기화 (필수!)
onMounted(async () => {
  await initializeProfilePictures()
})

// 프로필 사진 업로드
async function handleFileSelect(event) {
  const file = event.target.files?.[0]
  if (!file) return
  
  if (!file.type.startsWith('image/')) {
    alert('이미지 파일만 선택할 수 있습니다')
    return
  }
  
  try {
    await setMyProfilePicture(file)
    alert('프로필 사진 설정 완료!')
  } catch (error) {
    alert('프로필 사진 설정 실패: ' + error.message)
  }
}

// 피어 연결 시 프로필 교환
watch(() => Array.from(provider.awareness.getStates().keys()), (clientIds) => {
  for (const clientId of clientIds) {
    const state = provider.awareness.getStates().get(clientId)
    const peerId = state?.userUuid
    if (peerId && peerId !== myUuid) {
      handlePeerConnected(peerId)
    }
  }
})
</script>

<style scoped>
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.default-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}
</style>
```

---

## 16. useStorageProfilePicture

### 개요
**IndexedDB를 사용한 프로필 사진 로컬 저장**을 관리합니다. Base64 형태로 저장하여 빠른 로드를 지원합니다.

### 함수

#### `saveProfilePicture(profile: ProfilePicture): Promise<void>`
- **용도**: 프로필 사진을 IndexedDB에 저장
- **시점**: 프로필 사진 설정 또는 수신 시
- **파라미터**:
```typescript
interface ProfilePicture {
  userId: string          // 사용자 ID (키)
  imageData: string       // Base64 인코딩된 이미지
  timestamp: number       // 저장 시각
  size: number           // 바이트 크기
  originalFileId?: string // 원본 파일 ID (선택)
}
```
- **예시**:
```typescript
const profile = {
  userId: 'user-123',
  imageData: 'base64data...',
  timestamp: Date.now(),
  size: 50000,
  originalFileId: 'file-456'
}
await saveProfilePicture(profile)
```

#### `getProfilePicture(userId: string): Promise<ProfilePicture | null>`
- **용도**: 프로필 사진 조회
- **시점**: 프로필 사진을 표시하려고 할 때
- **반환값**: 저장된 프로필 또는 `null`
- **예시**:
```typescript
const profile = await getProfilePicture('user-123')
if (profile) {
  imgElement.src = `data:image/jpeg;base64,${profile.imageData}`
}
```

#### `hasProfilePicture(userId: string): Promise<boolean>`
- **용도**: 프로필 사진 존재 여부 확인
- **시점**: 프로필 사진 요청 전 확인
- **예시**:
```typescript
if (await hasProfilePicture('user-123')) {
  console.log('프로필 사진 있음')
}
```

#### `deleteProfilePicture(userId: string): Promise<void>`
- **용도**: 프로필 사진 삭제
- **시점**: 사용자가 프로필 사진을 삭제할 때
- **예시**:
```typescript
await deleteProfilePicture(myUuid)
```

#### `getAllProfilePictures(): Promise<ProfilePicture[]>`
- **용도**: 모든 프로필 사진 조회
- **시점**: 프로필 목록 표시 또는 백업 시
- **예시**:
```typescript
const allProfiles = await getAllProfilePictures()
console.log(`총 ${allProfiles.length}개의 프로필 사진`)
```

### 데이터베이스 구조

- **DB Name**: `chitchat-profile-pictures`
- **Store Name**: `profiles`
- **Key Path**: `userId`
- **Version**: 1

### 사용 예시

```typescript
import {
  saveProfilePicture,
  getProfilePicture,
  hasProfilePicture,
  deleteProfilePicture,
  getAllProfilePictures
} from '@/composables/useStorageProfilePicture'

// 프로필 저장
async function saveProfile(userId: string, imageData: string) {
  const profile = {
    userId,
    imageData,
    timestamp: Date.now(),
    size: Math.ceil((imageData.length * 3) / 4) // Base64 크기 계산
  }
  await saveProfilePicture(profile)
  console.log('프로필 저장 완료')
}

// 프로필 로드
async function loadProfile(userId: string) {
  const profile = await getProfilePicture(userId)
  if (profile) {
    return `data:image/jpeg;base64,${profile.imageData}`
  }
  return null
}

// 프로필 존재 확인
async function checkProfile(userId: string) {
  const exists = await hasProfilePicture(userId)
  console.log(`프로필 ${exists ? '있음' : '없음'}`)
}

// 프로필 삭제
async function removeProfile(userId: string) {
  await deleteProfilePicture(userId)
  console.log('프로필 삭제 완료')
}

// 모든 프로필 조회
async function listAllProfiles() {
  const profiles = await getAllProfilePictures()
  console.log('저장된 프로필:')
  for (const profile of profiles) {
    console.log(`- ${profile.userId}: ${profile.size} bytes (${new Date(profile.timestamp).toLocaleString()})`)
  }
}
```

### 참고사항

- **자동 처리**: `useProfilePicture`가 자동으로 호출하므로 직접 사용할 일은 적습니다
- **캐시 역할**: 네트워크 없이도 프로필 사진을 빠르게 로드할 수 있습니다
- **용량 관리**: 프로필 사진은 압축되어 평균 20-50KB 정도입니다

---

## 전체 사용 흐름 예시

### 채팅방 입장 시

```typescript
// 1. Yjs 초기화
const yjs = await useYjs(roomId, myUuid)

// 2. 파일 전송 초기화
const fileTransfer = useFileTransfer(
  yjs.provider,
  yjs.files,
  myUuid,
  yjs.requestFile,
  yjs.respondFile,
  yjs.getTransferMap
)
fileTransfer.setupFileRequestListener() // 필수!

// 3. 파일 액션 초기화
const fileActions = useFileActions(yjs.files, fileTransfer.requestFileP2P)

// 4. 이미지 자동 로더 초기화
const imageLoader = useImageAutoLoader(yjs.files, fileTransfer.requestFileP2P)

// 5. 알림 초기화
const notification = useNotification()

// 6. 채팅방 설정 불러오기
const option = await getChatroomOption(roomId)
if (option) {
  userName.value = option.userName
}
```

### 텍스트 메시지 전송

```typescript
function sendMessage(text: string) {
  yjs.sendTextMessage(myUuid, userName.value, text)
}
```

### 파일 업로드

```typescript
async function uploadFile(file: File) {
  const { prepareFile } = useFileEncoder()
  
  // 1. 파일 준비
  const { fileId, meta } = await prepareFile(file)
  
  // 2. Yjs에 등록
  yjs.attachFileMeta(fileId, meta, myUuid, userName.value)
  
  // 3. 소유권 브로드캐스트
  await fileTransfer.registerFileAvailability(fileId)
}
```

### 파일 다운로드

```typescript
async function downloadFile(fileId: string) {
  await fileActions.downloadFile(fileId)
}
```

### 이미지 자동 로드

```typescript
// 메시지 변경 시 자동 처리
watch(() => yjs.messagesRef.value, (newMessages) => {
  imageLoader.processAutoDownload(newMessages)
}, { immediate: true })
```

---

## 디버깅 팁

### 콘솔 로그 확인

각 composable은 다음과 같은 접두사로 로그를 출력합니다:
- `[Queue]`: 큐 매니저
- `[WebRTC]`: WebRTC 연결
- `[P2P]`: 직접 전송
- `[FileTransfer]`: 파일 전송 오케스트레이터
- `[Yjs]`: Yjs 동기화
- `[#숫자]`: 전송 단계별 로그

### 전송 상태 확인

```typescript
// 진행 중인 전송
const { transfers } = useFileTransferProgress()
console.log(transfers)

// 큐 상태
const { queueStats, queueState } = useGlobalDataChannelQueue()
console.log(queueStats, queueState.value)
```

### 캐시 확인

```typescript
const cached = await getCachedFile(fileId)
console.log(cached ? '캐시 존재' : '캐시 없음')
```

### 이어받기 상태 확인

```typescript
const { getAllDownloadStates } = useFileTransferState()
const states = await getAllDownloadStates()
console.log('중단된 다운로드:', states)
```

---

## 자주 묻는 질문 (FAQ)

### Q1. 파일 전송이 안 되는데요?
1. `setupFileRequestListener()` 호출했는지 확인
2. 파일이 캐시에 있는지 확인: `await getCachedFile(fileId)`
3. 피어 연결 확인: WebRTC 연결 로그 확인

### Q2. 이미지가 자동으로 로드되지 않아요
- 256KB 이상 이미지는 수동 다운로드가 필요합니다
- `shouldAutoDownload(fileId)`로 확인

### Q3. 다운로드가 중단되었는데 이어받기가 안 돼요
- `loadDownloadState(fileId)`로 상태 확인
- 발신자가 여전히 연결되어 있는지 확인

### Q4. 큐에서 전송이 멈춰요
- `queueStats`와 `queueState` 확인
- 데이터 채널 상태 확인
- 버퍼가 가득 찼는지 확인

### Q5. 여러 파일을 동시에 업로드하려면?
- 자동으로 큐에 추가되어 순차 전송됩니다
- `maxConcurrentJobs` 설정으로 동시 전송 수 조절 가능 (기본 3개)

---

## 요약

### 핵심 Composable (반드시 사용)
1. **useYjs**: 채팅 메시지 + 파일 메타데이터 동기화
2. **useFileTransfer**: 파일 전송 오케스트레이터 (가장 중요!)
3. **useFileActions**: 파일 다운로드 UI

### 보조 Composable (자동 처리됨)
- **useFileEncoder**: 파일 인코딩
- **useStorageFileCache**: 캐시 관리
- **useFileTransferState**: 이어받기
- **useFileTransferProgress**: 진행률 UI
- **useGlobalDataChannelQueue**: 전송 큐 관리
- **useWebrtcConnection**: WebRTC 연결
- **useDirectFileTransfer**: P2P 직접 전송

### 선택적 Composable
- **useImageAutoLoader**: 이미지 자동 로드 (권장)
- **useNotification**: 알림 (선택)
- **useStorageChatroomSettings**: 설정 저장 (선택)
- **useProfilePicture**: 프로필 사진 관리 (권장)
- **useStorageProfilePicture**: 프로필 사진 로컬 저장 (자동 처리됨)

### 기본 사용 패턴

```typescript
// === 초기화 ===
const yjs = await useYjs(roomId, myUuid)
const fileTransfer = useFileTransfer(...)
fileTransfer.setupFileRequestListener() // 필수!

const fileActions = useFileActions(...)
const imageLoader = useImageAutoLoader(...)

// 프로필 사진 (선택)
const profilePicture = useProfilePicture(provider, myUuid, files, registerFileAvailability)
await profilePicture.initializeProfilePictures() // 필수!

// === 전송 ===
yjs.sendTextMessage(myUuid, myName, text)
await uploadFile(file)
await profilePicture.setMyProfilePicture(profileFile)

// === 수신 ===
await fileActions.downloadFile(fileId)
await imageLoader.processAutoDownload(messages)
```

이 문서를 참고하여 ChitChat의 모든 파일 전송 및 프로필 기능을 이해하고 사용하실 수 있습니다! 🎉
