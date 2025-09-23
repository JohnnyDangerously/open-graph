import { fetchEgoClientJSON, fetchCompanyEgoJSON } from './lib/api'
import { parseJsonTile, validateJsonTileShape } from './graph/parse'
import { raise } from './lib/errors'

export async function resolveSmart(q: string): Promise<string | null> {
  const s = (q || '').trim()
  if (/^person:\d+$/i.test(s)) return `person:${s.slice(s.indexOf(':') + 1)}`
  if (/^company:\d+$/i.test(s)) return `company:${s.slice(s.indexOf(':') + 1)}`
  return null
}

export async function loadTileSmart(key: string) {
  const s = (key || '').trim()
  if (/^company:\d+$/.test(s)) {
    const payload: any = await fetchCompanyEgoJSON(s, 1500)
    const shape = validateJsonTileShape(payload)
    if (!shape.ok) {
      raise('STEP_5_TILE', 'BAD_TILE', 'Company tile shape invalid', { issues: shape.issues })
    }
    const tile = parseJsonTile(payload)
    return { tile }
  }
  if (/^person:\d+$/.test(s)) {
    const j = await fetchEgoClientJSON(s, 1500)
    const shape = validateJsonTileShape(j)
    if (!shape.ok) {
      raise('STEP_5_TILE', 'BAD_TILE', 'Person tile shape invalid', { issues: shape.issues })
    }
    const tile = parseJsonTile(j)
    return { tile }
  }
  throw new Error('Key must be canonical company:<id> or person:<id>')
}
