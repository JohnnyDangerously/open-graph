// TEMP: agent sanity check
let BASE = (localStorage.getItem('API_BASE_URL') || 'http://34.236.80.1:8123').replace(/\/+$/,'')

// Feature flag for local fake database
const LOCAL_FAKE_DB = true

export async function __probe_echo(input: string){
  return { ok: true, input, ts: new Date().toISOString() }
}
export const setApiBase = (u:string) => { BASE = u.replace(/\/+$/,''); try{ localStorage.setItem('API_BASE_URL', BASE) }catch{} }
export const getApiBase = () => BASE
let BEARER = (localStorage.getItem('API_BEARER') || '')
export const setApiConfig = (base?: string, bearer?: string) => {
  if (typeof base === 'string' && base.length) setApiBase(base)
  if (typeof bearer === 'string') { BEARER = bearer || ''; try { localStorage.setItem('API_BEARER', BEARER) } catch {} }
}
const authHeaders = () => (BEARER ? { Authorization: `Bearer ${BEARER}` } : {})

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
  const s = q.trim()
  
  // Use fake data if feature flag is enabled
  if (LOCAL_FAKE_DB) {
    if (s.toLowerCase() === 'testco') {
      return { id: 'cmp_TEST', name: 'TestCo' }
    }
    return null
  }
  
  // Real ClickHouse implementation
  const base = getApiBase()
  // domain match
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)){
    const url = `${base}/?query=${encodeURIComponent(`SELECT toString(company_id_64) AS id FROM via_test.companies_large WHERE domain = '${s}' LIMIT 1`)}&default_format=JSONEachRow`
    const r = await fetch(url, { headers: { ...authHeaders() } }); const t = await r.text(); const row = t.trim().split('\n').filter(Boolean)[0]
    if (row){ const j = JSON.parse(row); return `company:${j.id}` }
  }
  // name search
  const sql = `SELECT toString(company_id_64) AS id FROM via_test.companies_large WHERE positionCaseInsensitive(name, '${s.replace(/'/g,"''")}') > 0 ORDER BY employee_count DESC LIMIT 1`
  const url = `${base}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`
  const r = await fetch(url); const t = await r.text(); const row = t.trim().split('\n').filter(Boolean)[0]
  if (row){ const j = JSON.parse(row); return `company:${j.id}` }
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
  } catch (error) {
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
  const buildOverlapSQL = (personKey: string, use64: boolean) => `
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
      HAVING overlap_days > 0
      ORDER BY overlap_days DESC
      LIMIT ${Math.min(limit, 1000)}
    )
    SELECT
      toString(a.neighbor_id) AS id,
      a.overlap_days AS w,
      anyLast(p.name) AS name,
      argMax(s.title, ifNull(s.end_date, today())) AS title
    FROM agg a
    LEFT JOIN via_test.persons_large p ON p.person_id_64 = a.neighbor_id
    LEFT JOIN via_test.stints_large s ON toUInt64(s.${use64 ? 'person_id_64' : 'person_id'}) = a.neighbor_id
    GROUP BY id, w
  `
  const executeNeighbors = async (personKey: string) => {
    let sql = buildOverlapSQL(personKey, true)
    console.log('fetchEgoClientJSON: Executing SQL:', sql)
    const url = `${BASE}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`
    let res = await fetch(url, { headers: { ...authHeaders() } })
    if (!res.ok) {
      // Try non-_64 variant
      sql = buildOverlapSQL(personKey, false)
      console.log('fetchEgoClientJSON: Retrying with person_id (non _64):', sql)
      res = await fetch(`${BASE}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })
    }
    if (!res.ok) { const msg = await res.text().catch(()=>"" as any); throw new Error(`fetch failed ${res.status}: ${msg.slice(0,200)}`) }
    const text = await res.text()
    const lines = text.trim() ? text.trim().split('\n').filter(Boolean) : []
    return lines.map(line => JSON.parse(line)) as Array<{id:number; w:number; name:string; title?: string}>
  }
  
  let neighbors = await executeNeighbors(effectiveKey)
  console.log(`fetchEgoClientJSON: Found ${neighbors.length} neighbors for key ${effectiveKey}`)

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
    console.log('fetchEgoClientJSON: Fallback SQL (no time-overlap):', sql2)
    let url2 = `${BASE}/?query=${encodeURIComponent(sql2)}&default_format=JSONEachRow`
    let res2 = await fetch(url2, { headers: { ...authHeaders() } })
    if (!res2.ok) {
      sql2 = buildCoworkersSQL(effectiveKey, false)
      console.log('fetchEgoClientJSON: Fallback retry with person_id:', sql2)
      url2 = `${BASE}/?query=${encodeURIComponent(sql2)}&default_format=JSONEachRow`
      res2 = await fetch(url2, { headers: { ...authHeaders() } })
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
      SELECT anyLast(p.name) AS name, argMax(s.title, ifNull(s.end_date, today())) AS title
      FROM via_test.persons_large p
      LEFT JOIN via_test.stints_large s ON s.person_id_64 = toUInt64(${effectiveKey})
      WHERE p.person_id_64 = toUInt64(${effectiveKey})
      GROUP BY p.person_id_64
      LIMIT 1`
    const centerRes = await fetch(`${BASE}/?query=${encodeURIComponent(centerSQL)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })
    const centerText = await centerRes.text()
    if (centerText.trim()) {
      const row = JSON.parse(centerText.trim().split('\n')[0])
      centerName = row?.name || 'Center'
      centerTitle = row?.title || null
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
    const altRes = await fetch(`${BASE}/?query=${encodeURIComponent(altSql)}&default_format=JSONEachRow`, { headers: { ...authHeaders() } })
    const altTxt = await altRes.text(); const altRow = altTxt.trim().split('\n').filter(Boolean)[0]
    if (altRow) {
      const alt = JSON.parse(altRow).id as string
      if (alt && alt !== effectiveKey) {
        console.log('fetchEgoClientJSON: Using name-based surrogate id:', alt, 'for', centerName)
        effectiveKey = alt
        neighbors = await executeNeighbors(effectiveKey)
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
          const url2b = `${BASE}/?query=${encodeURIComponent(sql2b)}&default_format=JSONEachRow`
          const r2b = await fetch(url2b, { headers: { ...authHeaders() } })
          if (r2b.ok) {
            const t2b = await r2b.text()
            const l2b = t2b.trim() ? t2b.trim().split('\n').filter(Boolean) : []
            neighbors = l2b.map(l=>JSON.parse(l))
          }
        }
      }
    }
  }

  const count = 1 + Math.min(neighbors.length, 1500)
  const nodes = new Array(count * 2)
  nodes[0] = 0
  nodes[1] = 0

  // People Network style: larger radii (120, 300, 480 pixels)
  const rings = [120, 300, 480]
  const ringCounts = [Math.min(12, count-1), Math.min(36, (count-1)-12), (count-1)-48]
  let idx = 1

  for (let r = 0; r < rings.length; r++) {
    const radius = rings[r]
    const ringCount = ringCounts[r] > 0 ? ringCounts[r] : 0
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.1 // small jitter
      nodes[idx*2] = Math.cos(angle) * radius + (Math.random() - 0.5) * 12 // ±6px jitter
      nodes[idx*2 + 1] = Math.sin(angle) * radius + (Math.random() - 0.5) * 12
      idx++
    }
  }

  // Edges: connect center to all neighbors
  const edges = new Array((count - 1) * 2)
  for (let i = 1; i < count; i++) {
    edges[(i-1)*2] = 0
    edges[(i-1)*2 + 1] = i
  }

  // Edge weights from neighbors
  const edgeWeights = neighbors.slice(0, count-1).map((n:any) => n.w)

  // Fetch center name
  // centerName already fetched above (may be 'Center' on failure)

  // Labels: center first, then neighbors
  const labels = [centerName, ...neighbors.slice(0, count-1).map(n => n.name)]

  const tile = {
    meta: {
      nodes: [{ id: String(effectiveKey), name: centerName, full_name: centerName, title: centerTitle, group: 0, flags: 0 }, 
        ...neighbors.slice(0, count-1).map((n:any) => ({ id: String(n.id), name: n.name, full_name: n.name, title: (n.title||null), group: 0, flags: 0 }))
      ]
    },
    coords: {
      nodes: new Array(count).fill(0).map((_, i) => [nodes[i*2], nodes[i*2+1]]),
      edges: new Array(count-1).fill(0).map((_, i) => [0, i+1, edgeWeights[i]])
    }
  }

  console.log(`fetchEgoClientJSON: Built tile with ${count} nodes, ${tile.coords.edges.length} edges, ${tile.meta.nodes.length} meta nodes`)

  return tile
}

// Company-centric ego: employees (top by tenure count) with names
export async function fetchCompanyEgoJSON(id: string, limit = 1500){
  if (!id.startsWith('company:')) throw new Error('company ego requires company:<id>')
  const key = id.replace(/^company:/,'')
  const sql = `
    WITH emp AS (
      SELECT person_id, count() AS c
      FROM via_test.stints_large
      WHERE company_id = ${key}
      GROUP BY person_id
      ORDER BY c DESC
      LIMIT ${Math.min(limit, 1000)}
    )
    SELECT e.person_id AS id, e.c AS w, anyLast(p.name) AS name, argMax(s.title, ifNull(s.end_date, today())) AS title
    FROM emp e
    LEFT JOIN via_test.persons_large p ON p.person_id_64 = e.person_id
    LEFT JOIN via_test.stints_large s ON s.person_id_64 = e.person_id
    GROUP BY id, w
  `
  const url = `${BASE}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`
  const res = await fetch(url, { headers: { ...authHeaders() } }); if (!res.ok) throw new Error('company ego fetch failed')
  const text = await res.text()
  const rows = text.trim() ? text.trim().split('\n').map(l=>JSON.parse(l)) : [] as Array<{id:number; w:number; name:string, title?: string}>
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

// Company contacts function
export async function companyContacts(companyName: string) {
  const s = companyName.trim()
  
  // Use fake data if feature flag is enabled
  if (LOCAL_FAKE_DB) {
    if (s.toLowerCase() === 'testco') {
      return [
        { id: 'person_1', name: 'John Smith', title: 'Software Engineer', company: 'TestCo' },
        { id: 'person_2', name: 'Jane Doe', title: 'Product Manager', company: 'TestCo' }
      ]
    }
    return []
  }
  
  // Real ClickHouse implementation would go here
  // For now, return empty array
  return []
}
