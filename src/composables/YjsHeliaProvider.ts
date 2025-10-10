import * as Y from 'yjs'
import type { Helia } from 'helia'

export class YjsHeliaProvider {
  doc: Y.Doc
  helia: Helia
  topic: string
  unsub?: () => void

  constructor(doc: Y.Doc, helia: Helia, roomId: string) {
    this.doc = doc
    this.helia = helia
    this.topic = `yjs-room-${roomId}`
    this.subscribe()
    this.doc.on('update', this.onLocalUpdate)
  }

  subscribe() {
    const pubsub = (this.helia.libp2p as any).services['pubsub']
    const handler = (msg: { detail: { data: Uint8Array } }) => {
      const update = msg.detail.data
      Y.applyUpdate(this.doc, update)
    }
    pubsub.subscribe(this.topic, handler)
    this.unsub = () => pubsub.unsubscribe(this.topic, handler)
  }

  onLocalUpdate = (update: Uint8Array) => {
    const pubsub = (this.helia.libp2p as any).services['pubsub']
    pubsub.publish(this.topic, update)
  }

  destroy() {
    this.doc.off('update', this.onLocalUpdate)
    this.unsub?.()
  }
}
