import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ParsedTile } from './parse'

type Exposed = { setForeground: (fg: ParsedTile) => void, clear: () => void, focusIndex: (index: number, opts?:{ zoom?: number, zoomMultiplier?: number, animate?: boolean, ms?: number }) => void }
type Props = { 
  onStats?: (fps: number, count: number) => void, 
  concentric?: boolean, 
  onPick?: (index: number) => void, 
  onClear?: () => void, 
  onRegionClick?: (region: 'left'|'right'|'overlap') => void,
  selectedIndex?: number | null,
  visibleMask?: boolean[] | null
}

type Node = {
  x: number
  y: number
  size: number
  alpha: number
  index: number
}

type Edge = {
  source: number
  target: number
}

const CanvasScene = forwardRef<Exposed, Props>(function CanvasScene(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tile, setTile] = useState<ParsedTile | null>(null)
  const labelsRef = useRef<string[] | null>(null)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [scale, setScale] = useState(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)
  const scaleRef = useRef(1)
  useEffect(()=>{ txRef.current = tx }, [tx])
  useEffect(()=>{ tyRef.current = ty }, [ty])
  useEffect(()=>{ scaleRef.current = scale }, [scale])
  const nodesRef = useRef<Node[]>([])
  const visibleMaskRef = useRef<boolean[] | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })
  const draggingNodeRef = useRef<Node | null>(null)
  const dragLastRef = useRef<{ x: number, y: number } | null>(null)
  const isPanningRef = useRef(false)
  const animFrameRef = useRef<number>(0)
  // Keep latest tile and a short trail of previous graphs (max 2)
  const tileRef = useRef<ParsedTile | null>(null)
  useEffect(()=>{ tileRef.current = tile }, [tile])
  const trailRef = useRef<Array<{ nodes: Float32Array, size: Float32Array, alpha: Float32Array, edges?: Uint16Array, center:{x:number,y:number}, color:string }>>([])
  const trailColors = ['#5ec8ff', '#ff8ac2'] // newest → oldest
  
  // Convert tile data to nodes/edges
  const { nodes, edges } = React.useMemo(() => {
    if (!tile) return { nodes: [], edges: [] }
    
    console.log('CanvasScene: Processing tile:', {
      count: tile.count,
      nodesLength: tile.nodes?.length,
      sizeLength: tile.size?.length,
      alphaLength: tile.alpha?.length,
      edgesLength: tile.edges?.length,
      firstNode: tile.nodes?.slice(0,4),
      firstEdge: tile.edges?.slice(0,4)
    })
    
    const nodes: Node[] = []
    for (let i = 0; i < tile.count; i++) {
      const node = {
        x: tile.nodes[i * 2],
        y: tile.nodes[i * 2 + 1],
        size: tile.size[i],
        alpha: tile.alpha[i],
        index: i
      }
      nodes.push(node)
      
      // Log first few nodes for debugging
      if (i < 5) {
        console.log(`Node ${i}:`, node)
      }
    }
    
    const edges: Edge[] = []
    if (tile.edges) {
      for (let i = 0; i < tile.edges.length; i += 2) {
        edges.push({
          source: tile.edges[i],
          target: tile.edges[i + 1]
        })
      }
      console.log(`Created ${edges.length} edges`)
    }
    
    console.log(`CanvasScene: Created ${nodes.length} nodes, ${edges.length} edges`)
    return { nodes, edges }
  }, [tile])

  useEffect(()=>{ nodesRef.current = nodes }, [nodes])
  useEffect(()=>{ visibleMaskRef.current = (Array.isArray(props.visibleMask) ? props.visibleMask : null) }, [props.visibleMask])

  useImperativeHandle(ref, () => ({
    setForeground: (fg, opts?: { noTrailSnapshot?: boolean }) => {
      console.log('CanvasScene setForeground: Received fg:', {
        count: fg?.count,
        nodesLength: fg?.nodes?.length,
        sizeLength: fg?.size?.length,
        alphaLength: fg?.alpha?.length,
        edgesLength: fg?.edges?.length,
        firstNodes: fg?.nodes?.slice(0,8),
        firstSizes: fg?.size?.slice(0,4)
      })
      // Snapshot current tile into the trail (max 2) unless suppressed
      if (!opts?.noTrailSnapshot) {
        try {
          const prev = tileRef.current as any
          if (prev && prev.nodes && prev.size && prev.alpha) {
            const snap = {
              nodes: new Float32Array(prev.nodes),
              size: new Float32Array(prev.size),
              alpha: new Float32Array(prev.alpha),
              edges: prev.edges ? new Uint16Array(prev.edges) : undefined,
              center: (prev.focusWorld && typeof prev.focusWorld.x === 'number') ? { x: prev.focusWorld.x, y: prev.focusWorld.y } : { x: prev.nodes[0]||0, y: prev.nodes[1]||0 },
              color: trailColors[0]
            }
            const nextTrail = [snap, ...trailRef.current].slice(0, 2)
            // Rotate colors so newest uses first color
            for (let i=0;i<nextTrail.length;i++) nextTrail[i].color = trailColors[i] || '#88a'
            trailRef.current = nextTrail
          }
        } catch (e) { console.warn('Trail snapshot failed', e) }
      }
      setTile(fg)
      try { labelsRef.current = (fg as any).labels || null } catch {}
      // Reset view and auto-fit the new data
      setTx(0)
      setTy(0)
      setScale(1)
      setTimeout(() => {
        console.log('About to call fitToContent...')
        fitToContent()
        try {
          // Wait two more frames so fitToContent state is applied
          requestAnimationFrame(()=>{
            requestAnimationFrame(()=>{
          const spawn = (fg as any).spawn
              const focusWorld = (fg as any).focusWorld
              // Fallback to center node from incoming tile if no explicit focus target
              const fallbackX = Array.isArray((fg as any).nodes) ? (fg as any).nodes[0] : undefined
              const fallbackY = Array.isArray((fg as any).nodes) ? (fg as any).nodes[1] : undefined
              const wantFocus = (focusWorld && typeof focusWorld.x === 'number' && typeof focusWorld.y === 'number')
                ? focusWorld
                : (typeof fallbackX === 'number' && typeof fallbackY === 'number' ? { x: fallbackX, y: fallbackY } : null)
              const zoom2x = Math.min(3.5, (scaleRef.current || 1) * 2.0)
              if (focusWorld && typeof focusWorld.x === 'number' && typeof focusWorld.y === 'number'){
                centerOnWorld(focusWorld.x, focusWorld.y, { animate: true, ms: 500, zoom: zoom2x })
              } else if (spawn && typeof spawn.x === 'number' && typeof spawn.y === 'number'){
                centerOnWorld(spawn.x, spawn.y, { animate: true, ms: 420, zoom: zoom2x })
              } else if (wantFocus) {
                centerOnWorld(wantFocus.x, wantFocus.y, { animate: true, ms: 480, zoom: zoom2x })
              }
            })
          })
        } catch {}
      }, 200)
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
            edges: prevCurrent.edges ? new Uint16Array(prevCurrent.edges) : undefined,
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
          edges: nextCurrent.edges ? new Uint16Array(nextCurrent.edges) : undefined,
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
          fitToContent()
          requestAnimationFrame(()=>{
            requestAnimationFrame(()=>{
              centerOnWorld(nextCurrent.center.x, nextCurrent.center.y, { animate:true, ms: 460 })
            })
          })
        }, 120)
        return true
      } catch (e) { console.warn('promoteTrailPrevious failed', e); return false }
    },
    clear: () => {
      setTile(null)
      setTx(0)
      setTy(0)
      setScale(1)
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
      console.log('focusIndex:', { index, targetScale, canvasSize: `${w}x${h}`, nodeWorld: { x:n.x, y:n.y } })
      centerOnWorld(n.x, n.y, { zoom: targetScale, animate: !!opts?.animate, ms: opts?.ms })
    }
  }), [])

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
      else console.log('Pan complete:', { fromTx, fromTy, toTx, toTy, finalTx: nx, finalTy: ny })
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
  function getCanvasLogicalSize(){
    const c = canvasRef.current
    if (!c) return { width: canvasSize.width, height: canvasSize.height }
    const r = c.getBoundingClientRect()
    return { width: r.width || canvasSize.width, height: r.height || canvasSize.height }
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
      console.log('fitToContent: no canvas or nodes', { canvas: !!canvas, nodeCount: nodes.length })
      return
    }
    
    console.log('fitToContent: Processing', nodes.length, 'nodes')
    console.log('First 5 nodes:', nodes.slice(0, 5).map((n, i) => ({ 
      index: i, 
      x: n.x.toFixed(1), 
      y: n.y.toFixed(1),
      distance: Math.sqrt(n.x*n.x + n.y*n.y).toFixed(1)
    })))
    
    const xs = nodes.map(n => n.x)
    const ys = nodes.map(n => n.y)
    const minX = Math.min(...xs) - padding
    const maxX = Math.max(...xs) + padding
    const minY = Math.min(...ys) - padding
    const maxY = Math.max(...ys) + padding
    
    console.log('Node bounds with padding:', { minX, maxX, minY, maxY })
    
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
    
    console.log('fitToContent calculation:', { w, h, sx, sy, finalScale: s, cx, cy, newTx, newTy, dpr: canvasSize.dpr })
    
    setScale(s)
    setTx(newTx)
    setTy(newTy)
    
    console.log('fitToContent result:', { 
      scale: s, 
      tx: newTx, 
      ty: newTy,
      canvasSize: `${w}x${h}`
    })
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
      console.log('Canvas resized:', { physical: `${width}x${height}`, logical: `${rect.width}x${rect.height}`, dpr })
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
      if (vm && vm.length === nodes.length && !vm[i]) continue
      const node = nodes[i]
      const dx = world.x - node.x
      const dy = world.y - node.y
      // Use the same visual size for hit testing (convert pixels → world units)
      const radiusPixels = Math.max(12, node.size * scale * 0.8)
      const radiusWorld = radiusPixels / scale
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

      function drawEdge(ctx: CanvasRenderingContext2D, edge: Edge) {
        const sourceNode = nodes[edge.source]
        const targetNode = nodes[edge.target]
        if (!sourceNode || !targetNode) return
        const A = worldToScreen(sourceNode.x, sourceNode.y)
        const B = worldToScreen(targetNode.x, targetNode.y)
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.35)'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
        // Score pill: use parsed weights if available
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2
        let score: number | null = null
        if (tile && tile.edgeWeights && tile.edges) {
          // Find matching edge index
          for (let i = 0; i < tile.edges.length; i += 2) {
            if (tile.edges[i] === edge.source && tile.edges[i + 1] === edge.target) {
              const edgeIdx = i / 2
              score = tile.edgeWeights[edgeIdx] || null
              break
            }
          }
        }
        drawScorePill(ctx, String(score ?? ''), mx, my)
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
    const radius = Math.max(8, node.size * scale * 2) // Make nodes much larger and more visible
    
    ctx.save()
    
    // Debug: Draw a bright test circle first to ensure drawing works
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius + 5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 0, 255, 0.2)' // Bright magenta for debugging
    ctx.fill()
    
    // Outer glow
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius + 3, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 165, 0, 0.5)` // Increased visibility
    ctx.fill()
    
    // Main node
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 165, 0, 1.0)` // Full opacity
    ctx.fill()
    
    // Border
    ctx.strokeStyle = `rgba(255, 200, 0, 1.0)`
    ctx.lineWidth = 2
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

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const now = performance.now()
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
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
        // connector to next newer graph (or current if newest trail)
        const nextCenter = ti === 0 ? currCenter : trail[ti-1]?.center
        if (nextCenter) {
          const A = worldToScreen(t.center.x, t.center.y)
          const B = worldToScreen(nextCenter.x, nextCenter.y)
          ctx.save()
          ctx.strokeStyle = color
          ctx.lineWidth = 3
          ctx.setLineDash([8,6])
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
          ctx.restore()
        }
      }
    } catch {}

    // Compare-mode overlays: draw filled semi-circles and distinct overlap lens
    try {
      const ov: any = (tile as any)?.compareOverlay
      if (ov && ov.regions && ov.regions.left && ov.regions.right) {
        const left = ov.regions.left
        const right = ov.regions.right
        const leftC = worldToScreen(left.cx||0, left.cy||0)
        const rightC = worldToScreen(right.cx||0, right.cy||0)
        const leftR1 = Math.max(4, (left.r1||200) * scale)
        const leftR2 = Math.max(leftR1+1, (left.r2||360) * scale)
        const rightR1 = Math.max(4, (right.r1||200) * scale)
        const rightR2 = Math.max(rightR1+1, (right.r2||360) * scale)
        const colors = (ov.colors||{})
        const leftFirst = colors.leftFirst || 'rgba(122,110,228,0.30)'
        const leftSecond = colors.leftSecond || 'rgba(122,110,228,0.18)'
        const rightFirst = colors.rightFirst || 'rgba(122,110,228,0.30)'
        const rightSecond = colors.rightSecond || 'rgba(122,110,228,0.18)'
        const overlapFirst = colors.overlapFirst || 'rgba(255,195,130,0.26)'
        const overlapSecond = colors.overlapSecond || 'rgba(255,195,130,0.16)'
        // Left filled semi-circles for first and second degrees
        ctx.save()
        ctx.fillStyle = leftSecond
        ctx.beginPath()
        ctx.moveTo(leftC.x - leftR2, leftC.y)
        ctx.arc(leftC.x, leftC.y, leftR2, Math.PI, 0, false)
        ctx.lineTo(leftC.x, leftC.y)
        ctx.closePath(); ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.fillStyle = leftFirst
        ctx.beginPath()
        ctx.moveTo(leftC.x - leftR1, leftC.y)
        ctx.arc(leftC.x, leftC.y, leftR1, Math.PI, 0, false)
        ctx.lineTo(leftC.x, leftC.y)
        ctx.closePath(); ctx.fill()
        ctx.restore()
        // Right filled semi-circles for first and second degrees
        ctx.save()
        ctx.fillStyle = rightSecond
        ctx.beginPath()
        ctx.moveTo(rightC.x - rightR2, rightC.y)
        ctx.arc(rightC.x, rightC.y, rightR2, Math.PI, 0, false)
        ctx.lineTo(rightC.x, rightC.y)
        ctx.closePath(); ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.fillStyle = rightFirst
        ctx.beginPath()
        ctx.moveTo(rightC.x - rightR1, rightC.y)
        ctx.arc(rightC.x, rightC.y, rightR1, Math.PI, 0, false)
        ctx.lineTo(rightC.x, rightC.y)
        ctx.closePath(); ctx.fill()
        ctx.restore()
        // Overlap first-degree band (inner radius)
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(leftC.x - leftR1, leftC.y)
        ctx.arc(leftC.x, leftC.y, leftR1, Math.PI, 0, false)
        ctx.lineTo(leftC.x, leftC.y)
        ctx.closePath(); ctx.clip()
        ctx.fillStyle = overlapFirst
        ctx.beginPath()
        ctx.moveTo(rightC.x - rightR1, rightC.y)
        ctx.arc(rightC.x, rightC.y, rightR1, Math.PI, 0, false)
        ctx.lineTo(rightC.x, rightC.y)
        ctx.closePath(); ctx.fill()
        ctx.restore()
        // Overlap second-degree band (outer radius)
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(leftC.x - leftR2, leftC.y)
        ctx.arc(leftC.x, leftC.y, leftR2, Math.PI, 0, false)
        ctx.lineTo(leftC.x, leftC.y)
        ctx.closePath(); ctx.clip()
        ctx.fillStyle = overlapSecond
        ctx.beginPath()
        ctx.moveTo(rightC.x - rightR2, rightC.y)
        ctx.arc(rightC.x, rightC.y, rightR2, Math.PI, 0, false)
        ctx.lineTo(rightC.x, rightC.y)
        ctx.closePath(); ctx.fill()
        ctx.restore()
      }
    } catch {}
    
    // Draw foreground edges first so nodes render on top
    if (edges && edges.length > 0) {
      // Optionally thin out when zoomed far out for performance/clarity
      const step = scale < 0.9 && edges.length > 2000 ? Math.ceil(edges.length / 2000) : 1
      for (let i = 0; i < edges.length; i += step) {
        const e = edges[i]
        const vm = visibleMaskRef.current
        if (vm && vm.length === nodes.length) {
          if (!vm[e.source] || !vm[e.target]) continue
        }
        drawEdge(ctx, e)
      }
    }
    
    // Draw nodes - People Network style
    let visibleNodes = 0
    for (let i = 0; i < nodes.length; i++) {
      const vm = visibleMaskRef.current
      if (vm && vm.length === nodes.length && !vm[i]) continue
      const node = nodes[i]
      const screen = worldToScreen(node.x, node.y)
      let radius = Math.max(12, node.size * scale * 0.8) // People Network sizing
      try { if ((tile as any)?.compareOverlay && (i === 0 || i === 1)) radius = Math.max(radius, 18) } catch {}
      
      // Check if node is visible on screen
      if (screen.x + radius >= 0 && screen.x - radius <= canvas.width && 
          screen.y + radius >= 0 && screen.y - radius <= canvas.height) {
        visibleNodes++
      }
      
      // Draw node with clean styling — special colors for two centers in compare mode
      ctx.save()
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
      
      // Main node
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      
      // Clean border
      ctx.strokeStyle = border
      ctx.lineWidth = 1.5
      ctx.stroke()
      
      // Selection highlight: pulsing halo + ring
      if (isSelected) {
        const pulse = (Math.sin(now / 180) + 1) * 0.5 // 0..1
        const haloR = radius + 8 + pulse * 6
        ctx.beginPath()
        ctx.arc(screen.x, screen.y, haloR, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(screen.x, screen.y, haloR + 3, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      
      ctx.restore()

      // Labels: require higher zoom to avoid clutter in compare mode
      if (scale > 1.8 && labelsRef.current && labelsRef.current[i]){
        drawLabel(ctx, labelsRef.current[i], screen.x, screen.y - radius - 12)
      }
    }
    
    // Debug logging every 60 frames (once per second at 60fps)
    if (Math.random() < 0.016) { // ~1/60 chance
      console.log('Draw debug:', {
        totalNodes: nodes.length,
        visibleNodes,
        canvasSize: `${canvas.width}x${canvas.height}`,
        transform: { tx, ty, scale },
        firstNodeScreen: nodes.length > 0 ? worldToScreen(nodes[0].x, nodes[0].y) : null,
        firstNodeWorld: nodes.length > 0 ? { x: nodes[0].x, y: nodes[0].y } : null
      })
      
      // Log all node screen positions if we have few nodes
      if (nodes.length > 0 && nodes.length <= 5) {
        console.log('All node screen positions:', nodes.map((n, i) => ({
          index: i,
          world: { x: n.x, y: n.y },
          screen: worldToScreen(n.x, n.y)
        })))
      }
    }
    
    ctx.restore()
    
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

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const before = screenToWorld(mx, my)
      // Faster zoom: increase sensitivity multiplier
      const speed = 0.003; // was 0.001
      const delta = -e.deltaY * speed
      const newScale = Math.max(0.2, Math.min(3.5, scale * (1 + delta)))
      setScale(newScale)
      const sx = before.x * newScale + tx
      const sy = before.y * newScale + ty
      setTx(tx + (mx - sx))
      setTy(ty + (my - sy))
      try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { tx: txRef.current, ty: tyRef.current }})) } catch {}
    }

    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      // Region hit test (compare mode)
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
      const hit = pickNode(sx, sy)
      
      if (hit) {
        draggingNodeRef.current = hit
        if (props.onPick) props.onPick(hit.index)
      } else {
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
        
        console.log(`Dragged node ${dragging.index} to: x=${dragging.x.toFixed(1)}, y=${dragging.y.toFixed(1)}`)
      } else if (isPanningRef.current) {
        setTx(prev => prev + dx)
        setTy(prev => prev + dy)
        try { window.dispatchEvent(new CustomEvent('graph_pan', { detail: { tx: txRef.current + dx, ty: tyRef.current + dy }})) } catch {}
      }
    }

    const onUp = () => {
      draggingNodeRef.current = null
      isPanningRef.current = false
      dragLastRef.current = null
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore keyboard shortcuts when user is typing in inputs/textareas/contenteditable
      try {
        const active = document.activeElement as HTMLElement | null
        const isTyping = !!(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as any)?.isContentEditable))
        if (isTyping) return
      } catch {}
      if (e.key === '+' || e.key === '=') {
        setScale(s => Math.min(3.5, s * 1.1))
      } else if (e.key === '-') {
        setScale(s => Math.max(0.2, s * 0.9))
      } else if (e.key === 'r' || e.key === 'R') {
        console.log('R key pressed - fitting content')
        fitToContent()
      } else if (e.key === 'c' || e.key === 'C') {
        // Center view manually
        console.log('C key pressed - centering view')
        setTx(0)
        setTy(0)
        setScale(1)
      } else if (e.key === 'Escape') {
        if (props.onClear) props.onClear()
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [scale, tx, ty, nodes, tile, props])

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents:'none' }}>
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
          zIndex: 1, // Above particle background
          pointerEvents:'auto'
        }} 
      />
    </div>
  )
})

export default CanvasScene


