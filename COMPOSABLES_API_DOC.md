# Composables API 문서

이 문서는 ChitChat 애플리케이션의 모든 composable 함수들의 사용법을 설명합니다. 각 함수가 언제, 어디서, 어떻게 사용되는지 자세히 설명합니다.

---

## 목차

### 핵심 모듈
1. [fileConstants](#1-fileconstants) - 파일 공유 관련 상수
2. [useYjs](#2-useyjs) - P2P 실시간 동기화 (핵심)
3. [useSignalingServer](#3-usesignalingserver) - AWS WebSocket 시그널링
4. [useInitialSync](#4-useinitialsync) - 신규 접속자 초기 동기화

### 파일 인코딩 & 캐시
5. [useFileEncoder](#5-usefileencoder) - 파일 인코딩/디코딩
6. [useStorageFileCache](#6-usestoragefilecache) - IndexedDB 파일 캐시

### 파일 전송 시스템
7. [useFileTransferState](#7-usefiletransferstate) - 부분 다운로드 상태 관리
8. [useFileTransferProgress](#8-usefiletransferprogress) - 전송 진행률 UI
9. [useGlobalDataChannelQueue](#9-useglobaldatachannelqueue) - 글로벌 전송 큐
10. [useWebrtcConnection](#10-usewebrtcconnection) - WebRTC 연결 관리
11. [useDirectFileTransfer](#11-usedirectfiletransfer) - P2P 직접 파일 전송
12. [useFileTransfer](#12-usefiletransfer) - 파일 전송 오케스트레이터
13. [useFileActions](#13-usefileactions) - 파일 다운로드 액션

### 이미지 & 프로필
14. [useImageAutoLoader](#14-useimageautoloader) - 이미지 자동 로드
15. [useProfilePicture](#15-useprofilepicture) - 프로필 사진 처리
16. [useStorageProfilePicture](#16-usestorageprofilepicture) - 프로필 사진 저장소

### 알림 시스템
17. [useNotification](#17-usenotification) - 플랫폼별 알림
18. [useNotificationSound](#18-usenotificationsound) - 알림 소리 관리

### UI & 설정
19. [useStorageChatroomSettings](#19-usestoragechatroomsettings) - 채팅방 설정 저장
20. [useConnectedUsers](#20-useconnectedusers) - 접속자 목록 추적
21. [useCustomDialog](#21-usecustomdialog) - 커스텀 다이얼로그
22. [useBackgroundImage](#22-usebackgroundimage) - 배경 이미지 관리
23. [useStyleSettings](#23-usestylesettings) - 스타일/색상 설정
24. [colorTemplates](#24-colortemplates) - 색상 템플릿 정의

---

## 1. fileConstants

### 개요
파일 공유 및 프로필 사진 관련 **상수**를 정의합니다.

### 상수

```typescript
// 파일 크기 임계값 (256KB)
// 이 값 미만: Yjs 메타데이터에 Base64 포함 + 자동 다운로드
// 이 값 이상: 메타데이터만 저장 + P2P 직접 전송
export const FILE_DATA_THRESHOLD = 256 * 1024

// 프로필 사진 최대 크기 (300px)
export const PROFILE_PICTURE_MAX_SIZE = 300

// 프로필 사진 압축 품질 (0.0 ~ 1.0)
export const PROFILE_PICTURE_QUALITY = 0.8

// 프로필 사진 최대 파일 크기 (80KB)
export const PROFILE_PICTURE_MAX_BYTES = 80 * 1024
```

### 사용 시점
- 파일 업로드 시 전송 방식 결정
- 이미지 자동 다운로드 여부 판단
- 프로필 사진 압축 설정

---

## 2. useYjs

### 개요
**Yjs를 사용한 P2P 실시간 동기화**를 관리합니다. 채팅 메시지, 파일 메타데이터, 실시간 파일 전송을 모두 처리하는 **핵심 composable**입니다.

### 초기화

```typescript
const {
  messagesRef,        // readonly ref: 표시할 메시지 배열
  files,              // Y.Map<FileMeta>: 파일 메타데이터
  sendTextMessage,    // 텍스트 메시지 전송
  attachFileMeta,     // 파일 메타데이터 첨부
  requestFile,        // Yjs 파일 요청 (256KB 미만)
  respondFile,        // Yjs 파일 응답
  getTransferMap,     // 청크 전송용 Y.Map 생성
  loadMoreMessages,   // 이전 메시지 로드
  resetToLatest,      // 최신 메시지로 리셋
  isViewingLatest,    // 최신 표시 중인지 확인
  forceResync,        // 강제 재동기화
  exportSnapshot,     // 스냅샷 내보내기
  importSnapshot      // 스냅샷 가져오기
} = await useYjs(roomId, myUuid, nickname)
```

### 주요 동작

#### 초기화 과정
1. **IndexedDB 로드**: 로컬에 저장된 메시지/파일 메타 로드
2. **시그널링 서버 연결**: WebSocket으로 연결
3. **초기 동기화 판단**:
   - 신규 접속 (로컬 데이터 없음): 시그널링 서버로 스냅샷 요청
   - 기존 접속 (로컬 데이터 있음): Y-webrtc 증분 동기화만
4. **Y-webrtc 연결**: P2P 메시 네트워크 구성
5. **Keepalive 시작**: 30초마다 연결 유지

#### 메시지 정렬
- **하이브리드 정렬**: 물리적 시간 우선, 동일 시간대(1분 이내)면 Lamport 시계로 인과관계 보장
- **디바운싱**: 100ms 내 변경사항을 그룹화하여 한 번에 정렬 (성능 최적화)

### 함수

#### `sendTextMessage(authorTrueUuid, authorName, text)`
```typescript
sendTextMessage('user-123', 'Alice', '안녕하세요!')
```

#### `attachFileMeta(fileId, meta, authorTrueUuid, authorName?)`
```typescript
const { fileId, meta } = await prepareFile(file)
attachFileMeta(fileId, meta, 'user-123', 'Alice')
```

#### `requestFile(fileId, requesterUuid, receivedChunks?, targetUuid?)`
- 256KB 미만 파일용 (Yjs Y.Map 청크 전송)
```typescript
requestFile('file-123', myUuid)                          // 전체 요청
requestFile('file-123', myUuid, [0, 1, 2], 'sender-uuid') // 이어받기
```

#### `loadMoreMessages(): boolean`
```typescript
const hasMore = loadMoreMessages() // 30개 더 로드
```

#### `forceResync(): Promise<boolean>`
- 로컬 데이터를 모두 지우고 재동기화 (주의!)

### 사용 예시

```typescript
// 채팅방 입장
const yjs = await useYjs(roomId, myUuid, nickname)

// 메시지 전송
yjs.sendTextMessage(myUuid, nickname, '안녕하세요!')

// 파일 업로드
const { fileId, meta } = await prepareFile(file)
yjs.attachFileMeta(fileId, meta, myUuid, nickname)

// 메시지 표시
<MessageList :messages="yjs.messagesRef" />
```

---

## 3. useSignalingServer

### 개요
**AWS API Gateway WebSocket 기반 시그널링 서버** 연결을 관리합니다. topic 기반 pub/sub 메시지 전송으로 y-webrtc를 우회한 초기 동기화를 지원합니다.

### 초기화

```typescript
const signaling = useSignalingServer(SIGNALING_SERVER_URL)
```

### 함수

#### `connect(): Promise<void>`
```typescript
await signaling.connect()
```

#### `subscribe(topics: string[])`
```typescript
signaling.subscribe(['room-123-sync'])
```

#### `unsubscribe(topics: string[])`
```typescript
signaling.unsubscribe(['room-123-sync'])
```

#### `publish(topic, data): boolean`
```typescript
signaling.publish('room-123-sync', {
  messageType: 'sync-request',
  requesterUuid: myUuid,
  timestamp: Date.now()
})
```

#### `on(topic, handler)` / `off(topic, handler)`
```typescript
signaling.on('room-123-sync', (message) => {
  console.log('메시지 수신:', message)
})
```

#### `disconnect()`
```typescript
signaling.disconnect()
```

### 자동 재연결
- 연결 끊김 시 2초 후 자동 재연결

---

## 4. useInitialSync

### 개요
**신규 접속자 초기 동기화**를 담당합니다. 시그널링 서버를 통해 WebRTC 연결을 수립하고, DataChannel로 Yjs 스냅샷을 직접 전송합니다.

### 초기화

```typescript
const { requestInitialSync, initializeAsProvider } = useInitialSync(
  signaling,  // useSignalingServer 인스턴스
  myUuid,
  doc,        // Y.Doc
  roomId
)
```

### 함수

#### `initializeAsProvider()`
- 기존 사용자가 신규 접속자의 요청에 응답하도록 리스너 등록
- **항상 호출 필수!**
```typescript
initializeAsProvider()
```

#### `requestInitialSync(): Promise<Uint8Array | null>`
- 신규 접속자가 초기 스냅샷 요청
```typescript
const snapshot = await requestInitialSync()
if (snapshot) {
  Y.applyUpdate(doc, snapshot)
}
```

### 동작 과정

1. **신규 접속자**: `sync-request` 메시지 발행
2. **기존 사용자**: Yjs 스냅샷 생성 후 WebRTC Offer 전송
3. **신규 접속자**: Answer 응답 후 DataChannel 수립
4. **기존 사용자**: 64KB 청크로 스냅샷 전송 (ACK 기반 흐름 제어)
5. **신규 접속자**: 스냅샷 수신 후 Yjs에 적용

### 플로우 컨트롤
- **청크 크기**: 64KB
- **ACK 윈도우**: 20개 청크마다 ACK
- **버퍼 관리**: 12MB high-water mark, 2MB low-water mark

---

## 5. useFileEncoder

### 개요
**파일 데이터 인코딩/디코딩** 처리. File 객체를 Base64로 인코딩하거나 복원합니다.

### 함수

#### `prepareFile(file: File): Promise<{ fileId, meta }>`
```typescript
const { prepareFile } = useFileEncoder()
const { fileId, meta } = await prepareFile(selectedFile)
// meta: { name, size, type, fileData?: string (256KB 이하만) }
```

#### `getFileBlob(fileId, meta): Promise<Blob>`
```typescript
const blob = await getFileBlob(fileId, meta)
imgElement.src = URL.createObjectURL(blob)
```

#### `arrayBufferToBase64(buffer): string`
#### `base64ToArrayBuffer(base64): ArrayBuffer`

---

## 6. useStorageFileCache

### 개요
**IndexedDB를 사용한 파일 캐시**. 다운로드한 파일을 로컬에 저장하여 재다운로드를 방지합니다.

### 함수

```typescript
// 캐시 저장
await cacheFile('file-123', blob)

// 캐시 조회
const cached = await getCachedFile('file-123') // Blob | null

// 캐시 존재 확인
const exists = await hasCachedFile('file-123') // boolean
```

---

## 7. useFileTransferState

### 개요
**이어받기(Resume) 기능**을 위한 다운로드 상태 관리. IndexedDB에 진행 상황을 저장하여 연결 끊김 후에도 재개할 수 있습니다.

### 주요 함수

```typescript
const {
  saveDownloadState,    // 상태 저장
  saveChunk,            // 개별 청크 저장
  saveChunksBatch,      // 청크 배치 저장
  loadDownloadState,    // 상태 불러오기
  deleteDownloadState,  // 상태 삭제
  getAllDownloadStates, // 모든 상태 조회
  cleanupOldStates,     // 24시간 지난 상태 정리
  hasChunk,             // 청크 존재 확인
  addChunk,             // 청크 추가
  isComplete,           // 완료 확인
  mergeChunks,          // 청크 병합
  getProgress           // 진행률 (0-100%)
} = useFileTransferState()
```

### 사용 예시

```typescript
// 이어받기 확인
const partialState = await loadDownloadState(fileId)
if (partialState) {
  console.log(`이어받기: ${partialState.receivedChunks.size}/${partialState.totalChunks}`)
}

// 완료 후 정리
if (isComplete(state)) {
  const buffer = mergeChunks(state)
  await deleteDownloadState(fileId)
}
```

---

## 8. useFileTransferProgress

### 개요
**파일 전송 진행률 UI** 상태 관리. 업로드/다운로드 상태를 실시간 추적합니다.

### 반환값

```typescript
const {
  transfers,        // reactive Record<fileId, Progress>
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
} = useFileTransferProgress()
```

### 사용 예시

```vue
<template>
  <div v-for="[id, p] in Object.entries(transfers)" :key="id">
    <span>{{ p.fileName }}</span>
    <progress :value="getProgressPercent(id)" max="100" />
    <button @click="cancelTransfer(id)">취소</button>
  </div>
</template>
```

---

## 9. useGlobalDataChannelQueue

### 개요
**모든 데이터 전송을 우선순위 큐로 관리**하는 싱글톤 매니저. 동시 전송 수 제한, 중요 파일 우선 전송을 스케줄링합니다.

### 우선순위

```typescript
enum DataChannelPriority {
  CRITICAL = 0,  // 프로필 사진 (즉시)
  HIGH = 1,      // 이미지, 100KB 미만
  NORMAL = 2,    // 일반 파일
  LOW = 3        // 10MB 초과
}
```

### 주요 함수

```typescript
const {
  enqueue,              // 작업 추가
  cancelJob,            // 작업 취소
  setProvider,          // WebrtcProvider 등록
  registerDataChannel,  // 데이터 채널 등록
  unregisterDataChannel,
  stats,                // reactive 통계
  queueState            // reactive 큐 상태
} = useGlobalDataChannelQueue()
```

### 헬퍼 함수

```typescript
// 파일 전송 작업 생성
const job = createFileTransferJob(fileId, fileName, targetPeerId, size, priority, executeFn)
enqueue(job)

// 이미지 전송 작업 생성
const job = createImageTransferJob(imageId, targetPeerId, size, priority, executeFn)

// 프로필 사진 전송 작업 생성 (최우선, 취소 불가)
const job = createProfilePictureJob(userId, targetPeerId, size, executeFn)
```

### 통계 정보

```typescript
stats = {
  totalJobs: 10,
  activeJobs: 2,
  queuedJobs: 5,
  completedJobs: 3,
  failedJobs: 0,
  cancelledJobs: 0,
  totalBytesSent: 5242880,
  totalBytesQueued: 10485760,
  averageSpeed: 1048576  // bytes/sec
}
```

---

## 10. useWebrtcConnection

### 개요
**WebRTC PeerConnection 및 DataChannel 관리**. Offer/Answer 교환, ICE 후보 수집, 연결 생명주기를 담당합니다.

### 초기화

```typescript
const {
  createOffer,     // Offer 생성 (발신자)
  createAnswer,    // Answer 생성 (수신자)
  cleanup,         // 연결 정리
  cancelTransfer,  // 전송 취소
  activeChannels   // 활성 채널 Map
} = useWebrtcConnection(provider, myUuid)
```

### 주요 함수

```typescript
// 발신자: Offer 생성
const channel = await createOffer(fileId, targetUuid, totalChunks, fileSize)
channel.send(data)

// 수신자: Answer 응답
const channel = await createAnswer(offer)
channel.onmessage = (e) => { /* 데이터 수신 */ }
```

---

## 11. useDirectFileTransfer

### 개요
**대용량 파일(256KB 이상) WebRTC DataChannel P2P 직접 전송**. 청크 단위 전송, 이어받기, 버퍼 관리를 자동 처리합니다.

### 설정값
- **청크 크기**: 64KB
- **최대 버퍼**: 12MB (high-water mark)
- **ACK 윈도우**: 20개 청크마다
- **DB 저장 간격**: 50개 청크마다 배치 저장

### 주요 함수

```typescript
const { sendFileViaQueue, receiveFileDirect } = useDirectFileTransfer(provider, myUuid, filesMap)

// 전송 (글로벌 큐 경유)
await sendFileViaQueue(fileId, targetUuid)

// 수신
const blob = await receiveFileDirect(offer)
```

---

## 12. useFileTransfer

### 개요
**파일 전송 최상위 오케스트레이터**. 파일 크기에 따라 전송 방식 자동 선택, 업로드 큐 관리, 이어받기 지원.

**가장 중요한 composable** - 대부분의 경우 이것만 사용하면 됩니다.

### 초기화

```typescript
const {
  setupFileRequestListener,  // 필수! 앱 시작 시 호출
  requestFileP2P,            // 파일 다운로드
  registerFileAvailability,  // 파일 소유권 브로드캐스트
  queueStats,
  queueState,
  cancelJob
} = useFileTransfer(provider, files, myUuid, requestFile, respondFile, getTransferMap)
```

### 파일 전송 방식 (자동 선택)

| 크기 | 방식 | 장점 |
|------|------|------|
| 256KB 미만 | Yjs Y.Map 청크 | 자동 동기화, 여러 피어 |
| 256KB 이상 | WebRTC DataChannel | 빠르고 효율적, 이어받기 |

### 사용 예시

```typescript
// 초기화 (필수!)
fileTransfer.setupFileRequestListener()

// 파일 업로드
yjs.attachFileMeta(fileId, meta, myUuid, nickname)
await fileTransfer.registerFileAvailability(fileId)

// 파일 다운로드
const blob = await fileTransfer.requestFileP2P(fileId)
```

---

## 13. useFileActions

### 개요
**파일 다운로드 및 저장 액션**. 브라우저 파일 저장 대화상자를 띄웁니다.

### 함수

```typescript
const { downloadFile, triggerDownload } = useFileActions(files, requestFileP2P)

// 전체 다운로드 (캐시 확인 + P2P + 저장)
await downloadFile(fileId)

// Blob만 저장
triggerDownload(blob, 'document.pdf')
```

---

## 14. useImageAutoLoader

### 개요
**이미지 자동 로드 및 표시 관리**. 작은 이미지(256KB 이하)를 자동 다운로드하고 URL을 생성합니다.

### 반환값

```typescript
const {
  imageUrls,        // Map<fileId, Object URL>
  loadingImages,    // Set<fileId>
  failedDownloads,  // Map<fileId, errorMessage>
  isImage,          // (fileId) => boolean
  shouldAutoDownload, // (fileId) => boolean
  downloadImage,    // (fileId, force?) => Promise
  processAutoDownload // (messages) => Promise
} = useImageAutoLoader(files, requestFileP2P)
```

### 사용 예시

```vue
<template>
  <div v-for="msg in messages" :key="msg.id">
    <img v-if="imageUrls.get(msg.fileId)" 
         :src="imageUrls.get(msg.fileId)" />
    <div v-else-if="loadingImages.has(msg.fileId)">로딩...</div>
    <button v-else-if="failedDownloads.has(msg.fileId)"
            @click="downloadImage(msg.fileId, true)">재시도</button>
  </div>
</template>

<script setup>
// 자동 다운로드
watch(() => messages.value, (msgs) => {
  processAutoDownload(msgs)
}, { immediate: true })
</script>
```

---

## 15. useProfilePicture

### 개요
**프로필 사진 처리 및 전송 관리**. 이미지 리사이징, 압축, 글로벌 큐 전송, awareness 동기화를 처리합니다.

### 초기화

```typescript
const {
  myProfilePicture,         // ref: 내 프로필 (data URL)
  profilePictures,          // reactive Map: 모든 사용자 프로필
  getUserProfilePicture,    // computed: 특정 사용자 프로필
  setMyProfilePicture,      // 내 프로필 설정
  deleteMyProfilePicture,   // 내 프로필 삭제
  sendProfilePicture,       // 특정 피어에게 전송
  handlePeerConnected,      // 피어 연결 시 교환
  initializeProfilePictures, // 필수! 초기화
  getProfileOriginalFileId  // 원본 파일 ID
} = useProfilePicture(provider, myUuid, files, registerFileAvailability)
```

### 이미지 처리
- **최대 크기**: 300px x 300px (비율 유지)
- **포맷**: JPEG
- **최대 파일**: 80KB (품질 자동 조정)

### 사용 예시

```typescript
// 초기화 (필수!)
await initializeProfilePictures()

// 프로필 설정
await setMyProfilePicture(file)

// 프로필 표시
<img v-if="getUserProfilePicture(userId)" :src="getUserProfilePicture(userId)" />
```

---

## 16. useStorageProfilePicture

### 개요
**IndexedDB 프로필 사진 로컬 저장**. Base64 형태로 저장하여 빠른 로드를 지원합니다.

### 함수

```typescript
// 저장
await saveProfilePicture({ userId, imageData, timestamp, size, originalFileId? })

// 조회
const profile = await getProfilePicture(userId)

// 존재 확인
const exists = await hasProfilePicture(userId)

// 삭제
await deleteProfilePicture(userId)

// 전체 조회
const all = await getAllProfilePictures()
```

---

## 17. useNotification

### 개요
**플랫폼별 알림 표시**. Electron은 커스텀 알림창, 웹은 브라우저 알림을 사용합니다.

### 함수

```typescript
const { showNotification } = useNotification()

showNotification(authorName, text, messageId, roomId)
// Electron: window.electronApi.createNotification
// Web: console.log (또는 Notification API)
```

---

## 18. useNotificationSound

### 개요
**알림 소리 관리**. 새 메시지 수신 시 알림 소리 재생, 음량 조절, 커스텀 소리 파일 설정을 지원합니다.

### 반환값

```typescript
const {
  volume,            // ref: 음량 (0.0~1.0)
  customSoundUrl,    // ref: 커스텀 소리 URL
  isEnabled,         // ref: 활성화 여부
  isElectron,        // computed: Electron 환경 여부
  loadSettings,      // 설정 로드
  setVolume,         // 음량 설정
  setEnabled,        // 활성화 설정
  setCustomSound,    // 커스텀 소리 설정 (Electron만)
  removeCustomSound, // 커스텀 소리 삭제
  playSound,         // 소리 재생
  previewSound       // 미리 듣기
} = useNotificationSound()
```

### 저장 위치
- **Electron**: 파일 시스템 (userData)
- **Web**: localStorage

---

## 19. useStorageChatroomSettings

### 개요
**IndexedDB 채팅방 설정 저장/관리**. 채팅방별로 사용자 설정을 저장합니다.

### 함수

```typescript
// 저장
await saveChatroomOption(roomId, { theme, fontSize, showTimestamps, ... })

// 조회
const option = await getChatroomOption(roomId)

// JSON 내보내기/가져오기
const json = await exportOptionAsJSON()
await importOptionFromJSON(jsonString)
```

---

## 20. useConnectedUsers

### 개요
**채팅방 접속자 목록 추적**. awareness 상태를 모니터링하여 실시간으로 접속자 정보를 업데이트합니다.

### 반환값

```typescript
const {
  connectedUsers,      // ref: ConnectedUser[]
  userCount,           // ref: number
  updateConnectedUsers // 수동 업데이트
} = useConnectedUsers(provider, currentUserUuid)

// ConnectedUser = { clientId, userUuid, nickname }
```

### 자동 처리
- `awareness.on('change')` 자동 감지
- `provider.on('peers')` 자동 감지

---

## 21. useCustomDialog

### 개요
**커스텀 다이얼로그 관리**. Electron은 별도 창, 웹은 네이티브 alert/confirm을 사용합니다.

### 함수

```typescript
// 인라인 다이얼로그 (웹 환경용)
const { isOpen, dialogMessage, dialogType, showDialog, confirm, cancel } = useCustomDialog()

// 플랫폼별 alert
await showAlert('메시지')

// 플랫폼별 confirm
const result = await showConfirm('확인하시겠습니까?')
```

---

## 22. useBackgroundImage

### 개요
**배경 이미지 관리**. Electron 환경에서 로컬 파일 시스템에 배경 이미지 저장/로드를 지원합니다.

### 배경 타입

```typescript
type BackgroundType = 'home' | 'chat' | 'notification'
```

### 반환값

```typescript
const {
  backgroundImages,     // ref: Record<BackgroundType, string | null>
  isLoading,           // ref: boolean
  isElectron,          // computed: boolean
  loadBackgroundImage, // 개별 로드
  loadAllBackgrounds,  // 전체 로드
  setBackgroundImage,  // 설정
  removeBackgroundImage, // 삭제
  selectAndSetBackground // 파일 선택 및 설정
} = useBackgroundImage(type?)
```

### BroadcastChannel
- 창 간 실시간 동기화 지원

---

## 23. useStyleSettings

### 개요
**스타일 설정 관리**. IndexedDB에 컨테이너 투명도, 배경 오버레이, 블러 효과, 색상 설정을 저장합니다.

### 설정 구조

```typescript
interface StyleSettings {
  containerOpacity: { home: number; chat: number }
  backgroundOverlay: { home: number; chat: number; notification: number }
  backgroundBlur: { home: number; chat: number }
  colors: ColorSettings
}
```

### 반환값

```typescript
const {
  settings,           // ref: StyleSettings
  isLoaded,          // ref: boolean
  loadSettings,      // 설정 로드
  saveSettings,      // 설정 저장
  resetSettings,     // 기본값으로 리셋
  updateContainerOpacity,
  updateBackgroundOverlay,
  updateBackgroundBlur,
  updateColors,
  applyColorTemplate  // 색상 템플릿 적용
} = useStyleSettings()
```

### CSS 변수 자동 적용
- `--container-opacity-home`
- `--background-overlay-home`
- `--gradient-start`, `--gradient-mid`, `--gradient-end`
- `--color-primary`, `--color-secondary`, etc.

---

## 24. colorTemplates

### 개요
**색상 템플릿 정의**. 16개의 창의적인 색상 테마를 제공합니다.

### 템플릿 목록

| ID | 이름 | 설명 |
|----|------|------|
| milkyway | 🌌 Milkyway | 부드러운 파스텔 보라-핑크 (기본) |
| galaxy | 🌙 Galaxy | 어두운 파스텔톤 나이트 모드 |
| sakura | 🌸 Sakura | 벚꽃이 흩날리는 봄날 |
| mint | 🌿 Mint Fresh | 상쾌한 민트 그린 |
| ocean | 🌊 Ocean Blue | 깊은 바다색 |
| ... | ... | ... |

### 사용 예시

```typescript
import { COLOR_TEMPLATES, DEFAULT_COLORS } from './colorTemplates'

// 템플릿 적용
const template = COLOR_TEMPLATES.find(t => t.id === 'sakura')
if (template) {
  applyColorTemplate(template)
}
```

---

## 전체 사용 흐름

### 채팅방 입장

```typescript
// 1. Yjs 초기화
const yjs = await useYjs(roomId, myUuid, nickname)

// 2. 파일 전송 초기화
const fileTransfer = useFileTransfer(yjs.provider, yjs.files, myUuid, ...)
fileTransfer.setupFileRequestListener() // 필수!

// 3. 이미지 로더 초기화
const imageLoader = useImageAutoLoader(yjs.files, fileTransfer.requestFileP2P)

// 4. 프로필 초기화
const profile = useProfilePicture(yjs.provider, myUuid, yjs.files, ...)
await profile.initializeProfilePictures() // 필수!

// 5. 알림 초기화
const notification = useNotification()
const notificationSound = useNotificationSound()
```

### 파일 업로드

```typescript
const { fileId, meta } = await prepareFile(file)
yjs.attachFileMeta(fileId, meta, myUuid, nickname)
await fileTransfer.registerFileAvailability(fileId)
```

### 파일 다운로드

```typescript
const blob = await fileTransfer.requestFileP2P(fileId)
triggerDownload(blob, meta.name)
```

---

## 디버깅 팁

### 콘솔 로그 접두사
- `[Queue]`: 큐 매니저
- `[WebRTC]`: WebRTC 연결
- `[P2P]`: 직접 전송
- `[InitialSync]`: 초기 동기화
- `[Signaling]`: 시그널링 서버
- `[#숫자]`: 전송 단계별 로그

### 상태 확인

```typescript
// 전송 진행
console.log(useFileTransferProgress().transfers)

// 큐 상태
console.log(useGlobalDataChannelQueue().queueStats)

// 이어받기 상태
console.log(await useFileTransferState().getAllDownloadStates())
```

---

## FAQ

**Q: 파일 전송이 안 됩니다.**
1. `setupFileRequestListener()` 호출 확인
2. 캐시 확인: `await getCachedFile(fileId)`
3. WebRTC 연결 로그 확인

**Q: 이미지가 자동 로드되지 않습니다.**
- 256KB 이상은 수동 다운로드 필요
- `shouldAutoDownload(fileId)`로 확인

**Q: 이어받기가 안 됩니다.**
- `loadDownloadState(fileId)`로 상태 확인
- 발신자 연결 상태 확인

**Q: 초기 동기화가 느립니다.**
- 스냅샷 크기 확인 (많은 메시지/파일)
- 네트워크 상태 확인
- `sync-request` 로그 확인

---

## 요약

### 필수 Composable
1. **useYjs**: 채팅 메시지 + 파일 메타 동기화
2. **useFileTransfer**: 파일 전송 오케스트레이터 (가장 중요!)
3. **useProfilePicture**: 프로필 사진 관리

### 보조 Composable (자동 처리됨)
- useSignalingServer, useInitialSync
- useFileEncoder, useStorageFileCache
- useFileTransferState, useFileTransferProgress
- useGlobalDataChannelQueue, useWebrtcConnection
- useDirectFileTransfer

### 선택적 Composable
- useImageAutoLoader (권장)
- useNotification, useNotificationSound
- useStorageChatroomSettings
- useConnectedUsers
- useCustomDialog
- useBackgroundImage, useStyleSettings, colorTemplates

### 기본 패턴

```typescript
// 초기화
const yjs = await useYjs(roomId, myUuid, nickname)
const fileTransfer = useFileTransfer(...)
fileTransfer.setupFileRequestListener() // 필수!

// 메시지 전송
yjs.sendTextMessage(myUuid, nickname, text)

// 파일 업로드
yjs.attachFileMeta(fileId, meta, myUuid, nickname)
await fileTransfer.registerFileAvailability(fileId)

// 파일 다운로드
const blob = await fileTransfer.requestFileP2P(fileId)
```
