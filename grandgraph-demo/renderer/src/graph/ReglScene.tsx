import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import createREGL from 'regl'
import type { ParsedTile } from './parse'

type Exposed = { setForeground: (fg: ParsedTile) => void, clear: () => void }
type Props = { onStats?: (fps: number, count: number) => void, concentric?: boolean, onPick?: (index: number)=>void, onClear?: ()=>void, filters?: { email:boolean, work:boolean, social:boolean, phone:boolean } }

// Build a triangle list that renders each edge as a screen-space quad.
// Returns { bufs, count } or { null, 0 } when no edges.
function buildEdgeQuads(regl: any, tile: { nodes: Float32Array; edges?: Uint32Array; count: number }, maxEdges = 6000) {
  if (!tile.edges || tile.edges.length < 2) return { bufs: null as any, count: 0 }
  const m = Math.min(tile.edges.length / 2, maxEdges)
  const V = m * 6
  const a_pos = new Float32Array(V * 2)
  const a_other = new Float32Array(V * 2)
  const a_side = new Float32Array(V)
  const sidesTri = [-1, +1, -1, -1, +1, +1]
  let w = 0
  for (let i = 0; i < m; i++) {
    const s = tile.edges[2 * i] | 0
    const t = tile.edges[2 * i + 1] | 0
    const sx = tile.nodes[2 * s], sy = tile.nodes[2 * s + 1]
    const tx = tile.nodes[2 * t], ty = tile.nodes[2 * t + 1]
    const ex = [sx, sx, tx, tx, sx, tx]
    const ey = [sy, sy, ty, ty, sy, ty]
    for (let k = 0; k < 6; k++, w++) {
      a_pos[2 * w] = ex[k]; a_pos[2 * w + 1] = ey[k]
      const isSrc = (ex[k] === sx && ey[k] === sy)
      a_other[2 * w] = isSrc ? tx : sx
      a_other[2 * w + 1] = isSrc ? ty : sy
      a_side[w] = sidesTri[k]
    }
  }
  const bufPos = regl.buffer({ usage: 'dynamic', type: 'float', data: a_pos })
  const bufOther = regl.buffer({ usage: 'dynamic', type: 'float', data: a_other })
  const bufSide = regl.buffer({ usage: 'dynamic', type: 'float', data: a_side })
  return { bufs: { bufPos, bufOther, bufSide }, count: V }
}

function createBackgroundPoints(count = 200_000) {
  const nodes = new Float32Array(count * 2)
  const size = new Float32Array(count)
  const alpha = new Float32Array(count)
  const seed = new Float32Array(count)
  // messy Gaussian clusters (no rings)
  const clusterCount = 4
  const centers: Array<[number, number, number, number, number]> = [] // [cx, cy, major, minor, theta]
  for (let c = 0; c < clusterCount; c++) {
    const cx = (Math.random() * 2 - 1) * 1.1
    const cy = (Math.random() * 2 - 1) * 1.1
    const major = 0.25 + Math.random() * 0.35
    const minor = 0.12 + Math.random() * 0.2
    const theta = Math.random() * Math.PI
    centers.push([cx, cy, major, minor, theta])
  }
  // Box-Muller normal generator
  const randn = () => {
    let u = 0, v = 0
    while (u === 0) u = Math.random()
    while (v === 0) v = Math.random()
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  }
  for (let i = 0; i < count; i++) {
    // 85% from clusters, 15% uniform sprinkle
    const sprinkle = Math.random() < 0.15
    if (sprinkle) {
      nodes[2 * i + 0] = (Math.random() * 2 - 1) * 1.8
      nodes[2 * i + 1] = (Math.random() * 2 - 1) * 1.8
    } else {
      const ci = Math.floor(Math.random() * clusterCount)
      const [cx, cy, major, minor, theta] = centers[ci]
      const x = randn() * major
      const y = randn() * minor
      const ct = Math.cos(theta), st = Math.sin(theta)
      nodes[2 * i + 0] = cx + x * ct - y * st
      nodes[2 * i + 1] = cy + x * st + y * ct
    }
    size[i] = 1 + Math.random() * 1.4
    alpha[i] = 0.34 + Math.random() * 0.2
    seed[i] = Math.random()
  }
  return { nodes, size, alpha, seed, count }
}

const ReglScene = forwardRef<Exposed>(function ReglScene(_props: Props, ref){
  const props = _props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tile, setTile] = useState<ParsedTile | null>(null)
  const bg = useMemo(() => createBackgroundPoints(240_000), [])
  const [camera, setCamera] = useState({ zoom: 1, offset: [0, 0] as [number, number] })
  const cameraRef = useRef(camera)
  const tileRef = useRef<ParsedTile | null>(null)
  const reglRef = useRef<any>(null)
  const fgPositionRef = useRef<any>(null)
  const fgSizeRef = useRef<any>(null)
  const fgAlphaRef = useRef<any>(null)
  const fgSeedRef = useRef<any>(null)
  const baseAlphaRef = useRef<Float32Array | null>(null)
  const posRef = useRef<Float32Array | null>(null)
  const edgePosRef = useRef<any>(null)
  const pickedRef = useRef<number | null>(null)
  const glowMeshRef = useRef<{ bufs:any, count:number } | null>(null)
  const originalPosRef = useRef<Float32Array | null>(null)
  const rafRef = useRef<number>(0)
  const edgeCountRef = useRef<number>(0)
  const timeRef = useRef(0)

  useEffect(() => { cameraRef.current = camera }, [camera])

  useImperativeHandle(ref, () => ({
    setForeground: (fg) => setTile(fg),
    clear: () => setTile(null)
  }), [])

  useEffect(() => {
    const canvas = canvasRef.current!
    // Ensure CSS fills the parent; fallback if external styles fail
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    let dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
    // Ensure drawing buffer is correctly sized BEFORE creating regl
    const sizeOnce = () => {
      dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      canvas.width = w
      canvas.height = h
    }
    sizeOnce()
    const regl = createREGL({ canvas, attributes: { antialias: true }, pixelRatio: dpr })
    reglRef.current = regl

    const drawPoints = regl({
      vert: `
      precision mediump float;
      attribute vec2 position;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aSeed;
      uniform mat2 uScale;
      uniform vec2 uOffset;
      uniform float uDPR;
      uniform float uTime;
      uniform float uJitterAmp;
      uniform vec2 uDrift;
      uniform float uSizeScale;
      uniform float uMaxSizePx;
      varying float vAlpha;
      float mask(){
        // simple bitmask against flags via group placeholder (no flags array bound yet)
        return 1.0; // placeholder hook for future flag-based dimming
      }
      void main(){
        float s = aSeed * 6.2831853;
        vec2 dir = vec2(cos(s*1.97), sin(s*2.31));
        float wob = sin(uTime*0.7 + s*3.1) * 0.5 + cos(uTime*0.37 + s*2.7) * 0.5;
        vec2 jitter = dir * wob * uJitterAmp;
        vec2 p = uScale * (position + jitter + uDrift) + uOffset;
        gl_Position = vec4(p, 0.0, 1.0);
        gl_PointSize = min(aSize * uDPR * uSizeScale, uMaxSizePx);
        vAlpha = aAlpha * mask();
      }`,
      frag: `
      precision mediump float;
      uniform vec3 uColor;
      varying float vAlpha;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c,c);
        float alpha = smoothstep(0.25, 0.0, d) * vAlpha;
        gl_FragColor = vec4(uColor, alpha);
      }`,
      attributes: {
        position: regl.prop<'position'>('position'),
        aSize: regl.prop<'aSize'>('aSize'),
        aAlpha: regl.prop<'aAlpha'>('aAlpha'),
        aSeed: regl.prop<'aSeed'>('aSeed'),
      },
      uniforms: {
        // read camera from ref to avoid re-creating pipeline every update
        uScale: () => [cameraRef.current.zoom, 0, 0, cameraRef.current.zoom],
        uOffset: () => cameraRef.current.offset,
        uDPR: () => dpr,
        uTime: () => timeRef.current,
        uJitterAmp: regl.prop<'uJitterAmp'>('uJitterAmp'),
        uDrift: () => [Math.cos(timeRef.current * 0.07) * 0.02, Math.sin(timeRef.current * 0.05) * 0.02],
        uColor: regl.prop<'uColor'>('uColor'),
        uSizeScale: regl.prop<'uSizeScale'>('uSizeScale'),
        uMaxSizePx: regl.prop<'uMaxSizePx'>('uMaxSizePx'),
      },
      count: regl.prop<'count'>('count'),
      primitive: 'points',
      blend: {
        enable: true,
        func: {
          srcRGB: 'src alpha',
          srcAlpha: 'one',
          dstRGB: 'one minus src alpha',
          dstAlpha: 'one minus src alpha'
        }
      }
    })

    // simple lines pass (AA via alpha)
    const drawLines = regl({
      vert: `
      precision mediump float;
      attribute vec2 a_pos;
      uniform mat2 uScale; uniform vec2 uOffset;
      void main(){
        vec2 ndc = uScale * a_pos + uOffset;
        gl_Position = vec4(ndc, 0.0, 1.0);
      }`,
      frag: `
      precision mediump float; void main(){ gl_FragColor = vec4(1.0,0.85,0.25,0.22); }`,
      attributes: { a_pos: () => edgePosRef.current },
      uniforms: { uScale: () => [cameraRef.current.zoom,0,0,cameraRef.current.zoom], uOffset: () => cameraRef.current.offset },
      primitive: 'lines', count: () => edgeCountRef.current * 2, depth: { enable:false }, blend:{ enable:true, func:{ srcRGB:'src alpha', srcAlpha:'one', dstRGB:'one minus src alpha', dstAlpha:'one minus src alpha' } }
    })

    // Edge glow (screen-space quads)
    let glowMesh: { bufs: any; count: number } | null = null
    const drawEdgesGlow = regl({
      vert: `
      precision highp float;
      attribute vec2 a_pos;
      attribute vec2 a_other;
      attribute float a_side;
      uniform float u_scale;
      uniform vec2  u_translate;
      uniform vec2  u_viewport;
      uniform float u_pxWidth;
      varying float v_l;
      vec2 worldToScreen(vec2 p){ return p * u_scale + u_translate; }
      void main(){
        vec2 p0 = worldToScreen(a_pos);
        vec2 p1 = worldToScreen(a_other);
        vec2 dir = normalize(p1 - p0);
        vec2 nrm = vec2(-dir.y, dir.x);
        vec2 screen = p0 + nrm * a_side * u_pxWidth;
        vec2 clip = (screen / (0.5 * u_viewport)) - 1.0;
        gl_Position = vec4(clip, 0.0, 1.0);
        v_l = abs(a_side);
      }`,
      frag: `
      precision highp float; varying float v_l; uniform float u_alpha;
      void main(){ float fall = exp(-4.0 * v_l * v_l); gl_FragColor = vec4(1.0,0.85,0.35, u_alpha * fall); }`,
      attributes: {
        a_pos: (_: any, p: any) => p.bufs.bufPos,
        a_other: (_: any, p: any) => p.bufs.bufOther,
        a_side: (_: any, p: any) => p.bufs.bufSide,
      },
      uniforms: {
        u_scale: () => cameraRef.current.zoom * (Math.min(canvasRef.current!.width, canvasRef.current!.height) / 2),
        u_translate: () => [ (cameraRef.current.offset[0]*0.5+0.5) * canvasRef.current!.width, (cameraRef.current.offset[1]*0.5+0.5) * canvasRef.current!.height ],
        u_viewport: ({ viewportWidth, viewportHeight }: any) => [viewportWidth, viewportHeight],
        u_pxWidth: (_: any, p: any) => p.pxWidth ?? 1.4,
        u_alpha: (_: any, p: any) => p.alpha ?? 0.16,
      },
      primitive: 'triangles', count: regl.prop('count'), depth: { enable:false }, blend: { enable:true, func:{ srcRGB:'one', srcAlpha:'one', dstRGB:'one', dstAlpha:'one' } }
    })

    const bgPosition = regl.buffer(bg.nodes)
    const bgSize = regl.buffer(bg.size)
    const bgAlpha = regl.buffer(bg.alpha)
    const bgSeed = regl.buffer((bg as any).seed)

    fgPositionRef.current = regl.buffer({ length: 0 })
    fgSizeRef.current = regl.buffer({ length: 0 })
    fgAlphaRef.current = regl.buffer({ length: 0 })

    const t0 = performance.now()
    let frames = 0
    let lastReport = t0
    function frame() {
      timeRef.current = (performance.now() - t0) / 1000
      regl.clear({ color: [0.04, 0.04, 0.07, 1], depth: 1 })
      // login-style pastel nodes: flatter color, capped size
      drawPoints({ position: bgPosition, aSize: bgSize, aAlpha: bgAlpha, aSeed: bgSeed, count: bg.count, uColor: [0.70, 0.62, 0.94], uJitterAmp: 0.004, uSizeScale: 0.9, uMaxSizePx: 3.0 })
      const t = tileRef.current
      if (t) {
        drawPoints({ position: fgPositionRef.current, aSize: fgSizeRef.current, aAlpha: fgAlphaRef.current, aSeed: fgSeedRef.current, count: t.count, uColor: [0.96, 0.58, 0.90], uJitterAmp: 0.002, uSizeScale: 1.0, uMaxSizePx: 3.2 })
        if (edgeCountRef.current && edgeCountRef.current <= 8000) { drawLines() }
        const gm = glowMeshRef.current
        if (gm && gm.count) {
          const show = (cameraRef.current.zoom > 0.9) || (gm.count <= 6000*6)
          if (show) drawEdgesGlow(gm)
        }
      }
      frames++
      const now = performance.now()
      if (now - lastReport > 500) {
        const fps = frames * 1000 / (now - lastReport)
        frames = 0; lastReport = now
        try { props.onStats?.(fps, tileRef.current?.count ?? 0) } catch {}
      }
      rafRef.current = requestAnimationFrame(frame)
    }

    function applySize(){
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        try { ((regl as any)._gl as WebGLRenderingContext).viewport(0, 0, w, h) } catch {}
      }
    }
    // Resize once after layout settles
    requestAnimationFrame(applySize)
    let ro: any = null
    if ((window as any).ResizeObserver) {
      ro = new (window as any).ResizeObserver(() => applySize())
      ro.observe(canvas)
    }
    window.addEventListener('resize', applySize)
    // click-to-pick
    let downX = 0, downY = 0
    const onDown = (e: MouseEvent) => { downX = e.clientX; downY = e.clientY }
    const onUp = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return
      const positions = posRef.current; const t = tileRef.current
      if (!positions || !t) return
      const w = canvas.width, h = canvas.height
      const toPx = (vx: number, vy: number) => {
        const ndcX = cameraRef.current.zoom * vx + cameraRef.current.offset[0]
        const ndcY = cameraRef.current.zoom * vy + cameraRef.current.offset[1]
        return [ (ndcX*0.5+0.5)*w, (ndcY*0.5+0.5)*h ] as const
      }
      let best = -1; let bestD = 1e9
      const threshold = 18
      for (let i = 0; i < t.count; i++){
        const x = positions[i*2], y = positions[i*2+1]
        const [sx, sy] = toPx(x, y)
        const d = Math.hypot(sx - e.clientX * (window.devicePixelRatio||1), sy - e.clientY * (window.devicePixelRatio||1))
        if (d < bestD) { bestD = d; best = i }
      }
      if (best >= 0 && bestD <= threshold * (window.devicePixelRatio||1)) {
        pickedRef.current = best
        try { props.onPick?.(best) } catch {}
      }
    }
    canvas.addEventListener('mousedown', onDown as any)
    canvas.addEventListener('mouseup', onUp as any)
    // hotkeys
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+') setCamera(c=>({ ...c, zoom: Math.min(2.5, c.zoom*1.1) }))
      else if (e.key === '-') setCamera(c=>({ ...c, zoom: Math.max(0.5, c.zoom*0.9) }))
      else if (e.key === 'r' || e.key === 'R') setCamera({ zoom:1, offset:[0,0] })
      else if (e.key === 'Escape') { try { props.onClear?.() } catch {} }
    }
    window.addEventListener('keydown', onKey)

    let dragging = false
    let lastX = 0, lastY = 0
    canvas.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY })
    window.addEventListener('mouseup', () => dragging = false)
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const dx = (e.clientX - lastX) / (canvas.clientWidth / 2)
      const dy = (e.clientY - lastY) / (canvas.clientHeight / 2)
      lastX = e.clientX; lastY = e.clientY
      setCamera((c) => ({ ...c, offset: [c.offset[0] + dx, c.offset[1] - dy] as [number, number] }))
    })
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const sign = e.deltaY > 0 ? 0.9 : 1.1
      setCamera((c) => ({ ...c, zoom: Math.max(0.5, Math.min(2.5, c.zoom * sign)) }))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('wheel', onWheel, { passive: false })

    frame()

    return () => {
      window.removeEventListener('resize', applySize)
      try { cancelAnimationFrame(rafRef.current) } catch {}
      canvas.removeEventListener('mousedown', onDown as any)
      canvas.removeEventListener('mouseup', onUp as any)
      window.removeEventListener('keydown', onKey)
      try { window.removeEventListener('wheel', onWheel as any) } catch {}
      try { canvas.removeEventListener('wheel', onWheel as any) } catch {}
      try { ro && ro.disconnect() } catch {}
      fgPositionRef.current?.destroy?.()
      fgSizeRef.current?.destroy?.()
      fgAlphaRef.current?.destroy?.()
      fgSeedRef.current?.destroy?.()
      edgePosRef.current?.destroy?.()
      try { if (glowMeshRef.current) { glowMeshRef.current.bufs.bufPos.destroy?.(); glowMeshRef.current.bufs.bufOther.destroy?.(); glowMeshRef.current.bufs.bufSide.destroy?.(); } } catch {}
      regl.destroy()
    }
  }, [bg.alpha, bg.count, bg.nodes, bg.size])

  // Update foreground buffers when tile changes without recreating regl
  useEffect(() => {
    tileRef.current = tile
    const regl = reglRef.current
    if (!regl || !tile) return
    fgPositionRef.current?.destroy?.()
    fgSizeRef.current?.destroy?.()
    fgAlphaRef.current?.destroy?.()
    fgSeedRef.current?.destroy?.()
    // optionally switch to concentric layout
    let source = tile.nodes
    if (props.concentric && tile.count > 1) {
      if (!originalPosRef.current) originalPosRef.current = new Float32Array(tile.nodes)
      const rings = 3
      const out = new Float32Array(tile.count * 2)
      out[0] = 0; out[1] = 0
      let idx = 1
      for (let r = 0; r < rings; r++){
        const ringCount = Math.ceil((tile.count-1) / rings)
        const rad = 0.28 + r * 0.32
        for (let k = 0; k < ringCount && idx < tile.count; k++, idx++){
          const a = (k / ringCount) * Math.PI * 2
          out[idx*2] = Math.cos(a) * rad + (Math.random()*2-1)*0.012
          out[idx*2+1] = Math.sin(a) * rad + (Math.random()*2-1)*0.012
        }
      }
      source = out
    } else if (originalPosRef.current) {
      source = new Float32Array(originalPosRef.current)
      originalPosRef.current = null
    }
    posRef.current = source
    fgPositionRef.current = regl.buffer(source)
    fgSizeRef.current = regl.buffer(tile.size)
    baseAlphaRef.current = tile.alpha.slice()
    fgAlphaRef.current = regl.buffer(tile.alpha)
    const seeds = new Float32Array(tile.count)
    for (let i = 0; i < tile.count; i++) seeds[i] = Math.random()
    fgSeedRef.current = regl.buffer(seeds)

    // Build edges if present
    edgePosRef.current?.destroy?.(); edgeCountRef.current = 0
    if (tile.edges && tile.edges.length >= 2) {
      const m = tile.edges.length >>> 1
      const seg = new Float32Array(m * 4) // [ax,ay,bx,by] per segment
      for (let i = 0; i < m; i++){
        const s = tile.edges[i*2] | 0
        const t2 = tile.edges[i*2+1] | 0
        seg[i*4] = source[s*2]; seg[i*4+1] = source[s*2+1]
        seg[i*4+2] = source[t2*2]; seg[i*4+3] = source[t2*2+1]
      }
      edgePosRef.current = regl.buffer(seg)
      edgeCountRef.current = m
      // build glow mesh
      try { glowMeshRef.current = buildEdgeQuads(regl, { nodes: source, edges: tile.edges, count: tile.count }, 6000) } catch { glowMeshRef.current = null }
    } else {
      glowMeshRef.current = null
    }

    // auto-fit the foreground to view on load
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const n = tile.count
    const xy = tile.nodes
    for (let i = 0; i < n; i++) {
      const x = xy[i*2]
      const y = xy[i*2+1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const cx = (minX + maxX) * 0.5
    const cy = (minY + maxY) * 0.5
    const w = Math.max(1e-5, maxX - minX)
    const h = Math.max(1e-5, maxY - minY)
    const target = 1.8 // fit within roughly [-0.9,0.9]
    const z = Math.min(target / w, target / h)
    setCamera({ zoom: Math.max(0.5, Math.min(2.5, z)), offset: [-cx, -cy] })
  }, [tile])

  // Apply edge-type mask from props.filters to alpha and re-upload
  useEffect(() => {
    const t = tileRef.current
    const regl = reglRef.current
    if (!t || !regl || !fgAlphaRef.current) return
    const base = baseAlphaRef.current || t.alpha
    const filters = props.filters || { email:false, work:false, social:false, phone:false }
    const mask = (filters.email?1:0) | (filters.work?2:0) | (filters.social?4:0) | (filters.phone?8:0)
    const next = new Float32Array(t.count)
    if (mask === 0 || !t.flags) {
      for (let i = 0; i < t.count; i++) next[i] = base[i]
    } else {
      const flags: any = (t as any).flags
      for (let i = 0; i < t.count; i++) {
        next[i] = ((flags[i] & mask) !== 0) ? base[i] : 0
      }
    }
    try { fgAlphaRef.current.destroy?.() } catch {}
    fgAlphaRef.current = regl.buffer(next)
  }, [props.filters])

  return <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100vw', height:'100vh', display:'block' }} />
})

export default ReglScene


