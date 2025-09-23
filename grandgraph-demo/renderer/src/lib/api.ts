import { MIN_OVERLAP_MONTHS, MIN_OVERLAP_DAYS, BRIDGE_KNN_LIMIT } from './constants'

const normalizeBase = (u:string) => {
  try {
    const url = new URL(u)
    return `${url.protocol}//${url.host}`
  } catch {
    return u.replace(/[?#].*$/,'').replace(/\/+$/,'')
  }
}
let BASE = normalizeBase(localStorage.getItem('API_BASE_URL') || 'http://34.236.80.1:8123')
// Helper: robust ClickHouse exec via POST to avoid URL length limits (proxies may 404 long GETs)
async function execCH(sql: string, opts?: { signal?: AbortSignal, timeoutMs?: number, retry?: number }){
  const url = `${BASE}/?default_format=JSONEachRow`
  const controller = new AbortController()
  const timer = setTimeout(()=>{ try { controller.abort() } catch {} }, Math.max(1000, opts?.timeoutMs ?? 12000))
  const signal = opts?.signal ?? controller.signal
  try {
    const res = await fetch(url, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'text/plain; charset=utf-8', ...authHeaders() }, body: sql, signal })
    if (!res.ok) {
      const txt = await res.text().catch(()=> '')
      const meta = { status: res.status, code: res.headers.get('X-ClickHouse-Exception-Code') || '', sqlHead: sql.slice(0,160), bodyHead: txt.slice(0,240) }
      try { console.warn('execCH error', meta) } catch {}
      // Simple one-shot retry on 5xx
      if (res.status >= 500 && (opts?.retry ?? 1) > 0) {
        return await execCH(sql, { ...opts, retry: 0 })
      }
      const { raise } = await import('./errors')
      raise('STEP_4_FETCH', `HTTP_${res.status}`, 'Query failed', meta)
    }
    return res
  } catch (e) {
    const { raise } = await import('./errors')
    raise('STEP_4_FETCH', 'NETWORK', 'Network/timeout/abort', { sqlHead: sql.slice(0,160) }, e)
  } finally {
    clearTimeout(timer)
  }
}
export const setApiBase = (u:string) => { BASE = normalizeBase(u); try{ localStorage.setItem('API_BASE_URL', BASE) }catch{} }
export const getApiBase = () => BASE
let BEARER = (localStorage.getItem('API_BEARER') || '')
export const setApiConfig = (base?: string, bearer?: string) => {
  if (typeof base === 'string' && base.length) setApiBase(base)
  if (typeof bearer === 'string') { BEARER = bearer || ''; try { localStorage.setItem('API_BEARER', BEARER) } catch {} }
}
const authHeaders = () => {
  const h: Record<string, string> = {}
  if (BEARER) h['Authorization'] = `Bearer ${BEARER}`
  return h
}

// --- Avatars ---------------------------------------------------------------
export async function fetchAvatarMap(personIds: Array<string|number>, batchSize = 500): Promise<Map<string,string>> {
  const out = new Map<string,string>()
  if (!Array.isArray(personIds) || personIds.length === 0) return out
  const ids = Array.from(new Set(personIds.map((id)=> String(id))))
  for (let i=0;i<ids.length;i+=batchSize){
    const chunk = ids.slice(i, i+batchSize)
    const uuidLike = chunk.filter((s)=> s.includes('-'))
    const numeric = chunk.filter((s)=> !s.includes('-'))
    // Query 0: numeric direct hits via by_id table (fast path)
    if (numeric.length){
      const inList0 = numeric.map((id)=> `'${id.replace(/'/g, "''")}'`).join(',')
      const sql0 = `SELECT toString(person_id) AS id, anyLast(avatar_url) AS url FROM via_test.person_avatars_by_id WHERE toString(person_id) IN (${inList0}) GROUP BY id`
      try {
        const res0 = await execCH(sql0)
        if (res0 && res0.ok){
          const txt0 = await res0.text()
          const lines0 = txt0.trim() ? txt0.trim().split('\n') : []
          for (const line of lines0){ try { const row = JSON.parse(line); if (row?.id && row?.url) out.set(String(row.id), String(row.url)) } catch {} }
        }
      } catch {}
    }
    // Query 1: direct match on person_id_str (UUID-like)
    if (uuidLike.length){
      const inList = uuidLike.map((id)=> `'${id.replace(/'/g, "''")}'`).join(',')
      const sql1 = `SELECT person_id_str AS id, anyLast(avatar_url) AS url FROM via_test.person_avatars WHERE person_id_str IN (${inList}) GROUP BY id` 
      try {
        const res1 = await execCH(sql1)
        if (res1 && res1.ok){
          const txt = await res1.text()
          const lines = txt.trim() ? txt.trim().split('\n') : []
          for (const line of lines){ try { const row = JSON.parse(line); if (row?.id && row?.url) out.set(String(row.id), String(row.url)) } catch {} }
        }
      } catch {}
    }
    // Query 2: numeric ids → join via persons_large to get person_id_str
    if (numeric.length){
      const inList2 = numeric.map((id)=> `'${id.replace(/'/g, "''")}'`).join(',')
      const sql2 = `
        SELECT toString(pp.person_id) AS id, anyLast(pa.avatar_url) AS url
        FROM via_test.person_profile_current pp
        LEFT JOIN via_test.persons_large pl ON toString(pl.person_id) = toString(pp.person_id)
        LEFT JOIN via_test.person_avatars pa ON pa.person_id_str = pl.person_id_str
        WHERE toString(pp.person_id) IN (${inList2})
        GROUP BY id`
      try {
        const res2 = await execCH(sql2)
        if (res2 && res2.ok){
          const txt2 = await res2.text()
          const lines2 = txt2.trim() ? txt2.trim().split('\n') : []
          for (const line of lines2){ try { const row = JSON.parse(line); if (row?.id && row?.url) out.set(String(row.id), String(row.url)) } catch {} }
        }
      } catch {}
    }
  }
  return out
}

async function asJSON(r: Response){
  const ct = r.headers.get('content-type') || ''
  const txt = await r.text()
  if (!ct.includes('application/json')) throw new Error(`Expected JSON at ${r.url}; got ${ct}: ${ct}\n${txt.slice(0,120)}`)
  return JSON.parse(txt)
}

export async function healthz(){ return asJSON(await fetch(`${BASE}/healthz`, { mode:'cors', headers: { ...authHeaders() } })) }

export type PersonProfile = {
  id: string
  name?: string
  current_title?: string
  current_company_name?: string
  linkedin?: string
  history: Array<{ company?: string; title?: string; start_date?: string; end_date?: string | null }>
}

export async function fetchPersonProfile(personKey: string | number): Promise<PersonProfile | null> {
  const base = getApiBase()
  const idExpr = `toUInt64(${String(personKey)})`
  const headSql = `
    SELECT toString(person_id) AS id,
           anyLast(name) AS name,
           anyLast(current_title) AS current_title,
           anyLast(current_company_name) AS current_company_name,
           anyLast(linkedin) AS linkedin
    FROM via_test.person_profile_current
    WHERE person_id = ${idExpr}
    GROUP BY person_id
    LIMIT 1
  `
  const histSql = `
    SELECT anyLast(c.name) AS company,
           NULL AS title,
           toString(s.start_date) AS start_date,
           toString(s.end_date) AS end_date
    FROM via_test.stints_compact s
    LEFT JOIN via_test.companies_lite c ON c.company_id = s.company_id
    WHERE s.person_id = ${idExpr}
    GROUP BY s.start_date, s.end_date
    ORDER BY s.start_date DESC
    LIMIT 200
  `
  const headRes = await execCH(headSql)
  const histRes = await execCH(histSql)
  if (!headRes || !headRes.ok) return null
  const headTxt = await headRes.text()
  const headLine = headTxt.trim().split('\n').filter(Boolean)[0]
  if (!headLine) return null
  let head: any
  try { head = JSON.parse(headLine) } catch { return null }
  if (!histRes || !histRes.ok) return { id: String(head.id), name: head.name, current_title: head.current_title, current_company_name: head.current_company_name, linkedin: head.linkedin, history: [] }
  const histTxt = await histRes.text()
  const history = histTxt.trim() ? histTxt.trim().split('\n').map(l=>{ try{ return JSON.parse(l) }catch{ return {} } }) : []
  return { id: String(head.id), name: head.name, current_title: head.current_title, current_company_name: head.current_company_name, linkedin: head.linkedin, history }
}

export async function resolvePerson(_q: string){ return null as any }
export async function resolveCompany(_q: string){ return null as any }

// Person ego (strict, JSON tile)
export async function fetchEgoClientJSON(id: string, limit = 1500){
  const isCo = id.startsWith('company:')
  const key = id.replace(/^company:|^person:/,'')
  if (isCo) { throw new Error('Company ego graphs not implemented for ClickHouse test DB') }

  const buildOverlapSQL = (personKey: string, use64: boolean, minDays: number) => `
    WITH my AS (
      SELECT company_id, start_date, end_date
      FROM via_test.stints_compact
      WHERE ${use64 ? 'person_id' : 'person_id'} = toUInt64(${personKey})
    ), agg AS (
      SELECT
        toUInt64(s.${use64 ? 'person_id' : 'person_id'}) AS neighbor_id,
        sum(greatest(0, dateDiff('day',
              greatest(toDate(s.start_date), toDate(m.start_date)),
              least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today())))
        ))) AS overlap_days
      FROM via_test.stints_compact s
      INNER JOIN my m USING (company_id)
      WHERE toUInt64(s.${use64 ? 'person_id' : 'person_id'}) <> toUInt64(${personKey})
      GROUP BY toUInt64(s.${use64 ? 'person_id' : 'person_id'})
      HAVING overlap_days >= ${Math.max(1, Math.floor(minDays))}
      ORDER BY overlap_days DESC
      LIMIT ${Math.min(limit, 1000)}
    )
    SELECT
      toString(a.neighbor_id) AS id,
      a.overlap_days AS w,
      anyLast(p.name) AS name,
      anyLast(p.current_title) AS title
    FROM agg a
    LEFT JOIN via_test.person_profile_current p ON p.person_id = a.neighbor_id
    GROUP BY id, w
  `
  const executeNeighbors = async (personKey: string, minDays: number) => {
    const sql = buildOverlapSQL(personKey, true, minDays)
    const res = await execCH(sql)
    if (!res || !res.ok) { const msg = await res?.text().catch(()=>"" as any); throw new Error(`fetch failed ${res?.status}: ${String(msg||'').slice(0,200)}`) }
    const text = await res.text()
    const lines = text.trim() ? text.trim().split('\n').filter(Boolean) : []
    return lines.map(line => JSON.parse(line)) as Array<{id:number; w:number; name:string}>
  }
  
  const neighbors = await executeNeighbors(key, MIN_OVERLAP_DAYS)
  if (neighbors.length === 0) throw new Error('No overlapping coworkers (>=720 days) found')

  let centerName = 'Center'
  let centerTitle: string | null = null
  try {
    const centerSQL = `
      SELECT anyLast(name) AS name, anyLast(current_title) AS title
      FROM via_test.person_profile_current
      WHERE person_id = toUInt64(${key})
      GROUP BY person_id
      LIMIT 1`
    const centerRes = await execCH(centerSQL)
    const centerText = await centerRes!.text()
    if (centerText.trim()) {
      const row = JSON.parse(centerText.trim().split('\n')[0])
      centerName = row?.name || 'Center'
      centerTitle = row?.title || null
    }
  } catch {}

  const buildSecondDegreeSQL = (personKey: string, use64: boolean, minDaysFirst: number, minDaysSecond: number, secLimit: number) => `
    WITH
      my AS (
        SELECT company_id, start_date, end_date
        FROM via_test.stints_compact
        WHERE ${use64 ? 'person_id' : 'person_id'} = toUInt64(${personKey})
      ),
      agg_first AS (
        SELECT
          toUInt64(s.${use64 ? 'person_id' : 'person_id'}) AS neighbor_id,
          sum(greatest(0, dateDiff('day',
                greatest(toDate(s.start_date), toDate(m.start_date)),
                least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today()))
          )))) AS overlap_days
        FROM via_test.stints_compact s
        INNER JOIN my m USING (company_id)
        WHERE toUInt64(s.${use64 ? 'person_id' : 'person_id'}) <> toUInt64(${personKey})
        GROUP BY toUInt64(s.${use64 ? 'person_id' : 'person_id'})
        HAVING overlap_days >= ${Math.max(1, Math.floor(minDaysFirst))}
      ),
      pairs_raw AS (
        SELECT
          toUInt64(s1.${use64 ? 'person_id' : 'person_id'}) AS first_id,
          toUInt64(s2.${use64 ? 'person_id' : 'person_id'}) AS sec_id,
          sum(greatest(0, dateDiff('day',
                greatest(toDate(s1.start_date), toDate(s2.start_date)),
                least(toDate(ifNull(s1.end_date, today())), toDate(ifNull(s2.end_date, today()))
          )))) AS days
        FROM via_test.stints_compact s1
        INNER JOIN via_test.stints_compact s2 ON s1.company_id = s2.company_id
        WHERE toUInt64(s1.${use64 ? 'person_id' : 'person_id'}) IN (SELECT neighbor_id FROM agg_first)
          AND toUInt64(s2.${use64 ? 'person_id' : 'person_id'}) NOT IN (SELECT neighbor_id FROM agg_first)
          AND toUInt64(s2.${use64 ? 'person_id' : 'person_id'}) <> toUInt64(${personKey})
        GROUP BY first_id, sec_id
        HAVING days >= ${Math.max(1, Math.floor(minDaysSecond))}
      ),
      best AS (
        SELECT first_id, sec_id, days
        FROM pairs_raw
        ORDER BY days DESC
        LIMIT 1 BY sec_id
        LIMIT ${Math.max(0, Math.min(limit, 1200))}
      )
    SELECT toString(b.sec_id) AS id, b.days AS w, toString(b.first_id) AS first_id,
           anyLast(p.name) AS name,
           anyLast(p.current_title) AS title
    FROM best b
    LEFT JOIN via_test.person_profile_current p ON p.person_id = b.sec_id
    GROUP BY id, w, first_id
  `

  const res2 = await execCH(buildSecondDegreeSQL(key, true, MIN_OVERLAP_DAYS, MIN_OVERLAP_DAYS, Math.max(0, Math.min(limit - (1 + neighbors.length), 1000))))
  const txt = await res2!.text()
  const secondList = (txt.trim() ? txt.trim().split('\n').filter(Boolean) : []).map(l=>JSON.parse(l)) as Array<{ id:string; w:number; name:string; first_id:string; title?: string }>

  const count = 1 + neighbors.length + secondList.length
  const nodes = new Array(count * 2)
  nodes[0] = 0
  nodes[1] = 0

  const ringsFirst = [120, 300, 480]
  const firstCount = neighbors.length
  const ringCountsFirst = [Math.min(12, firstCount), Math.min(36, Math.max(0, firstCount - 12)), Math.max(0, firstCount - 48)]
  let idx = 1
  for (let r = 0; r < ringsFirst.length && idx <= firstCount; r++) {
    const radius = ringsFirst[r]
    const ringCount = ringCountsFirst[r] > 0 ? ringCountsFirst[r] : 0
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / Math.max(1, ringCount)) * Math.PI * 2 + (Math.random() - 0.5) * 0.1
      nodes[idx*2] = Math.cos(angle) * radius + (Math.random() - 0.5) * 12
      nodes[idx*2 + 1] = Math.sin(angle) * radius + (Math.random() - 0.5) * 12
      idx++
    }
  }

  const startSecond = 1 + firstCount
  const ringsSecond = [600, 780, 960]
  const secondCount = secondList.length
  let placedSecond = 0
  for (let r = 0; r < ringsSecond.length && placedSecond < secondCount; r++) {
    const radius = ringsSecond[r]
    const toPlace = Math.min(secondCount - placedSecond, r === 0 ? 24 : r === 1 ? 72 : (secondCount - placedSecond))
    for (let i = 0; i < toPlace; i++, placedSecond++) {
      const angle = (placedSecond / Math.max(1, toPlace)) * Math.PI * 2 + (Math.random() - 0.5) * 0.08
      const j = startSecond + placedSecond
      nodes[j*2] = Math.cos(angle) * radius + (Math.random() - 0.5) * 16
      nodes[j*2 + 1] = Math.sin(angle) * radius + (Math.random() - 0.5) * 16
    }
  }

  const edges: Array<[number,number,number]> = []
  const idToFirstIndex = new Map<string, number>()
  for (let i = 0; i < neighbors.length; i++) {
    const months = Math.max(0, Math.round((neighbors[i].w||0) / 30))
    edges.push([0, 1 + i, months])
    idToFirstIndex.set(String(neighbors[i].id), 1 + i)
  }
  for (let i = 0; i < secondList.length; i++) {
    const s = secondList[i]
    const months = Math.max(0, Math.round((s.w||0) / 30))
    const firstIdx = idToFirstIndex.get(String(s.first_id))
    if (typeof firstIdx === 'number') {
      edges.push([firstIdx, startSecond + i, months])
    }
  }

  const labels = [centerName, ...neighbors.map((n:any) => n.name), ...secondList.map((n:any) => n.name)]
  const metaNodes = [
    { id: String(key), name: centerName, full_name: centerName, title: centerTitle, group: 0, flags: 0 },
    ...neighbors.map((n:any) => ({ id: String(n.id), name: n.name, full_name: n.name, title: n.title || null, group: 0, flags: 0 })),
    ...secondList.map((n:any) => ({ id: String(n.id), name: n.name, full_name: n.name, title: n.title || null, group: 0, flags: 0 }))
  ]

  const tile = {
    meta: { nodes: metaNodes, mode: 'person' },
    coords: {
      nodes: new Array(count).fill(0).map((_, i) => [nodes[i*2], nodes[i*2+1]]),
      edges
    },
    labels
  }

  return tile
}

// Company-centric ego: employees (top by tenure count) with names
export async function fetchCompanyEgoJSON(id: string, limit = 1500){
  if (!id.startsWith('company:')) throw new Error('company ego requires company:<id>')
  const key = id.replace(/^company:/,'')

  const buildSql = (use64: boolean, currentOnly: boolean) => {
    const pid = use64 ? 'person_id' : 'person_id'
    const pidCast = use64 ? 'toUInt64(e.id)' : 'e.id'
    return `
    WITH emp AS (
      SELECT toUInt64(${pid}) AS id, count() AS c
      FROM via_test.stints_compact
      WHERE company_id = toUInt64(${key})
        ${currentOnly ? "AND (end_date IS NULL OR toDate(end_date) >= today())" : ''}
      GROUP BY toUInt64(${pid})
      ORDER BY c DESC
      LIMIT ${Math.min(limit, 1000)}
    )
    SELECT e.id AS id, e.c AS w,
           anyLast(p.name) AS name
    FROM emp e
    LEFT JOIN via_test.person_profile_current p ON p.person_id = ${pidCast}
    GROUP BY id, w
    `
  }

  const exec = async (sql: string) => execCH(sql)

  // Strict current-only
  let res = await exec(buildSql(true, true))
  let text = res && (res as Response).ok ? await (res as Response).text() : ''
  let rows = text.trim() ? text.trim().split('\n').map(l=>JSON.parse(l)) : [] as Array<{id:number; w:number; name:string, title?: string}>

  if (rows.length === 0) { throw new Error('No current employees found for company') }

  // Fetch company name for labeling
  let companyName = `company:${key}`
  try {
    const nameRes = await exec(`SELECT anyLast(name) AS name FROM via_test.companies_lite WHERE company_id = toUInt64(${key}) LIMIT 1`)
    const nameTxt = await nameRes!.text()
    const first = nameTxt.trim().split('\n').filter(Boolean)[0]
    if (first) companyName = (JSON.parse(first).name as string) || companyName
  } catch {}

  const count = 1 + rows.length
  const nodes: Array<[number,number]> = new Array(count)
  nodes[0] = [0,0]
  const edges: Array<[number,number,number]> = []
  for (let i=1;i<count;i++){ edges.push([0,i, rows[i-1]?.w || 1]) }
  const rings = Math.max(1, Math.ceil(Math.sqrt(count/14)))
  let idx = 1
  for (let r=0;r<rings && idx<count;r++){
    const inRing = Math.ceil((count-1)/rings)
    const R = 140 + r*180
    for (let k=0;k<inRing && idx<count;k++, idx++){
      const a = (k/inRing)*Math.PI*2
      nodes[idx] = [Math.cos(a)*R + (Math.random()*2-1)*30, Math.sin(a)*R + (Math.random()*2-1)*30]
    }
  }
  const metaNodes = new Array(count).fill(0).map((_, i) => (
    i===0
      ? { id: String(key), full_name: companyName, name: companyName, title: null, group: 0, flags: 0 }
      : { id: String(rows[i-1]?.id||i), full_name: String(rows[i-1]?.name||''), name: String(rows[i-1]?.name||''), title: rows[i-1]?.title || null, group: 1, flags: 0 }
  ))
  const groups = new Array(count).fill(1)
  groups[0] = 0
  // Build labels: center is company name; others are person names
  const labels: string[] = new Array(count)
  labels[0] = companyName
  for (let i=1;i<count;i++) labels[i] = String(rows[i-1]?.name || '')
  return { meta: { nodes: metaNodes }, coords: { nodes, edges, groups }, labels }
}

// Bridges query between two companies (left, right)
// Returns a JSON tile shape consumable by parseJsonTile
export async function fetchBridgesTileJSON(companyAId: string, companyBId: string, limit = 80){
  const base = getApiBase()
  if (!companyAId.startsWith('company:') || !companyBId.startsWith('company:')) throw new Error('bridges requires company:<id> + company:<id>')
  const a = companyAId.replace(/^company:/,'')
  const b = companyBId.replace(/^company:/,'')
  if (a === b) throw new Error('Choose two different companies to compare bridges.')

  const exec = async (sql: string) => {
    const res = await execCH(sql)
    if (!res || !res.ok) {
      const txt = await res?.text().catch(()=>'' as any)
      throw new Error(`bridge query failed ${res?.status}: ${String(txt||'').slice(0,200)}`)
    }
    const text = await res.text()
    return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : []
  }

  const [rowA, rowB] = await Promise.all([
    exec(`SELECT anyLast(name) AS name FROM via_test.companies_lite WHERE company_id = toUInt64(${a}) LIMIT 1`),
    exec(`SELECT anyLast(name) AS name FROM via_test.companies_lite WHERE company_id = toUInt64(${b}) LIMIT 1`)
  ])
  const nameA = rowA?.[0]?.name || `Company ${a}`
  const nameB = rowB?.[0]?.name || `Company ${b}`

  // Bridge candidates: intersection of frontier-of-current(A) and frontier-of-current(B)
  const candSql = `
    WITH
      a AS (SELECT toUInt64(person_id) AS pid FROM via_test.stints_compact WHERE company_id = toUInt64(${a}) AND end_date IS NULL GROUP BY pid),
      b AS (SELECT toUInt64(person_id) AS pid FROM via_test.stints_compact WHERE company_id = toUInt64(${b}) AND end_date IS NULL GROUP BY pid),
      front_a AS (
        SELECT toUInt64(s2.person_id) AS pid,
               sum(greatest(0, dateDiff('day', greatest(toDate(s1.start_date), toDate(s2.start_date)), least(toDate(ifNull(s1.end_date, today())), toDate(ifNull(s2.end_date, today())))))) AS daysA
        FROM via_test.stints_compact s1
        INNER JOIN a ON s1.person_id = a.pid
        INNER JOIN via_test.stints_compact s2 ON s1.company_id = s2.company_id AND s1.person_id <> s2.person_id
        GROUP BY pid
      ),
      front_b AS (
        SELECT toUInt64(s2.person_id) AS pid,
               sum(greatest(0, dateDiff('day', greatest(toDate(s1.start_date), toDate(s2.start_date)), least(toDate(ifNull(s1.end_date, today())), toDate(ifNull(s2.end_date, today())))))) AS daysB
        FROM via_test.stints_compact s1
        INNER JOIN b ON s1.person_id = b.pid
        INNER JOIN via_test.stints_compact s2 ON s1.company_id = s2.company_id AND s1.person_id <> s2.person_id
        GROUP BY pid
      ),
      cand AS (
        SELECT toUInt64(coalesce(fa.pid, fb.pid)) AS pid, toUInt64(daysA) AS daysA, toUInt64(daysB) AS daysB
        FROM (SELECT pid, daysA FROM front_a) fa
        INNER JOIN (SELECT pid, daysB FROM front_b) fb USING (pid)
      )
    SELECT *
    FROM (
      SELECT toString(pid) AS id,
             toUInt32(round(daysA/30)) AS months_a,
             toUInt32(round(daysB/30)) AS months_b,
             anyLast(pp.name) AS name
      FROM cand c
      LEFT JOIN via_test.person_profile_current pp ON pp.person_id = c.pid
      GROUP BY id, months_a, months_b
    )
    WHERE least(months_a, months_b) >= ${MIN_OVERLAP_MONTHS}
    ORDER BY least(months_a, months_b) DESC
    LIMIT ${Math.max(10, Math.min(600, limit))}`

  const bridgeRows = await exec(candSql) as Array<{id:string,name?:string,months_a?:number,months_b?:number}>

  const leftAnchor = { id: `company:${a}`, name: nameA, title: null, company: nameA, group: 0 }
  const rightAnchor = { id: `company:${b}`, name: nameB, title: null, company: nameB, group: 2 }

  const bridgeCount = bridgeRows.length
  const count = 2 + bridgeCount
  const nodes: Array<[number,number]> = new Array(count)
  nodes[0] = [-3640, 0]
  nodes[1] = [3640, 0]
  const groups = new Array(count).fill(1)
  groups[0] = 0
  groups[1] = 2

  // Layout bridge candidates in a wider grid to reduce vertical stacking
  // Dynamic columns: grow with sqrt(N) and cap for readability
  const cols = Math.min(12, Math.max(6, Math.ceil(Math.sqrt(Math.max(1, bridgeCount)) * 1.6)))
  const rows = Math.max(1, Math.ceil(bridgeCount / cols))
  const hSpacing = 560 // widen horizontally
  const vSpacing = 280 // slightly increase row spacing but with fewer rows overall
  for (let i=0;i<bridgeCount;i++){
    const row = Math.floor(i / cols)
    const colInRow = i - row * cols
    const colsThisRow = (row === rows - 1 && (bridgeCount % cols) !== 0) ? (bridgeCount % cols) : cols
    const center = (colsThisRow - 1) / 2
    const x = (colInRow - center) * hSpacing
    const y = (row - (rows - 1) / 2) * vSpacing
    nodes[2 + i] = [x, y]
  }

  // Anchor edges: weight by months_a/months_b strengths
  const edges: Array<[number,number,number]> = []
  bridgeRows.forEach((row, idx) => {
    edges.push([0, 2 + idx, Math.max(1, Math.round(Number(row.months_a || 1)))])
    edges.push([1, 2 + idx, Math.max(1, Math.round(Number(row.months_b || 1)))])
    groups[2 + idx] = 1
  })

  const idToIndex = new Map<string, number>()
  for (let i=0;i<bridgeCount;i++) idToIndex.set(String(bridgeRows[i].id), 2 + i)

  // Inter-candidate edges (bridge network): pairwise overlaps among selected candidates
  if (bridgeCount > 1) {
    const idList = bridgeRows.map(r => `toUInt64(${String(r.id)})`).join(',')
    const pairSql = `
      WITH cids AS (
        SELECT arrayJoin([${idList}]) AS pid
      )
      SELECT toString(p1) AS p1, toString(p2) AS p2, toUInt32(round(days/30)) AS months
      FROM (
        SELECT toUInt64(s1.person_id) AS p1, toUInt64(s2.person_id) AS p2,
               sum(greatest(0, dateDiff('day', greatest(toDate(s1.start_date), toDate(s2.start_date)), least(toDate(ifNull(s1.end_date, today())), toDate(ifNull(s2.end_date, today())))))) AS days
        FROM via_test.stints_compact s1
        INNER JOIN via_test.stints_compact s2 ON s1.company_id = s2.company_id AND s1.person_id < s2.person_id
        INNER JOIN cids c1 ON c1.pid = s1.person_id
        INNER JOIN cids c2 ON c2.pid = s2.person_id
        GROUP BY p1, p2
        HAVING days >= ${MIN_OVERLAP_DAYS}
      )
    `
    const pairRows = await exec(pairSql) as Array<{ p1:string, p2:string, months:number }>
    // Build symmetric adjacency and keep top-K per node by months
    const adj = new Map<number, Array<{ j:number, months:number }>>()
    const add = (u:number, v:number, m:number)=>{
      const a = adj.get(u) || []; a.push({ j:v, months:m }); adj.set(u, a)
    }
    for (const r of pairRows) {
      const i1 = idToIndex.get(String(r.p1))
      const i2 = idToIndex.get(String(r.p2))
      if (typeof i1 === 'number' && typeof i2 === 'number') {
        const m = Math.max(1, Math.round(Number(r.months||1)))
        add(i1, i2, m); add(i2, i1, m)
      }
    }
    const seen = new Set<string>()
    const topK = Math.max(1, BRIDGE_KNN_LIMIT|0)
    adj.forEach((list, u)=>{
      list.sort((a,b)=> b.months - a.months)
      for (let k=0;k<Math.min(topK, list.length);k++){
        const v = list[k].j, m = list[k].months
        const key = u < v ? `${u}-${v}` : `${v}-${u}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push([u, v, m])
      }
    })
  }

  const metaNodes: Array<any> = [
    { ...leftAnchor },
    { ...rightAnchor },
    ...bridgeRows.map(row => ({
      id: row.id,
      name: row.name || row.id,
      full_name: row.name || row.id,
      title: null,
      company: null,
      linkedin: null,
      group: 1,
      score: Math.min(Number(row.months_a||0), Number(row.months_b||0)),
      left_degree: Number(row.months_a||0),
      right_degree: Number(row.months_b||0)
    }))
  ]

  const labels: string[] = new Array(count)
  labels[0] = `${nameA} • Home`
  labels[1] = `${nameB} • Home`
  for (let i = 0; i < bridgeCount; i++) {
    const meta: any = metaNodes[2 + i]
    const name = meta?.name || meta?.full_name || meta?.id
    const base = [name].filter(Boolean).join(' ')
    const score = typeof meta?.score === 'number' && Number.isFinite(meta.score) ? ` • overlap ${Math.round(meta.score)}m` : ''
    labels[2 + i] = (base || String(meta?.id)) + score
  }

  return {
    meta: { nodes: metaNodes },
    coords: { nodes, edges, groups },
    labels,
    focusWorld: { x: 0, y: 0 }
  }
}


export async function fetchMigrationPairs(companyAId: string, companyBId: string, opts?: { windowMonths?: number; since?: string; until?: string; limit?: number }){
  const base = getApiBase()
  if (!companyAId.startsWith('company:') || !companyBId.startsWith('company:')) {
    throw new Error('migration requires company:<id> • company:<id>')
  }
  const a = companyAId.replace(/^company:/,'')
  const b = companyBId.replace(/^company:/,'')
  const limit = Math.max(10, Math.min(500, opts?.limit ?? 120))
  const windowClauses: string[] = []
  if (opts?.windowMonths && Number.isFinite(opts.windowMonths)) {
    windowClauses.push(`start_date >= addMonths(today(), -${Number(opts.windowMonths)})`)
  }
  if (opts?.since) {
    const since = opts.since.replace(/'/g, "''")
    windowClauses.push(`start_date >= toDate('${since}')`)
  }
  if (opts?.until) {
    const until = opts.until.replace(/'/g, "''")
    windowClauses.push(`start_date <= toDate('${until}')`)
  }
  const windowFilter = windowClauses.length ? 'AND ' + windowClauses.join(' AND ') : ''
  const sql = `
    WITH
      stints AS (
        SELECT toUInt64(person_id) AS person_id,
               toUInt64(company_id) AS company_id,
               toDate(start_date) AS start_date,
               toDate(ifNull(end_date, today())) AS end_date
        FROM via_test.stints_compact
        WHERE company_id IN (toUInt64(${a}), toUInt64(${b}))
          AND link_scope = 'GLOBAL'
          ${windowFilter}
      ),
      ordered AS (
        SELECT *,
               row_number() OVER (PARTITION BY person_id ORDER BY start_date, end_date) AS rn,
               lead(company_id) OVER (PARTITION BY person_id ORDER BY start_date, end_date) AS next_company,
               lead(start_date) OVER (PARTITION BY person_id ORDER BY start_date, end_date) AS next_start
        FROM stints
      ),
      transitions AS (
        SELECT person_id,
               company_id AS from_company,
               next_company AS to_company,
               dateDiff('day', start_date, ifNull(next_start, end_date)) AS dwell_days
        FROM ordered
        WHERE next_company IS NOT NULL AND company_id <> next_company
      )
    SELECT
      toString(from_company) AS from_id,
      toString(to_company) AS to_id,
      countDistinct(person_id) AS movers,
      anyLast(c_from.name) AS from_name,
      anyLast(c_to.name) AS to_name,
      avg(dwell_days) AS avg_days
    FROM transitions
    LEFT JOIN via_test.companies_lite c_from ON c_from.company_id = from_company
    LEFT JOIN via_test.companies_lite c_to ON c_to.company_id = to_company
    GROUP BY from_id, to_id
    ORDER BY movers DESC
    LIMIT ${limit}
  `
  const res = await execCH(sql)
  if (!res || !res.ok) {
    const txt = await res?.text().catch(()=>'' as any)
    throw new Error(`migration query failed ${res ? res.status : '???'}: ${String(txt||'').slice(0,160)}`)
  }
  const body = await res.text()
  const rows = body.trim() ? body.trim().split('\n').map(line => JSON.parse(line)) as Array<{ from_id:string; to_id:string; movers:number; from_name?:string; to_name?:string; avg_days?:number }> : []
  return rows
}

// Intro Paths Explorer (Top-3 Paths + Nearby Execs)
export type IntroPath = {
  S: string
  M: string
  T: string
  names: { S?: string|null, M?: string|null, T?: string|null }
  titles: { M_title?: string|null, T_title?: string|null }
  scores: { R_SM:number, R_MT:number, icp:number, overlap:number, p:number }
}

export type IntroPathsResult = {
  S: string
  companyId: string
  icpRegex: string
  Ms: Array<{ id:string, months:number, R_SM:number, name?:string|null }>
  Ts: Array<{ id:string, icp:number, title?:string|null, name?:string|null }>
  paths: IntroPath[]
  top3: IntroPath[]
}

function clamp01(x:number){ return Math.max(0, Math.min(1, x)) }

function safeRegex(s?: string | null){
  const d = 'vp.*sales|head.*sales|cro'
  const raw = (s||'').trim()
  const base = raw.length ? raw : d
  return base.replace(/'/g, "''")
}

export async function fetchIntroPaths(params: { S: string|number, companyId: string|number, icpRegex?: string, k?: number, minRMT?: number }): Promise<IntroPathsResult> {
  const S = String(params.S).replace(/^person:/i,'')
  const C = String(params.companyId).replace(/^company:/i,'')
  const k = Math.max(1, Math.min(10, params.k ?? 3))
  const minRMT = typeof params.minRMT === 'number' ? Math.max(0, Math.min(1, params.minRMT)) : 0.15
  const regex = safeRegex(params.icpRegex)

  // 1) First-degree neighbors of S via stint overlap
  const mSql = `
    WITH S AS (SELECT toUInt64(${S}) AS id)
    , my AS (
      SELECT company_id, start_date, end_date
      FROM via_test.stints_compact
      WHERE person_id = (SELECT id FROM S)
    )
    , agg AS (
      SELECT
        toUInt64(s.person_id) AS M,
        sum(greatest(0, dateDiff('day',
              greatest(toDate(s.start_date), toDate(m.start_date)),
              least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today()))
        )))) AS overlap_days
      FROM via_test.stints_compact s
      INNER JOIN my m USING (company_id)
      WHERE s.person_id <> (SELECT id FROM S)
      GROUP BY M
      HAVING overlap_days >= 90
      ORDER BY overlap_days DESC
      LIMIT 240
    )
    SELECT toString(a.M) AS id,
           toUInt32(round(a.overlap_days/30)) AS months,
           anyLast(pp.name) AS name
    FROM agg a
    LEFT JOIN via_test.person_profile_current pp ON pp.person_id = a.M
    GROUP BY id, months
  `
  const mRes = await execCH(mSql)
  const mTxt = await mRes!.text()
  const Ms = (mTxt.trim() ? mTxt.trim().split('\n').map(l=>JSON.parse(l)) : []) as Array<{ id:string, months:number, name?:string|null }>
  const MsLimited = Ms.slice(0, 120).map(r => ({ ...r, R_SM: clamp01((Number(r.months||0))/60) }))

  // 2) ICP candidates T at company C
  const tSql = `
    WITH C AS (SELECT toUInt64(${C}) AS id)
    SELECT toString(s.person_id) AS id,
           anyLast(pp.current_title) AS title,
           if(match(lower(coalesce(anyLast(pp.current_title), '')), '${regex}'), 1.0, if(match(lower(coalesce(anyLast(pp.current_title), '')), 'sales'), 0.8, 0.0)) AS icp,
           anyLast(pp.name) AS name
    FROM via_test.stints_compact s
    LEFT JOIN via_test.person_profile_current pp ON pp.person_id = s.person_id
    WHERE s.company_id = (SELECT id FROM C)
    GROUP BY s.person_id
    HAVING icp > 0
    ORDER BY icp DESC
    LIMIT 400
  `
  const tRes = await execCH(tSql)
  const tTxt = await tRes!.text()
  const Ts = (tTxt.trim() ? tTxt.trim().split('\n').map(l=>JSON.parse(l)) : []) as Array<{ id:string, title?:string|null, icp:number, name?:string|null }>
  const TsLimited = Ts.slice(0, 240)

  if (MsLimited.length === 0 || TsLimited.length === 0) {
    return { S: String(S), companyId: String(C), icpRegex: regex, Ms: MsLimited, Ts: TsLimited, paths: [], top3: [] }
  }

  const list = (arr: Array<{id:string}>) => arr.map(r=>`toUInt64(${String(r.id)})`).join(',')

  // 3) M-T overlap across any company (months)
  const mtSql = `
    WITH Ms AS (SELECT arrayJoin([${list(MsLimited)}]) AS mid),
         Ts AS (SELECT arrayJoin([${list(TsLimited)}]) AS tid)
    SELECT toString(p1) AS M, toString(p2) AS T,
           toUInt32(round(days/30)) AS months
    FROM (
      SELECT toUInt64(s1.person_id) AS p1, toUInt64(s2.person_id) AS p2,
             sum(greatest(0, dateDiff('day',
               greatest(toDate(s1.start_date), toDate(s2.start_date)),
               least(toDate(ifNull(s1.end_date, today())), toDate(ifNull(s2.end_date, today()))
             )))) AS days
      FROM via_test.stints_compact s1
      INNER JOIN via_test.stints_compact s2
        ON s1.company_id = s2.company_id AND s1.person_id <> s2.person_id
      INNER JOIN Ms ON Ms.mid = s1.person_id
      INNER JOIN Ts ON Ts.tid = s2.person_id
      GROUP BY p1, p2
    )
    WHERE days > 0
  `
  const mtRes = await execCH(mtSql)
  const mtTxt = await mtRes!.text()
  const MT = (mtTxt.trim() ? mtTxt.trim().split('\n').map(l=>JSON.parse(l)) : []) as Array<{ M:string, T:string, months:number }>

  if (MT.length === 0) {
    return { S: String(S), companyId: String(C), icpRegex: regex, Ms: MsLimited, Ts: TsLimited, paths: [], top3: [] }
  }

  // 4) Exact M–T overlap at company C (for overlap_w boost)
  const mtcSql = `
    WITH Ms AS (SELECT arrayJoin([${list(MsLimited)}]) AS mid),
         Ts AS (SELECT arrayJoin([${list(TsLimited)}]) AS tid),
         C AS (SELECT toUInt64(${C}) AS id)
    SELECT toString(p1) AS M, toString(p2) AS T,
           toUInt32(round(days/30)) AS months_c
    FROM (
      SELECT toUInt64(s1.person_id) AS p1, toUInt64(s2.person_id) AS p2,
             sum(greatest(0, dateDiff('day',
               greatest(toDate(s1.start_date), toDate(s2.start_date)),
               least(toDate(ifNull(s1.end_date, today())), toDate(ifNull(s2.end_date, today()))
             )))) AS days
      FROM via_test.stints_compact s1
      INNER JOIN via_test.stints_compact s2
        ON s1.company_id = s2.company_id AND s1.person_id <> s2.person_id
      INNER JOIN Ms ON Ms.mid = s1.person_id
      INNER JOIN Ts ON Ts.tid = s2.person_id
      WHERE s1.company_id = (SELECT id FROM C) AND s2.company_id = (SELECT id FROM C)
      GROUP BY p1, p2
    )
    WHERE days > 0
  `
  const mtcRes = await execCH(mtcSql)
  const mtcTxt = await mtcRes!.text()
  const MTC = (mtcTxt.trim() ? mtcTxt.trim().split('\n').map(l=>JSON.parse(l)) : []) as Array<{ M:string, T:string, months_c:number }>
  const mtcKey = new Map<string, number>()
  for (const r of MTC) mtcKey.set(`${r.M}|${r.T}`, Number(r.months_c||0))

  // Build lookup maps
  const nameSRes = await execCH(`SELECT anyLast(name) AS name FROM via_test.person_profile_current WHERE person_id = toUInt64(${S}) LIMIT 1`)
  const nameSRowTxt = await nameSRes!.text().catch(()=> '')
  const SName = (()=>{ try{ const row = nameSRowTxt.trim().split('\n').filter(Boolean)[0]; return row ? (JSON.parse(row).name as string) : null }catch{return null} })()
  const RSM = new Map<string, number>()
  const MName = new Map<string, string|undefined>()
  for (const m of MsLimited){ RSM.set(String(m.id), Number(m.R_SM||0)); if (m.name) MName.set(String(m.id), m.name||undefined) }
  const TScore = new Map<string, { icp:number, title?:string|null, name?:string|null }>()
  for (const t of TsLimited){ TScore.set(String(t.id), { icp: Number(t.icp||0), title: t.title||null, name: t.name||null }) }

  // Compute path scores; keep small slate
  const pathsRaw: IntroPath[] = []
  for (const e of MT){
    const m = String(e.M), t = String(e.T)
    const Rsm = RSM.get(m) || 0
    const Rmt = clamp01((Number(e.months||0))/60)
    if (Rmt < minRMT) continue
    const icp = TScore.get(t)?.icp || 0
    if (icp <= 0) continue
    const overlapMonthsC = mtcKey.get(`${m}|${t}`) || 0
    const overlapW = 1.0 + Math.min(0.15, (overlapMonthsC||0)/60)
    const p = Rsm * Rmt * icp * overlapW
    pathsRaw.push({
      S: String(S), M: m, T: t,
      names: { S: SName, M: MName.get(m)||null, T: TScore.get(t)?.name||null },
      titles: { M_title: null, T_title: TScore.get(t)?.title || null },
      scores: { R_SM: Rsm, R_MT: Rmt, icp, overlap: overlapW, p }
    })
  }

  // Soft diversification for Top-3
  pathsRaw.sort((a,b)=> b.scores.p - a.scores.p)
  const usedM = new Set<string>()
  const usedT = new Set<string>()
  const diversified: IntroPath[] = []
  for (const row of pathsRaw){
    let p = row.scores.p
    if (usedM.has(row.M)) p *= 0.85
    if (usedT.has(row.T)) p *= 0.85
    diversified.push({ ...row, scores: { ...row.scores, p } })
    usedM.add(row.M); usedT.add(row.T)
  }
  diversified.sort((a,b)=> b.scores.p - a.scores.p)
  const top3 = diversified.slice(0, k)

  return { S: String(S), companyId: String(C), icpRegex: regex, Ms: MsLimited, Ts: TsLimited, paths: diversified, top3 }
}

export async function fetchNearbyExecsAtCompany(params: { T: string|number, companyId: string|number, limit?: number }): Promise<Array<{ person_id:string, title?:string|null, seniority?:string|null, months_overlap:number }>>{
  const T = String(params.T).replace(/^person:/i,'')
  const C = String(params.companyId).replace(/^company:/i,'')
  const limit = Math.max(1, Math.min(12, params.limit ?? 5))
  const sql = `
    WITH my AS (
      SELECT toDate(start_date) AS s, toDate(ifNull(end_date, today())) AS e
      FROM via_test.stints_compact
      WHERE person_id = toUInt64(${T}) AND company_id = toUInt64(${C})
    )
    SELECT person_id, title, seniority, months_overlap
    FROM (
      SELECT toString(s.person_id) AS person_id,
             anyLast(pp.current_title) AS title,
             NULL AS seniority,
             toUInt32(round(sum(greatest(0, dateDiff('day', greatest(toDate(s.start_date), anyLast(my.s)), least(toDate(ifNull(s.end_date, today())), anyLast(my.e)) )))/30)) AS months_overlap
      FROM via_test.stints_compact s
      LEFT JOIN via_test.person_profile_current pp ON pp.person_id = s.person_id
      INNER JOIN my ON s.company_id = toUInt64(${C})
      WHERE s.company_id = toUInt64(${C})
        AND toUInt64(s.person_id) <> toUInt64(${T})
      GROUP BY s.person_id
    )
    WHERE match(lower(coalesce(title, '')), 'vp|director|chief|cxo|head|head of')
    ORDER BY months_overlap DESC, title ASC
    LIMIT ${limit}
  `
  const res = await execCH(sql)
  const txt = await res!.text()
  const rows = txt.trim() ? txt.trim().split('\n').map(l=>JSON.parse(l)) as Array<{ person_id:string, title?:string|null, seniority?:string|null, months_overlap:number }> : []
  return rows
}

export type NetworkFilterResult = {
  total: number
  matched: number
  share: number
  first: Array<{ id: string, name?: string|null, title?: string|null, overlap_months: number }>
  second: Array<{ id: string, name?: string|null, title?: string|null, overlap_months: number, first_id: string }>
}

// General network filter by role/title regex around a person S
export async function fetchNetworkByFilter(params: { S: string|number, roleRegex?: string, minOverlapMonths?: number, limitFirst?: number, limitSecond?: number, minSecondMonths?: number }): Promise<NetworkFilterResult> {
  const S = String(params.S).replace(/^person:/i, '')
  const minOverlapMonths = Math.max(1, Number(params.minOverlapMonths) || 24)
  const minSecondMonths = Math.max(1, Number(params.minSecondMonths) || 24)
  const limitFirst = Math.max(1, Math.min(300, Number(params.limitFirst) || 80))
  const limitSecond = Math.max(1, Math.min(600, Number(params.limitSecond) || 180))
  const pattern = safeRegex(params.roleRegex || '') || 'engineer|software|developer|swe|devops|sre|ml engineer|data engineer|platform engineer|frontend|backend|full stack|tech lead|technical'

  const statsSql = `
    WITH
      my AS (
        SELECT company_id, start_date, end_date
        FROM via_test.stints_compact
        WHERE person_id = toUInt64(${S})
      ),
      neighbors AS (
        SELECT
          toUInt64(s.person_id) AS M,
          sum(greatest(0, dateDiff(
            'day',
            greatest(toDate(s.start_date), toDate(m.start_date)),
            least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today())))
          ))) AS days
        FROM via_test.stints_compact s
        INNER JOIN my m USING (company_id)
        WHERE toUInt64(s.person_id) <> toUInt64(${S})
        GROUP BY M
        HAVING days >= ${minOverlapMonths * 30}
      )
    SELECT
      count() AS total,
      countIf(match(lower(coalesce(pp.current_title, '')), '${pattern}')) AS matched,
      round(matched / nullIf(total, 0), 4) AS share
    FROM neighbors n
    LEFT JOIN via_test.person_profile_current pp ON pp.person_id = n.M
  `

  let total = 0, matched = 0, share = 0
  try {
    const res = await execCH(statsSql)
    if (res && res.ok) {
      const txt = await res.text()
      const line = txt.trim().split('\n').filter(Boolean)[0]
      if (line) { const row = JSON.parse(line); total = Number(row.total||0); matched = Number(row.matched||0); share = Number(row.share||0) }
    }
  } catch {}

  const l1Sql = `
    WITH
      my AS (
        SELECT company_id, start_date, end_date
        FROM via_test.stints_compact
        WHERE person_id = toUInt64(${S})
      ),
      neighbors AS (
        SELECT
          toUInt64(s.person_id) AS M,
          sum(greatest(0, dateDiff(
            'day',
            greatest(toDate(s.start_date), toDate(m.start_date)),
            least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today())))
          ))) AS days
        FROM via_test.stints_compact s
        INNER JOIN my m USING (company_id)
        WHERE toUInt64(s.person_id) <> toUInt64(${S})
        GROUP BY M
        HAVING days >= ${minOverlapMonths * 30}
      )
    SELECT id, name, title, overlap_months
    FROM (
      SELECT
        toString(n.M) AS id,
        toUInt32(round(n.days/30)) AS overlap_months,
        anyLast(pp.name) AS name,
        anyLast(pp.current_title) AS title
      FROM neighbors n
      LEFT JOIN via_test.person_profile_current pp ON pp.person_id = n.M
      GROUP BY id, overlap_months
    )
    WHERE match(lower(coalesce(title,'')), '${pattern}')
    ORDER BY overlap_months DESC, title ASC
    LIMIT ${limitFirst}
  `
  const first: NetworkFilterResult['first'] = []
  try {
    const res = await execCH(l1Sql)
    if (res && res.ok) {
      const txt = await res.text()
      const lines = txt.trim() ? txt.trim().split('\n') : []
      for (const line of lines) { try { const r = JSON.parse(line); first.push({ id: String(r.id), name: r.name||null, title: r.title||null, overlap_months: Number(r.overlap_months||0) }) } catch {} }
    }
  } catch {}

  const l2Sql = `
    WITH
      my AS (
        SELECT company_id, start_date, end_date
        FROM via_test.stints_compact
        WHERE person_id = toUInt64(${S})
      ),
      neighbors AS (
        SELECT
          toUInt64(s.person_id) AS M,
          sum(greatest(0, dateDiff(
            'day',
            greatest(toDate(s.start_date), toDate(m.start_date)),
            least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today())))
          ))) AS days
        FROM via_test.stints_compact s
        INNER JOIN my m USING (company_id)
        WHERE toUInt64(s.person_id) <> toUInt64(${S})
        GROUP BY M
        HAVING days >= ${minOverlapMonths * 30}
      ),
      l1 AS (
        SELECT toUInt64(id) AS id
        FROM (
          SELECT toString(n.M) AS id, toUInt32(round(n.days/30)) AS overlap_months, anyLast(pp.current_title) AS title
          FROM neighbors n
          LEFT JOIN via_test.person_profile_current pp ON pp.person_id = n.M
          GROUP BY id, overlap_months
        )
        WHERE match(lower(coalesce(title,'')), '${pattern}')
        ORDER BY overlap_months DESC, title ASC
        LIMIT ${limitFirst}
      ),
      pairs_raw AS (
        SELECT toUInt64(s1.person_id) AS first_id,
               toUInt64(s2.person_id) AS sec_id,
               sum(greatest(0, dateDiff('day',
                 greatest(toDate(s1.start_date), toDate(s2.start_date)),
                 least(toDate(ifNull(s1.end_date, today())), toDate(ifNull(s2.end_date, today())))
               ))) AS days
        FROM via_test.stints_compact s1
        INNER JOIN via_test.stints_compact s2 ON s1.company_id = s2.company_id AND s1.person_id <> s2.person_id
        WHERE s1.person_id IN (SELECT id FROM l1)
          AND toUInt64(s2.person_id) <> toUInt64(${S})
          AND toUInt64(s2.person_id) NOT IN (SELECT id FROM l1)
        GROUP BY first_id, sec_id
        HAVING days >= ${minSecondMonths * 30}
      ),
      best AS (
        SELECT first_id, sec_id, days
        FROM pairs_raw
        ORDER BY days DESC
        LIMIT 1 BY sec_id
        LIMIT ${limitSecond}
      )
    SELECT id, name, title, overlap_months, first_id
    FROM (
      SELECT toString(b.sec_id) AS id,
             toString(b.first_id) AS first_id,
             toUInt32(round(b.days/30)) AS overlap_months,
             anyLast(pp.name) AS name,
             anyLast(pp.current_title) AS title
      FROM best b
      LEFT JOIN via_test.person_profile_current pp ON pp.person_id = b.sec_id
      GROUP BY id, first_id, overlap_months
    )
    WHERE match(lower(coalesce(title,'')), '${pattern}')
    ORDER BY overlap_months DESC, title ASC
  `

  const second: NetworkFilterResult['second'] = []
  try {
    const res = await execCH(l2Sql)
    if (res && res.ok) {
      const txt = await res.text()
      const lines = txt.trim() ? txt.trim().split('\n') : []
      for (const line of lines) { try { const r = JSON.parse(line); second.push({ id: String(r.id), name: r.name||null, title: r.title||null, overlap_months: Number(r.overlap_months||0), first_id: String(r.first_id) }) } catch {} }
    }
  } catch {}

  return { total, matched, share, first, second }
}

export type NetworkEngineerStats = {
  total_neighbors: number
  engineers: number
  engineer_share: number
  top_engineers: Array<{
    id: string
    name?: string | null
    title?: string | null
    overlap_months: number
  }>
}

export async function fetchNetworkEngineers(params: { S: string|number, minOverlapMonths?: number, limit?: number }): Promise<NetworkEngineerStats> {
  const S = String(params.S).replace(/^person:/i, '')
  const minOverlapMonths = Math.max(6, Number(params.minOverlapMonths) || 24)
  const limit = Math.max(10, Math.min(100, Number(params.limit) || 50))
  
  // Use work overlap to find neighbors
  const sql = `
    WITH
      my AS (
        SELECT company_id, start_date, end_date
        FROM via_test.stints_compact
        WHERE person_id = ${S}
      ),
      neighbors AS (
        SELECT
          s.person_id AS M,
          sum(greatest(0, dateDiff(
            'day',
            greatest(toDate(s.start_date), toDate(m.start_date)),
            least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today())))
          ))) AS days
        FROM via_test.stints_compact s
        INNER JOIN my m USING (company_id)
        WHERE s.person_id <> ${S}
        GROUP BY M
        HAVING days >= ${minOverlapMonths * 30}
      )
    SELECT
      count() AS total_neighbors,
      countIf(match(lower(coalesce(pp.current_title, '')), 'engineer|software|developer|swe|devops|sre|ml engineer|data engineer|platform engineer|frontend|backend|full stack|tech lead|technical')) AS engineers,
      round(engineers / nullIf(total_neighbors, 0), 4) AS engineer_share
    FROM neighbors n
    LEFT JOIN via_test.person_profile_current pp ON pp.person_id = n.M
  `
  
  const res = await execCH(sql)
  if (!res || !res.ok) return { total_neighbors: 0, engineers: 0, engineer_share: 0, top_engineers: [] }
  
  const txt = await res.text()
  const lines = txt.trim() ? txt.trim().split('\n') : []
  let stats = { total_neighbors: 0, engineers: 0, engineer_share: 0 }
  
  for (const line of lines) {
    try {
      const row = JSON.parse(line)
      stats = {
        total_neighbors: Number(row.total_neighbors || 0),
        engineers: Number(row.engineers || 0),
        engineer_share: Number(row.engineer_share || 0)
      }
    } catch {}
  }
  
  // Get top engineers by overlap
  const topSql = `
    WITH
      my AS (
        SELECT company_id, start_date, end_date
        FROM via_test.stints_compact
        WHERE person_id = ${S}
      ),
      neighbors AS (
        SELECT
          s.person_id AS M,
          sum(greatest(0, dateDiff(
            'day',
            greatest(toDate(s.start_date), toDate(m.start_date)),
            least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today())))
          ))) AS days
        FROM via_test.stints_compact s
        INNER JOIN my m USING (company_id)
        WHERE s.person_id <> ${S}
        GROUP BY M
        HAVING days >= ${minOverlapMonths * 30}
      )
    SELECT
      toString(n.M) AS id,
      anyLast(pp.name) AS name,
      anyLast(pp.current_title) AS title,
      toUInt32(round(n.days/30)) AS overlap_months
    FROM neighbors n
    LEFT JOIN via_test.person_profile_current pp ON pp.person_id = n.M
    WHERE match(lower(coalesce(pp.current_title,'')), 'engineer|software|developer|swe|devops|sre|ml engineer|data engineer|platform engineer|frontend|backend|full stack|tech lead|technical')
    ORDER BY overlap_months DESC, title ASC
    LIMIT ${limit}
  `
  
  const topRes = await execCH(topSql)
  const top_engineers: NetworkEngineerStats['top_engineers'] = []
  
  if (topRes && topRes.ok) {
    const topTxt = await topRes.text()
    const topLines = topTxt.trim() ? topTxt.trim().split('\n') : []
    for (const line of topLines) {
      try {
        const row = JSON.parse(line)
        if (row?.id) {
          top_engineers.push({
            id: String(row.id),
            name: row.name || null,
            title: row.title || null,
            overlap_months: Number(row.overlap_months || 0)
          })
        }
      } catch {}
    }
  }
  
  return { ...stats, top_engineers }
}
