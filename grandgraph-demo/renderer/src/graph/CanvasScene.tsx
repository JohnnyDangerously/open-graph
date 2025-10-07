import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ParsedTile } from './parse'
import type { GraphSceneHandle, GraphSceneProps, WorldBounds } from './types'
import { EDGE_STROKE_BASE, EDGE_STROKE_MAX, MONTHS_NORMALIZER } from '../lib/constants'

type Node = {
  x: number
  y: number
  size: number
  alpha: number
  index: number
  group: number
}

type Edge = {
  source: number
  target: number
  weight: number
}

const CanvasScene = forwardRef<GraphSceneHandle, GraphSceneProps>(function CanvasScene(props: GraphSceneProps, ref: React.ForwardedRef<GraphSceneHandle>) {
  const canvasRef = useRef(null as HTMLCanvasElement | null)
  const [tile, setTile] = useState(null as ParsedTile | null)
  const labelsRef = useRef(null as string[] | null)
  const avatarsRef = useRef(new Map<number, HTMLImageElement>())
  const avatarUrlRef = useRef<string[] | null>(null)
  const loadingSetRef = useRef(new Set<number>())
  const concurrentLoadsRef = useRef(0)
  const maxConcurrentLoadsRef = useRef(24)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [scale, setScale] = useState(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)
  const scaleRef = useRef(1)
  useEffect(()=>{ txRef.current = tx }, [tx])
  useEffect(()=>{ tyRef.current = ty }, [ty])
  useEffect(()=>{ scaleRef.current = scale }, [scale])
  const nodesRef = useRef([] as Node[])
  const visibleMaskRef = useRef(null as boolean[] | null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 } as { width: number, height: number, dpr?: number })
  
  const [highlightDegree, setHighlightDegree] = useState<'all'|'first'|'second'>('all')
  const draggingNodeRef = useRef(null as Node | null)
  const dragLastRef = useRef<{ x: number, y: number } | null>(null)
  const isPanningRef = useRef(false)
  const animFrameRef = useRef(0 as number)
  const labelHitboxesRef = useRef([] as Array<{ index:number, x:number, y:number, w:number, h:number }>)
  const labelStrideRef = useRef(7)
  const lastStrideUpdateRef = useRef(0)
  // Keep latest tile and a short trail of previous graphs (max 2)
  const tileRef = useRef(null as ParsedTile | null)
  useEffect(()=>{ tileRef.current = tile }, [tile])
  const trailRef = useRef([] as Array<{ nodes: Float32Array, size: Float32Array, alpha: Float32Array, edges?: Uint32Array, center:{x:number,y:number}, color:string }>)
  const apiRef = useRef<any>(null)
  const trailColors = ['#5ec8ff', '#ff8ac2'] // newest → oldest

  const isPersonMode = React.useMemo(()=>{
    try { return (tile as any)?.meta?.mode === 'person' } catch { return false }
  }, [tile])

  const groupStyles = React.useMemo<Record<number, { fill: string; glow: string; border: string; base: number; min: number }>>(() => ({
    0: { fill: 'rgba(243, 93, 143, 0.92)', glow: 'rgba(243, 93, 143, 0.24)', border: 'rgba(173, 44, 89, 0.95)', base: 3.6, min: 1.4 },
    1: { fill: 'rgba(255, 211, 105, 0.9)', glow: 'rgba(255, 211, 105, 0.22)', border: 'rgba(188, 140, 24, 0.95)', base: 3.9, min: 1.6 },
    2: { fill: 'rgba(74, 215, 209, 0.9)', glow: 'rgba(74, 215, 209, 0.22)', border: 'rgba(28, 152, 150, 0.95)', base: 3.6, min: 1.4 }
  }), [])

  // Deterministic string hash (FNV-1a 32-bit) to sample labels stably
  const hashStr32 = React.useCallback((s: string) => {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return h >>> 0
  }, [])

  const computeNodeRadius = React.useCallback((node: Node, scaleValue: number) => {
    // Keep nodes a constant screen-space size (no resize on zoom)
    const style = groupStyles[node.group as 0|1|2] || groupStyles[1]
    const sizeFactor = 0.56 + Math.min(0.9, Math.max(0.20, node.size * 0.55))
    const globalShrink = 3.2
    const r = Math.max(style.min * 0.72, style.base * 0.58 * sizeFactor * globalShrink)
    return Math.max(7, r)
  }, [groupStyles])

  // Convert tile data to nodes/edges
  const { nodes, edges } = React.useMemo((): { nodes: Node[], edges: Edge[] } => {
    if (!tile) return { nodes: [], edges: [] }
    
    const nodes: Node[] = []
    for (let i = 0; i < tile.count; i++) {
      const node: Node = {
        x: tile.nodes[i * 2],
        y: tile.nodes[i * 2 + 1],
        size: tile.size[i],
        alpha: tile.alpha[i],
        index: i,
        group: tile.group ? tile.group[i] : 0
      }
      nodes.push(node)
    }
    
    const edges: Edge[] = []
    if (tile.edges) {
      for (let i = 0; i < tile.edges.length; i += 2) {
        const edgeIndex = i / 2
        edges.push({
          source: tile.edges[i],
          target: tile.edges[i + 1],
          weight: tile.edgeWeights ? tile.edgeWeights[edgeIndex] ?? 1 : 1
        })
      }
    }
    return { nodes, edges }
  }, [tile])

  useEffect(()=>{ nodesRef.current = nodes }, [nodes])
  useEffect(()=>{ visibleMaskRef.current = (Array.isArray(props.visibleMask) ? props.visibleMask : null) }, [props.visibleMask])

  useImperativeHandle(ref, () => ({
    setForeground: (fg: ParsedTile, opts?: { noTrailSnapshot?: boolean }) => {
      // Determine if incoming tile is effectively the same graph (avoid creating a new off-screen copy)
      const isSameGraph = (() => {
        try {
          const prev:any = tileRef.current
          if (!prev || !prev.nodes || !fg || !(fg as any).nodes) return false
          if ((fg as any).count !== prev.count) return false
          const a = (fg as any).nodes as Float32Array
          const b = prev.nodes as Float32Array
          if (!a || !b || a.length !== b.length) return false
          // Cheap equality check: compare first 64 coordinates and overall bounding box
          const sample = Math.min(a.length, 128)
          let diffSum = 0
          for (let i=0;i<sample;i++){ diffSum += Math.abs(a[i] - b[i]) }
          if (diffSum < 1e-3) return true
          const bounds = (arr: Float32Array)=>{
            let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity
            for (let i=0;i<arr.length;i+=2){ const x=arr[i], y=arr[i+1]; if (!Number.isFinite(x)||!Number.isFinite(y)) continue; if (x<minX) minX=x; if (x>maxX) maxX=x; if (y<minY) minY=y; if (y>maxY) maxY=y }
            return { minX, maxX, minY, maxY }
          }
          const ba = bounds(a), bb = bounds(b)
          const wdiff = Math.abs((ba.maxX-ba.minX) - (bb.maxX-bb.minX))
          const hdiff = Math.abs((ba.maxY-ba.minY) - (bb.maxY-bb.minY))
          return (wdiff < 1e-3 && hdiff < 1e-3)
        } catch { return false }
      })()

      // Snapshot current tile into the trail (max 2) unless suppressed or same graph
      if (!opts?.noTrailSnapshot && !isSameGraph) {
        try {
          const prev = tileRef.current as any
          if (prev && prev.nodes && prev.size && prev.alpha) {
            const snap = {
              nodes: new Float32Array(prev.nodes),
              size: new Float32Array(prev.size),
              alpha: new Float32Array(prev.alpha),
              edges: prev.edges ? new Uint32Array(prev.edges) : undefined,
              center: (prev.focusWorld && typeof prev.focusWorld.x === 'number') ? { x: prev.focusWorld.x, y: prev.focusWorld.y } : { x: prev.nodes[0]||0, y: prev.nodes[1]||0 },
              color: trailColors[0]
            }
            const currentTrail = trailRef.current
            const nextTrail = [snap, ...currentTrail].slice(0, 2)
            for (let i=0;i<nextTrail.length;i++) nextTrail[i].color = trailColors[i] || '#88a'
            trailRef.current = nextTrail
          }
        } catch {}
      }
      // Compute previous center if any (skip offset if same graph)
      let hasPrev = false
      let prevCenter = { x: 0, y: 0 }
      try {
        const prev:any = tileRef.current
        if (prev) {
          hasPrev = true
          if (prev?.focusWorld && typeof prev.focusWorld.x==='number') prevCenter = { x: prev.focusWorld.x, y: prev.focusWorld.y }
          else if (prev?.nodes && prev.nodes.length>=2) prevCenter = { x: prev.nodes[0]||0, y: prev.nodes[1]||0 }
        }
      } catch {}

      // Shift incoming tile to the RIGHT of previous center and align Y, then set as foreground
      const next:any = fg as any
      try {
        let newCenter = { x: 0, y: 0 }
        if (next?.focusWorld && typeof next.focusWorld.x==='number') newCenter = { x: next.focusWorld.x, y: next.focusWorld.y }
        else if (next?.nodes && next.nodes.length>=2) newCenter = { x: next.nodes[0]||0, y: next.nodes[1]||0 }
        if (hasPrev && !isSameGraph) {
          // Compute dynamic spacing: half-width(prev) + half-width(next) + padding
          const bounds = (arr: Float32Array)=>{
            let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity
            for (let i=0;i<arr.length;i+=2){ const x=arr[i], y=arr[i+1]; if (!Number.isFinite(x)||!Number.isFinite(y)) continue; if (x<minX) minX=x; if (x>maxX) maxX=x; if (y<minY) minY=y; if (y>maxY) maxY=y }
            return { minX, maxX, minY, maxY, width: (maxX-minX)||0, height: (maxY-minY)||0 }
          }
          const prev:any = tileRef.current
          const bPrev = prev?.nodes ? bounds(prev.nodes as Float32Array) : { width: 0 }
          const bNext = next?.nodes ? bounds(next.nodes as Float32Array) : { width: 0 }
          const padding = 260
          const dist = Math.max(1200, (bPrev.width*0.5) + (bNext.width*0.5) + padding)
          const target = { x: prevCenter.x + dist, y: prevCenter.y }
          const dx = target.x - newCenter.x
          const dy = target.y - newCenter.y
          const n = (next?.count|0)
          for (let i=0;i<n;i++){ next.nodes[i*2] += dx; next.nodes[i*2+1] += dy }
          next.focusWorld = { x: target.x, y: target.y }
          next.spawn = { x: dx, y: dy }
        }
      } catch {}

      setTile(next as ParsedTile)
      try { labelsRef.current = (next as any).labels || null } catch {}
      try {
        const urls: (string|null|undefined)[] | undefined = (next as any)?.meta?.nodes ? (next as any).meta.nodes.map((n:any)=> n?.avatar_url || n?.avatarUrl || null) : undefined
        avatarUrlRef.current = Array.isArray(urls) ? urls.map(u=>u||'') as string[] : null
        avatarsRef.current.clear()
        loadingSetRef.current.clear()
        concurrentLoadsRef.current = 0
        try {
          const hasAny = Array.isArray(avatarUrlRef.current) && avatarUrlRef.current.some((u)=> typeof u === 'string' && u.length>0)
          if (!hasAny) console.log('CanvasScene: No avatar URLs present in incoming tile meta')
        } catch {}
      } catch {}
      const hasCohorts = !!(next as any)?.group && ((next as any).group as Uint16Array).length > 0 && (() => {
        try {
          const g = new Set(Array.from((next as any).group as Uint16Array))
          return g.has(0) && g.has(1) && g.has(2)
        } catch { return false }
      })()
      if (!hasPrev) {
        // First graph: reset, fit, then ease to a far zoom
        setTx(0); setTy(0); setScale(1)
        const preferredPadding = hasCohorts ? 140 : 180
        const zoomMultiplier = 0.15
        setTimeout(() => {
          fitToContent(preferredPadding)
          try {
            requestAnimationFrame(()=>{
              requestAnimationFrame(()=>{
                const focusWorld = (next as any).focusWorld
                const fallbackX = Array.isArray((next as any).nodes) ? (next as any).nodes[0] : undefined
                const fallbackY = Array.isArray((next as any).nodes) ? (next as any).nodes[1] : undefined
                const wantFocus = (focusWorld && typeof focusWorld.x === 'number' && typeof focusWorld.y === 'number') ? focusWorld : (typeof fallbackX === 'number' && typeof fallbackY === 'number' ? { x: fallbackX, y: fallbackY } : null)
                const currentScale = scaleRef.current || 1
                const targetZoom = Math.min(3.0, Math.max(0.05, currentScale * zoomMultiplier))
                if (wantFocus) centerOnWorld(0, 0, { animate: true, ms: 480, zoom: targetZoom })
              })
            })
          } catch {}
        }, 200)
      } else {
        // Subsequent graphs: keep zoom, pan smoothly to new center
        try {
          const f:any = (next as any).focusWorld
          if (f && typeof f.x==='number' && typeof f.y==='number') {
            requestAnimationFrame(()=> centerOnWorld(f.x, f.y, { animate: true, ms: 600 }))
          }
        } catch {}
      }
    },
    promoteTrailPrevious: (): boolean => {
      try {
        const prevCurrent: any = tileRef.current
        const trail = trailRef.current
        if (!trail || trail.length === 0) return false
        const nextCurrent = trail[0]
        const rest = trail.slice(1)
        // Build new trail by placing previous current as newest dimmed, then remaining
        if (prevCurrent && prevCurrent.nodes && prevCurrent.size && prevCurrent.alpha) {
          const snap = {
            nodes: new Float32Array(prevCurrent.nodes),
            size: new Float32Array(prevCurrent.size),
            alpha: new Float32Array(prevCurrent.alpha),
            edges: prevCurrent.edges ? new Uint32Array(prevCurrent.edges) : undefined,
            center: (prevCurrent.focusWorld && typeof prevCurrent.focusWorld.x === 'number') ? { x: prevCurrent.focusWorld.x, y: prevCurrent.focusWorld.y } : { x: prevCurrent.nodes[0]||0, y: prevCurrent.nodes[1]||0 },
            color: trailColors[0]
          }
          const nextTrail = [snap, ...rest].slice(0, 2)
          for (let i=0;i<nextTrail.length;i++) nextTrail[i].color = trailColors[i] || '#88a'
          trailRef.current = nextTrail
        } else {
          trailRef.current = rest
        }
        // Promote nextCurrent to foreground without re-snapshotting
        const fg: any = {
          count: nextCurrent.nodes.length/2,
          nodes: new Float32Array(nextCurrent.nodes),
          size: new Float32Array(nextCurrent.size),
          alpha: new Float32Array(nextCurrent.alpha),
          edges: nextCurrent.edges ? new Uint32Array(nextCurrent.edges) : undefined,
        }
        ;(fg as any).focusWorld = { x: nextCurrent.center.x, y: nextCurrent.center.y }
        ;(fg as any).labels = null
        ;(fg as any).spawn = { x: 0, y: 0 }
        // Apply foreground with no trail snapshot
        try { labelsRef.current = (fg as any).labels || null } catch {}
        setTile(fg)
        setTx(0)
        setTy(0)
        setScale(1)
        setTimeout(()=>{
          fitToContent(120)
          requestAnimationFrame(()=>{
            requestAnimationFrame(()=>{
              centerOnWorld(nextCurrent.center.x, nextCurrent.center.y, { animate:true, ms: 460 })
            })
          })
        }, 120)
        return true
      } catch { return false }
    },
    clear: () => {
      setTile(null)
      setTx(0)
      setTy(0)
      setScale(1)
      trailRef.current = []
    },
    focusIndex: (index: number, opts?:{ zoom?: number, zoomMultiplier?: number, animate?: boolean, ms?: number }) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const curNodes = nodesRef.current
      if (!curNodes || index < 0 || index >= curNodes.length) return
      const n = curNodes[index]
      const baseScale = scaleRef.current
      let targetScale = typeof opts?.zoom === 'number' ? opts.zoom : baseScale
      if (typeof opts?.zoomMultiplier === 'number') targetScale = baseScale * opts.zoomMultiplier
      // Clamp to safe render bounds
      targetScale = Math.max(0.2, Math.min(3.5, targetScale))
      const { width:w, height:h } = getCanvasLogicalSize()
      centerOnWorld(n.x, n.y, { zoom: targetScale, animate: !!opts?.animate, ms: opts?.ms })
    },
    reshapeLayout: (mode: 'hierarchy'|'radial'|'grid'|'concentric', opts?:{ animate?: boolean, ms?: number })=>{
      const t = tileRef.current
      if (!t) return
      const n = t.count|0
      const edges = (t as any).edges as Uint32Array | undefined
      const from = new Float32Array(t.nodes)
      const target = new Float32Array(from.length)
      const placeGrid = ()=>{
        const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
        const cell = 160
        for (let i=0;i<n;i++){
          const r = Math.floor(i/cols), c = i%cols
          target[i*2] = (c - (cols-1)/2) * cell
          target[i*2+1] = (r - Math.floor((n-1)/cols)/2) * cell
        }
      }
      const placeRadial = ()=>{
        // BFS levels if edges exist; else ring by index
        const level = new Array<number>(n).fill(0)
        if (edges && edges.length>=2){
          const adj: number[][] = Array.from({length:n},()=>[])
          for (let i=0;i<edges.length;i+=2){ const a=edges[i]|0, b=edges[i+1]|0; if (a<n&&b<n){ adj[a].push(b); adj[b].push(a) } }
          const q=[0]; const vis=new Array(n).fill(false); vis[0]=true
          while(q.length){ const u=q.shift()!; for(const v of adj[u]) if(!vis[v]){ vis[v]=true; level[v]=level[u]+1; q.push(v) } }
        }
        const maxL = level.reduce((a,b)=>Math.max(a,b),0)
        let idx=0
        for (let L=0; L<=Math.max(1,maxL); L++){
          const ring = [] as number[]
          for (let i=0;i<n;i++) if (level[i]===L) ring.push(i)
          if (ring.length===0) continue
          const R = 120 + L*180
          for (let k=0;k<ring.length;k++,idx++){
            const ang = (k / ring.length) * Math.PI * 2
            target[ring[k]*2] = Math.cos(ang)*R
            target[ring[k]*2+1] = Math.sin(ang)*R
          }
        }
        // any not placed
        for (let i=0;i<n;i++) if (target[i*2]===0 && target[i*2+1]===0 && i!==0){ const R=300+ (i%5)*80; const a=(i%360)*(Math.PI/180); target[i*2]=Math.cos(a)*R; target[i*2+1]=Math.sin(a)*R }
      }
      const placeHierarchy = ()=>{
        const level = new Array<number>(n).fill(0)
        const children: number[][] = Array.from({length:n},()=>[])
        if (edges && edges.length>=2){
          const adj: number[][] = Array.from({length:n},()=>[])
          for (let i=0;i<edges.length;i+=2){ const a=edges[i]|0, b=edges[i+1]|0; if (a<n&&b<n){ adj[a].push(b); adj[b].push(a) } }
          const q=[0]; const vis=new Array(n).fill(false); vis[0]=true
          while(q.length){ const u=q.shift()!; for(const v of adj[u]) if(!vis[v]){ vis[v]=true; level[v]=level[u]+1; children[u].push(v); q.push(v) } }
        }
        const maxL = level.reduce((a,b)=>Math.max(a,b),0)
        const layerGap = 180
        for (let L=0; L<=Math.max(1,maxL); L++){
          const nodesInLayer = [] as number[]
          for (let i=0;i<n;i++) if (level[i]===L) nodesInLayer.push(i)
          const W = Math.max(1, nodesInLayer.length)
          for (let k=0;k<nodesInLayer.length;k++){
            const i = nodesInLayer[k]
            const x = (k - (W-1)/2) * 160
            const y = L * layerGap
            target[i*2] = x
            target[i*2+1] = y
          }
        }
      }
      const placeConcentric = ()=>{
        const rings = [120, 300, 480]
        let idx=0
        for (let r=0;r<rings.length;r++){
          const ringCount = Math.min(n-idx, r===0?Math.min(12,n): r===1?Math.min(36, n-idx): (n-idx))
          for (let i=0;i<ringCount;i++,idx++){
            const ang = (i / Math.max(1,ringCount)) * Math.PI * 2
            target[idx*2] = Math.cos(ang)*rings[r]
            target[idx*2+1] = Math.sin(ang)*rings[r]
          }
        }
        for (;idx<n;idx++){ const ang = (idx/Math.max(1,n))*Math.PI*2; target[idx*2]=Math.cos(ang)*600; target[idx*2+1]=Math.sin(ang)*600 }
      }
      if (mode==='grid') placeGrid(); else if (mode==='hierarchy') placeHierarchy(); else if (mode==='concentric') placeConcentric(); else placeRadial()
      const duration = Math.max(120, Math.min(1200, opts?.ms || 520))
      if (opts?.animate){
        const start = performance.now()
        const step = (now:number)=>{
          const t = Math.min(1, (now - start)/duration)
          const e = t<0.5 ? 2*t*t : -1 + (4 - 2*t)*t
          const cur = new Float32Array(from.length)
          for (let i=0;i<from.length;i++) cur[i] = from[i] + (target[i] - from[i]) * e
          const next: any = { ...(tileRef.current as any) }
          next.nodes = cur
          setTile(next)
          if (t < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      } else {
        const next: any = { ...(tileRef.current as any) }
        next.nodes = target
        setTile(next)
      }
    }
    ,
    getCamera: () => {
      const { width, height } = getCanvasLogicalSize()
      const vp: WorldBounds = {
        minX: (-txRef.current) / (scaleRef.current||1),
        maxX: (width - txRef.current) / (scaleRef.current||1),
        minY: (-tyRef.current) / (scaleRef.current||1),
        maxY: (height - tyRef.current) / (scaleRef.current||1),
        width: 0, height: 0, center: { x: 0, y: 0 }
      }
      vp.width = vp.maxX - vp.minX
      vp.height = vp.maxY - vp.minY
      vp.center = { x: (vp.minX + vp.maxX)/2, y: (vp.minY + vp.maxY)/2 }
      return { scale: scaleRef.current||1, tx: txRef.current, ty: tyRef.current, viewportCss: { width, height }, viewportWorld: vp }
    },
    measureForegroundBounds: (opts?: { mask?: boolean[] | null, groupId?: number | null, dropPercentile?: number }): WorldBounds | null => {
      const t = tileRef.current
      if (!t) return null
      const n = t.count|0
      const mask = (opts?.mask && opts.mask.length===n) ? opts?.mask : visibleMaskRef.current
      const wantGroup = typeof opts?.groupId === 'number' ? opts?.groupId : null
      const xs: number[] = []
      const ys: number[] = []
      for (let i=0;i<n;i++){
        if (mask && mask.length===n && !mask[i]) continue
        if (wantGroup !== null) { const g = (t as any).group ? (t as any).group[i] : null; if (g !== wantGroup) continue }
        const x = t.nodes[i*2], y = t.nodes[i*2+1]
        if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y) }
      }
      if (!xs.length) return null
      const drop = Math.max(0, Math.min(40, Math.floor((opts?.dropPercentile||0))))
      const takeRange = (arr:number[])=>{
        if (!drop) return { min: Math.min(...arr), max: Math.max(...arr) }
        const sorted = [...arr].sort((a,b)=>a-b)
        const k = Math.floor(sorted.length * (drop/100))
        const min = sorted[Math.min(sorted.length-1, k)]
        const max = sorted[Math.max(0, sorted.length-1-k)]
        return { min, max }
      }
      const rx = takeRange(xs), ry = takeRange(ys)
      const out: WorldBounds = {
        minX: rx.min, maxX: rx.max,
        minY: ry.min, maxY: ry.max,
        width: rx.max - rx.min,
        height: ry.max - ry.min,
        center: { x: (rx.min+rx.max)/2, y: (ry.min+ry.max)/2 }
      }
      return out
    },
    measureGroupBounds: (groupId: number, opts?: { mask?: boolean[] | null, dropPercentile?: number }): WorldBounds | null => {
      const api: any = apiRef.current
      return api?.measureForegroundBounds?.({ mask: opts?.mask ?? null, groupId, dropPercentile: opts?.dropPercentile }) || null
    },
    getVisibilityForBounds: (bounds: WorldBounds) => {
      const api: any = apiRef.current
      const cam = api?.getCamera?.()
      if (!cam) return { visibleFraction: 0, viewport: { ...bounds } as any }
      const vp = cam.viewportWorld
      const ixMin = Math.max(bounds.minX, vp.minX)
      const iyMin = Math.max(bounds.minY, vp.minY)
      const ixMax = Math.min(bounds.maxX, vp.maxX)
      const iyMax = Math.min(bounds.maxY, vp.maxY)
      const interW = Math.max(0, ixMax - ixMin)
      const interH = Math.max(0, iyMax - iyMin)
      const visibleFraction = Math.max(0, Math.min(1, (interW * interH) / Math.max(1, bounds.width * bounds.height)))
      return { visibleFraction, viewport: vp }
    }
  }), [])

  useEffect(()=>{ apiRef.current = (ref as any)?.current }, [ref])

  function animatePan(fromTx:number, fromTy:number, toTx:number, toTy:number, ms:number){
    const start = performance.now()
    const step = (now:number)=>{
      const t = Math.min(1, (now - start)/ms)
      const e = t<0.5 ? 2*t*t : -1 + (4 - 2*t)*t // easeInOutQuad
      const nx = fromTx + (toTx - fromTx)*e
      const ny = fromTy + (toTy - fromTy)*e
      setTx(nx)
      setTy(ny)
      // Emit parallax event for background (include easing t)
      try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { t, tx: nx, ty: ny }})) } catch {}
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  // Coordinate transformations
  function worldToScreen(wx: number, wy: number) {
    return { x: wx * scale + tx, y: wy * scale + ty }
  }
  
  function screenToWorld(sx: number, sy: number) {
    return { x: (sx - tx) / scale, y: (sy - ty) / scale }
  }

  // Canvas logical size (CSS pixels) — avoids stale state during transitions
  function getCanvasLogicalSize(): { width:number, height:number }{
    const c = canvasRef.current
    if (!c) return { width: canvasSize.width, height: canvasSize.height }
    const r = c.getBoundingClientRect()
    return { width: (r.width as number) || canvasSize.width, height: (r.height as number) || canvasSize.height }
  }

  // Precise centering on a world coordinate, optionally animating scale as well
  function centerOnWorld(wx:number, wy:number, opts?:{ zoom?: number, animate?: boolean, ms?: number }){
    const { width:w, height:h } = getCanvasLogicalSize()
    const startTx = txRef.current
    const startTy = tyRef.current
    const startScale = scaleRef.current
    // Current screen position of the target
    const startSx = wx * startScale + startTx
    const startSy = wy * startScale + startTy
    const endScale = typeof opts?.zoom === 'number' ? opts.zoom : startScale
    const duration = Math.max(200, Math.min(1200, opts?.ms || 700))
 
    if (!opts?.animate) {
      const toTx = (w/2) - wx * endScale
      const toTy = (h/2) - wy * endScale
      setScale(endScale)
      setTx(toTx)
      setTy(toTy)
      // Snap-correct any residual error on next frame
      requestAnimationFrame(()=>{
        const scr = { x: wx * scaleRef.current + txRef.current, y: wy * scaleRef.current + tyRef.current }
        const dx = (w/2) - scr.x
        const dy = (h/2) - scr.y
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) { setTx(txRef.current + dx); setTy(tyRef.current + dy) }
        try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { t: 1, tx: txRef.current, ty: tyRef.current }})) } catch {}
      })
      return
    }

    // If the node is already near center and no zoom change, glide subtly
    const near = Math.hypot(startSx - w/2, startSy - h/2) < 60 && Math.abs(endScale - startScale) < 0.01
    if (near) {
      animatePan(startTx, startTy, startTx + ((w/2) - startSx), startTy + ((h/2) - startSy), duration)
      return
    }
 
    const start = performance.now()
    const step = (now:number)=>{
      const t = Math.min(1, (now - start)/duration)
      const e = t<0.5 ? 2*t*t : -1 + (4 - 2*t)*t // easeInOutQuad
      const s = startScale + (endScale - startScale) * e
      setScale(s)
      // Smoothly move the node's screen position from its current spot to the canvas center
      const anchorSx = startSx + (w/2 - startSx) * e
      const anchorSy = startSy + (h/2 - startSy) * e
      const toTx = anchorSx - wx * s
      const toTy = anchorSy - wy * s
      setTx(toTx)
      setTy(toTy)
      try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { t, tx: toTx, ty: toTy }})) } catch {}
      if (t < 1) requestAnimationFrame(step)
      else {
        // Final snap-correction to eliminate rounding error
        const scr = { x: wx * scaleRef.current + txRef.current, y: wy * scaleRef.current + tyRef.current }
        const dx = (w/2) - scr.x
        const dy = (h/2) - scr.y
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) { setTx(txRef.current + dx); setTy(tyRef.current + dy) }
        try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { t: 1, tx: txRef.current, ty: tyRef.current }})) } catch {}
      }
    }
    requestAnimationFrame(step)
  }

  // Fit content to view, centered
  function fitToContent(padding = 140) {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) {
      return
    }
    
    const xs = nodes.map((n:Node) => n.x)
    const ys = nodes.map((n:Node) => n.y)
    const minX = Math.min(...xs) - padding
    const maxX = Math.max(...xs) + padding
    const minY = Math.min(...ys) - padding
    const maxY = Math.max(...ys) + padding
    
    // Use logical CSS size, not device pixels
    const w = canvasSize.width
    const h = canvasSize.height
    const contentW = (maxX - minX)
    const contentH = (maxY - minY)
    const sx = w / contentW
    const sy = h / contentH
    const s = Math.min(1.4, Math.min(sx, sy)) // People Network max scale: 1.4
    
    // Center content midpoint to canvas midpoint
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const newTx = (w / 2) - cx * s
    const newTy = (h / 2) - cy * s
    
    setScale(s)
    setTx(newTx)
    setTy(newTy)
  }

  // Canvas resize handling
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const resizeCanvas = () => {
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1))
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(600, Math.floor(rect.width * dpr))
      const height = Math.max(400, Math.floor(rect.height * dpr))
      
      canvas.width = width
      canvas.height = height
      setCanvasSize({ width: rect.width, height: rect.height, dpr }) // Store logical size + DPR
      
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    
    const ro = new ResizeObserver(resizeCanvas)
    ro.observe(canvas)
    resizeCanvas()
    
    return () => ro.disconnect()
  }, [])

  // Node picking
  function pickNode(sx: number, sy: number): Node | null {
    const world = screenToWorld(sx, sy)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const vm = visibleMaskRef.current
      // Hit-testing: always ignore masked-out nodes (both hide and dim modes)
      if (vm && vm.length === nodes.length && !vm[i]) continue
      const node = nodes[i]
      const dx = world.x - node.x
      const dy = world.y - node.y
      // Use the same visual size for hit testing (convert pixels → world units)
      const baseRadius = computeNodeRadius(node, scaleRef.current || 1)
      const radiusPixels = baseRadius + 5
      const radiusWorld = radiusPixels / (scaleRef.current || 1)
      if (dx * dx + dy * dy <= radiusWorld * radiusWorld) {
        return node
      }
    }
    return null
  }

  // Drawing functions
  // Removed drawGrid - now using ParticleBackground component

      function drawGrid(ctx: CanvasRenderingContext2D, width:number, height:number) {
        const spacing = 80 * Math.max(0.4, Math.min(2.0, scale))
        const startX = ((-tx % spacing) + spacing) % spacing
        const startY = ((-ty % spacing) + spacing) % spacing
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'
        ctx.lineWidth = 1
        for (let x = startX; x < width; x += spacing) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke() }
        for (let y = startY; y < height; y += spacing) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
        ctx.restore()
      }

      function drawEdge(ctx: CanvasRenderingContext2D, edge: Edge, style?: { stroke?: string, width?: number, alphaMul?: number, channel?: number, channels?: number }) {
        const sourceNode = nodes[edge.source]
        const targetNode = nodes[edge.target]
        if (!sourceNode || !targetNode || Number.isNaN(sourceNode.x) || Number.isNaN(targetNode.x)) return
        const A = worldToScreen(sourceNode.x, sourceNode.y)
        const B = worldToScreen(targetNode.x, targetNode.y)
        if (Number.isNaN(A.x) || Number.isNaN(B.x)) return

        const leftToBridge = (sourceNode.group === 0 && targetNode.group === 1) || (sourceNode.group === 1 && targetNode.group === 0)
        const rightToBridge = (sourceNode.group === 2 && targetNode.group === 1) || (sourceNode.group === 1 && targetNode.group === 2)
        const bothBridge = sourceNode.group === 1 && targetNode.group === 1

        // Person mode degree classification
        let deg: 'first' | 'second' | 'other' = 'other'
        if (isPersonMode) {
          // center is index 0; first-degree edges are [0, i]; second-degree are [first, second]
          const isCenterEdge = (edge.source === 0 || edge.target === 0)
          if (isCenterEdge) deg = 'first'
          else deg = 'second'
        }

        // If highlighting a specific degree, skip others entirely
        const effHighlight = (props.degreeHighlight || highlightDegree)
        if (isPersonMode && effHighlight !== 'all' && effHighlight !== deg) {
          return
        }

        // Base stroke color by mode
        let stroke = 'rgba(186, 188, 198, 0.16)'
        if (!isPersonMode) {
          if (leftToBridge) stroke = 'rgba(243, 93, 143, 0.28)'
          else if (rightToBridge) stroke = 'rgba(74, 215, 209, 0.28)'
          else if (bothBridge) stroke = 'rgba(255, 211, 105, 0.24)'
        } else {
          // Person: color by degree
          stroke = deg === 'first' ? 'rgba(130, 180, 255, 0.28)' : 'rgba(255, 170, 110, 0.26)'
        }

        // Thicken bridge-to-bridge edges a bit more
        const bridgeLink = bothBridge
        const norm = Math.max(0, Math.min(1, (edge.weight||0) / MONTHS_NORMALIZER))
        const scaled = Math.sqrt(norm) // softer growth
        const base = EDGE_STROKE_BASE
        const max = EDGE_STROKE_MAX * (bridgeLink ? 1.0 : 0.64)
        const weight = Math.max(base, Math.min(max, base + scaled * max))

        // Optional style overrides
        if (style?.alphaMul && Number.isFinite(style.alphaMul)) {
          ctx.save(); ctx.globalAlpha *= Math.max(0, Math.min(5, style.alphaMul || 1))
        }
        ctx.strokeStyle = style?.stroke || stroke
        ctx.lineWidth = style?.width || weight
        ctx.beginPath()
        ctx.moveTo(A.x, A.y)
        const mx = (A.x + B.x) / 2
        const my = (A.y + B.y) / 2
        const hash = ((edge.source * 73856093) ^ (edge.target * 19349663)) >>> 0
        const sign = (hash & 1) ? 1 : -1
        const amplitude = 5 + (hash % 7)
        const wobble = (((hash >> 4) % 1000) / 1000 - 0.5) * 3
        const dx = B.y - A.y
        const dy = A.x - B.x
        const len = Math.hypot(dx, dy) || 1
        const baseOffset = (amplitude + wobble) * sign
        // Parallel-path separation: spread channels symmetrically and consistently
        const channels = Math.max(1, Math.floor(style?.channels || 1))
        const channel = Math.max(0, Math.min(channels - 1, Math.floor(style?.channel || 0)))
        const sepNorm = channels > 1 ? (channel - (channels - 1) / 2) : 0
        const sepPx = sepNorm * 8 // 8px separation between parallel paths at 100% zoom
        const totalOffset = baseOffset + sepPx
        const nx = (dx / len) * totalOffset
        const ny = (dy / len) * totalOffset
        ctx.quadraticCurveTo(mx + nx, my + ny, B.x, B.y)
        ctx.stroke()
        if (style?.alphaMul && Number.isFinite(style.alphaMul)) { ctx.restore() }
      }

      function drawScorePill(ctx: CanvasRenderingContext2D, text: string, x:number, y:number){
        ctx.save()
        ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto'
        const padding = 5
        const m = ctx.measureText(text)
        const w = m.width + padding * 2, h = 16, rx = 8
        ctx.globalAlpha = 0.9
        ctx.fillStyle = 'rgba(10,10,18,0.9)'
        roundRect(ctx, x - w/2, y - h/2, w, h, rx, true, false)
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.6)'
        ctx.lineWidth = 1
        roundRect(ctx, x - w/2, y - h/2, w, h, rx, false, true)
        ctx.fillStyle = 'rgba(255, 200, 120, 1)'
        ctx.fillText(text, x - w/2 + padding, y + 4)
        ctx.restore()
      }

      function roundRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,fill:boolean,stroke:boolean){
        const min=Math.min(w,h)/2; r=Math.min(r,min); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); if(fill) ctx.fill(); if(stroke) ctx.stroke()
      }

  function drawNode(ctx: CanvasRenderingContext2D, node: Node) {
    const screen = worldToScreen(node.x, node.y)
    if (Number.isNaN(screen.x) || Number.isNaN(screen.y)) return

    const style = groupStyles[node.group as 0 | 1 | 2] || groupStyles[1]
    const radius = computeNodeRadius(node, scale)

    ctx.save()
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius + 1.6, 0, Math.PI * 2)
    ctx.fillStyle = style.glow
    ctx.fill()

    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = style.fill
    ctx.fill()

    ctx.strokeStyle = style.border
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  function drawLabel(ctx: CanvasRenderingContext2D, text: string, x:number, y:number){
    ctx.save()
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto'
    const pad = 4
    const m = ctx.measureText(text)
    const w = m.width + pad*2, h = 16
    ctx.globalAlpha = 0.9
    ctx.fillStyle = 'rgba(10,10,14,0.85)'
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    // pill
    ctx.beginPath()
    const r = 8
    ctx.moveTo(x - w/2 + r, y - h/2)
    ctx.arcTo(x + w/2, y - h/2, x + w/2, y + h/2, r)
    ctx.arcTo(x + w/2, y + h/2, x - w/2, y + h/2, r)
    ctx.arcTo(x - w/2, y + h/2, x - w/2, y - h/2, r)
    ctx.arcTo(x - w/2, y - h/2, x + w/2, y - h/2, r)
    ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.fillText(text, x - w/2 + pad, y + 4)
    ctx.restore()
  }

  function drawAvatar(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x:number, y:number, r:number){
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI*2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(image, x - r, y - r, r*2, r*2)
    ctx.restore()
  }

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const now = performance.now()
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // reset label hitboxes for this frame
    labelHitboxesRef.current = []
    
    // Draw trail graphs (older → darker). Render edges then nodes, dimmed.
    try {
      const trail = trailRef.current
      const currCenter = (()=>{
        const t:any = tileRef.current
        if (t?.focusWorld && typeof t.focusWorld.x==='number') return { x:t.focusWorld.x, y:t.focusWorld.y }
        if (t?.nodes && t.nodes.length>=2) return { x:t.nodes[0], y:t.nodes[1] }
        return null
      })()
      for (let ti = trail.length-1; ti >= 0; ti--) {
        const t = trail[ti]
        const color = t.color
        // edges
        if (t.edges && t.edges.length > 0) {
          ctx.save()
          ctx.strokeStyle = `${color}55`
          ctx.lineWidth = 1.5
          const step = scale < 0.8 && t.edges.length/2 > 1500 ? Math.ceil((t.edges.length/2)/1500)*2 : 2
          for (let i=0; i < t.edges.length; i += step) {
            const a = t.edges[i]|0, b = t.edges[i+1]|0
            const ax = t.nodes[a*2], ay = t.nodes[a*2+1]
            const bx = t.nodes[b*2], by = t.nodes[b*2+1]
            const A = worldToScreen(ax, ay), B = worldToScreen(bx, by)
            ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
          }
          ctx.restore()
        }
        // nodes
        ctx.save()
        ctx.globalAlpha = 0.55 - ti*0.15
        for (let i=0;i<t.nodes.length/2;i++){
          const x = t.nodes[i*2], y = t.nodes[i*2+1]
          const screen = worldToScreen(x, y)
          const r = Math.max(6, (t.size[i]||3) * scale * 0.7)
          ctx.beginPath(); ctx.arc(screen.x, screen.y, r, 0, Math.PI*2)
          ctx.fillStyle = `${color}99`
          ctx.fill()
        }
        ctx.restore()
        // disabled connector guide between trail snapshots (removes dotted/cyan artifact)
      }
    } catch {}

    // Compare-mode overlays: render two trees with top anchors at nodes[0] and nodes[1]
    try {
      const ov: any = (tile as any)?.compareOverlay
      if (ov && nodes && nodes.length >= 2) {
        const colors = (ov.colors||{})
        const colLeft = colors.leftFirst || 'rgba(122,110,228,0.35)'
        const colRight = colors.rightFirst || 'rgba(255,140,170,0.35)'
        const colOverlap = colors.overlapFirst || 'rgba(255,195,130,0.85)'

        const leftTop = worldToScreen(nodes[0].x, nodes[0].y)
        const rightTop = worldToScreen(nodes[1].x, nodes[1].y)
        const midX = (leftTop.x + rightTop.x) / 2
        const trunkLen = 220 * Math.max(0.5, Math.min(2.2, scale))
        const rootY = Math.max(leftTop.y, rightTop.y) + trunkLen
        const joinY = Math.min(rootY - 60, (leftTop.y + rightTop.y)/2 + trunkLen*0.55)

        const drawTrunk = (top:{x:number,y:number}, color:string, dir:number)=>{
          ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3
          ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x + dir*20, joinY); ctx.lineTo(top.x + dir*40, rootY); ctx.stroke()
          // outer root
          ctx.beginPath(); ctx.arc(top.x + dir*80, rootY + 8, 6, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill()
          // side branches
          for(let i=1;i<=3;i++){
            const t = i/4
            const bx = top.x + dir * 18 * t
            const by = top.y + (rootY - top.y) * (t*0.7)
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + dir*(60 + 30*t), by + 24); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke()
          }
          ctx.restore()
        }
        // shared middle connector between trunks
        ctx.save(); ctx.strokeStyle = colOverlap; ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(leftTop.x + 18, joinY); ctx.lineTo(midX, joinY + 10); ctx.lineTo(rightTop.x - 18, joinY); ctx.stroke()
        ctx.beginPath(); ctx.arc(midX, joinY + 10, 6, 0, Math.PI*2); ctx.fillStyle = colOverlap; ctx.fill(); ctx.restore()

        drawTrunk(leftTop, colLeft, -1)
        drawTrunk(rightTop, colRight, +1)

        // Per-node connectors (subtle twigs) from anchors to visible nodes
        try {
          const lwBase = Math.max(1.2, Math.min(3.2, 1.8 * scale))
          const anchorLeft = { x: leftTop.x, y: leftTop.y + 6 }
          const anchorRight = { x: rightTop.x, y: rightTop.y + 6 }
          const overlapOrigin = { x: midX, y: joinY + 10 }
          const sanitize = (value: any): number[] => {
            if (!value) return []
            if (Array.isArray(value)) return value.map((v) => Number(v)).filter((v) => Number.isFinite(v))
            if (ArrayBuffer.isView(value)) return Array.from(value as ArrayLike<number>).map((v) => Number(v)).filter((v) => Number.isFinite(v))
            return []
          }
          const rawGroups: any = (tile as any)?.compareIndexGroups || null
          const leftIndices = new Set<number>(sanitize(rawGroups?.left).filter((i) => i >= 0 && i < nodes.length))
          const rightIndices = new Set<number>(sanitize(rawGroups?.right).filter((i) => i >= 0 && i < nodes.length))
          const overlapIndices = new Set<number>(sanitize(rawGroups?.overlap).filter((i) => i >= 0 && i < nodes.length))
          const drawLine = (from: { x: number; y: number }, to: { x: number; y: number }, color: string, width: number) => {
            ctx.beginPath()
            ctx.moveTo(from.x, from.y)
            ctx.lineTo(to.x, to.y)
            ctx.strokeStyle = color
            ctx.lineWidth = width
            ctx.stroke()
          }
          ctx.save()
          ctx.lineCap = 'round'
          ctx.setLineDash([])
          for (let i=2;i<nodes.length;i++){
            const n = nodes[i]
            const p = worldToScreen(n.x, n.y)
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
            const region = overlapIndices.has(i) ? 'overlap' : (leftIndices.has(i) ? 'left' : (rightIndices.has(i) ? 'right' : 'auto'))
            if (region === 'left') {
              drawLine(anchorLeft, p, 'rgba(122,110,228,0.42)', lwBase)
            } else if (region === 'right') {
              drawLine(anchorRight, p, 'rgba(255,140,170,0.42)', lwBase)
            } else if (region === 'overlap') {
              drawLine(overlapOrigin, p, 'rgba(255,195,130,0.62)', lwBase + 0.5)
              drawLine(anchorLeft, p, 'rgba(122,110,228,0.24)', Math.max(1, lwBase * 0.7))
              drawLine(anchorRight, p, 'rgba(255,140,170,0.24)', Math.max(1, lwBase * 0.7))
            } else {
              const distMid = Math.abs(p.x - midX)
              if (distMid <= 18) {
                drawLine(overlapOrigin, p, 'rgba(255,195,130,0.45)', lwBase)
              } else if (p.x < midX) {
                drawLine(anchorLeft, p, 'rgba(122,110,228,0.32)', lwBase)
              } else {
                drawLine(anchorRight, p, 'rgba(255,140,170,0.32)', lwBase)
              }
            }
          }
          ctx.restore()
        } catch {}
      }
    } catch {}
    
    // Draw foreground edges first so nodes render on top
    if (edges && edges.length > 0) {
      // Optionally thin out when zoomed far out for performance/clarity
      const step = scale < 0.9 && edges.length > 2000 ? Math.ceil(edges.length / 2000) : 1
      // Precompute parallel-path channels per undirected pair for clear separation
      const pairCount = new Map<string, number>()
      for (let i = 0; i < edges.length; i += 1) {
        const e = edges[i]
        const a = Math.min(e.source|0, e.target|0)
        const b = Math.max(e.source|0, e.target|0)
        const key = `${a}-${b}`
        pairCount.set(key, (pairCount.get(key) || 0) + 1)
      }
      const pairOrder = new Map<string, number>()
      const mode = props.maskMode || 'hide'
      for (let i = 0; i < edges.length; i += step) {
        const e = edges[i]
        const vm = visibleMaskRef.current
        let draw = true
        let dim = false
        if (vm && vm.length === nodes.length) {
          const sVis = !!vm[e.source]
          const tVis = !!vm[e.target]
          if (mode === 'hide') { if (!sVis || !tVis) draw = false }
          else if (mode === 'dim') { if (!sVis || !tVis) dim = true }
        }
        if (!draw) continue
        // Temporarily reduce global alpha for dimmed edges
        if (dim) { ctx.save(); ctx.globalAlpha *= 0.22 }
        const a = Math.min(e.source|0, e.target|0)
        const b = Math.max(e.source|0, e.target|0)
        const key = `${a}-${b}`
        const total = pairCount.get(key) || 1
        const used = pairOrder.get(key) || 0
        pairOrder.set(key, used + 1)
        drawEdge(ctx, e, { channels: total, channel: used })
        if (dim) ctx.restore()
      }
    }
    // Highlighted edges (selected node) should render after base edges but BEFORE nodes
    try {
      const si = typeof props.selectedIndex === 'number' ? props.selectedIndex : -1
      if (si >= 0 && edges && edges.length > 0) {
        const style = { stroke: 'rgba(255, 236, 160, 0.9)', width: 2.4, alphaMul: 1.0 }
        for (let i=0;i<edges.length;i++){
          const e = edges[i]
          if (e.source === si || e.target === si) drawEdge(ctx, e, style)
        }
      }
    } catch {}

    // Draw nodes LAST - People Network style
    let visibleNodes = 0
    // Pre-count visible label candidates to set dynamic stride relative to on-screen density
    let visibleLabelCandidates = 0
    try {
      const modePre = (tile as any)?.meta?.mode
      if (labelsRef.current && (modePre === 'person')){
        for (let i = 0; i < nodes.length; i++){
          const node = nodes[i]
          const screen = worldToScreen(node.x, node.y)
          let radius = computeNodeRadius(node, scale)
          if (screen.x + radius >= 0 && screen.x - radius <= canvas.width && 
              screen.y + radius >= 0 && screen.y - radius <= canvas.height) {
            const isAnchor = (i === 0) || (i === 1)
            const hasLbl = !!labelsRef.current[i]
            const isBridge = node.group === 1
            if (hasLbl && !isAnchor && !isBridge) visibleLabelCandidates++
          }
        }
      }
    } catch {}
    // Smooth stride updates to avoid flicker while panning/zooming
    const dynamicStrideOther = (()=>{
      const desiredRatio = 8 // target ~1/8 labels for person ego
      if (visibleLabelCandidates <= 0) return 7
      // When zoomed-in or sparse: show all labels if small number or ample pixel area per label
      const pixelArea = canvas.width * canvas.height
      const areaPerCandidate = pixelArea / Math.max(1, visibleLabelCandidates)
      const zoomedIn = scale >= 1.1
      if (visibleLabelCandidates <= 32 || areaPerCandidate >= 28000 || zoomedIn) return 1
      const target = Math.max(1, Math.floor(visibleLabelCandidates / desiredRatio))
      const stride = Math.max(1, Math.round(visibleLabelCandidates / Math.max(1, target)))
      const clamped = Math.max(2, Math.min(12, stride))
      // debounce updates to at most ~10 Hz and hysteresis of +/-1
      const nowMs = performance.now()
      const last = lastStrideUpdateRef.current || 0
      let prev = labelStrideRef.current || clamped
      if (nowMs - last > 100) {
        if (Math.abs(prev - clamped) >= 1) {
          prev = clamped
          labelStrideRef.current = prev
          lastStrideUpdateRef.current = nowMs
        }
      }
      return prev
    })()
    const modeNodes = props.maskMode || 'hide'
    const pendingLabels: Array<{ i:number, x:number, y:number, text:string, dimmed:boolean }> = []
    for (let i = 0; i < nodes.length; i++) {
      const vm = visibleMaskRef.current
      const maskedOut = vm && vm.length === nodes.length && !vm[i]
      const hidden = maskedOut && modeNodes !== 'dim'
      const dimmed = maskedOut && modeNodes === 'dim'
      if (hidden) continue
      const node = nodes[i]
      const screen = worldToScreen(node.x, node.y)
      // Constant-size nodes: use computeNodeRadius (ignores scale)
      let radius = computeNodeRadius(node, scale)
      let renderR = radius
      try { if ((tile as any)?.compareOverlay && (i === 0 || i === 1)) radius = Math.max(radius, 18) } catch {}
      
      // Check if node is visible on screen
      if (screen.x + radius >= 0 && screen.x - radius <= canvas.width && 
          screen.y + radius >= 0 && screen.y - radius <= canvas.height) {
        visibleNodes++
      }
      
    // Draw node with clean styling — add labels for middle (bridges)
      ctx.save()
      if (dimmed) { try { ctx.globalAlpha *= 0.28 } catch {} }
      let fill = `rgba(255, 165, 0, 0.9)`
      let glow = `rgba(255, 165, 0, 0.3)`
      let border = `rgba(255, 140, 0, 1.0)`
      try {
        const isCompare = !!(tile as any)?.compareOverlay
        if (isCompare && (i === 0 || i === 1)) {
          if (i === 0) { fill = 'rgba(80,200,255,0.95)'; glow = 'rgba(80,200,255,0.35)'; border = 'rgba(60,170,230,1)' }
          if (i === 1) { fill = 'rgba(255,140,170,0.95)'; glow = 'rgba(255,140,170,0.35)'; border = 'rgba(230,110,150,1)' }
        }
      } catch {}

      const isSelected = typeof props.selectedIndex === 'number' && props.selectedIndex === i
      if (isSelected) {
        // Enhance the selected node styling
        glow = 'rgba(255,255,255,0.5)'
        border = 'rgba(255,255,255,1.0)'
      }
      
      // Outer glow (subtle)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius + 2, 0, Math.PI * 2)
      ctx.fillStyle = glow
      ctx.fill()
      
      // Lazy-load avatar if visible and not loaded
      if (avatarUrlRef.current && typeof avatarUrlRef.current[i] === 'string' && !avatarsRef.current.has(i)){
        const url = avatarUrlRef.current[i]
        if (url && !loadingSetRef.current.has(i) && concurrentLoadsRef.current < maxConcurrentLoadsRef.current){
          loadingSetRef.current.add(i)
          concurrentLoadsRef.current++
          const img = new Image(); img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer'
          img.onload = ()=>{ avatarsRef.current.set(i, img); loadingSetRef.current.delete(i); concurrentLoadsRef.current = Math.max(0, concurrentLoadsRef.current-1) }
          img.onerror = ()=>{ loadingSetRef.current.delete(i); concurrentLoadsRef.current = Math.max(0, concurrentLoadsRef.current-1) }
          img.src = url
        }
      }

      // Avatar (if available) or fallback solid node
      const avatar = avatarsRef.current.get(i)
      if (avatar) {
        // Near max zoom, scale avatars up to 3x while keeping base size at normal zooms
        const maxScale = 3.5
        const startBoost = maxScale * 0.75 // begin enlarging at last 25% of zoom range
        const s = Math.max(0, Math.min(1, (scale - startBoost) / Math.max(0.0001, (maxScale - startBoost))))
        const avatarMul = 1 + 3.5 * s // 1x → 4.5x
        const avatarR = Math.max(10, radius * avatarMul)
        renderR = avatarR
        drawAvatar(ctx, avatar, screen.x, screen.y, avatarR)
        ctx.beginPath(); ctx.arc(screen.x, screen.y, avatarR, 0, Math.PI*2)
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'
        ctx.lineWidth = 1
        ctx.stroke()
      } else {
        // Main node
        ctx.beginPath()
        ctx.arc(screen.x, screen.y, renderR, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        
        // Clean border
        ctx.strokeStyle = border
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      // Universal crisp white outline to help nodes stand out (avatars and solids)
      try {
        ctx.beginPath()
        ctx.arc(screen.x, screen.y, renderR + 0.8, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 1.8
        ctx.stroke()
      } catch {}
      
      // Selection highlight: pulsing halo + ring
      if (isSelected) {
        const pulse = (Math.sin(now / 180) + 1) * 0.5 // 0..1
        // Scale selector proportionally to zoom ramp used for avatars
        const maxScale = 3.5
        const startBoost = maxScale * 0.75
        const s = Math.max(0, Math.min(1, (scale - startBoost) / Math.max(0.0001, (maxScale - startBoost))))
        const padMul = 1 + 0.8 * s
        const haloR = renderR + 8 * padMul + pulse * (6 * padMul)
        ctx.beginPath()
        ctx.arc(screen.x, screen.y, haloR, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(screen.x, screen.y, haloR + 3 * padMul, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      
      ctx.restore()

      // Queue labels to draw after nodes
      if (labelsRef.current && labelsRef.current[i]){
        const isBridge = node.group === 1
        const isAnchor = (i === 0) || (i === 1)
        const mode = (tile as any)?.meta?.mode
        const strideOther = mode === 'person' ? dynamicStrideOther : 4
        const strideBridge = 7
        const lbl = labelsRef.current[i]
        const pickOther = ((hashStr32(lbl) + i) % strideOther) === 0
        const pickBridge = ((hashStr32(lbl) + i) % strideBridge) === 0
        const isSelected = typeof props.selectedIndex === 'number' && props.selectedIndex === i
        const show = isSelected || isAnchor || (isBridge ? pickBridge : pickOther)
        if (show) {
          const centerX = screen.x
          const centerY = screen.y - renderR - 12
          pendingLabels.push({ i, x: centerX, y: centerY, text: lbl, dimmed })
        }
      }
    }
    
    // Draw labels in a separate pass so nodes/avatars never get occluded by text
    for (const item of pendingLabels){
      if (item.dimmed) { ctx.save(); ctx.globalAlpha *= 0.35; drawLabel(ctx, item.text, item.x, item.y); ctx.restore() }
      else { drawLabel(ctx, item.text, item.x, item.y) }
      // Record hitboxes for click handling
      try {
        const pad = 4
        const m = ctx.measureText(item.text)
        const w = (m?.width || 0) + pad*2
        const h = 16
        labelHitboxesRef.current.push({ index: item.i, x: item.x - w/2, y: item.y - h/2, w, h })
      } catch {}
    }

    // Debug logging disabled

    ctx.restore()
    
    // No edge redraw here so nodes and labels remain above highlights

    // Report stats
    if (props.onStats) {
      props.onStats(60, nodes.length) // Assume 60fps for canvas
    }
  }

  // Animation loop
  useEffect(() => {
    const animate = () => {
      draw()
      animFrameRef.current = requestAnimationFrame(animate)
    }
    animate()
    
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [nodes, edges, tx, ty, scale])

  // Input handling
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onDblClick = (e: MouseEvent) => {
      try {
        const rect = canvas.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const hit = pickNode(sx, sy)
        if (!hit) return
        const idx = hit.index
        const t: any = tileRef.current as any
        // Derive raw id from meta or labels
        let rawId: string | null = null
        try {
          const metaNode = t?.meta?.nodes?.[idx]
          if (metaNode && (metaNode.id != null || metaNode.linkedin_id != null || metaNode.handle != null)) {
            rawId = String(metaNode.id ?? metaNode.linkedin_id ?? metaNode.handle)
          }
        } catch {}
        if (!rawId) {
          try {
            const lbl = (labelsRef.current && Array.isArray(labelsRef.current)) ? labelsRef.current[idx] : null
            if (lbl && /^(company|person):\d+$/i.test(lbl)) rawId = lbl
          } catch {}
        }
        if (!rawId) return
        // Canonicalize id
        const mode = t?.meta?.mode as string | undefined
        const grp = (Array.isArray((t as any)?.group) ? (t as any).group[idx] : (t as any)?.group?.[idx])
        let canonical = rawId
        if (/^(company|person):\d+$/i.test(rawId)) {
          canonical = rawId.toLowerCase()
        } else if (/^\d+$/.test(rawId)) {
          if (mode === 'graph') {
            canonical = (grp === 1) ? `person:${rawId}` : `company:${rawId}`
          } else if (mode === 'person') {
            canonical = `person:${rawId}`
          } else if (mode === 'flows') {
            canonical = (idx === 0 || idx === 1) ? `company:${rawId}` : ''
          } else {
            canonical = `person:${rawId}`
          }
        }
        if (!canonical) return
        window.dispatchEvent(new CustomEvent('crux_insert', { detail: { text: canonical } }))
      } catch {}
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const isZoomGesture = e.ctrlKey || e.metaKey || e.altKey
      if (isZoomGesture) {
        const rect = canvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const before = screenToWorld(mx, my)
        const speed = 0.006 // double zoom speed
        const delta = -e.deltaY * speed
        const newScale = Math.max(0.02, Math.min(3.5, scale * (1 + delta)))
        setScale(newScale)
        const sx = before.x * newScale + tx
        const sy = before.y * newScale + ty
        setTx(tx + (mx - sx))
        setTy(ty + (my - sy))
      } else {
        // Two-finger swipe pans the canvas
        setTx((prev: number) => prev - e.deltaX)
        setTy((prev: number) => prev - e.deltaY)
      }
      try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { tx: txRef.current, ty: tyRef.current }})) } catch {}
    }

    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      // Prefer node picking first so clicks on nodes don't trigger region reset
      const hit = pickNode(sx, sy)
      
      if (hit) {
        draggingNodeRef.current = hit
        if (props.onPick) props.onPick(hit.index)
      } else {
        // If not on a node, check label hitboxes
        try {
          for (let k = labelHitboxesRef.current.length - 1; k >= 0; k--) {
            const hb = labelHitboxesRef.current[k]
            if (sx >= hb.x && sx <= hb.x + hb.w && sy >= hb.y && sy <= hb.y + hb.h) {
              if (props.onPick) props.onPick(hb.index)
              // Also focus the clicked node for better UX
              const curNodes = nodesRef.current
              const n = curNodes?.[hb.index]
              if (n) centerOnWorld(n.x, n.y, { animate: true, ms: 420, zoom: Math.min(3.0, Math.max(0.4, (scaleRef.current||1) * 1.2)) })
              return
            }
          }
        } catch {}
        // Region hit test (compare mode) only when not clicking a node
        try {
          const ov: any = (tile as any)?.compareOverlay
          if (ov && ov.regions) {
            const px = sx, py = sy
            const inside = (r:any)=>{
              const c = worldToScreen(r.cx||0, r.cy||0)
              const dx = px - c.x, dy = py - c.y
              const d = Math.hypot(dx, dy)
              const rIn = Math.max(0, (r.r1||0) * scale)
              const rOut = Math.max(rIn+1, (r.r2||0) * scale)
              const topHalf = py <= c.y + 1
              return topHalf && d >= rIn && d <= rOut
            }
            const hitLeft = ov.regions.left && inside(ov.regions.left)
            const hitRight = ov.regions.right && inside(ov.regions.right)
            const hitOverlap = ov.regions.overlap && inside(ov.regions.overlap)
            if (hitOverlap) { props.onRegionClick?.('overlap'); return }
            if (hitLeft && !hitRight) { props.onRegionClick?.('left'); return }
            if (hitRight && !hitLeft) { props.onRegionClick?.('right'); return }
          }
        } catch {}
        isPanningRef.current = true
      }
      
      dragLastRef.current = { x: sx, y: sy }
      ;(e.target as Element).setPointerCapture(e.pointerId)
    }

    const onMove = (e: PointerEvent) => {
      if (!dragLastRef.current) return
      
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const dx = sx - dragLastRef.current.x
      const dy = sy - dragLastRef.current.y
      
      dragLastRef.current = { x: sx, y: sy }
      
      const dragging = draggingNodeRef.current
      if (dragging) {
        // People Network style: direct coordinate update
        dragging.x += dx / scale
        dragging.y += dy / scale
        
        // Also update the underlying tile data
        if (tile) {
          tile.nodes[dragging.index * 2] = dragging.x
          tile.nodes[dragging.index * 2 + 1] = dragging.y
        }
        // quiet drag spam
      } else if (isPanningRef.current) {
        setTx((prev: number) => prev + dx)
        setTy((prev: number) => prev + dy)
        try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { tx: txRef.current + dx, ty: tyRef.current + dy }})) } catch {}
      }
    }

    const onUp = () => {
      draggingNodeRef.current = null
      isPanningRef.current = false
      dragLastRef.current = null
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        setScale((s: number) => Math.min(3.5, s * 1.1))
      } else if (e.key === '-') {
        setScale((s: number) => Math.max(0.02, s * 0.9))
      } else if (e.key === 'r' || e.key === 'R') {
        fitToContent()
      } else if (e.key === 'c' || e.key === 'C') {
        // Center view manually
        setTx(0)
        setTy(0)
        setScale(100)
      } else if (e.key === 'Escape') {
        // First press: unselect if a selection exists
        const hasSelection = typeof props.selectedIndex === 'number' && (props.selectedIndex as number) >= 0
        if (hasSelection) {
          try { (props.onUnselect as any)?.() } catch {}
          return
        }
        // Second press (or no selection): clear as before
        if (tileRef.current) {
          if (props.onClear) props.onClear();
        } else if (trailRef.current.length > 0) {
          trailRef.current = []
        }
        return;
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('dblclick', onDblClick)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('dblclick', onDblClick)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [scale, tx, ty, nodes, tile, props])

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      {/* Subtle dark overlay to reduce background noise (very low translucency) */}
      <div style={{ position:'absolute', inset:0, background:'rgba(5,7,12,0.65)', zIndex:0, pointerEvents:'none' }} />
      {/* Graph canvas layer */}
      <canvas 
        ref={canvasRef} 
        style={{ 
          position: 'absolute', 
          inset: 0, 
          width: '100%', 
          height: '100%', 
          display: 'block',
          cursor: draggingNodeRef.current ? 'grabbing' : 'grab',
          zIndex: 1 // Above particle background
        }} 
      />
      {/* Simple overlay UI on the canvas */}
      <div style={{ position:'absolute', bottom:118, left:14, right:14, zIndex: 21, display:'flex', flexDirection:'row', flexWrap:'wrap', gap:6, alignItems:'center' }}>
        {isPersonMode && (
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <span style={{ color:'#aaa', fontSize:12 }}>Highlight:</span>
            {(()=>{ const eff = (props.degreeHighlight || highlightDegree); return (
              <>
                <button onClick={()=> setHighlightDegree('all')} style={{ padding:'4px 8px', borderRadius:8, background: eff==='all'?'rgba(120,180,255,0.22)':'rgba(255,255,255,0.10)', color:'#fff', border:'1px solid rgba(255,255,255,0.18)', fontSize:12 }}>All</button>
                <button onClick={()=> setHighlightDegree('first')} style={{ padding:'4px 8px', borderRadius:8, background: eff==='first'?'rgba(120,180,255,0.22)':'rgba(255,255,255,0.10)', color:'#fff', border:'1px solid rgba(255,255,255,0.18)', fontSize:12 }}>1st</button>
                <button onClick={()=> setHighlightDegree('second')} style={{ padding:'4px 8px', borderRadius:8, background: eff==='second'?'rgba(255,170,110,0.22)':'rgba(255,255,255,0.10)', color:'#fff', border:'1px solid rgba(255,255,255,0.18)', fontSize:12 }}>2nd</button>
              </>
            )})()}
          </div>
        )}
      </div>
      
    </div>
  )
})

export default CanvasScene
