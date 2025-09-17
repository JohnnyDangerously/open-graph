export type ParsedTile = {
  nodes: Float32Array
  size: Float32Array
  alpha: Float32Array
  group: Uint16Array
  count: number
  edges?: Uint32Array
  idsIndex?: Uint32Array
  idsBlob?: Uint8Array
  flags?: Uint8Array
  ids?: string[]
  labels?: string[]
}

export function parseTile(buf: ArrayBuffer): ParsedTile {
  const dv = new DataView(buf);
  const count = dv.getInt32(0, true);
  const dims = dv.getInt32(4, true);
  const groupOff = dv.getInt32(8, true);
  const flagsOff = dv.getInt32(12, true);
  const xy = new Float32Array(buf, 16, count * dims);
  const group = new Uint16Array(buf, 16 + groupOff, count);
  const _flags = new Uint8Array(buf, 16 + flagsOff, count);
  const nodes = new Float32Array(count * 2);
  nodes.set(xy);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  for (let i = 0; i < count; i++) { size[i] = i ? 3.5 : 12; alpha[i] = i ? 0.9 : 1.0; }
  // Optional trailing sections: edges (Uint32 flat [s,t,...]), idsIndex (Uint32 offsets), idsBlob (Uint8 bytes)
  let edges: Uint32Array | undefined
  let idsIndex: Uint32Array | undefined
  let idsBlob: Uint8Array | undefined
  const minBytes = 16 + (count * dims * 4) + (count * 2) + (count * 1)
  if (buf.byteLength > minBytes) {
    // interpret remainder heuristically: prefer even number of uint32 as edges
    const remBytes = buf.byteLength - minBytes
    const rem32 = (remBytes / 4) | 0
    if (rem32 > 0 && (rem32 % 2 === 0)) {
      edges = new Uint32Array(buf, minBytes, rem32)
    }
  }
  return { nodes, size, alpha, group, count, edges, idsIndex, idsBlob, flags: _flags };
}

export function makeDemoTile(numNeighbors = 800): ParsedTile {
  const count = Math.max(1, numNeighbors + 1)
  const nodes = new Float32Array(count * 2)
  const size = new Float32Array(count)
  const alpha = new Float32Array(count)
  const group = new Uint16Array(count)
  // center at 0,0
  size[0] = 12
  alpha[0] = 1
  for (let i = 1; i < count; i++) {
    const r = 0.2 + Math.random() * 0.75
    const a = Math.random() * Math.PI * 2
    nodes[2*i+0] = r * Math.cos(a)
    nodes[2*i+1] = r * Math.sin(a)
    size[i] = 3.2 + Math.random() * 1.6
    alpha[i] = 0.85 + Math.random() * 0.15
    group[i] = 0
  }
  return { nodes, size, alpha, group, count }
}


// JSON tile parser (supports two shapes: with meta.* or flat nodes/coords)
export function parseJsonTile(json: any): ParsedTile {
  // Shape A (recommended): { meta:{nodes:[...]}, coords:{nodes:[x,y], edges:[[s,t]]} }
  if (json && json.meta && Array.isArray(json.meta.nodes) && json.coords) {
    const N = json.meta.nodes.length | 0
    const nodes = new Float32Array(N * 2)
    const size = new Float32Array(N)
    const alpha = new Float32Array(N)
    const group = new Uint16Array(N)
    const flags = new Uint8Array(N)
    const ids: string[] = new Array(N)
    const labels: string[] = new Array(N)
    for (let i = 0; i < N; i++) {
      const xy = json.coords.nodes[i]
      nodes[2 * i] = xy[0]
      nodes[2 * i + 1] = xy[1]
      size[i] = i ? 4 : 12
      alpha[i] = i ? 0.85 : 1.0
      const n = json.meta.nodes[i] || {}
      group[i] = (n.group | 0) >>> 0
      flags[i] = (n.flags | 0) >>> 0
      ids[i] = typeof n.id === 'string' ? n.id : ''
      labels[i] = typeof n.full_name === 'string' && n.full_name ? n.full_name : (ids[i] || `#${i}`)
    }
    let edges: Uint32Array | undefined
    if (Array.isArray(json.coords.edges)) {
      const E = json.coords.edges.length
      const flat = new Uint32Array(E * 2)
      for (let e = 0; e < E; e++) { const p = json.coords.edges[e]; flat[2 * e] = p[0] | 0; flat[2 * e + 1] = p[1] | 0 }
      edges = flat
    }
    return { nodes, size, alpha, group, flags, edges, count: N, ids, labels }
  }
  // Shape B: { nodes:[{id, group, flags}], coords:{nodes:[[x,y]], edges:[[s,t]]} or coords omitted
  if (json && Array.isArray(json.nodes) && json.coords) {
    const N = json.nodes.length | 0
    const nodes = new Float32Array(N * 2)
    const size = new Float32Array(N)
    const alpha = new Float32Array(N)
    const group = new Uint16Array(N)
    const flags = new Uint8Array(N)
    const ids: string[] = new Array(N)
    const labels: string[] = new Array(N)
    for (let i = 0; i < N; i++) {
      const xy = json.coords.nodes[i]
      nodes[2 * i] = xy[0]
      nodes[2 * i + 1] = xy[1]
      size[i] = i ? 4 : 12
      alpha[i] = i ? 0.85 : 1.0
      const n = json.nodes[i] || {}
      group[i] = (n.group | 0) >>> 0
      flags[i] = (n.flags | 0) >>> 0
      ids[i] = typeof n.id === 'string' ? n.id : ''
      labels[i] = typeof n.full_name === 'string' && n.full_name ? n.full_name : (ids[i] || `#${i}`)
    }
    let edges: Uint32Array | undefined
    if (Array.isArray(json.coords.edges)) {
      const E = json.coords.edges.length
      const flat = new Uint32Array(E * 2)
      for (let e = 0; e < E; e++) { const p = json.coords.edges[e]; flat[2 * e] = p[0] | 0; flat[2 * e + 1] = p[1] | 0 }
      edges = flat
    }
    return { nodes, size, alpha, group, flags, edges, count: N, ids, labels }
  }
  throw new Error('Unsupported JSON tile shape')
}


