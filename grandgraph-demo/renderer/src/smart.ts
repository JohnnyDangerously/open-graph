import { cacheResolve, cacheTile } from './cache'
import { store } from './store'
import { fetchEgoBinary, resolveLinkedIn } from './api'
import { parseTile } from './graph/parse'

export async function resolveSmart(q: string): Promise<string | null> {
  const { cacheFirst } = store.getState()
  if (cacheFirst) {
    const c = await cacheResolve(q)
    if (c) return c
  }
  // basic backend fallback: try LinkedIn resolver when URL is provided
  if (/linkedin\.com\/in\//i.test(q)) {
    const r = await resolveLinkedIn(q)
    if (r) return `person:${r}`
  }
  return null
}

export async function loadTileSmart(key: string) {
  const { cacheFirst } = store.getState()
  if (cacheFirst) {
    try {
      const t = await cacheTile(key)
      if (t.kind === 'binary') {
        const tile = parseTile(t.buf as any)
        return { tile, meta: undefined }
      } else {
        const json = t.json
        const N = json.meta.nodes.length
        const nodes = new Float32Array(N * 2)
        const group = new Uint16Array(N)
        const flags = new Uint8Array(N)
        const size = new Float32Array(N)
        const alpha = new Float32Array(N)
        for (let i = 0; i < N; i++) {
          nodes[2 * i] = json.coords.nodes[i][0]
          nodes[2 * i + 1] = json.coords.nodes[i][1]
          group[i] = json.meta.nodes[i].group | 0
          flags[i] = json.meta.nodes[i].flags | 0
          size[i] = i ? 3.2 : 12
          alpha[i] = i ? 0.85 : 1.0
        }
        let edges: Uint32Array | undefined
        if (Array.isArray(json.coords.edges)) {
          const flat = new Uint32Array(json.coords.edges.length * 2)
          for (let e = 0; e < json.coords.edges.length; e++) {
            flat[2 * e] = json.coords.edges[e][0]
            flat[2 * e + 1] = json.coords.edges[e][1]
          }
          edges = flat
        }
        return { tile: { nodes, size, alpha, group, count: N, edges } }
      }
    } catch {}
  }
  // backend fallback to binary endpoint
  const personId = key.replace(/^person:/, '')
  const buf = await fetchEgoBinary(personId)
  const tile = parseTile(buf)
  return { tile }
}
