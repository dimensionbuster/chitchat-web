export type ChatMessage = {
  id: string
  authorTrueUuid: string
  authorName: string
  ts: number
  text?: string
  cid?: string
}

export type FileMeta = {
  name?: string
  size?: number
  type?: string
  // allow extra metadata fields
  [key: string]: unknown
}
