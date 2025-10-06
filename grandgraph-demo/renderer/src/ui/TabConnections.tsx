import React from "react";

type Degree = 'all' | 'first' | 'second'

export default function TabConnections({
  labels,
  metaNodes,
  getTile,
  onMask,
  onFocusIndex,
  onSetMaskMode,
  onSetDegreeHighlight,
  onCountsChange,
}: {
  labels: string[];
  metaNodes: Array<Record<string, any>>;
  getTile: () => any | null;
  onMask: (mask: boolean[] | null) => void;
  onFocusIndex: (i: number) => void;
  onSetMaskMode?: (m: 'hide'|'dim') => void;
  onSetDegreeHighlight?: (d: Degree) => void;
  onCountsChange?: (firstCount:number, secondCount:number) => void;
}){
  const [minFirst, setMinFirst] = React.useState<number>(()=>{
    try { const v = parseInt(localStorage.getItem('CONN_MIN_FIRST')||'24',10); return Number.isFinite(v)?v:24 } catch { return 24 }
  })
  const [minSecond, setMinSecond] = React.useState<number>(()=>{
    try { const v = parseInt(localStorage.getItem('CONN_MIN_SECOND')||'24',10); return Number.isFinite(v)?v:24 } catch { return 24 }
  })
  const [degree, setDegree] = React.useState<Degree>('all')

  React.useEffect(()=>{ try { localStorage.setItem('CONN_MIN_FIRST', String(minFirst)) } catch {} }, [minFirst])
  React.useEffect(()=>{ try { localStorage.setItem('CONN_MIN_SECOND', String(minSecond)) } catch {} }, [minSecond])

  const result = React.useMemo(()=>{
    try {
      const tile = getTile?.()
      if (!tile || !tile.edges || !tile.count) return { available:false, first:[], second:[], monthsFirst:new Map<number,number>(), monthsSecond:new Map<number,number>() }
      const mode = (tile as any)?.meta?.mode
      if (mode !== 'person') return { available:false, first:[], second:[], monthsFirst:new Map<number,number>(), monthsSecond:new Map<number,number>() }
      const n = tile.count|0
      const edges: Uint16Array = tile.edges || new Uint16Array(0)
      const weights: Float32Array | Uint8Array | undefined = (tile as any).edgeWeights
      const mAll = edges.length >>> 1
      const adj = Array.from({ length: n }, () => [] as Array<{j:number,w:number}>)
      for (let i=0;i<mAll;i++){
        const a = edges[i*2]|0, b = edges[i*2+1]|0
        if (a>=n || b>=n) continue
        const w = weights && (weights as any).length===mAll ? Math.max(1, Math.round(Number((weights as any)[i]||1))) : 1
        adj[a].push({ j:b, w }); adj[b].push({ j:a, w })
      }
      // First degree: neighbors of 0 with months >= minFirst
      const monthsFirst = new Map<number,number>()
      const first = (adj[0]||[]).filter(e=> e.w >= Math.max(1, minFirst)).map(e=>{ monthsFirst.set(e.j, e.w); return e.j }).filter(i=> i>0)
      first.sort((a,b)=> (monthsFirst.get(b)||0) - (monthsFirst.get(a)||0))
      // Second degree: from any first, neighbors via edge >= minSecond; exclude center and first set
      const firstSet = new Set(first)
      const seen = new Set<number>([0, ...first])
      const monthsSecond = new Map<number,number>()
      const pushSecond = (i:number, w:number)=>{
        const prev = monthsSecond.get(i) || 0
        if (w > prev) monthsSecond.set(i, w)
      }
      for (const f of first){
        for (const e of adj[f]||[]){
          if (e.w < Math.max(1, minSecond)) continue
          const j = e.j
          if (j===0 || firstSet.has(j)) continue
          if (!seen.has(j)) { seen.add(j) }
          pushSecond(j, e.w)
        }
      }
      const second = Array.from(monthsSecond.keys())
      second.sort((a,b)=> (monthsSecond.get(b)||0) - (monthsSecond.get(a)||0))
      return { available:true, first, second, monthsFirst, monthsSecond }
    } catch {
      return { available:false, first:[], second:[], monthsFirst:new Map<number,number>(), monthsSecond:new Map<number,number>() }
    }
  }, [getTile, minFirst, minSecond])

  React.useEffect(()=>{
    try { if (result.available) onCountsChange?.(result.first.length, result.second.length) } catch {}
  }, [result, onCountsChange])

  const n = Math.max(labels?.length||0, metaNodes?.length||0)

  const onlyFirst = () => {
    if (!result.available || !n) { onMask(null); return }
    const mask = new Array<boolean>(n).fill(false)
    // Include center index 0 and all first-degree
    mask[0] = true
    for (const i of result.first) mask[i] = true
    onSetMaskMode?.('hide')
    onSetDegreeHighlight?.('first')
    onMask(mask)
  }
  const onlySecond = () => {
    if (!result.available || !n) { onMask(null); return }
    const mask = new Array<boolean>(n).fill(false)
    // Keep center visible
    mask[0] = true
    for (const i of result.second) mask[i] = true
    onSetMaskMode?.('hide')
    onSetDegreeHighlight?.('second')
    onMask(mask)
  }
  const dimSecond = () => {
    if (!result.available || !n) { onMask(null); return }
    const mask = new Array<boolean>(n).fill(false)
    // Keep center bright and highlight second-degree
    mask[0] = true
    for (const i of result.second) mask[i] = true
    onSetMaskMode?.('dim')
    onSetDegreeHighlight?.('second')
    onMask(mask)
  }
  const clearMask = () => onMask(null)

  const rowsFirst = result.first.map((i)=> ({ index:i, months: result.monthsFirst.get(i)||0 }))
  const rowsSecond = result.second.map((i)=> ({ index:i, months: result.monthsSecond.get(i)||0 }))

  const onRowClick = (i:number)=>{ onFocusIndex(i) }
  const onRowDoubleClick = (i:number)=>{
    try {
      const meta = (metaNodes?.[i] || {}) as any
      let raw: string | null = null
      if (typeof meta?.id !== 'undefined') raw = String(meta.id)
      else if (typeof meta?.person_id !== 'undefined') raw = String(meta.person_id)
      else if (typeof meta?.linkedin_id !== 'undefined') raw = String(meta.linkedin_id)
      if (!raw) return
      let canonical = raw
      if (/^(company|person):\d+$/i.test(raw)) canonical = raw.toLowerCase()
      else if (/^\d+$/.test(raw)) canonical = `person:${raw}`
      if (canonical) window.dispatchEvent(new CustomEvent('crux_insert', { detail: { text: canonical } }))
    } catch {}
  }

  const topBar = (
    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
      <div style={{ fontSize:12, color:'var(--dt-text-dim)' }}>Min months</div>
      <label style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:12, color:'var(--dt-text-dim)' }}>1°</span>
        <input className="no-drag" type="number" min={1} max={120} value={minFirst} onChange={(e)=> setMinFirst(Math.max(1, parseInt(e.target.value||'24',10)||24))}
               style={{ width:64, padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-bg)', color:'var(--dt-text)', fontSize:12 }} />
      </label>
      <label style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:12, color:'var(--dt-text-dim)' }}>2°</span>
        <input className="no-drag" type="number" min={1} max={120} value={minSecond} onChange={(e)=> setMinSecond(Math.max(1, parseInt(e.target.value||'24',10)||24))}
               style={{ width:64, padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-bg)', color:'var(--dt-text)', fontSize:12 }} />
      </label>
      <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
        <button className="no-drag" onClick={onlyFirst} title="Mask to first-degree" style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-fill-med)', color:'var(--dt-text)', fontSize:12 }}>Only First</button>
        <button className="no-drag" onClick={onlySecond} title="Mask to second-degree" style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-fill-med)', color:'var(--dt-text)', fontSize:12 }}>Only Second</button>
        <button className="no-drag" onClick={dimSecond} title="Dim non-second or highlight second" style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-fill-med)', color:'var(--dt-text)', fontSize:12 }}>Dim Second</button>
        <button className="no-drag" onClick={clearMask} title="Clear mask" style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-fill-med)', color:'var(--dt-text)', fontSize:12 }}>Clear</button>
      </div>
    </div>
  )

  const degreeSelect = (
    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
      <span style={{ color:'var(--dt-text-dim)', fontSize:12 }}>Highlight</span>
      <button className="no-drag" onClick={()=>{ setDegree('all'); onSetDegreeHighlight?.('all') }} style={{ padding:'4px 8px', borderRadius:6, border:'1px solid var(--dt-border)', background: degree==='all'?'var(--dt-fill-strong)':'var(--dt-fill-med)', color:'var(--dt-text)', fontSize:12 }}>All</button>
      <button className="no-drag" onClick={()=>{ setDegree('first'); onSetDegreeHighlight?.('first') }} style={{ padding:'4px 8px', borderRadius:6, border:'1px solid var(--dt-border)', background: degree==='first'?'var(--dt-fill-strong)':'var(--dt-fill-med)', color:'var(--dt-text)', fontSize:12 }}>1st</button>
      <button className="no-drag" onClick={()=>{ setDegree('second'); onSetDegreeHighlight?.('second') }} style={{ padding:'4px 8px', borderRadius:6, border:'1px solid var(--dt-border)', background: degree==='second'?'var(--dt-fill-strong)':'var(--dt-fill-med)', color:'var(--dt-text)', fontSize:12 }}>2nd</button>
    </div>
  )

  // Simple in-component virtualization for large lists
  const itemHeight = 42
  const List = ({ rows, side }:{ rows: Array<{ index:number, months:number }>, side:'first'|'second' })=>{
    const ref = React.useRef<HTMLDivElement|null>(null)
    const [scrollTop, setScrollTop] = React.useState(0)
    const [viewportH, setViewportH] = React.useState(0)
    React.useEffect(()=>{
      const el = ref.current
      if (!el) return
      const ro = new ResizeObserver(()=>{ try { setViewportH(el.clientHeight||340) } catch {} })
      ro.observe(el)
      return ()=> ro.disconnect()
    }, [])
    const onScroll = (e: React.UIEvent<HTMLDivElement>)=>{ setScrollTop((e.target as HTMLDivElement).scrollTop|0) }
    const total = rows.length
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 4)
    const visible = Math.max(1, Math.ceil(viewportH / itemHeight) + 8)
    const end = Math.min(total, start + visible)
    const slice = rows.slice(start, end)
    return (
      <div ref={ref} onScroll={onScroll} style={{ position:'relative', height:'100%', overflow:'auto', border:'1px solid var(--dt-border)', borderRadius:6, background:'var(--dt-bg)' }}>
        <div style={{ height: total * itemHeight, position:'relative' }}>
          {slice.map((row, k)=>{
            const i = row.index
            const top = (start + k) * itemHeight
            const name = labels?.[i] || (metaNodes?.[i] as any)?.full_name || (metaNodes?.[i] as any)?.name || `#${i}`
            const title = (metaNodes?.[i] as any)?.title || (metaNodes?.[i] as any)?.job_title || null
            const months = Math.max(0, Number(row.months||0))
            return (
              <div key={`${side}-${i}-${start}`} className="no-drag" onClick={()=> onRowClick(i)} onDoubleClick={()=> onRowDoubleClick(i)}
                   style={{ position:'absolute', left:0, right:0, top, height:itemHeight, padding:'5px 8px', borderRadius:5, background:'var(--dt-fill-weak)', border:'1px solid var(--dt-border)', cursor:'pointer', willChange:'transform', boxSizing:'border-box', overflow:'hidden' }}>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <div style={{ fontSize:12, color:'var(--dt-text)', flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</div>
                  <div style={{ fontSize:11, color:'var(--dt-text-dim)' }}>{months.toFixed(0)}m</div>
                </div>
                {title && <div style={{ fontSize:10.5, color:'var(--dt-text-dim)', opacity:0.8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{title}</div>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (!result.available) {
    return (
      <div style={{ display:'grid', gap:10 }}>
        <div style={{ color:'var(--dt-text-dim)', fontSize:13 }}>Connections available on person networks.</div>
      </div>
    )
  }

  return (
    <div style={{ display:'grid', gap:10 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        {topBar}
      </div>
      <div>{onSetDegreeHighlight ? degreeSelect : null}</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, minHeight:360, height:'calc(100vh - 220px)' }}>
        <div>
          <div style={{ fontSize:13, marginBottom:6, color:'var(--dt-text-dim)' }}>First-degree ({rowsFirst.length})</div>
          <div style={{ height:'calc(100% - 22px)' }}>
            <List rows={rowsFirst} side='first' />
          </div>
        </div>
        <div>
          <div style={{ fontSize:13, marginBottom:6, color:'var(--dt-text-dim)' }}>Second-degree ({rowsSecond.length})</div>
          <div style={{ height:'calc(100% - 22px)' }}>
            <List rows={rowsSecond} side='second' />
          </div>
        </div>
      </div>
    </div>
  )
}


