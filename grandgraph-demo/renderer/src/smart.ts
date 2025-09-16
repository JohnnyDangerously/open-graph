import { cacheResolve, cacheTile } from './cache'
import { store } from './store'
import { resolvePerson, resolveCompany, fetchEgoJSON, fetchEgoBinary } from './lib/api'
import { parseJsonTile, parseTile } from './graph/parse'

export async function resolveSmart(q: string): Promise<string | null> {
  const s = q.trim()
  if (/^(person|company):/i.test(s)) return s
  if (/linkedin\.com\/in\//i.test(s)) { const id = await resolvePerson(s); if (id) return id }
  const p = await resolvePerson(s); if (p) return p
  const c = await resolveCompany(s); if (c) return c
  const cached = await cacheResolve(s); if (cached) return cached
  return null
}

export async function loadTileSmart(key: string) {
  // Prefer server JSON (edges), then binary, then cache
  try { const j = await fetchEgoJSON(key, 1500); return { tile: parseJsonTile(j) } } catch {}
  try { const b = await fetchEgoBinary(key, 1500); return { tile: parseTile(b) } } catch {}
  const c = await cacheTile(key)
  if (!c) throw new Error('ego not found (backend+cache)')
  return 'json' in c ? { tile: parseJsonTile(c.json) } : { tile: parseTile(c.buf) }
}
