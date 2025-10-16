export function createPeerInspector(provider: unknown, intervalMs = 2000) {
  let intervalId: number | undefined
  const peersStatus: Record<string, { connType: string; server?: string }> = {}

  const getStatuses = () => ({ ...peersStatus })

  const stop = () => {
    if (intervalId) clearInterval(intervalId)
    intervalId = undefined
  }

  const start = () => {
    stop()
    intervalId = window.setInterval(() => void inspectOnce(), intervalMs)
    void inspectOnce()
  }

  async function inspectOnce() {
    if (!provider) return
    const statuses: Record<string, { connType: string; server?: string }> = {}

    const p = provider as unknown as { peers?: unknown }
    const iteratePeers = (fn: (peer: unknown, id: string) => void) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (p.peers && typeof (p.peers as any).forEach === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(p.peers as any).forEach((peer: unknown, id: string) => fn(peer, id))
        } else {
          for (const [id, peer] of Object.entries(p.peers || {})) fn(peer, id)
        }
      } catch {
        // ignore
      }
    }

    const collect = async (peer: unknown, id: string) => {
      let connType = 'unknown'
      let server: string | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pc = (peer as unknown as any)?._pc || (peer as unknown as any)?.pc || (peer as unknown as any)?.peerConnection
        if (pc && typeof pc.getStats === 'function') {
          const stats: unknown = await pc.getStats()
          let localId: string | undefined
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const report of (stats as any).values()) {
            if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.selected)) {
              localId = report.localCandidateId || report.localCandidate || report.local
              // try to extract server info
              if (report.url) server = report.url
              break
            }
          }
          if (localId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const report of (stats as any).values()) {
              if (report.id === localId && (report.type === 'local-candidate' || report.type === 'candidate')) {
                const t = report.candidateType || report.type
                connType = t === 'relay' ? 'TURN (relay)' : t === 'srflx' ? 'STUN (srflx)' : t === 'host' ? 'host' : t || connType
                if (report.address) server = server || report.address
                if (report.ip) server = server || report.ip
                break
              }
            }
          }
        }
      } catch {
        // ignore errors per-peer
      }
      statuses[id] = { connType, server }
    }

    const jobs: Promise<void>[] = []
    iteratePeers((peer: unknown, id: string) => jobs.push(collect(peer, id)))
    await Promise.all(jobs)

    Object.keys(peersStatus).forEach(k => delete peersStatus[k])
    Object.assign(peersStatus, statuses)
  }

  return { start, stop, getStatuses }
}
