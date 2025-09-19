import React, { useEffect, useMemo, useRef, useState } from 'react'

type Node = { id: string; x: number; y: number; r: number; label?: string; group?: number }
type Edge = { a: number; b: number; w?: number }

export type UXDemoData = {
  nodes: Node[]
  edges: Edge[]
}

function generateSample(n = 180): UXDemoData {
  const nodes: Node[] = []
  const edges: Edge[] = []
  // center
  nodes.push({ id: 'center', x: 0, y: 0, r: 16, label: 'CENTER', group: 0 })
  const rings = [140, 260, 420]
  const perRing = [18, 48, 96]
  let idx = 1
  for (let r = 0; r < rings.length; r++){
    const R = rings[r]
    const m = perRing[r]
    for (let k = 0; k < m && idx < n; k++, idx++){
      const a = (k / m) * Math.PI * 2
      const jitter = 22 + Math.random() * 18
      const x = Math.cos(a) * (R + (Math.random() * 2 - 1) * jitter)
      const y = Math.sin(a) * (R + (Math.random() * 2 - 1) * jitter)
      nodes.push({ id: `n${idx}`, x, y, r: 7, label: `#${idx}`, group: r + 1 })
      edges.push({ a: 0, b: idx, w: Math.max(1, Math.round((Math.sin(a*3)+1)*6)) })
    }
  }
  // light bundling arcs between neighbors to reduce hairballs (same ring only)
  for (let i = 1; i < nodes.length - 1; i++){
    if (Math.random() < 0.12) edges.push({ a: i, b: i + 1, w: 1 })
  }
  return { nodes, edges }
}

function usePanZoom(){
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [scale, setScale] = useState(1)
  const ref = useRef({ tx, ty, scale })
  useEffect(()=>{ ref.current = { tx, ty, scale } }, [tx, ty, scale])
  return { tx, ty, scale, setTx, setTy, setScale, ref }
}

function worldToScreen(wx:number, wy:number, tx:number, ty:number, s:number){ return { x: wx*s + tx, y: wy*s + ty } }
function screenToWorld(sx:number, sy:number, tx:number, ty:number, s:number){ return { x: (sx-tx)/s, y: (sy-ty)/s } }

type Props = { data?: UXDemoData }

export default function UXDemoScene(props: Props){
  const canvasRef = useRef<HTMLCanvasElement|null>(null)
  const hoverRef = useRef<number|null>(null)
  const { tx, ty, scale, setTx, setTy, setScale, ref } = usePanZoom()
  const [size, setSize] = useState({ w: 800, h: 600, dpr: 1 })
  const data = useMemo(()=> props.data || generateSample(180), [props.data])

  // Resize handling
  useEffect(()=>{
    const c = canvasRef.current; if(!c) return
    const ro = new ResizeObserver(()=>{
      const r = c.getBoundingClientRect()
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio||1))
      c.width = Math.max(600, Math.floor(r.width * dpr))
      c.height = Math.max(400, Math.floor(r.height * dpr))
      const ctx = c.getContext('2d'); if(ctx) ctx.setTransform(dpr,0,0,dpr,0,0)
      setSize({ w: r.width, h: r.height, dpr })
    })
    ro.observe(c); return ()=> ro.disconnect()
  }, [])

  // Fit content initially
  useEffect(()=>{
    if (!data || data.nodes.length === 0) return
    const xs = data.nodes.map(n=>n.x)
    const ys = data.nodes.map(n=>n.y)
    const minX = Math.min(...xs) - 80
    const maxX = Math.max(...xs) + 80
    const minY = Math.min(...ys) - 80
    const maxY = Math.max(...ys) + 80
    const s = Math.min(1.3, Math.min(size.w/(maxX-minX), size.h/(maxY-minY)))
    const cx = (minX + maxX)/2, cy = (minY + maxY)/2
    setScale(s)
    setTx(size.w/2 - cx*s)
    setTy(size.h/2 - cy*s)
  }, [data, size.w, size.h])

  // Draw
  useEffect(()=>{
    let raf = 0
    const draw = ()=>{
      const c = canvasRef.current; if(!c) return
      const ctx = c.getContext('2d'); if(!ctx) return
      ctx.save(); ctx.clearRect(0,0,c.width,c.height)
      // Background rings
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      const rings = [140, 260, 420]
      for (const r of rings){
        const s = r * ref.current.scale
        const p = worldToScreen(0,0, ref.current.tx, ref.current.ty, ref.current.scale)
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI*2); ctx.stroke()
      }
      // Bundled edges (center spokes strong, others thin)
      for (const e of data.edges){
        const A = data.nodes[e.a], B = data.nodes[e.b]; if(!A||!B) continue
        const a = worldToScreen(A.x, A.y, ref.current.tx, ref.current.ty, ref.current.scale)
        const b = worldToScreen(B.x, B.y, ref.current.tx, ref.current.ty, ref.current.scale)
        ctx.beginPath();
        ctx.moveTo(a.x, a.y)
        // quadratic curve bending slightly toward center to imply bundles
        const midX = (a.x + b.x)/2, midY = (a.y + b.y)/2
        const cx = (size.w/2 + midX)/2, cy = (size.h/2 + midY)/2
        ctx.quadraticCurveTo(cx, cy, b.x, b.y)
        const strong = (e.a === 0 || e.b === 0)
        ctx.strokeStyle = strong ? 'rgba(255,165,0,0.35)' : 'rgba(255,255,255,0.08)'
        ctx.lineWidth = strong ? 2 : 1
        ctx.stroke()
      }
      // Nodes
      for (let i=0;i<data.nodes.length;i++){
        const n = data.nodes[i]
        const p = worldToScreen(n.x, n.y, ref.current.tx, ref.current.ty, ref.current.scale)
        const hovered = hoverRef.current === i
        const r = Math.max(8, (n.r||6) * ref.current.scale * (hovered ? 1.2 : 1))
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2)
        // two center colors for A/B style if id is A/B placeholder otherwise orange
        let fill = 'rgba(255,165,0,0.95)'
        if (i === 0) fill = 'rgba(80,200,255,0.95)'
        ctx.fillStyle = fill; ctx.fill()
        ctx.strokeStyle = 'rgba(255,200,0,1.0)'; ctx.lineWidth = 1.5; ctx.stroke()
        if (hovered && n.label){
          ctx.font = '12px ui-sans-serif, system-ui'
          const pad = 6; const m = ctx.measureText(n.label)
          const w = m.width + pad*2, h = 18
          ctx.fillStyle = 'rgba(10,10,14,0.9)'
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'
          roundRect(ctx, p.x - w/2, p.y - r - 10 - h, w, h, 8, true, true)
          ctx.fillStyle = '#fff'; ctx.fillText(n.label, p.x - w/2 + pad, p.y - r - 10 - 4)
        }
      }
      ctx.restore(); raf = requestAnimationFrame(draw)
    }
    draw(); return ()=> cancelAnimationFrame(raf)
  }, [data])

  // Interactions
  useEffect(()=>{
    const c = canvasRef.current; if(!c) return
    const onWheel = (e: WheelEvent)=>{
      e.preventDefault()
      const r = c.getBoundingClientRect(); const mx = e.clientX - r.left; const my = e.clientY - r.top
      const before = screenToWorld(mx, my, ref.current.tx, ref.current.ty, ref.current.scale)
      const next = Math.max(0.25, Math.min(3.0, ref.current.scale * (1 - e.deltaY * 0.0015)))
      setScale(next)
      const sx = before.x * next + ref.current.tx
      const sy = before.y * next + ref.current.ty
      setTx(ref.current.tx + (mx - sx))
      setTy(ref.current.ty + (my - sy))
    }
    let down = false; let last = { x:0, y:0 }
    const onDown = (e: PointerEvent)=>{ down = true; const r=c.getBoundingClientRect(); last={ x:e.clientX-r.left, y:e.clientY-r.top }; (e.target as Element).setPointerCapture(e.pointerId) }
    const onMove = (e: PointerEvent)=>{
      const r = c.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top
      if (down){ setTx(t=>t + (x - last.x)); setTy(t=>t + (y - last.y)); last = { x, y }; return }
      // hover test
      const world = screenToWorld(x, y, ref.current.tx, ref.current.ty, ref.current.scale)
      let hit: number|null = null
      for (let i=data.nodes.length-1;i>=0;i--){
        const n = data.nodes[i]; const dx = world.x - n.x; const dy = world.y - n.y; const rr = Math.max(8, (n.r||6))
        if (dx*dx + dy*dy <= rr*rr) { hit = i; break }
      }
      hoverRef.current = hit
    }
    const onUp = ()=>{ down = false }
    c.addEventListener('wheel', onWheel, { passive:false })
    c.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return ()=>{ c.removeEventListener('wheel', onWheel); c.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [data])

  return (
    <div style={{ position:'absolute', inset:0 }}>
      <div style={{ position:'absolute', inset:0, background:'rgba(5,7,12,0.75)' }} />
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%' }} />
      <div style={{ position:'absolute', top:16, right:16, display:'flex', gap:8 }}>
        <a href={window.location.pathname} style={{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.18)', textDecoration:'none' }}>Exit Demo</a>
      </div>
      <div style={{ position:'absolute', bottom:14, left:14, color:'#cde3ff', fontSize:12, opacity:0.9 }}>UX Demo: Radial layout, bundled edges, hover labels, clean rings.</div>
    </div>
  )
}

function roundRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,fill:boolean,stroke:boolean){
  const min=Math.min(w,h)/2; r=Math.min(r,min); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); if(fill) ctx.fill(); if(stroke) ctx.stroke()
}


