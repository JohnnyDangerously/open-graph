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


