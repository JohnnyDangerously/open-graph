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
async function execCH(sql: string){
  const url = `${BASE}/?default_format=JSONEachRow`
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', ...authHeaders() }, body: sql })
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

async function asJSON(r: Response){
  const ct = r.headers.get('content-type') || ''
  const txt = await r.text()
  if (!ct.includes('application/json')) throw new Error(`Expected JSON at ${r.url}; got ${ct}: ${ct}\n${txt.slice(0,120)}`)
  return JSON.parse(txt)
}

export async function healthz(){ return asJSON(await fetch(`${BASE}/healthz`, { mode:'cors', headers: { ...authHeaders() } })) }

export async function resolvePerson(q: string){
  const base = getApiBase()
  // If already in canonical form
  if (/^person:\d+$/i.test(q.trim())) return q.trim()
  // LinkedIn URL
  if (/linkedin\.com\/in\//i.test(q)){
    const raw = q.trim()
    // Extract slug between /in/ and next '/' or '?' and lowercase it
    const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(raw)
    const slug = m ? decodeURIComponent(m[1]).replace(/\/$/,'') : ''
    if (slug) {
      // Try a robust case-insensitive contains match so stored variants still match
      const sql1 = `SELECT toString(person_id_64) AS id
                    FROM via_test.persons_large
                    WHERE positionCaseInsensitive(linkedin, '/in/${slug.replace(/'/g,"''")}') > 0
                    ORDER BY connections DESC
                    LIMIT 1`
      const r1 = await fetch(`${base}/?query=${encodeURIComponent(sql1)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })
      const t1 = await r1.text(); const row1 = t1.trim().split('\n').filter(Boolean)[0]
      if (row1){ const j = JSON.parse(row1); return `person:${j.id}` }
      // Fallback: try exact normal forms
      const variants = [
        `https://linkedin.com/in/${slug}`,
        `https://www.linkedin.com/in/${slug}`,
        `http://linkedin.com/in/${slug}`,
        `http://www.linkedin.com/in/${slug}`,
        `https://linkedin.com/in/${slug}/`,
        `https://www.linkedin.com/in/${slug}/`
      ]
      const inList = variants.map(v=>`'${v.replace(/'/g,"''")}'`).join(',')
      const sql2 = `SELECT toString(person_id_64) AS id FROM via_test.persons_large WHERE linkedin IN (${inList}) LIMIT 1`
      const r2 = await fetch(`${base}/?query=${encodeURIComponent(sql2)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })
      const t2 = await r2.text(); const row2 = t2.trim().split('\n').filter(Boolean)[0]
      if (row2){ const j = JSON.parse(row2); return `person:${j.id}` }
    } else {
      // last resort: try raw equality
      const url = `${base}/?query=${encodeURIComponent(`SELECT toString(person_id_64) AS id FROM via_test.persons_large WHERE linkedin = '${raw.replace(/'/g,"''")}' LIMIT 1`)}&default_format=JSONEachRow`
      const r = await fetch(url, { headers: { ...authHeaders() } })
      const t = await r.text()
      const row = t.trim().split('\n').filter(Boolean)[0]
      if (row){ const j = JSON.parse(row); return `person:${j.id}` }
    }
  }
  // Name search (prefer people with at least 2 stints so ego isn't empty)
  const name = q.trim()
  const sql = `
    WITH cand AS (
      SELECT person_id_64 AS id, connections
      FROM via_test.persons_large
      WHERE positionCaseInsensitive(name, '${name.replace(/'/g,"''")}') > 0
      ORDER BY connections DESC
      LIMIT 200
    ), agg AS (
      SELECT s.person_id AS id, count() AS stint_count
      FROM via_test.stints_large s
      WHERE s.person_id IN (SELECT id FROM cand)
      GROUP BY s.person_id
      HAVING stint_count >= 2
      ORDER BY stint_count DESC
      LIMIT 1
    )
    SELECT toString(id) AS id FROM agg`
  const url = `${base}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`
  const r = await fetch(url, { headers: { ...authHeaders() } })
  const t = await r.text()
  const row = t.trim().split('\n').filter(Boolean)[0]
  if (row){ const j = JSON.parse(row); return `person:${j.id}` }
  return null as any
}
export async function resolveCompany(q: string){
  const base = getApiBase()
  const s = q.trim()
  // Always return the canonical UInt64 id to avoid mismatches with stints.company_id
  const execId64 = async (whereClause: string) => {
    const sql = `SELECT toString(company_id_64) AS id FROM via_test.companies_large WHERE ${whereClause} ORDER BY employee_count DESC LIMIT 1`
    const r = await fetch(`${base}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })
    const t = await r.text(); const row = t.trim().split('\n').filter(Boolean)[0]
    if (!row) return null as any
    try { const j = JSON.parse(row); if (j && (j.id != null)) return `company:${j.id}` } catch {}
    return null as any
  }
  // Normalize potential URL or domain
  const toDomain = (inp: string) => {
    let v = inp.trim()
    try {
      if (/^https?:\/\//i.test(v)) {
        const m = /^(?:https?:\/\/)?([^\/]+)/i.exec(v)
        v = m ? m[1] : v
      }
    } catch {}
    v = v.replace(/^www\./i, '')
    return v.toLowerCase()
  }
  const isDomainLike = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) || /^https?:\/\//i.test(s)
  if (isDomainLike){
    const bare = toDomain(s)
    const variants = Array.from(new Set([bare, `www.${bare}`]))
    const inList = variants.map(v=>`'${v.replace(/'/g,"''")}'`).join(',')
    // 1) Exact domain match with common www variants
    const exact = await execId64(`domain IN (${inList})`); if (exact) return exact
    // 2) Contains match on domain field
    const contains = await execId64(`positionCaseInsensitive(domain, '${bare.replace(/'/g,"''")}') > 0`); if (contains) return contains
    // 3) Fallback to name using the registrable label (e.g. google from google.com)
    const label = bare.split('.')[0]
    if (label && label.length >= 3){
      const nameByLabel = await execId64(`positionCaseInsensitive(name, '${label.replace(/'/g,"''")}') > 0`); if (nameByLabel) return nameByLabel
    }
  }
  // name search (general)
  const byName = await execId64(`positionCaseInsensitive(name, '${s.replace(/'/g,"''")}') > 0`); if (byName) return byName
  return null
}

export async function fetchEgoJSON(id: string, limit=1500){
  const isCo = id.startsWith('company:')
  const key = id.replace(/^company:|^person:/,'')
  const param = isCo ? 'company_id' : 'person_id'
  const r = await fetch(`${BASE}/graph/ego?${param}=${encodeURIComponent(key)}&limit=${limit}&format=json`, { headers: { ...authHeaders() } })
  if (!r.ok) throw new Error(`ego json ${r.status}`)
  return asJSON(r)
}
export async function fetchEgoFastJSON(id: string, limit=1500){
  const isCo = id.startsWith('company:')
  const key = id.replace(/^company:|^person:/,'')
  const param = isCo ? 'company_id' : 'person_id'
  const r = await fetch(`${BASE}/graph/ego_fast?${param}=${encodeURIComponent(key)}&limit=${limit}&format=json`, { headers: { ...authHeaders() } })
  if (!r.ok) throw new Error(`ego_fast json ${r.status}`)
  return asJSON(r)
}
export async function fetchEgoBinary(id: string, limit=1500){
  const isCo = id.startsWith('company:')
  const key = id.replace(/^company:|^person:/,'')
  
  if (isCo) {
    throw new Error('Company ego graphs not implemented for ClickHouse test DB')
  }
  
  const runBinary = async (use64: boolean) => {
    const col = use64 ? 'person_id_64' : 'person_id'
    const sql = `
      WITH my AS (
        SELECT DISTINCT company_id FROM via_test.stints_large WHERE ${col} = toUInt64(${key})
      )
      SELECT toString(s.${col}) AS neighbor_id_str,
             COUNT(*) AS w,
             anyLast(p.name) AS name
      FROM via_test.stints_large s
      INNER JOIN my USING (company_id)
      LEFT JOIN via_test.persons_large p ON p.person_id_64 = s.${col}
      WHERE s.${col} <> toUInt64(${key})
      GROUP BY s.${col}
      ORDER BY w DESC
      LIMIT ${Math.min(limit, 1000)}
    `
    const url = `${BASE}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`
    const res = await fetch(url);
    return res
  }

  try {
    let res = await runBinary(true)
    if (!res.ok) {
      // retry with non-_64 schema
      res = await runBinary(false)
    }
    if (!res.ok) { const msg = await res.text().catch(()=>"" as any); throw new Error(`fetch failed ${res.status}: ${msg.slice(0,200)}`) };
    const text = await res.text();
    
    // Handle empty response
    if (!text.trim()) {
      console.log('No coworkers found for person_id:', key);
      // Return single node (just the person themselves)
      const count = 1;
      const headerSize = 16;
      const nodesSize = count * 2 * 4; // 2 floats per node * 4 bytes per float
      const groupSize = count * 2; // 1 uint16 per node * 2 bytes per uint16
      const flagsSize = count * 1; // 1 uint8 per node * 1 byte per uint8
      const totalSize = headerSize + nodesSize + groupSize + flagsSize;
      
      console.log(`Creating single node buffer: count=${count}, totalSize=${totalSize}`);
      
      const buf = new ArrayBuffer(totalSize);
      const dv = new DataView(buf);
      dv.setInt32(0, count, true);
      dv.setInt32(4, 2, true); // dimensions
      dv.setInt32(8, nodesSize, true); // group offset
      dv.setInt32(12, nodesSize + groupSize, true); // flags offset
      
      // Set node position (center)
      const nodesView = new Float32Array(buf, headerSize, count * 2);
      nodesView[0] = 0; nodesView[1] = 0;
      
      // Set group
      const groupView = new Uint16Array(buf, headerSize + nodesSize, count);
      groupView[0] = 0;
      
      // Set flags
      const flagsView = new Uint8Array(buf, headerSize + nodesSize + groupSize, count);
      flagsView[0] = 0;
      
      // Build minimal meta for center only
      let centerName = 'Center'
      try {
        const centerSQL = `SELECT name FROM via_test.persons_large WHERE person_id_64 = toUInt64(${key}) LIMIT 1`
        const centerRes = await fetch(`${BASE}/?query=${encodeURIComponent(centerSQL)}&default_format=JSONEachRow`)
        const centerText = await centerRes.text()
        centerName = centerText.trim() ? JSON.parse(centerText.trim().split('\n')[0]).name : 'Center'
      } catch {}
      return { buf, meta: { nodes: [{ id: String(key), name: centerName }] }, labels: [centerName] } as any;
    }
    
    const lines = text.trim().split('\n').filter(line => line.trim());
    const neighbors: Array<{ neighbor_id_str: string; w: number; name?: string }> = lines.map(line => JSON.parse(line));
    console.log(`Found ${neighbors.length} coworkers for person_id:`, key);
 
    // Generate simple concentric layout
    const count = Math.min(1 + neighbors.length, 1500); // Cap at reasonable size
    const rings = Math.min(3, Math.ceil(Math.sqrt(count / 10)));
    const nodes = new Float32Array(count * 2);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    const group = new Uint16Array(count);
    const flags = new Uint8Array(count);
 
    // Central node (the queried person) - make it larger and orange
    nodes[0] = 0;
    nodes[1] = 0;
    size[0] = 24; // Double the size from 12 to 24
    alpha[0] = 1.0;
    group[0] = 0;
    flags[0] = 0;
 
    // Place neighbors in concentric rings - use People Network coordinate system
    let idx = 1;
    for (let r = 0; r < rings && idx < count; r++) {
      const nodesInRing = Math.ceil((count - 1) / rings);
      const radius = 120 + r * 180; // People Network scale: 120, 300, 480 pixels
      
      for (let k = 0; k < nodesInRing && idx < count; k++, idx++) {
        const angle = (k / nodesInRing) * Math.PI * 2;
        const jitterX = (Math.random() * 2 - 1) * 40; // People Network scale jitter
        const jitterY = (Math.random() * 2 - 1) * 40;
        
        nodes[idx * 2] = Math.cos(angle) * radius + jitterX;
        nodes[idx * 2 + 1] = Math.sin(angle) * radius + jitterY;
        size[idx] = 7.0; // Keep our doubled size
        alpha[idx] = 0.9;
        group[idx] = 0;
        flags[idx] = 0;
        
        // Debug: log first few node positions
        if (idx <= 5) {
          console.log(`Node ${idx}: x=${nodes[idx * 2].toFixed(1)}, y=${nodes[idx * 2 + 1].toFixed(1)}, ring=${r}, radius=${radius}`);
        }
      }
    }
 
    // Generate edges connecting center to all neighbors
    const edgeCount = count - 1; // Connect center to each neighbor
    const edges = new Uint32Array(edgeCount * 2);
    for (let i = 1; i < count; i++) {
      edges[(i-1) * 2] = 0; // Center node index
      edges[(i-1) * 2 + 1] = i; // Neighbor node index
    }
 
    // Create buffer with proper size validation including edges
    const headerSize = 16;
    const nodesSize = nodes.byteLength;
    const groupSize = group.byteLength;
    const flagsSize = flags.byteLength;
    const edgesSize = edges.byteLength;
    const edgesOff = headerSize + nodesSize + groupSize + flagsSize;
    const edgesOffAligned = (edgesOff + 3) & ~3; // 4-byte alignment for Uint32
    const padBytes = edgesOffAligned - edgesOff;
    const totalSize = edgesOffAligned + edgesSize;
    
    console.log(`Creating buffer: count=${count}, edges=${edgeCount}, totalSize=${totalSize}`);
    
    const buf = new ArrayBuffer(totalSize);
    const dv = new DataView(buf);
    dv.setInt32(0, count, true);
    dv.setInt32(4, 2, true); // dimensions
    dv.setInt32(8, nodesSize, true); // group offset
    dv.setInt32(12, nodesSize + groupSize, true); // flags offset
    
    new Float32Array(buf, headerSize, count * 2).set(nodes);
    new Uint16Array(buf, headerSize + nodesSize, count).set(group);
    new Uint8Array(buf, headerSize + nodesSize + groupSize, count).set(flags);
    if (padBytes) { new Uint8Array(buf, headerSize + nodesSize + groupSize + flagsSize, padBytes).fill(0); }
    new Uint32Array(buf, edgesOffAligned, edgeCount * 2).set(edges);

    // Build meta nodes: center + neighbors (emit ids as strings for UI)
    let centerName = 'Center'
    try {
      const centerSQL = `SELECT name FROM via_test.persons_large WHERE person_id_64 = toUInt64(${key}) LIMIT 1`
      const centerRes = await fetch(`${BASE}/?query=${encodeURIComponent(centerSQL)}&default_format=JSONEachRow`)
      const centerText = await centerRes.text()
      centerName = centerText.trim() ? JSON.parse(centerText.trim().split('\n')[0]).name : 'Center'
    } catch {}

    const metaNodes = [ { id: String(key), name: centerName } as any ]
    const labels = [ centerName ]
    for (let i=0;i<neighbors.length && i<edgeCount;i++){
      const n = neighbors[i]
      const nid = n.neighbor_id_str
      metaNodes.push({ id: nid, name: n.name })
      labels.push(n.name || nid)
    }

    return { buf, meta: { nodes: metaNodes }, labels } as any;
  } catch (error: any) {
    console.error('Error fetching ego graph:', error);
    throw new Error(`Failed to fetch graph data: ${error.message}`);
  }
}

// Lightweight JSON builder that mirrors People Network needs (coords + edges + weights)
export async function fetchEgoClientJSON(id: string, limit = 1500){
  const isCo = id.startsWith('company:')
  const key = id.replace(/^company:|^person:/,'')
  if (isCo) { throw new Error('Company ego graphs not implemented for ClickHouse test DB') }
  let effectiveKey = key
  let triedNameFallback = false

  // Overlap-in-time coworkers on same company; weight = overlap days
  const buildOverlapSQL = (personKey: string, use64: boolean, minDays: number) => `
    WITH my AS (
      SELECT company_id, start_date, end_date
      FROM via_test.stints_large
      WHERE ${use64 ? 'person_id_64' : 'person_id'} = toUInt64(${personKey})
    ), agg AS (
      SELECT
        toUInt64(s.${use64 ? 'person_id_64' : 'person_id'}) AS neighbor_id,
        sum(greatest(0, dateDiff('day',
              greatest(toDate(s.start_date), toDate(m.start_date)),
              least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today())))
        ))) AS overlap_days
      FROM via_test.stints_large s
      INNER JOIN my m USING (company_id)
      WHERE toUInt64(s.${use64 ? 'person_id_64' : 'person_id'}) <> toUInt64(${personKey})
      GROUP BY toUInt64(s.${use64 ? 'person_id_64' : 'person_id'})
      HAVING overlap_days >= ${Math.max(1, Math.floor(minDays))}
      ORDER BY overlap_days DESC
      LIMIT ${Math.min(limit, 1000)}
    )
    SELECT
      toString(a.neighbor_id) AS id,
      a.overlap_days AS w,
      anyLast(p.name) AS name
    FROM agg a
    LEFT JOIN via_test.persons_large p ON p.person_id_64 = a.neighbor_id
    GROUP BY id, w
  `
  const executeNeighbors = async (personKey: string, minDays: number) => {
    let sql = buildOverlapSQL(personKey, true, minDays)
    console.log('fetchEgoClientJSON: Executing SQL (POST):', sql)
    let res = await execCH(sql)
    if (!res.ok) {
      // Try non-_64 variant
      sql = buildOverlapSQL(personKey, false, minDays)
      console.log('fetchEgoClientJSON: Retrying with person_id (non _64, POST):', sql)
      res = await execCH(sql)
    }
    if (!res.ok) { const msg = await res.text().catch(()=>"" as any); throw new Error(`fetch failed ${res.status}: ${msg.slice(0,200)}`) }
    const text = await res.text()
    const lines = text.trim() ? text.trim().split('\n').filter(Boolean) : []
    return lines.map(line => JSON.parse(line)) as Array<{id:number; w:number; name:string}>
  }
  
  // First-degree: >= 24 months (720 days)
  let neighbors = await executeNeighbors(effectiveKey, 720)
  console.log(`fetchEgoClientJSON: Found ${neighbors.length} first-degree neighbors (>=24m) for key ${effectiveKey}`)

  // Relaxed fallback if empty: coworkers by company (no time overlap), weight=count(*)
  if (neighbors.length === 0) {
    const buildCoworkersSQL = (personKey: string, use64: boolean) => `
      WITH my AS (
        SELECT DISTINCT company_id FROM via_test.stints_large WHERE ${use64 ? 'person_id_64' : 'person_id'} = toUInt64(${personKey})
      )
      SELECT toString(toUInt64(s.${use64 ? 'person_id_64' : 'person_id'})) AS id, count() AS w, anyLast(p.name) AS name
      FROM via_test.stints_large s
      INNER JOIN my USING (company_id)
      LEFT JOIN via_test.persons_large p ON p.person_id_64 = s.${use64 ? 'person_id_64' : 'person_id'}
      WHERE toUInt64(s.${use64 ? 'person_id_64' : 'person_id'}) <> toUInt64(${personKey})
      GROUP BY toUInt64(s.${use64 ? 'person_id_64' : 'person_id'})
      ORDER BY w DESC
      LIMIT ${Math.min(limit, 600)}
    `
    let sql2 = buildCoworkersSQL(effectiveKey, true)
    console.log('fetchEgoClientJSON: Fallback SQL (no time-overlap, POST):', sql2)
    let res2 = await execCH(sql2)
    if (!res2.ok) {
      sql2 = buildCoworkersSQL(effectiveKey, false)
      console.log('fetchEgoClientJSON: Fallback retry with person_id (POST):', sql2)
      res2 = await execCH(sql2)
    }
    if (res2.ok) {
      const text2 = await res2.text()
      const lines2 = text2.trim() ? text2.trim().split('\n').filter(Boolean) : []
      neighbors = lines2.map(l=>JSON.parse(l))
      console.log(`fetchEgoClientJSON: Fallback found ${neighbors.length} neighbors for key ${effectiveKey}`)
    }
  }

  // Name-based surrogate fallback: find a person with similar name who has stints
  let centerName = 'Center'
  let centerTitle: string | null = null
  try {
    const centerSQL = `
      SELECT anyLast(p.name) AS name
      FROM via_test.persons_large p
      WHERE p.person_id_64 = toUInt64(${effectiveKey})
      LIMIT 1`
    const centerRes = await fetch(`${BASE}/?query=${encodeURIComponent(centerSQL)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })
    const centerText = await centerRes.text()
    if (centerText.trim()) {
      const row = JSON.parse(centerText.trim().split('\n')[0])
      centerName = row?.name || 'Center'
      centerTitle = null
    }
  } catch {}

  if (neighbors.length === 0 && !triedNameFallback && centerName && centerName.length >= 3) {
    triedNameFallback = true
    const altSql = `
      WITH cand AS (
        SELECT p.person_id_64 AS id, count() AS c
        FROM via_test.persons_large p
        JOIN via_test.stints_large s ON s.person_id_64 = p.person_id_64
        WHERE positionCaseInsensitive(p.name, '${centerName.replace(/'/g,"''")}') > 0
        GROUP BY p.person_id_64
        ORDER BY c DESC
        LIMIT 1
      )
      SELECT toString(id) AS id FROM cand`
    const altRes = await execCH(altSql)
    const altTxt = await altRes.text(); const altRow = altTxt.trim().split('\n').filter(Boolean)[0]
    if (altRow) {
      const alt = JSON.parse(altRow).id as string
      if (alt && alt !== effectiveKey) {
        console.log('fetchEgoClientJSON: Using name-based surrogate id:', alt, 'for', centerName)
        effectiveKey = alt
        neighbors = await executeNeighbors(effectiveKey, 720)
        if (neighbors.length === 0) {
          // also try relaxed on surrogate
          const sql2b = `
            WITH my AS (
              SELECT DISTINCT company_id FROM via_test.stints_large WHERE person_id_64 = toUInt64(${effectiveKey})
            )
            SELECT s.person_id_64 AS id, count() AS w, anyLast(p.name) AS name
            FROM via_test.stints_large s
            INNER JOIN my USING (company_id)
            LEFT JOIN via_test.persons_large p ON p.person_id_64 = s.person_id_64
            WHERE s.person_id_64 <> toUInt64(${effectiveKey})
            GROUP BY s.person_id_64
            ORDER BY w DESC
            LIMIT ${Math.min(limit, 600)}
          `
          const r2b = await execCH(sql2b)
          if (r2b.ok) {
            const t2b = await r2b.text()
            const l2b = t2b.trim() ? t2b.trim().split('\n').filter(Boolean) : []
            neighbors = l2b.map(l=>JSON.parse(l))
          }
        }
      }
    }
  }
  // SECOND-DEGREE: >= 36 months (1080 days) from any first-degree, excluding center and first-degree set
  const buildSecondDegreeSQL = (personKey: string, use64: boolean, minDaysFirst: number, minDaysSecond: number, secLimit: number) => `
    WITH
      my AS (
        SELECT company_id, start_date, end_date
        FROM via_test.stints_large
        WHERE ${use64 ? 'person_id_64' : 'person_id'} = toUInt64(${personKey})
      ),
      agg_first AS (
        SELECT
          toUInt64(s.${use64 ? 'person_id_64' : 'person_id'}) AS neighbor_id,
          sum(greatest(0, dateDiff('day',
                greatest(toDate(s.start_date), toDate(m.start_date)),
                least(toDate(ifNull(s.end_date, today())), toDate(ifNull(m.end_date, today()))
          )))) AS overlap_days
        FROM via_test.stints_large s
        INNER JOIN my m USING (company_id)
        WHERE toUInt64(s.${use64 ? 'person_id_64' : 'person_id'}) <> toUInt64(${personKey})
        GROUP BY toUInt64(s.${use64 ? 'person_id_64' : 'person_id'})
        HAVING overlap_days >= ${Math.max(1, Math.floor(minDaysFirst))}
      ),
      pairs_raw AS (
        SELECT
          toUInt64(s1.${use64 ? 'person_id_64' : 'person_id'}) AS first_id,
          toUInt64(s2.${use64 ? 'person_id_64' : 'person_id'}) AS sec_id,
          sum(greatest(0, dateDiff('day',
                greatest(toDate(s1.start_date), toDate(s2.start_date)),
                least(toDate(ifNull(s1.end_date, today())), toDate(ifNull(s2.end_date, today()))
          )))) AS days
        FROM via_test.stints_large s1
        INNER JOIN via_test.stints_large s2 ON s1.company_id = s2.company_id
        WHERE toUInt64(s1.${use64 ? 'person_id_64' : 'person_id'}) IN (SELECT neighbor_id FROM agg_first)
          AND toUInt64(s2.${use64 ? 'person_id_64' : 'person_id'}) NOT IN (SELECT neighbor_id FROM agg_first)
          AND toUInt64(s2.${use64 ? 'person_id_64' : 'person_id'}) <> toUInt64(${personKey})
        GROUP BY first_id, sec_id
        HAVING days >= ${Math.max(1, Math.floor(minDaysSecond))}
      ),
      best AS (
        SELECT first_id, sec_id, days
        FROM pairs_raw
        ORDER BY days DESC
        LIMIT 1 BY sec_id
        LIMIT ${Math.max(0, Math.min(secLimit, 1200))}
      )
    SELECT toString(b.sec_id) AS id, b.days AS w, toString(b.first_id) AS first_id,
           anyLast(p.name) AS name
    FROM best b
    LEFT JOIN via_test.persons_large p ON p.person_id_64 = b.sec_id
    GROUP BY id, w, first_id
  `

  const executeSecondNeighbors = async (personKey: string, minDaysFirst: number, minDaysSecond: number, secLimit: number) => {
    let sql = buildSecondDegreeSQL(personKey, true, minDaysFirst, minDaysSecond, secLimit)
    console.log('fetchEgoClientJSON: Executing 2nd-degree SQL (POST):', sql)
    let res = await execCH(sql)
    if (!res.ok) {
      sql = buildSecondDegreeSQL(personKey, false, minDaysFirst, minDaysSecond, secLimit)
      console.log('fetchEgoClientJSON: 2nd-degree retry with person_id (POST):', sql)
      res = await execCH(sql)
    }
    if (!res.ok) return [] as Array<{ id:string; w:number; name:string; first_id:string }>
    const txt = await res.text()
    const lines = txt.trim() ? txt.trim().split('\n').filter(Boolean) : []
    return lines.map(l=>JSON.parse(l)) as Array<{ id:string; w:number; name:string; first_id:string }>
  }

  // Build node list: center + first-degree + second-degree
  const firstList = neighbors
  const secondLimit = Math.max(0, Math.min(limit - (1 + firstList.length), 1000))
  const secondListRaw = secondLimit > 0 ? await executeSecondNeighbors(effectiveKey, 720, 1080, secondLimit) : []
  const secondList = secondListRaw

  const count = 1 + firstList.length + secondList.length
  const nodes = new Array(count * 2)
  nodes[0] = 0
  nodes[1] = 0

  // Place first-degree in People Network rings
  const ringsFirst = [120, 300, 480]
  const firstCount = firstList.length
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

  // Place second-degree in outer rings
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

  // Build edges: center->first (>=24m), first->second (>=36m). Store weights in months.
  const edges: Array<[number,number,number]> = []
  const idToFirstIndex = new Map<string, number>()
  for (let i = 0; i < firstList.length; i++) {
    const months = Math.max(0, Math.round((firstList[i].w||0) / 30))
    edges.push([0, 1 + i, months])
    idToFirstIndex.set(String(firstList[i].id), 1 + i)
  }
  for (let i = 0; i < secondList.length; i++) {
    const s = secondList[i]
    const months = Math.max(0, Math.round((s.w||0) / 30))
    const firstIdx = idToFirstIndex.get(String(s.first_id))
    if (typeof firstIdx === 'number') {
      edges.push([firstIdx, startSecond + i, months])
    }
  }

  // Labels and meta
  const labels = [centerName, ...firstList.map(n => n.name), ...secondList.map(n => n.name)]
  const metaNodes = [
    { id: String(effectiveKey), name: centerName, full_name: centerName, title: null, group: 0, flags: 0 },
    ...firstList.map((n:any) => ({ id: String(n.id), name: n.name, full_name: n.name, title: null, group: 0, flags: 0 })),
    ...secondList.map((n:any) => ({ id: String(n.id), name: n.name, full_name: n.name, title: null, group: 0, flags: 0 }))
  ]

  const tile = {
    meta: { nodes: metaNodes },
    coords: {
      nodes: new Array(count).fill(0).map((_, i) => [nodes[i*2], nodes[i*2+1]]),
      edges
    }
  }

  console.log(`fetchEgoClientJSON: Built tile with ${count} nodes, ${tile.coords.edges.length} edges (first=${firstList.length}, second=${secondList.length})`)

  return tile
}

// Company-centric ego: employees (top by tenure count) with names
export async function fetchCompanyEgoJSON(id: string, limit = 1500){
  if (!id.startsWith('company:')) throw new Error('company ego requires company:<id>')
  const key = id.replace(/^company:/,'')

  const buildSql = (use64: boolean, currentOnly: boolean) => {
    const pid = use64 ? 'person_id_64' : 'person_id'
    const pidCast = use64 ? 'toUInt64(e.id)' : 'e.id'
    return `
    WITH emp AS (
      SELECT toUInt64(${pid}) AS id, count() AS c
      FROM via_test.stints_large
      WHERE company_id = toUInt64(${key})
        ${currentOnly ? "AND (end_date IS NULL OR toDate(end_date) >= today())" : ''}
      GROUP BY toUInt64(${pid})
      ORDER BY c DESC
      LIMIT ${Math.min(limit, 1000)}
    )
    SELECT e.id AS id, e.c AS w,
           anyLast(p.name) AS name,
           argMax(s.title, ifNull(s.end_date, today())) AS title
    FROM emp e
    LEFT JOIN via_test.persons_large p ON p.person_id_64 = ${pidCast}
    LEFT JOIN via_test.stints_large s ON s.${pid} = ${pidCast}
    GROUP BY id, w
    `
  }

  const exec = async (sql: string) => fetch(`${BASE}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })

  // Try strict current-only with _64 then non-_64
  let res = await exec(buildSql(true, true))
  if (!res.ok) res = await exec(buildSql(false, true))
  let text = res.ok ? await res.text() : ''
  let rows = text.trim() ? text.trim().split('\n').map(l=>JSON.parse(l)) : [] as Array<{id:number; w:number; name:string, title?: string}>

  // If empty, relax to include historical employees
  if (rows.length === 0) {
    let res2 = await exec(buildSql(true, false))
    if (!res2.ok) res2 = await exec(buildSql(false, false))
    if (res2.ok) { text = await res2.text(); rows = text.trim() ? text.trim().split('\n').map(l=>JSON.parse(l)) : [] }
  }

  const count = 1 + rows.length
  const nodes: Array<[number,number]> = new Array(count)
  nodes[0] = [0,0]
  const edges: Array<[number,number,number]> = []
  for (let i=1;i<count;i++){ edges.push([0,i, rows[i-1]?.w || 1]) }
  // ring layout
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
    i===0 ? { id: String(key), full_name: 'Employees', name: 'Employees', title: null, group: 0, flags: 0 }
          : { id: String(rows[i-1]?.id||i), full_name: String(rows[i-1]?.name||''), name: String(rows[i-1]?.name||''), title: rows[i-1]?.title || null, group: 0, flags: 0 }
  ))
  return { meta: { nodes: metaNodes }, coords: { nodes, edges } }
}

// Bridges query between two companies (left, right)
// Returns a JSON tile shape consumable by parseJsonTile
export async function fetchBridgesTileJSON(companyAId: string, companyBId: string, limit = 120){
  const base = getApiBase()
  if (!companyAId.startsWith('company:') || !companyBId.startsWith('company:')) throw new Error('bridges requires company:<id> + company:<id>')
  const a = companyAId.replace(/^company:/,'')
  const b = companyBId.replace(/^company:/,'')

  // Helper to fetch a single scalar
  const fetchOne = async (sql: string) => {
    const r = await fetch(`${base}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })
    const t = await r.text()
    const row = t.trim().split('\n').filter(Boolean)[0]
    return row ? JSON.parse(row) : null
  }

  // Company labels
  const [rowA, rowB] = await Promise.all([
    fetchOne(`SELECT anyLast(name) AS name FROM via_test.companies_large WHERE company_id_64 = toUInt64(${a}) LIMIT 1`),
    fetchOne(`SELECT anyLast(name) AS name FROM via_test.companies_large WHERE company_id_64 = toUInt64(${b}) LIMIT 1`)
  ])
  const nameA = rowA?.name || `Company ${a}`
  const nameB = rowB?.name || `Company ${b}`

  // Build shared CTEs once; reuse across all subqueries
  const buildCTE = (opts?: { currentOnly?: boolean, minDays?: number }) => {
    const pid = 'person_id'
    const currentOnly = opts?.currentOnly ?? false
    const minDays = Math.max(1, Math.floor(opts?.minDays ?? 365))
    return `
    WITH
      S AS (
        SELECT toUInt64(${pid}) AS id
        FROM via_test.stints_large
        WHERE company_id = toUInt64(${a})
          ${currentOnly ? "AND (end_date IS NULL OR toDate(end_date) >= today())" : ''}
        GROUP BY id
      ),
      T AS (
        SELECT toUInt64(${pid}) AS id
        FROM via_test.stints_large
        WHERE company_id = toUInt64(${b})
          ${currentOnly ? "AND (end_date IS NULL OR toDate(end_date) >= today())" : ''}
        GROUP BY id
      ),
      overlap_pairs AS (
        SELECT
          toUInt64(a.${pid}) AS u,
          toUInt64(b.${pid}) AS v,
          sum(greatest(0, dateDiff('day',
                greatest(toDate(a.start_date), toDate(b.start_date)),
                least(toDate(ifNull(a.end_date, today())), toDate(ifNull(b.end_date, today())))
          ))) AS days
        FROM via_test.stints_large AS a
        INNER JOIN via_test.stints_large AS b ON a.company_id = b.company_id
        WHERE a.${pid} <> b.${pid}
        GROUP BY u, v
        HAVING days >= ${minDays}
      ),
      deg_s AS (
        SELECT m, count() AS NS FROM (
          SELECT if(u IN (SELECT id FROM S), v, u) AS m
          FROM overlap_pairs
          WHERE u IN (SELECT id FROM S) OR v IN (SELECT id FROM S)
        ) q GROUP BY m
      ),
      deg_t AS (
        SELECT m, count() AS NT FROM (
          SELECT if(u IN (SELECT id FROM T), v, u) AS m
          FROM overlap_pairs
          WHERE u IN (SELECT id FROM T) OR v IN (SELECT id FROM T)
        ) q GROUP BY m
      ),
      combined AS (
        SELECT COALESCE(ds.m, dt.m) AS m, COALESCE(NS,0) AS NS, COALESCE(NT,0) AS NT
        FROM deg_s ds FULL OUTER JOIN deg_t dt ON ds.m = dt.m
      ),
      scored AS (
        SELECT m, NS, NT, sqrt(toFloat64(NS) * toFloat64(NT)) AS score
        FROM combined
        WHERE NS > 0 AND NT > 0
      ORDER BY score DESC
      LIMIT ${Math.max(10, Math.min(500, limit))}
    )
    `
  }
  const buildScoredSelect = (opts?: { currentOnly?: boolean, minDays?: number }) => `
    ${buildCTE(opts)}
    SELECT toString(s.m) AS m,
           s.NS AS NS,
           s.NT AS NT,
           s.score AS score,
           anyLast(p.name) AS name
    FROM scored s
    LEFT JOIN via_test.persons_large p ON p.person_id_64 = toUInt64(s.m)
    GROUP BY m, NS, NT, score
    ORDER BY score DESC`

  // Execute with robust retries across transport variants
  const execSql = async (sql: string) => fetch(`${base}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`, { headers: { ...authHeaders() }, mode: 'cors' })

  let res = await execSql(buildScoredSelect({ currentOnly: false, minDays: 365 }))
  if (!res.ok) { const t = await res.text().catch(()=>'' as any); throw new Error(`bridges query failed ${res.status}: ${t.slice(0,200)}`) }
  let txt = await res.text()
  let rows = txt.trim() ? txt.trim().split('\n').map(l=>JSON.parse(l)) : [] as Array<{ m:string, NS:number, NT:number, score:number, name?:string }>
  // Drop weaker bridge candidates to reduce clutter
  try {
    const minDeg = 3 // require at least 3 total connections (NS+NT)
    const minScore = 2.0
    const filtered = rows.filter(r => (Number(r.NS||0) + Number(r.NT||0)) >= minDeg && Number(r.score||0) >= minScore)
    if (filtered.length >= Math.min(60, Math.floor(rows.length*0.5))) rows = filtered
  } catch {}

  // Fetch left (S) and right (T) member lists involved with scored bridges, capped at 100 each
  const baseCTE = buildCTE({ currentOnly: false, minDays: 365 })
  const sMembersSQL = `
    ${baseCTE},
    s_links AS (
      SELECT if(u IN (SELECT id FROM S), u, v) AS s_id,
             if(u IN (SELECT id FROM S), v, u) AS m,
             days
      FROM overlap_pairs
      WHERE ((u IN (SELECT id FROM S) AND v IN (SELECT m FROM scored)) OR (v IN (SELECT id FROM S) AND u IN (SELECT m FROM scored)))
    ),
    s_members AS (
      SELECT s_id AS id, count() AS c FROM s_links GROUP BY s_id ORDER BY c DESC LIMIT 100
    )
    SELECT toString(sm.id) AS id, anyLast(p.name) AS name
    FROM s_members sm LEFT JOIN via_test.persons_large p ON p.person_id_64 = sm.id
    GROUP BY sm.id
  `
  const tMembersSQL = `
    ${baseCTE},
    t_links AS (
      SELECT if(u IN (SELECT id FROM T), u, v) AS t_id,
             if(u IN (SELECT id FROM T), v, u) AS m,
             days
      FROM overlap_pairs
      WHERE ((u IN (SELECT id FROM T) AND v IN (SELECT m FROM scored)) OR (v IN (SELECT id FROM T) AND u IN (SELECT m FROM scored)))
    ),
    t_members AS (
      SELECT t_id AS id, count() AS c FROM t_links GROUP BY t_id ORDER BY c DESC LIMIT 100
    )
    SELECT toString(tm.id) AS id, anyLast(p.name) AS name
    FROM t_members tm LEFT JOIN via_test.persons_large p ON p.person_id_64 = tm.id
    GROUP BY tm.id
  `
  const sEdgesSQL = `
    ${baseCTE},
    s_links AS (
      SELECT if(u IN (SELECT id FROM S), u, v) AS s_id,
             if(u IN (SELECT id FROM S), v, u) AS m,
             days
      FROM overlap_pairs
      WHERE ((u IN (SELECT id FROM S) AND v IN (SELECT m FROM scored)) OR (v IN (SELECT id FROM S) AND u IN (SELECT m FROM scored)))
    ),
    s_members AS (
      SELECT s_id AS id, count() AS c FROM s_links GROUP BY s_id ORDER BY c DESC LIMIT 100
    )
    SELECT toString(s_id) AS sid, toString(m) AS m, days FROM s_links WHERE s_id IN (SELECT id FROM s_members)`
  const tEdgesSQL = `
    ${baseCTE},
    t_links AS (
      SELECT if(u IN (SELECT id FROM T), u, v) AS t_id,
             if(u IN (SELECT id FROM T), v, u) AS m,
             days
      FROM overlap_pairs
      WHERE ((u IN (SELECT id FROM T) AND v IN (SELECT m FROM scored)) OR (v IN (SELECT id FROM T) AND u IN (SELECT m FROM scored)))
    ),
    t_members AS (
      SELECT t_id AS id, count() AS c FROM t_links GROUP BY t_id ORDER BY c DESC LIMIT 100
    )
    SELECT toString(t_id) AS tid, toString(m) AS m, days FROM t_links WHERE t_id IN (SELECT id FROM t_members)`

  const bridgeEdgesSQL = `
    ${baseCTE}
    SELECT toString(least(u,v)) AS a,
           toString(greatest(u,v)) AS b,
           days
    FROM overlap_pairs
    WHERE u IN (SELECT m FROM scored) AND v IN (SELECT m FROM scored) AND u < v
    ORDER BY days DESC
    LIMIT 6000
  `

  const [sMemRes, tMemRes, sEdgeRes, tEdgeRes, bridgeEdgeRes] = await Promise.all([
    execSql(sMembersSQL),
    execSql(tMembersSQL),
    execSql(sEdgesSQL),
    execSql(tEdgesSQL),
    execSql(bridgeEdgesSQL)
  ])
  const sMembers = sMemRes.ok ? (await sMemRes.text()).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)) as Array<{id:string,name?:string}> : []
  const tMembers = tMemRes.ok ? (await tMemRes.text()).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)) as Array<{id:string,name?:string}> : []
  const sEdges = sEdgeRes.ok ? (await sEdgeRes.text()).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)) as Array<{sid:string,m:string,days:number}> : []
  const tEdges = tEdgeRes.ok ? (await tEdgeRes.text()).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)) as Array<{tid:string,m:string,days:number}> : []
  const bridgeEdges = bridgeEdgeRes.ok ? (await bridgeEdgeRes.text()).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)) as Array<{a:string,b:string,days:number}> : []

  // Layout: left line of S members, right line of T members, middle grid of bridges
  const leftCount = sMembers.length
  const rightCount = tMembers.length
  const bridgeCount = rows.length
  const count = leftCount + rightCount + bridgeCount
  const nodes: Array<[number,number]> = new Array(count)
  const edges: Array<[number,number,number]> = []
  // Widen default width so columns sit further apart by default
  // Push columns even farther apart for more separation
  // Double the horizontal spread
  const leftX = -5200
  const rightX = 5200
  const centerY = 0
  // Place left line
  // Loosen vertical stacking so side columns are not smooshed
  const leftSpacing = 64
  for (let i=0;i<leftCount;i++){
    const jitter = (Math.random() - 0.5) * 36
    nodes[i] = [leftX + jitter, (i - (leftCount-1)/2) * leftSpacing]
  }
  // Place right line
  for (let i=0;i<rightCount;i++){
    const jitter = (Math.random() - 0.5) * 36
    const idx = leftCount + i
    nodes[idx] = [rightX + jitter, (i - (rightCount-1)/2) * leftSpacing]
  }
  // middle layout: jittered grid
  const cols = Math.max(3, Math.ceil(Math.sqrt(Math.max(1, bridgeCount))))
  // Increase spacing and switch to a staggered hex-like layout so it feels less square
  const spacing = 320
  const vSpacing = Math.floor(spacing * 0.80)
  for (let i=0;i<bridgeCount;i++){
    const r = rows[i]
    const c = i % cols
    const row = Math.floor(i / cols)
    // Stagger every other row by half a column to approximate a hex grid
    const offset = (row % 2 === 1) ? spacing * 0.5 : 0
    // Add organic warp to avoid squared look
    const warpX = Math.sin(row * 0.9 + c * 0.4) * 40
    const warpY = Math.cos(row * 0.7 + c * 0.3) * 28
    const x = ((c - (cols-1)/2) * spacing + offset) + (Math.random()*2-1)*18 + warpX
    const y = (row - (Math.ceil(rows.length/cols)-1)/2) * vSpacing + (Math.random()*2-1)*22 + warpY
    nodes[leftCount + rightCount + i] = [x, y]
  }

  // Build maps for indices
  const bridgeIndex = new Map<string, number>()
  for (let i=0;i<bridgeCount;i++){ bridgeIndex.set(String(rows[i]?.m), leftCount + rightCount + i) }
  const sIndex = new Map<string, number>(); for (let i=0;i<leftCount;i++){ sIndex.set(String(sMembers[i]?.id), i) }
  const tIndex = new Map<string, number>(); for (let i=0;i<rightCount;i++){ tIndex.set(String(tMembers[i]?.id), leftCount + i) }

  // Edges from S/T members to bridge candidates
  for (const e of sEdges){ const si = sIndex.get(String(e.sid)); const bi = bridgeIndex.get(String(e.m)); if (si!=null && bi!=null){ edges.push([si, bi, Math.max(1, Math.round((e.days||0)/30))]) } }
  for (const e of tEdges){ const ti = tIndex.get(String(e.tid)); const bi = bridgeIndex.get(String(e.m)); if (ti!=null && bi!=null){ edges.push([ti, bi, Math.max(1, Math.round((e.days||0)/30))]) } }
  for (const e of bridgeEdges){
    const ai = bridgeIndex.get(String(e.a))
    const bi = bridgeIndex.get(String(e.b))
    if (ai != null && bi != null && ai !== bi) {
      const months = Math.max(1, Math.round((e.days || 0) / 30))
      edges.push([ai, bi, months])
    }
  }

  const metaNodes: Array<any> = new Array(count)
  for (let i=0;i<leftCount;i++){
    const m = sMembers[i]
    metaNodes[i] = { id: String(m?.id||i), name: String(m?.name||''), full_name: String(m?.name||''), title: null, group: 0, flags: 0 }
  }
  for (let i=0;i<rightCount;i++){
    const m = tMembers[i]
    metaNodes[leftCount+i] = { id: String(m?.id||i), name: String(m?.name||''), full_name: String(m?.name||''), title: null, group: 2, flags: 0 }
  }
  for (let i=0;i<bridgeCount;i++){
    const r = rows[i]
    metaNodes[leftCount+rightCount+i] = {
      id: String(r?.m||i),
      name: String(r?.name||''),
      full_name: String(r?.name||''),
      title: null,
      group: 1,
      flags: 0,
      score: r?.score ?? null,
      left_degree: r?.NS ?? null,
      right_degree: r?.NT ?? null
    }
  }

  const labels = metaNodes.map((n, idx) => {
    const base = String((n as any).name || (n as any).id || '')
    if (idx < leftCount) return base || 'Left member'
    if (idx < leftCount + rightCount) return base || 'Right member'
    const meta = metaNodes[idx] as any
    const score = typeof meta.score === 'number' ? ` • score ${meta.score.toFixed(1)}` : ''
    return `${base || 'Bridge'}${score}`
  })

  const groups = new Array(count).fill(1)
  for (let i=0;i<leftCount;i++) groups[i] = 0
  for (let i=0;i<rightCount;i++) groups[leftCount + i] = 2

  return { meta: { nodes: metaNodes }, coords: { nodes, edges, groups }, labels, focusWorld: { x: 0, y: centerY } }
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
        FROM via_test.stints_large
        WHERE company_id IN (toUInt64(${a}), toUInt64(${b}))
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
    LEFT JOIN via_test.companies_large c_from ON c_from.company_id_64 = from_company
    LEFT JOIN via_test.companies_large c_to ON c_to.company_id_64 = to_company
    GROUP BY from_id, to_id
    ORDER BY movers DESC
    LIMIT ${limit}
  `
  const res = await fetch(`${base}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`, { headers: { ...authHeaders() }, mode: 'cors' })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'' as any)
    throw new Error(`migration query failed ${res.status}: ${txt.slice(0,160)}`)
  }
  const body = await res.text()
  const rows = body.trim() ? body.trim().split('
').map(line => JSON.parse(line)) as Array<{ from_id:string; to_id:string; movers:number; from_name?:string; to_name?:string; avg_days?:number }> : []
  return rows
}

