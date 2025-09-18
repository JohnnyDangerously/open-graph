// Configurable API base/bearer with localStorage persistence
let API_BASE = (window as any).REMOTE_API_BASE || localStorage.getItem('API_BASE') || "http://34.236.80.1";
let BEARER = (window as any).REMOTE_API_BEARER || localStorage.getItem('API_BEARER') || "";

export function setApiConfig(base: string, bearer: string){
  if (base) API_BASE = base;
  BEARER = bearer || "";
  try { localStorage.setItem('API_BASE', API_BASE); localStorage.setItem('API_BEARER', BEARER); } catch {}
}

export async function resolveLinkedIn(urlOrVanity: string): Promise<string | null> {
  // Hardcode a person_id for testing with ClickHouse DB
  return "1";  // Replace with an actual person_id from the DB
}

export async function fetchEgoBinary(personId: string, variant = "all", limit = 1500) {
  // Query remote ClickHouse for coworkers (updated to elastic IP)
  // Note: If CORS errors occur, ensure ClickHouse config allows cross-origin requests
  // (e.g., add <http_server> <cors> section in config.xml and restart server)
  const sql = `
    WITH my AS (
      SELECT company_id FROM via_test.stints WHERE person_id = ${personId}
    ),
    cand AS (
      SELECT s.person_id AS neighbor_id
      FROM via_test.stints s
      JOIN my USING (company_id)
      WHERE s.person_id <> ${personId}
    )
    SELECT neighbor_id, COUNT(*) AS w
    FROM cand
    GROUP BY neighbor_id
    ORDER BY w DESC
    LIMIT ${Math.min(limit, 1000)}
  `;
  const url = `http://34.236.80.1:8123/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    const text = await res.text();
    
    // Handle empty response
    if (!text.trim()) {
      console.log('No coworkers found for person_id:', personId);
      // Return single node (just the person themselves)
      const count = 1;
      const nodes = new Float32Array(2); // x,y for 1 node
      const size = new Float32Array(1);
      const alpha = new Float32Array(1);
      const group = new Uint16Array(1);
      const flags = new Uint8Array(1);
      
      nodes[0] = 0; nodes[1] = 0;
      size[0] = 12; alpha[0] = 1.0; group[0] = 0; flags[0] = 0;
      
      const buf = new ArrayBuffer(16 + nodes.byteLength + group.byteLength + flags.byteLength);
      const dv = new DataView(buf);
      dv.setInt32(0, count, true);
      dv.setInt32(4, 2, true);
      dv.setInt32(8, nodes.byteLength, true);
      dv.setInt32(12, nodes.byteLength + group.byteLength, true);
      new Float32Array(buf, 16).set(nodes);
      new Uint16Array(buf, 16 + nodes.byteLength).set(group);
      new Uint8Array(buf, 16 + nodes.byteLength + group.byteLength).set(flags);
      return buf;
    }
    
    const lines = text.trim().split('\n').filter(line => line.trim());
    const neighbors = lines.map(line => JSON.parse(line));
    console.log(`Found ${neighbors.length} coworkers for person_id:`, personId);

    // Generate simple concentric layout
    const count = Math.min(1 + neighbors.length, 1500); // Cap at reasonable size
    const rings = Math.min(3, Math.ceil(Math.sqrt(count / 10)));
    const nodes = new Float32Array(count * 2);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    const group = new Uint16Array(count);
    const flags = new Uint8Array(count);

    // Central node (the queried person)
    nodes[0] = 0;
    nodes[1] = 0;
    size[0] = 12;
    alpha[0] = 1.0;
    group[0] = 0;
    flags[0] = 0;

    // Place neighbors in concentric rings
    let idx = 1;
    for (let r = 0; r < rings && idx < count; r++) {
      const nodesInRing = Math.ceil((count - 1) / rings);
      const radius = 0.28 + r * 0.32;
      
      for (let k = 0; k < nodesInRing && idx < count; k++, idx++) {
        const angle = (k / nodesInRing) * Math.PI * 2;
        const jitterX = (Math.random() * 2 - 1) * 0.012;
        const jitterY = (Math.random() * 2 - 1) * 0.012;
        
        nodes[idx * 2] = Math.cos(angle) * radius + jitterX;
        nodes[idx * 2 + 1] = Math.sin(angle) * radius + jitterY;
        size[idx] = 3.5;
        alpha[idx] = 0.9;
        group[idx] = 0;
        flags[idx] = 0;
      }
    }

    // Create buffer with proper size validation
    const headerSize = 16;
    const nodesSize = nodes.byteLength;
    const groupSize = group.byteLength;
    const flagsSize = flags.byteLength;
    const totalSize = headerSize + nodesSize + groupSize + flagsSize;
    
    console.log(`Creating buffer: count=${count}, totalSize=${totalSize}`);
    
    const buf = new ArrayBuffer(totalSize);
    const dv = new DataView(buf);
    dv.setInt32(0, count, true);
    dv.setInt32(4, 2, true); // dimensions
    dv.setInt32(8, nodesSize, true); // group offset
    dv.setInt32(12, nodesSize + groupSize, true); // flags offset
    
    new Float32Array(buf, headerSize).set(nodes);
    new Uint16Array(buf, headerSize + nodesSize).set(group);
    new Uint8Array(buf, headerSize + nodesSize + groupSize).set(flags);

    return buf;
  } catch (error) {
    console.error('Error fetching ego graph:', error);
    throw new Error(`Failed to fetch graph data: ${error.message}`);
  }
}

export async function fetchEgoJSON(personId: string, variant = "all", limit = 1500) {
  const url = `${API_BASE}/graph/ego?person_id=${encodeURIComponent(personId)}&variant=${variant}&limit=${limit}&format=json`;
  const res = await fetch(url, { headers: BEARER ? { Authorization: `Bearer ${BEARER}` } : {} });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  return res.json();
}


