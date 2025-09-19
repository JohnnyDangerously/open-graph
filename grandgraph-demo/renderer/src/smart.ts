import { cacheResolve, cacheTile } from './cache'
import { store } from './store'
import { resolvePerson, resolveCompany, fetchEgoBinary, fetchEgoClientJSON, fetchCompanyEgoJSON } from './lib/api'
import { parseJsonTile, parseTile } from './graph/parse'

export async function resolveSmart(q: string): Promise<string | null> {
  const s = q.trim()
  // Handle explicit prefixes but non-canonical payloads
  if (/^person:/i.test(s)) {
    const payload = s.slice('person:'.length).trim()
    if (/^\d+$/.test(payload)) return `person:${payload}`
    // Treat remainder as LinkedIn URL or name
    const id = await resolvePerson(payload)
    if (id) return id
    return null
  }
  if (/^company:/i.test(s)) {
    const payload = s.slice('company:'.length).trim()
    if (/^\d+$/.test(payload)) return `company:${payload}`
    const id = await resolveCompany(payload)
    if (id) return id
    return null
  }
  // LinkedIn URL direct
  if (/linkedin\.com\/in\//i.test(s)) { const id = await resolvePerson(s); if (id) return id }
  // Plain name/domain fallbacks
  const p = await resolvePerson(s); if (p) return p
  const c = await resolveCompany(s); if (c) return c
  const cached = await cacheResolve(s); if (cached) return cached
  return null
}

export async function loadTileSmart(key: string) {
  // Company: go straight to JSON builder. Person: prefer binary first.
  if (key.startsWith('company:')) {
    const j = await fetchCompanyEgoJSON(key, 1500)
    const tile = parseJsonTile(j)
    if (tile && (j.meta?.nodes?.length)) {
      const labels = new Array(tile.count)
      for (let i=0;i<tile.count;i++){
        const n = j.meta.nodes[i] || {}
        labels[i] = (n.full_name || n.name || n.id || `#${i}`)
      }
      ;(tile as any).labels = labels
    }
    return { tile }
  }
  // Person flow
  try {
    console.log('loadTileSmart: trying fetchEgoBinary for key:', key)
    const b = await fetchEgoBinary(key, 1500) as any
    if (b && b.buf) {
      const tile = parseTile(b.buf)
      if (b.labels && Array.isArray(b.labels)) (tile as any).labels = b.labels
      if (b.meta && b.meta.nodes) (tile as any).meta = { nodes: b.meta.nodes }
      console.log('loadTileSmart: Parsed binary tile:', { count: tile.count, edges: tile.edges?.length })
      return { tile }
    }
  } catch (e) {
    console.warn('loadTileSmart: binary path failed, trying JSON:', e)
  }
  try {
    const j = await fetchEgoClientJSON(key, 1500)
    const tile = parseJsonTile(j)
    if (tile && (j.meta?.nodes?.length)) {
      const labels = new Array(tile.count)
      for (let i=0;i<tile.count;i++){
        const n = j.meta.nodes[i] || {}
        labels[i] = (n.full_name || n.name || n.id || `#${i}`)
      }
      ;(tile as any).labels = labels
    }
    return { tile }
  } catch (error) {
    console.error('loadTileSmart: both paths failed:', error)
  }
  // Fallback to cache
  const c = await cacheTile(key)
  if (!c) throw new Error('ego not found (backend+cache)')
  return 'json' in c ? { tile: parseJsonTile(c.json) } : { tile: parseTile(c.buf) }
}
