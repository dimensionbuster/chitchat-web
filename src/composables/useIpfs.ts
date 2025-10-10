import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'
import { readableStreamToAsyncIterable } from '@/util/stream'
import { CID } from 'multiformats/cid'

let heliaPromise: ReturnType<typeof createHelia> | null = null

export function useIpfs() {
  async function getHelia() {
    if (!heliaPromise) {
      heliaPromise = createHelia({
        // config options here
      })
    }
    return heliaPromise
  }

  async function addFile(file: File) {
    const helia = await getHelia()
    const fs = unixfs(helia)
    const added = await fs.addFile({
      content: readableStreamToAsyncIterable(file.stream()),
      path: file.name,
    })
    return { cid: added.toString(), name: file.name, size: file.size, type: file.type }
  }

  async function getFile(cid: string) {
    const helia = await getHelia()
    const fs = unixfs(helia)

    const cidObj = CID.parse(cid)
    const stream = fs.cat(cidObj)
    const chunks: Uint8Array[] = []
    for await (const chunk of stream) chunks.push(chunk)
    const buffers = chunks.map((chunk) => new Uint8Array(chunk).buffer)
    return new Blob(buffers)
  }
  return { addFile, getFile }
}
