export type ParsedTile = {
  nodes: Float32Array
  size: Float32Array
  alpha: Float32Array
  group: Uint16Array
  count: number
  edges?: Uint32Array
  edgeWeights?: Float32Array
  idsIndex?: Uint32Array
  idsBlob?: Uint8Array
  flags?: Uint8Array
  ids?: string[]
  labels?: string[]
}

export function parseTile(buf: ArrayBuffer): ParsedTile {
  try {
    const dv = new DataView(buf);
    let count = dv.getInt32(0, true);
    let dims = dv.getInt32(4, true);
    let groupOff = dv.getInt32(8, true);
    let flagsOff = dv.getInt32(12, true);

    // Basic sanity clamps
    if (!Number.isFinite(count) || count < 0) count = 0;
    if (!Number.isFinite(dims) || dims <= 0 || dims > 4) dims = 2;
    // Hard caps to avoid runaway allocations
    if (count > 20000) count = 20000;

    // Validate offsets (relative to nodes block start at 16)
    if (!Number.isFinite(groupOff) || groupOff < 0) groupOff = count * dims * 4;
    if (!Number.isFinite(flagsOff) || flagsOff < 0) flagsOff = groupOff + count * 2;

    const nodesBytes = count * dims * 4;
    const groupBytes = count * 2;
    const flagsBytes = count * 1;
    const minBytes = 16 + nodesBytes + groupBytes + flagsBytes;
    if (buf.byteLength < minBytes) {
      // Corrupt/short buffer → return empty safe tile
      return { count: 0, nodes: new Float32Array(0), size: new Float32Array(0), alpha: new Float32Array(0), group: new Uint16Array(0), flags: new Uint8Array(0) } as any;
    }

    const xy = new Float32Array(buf, 16, count * dims);
    const group = new Uint16Array(buf, 16 + groupOff, count);
    const _flags = new Uint8Array(buf, 16 + flagsOff, count);

    const nodes = new Float32Array(count * 2);
    nodes.set(xy.subarray(0, count * 2)); // copy only x,y even if dims>2
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    for (let i = 0; i < count; i++) { size[i] = i ? 3.5 : 12; alpha[i] = i ? 0.9 : 1.0; }

    // Optional trailing sections: treat remainder as uint32 edges if even
    let edges: Uint32Array | undefined
    let idsIndex: Uint32Array | undefined
    let idsBlob: Uint8Array | undefined
    if (buf.byteLength > minBytes) {
      // Edges are aligned to 4-byte boundary after flags
      const edgesStart = (minBytes + 3) & ~3;
      const remBytes = buf.byteLength - edgesStart;
      const rem32 = (remBytes / 4) | 0;
      if (rem32 > 0 && (rem32 % 2 === 0)) {
        edges = new Uint32Array(buf, edgesStart, rem32);
      }
    }
    return { nodes, size, alpha, group, count, edges, idsIndex, idsBlob, flags: _flags };
  } catch (e) {
    console.error('parseTile: failed, returning empty tile', e)
    return { count: 0, nodes: new Float32Array(0), size: new Float32Array(0), alpha: new Float32Array(0), group: new Uint16Array(0), flags: new Uint8Array(0) } as any
  }
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
export function parseJsonTile(j: any): ParsedTile {
  try {
    console.log('parseJsonTile: Input JSON:', {
      coordsNodesLength: j?.coords?.nodes?.length,
      coordsEdgesLength: j?.coords?.edges?.length,
      metaNodesLength: j?.meta?.nodes?.length
    })

    const rawNodes: any[] = Array.isArray(j?.coords?.nodes) ? j.coords.nodes : []
    let count = Number.isInteger(rawNodes.length) ? rawNodes.length : 0
    if (count < 0) count = 0
    if (count > 20000) count = 20000 // hard clamp

    const nodes = new Float32Array(count * 2)
    const size = new Float32Array(count)
    const alpha = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const p = rawNodes[i]
      const x = Array.isArray(p) && typeof p[0] === 'number' ? p[0] : 0
      const y = Array.isArray(p) && typeof p[1] === 'number' ? p[1] : 0
      nodes[i * 2] = x
      nodes[i * 2 + 1] = y
      size[i] = i === 0 ? 12 : 4
      alpha[i] = i === 0 ? 1.0 : 0.85
    }

    const rawEdges: any[] = Array.isArray(j?.coords?.edges) ? j.coords.edges : []
    const edgeCount = Math.max(0, Math.min(60000, rawEdges.length | 0))
    const edges = new Uint16Array(edgeCount * 2)
    const edgeWeights = new Uint8Array(edgeCount)
    for (let i = 0; i < edgeCount; i++) {
      const e = rawEdges[i]
      const s = Array.isArray(e) && typeof e[0] === 'number' ? e[0] : 0
      const t = Array.isArray(e) && typeof e[1] === 'number' ? e[1] : 0
      const w = Array.isArray(e) && typeof e[2] === 'number' ? e[2] : 0
      edges[i * 2] = s < count ? s : 0
      edges[i * 2 + 1] = t < count ? t : 0
      edgeWeights[i] = Math.min(255, Math.max(0, w))
    }

    const parsed: ParsedTile = { count, nodes, size, alpha, edges, edgeWeights, meta: j?.meta }
    console.log('parseJsonTile: Parsed:', {
      count: parsed.count,
      nodesLength: parsed.nodes.length,
      edgesLength: parsed.edges.length,
      edgeWeightsLength: parsed.edgeWeights.length
    })
    return parsed
  } catch (err) {
    console.error('parseJsonTile: Failed to parse, returning empty tile:', err)
    return { count: 0, nodes: new Float32Array(0), size: new Float32Array(0), alpha: new Float32Array(0), edges: new Uint16Array(0), edgeWeights: new Uint8Array(0) }
  }
}


