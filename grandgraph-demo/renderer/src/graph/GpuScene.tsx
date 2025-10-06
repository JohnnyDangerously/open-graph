import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import createREGL from 'regl'
import type { ParsedTile } from './parse'
import type { GraphSceneHandle, GraphSceneProps, WorldBounds } from './types'

type Camera = { scale: number, tx: number, ty: number }

// Simple FPS meter (EMA of frame time)
function makeFpsMeter(){
  let last = performance.now()
  let ema = 16.7
  return function sample(onStats?: (fps:number,count:number)=>void, count:number){
    const now = performance.now()
    const dt = Math.max(0.0001, now - last)
    last = now
    ema = ema * 0.9 + dt * 0.1
    const fps = 1000 / ema
    if (onStats) onStats(fps, count)
    return { dt, fps }
  }
}

// Label atlas (CPU canvas → GL texture). Not SDF yet; upgrade path is to swap the rasterizer.
class LabelAtlas {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  tex: any
  regl: any
  w: number
  h: number
  x: number
  y: number
  rowH: number
  map: Map<string, { u0:number,v0:number,u1:number,v1:number, w:number, h:number }>
  dirty: boolean
  constructor(regl:any, w=2048, h=2048){
    this.regl = regl
    this.w = w; this.h = h
    this.canvas = document.createElement('canvas')
    this.canvas.width = w; this.canvas.height = h
    const ctx = this.canvas.getContext('2d')!
    this.ctx = ctx
    // base clear
    ctx.fillStyle = 'rgba(0,0,0,0)'
    ctx.clearRect(0,0,w,h)
    ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto'
    ctx.textBaseline = 'middle'
    this.tex = regl.texture({ data: this.canvas, min: 'linear', mag: 'linear', flipY: false })
    this.x = 2; this.y = 2; this.rowH = 18
    this.map = new Map()
    this.dirty = false
  }
  get(text:string){
    let rec = this.map.get(text)
    if (rec) return rec
    const pad = 6
    const m = this.ctx.measureText(text)
    const w = Math.min(this.w - 4, Math.max(8, Math.ceil(m.width + pad*2)))
    const h = 18
    if (this.x + w + 2 > this.w) { this.x = 2; this.y += this.rowH + 2; this.rowH = h }
    if (this.y + h + 2 > this.h) {
      // Reset (very rare for our budgets); in future, switch to LRU
      this.ctx.clearRect(0,0,this.w,this.h)
      this.map.clear(); this.x = 2; this.y = 2; this.rowH = h
    }
    // Draw pill background + text into atlas
    const x = this.x, y = this.y
    this.ctx.save()
    this.ctx.fillStyle = 'rgba(10,10,14,0.92)'
    this.ctx.strokeStyle = 'rgba(255,255,255,0.20)'
    this.ctx.lineWidth = 1
    const r = 8
    const cx = x + w/2, cy = y + h/2
    this.ctx.beginPath()
    this.ctx.moveTo(x + r, y)
    this.ctx.arcTo(x + w, y, x + w, y + h, r)
    this.ctx.arcTo(x + w, y + h, x, y + h, r)
    this.ctx.arcTo(x, y + h, x, y, r)
    this.ctx.arcTo(x, y, x + w, y, r)
    this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke()
    this.ctx.fillStyle = '#fff'
    this.ctx.fillText(text, cx - (m.width/2), cy + 1)
    this.ctx.restore()
    this.rowH = Math.max(this.rowH, h)
    this.dirty = true
    this.x += w + 6
    rec = { u0: x/this.w, v0: y/this.h, u1:(x+w)/this.w, v1:(y+h)/this.h, w, h }
    this.map.set(text, rec)
    return rec
  }
  commit(){ if (this.dirty){ this.tex({ data: this.canvas }); this.dirty = false } }
  destroy(){ try{ this.tex.destroy() }catch{} }
}

// Helpers
function clamp(x:number, a:number, b:number){ return Math.max(a, Math.min(b, x)) }
function easeInOutQuad(t:number){ return t<0.5 ? 2*t*t : -1 + (4 - 2*t)*t }

function viewportWorld(cam:Camera, W:number, H:number): WorldBounds {
  const minX = (-cam.tx) / cam.scale
  const maxX = (W - cam.tx) / cam.scale
  const minY = (-cam.ty) / cam.scale
  const maxY = (H - cam.ty) / cam.scale
  const width = maxX - minX, height = maxY - minY
  const center = { x:(minX+maxX)/2, y:(minY+maxY)/2 }
  return { minX, maxX, minY, maxY, width, height, center }
}

const GpuScene = forwardRef<GraphSceneHandle, GraphSceneProps>(function GpuScene(props, ref){
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reglRef = useRef<any>(null)
  const tileRef = useRef<ParsedTile | null>(null)
  const [tile, setTile] = useState<ParsedTile | null>(null)
  const cameraRef = useRef<Camera>({ scale: 1, tx: 0, ty: 0 })
  const visibleMaskRef = useRef<boolean[] | null>(null)
  const selectedIndexRef = useRef<number | null>(null)
  const rafRef = useRef<number>(0)
  const fpsMeter = useMemo(()=> makeFpsMeter(), [])

  // Budgets (adaptive)
  const budgetsRef = useRef({ maxLabels: 220, maxEdges: 8000, nodeStride: 1 })
  const frameTimeEMARef = useRef(16.7)

  // GL resources
  const bufsRef = useRef<{ pos?: any, size?: any, alpha?: any, seed?: any, edgeSegments?: any } & Record<string, any>>({})
  const countsRef = useRef<{ nodes: number, edges: number }>({ nodes: 0, edges: 0 })
  const atlasRef = useRef<LabelAtlas | null>(null)

  // Update props mirrors
  useEffect(()=>{ visibleMaskRef.current = (Array.isArray(props.visibleMask) ? props.visibleMask : null) }, [props.visibleMask])
  useEffect(()=>{ selectedIndexRef.current = (typeof props.selectedIndex === 'number' ? props.selectedIndex : null) }, [props.selectedIndex])

  useImperativeHandle(ref, () => ({
    setForeground: (fg: ParsedTile) => {
      setTile(fg)
    },
    clear: () => {
      setTile(null)
      props.onClear?.()
    },
    focusIndex: (index: number, opts?: { zoom?: number, zoomMultiplier?: number, animate?: boolean, ms?: number }) => {
      try {
        const t = tileRef.current; if (!t) return
        if (index < 0 || index >= t.count) return
        const wx = t.nodes[index*2], wy = t.nodes[index*2+1]
        const base = cameraRef.current
        const endScale = clamp(
          (typeof opts?.zoom === 'number' ? opts.zoom : base.scale * (opts?.zoomMultiplier || 1)),
          0.2, 3.5
        )
        const ms = Math.max(120, Math.min(1200, (opts?.ms ?? 560)))
        const start = { ...base }
        const W = canvasRef.current!.clientWidth
        const H = canvasRef.current!.clientHeight
        const startSx = wx * start.scale + start.tx
        const startSy = wy * start.scale + start.ty
        const endSx = W/2, endSy = H/2
        const startScale = start.scale
        const st = performance.now()
        const step = (now:number)=>{
          const t01 = clamp((now - st)/ms, 0, 1)
          const e = opts?.animate===false ? 1 : easeInOutQuad(t01)
          const s = startScale + (endScale - startScale) * e
          const sx = startSx + (endSx - startSx) * e
          const sy = startSy + (endSy - startSy) * e
          cameraRef.current = { scale: s, tx: sx - wx*s, ty: sy - wy*s }
          if (t01 < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      } catch {}
    },
    reshapeLayout: () => {},
    getCamera: () => {
      const c = cameraRef.current
      const width = canvasRef.current?.clientWidth || 1
      const height = canvasRef.current?.clientHeight || 1
      const vp = viewportWorld(c, width, height)
      return { scale: c.scale, tx: c.tx, ty: c.ty, viewportCss: { width, height }, viewportWorld: vp }
    },
    measureForegroundBounds: (opts?: { mask?: boolean[] | null, groupId?: number | null, dropPercentile?: number }): WorldBounds | null => {
      const t = tileRef.current; if (!t) return null
      const n = t.count|0
      const mask = (opts?.mask && opts.mask.length===n) ? opts?.mask : visibleMaskRef.current
      const groupId = typeof opts?.groupId === 'number' ? opts.groupId : null
      let minX= Infinity, minY= Infinity, maxX= -Infinity, maxY= -Infinity
      for (let i=0;i<n;i++){
        if (mask && !mask[i]) continue
        if (groupId!=null && (t.group?.[i] ?? -1) !== groupId) continue
        const x = t.nodes[i*2], y = t.nodes[i*2+1]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
      if (!Number.isFinite(minX)) return null
      const width = maxX - minX, height = maxY - minY
      const center = { x:(minX+maxX)/2, y:(minY+maxY)/2 }
      return { minX, maxX, minY, maxY, width, height, center }
    },
    measureGroupBounds: (groupId:number, opts?: { mask?: boolean[] | null, dropPercentile?: number }) => {
      const t = tileRef.current; if (!t) return null
      const n = t.count|0
      const mask = (opts?.mask && opts.mask.length===n) ? opts?.mask : visibleMaskRef.current
      let minX= Infinity, minY= Infinity, maxX= -Infinity, maxY= -Infinity
      for (let i=0;i<n;i++){
        if (mask && !mask[i]) continue
        if ((t.group?.[i] ?? -1) !== groupId) continue
        const x = t.nodes[i*2], y = t.nodes[i*2+1]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
      if (!Number.isFinite(minX)) return null
      const width = maxX - minX, height = maxY - minY
      const center = { x:(minX+maxX)/2, y:(minY+maxY)/2 }
      return { minX, maxX, minY, maxY, width, height, center }
    },
    getVisibilityForBounds: (bounds: WorldBounds) => {
      const cam = cameraRef.current
      const width = canvasRef.current?.clientWidth || 1
      const height = canvasRef.current?.clientHeight || 1
      const vp = viewportWorld(cam, width, height)
      const ix = Math.max(0, Math.min(vp.maxX, bounds.maxX) - Math.max(vp.minX, bounds.minX))
      const iy = Math.max(0, Math.min(vp.maxY, bounds.maxY) - Math.max(vp.minY, bounds.minY))
      const inter = ix * iy
      const area = Math.max(1e-3, bounds.width * bounds.height)
      return { visibleFraction: clamp(inter / area, 0, 1), viewport: vp }
    },
  }), [props])

  // Build GL and the frame loop
  useEffect(() => {
    const canvas = canvasRef.current!
    if (!canvas) return
    // Fit to container
    canvas.style.width = '100%'; canvas.style.height = '100%'
    let dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
    const syncCanvasSize = () => {
      dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h }
    }
    syncCanvasSize()
    const regl = createREGL({ canvas, attributes: { antialias: true }, pixelRatio: dpr })
    reglRef.current = regl
    const atlas = new LabelAtlas(regl)
    atlasRef.current = atlas

    // Node points
    const drawPoints = regl({
      vert: `
      precision mediump float;
      attribute vec2 a_pos;
      attribute float a_size;
      attribute float a_alpha;
      attribute float a_seed;
      uniform float u_scale;
      uniform vec2  u_trans;
      uniform vec2  u_view;
      uniform float u_dpr;
      uniform float u_time;
      uniform float u_sizeScale;
      uniform float u_maxSizePx;
      varying float v_alpha;
      void main(){
        float s = a_seed * 6.2831853;
        float wob = sin(u_time*0.7 + s*3.1)*0.5 + cos(u_time*0.37 + s*2.7)*0.5;
        vec2 jitter = vec2(cos(s*1.97), sin(s*2.31)) * wob * 0.0035;
        vec2 p = a_pos * u_scale + u_trans + jitter * u_scale;
        vec2 clip = (p / (0.5 * u_view)) - 1.0;
        gl_Position = vec4(clip, 0.0, 1.0);
        gl_PointSize = min(a_size * u_dpr * u_sizeScale, u_maxSizePx);
        v_alpha = a_alpha;
      }`,
      // We replace the vert above with one that uses viewport; workaround in the command below
      frag: `
      precision mediump float;
      uniform vec3 u_color;
      varying float v_alpha;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c); float a = smoothstep(0.25, 0.0, d) * v_alpha; gl_FragColor = vec4(u_color, a); }`,
      attributes: {
        a_pos: () => bufsRef.current.pos,
        a_size: () => bufsRef.current.size,
        a_alpha: () => bufsRef.current.alpha,
        a_seed: () => bufsRef.current.seed,
      },
      uniforms: {
        u_scale: () => cameraRef.current.scale,
        u_trans: () => [cameraRef.current.tx, cameraRef.current.ty],
        u_view: ({viewportWidth,viewportHeight}:any)=>[viewportWidth,viewportHeight],
        u_dpr: () => dpr,
        u_time: () => (performance.now()%1e9)/1000,
        u_sizeScale: (_:any,p:any)=> p.u_sizeScale ?? 1.0,
        u_maxSizePx: (_:any,p:any)=> p.u_maxSizePx ?? 6.0,
        u_color: (_:any,p:any)=> p.u_color ?? [1.0,0.65,0.0],
      },
      primitive: 'points', count: () => countsRef.current.nodes,
      blend:{ enable:true, func:{ srcRGB:'src alpha', srcAlpha:'one', dstRGB:'one minus src alpha', dstAlpha:'one minus src alpha' } },
    })

    // Simple lines for edges (fallback/zoomed out)
    const drawLines = regl({
      vert: `precision mediump float; attribute vec2 a_pos; uniform float u_scale; uniform vec2 u_trans; uniform vec2 u_view; void main(){ vec2 p = a_pos * u_scale + u_trans; vec2 clip = (p / (0.5*u_view)) - 1.0; gl_Position = vec4(clip, 0.0, 1.0); }`,
      frag: `precision mediump float; uniform vec4 u_rgba; void main(){ gl_FragColor = u_rgba; }`,
      attributes: { a_pos: () => bufsRef.current.edgeSegments },
      uniforms: { u_scale: () => cameraRef.current.scale, u_trans: () => [cameraRef.current.tx, cameraRef.current.ty], u_view: ({viewportWidth,viewportHeight}:any)=>[viewportWidth,viewportHeight], u_rgba: (_:any,p:any)=> p.u_rgba ?? [0.73,0.74,0.78,0.36] },
      primitive: 'lines', count: () => countsRef.current.edges * 2,
      depth: { enable:false }, blend:{ enable:true, func:{ srcRGB:'src alpha', srcAlpha:'one', dstRGB:'one minus src alpha', dstAlpha:'one minus src alpha' } }
    })

    // Label quads (CPU-expanded for now)
    const labelBufs = { pos: regl.buffer({ length: 0 }), uv: regl.buffer({ length: 0 }), misc: regl.buffer({ length: 0 }) }
    let labelCount = 0
    const drawLabels = regl({
      vert: `
      precision mediump float;
      attribute vec2 a_xy;      // vertex corner in screen px
      attribute vec2 a_uv;      // uv per-vertex
      attribute float a_alpha;  // alpha per-label (packed)
      uniform vec2 u_view;      // viewport px
      varying vec2 v_uv; varying float v_a;
      void main(){ vec2 clip = (a_xy / (0.5*u_view)) - 1.0; gl_Position = vec4(clip, 0.0, 1.0); v_uv = a_uv; v_a = a_alpha; }
      `,
      frag: `
      precision mediump float; varying vec2 v_uv; varying float v_a; uniform sampler2D u_atlas; void main(){ vec4 s = texture2D(u_atlas, v_uv); gl_FragColor = vec4(s.rgb, s.a * v_a); }
      `,
      attributes: { a_xy: () => labelBufs.pos, a_uv: () => labelBufs.uv, a_alpha: () => labelBufs.misc },
      uniforms: { u_view: ({viewportWidth,viewportHeight}:any)=>[viewportWidth,viewportHeight], u_atlas: () => atlas.tex },
      count: () => labelCount,
      primitive: 'triangles', depth: { enable:false }, blend:{ enable:true, func:{ srcRGB:'src alpha', srcAlpha:'one', dstRGB:'one minus src alpha', dstAlpha:'one minus src alpha' } }
    })

    // Resize observer
    const ro = new ResizeObserver(()=>{ syncCanvasSize() })
    ro.observe(canvas)

    // Frame loop
    const frame = regl.frame(({ viewportWidth, viewportHeight }: any) => {
      regl.clear({ color: [0.04, 0.04, 0.07, 1], depth: 1 })

      // Dynamic budgets based on EMA of frame time
      const ema = frameTimeEMARef.current
      const budgets = budgetsRef.current
      if (ema > 18) { // over budget → degrade
        budgets.maxLabels = Math.max(50, Math.floor(budgets.maxLabels * 0.9))
        budgets.maxEdges = Math.max(2000, Math.floor(budgets.maxEdges * 0.9))
        budgets.nodeStride = Math.min(8, Math.max(1, Math.ceil(budgets.nodeStride * 1.25)))
      } else if (ema < 14) { // under budget → improve carefully
        budgets.maxLabels = Math.min(1200, budgets.maxLabels + 20)
        budgets.maxEdges = Math.min(60000, budgets.maxEdges + 1000)
        budgets.nodeStride = Math.max(1, budgets.nodeStride - 1)
      }

      // Draw nodes
      if (countsRef.current.nodes > 0) {
        // Softer bluish-white nodes that read through edges
        drawPoints({ u_sizeScale: 1.1, u_maxSizePx: 7.0, u_color: [0.86, 0.90, 1.0] })
      }
      // Draw edges (thinned by budget and zoom pre-processing)
      if (countsRef.current.edges > 0 && cameraRef.current.scale > 0.65) {
        drawLines({ u_rgba: [0.73, 0.74, 0.78, 0.36] })
      }

      // Labels: build quads in screen space with a small budget and collision grid
      try {
        const t = tileRef.current
        if (t && t.labels && t.labels.length === t.count) {
          const picked = buildLabelsScreenSpace(t, viewportWidth, viewportHeight)
          if (picked && picked.count > 0) {
            if (labelBufs.pos) labelBufs.pos.destroy?.(); if (labelBufs.uv) labelBufs.uv.destroy?.(); if (labelBufs.misc) labelBufs.misc.destroy?.()
            labelBufs.pos = regl.buffer(picked.xy)
            labelBufs.uv = regl.buffer(picked.uv)
            labelBufs.misc = regl.buffer(picked.alpha)
            labelCount = picked.count * 6
            atlas.commit()
            drawLabels()
          } else {
            labelCount = 0
          }
        } else { labelCount = 0 }
      } catch {}

      // FPS report
      const { dt, fps } = fpsMeter(props.onStats, tileRef.current?.count || 0)
      frameTimeEMARef.current = frameTimeEMARef.current * 0.9 + dt * 0.1
    })
    rafRef.current = frame as unknown as number


    function buildLabelsScreenSpace(t: ParsedTile, W:number, H:number){
      const labels = (t as any).labels as string[] | undefined
      if (!labels) return null
      const n = t.count|0
      const cam = cameraRef.current
      const maxLabels = budgetsRef.current.maxLabels
      const mask = visibleMaskRef.current
      const selected = selectedIndexRef.current
      // collision grid
      const cell = 20
      const cols = Math.ceil(W / cell)
      const rows = Math.ceil(H / cell)
      const occ = new Uint8Array(cols*rows)
      const pick: Array<{ i:number, x:number, y:number, w:number, h:number, alpha:number } > = []
      const push = (i:number, sx:number, sy:number, w:number, h:number, alpha:number)=>{
        // coarse occupancy over bbox
        const x0 = Math.floor((sx - w/2)/cell), x1 = Math.floor((sx + w/2)/cell)
        const y0 = Math.floor((sy - h/2)/cell), y1 = Math.floor((sy + h/2)/cell)
        for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
          if (x<0||y<0||x>=cols||y>=rows) return // reject if outside
          if (occ[y*cols + x]) return
        }
        for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) occ[y*cols + x] = 1
        pick.push({ i, x:sx, y:sy, w, h, alpha })
      }
      let budget = maxLabels
      // Two-pass: selected and anchors first, then the rest
      const order: number[] = []
      if (typeof selected === 'number' && selected >=0 && selected < n) order.push(selected)
      order.push(0,1)
      for (let i=0;i<n;i++){ if (i!==selected && i!==0 && i!==1) order.push(i) }
      for (let oi=0;oi<order.length && budget>0;oi++){
        const i = order[oi]
        if (mask && mask.length===n && !mask[i]) continue
        const x = t.nodes[i*2], y = t.nodes[i*2+1]
        const sx = x * cam.scale + cam.tx
        const sy = y * cam.scale + cam.ty
        const inView = sx >= -40 && sx <= W+40 && sy >= -40 && sy <= H+40
        if (!inView) continue
        const label = labels[i]
        if (!label) continue
        const rec = atlas.get(label)
        const alpha = (typeof selected === 'number' && selected !== i && (props.maskMode||'hide')==='dim') ? 0.35 : 1.0
        // Keep labels fully on-screen; clamp center to bounds with small margin
        const margin = 8
        const cx = clamp(sx, rec.w/2 + margin, W - rec.w/2 - margin)
        const cy = clamp(sy - 16, rec.h/2 + margin, H - rec.h/2 - margin)
        push(i, cx, cy, rec.w, rec.h, alpha)
        budget--
      }
      if (pick.length === 0) return { count: 0, xy: new Float32Array(0), uv: new Float32Array(0), alpha: new Float32Array(0) }
      // expand into triangles
      const V = pick.length * 6
      const xy = new Float32Array(V*2)
      const uv = new Float32Array(V*2)
      const alpha = new Float32Array(V)
      let w=0
      for (const p of pick){
        const rec = atlas.get(labels[p.i])
        const x0 = p.x - p.w/2, y0 = p.y - p.h/2
        const x1 = p.x + p.w/2, y1 = p.y + p.h/2
        const vx = [x0,x1,x0,x0,x1,x1]
        const vy = [y0,y0,y1,y0,y1,y1]
        // UV inset to avoid sampling edge bleed (0.5px)
        const du = 0.5 / atlas.w, dv = 0.5 / atlas.h
        const uu = [rec.u0+du,rec.u1-du,rec.u0+du,rec.u0+du,rec.u1-du,rec.u1-du]
        const vv = [rec.v0+dv,rec.v0+dv,rec.v1-dv,rec.v0+dv,rec.v1-dv,rec.v1-dv]
        for (let k=0;k<6;k++,w++){
          xy[2*w] = vx[k]; xy[2*w+1] = vy[k]
          uv[2*w] = uu[k]; uv[2*w+1] = vv[k]
          alpha[w] = p.alpha
        }
      }
      return { count: pick.length, xy, uv, alpha }
    }

    

    // Cleanup
    return () => {
      try { frame.cancel() } catch {}
      try { ro.disconnect() } catch {}
      try { Object.values(bufsRef.current).forEach((b:any)=> b && b.destroy && b.destroy()) } catch {}
      try { atlas.destroy() } catch {}
      try { regl.destroy() } catch {}
    }
  }, [])

  // Tile updates: build buffers and caps per budgets/zoom
  useEffect(() => {
    tileRef.current = tile
    const regl = reglRef.current
    if (!regl) return
    // destroy previous
    try { Object.values(bufsRef.current).forEach((b:any)=> b && b.destroy && b.destroy()); bufsRef.current = {} } catch {}
    countsRef.current = { nodes: 0, edges: 0 }
    if (!tile) return

    // Node buffers
    const n = tile.count|0
    const stride = budgetsRef.current.nodeStride|0 || 1
    const pos = new Float32Array(Math.ceil(n/stride)*2)
    const size = new Float32Array(Math.ceil(n/stride))
    const alpha = new Float32Array(Math.ceil(n/stride))
    const seed = new Float32Array(Math.ceil(n/stride))
    let w = 0
    const mask = visibleMaskRef.current
    const mode = (props.maskMode || 'hide')
    for (let i=0;i<n;i+=stride){
      if (mode==='hide' && mask && mask.length===n && !mask[i]) continue
      pos[w*2] = tile.nodes[i*2]; pos[w*2+1] = tile.nodes[i*2+1]
      size[w] = tile.size?.[i] ?? 3.0
      const dimmed = mode==='dim' && mask && mask.length===n && !mask[i]
      alpha[w] = (tile.alpha?.[i] ?? 1.0) * (dimmed ? 0.28 : 1.0)
      seed[w] = Math.random()
      w++
    }
    bufsRef.current.pos = regl.buffer(pos.subarray(0, w*2))
    bufsRef.current.size = regl.buffer(size.subarray(0, w))
    bufsRef.current.alpha = regl.buffer(alpha.subarray(0, w))
    bufsRef.current.seed = regl.buffer(seed.subarray(0, w))
    countsRef.current.nodes = w

    // Edge segments (screen-space thinning precomputed here by zoom heuristic)
    if (tile.edges && tile.edges.length >= 2){
      const E = tile.edges.length >>> 1
      // Per-node cap (top-K) is assumed pre-built upstream for bridges; here apply global cap + zoom thinning
      const cap = Math.min(budgetsRef.current.maxEdges, E)
      const seg = new Float32Array(cap * 4)
      let ew = 0
      const zoom = cameraRef.current.scale
      const step = (zoom < 0.8 && E > 3000) ? Math.ceil(E / Math.min(cap, 3000)) : Math.max(1, Math.floor(E / cap))
      const m = visibleMaskRef.current
      const hide = (props.maskMode||'hide')==='hide'
      const mode = (tile as any)?.meta?.mode as string | undefined
      const degMode = props.degreeHighlight || 'all'
      for (let i=0;i<E && ew<cap;i+=step){
        const s = tile.edges[i*2]|0, t2 = tile.edges[i*2+1]|0
        if (m && m.length===n){
          const sv = !!m[s], tv = !!m[t2]
          if (hide && (!sv || !tv)) continue
        }
        if (mode === 'person' && degMode !== 'all'){
          const isFirst = (s===0 || t2===0)
          if (degMode === 'first' && !isFirst) continue
          if (degMode === 'second' && isFirst) continue
        }
        const sx = tile.nodes[s*2], sy = tile.nodes[s*2+1]
        const tx = tile.nodes[t2*2], ty = tile.nodes[t2*2+1]
        // screen length filter (~1px)
        const W = canvasRef.current?.clientWidth || 1
        const H = canvasRef.current?.clientHeight || 1
        const p0x = sx * zoom + cameraRef.current.tx, p0y = sy * zoom + cameraRef.current.ty
        const p1x = tx * zoom + cameraRef.current.tx, p1y = ty * zoom + cameraRef.current.ty
        if (p0x<-8&&p1x<-8) continue; if (p0x>W+8&&p1x>W+8) continue; if (p0y<-8&&p1y<-8) continue; if (p0y>H+8&&p1y>H+8) continue
        const sl = Math.hypot(p1x-p0x,p1y-p0y)
        if (sl < 1.0) continue
        seg[ew*4] = sx; seg[ew*4+1] = sy; seg[ew*4+2] = tx; seg[ew*4+3] = ty
        ew++
      }
      bufsRef.current.edgeSegments = regl.buffer(seg.subarray(0, ew*4))
      countsRef.current.edges = ew
    }

    // Auto-fit on load
    try {
      let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity
      for (let i=0;i<tile.count;i++){ const x=tile.nodes[i*2], y=tile.nodes[i*2+1]; if (x<minX) minX=x; if (x>maxX) maxX=x; if (y<minY) minY=y; if (y>maxY) maxY=y }
      const W = canvasRef.current?.clientWidth || 1
      const H = canvasRef.current?.clientHeight || 1
      const pad = 160
      const s = Math.min((W-pad*2)/(maxX-minX+1e-3),(H-pad*2)/(maxY-minY+1e-3))
      const cx=(minX+maxX)/2, cy=(minY+maxY)/2
      cameraRef.current = { scale: clamp(s, 0.2, 3.0), tx: W/2 - cx*clamp(s,0.2,3.0), ty: H/2 - cy*clamp(s,0.2,3.0) }
    } catch {}
  }, [tile, props.maskMode, props.visibleMask])

  // Input: pan/zoom + picking
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false
    let lastX = 0, lastY = 0
    const onDown = (e: MouseEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY }
    const onUp = (e: MouseEvent) => { dragging = false }
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX, dy = e.clientY - lastY
      lastX = e.clientX; lastY = e.clientY
      cameraRef.current = { ...cameraRef.current, tx: cameraRef.current.tx + dx, ty: cameraRef.current.ty + dy }
      try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { tx: cameraRef.current.tx, ty: cameraRef.current.ty }})) } catch {}
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const beforeX = (mx - cameraRef.current.tx)/cameraRef.current.scale
      const beforeY = (my - cameraRef.current.ty)/cameraRef.current.scale
      const factor = Math.exp(-e.deltaY * 0.0015)
      const newScale = clamp(cameraRef.current.scale * factor, 0.2, 3.5)
      const sx = beforeX * newScale + cameraRef.current.tx
      const sy = beforeY * newScale + cameraRef.current.ty
      const tx = cameraRef.current.tx + (mx - sx)
      const ty = cameraRef.current.ty + (my - sy)
      cameraRef.current = { scale: newScale, tx, ty }
    }
    const onClick = (e: MouseEvent) => {
      try {
        const t = tileRef.current; if (!t) return
        const rect = canvas.getBoundingClientRect()
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top
        const wx = (sx - cameraRef.current.tx) / cameraRef.current.scale
        const wy = (sy - cameraRef.current.ty) / cameraRef.current.scale
        let hit = -1
        const n = t.count|0
        const mask = visibleMaskRef.current
        // simple reverse search for pick
        for (let i=n-1;i>=0;i--){
          if (mask && mask.length===n && !mask[i]) continue
          const x=t.nodes[i*2], y=t.nodes[i*2+1]
          const dx=wx-x, dy=wy-y
          const r = Math.max(7, (t.size?.[i]||3)*2)
          const rw = r / cameraRef.current.scale
          if (dx*dx + dy*dy <= rw*rw){ hit = i; break }
        }
        if (hit>=0) props.onPick?.(hit)
      } catch {}
    }
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('click', onClick)
    return () => {
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove)
      try { canvas.removeEventListener('wheel', onWheel as any) } catch {}
      try { canvas.removeEventListener('click', onClick as any) } catch {}
    }
  }, [props.onPick])

  return (
    <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
  )
})

export default GpuScene
