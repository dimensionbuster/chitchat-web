import { ref } from 'vue'

// Yjs에 저장할 최소 데이터 (동기화용)
export interface QueueItem {
  videoId: string
  addedBy: string // 추가한 사용자 ID
  addedAt: number // 추가 시간 (timestamp)
}

// UI 표시용 데이터 (클라이언트에서 fetch)
export interface VideoMetadata {
  videoId: string
  title: string
  thumbnailUrl: string
  channelTitle: string
  duration?: string
}

export interface PlaylistApiResponse {
  kind: string
  etag: string
  nextPageToken?: string
  items: Array<{
    snippet: {
      title: string
      thumbnails: {
        default: { url: string; width: number; height: number }
        medium: { url: string; width: number; height: number }
        high: { url: string; width: number; height: number }
        standard?: { url: string; width: number; height: number }
        maxres?: { url: string; width: number; height: number }
      }
      channelTitle: string
      resourceId: {
        kind: string
        videoId: string
      }
    }
  }>
}

/**
 * YouTube 동영상 URL에서 동영상 ID 추출
 */
export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) return match[1]
  }

  return null
}

/**
 * YouTube 재생목록 URL에서 재생목록 ID 추출
 */
export function extractPlaylistId(url: string): string | null {
  const patterns = [
    /[?&]list=([a-zA-Z0-9_-]+)/,
    /youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) return match[1]
  }

  return null
}

/**
 * YouTube Data API를 사용하여 재생목록의 모든 영상 ID 가져오기
 */
export async function fetchPlaylistVideoIds(
  playlistId: string,
  apiKey: string
): Promise<string[]> {
  const videoIds: string[] = []
  let pageToken: string | undefined = undefined
  const maxResults = 50

  try {
    // 모든 페이지를 순회하며 영상 ID 수집
    do {
      const params = new URLSearchParams({
        part: 'snippet',
        playlistId,
        maxResults: maxResults.toString(),
        key: apiKey,
      })

      if (pageToken) {
        params.append('pageToken', pageToken)
      }

      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[YouTube API] Error:', response.status, errorText)
        throw new Error(`YouTube API error: ${response.status}`)
      }

      const data: PlaylistApiResponse = await response.json()

      // 영상 ID만 추출
      for (const item of data.items) {
        videoIds.push(item.snippet.resourceId.videoId)
      }

      pageToken = data.nextPageToken
    } while (pageToken)

    console.log(`[YouTube API] Fetched ${videoIds.length} video IDs from playlist ${playlistId}`)
    return videoIds
  } catch (error) {
    console.error('[YouTube API] Failed to fetch playlist:', error)
    throw error
  }
}

/**
 * 단일 영상의 메타데이터 가져오기
 */
export async function fetchVideoMetadata(
  videoId: string,
  apiKey: string
): Promise<VideoMetadata | null> {
  try {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      id: videoId,
      key: apiKey,
    })

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`
    )

    if (!response.ok) {
      console.error('[YouTube API] Error fetching video metadata:', response.status)
      return null
    }

    const data = await response.json()
    if (!data.items || data.items.length === 0) {
      return null
    }

    const item = data.items[0]
    return {
      videoId,
      title: item.snippet.title,
      thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default.url,
      channelTitle: item.snippet.channelTitle,
      duration: item.contentDetails?.duration,
    }
  } catch (error) {
    console.error('[YouTube API] Failed to fetch video metadata:', error)
    return null
  }
}

/**
 * 여러 영상의 메타데이터 한번에 가져오기 (최대 50개)
 */
export async function fetchMultipleVideoMetadata(
  videoIds: string[],
  apiKey: string
): Promise<Map<string, VideoMetadata>> {
  const metadataMap = new Map<string, VideoMetadata>()

  // 50개씩 나눠서 요청
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50)

    try {
      const params = new URLSearchParams({
        part: 'snippet,contentDetails',
        id: chunk.join(','),
        key: apiKey,
      })

      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`
      )

      if (!response.ok) {
        console.error('[YouTube API] Error fetching video metadata:', response.status)
        continue
      }

      const data = await response.json()
      for (const item of data.items || []) {
        metadataMap.set(item.id, {
          videoId: item.id,
          title: item.snippet.title,
          thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default.url,
          channelTitle: item.snippet.channelTitle,
          duration: item.contentDetails?.duration,
        })
      }
    } catch (error) {
      console.error('[YouTube API] Failed to fetch video metadata chunk:', error)
    }
  }

  return metadataMap
}

/**
 * YouTube 재생목록 fetching composable
 */
export function useYouTubePlaylist() {
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  /**
   * 재생목록 URL에서 영상 ID 목록 가져오기
   */
  const fetchFromUrl = async (
    url: string,
    apiKey: string
  ): Promise<string[]> => {
    isLoading.value = true
    error.value = null

    try {
      const playlistId = extractPlaylistId(url)
      if (!playlistId) {
        throw new Error('유효한 YouTube 재생목록 URL이 아닙니다')
      }

      const videoIds = await fetchPlaylistVideoIds(playlistId, apiKey)
      return videoIds
    } catch (err) {
      error.value = err instanceof Error ? err.message : '재생목록을 불러오는데 실패했습니다'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    error,
    fetchFromUrl,
  }
}
