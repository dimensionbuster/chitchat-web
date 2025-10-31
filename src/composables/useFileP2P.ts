import { ref } from 'vue'
import type { WebrtcProvider } from 'y-webrtc'
import type { Map as YMap } from 'yjs'
import type { FileMeta } from '@/types/types'
import { getCachedFile, cacheFile } from './useLocalFileCache'
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/util/base64'
import { useFileTransferProgress } from './useFileTransferProgress'

/**
 * P2P 파일 요청/응답 시스템
 * y-webrtc의 awareness를 사용하여 파일을 P2P로 전송
 */
export function useFileP2P(
  provider: WebrtcProvider,
  files: YMap<FileMeta>,
  myUuid: string,
  requestFile: (fileId: string, requesterUuid: string) => void,
  respondFile: (fileId: string, fileData: string, targetUuid: string) => void,
  getTransferMap: (key: string) => YMap<string>, // 전송용 맵 생성 함수
) {
  // 처리한 파일 요청 추적 (중복 응답 방지)
  const processedRequests = ref(new Set<string>())

  // 진척도 추적
  const { startTransfer, updateProgress, completeTransfer, failTransfer } =
    useFileTransferProgress()

  /**
   * 파일 요청 리스너 설정
   * 다른 피어가 파일을 요청하면 응답
   */
  function setupFileRequestListener() {
    console.log(`[P2P] 파일 요청 리스너 설정됨, myUuid: ${myUuid}`)

    provider.awareness.on('change', async () => {
      const states = provider.awareness.getStates()
      console.log(`[P2P-Request] awareness 변경, states 수: ${states.size}`)

      for (const [clientId, state] of states) {
        const request = state.fileRequest as
          | { fileId: string; requesterUuid: string; timestamp: number }
          | undefined

        if (request) {
          console.log(`[P2P-Request] fileRequest 발견 from ${clientId}:`, {
            fileId: request.fileId,
            requesterUuid: request.requesterUuid,
            timestamp: request.timestamp,
            isMyRequest: request.requesterUuid === myUuid,
          })
        }

        if (!request || request.requesterUuid === myUuid) {
          continue
        }

        const { fileId, requesterUuid, timestamp } = request

        // 요청 고유 ID 생성 (중복 처리 방지)
        const requestId = `${fileId}-${requesterUuid}-${timestamp}`

        // 이미 처리한 요청이면 스킵
        if (processedRequests.value.has(requestId)) {
          console.log(`[P2P-Request] 이미 처리한 요청, 스킵: ${requestId}`)
          continue
        }

        console.log(
          `[P2P] 파일 요청 받음: ${fileId} from ${requesterUuid} (requestId: ${requestId})`,
        )

        // 요청 처리 기록
        processedRequests.value.add(requestId)

        // 5초 후 기록 제거 (메모리 관리)
        setTimeout(() => {
          processedRequests.value.delete(requestId)
        }, 5000)

        // 파일 응답 처리
        await handleFileRequest(fileId, requesterUuid)
      }
    })
  }

  /**
   * 파일 요청 처리 - 로컬 캐시에서 찾아서 응답
   */
  async function handleFileRequest(fileId: string, requesterUuid: string) {
    const cachedBlob = await getCachedFile(fileId)

    if (cachedBlob) {
      console.log(`[P2P] 캐시에서 파일 찾음, 응답 전송: ${fileId}`)

      // Blob을 base64로 변환
      const arrayBuffer = await cachedBlob.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)

      // 응답 전송
      respondFile(fileId, base64, requesterUuid)
    } else {
      console.warn(`[P2P] 파일을 찾을 수 없음: ${fileId}`)
    }
  }

  /**
   * 파일 응답 대기
   * 다른 피어로부터 파일 데이터를 받을 때까지 대기
   */
  function waitForFileResponse(fileId: string, timeout: number) {
    return new Promise<Blob>((resolve, reject) => {
      let resolved = false // 중복 resolve 방지
      let checkCount = 0

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          console.error(`[P2P] 파일 응답 타임아웃: ${fileId} (${checkCount}번 체크됨)`)
          reject(new Error('파일 다운로드 타임아웃'))
        }
      }, timeout)

      const handler = () => {
        if (resolved) return // 이미 처리됨

        checkCount++
        console.log(`[P2P] awareness 변경 감지 (#${checkCount}), 응답 확인 중...`)

        const states = provider.awareness.getStates()
        console.log(
          `[P2P] 현재 awareness states 수: ${states.size}, myClientId: ${provider.awareness.clientID}`,
        )

        // 모든 클라이언트의 state 출력
        const allClientIds: number[] = []
        states.forEach((state, clientId) => {
          allClientIds.push(clientId)
          const hasResponse = !!state.fileResponse
          const hasRequest = !!state.fileRequest
          console.log(
            `[P2P] Client ${clientId}: fileResponse=${hasResponse}, fileRequest=${hasRequest}`,
          )
        })

        for (const [clientId, state] of states) {
          const response = state.fileResponse as
            | {
                fileId: string
                targetUuid: string
                timestamp: number
                totalChunks: number
                chunkSize: number
              }
            | undefined

          if (response) {
            console.log(`[P2P] fileResponse 발견 from ${clientId}:`, {
              fileId: response.fileId,
              targetUuid: response.targetUuid,
              myUuid,
              match: response.fileId === fileId && response.targetUuid === myUuid,
              totalChunks: response.totalChunks,
              timestamp: response.timestamp,
            })
          }

          if (response && response.fileId === fileId && response.targetUuid === myUuid) {
            if (resolved) return // 중복 체크

            console.log(
              `[P2P] ✅ 파일 응답 메타데이터 받음: ${fileId} from client ${clientId}, 청크 수: ${response.totalChunks}`,
            )
            resolved = true
            cleanup()

            // 청크 데이터를 Yjs Map에서 수집
            const transferMap = getTransferMap(`transfer-${fileId}-${response.timestamp}`)

            // 진척도 추적 시작
            const meta = files.get(fileId)
            const totalBytes = meta?.size || response.totalChunks * response.chunkSize
            startTransfer(
              fileId,
              meta?.name || fileId,
              'download',
              response.totalChunks,
              totalBytes,
            )

            // 청크가 모두 도착할 때까지 대기 (이벤트 기반)
            const waitForChunks = () => {
              return new Promise<string>((resolveChunks, rejectChunks) => {
                const chunkTimer = setTimeout(() => {
                  console.error(
                    `[P2P] ❌ 청크 수신 타임아웃: ${receivedChunks}/${response.totalChunks} 수신됨`,
                  )
                  rejectChunks(new Error('청크 수신 타임아웃'))
                }, 60000) // 60초 - 큰 파일을 위한 충분한 시간

                let receivedChunks = 0
                // 청크를 순서대로 저장할 배열 (메모리 미리 할당으로 효율성 향상)
                const chunks: string[] = new Array(response.totalChunks)

                const checkComplete = () => {
                  // complete 플래그 확인 (송신자가 모든 청크를 보냈다는 신호)
                  const isComplete = transferMap.get('complete')

                  if (isComplete) {
                    // 모든 청크가 수신되었는지 확인
                    for (let i = 0; i < response.totalChunks; i++) {
                      if (!chunks[i]) {
                        const chunk = transferMap.get(`chunk-${i}`) as string
                        if (chunk) {
                          chunks[i] = chunk
                          receivedChunks++
                          // 너무 많은 로그 방지: 10개마다 출력
                          if (receivedChunks % 10 === 0) {
                            console.log(
                              `[P2P] 청크 ${receivedChunks}/${response.totalChunks} 수신 완료`,
                            )
                          }
                        }
                      }
                    }

                    // 모든 청크가 있는지 확인
                    if (receivedChunks === response.totalChunks) {
                      clearTimeout(chunkTimer)

                      // 모든 청크를 하나의 문자열로 결합
                      // join()은 O(n) 한 번만 실행 (효율적)
                      const fullData = chunks.join('')

                      console.log(
                        `[P2P] ✅ 모든 청크 수신 완료: ${response.totalChunks}개, ` +
                          `총 ${(fullData.length / 1024 / 1024).toFixed(2)}MB`,
                      )

                      // 진척도 완료 표시
                      completeTransfer(fileId)

                      resolveChunks(fullData)
                    }
                  }
                }

                // Yjs Map 변경 감지 - 이벤트 기반 (폴링 제거로 CPU 절약)
                // 문제였던 부분: setInterval과 observe를 동시 사용 → 경쟁 상태
                // 해결: observe만 사용 → 청크가 도착할 때만 실행
                const observer = () => {
                  // 새로 도착한 청크만 수집 (이미 받은 것은 스킵)
                  for (let i = 0; i < response.totalChunks; i++) {
                    if (!chunks[i]) {
                      const chunk = transferMap.get(`chunk-${i}`) as string
                      if (chunk) {
                        chunks[i] = chunk
                        receivedChunks++

                        // 진척도 업데이트
                        updateProgress(fileId, receivedChunks)

                        // 진행률 로그 (10개마다)
                        if (receivedChunks % 10 === 0 || receivedChunks === response.totalChunks) {
                          const progress = ((receivedChunks / response.totalChunks) * 100).toFixed(
                            1,
                          )
                          console.log(
                            `[P2P] 청크 수신 중... ${progress}% (${receivedChunks}/${response.totalChunks})`,
                          )
                        }
                      }
                    }
                  }

                  // 완료 여부 확인
                  checkComplete()
                }

                // Yjs observer 등록 (청크가 추가될 때마다 자동 호출)
                transferMap.observe(observer)

                // 초기 체크 (이미 도착한 청크가 있을 수 있음)
                checkComplete()
              })
            }

            waitForChunks()
              .then((fullData) => {
                // base64 데이터를 Blob으로 변환
                const meta = files.get(fileId)
                const arrayBuffer = base64ToArrayBuffer(fullData)
                const blob = new Blob([arrayBuffer], {
                  type: meta?.type || 'application/octet-stream',
                })

                // 캐시에 저장
                cacheFile(fileId, blob).catch(console.error)

                resolve(blob)
              })
              .catch((error) => {
                console.error(`[P2P] 청크 수신 실패:`, error)

                // 진척도 실패 표시
                failTransfer(fileId)

                reject(error)
              })

            return // 즉시 종료
          }
        }

        console.log(`[P2P] fileResponse를 찾지 못함. 대기 중... (체크 #${checkCount})`)
      }

      const cleanup = () => {
        clearTimeout(timer)
        provider.awareness.off('change', handler)
      }

      // 리스너 등록
      provider.awareness.on('change', handler)

      // 초기 한 번 체크 (이미 응답이 있을 수 있음)
      console.log(`[P2P] 파일 응답 대기 시작: ${fileId}, myUuid: ${myUuid}`)
      handler()
    })
  }

  /**
   * P2P로 파일 요청 및 다운로드
   */
  async function requestFileP2P(fileId: string): Promise<Blob> {
    console.log(`[P2P] 큰 파일 요청: ${fileId}`)

    // 파일 요청
    requestFile(fileId, myUuid)

    // 응답 대기 (타임아웃 30초)
    const blob = await waitForFileResponse(fileId, 30000)

    console.log('[P2P] 큰 파일 다운로드 완료:', fileId)
    return blob
  }

  return {
    setupFileRequestListener,
    requestFileP2P,
  }
}
