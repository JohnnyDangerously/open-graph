import React, { useRef, useState, useEffect } from "react";
import CanvasScene from "./graph/CanvasScene";
import CommandBar from "./ui/CommandBar";
import HUD from "./ui/HUD";
import Settings from "./ui/Settings";
import Sidebar from "./ui/Sidebar";
import { setApiConfig } from "./lib/api";
import { resolveSmart, loadTileSmart } from "./smart";
import TriplesModal from "./ui/TriplesModal";
import MobilitySankeyDemo from "./ui/MobilitySankeyDemo";
import PathFindingDemo from "./ui/PathFindingDemo";
import PeopleNetwork from "./ui/PeopleNetwork";
import type { ParsedTile } from "./graph/parse";

type SceneRef = { setForeground: (fg: any) => void; clear: () => void };

export default function App(){
  const [focus, setFocus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sceneRef = useRef<SceneRef | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fps, setFps] = useState(60);
  const [nodeCount, setNodeCount] = useState(0);
  const [labels, setLabels] = useState<string[]>([]);
  const [metaNodes, setMetaNodes] = useState<Array<{ id?: string|number }>>([]);
  const [avatars, setAvatars] = useState<string[]>([]);
  const [history, setHistory] = useState<Array<{ id: string, move?: { x:number, y:number }, turn?: number }>>([]);
  const [cursor, setCursor] = useState(-1);
  const [filters, setFilters] = useState({ email:false, work:false, social:false, phone:false });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [apiBase, setApiBase] = useState<string>(()=>{
    try { return localStorage.getItem('API_BASE') || "http://34.192.99.41" } catch { return "http://34.192.99.41" }
  });
  const [bearer, setBearer] = useState<string>(()=>{
    try { return localStorage.getItem('API_BEARER') || "" } catch { return "" }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [concentric, setConcentric] = useState(false);
  const [showTriples, setShowTriples] = useState(false);
  const [showMobility, setShowMobility] = useState(false);
  const [showPathFinding, setShowPathFinding] = useState(false);
  const [showPeopleNetwork, setShowPeopleNetwork] = useState(false);
  const [demoHeight, setDemoHeight] = useState<number>(()=> Math.max(680, Math.floor((typeof window !== 'undefined' ? window.innerHeight : 900) * 0.9)));
  const [spawnDir, setSpawnDir] = useState(0) // 0:N,1:E,2:S,3:W
  const [selectedRegion, setSelectedRegion] = useState<null | 'left' | 'right' | 'overlap'>(null)
  const [sidebarIndices, setSidebarIndices] = useState<number[] | null>(null)
  const [compareGroups, setCompareGroups] = useState<null | { left:number[], right:number[], overlap:number[] }>(null)
  const lastCompareIdsRef = useRef<{ a:string, b:string } | null>(null)

  useEffect(()=>{
    const onResize = ()=> setDemoHeight(Math.max(680, Math.floor((typeof window !== 'undefined' ? window.innerHeight : 900) * 0.9)));
    window.addEventListener('resize', onResize);
    return ()=> window.removeEventListener('resize', onResize);
  },[]);

  const demoTriples = React.useMemo(()=>{
    const person = (name:string, title?:string)=>({ name, title, avatarUrl:`https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(name)}` })
    return [
      {
        left: person('Alex Kim','PM'),
        middle: person('Jordan Lee','Staff Eng'),
        right: person('Priya Patel','VP Eng'),
        scores: { pairLM:0.74, pairMR:0.88, pairLR:0.32, triadicClosure:0.69, transactionalSymmetry:'junior_to_senior' as const, opportunityFit:82, fanIn:91 },
      },
      {
        left: person('Sam Rivera','Founder'),
        middle: person('Morgan Chen','Director'),
        right: person('Taylor Brooks','CPO'),
        scores: { pairLM:0.41, pairMR:0.52, pairLR:0.28, triadicClosure:0.39, transactionalSymmetry:'peer_to_peer' as const, opportunityFit:46, fanIn:55 },
      },
      {
        left: person('Avery Johnson','IC4'),
        middle: person('Riley Thompson','Sr. Manager'),
        right: person('Casey Nguyen','Head of Data'),
        scores: { pairLM:0.91, pairMR:0.85, pairLR:0.63, triadicClosure:0.88, transactionalSymmetry:'junior_to_senior' as const, opportunityFit:94, fanIn:97 },
        highlighted: true,
      },
      {
        left: person('Jamie Park','BizOps'),
        middle: person('Chris Adams','Sr. Eng'),
        right: person('Quinn Bailey','CTO'),
        scores: { pairLM:0.36, pairMR:0.58, pairLR:0.22, triadicClosure:0.33, transactionalSymmetry:'senior_to_junior' as const, opportunityFit:38, fanIn:49 },
      },
      {
        left: person('Drew Carter','AE'),
        middle: person('Skylar Green','Solutions'),
        right: person('Harper Fox','SVP Sales'),
        scores: { pairLM:0.67, pairMR:0.71, pairLR:0.29, triadicClosure:0.61, transactionalSymmetry:'junior_to_senior' as const, opportunityFit:73, fanIn:84 },
      }
    ]
  },[])

  async function run(cmd: string, opts?: { pushHistory?: boolean, overrideMove?: { x:number, y:number }, turnRadians?: number }){
    const pushHistory = opts?.pushHistory !== false;
    const s = cmd.trim();
    if (!s) return;
    if (s.toLowerCase() === "clear") { sceneRef.current?.clear(); setFocus(null); return; }
    // Compare mode: "<a> + <b>" or "compare <a> + <b>"
    if (/\+/.test(s)) {
      await runCompare(s);
      return;
    }
    const m = /^show\s+(.+)$/.exec(s);
    let id = (m ? m[1] : s).trim();
    // resolve via cache-first or backend fallback
    const r = await resolveSmart(id)
    if (!r) { setErr('Could not resolve that person/company. Try a LinkedIn URL or exact name.'); return }
    id = r
    setFocus(id);
    // We will push history after we know the move vector actually used
    setErr(null);
    try {
      const { tile } = await loadTileSmart(id)
      // Capture labels for sidebar (if provided by JSON path)
      try { if ((tile as any).labels && Array.isArray((tile as any).labels)) setLabels((tile as any).labels as string[]) } catch {}
      // Derive avatar urls if meta available; fallback to dicebear from label
      try {
        const metaNodes: Array<{ avatar_url?: string, avatarUrl?: string, name?: string, full_name?: string, id?: string|number }> | undefined = (tile as any).meta?.nodes
        if (Array.isArray(metaNodes)) setMetaNodes(metaNodes as any)
        const av = new Array(tile.count).fill('').map((_, i)=>{
          const m = metaNodes?.[i]
          const url = (m?.avatar_url || m?.avatarUrl) as string | undefined
          const label = (m?.full_name || m?.name || (tile as any).labels?.[i]) as string | undefined
          if (url && typeof url === 'string') return url
          const seed = encodeURIComponent(label || String(m?.id || i))
          return `https://api.dicebear.com/7.x/thumbs/svg?seed=${seed}`
        })
        setAvatars(av)
      } catch {}

      // Offset to one of four cardinal directions and mark spawn
      try {
        const DIST = 900
        const dirs = [ {x:0, y:-DIST}, {x:DIST, y:0}, {x:0, y:DIST}, {x:-DIST, y:0} ]
        const usedMove = opts?.overrideMove || dirs[spawnDir % 4]
        if (tile?.nodes && typeof tile.nodes.length === 'number'){
          for (let i=0;i<tile.count;i++){
            tile.nodes[i*2] += usedMove.x
            tile.nodes[i*2+1] += usedMove.y
          }
          ;(tile as any).spawn = { x: usedMove.x, y: usedMove.y }
          // Set desired focus target as the center node
          try { (tile as any).focusWorld = { x: tile.nodes[0], y: tile.nodes[1] } } catch {}
          if (!opts?.overrideMove) setSpawnDir((spawnDir+1)%4)
          if (pushHistory) {
            setHistory(h=>{ const nh=[...h.slice(0,cursor+1), { id, move: usedMove, turn: opts?.turnRadians || 0 }]; setCursor(nh.length-1); return nh })
          }
        }
      } catch (e) { console.warn('spawn offset failed', e) }

      try {
        sceneRef.current?.setForeground(tile as any);
      } catch (e) {
        console.error('App: setForeground failed:', e)
      }
      console.log('App: Received tile:', {
        count: tile.count,
        nodesLength: tile.nodes?.length,
        edgesLength: tile.edges?.length,
        labelsLength: tile.labels?.length
      })
    } catch (e: any) {
      setErr(e?.message || "fetch failed");
    }
  }

  // --- Compare Mode Implementation ---
  function nodeIdFor(tile: any, i: number): string {
    const meta = tile?.meta?.nodes?.[i]
    const val = meta?.id ?? meta?.linkedin_id ?? meta?.handle ?? tile?.labels?.[i]
    return String(val ?? i)
  }

  function nodeLabelFor(tile: any, i: number): string {
    const meta = tile?.meta?.nodes?.[i]
    return String(meta?.full_name || meta?.name || tile?.labels?.[i] || nodeIdFor(tile, i))
  }

  function buildIdLabelMap(tile: any): Map<string,string> {
    const m = new Map<string,string>()
    const n = tile?.count|0
    for (let i=0;i<n;i++){
      const id = nodeIdFor(tile, i)
      const label = nodeLabelFor(tile, i)
      if (id) m.set(String(id), label)
    }
    return m
  }

  function degreesFor(tile: ParsedTile){
    const count = tile.count|0
    const edges = tile.edges || new Uint16Array(0)
    const neighbors: number[][] = Array.from({ length: count }, () => [])
    for (let i=0;i<edges.length;i+=2){ const a=edges[i]|0, b=edges[i+1]|0; if (a<count && b<count){ neighbors[a].push(b); neighbors[b].push(a) } }
    const first: number[] = Array.from(new Set(neighbors[0]||[])).filter(i=>i>0)
    const seen = new Set<number>([0, ...first])
    const second: number[] = []
    for (const f of first){ for (const n of neighbors[f]){ if (!seen.has(n)){ seen.add(n); if (n>0) second.push(n) } } }
    const firstIds = new Set<string>(first.map(i=>nodeIdFor(tile as any, i)))
    const secondIds = new Set<string>(second.map(i=>nodeIdFor(tile as any, i)))
    return { first, second, firstIds, secondIds }
  }

  // Blue-noise best-candidate sampling inside a half-annulus to avoid visible rings/lines
  function pointsInHalfAnnulus(cx:number, cy:number, rInner:number, rOuter:number, n:number){
    const pts: Array<{x:number,y:number}> = []
    const area = Math.PI * (rOuter*rOuter - rInner*rInner) * 0.5
    const idealSpacing = Math.sqrt(area / Math.max(1, n))
    const minDist = idealSpacing * 0.9
    const maxAttempts = 18
    const randInRegion = ()=>{
      // sample radius by area to get uniform distribution in annulus
      const t = Math.random()
      const r = Math.sqrt(rInner*rInner + t*(rOuter*rOuter - rInner*rInner))
      const a = Math.random() * Math.PI
      return { x: cx + r*Math.cos(a), y: cy - r*Math.sin(a) }
    }
    for (let i=0;i<n;i++){
      let best = null as null | { x:number, y:number, score:number }
      for (let k=0;k<maxAttempts;k++){
        const p = randInRegion()
        let dMin = 1e9
        for (let j=0;j<pts.length;j++){
          const q = pts[j]
          const dx = p.x - q.x, dy = p.y - q.y
          const d = dx*dx + dy*dy
          if (d < dMin) dMin = d
        }
        const score = Math.min(dMin, minDist*minDist)
        if (!best || score > best.score) best = { x:p.x, y:p.y, score }
        if (dMin >= minDist*minDist) { best = { x:p.x, y:p.y, score:dMin }; break }
      }
      if (best) pts.push({ x: best.x, y: best.y })
      else pts.push(randInRegion())
    }
    return pts
  }

  function buildCompareTile(a: ParsedTile, b: ParsedTile, opts?: { highlight?: 'left'|'right'|'overlap' }){
    const degA = degreesFor(a)
    const degB = degreesFor(b)
    const mapA = buildIdLabelMap(a as any)
    const mapB = buildIdLabelMap(b as any)
    // Overlap categories
    const mutualF1 = Array.from(degA.firstIds).filter(id=>degB.firstIds.has(id))
    const mutualF2 = Array.from(degA.secondIds).filter(id=>degB.secondIds.has(id))
    const aF1_bF2 = Array.from(degA.firstIds).filter(id=>degB.secondIds.has(id) && !degB.firstIds.has(id))
    const bF1_aF2 = Array.from(degB.firstIds).filter(id=>degA.secondIds.has(id) && !degA.firstIds.has(id))
    const aOnly = Array.from(new Set<string>([...degA.firstIds, ...degA.secondIds])).filter(id=>!degB.firstIds.has(id) && !degB.secondIds.has(id))
    const bOnly = Array.from(new Set<string>([...degB.firstIds, ...degB.secondIds])).filter(id=>!degA.firstIds.has(id) && !degA.secondIds.has(id))

    // Map id -> source tile and original index to get labels
    const labelFor = (id:string)=> mapA.get(id) || mapB.get(id) || id

    // Layout params
    // Centers and radii chosen to GUARANTEE overlap for both first and second rings
    const leftCX = -160, rightCX = 160, baseCY = 260
    const r1 = 200, r2 = 360
    const midCX = 0

    // Centers
    const nodes: number[] = []
    const size: number[] = []
    const alpha: number[] = []
    const labels: string[] = []
    const indexGroups = { left: [] as number[], right: [] as number[], overlap: [] as number[] }

    // Center nodes for A and B
    nodes.push(leftCX, baseCY); size.push(14); alpha.push(1.0); labels.push(labelFor(nodeIdFor(a as any, 0)))
    nodes.push(rightCX, baseCY); size.push(14); alpha.push(1.0); labels.push(labelFor(nodeIdFor(b as any, 0)))

    // Ring placements
    function addGroupFilled(ids:string[], cx:number, cy:number, rMin:number, rMax:number, opts2:{ baseSize:number, bgSize:number, region:'left'|'right'|'overlap', ring:'first'|'second'|'cross', pred?:(x:number,y:number)=>boolean }){
      const gen = ()=> pointsInHalfAnnulus(cx, cy, Math.max(0, rMin), Math.max(rMin+1, rMax), Math.max(1, ids.length))
      // Best-candidate acceptance constrained by predicate to keep all points INSIDE shaded region
      const raw = gen()
      const pts: Array<{x:number,y:number}> = []
      const pred = opts2.pred || (()=>true)
      const minDist2 = 9 // keep minimal spacing in world units
      for (let k=0;k<raw.length*5 && pts.length<ids.length;k++){
        const p = raw[k % raw.length]
        if (!pred(p.x, p.y)) continue
        let ok = true
        for (let j=0;j<pts.length;j++){ const q=pts[j]; const dx=p.x-q.x, dy=p.y-q.y; if (dx*dx+dy*dy < minDist2) { ok=false; break } }
        if (ok) pts.push(p)
      }
      while (pts.length < ids.length) { // fallback
        const p = raw[Math.floor(Math.random()*raw.length)]
        if (pred(p.x,p.y)) pts.push(p)
      }
      const highlightRegion = opts?.highlight || null
      const emphasize = (highlightRegion && highlightRegion === opts2.region)
      const ratio = emphasize ? 1.0 : (opts2.ring === 'first' || opts2.ring === 'cross' ? 0.22 : 0.16)
      const maxStrong = Math.ceil(ids.length * ratio)
      const strongEvery = Math.max(1, Math.floor(ids.length / Math.max(1, maxStrong)))
      for (let i=0;i<ids.length;i++){
        const p = pts[i]
        const isStrong = (i % strongEvery === 0) || emphasize
        const drawSize = isStrong ? opts2.baseSize : opts2.bgSize
        const drawAlpha = isStrong ? 0.94 : 0.28
        nodes.push(p.x, p.y)
        size.push(drawSize)
        alpha.push(drawAlpha)
        labels.push(labelFor(ids[i]))
        indexGroups[opts2.region].push((nodes.length/2)-1)
      }
    }

    // Geometry helpers for region predicates
    const insideHalfAnnulus = (x:number,y:number, cx:number, cy:number, rIn:number, rOut:number)=>{
      if (y > cy + 1) return false; const dx=x-cx, dy=y-cy; const d=Math.sqrt(dx*dx+dy*dy); return d>=rIn && d<=rOut
    }
    const dTo = (x:number,y:number,cx:number,cy:number)=> Math.hypot(x-cx,y-cy)
    const inLeftFirst = (x:number,y:number)=> dTo(x,y,leftCX,baseCY) <= r1 && y <= baseCY
    const inRightFirst = (x:number,y:number)=> dTo(x,y,rightCX,baseCY) <= r1 && y <= baseCY
    const inLeftSecond = (x:number,y:number)=> dTo(x,y,leftCX,baseCY) > r1 && dTo(x,y,leftCX,baseCY) <= r2 && y <= baseCY
    const inRightSecond = (x:number,y:number)=> dTo(x,y,rightCX,baseCY) > r1 && dTo(x,y,rightCX,baseCY) <= r2 && y <= baseCY

    // First-degree unique and mutual
    addGroupFilled(Array.from(degA.firstIds).filter(id=>!mutualF1.includes(id) && !aF1_bF2.includes(id)), leftCX, baseCY, 0, r1, { baseSize:4.6, bgSize:0.8, region:'left', ring:'first', pred:(x,y)=> inLeftFirst(x,y) && !(inRightFirst(x,y) || inRightSecond(x,y)) })
    addGroupFilled(Array.from(degB.firstIds).filter(id=>!mutualF1.includes(id) && !bF1_aF2.includes(id)), rightCX, baseCY, 0, r1, { baseSize:4.6, bgSize:0.8, region:'right', ring:'first', pred:(x,y)=> inRightFirst(x,y) && !(inLeftFirst(x,y) || inLeftSecond(x,y)) })
    addGroupFilled(mutualF1, midCX, baseCY, 0, r1, { baseSize:5.0, bgSize:0.9, region:'overlap', ring:'first', pred:(x,y)=> inLeftFirst(x,y) && inRightFirst(x,y) })
    // Cross ring (first of A that are second of B) and vice versa → place near mid but biased
    addGroupFilled(aF1_bF2, (leftCX+midCX)/2, baseCY, 0, r1, { baseSize:4.4, bgSize:0.8, region:'overlap', ring:'cross', pred:(x,y)=> inLeftFirst(x,y) && inRightSecond(x,y) && !inRightFirst(x,y) })
    addGroupFilled(bF1_aF2, (rightCX+midCX)/2, baseCY, 0, r1, { baseSize:4.4, bgSize:0.8, region:'overlap', ring:'cross', pred:(x,y)=> inRightFirst(x,y) && inLeftSecond(x,y) && !inLeftFirst(x,y) })

    // Second-degree
    addGroupFilled(Array.from(degA.secondIds).filter(id=>!mutualF2.includes(id)), leftCX, baseCY, r1, r2, { baseSize:3.4, bgSize:0.7, region:'left', ring:'second', pred:(x,y)=> inLeftSecond(x,y) && !(inRightFirst(x,y) || inRightSecond(x,y)) })
    addGroupFilled(Array.from(degB.secondIds).filter(id=>!mutualF2.includes(id)), rightCX, baseCY, r1, r2, { baseSize:3.4, bgSize:0.7, region:'right', ring:'second', pred:(x,y)=> inRightSecond(x,y) && !(inLeftFirst(x,y) || inLeftSecond(x,y)) })
    addGroupFilled(mutualF2, midCX, baseCY, r1, r2, { baseSize:3.6, bgSize:0.8, region:'overlap', ring:'second', pred:(x,y)=> inLeftSecond(x,y) && inRightSecond(x,y) && !(inLeftFirst(x,y) && inRightFirst(x,y)) })

    // Non-overlapping pools (optional, already covered above as A-only/B-only across rings)
    // Use small jitter around outer radius
    addGroupFilled(aOnly, leftCX-40, baseCY, r2+10, r2+80, { baseSize:3.8, bgSize:1.6, region:'left' })
    addGroupFilled(bOnly, rightCX+40, baseCY, r2+10, r2+80, { baseSize:3.8, bgSize:1.6, region:'right' })

    const out: ParsedTile = {
      count: nodes.length/2,
      nodes: new Float32Array(nodes),
      size: new Float32Array(size),
      alpha: new Float32Array(alpha),
      group: new Uint16Array(nodes.length/2),
      // no edges for clarity
    } as any
    ;(out as any).labels = labels
    ;(out as any).compareIndexGroups = indexGroups
    ;(out as any).compareOverlay = {
      // regions carry both radii for overlay renderer
      regions: {
        left: { cx: leftCX, cy: baseCY, r1, r2 },
        right: { cx: rightCX, cy: baseCY, r1, r2 },
        overlap: { cx: midCX, cy: baseCY, r1, r2 }
      },
      colors: {
        leftFirst: 'rgba(122,110,228,0.30)',
        leftSecond: 'rgba(122,110,228,0.18)',
        rightFirst: 'rgba(122,110,228,0.30)',
        rightSecond: 'rgba(122,110,228,0.18)',
        overlapFirst: opts?.highlight==='overlap' ? 'rgba(255,195,130,0.34)' : 'rgba(255,195,130,0.26)',
        overlapSecond: opts?.highlight==='overlap' ? 'rgba(255,195,130,0.22)' : 'rgba(255,195,130,0.16)'
      }
    }
    // Focus at mid for first render
    ;(out as any).focusWorld = { x: 0, y: baseCY }
    return out
  }

  async function runCompare(raw: string){
    try {
      const s = raw.replace(/^compare\s*/i,'')
      const parts = s.split('+').map(t=>t.trim()).filter(Boolean)
      if (parts.length !== 2) { setErr('Compare expects exactly two ids, e.g. "Alice + Bob"'); return }
      const [aIn, bIn] = parts
      const [aId, bId] = await Promise.all([resolveSmart(aIn), resolveSmart(bIn)])
      if (!aId || !bId) { setErr('Could not resolve one or both ids for compare.'); return }
      setErr(null)
      setFocus(`${aId} + ${bId}`)
      const [{ tile: aTile }, { tile: bTile }] = await Promise.all([loadTileSmart(aId), loadTileSmart(bId)])
      lastCompareIdsRef.current = { a:aId, b:bId }
      const compareTile = buildCompareTile(aTile as any, bTile as any)
      // Update labels/avatars for sidebar
      try { if ((compareTile as any).labels) setLabels((compareTile as any).labels as string[]) } catch {}
      try {
        const av = new Array(compareTile.count).fill('').map((_, i)=>{
          const label = (compareTile as any).labels?.[i]
          const seed = encodeURIComponent(label || String(i))
          return `https://api.dicebear.com/7.x/thumbs/svg?seed=${seed}`
        })
        setAvatars(av)
      } catch {}
      try { const g = (compareTile as any).compareIndexGroups; if (g) { setCompareGroups(g); setSidebarIndices(null) } } catch {}
      setSelectedRegion(null)
      sceneRef.current?.setForeground(compareTile as any)
      // Zoom in more on load for compare to reduce perceived noise
      try { (sceneRef.current as any)?.focusIndex?.(0, { animate:true, ms:420, zoom: 1.4 }) } catch {}
    } catch (e:any) {
      setErr(e?.message || 'compare failed')
    }
  }

  // Region click handling in compare mode
  async function onRegionClick(region: 'left'|'right'|'overlap'){
    try {
      setSelectedRegion(region)
      const ids = lastCompareIdsRef.current
      if (!ids) return
      const [{ tile: aTile }, { tile: bTile }] = await Promise.all([loadTileSmart(ids.a), loadTileSmart(ids.b)])
      const compareTile = buildCompareTile(aTile as any, bTile as any, { highlight: region })
      try { const g = (compareTile as any).compareIndexGroups; if (g) setCompareGroups(g) } catch {}
      // Sidebar filter by region
      try {
        const g = (compareTile as any).compareIndexGroups
        if (g && g[region]) setSidebarIndices(g[region])
      } catch {}
      sceneRef.current?.setForeground(compareTile as any)
    } catch {}
  }

  // Left-arrow: recenter on selected node → load that person's ego and rotate background
  useEffect(()=>{
    const onKey = (e: KeyboardEvent)=>{
      const active = document.activeElement as HTMLElement | null
      const isTyping = !!(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as any)?.isContentEditable))
      if (e.key === 'ArrowDown' && typeof selectedIndex === 'number') setSelectedIndex(i=> (i+1) % metaNodes.length)
      if (e.key === 'ArrowUp' && typeof selectedIndex === 'number') setSelectedIndex(i=> (i-1 + metaNodes.length) % metaNodes.length)
      if (e.key === 'ArrowRight' && typeof selectedIndex === 'number') {
        setSelectedIndex(i=> (i+1) % metaNodes.length)
        ;(sceneRef.current as any)?.focusIndex?.((i+1) % metaNodes.length, { zoom: 0.9 })
      }
      if (e.key === 'ArrowLeft') {
        if (isTyping) return
        if (typeof selectedIndex !== 'number' || selectedIndex < 0) return
        const sel = metaNodes?.[selectedIndex]
        if (!sel || sel.id == null) return
        const id = String(sel.id)
        run(`show person:${id}`)
        const radians = (Math.random() > 0.5 ? 1 : -1) * (Math.PI/2)
        window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians } }))
        return
      }
      // Back navigation
      if (e.key === 'Backspace' && !isTyping) {
        e.preventDefault()
        if (cursor > 0 && history[cursor]) {
          const cur = history[cursor]
          const prev = history[cursor-1]
          setCursor(cursor-1)
          // reverse camera motion: use negative of the move we took to reach current
          if (cur?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: -(cur.turn||0) } }))
          run(prev.id, { pushHistory: false, overrideMove: { x: -(cur?.move?.x||0), y: -(cur?.move?.y||0) } })
        }
        return
      }
      if (e.metaKey && (e.key === '[' || e.key === 'BracketLeft')) {
        e.preventDefault()
        if (cursor > 0 && history[cursor]) { const cur = history[cursor]; const prev = history[cursor-1]; setCursor(cursor-1); if (cur?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: -(cur.turn||0) } })); run(prev.id, { pushHistory:false, overrideMove: { x: -(cur?.move?.x||0), y: -(cur?.move?.y||0) } }) }
        return
      }
      if (e.metaKey && (e.key === ']' || e.key === 'BracketRight')) {
        e.preventDefault()
        if (cursor < history.length-1) { const next = history[cursor+1]; setCursor(cursor+1); if (next?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: next.turn||0 } })); run(next.id, { pushHistory:false, overrideMove:{ x: next?.move?.x||0, y: next?.move?.y||0 } }) }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return ()=> window.removeEventListener('keydown', onKey)
  }, [selectedIndex, metaNodes, history, cursor])

  return (
    <div className="w-full h-full" style={{ background: "transparent", color: "white", position:'fixed', inset:0, overflow:'hidden' }}>
      <CanvasScene ref={sceneRef as any} concentric={concentric} filters={filters} onPick={(i)=>{ setSelectedIndex(i) }} onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }} onStats={(fps,count)=>{ setFps(fps); setNodeCount(count) }} onRegionClick={onRegionClick} />
      <Sidebar 
        open={sidebarOpen} 
        onToggle={()=>setSidebarOpen(!sidebarOpen)} 
        items={(sidebarIndices ? sidebarIndices : Array.from({length: Math.max(0,nodeCount)},(_,i)=>i)).map((i)=>({ index:i, group:(i%8), name: labels[i], avatarUrl: avatars[i] }))}
        onSelect={(i)=>{ setSelectedIndex(i); }} 
        onDoubleSelect={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate: true, ms: 520, zoomMultiplier: 4 }); setSidebarOpen(false); }} 
      />
      <CommandBar onRun={run} />
      <HUD focus={focus} nodes={nodeCount} fps={fps} selectedIndex={selectedIndex} concentric={concentric} onToggleConcentric={()=>setConcentric(c=>!c)} onSettings={()=>setShowSettings(true)} onBack={()=>{ if(cursor>0 && history[cursor]){ const cur=history[cursor]; const prev=history[cursor-1]; setCursor(cursor-1); if (cur?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: -(cur.turn||0) } })); run(prev.id, { pushHistory:false, overrideMove:{ x: -(cur?.move?.x||0), y: -(cur?.move?.y||0) } }) } }} onForward={()=>{ if(cursor<history.length-1){ const next=history[cursor+1]; setCursor(cursor+1); if (next?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: next.turn||0 } })); run(next.id, { pushHistory:false, overrideMove:{ x: next?.move?.x||0, y: next?.move?.y||0 } }) } }} canBack={cursor>0} canForward={cursor<history.length-1} filters={filters} onToggleFilter={(k)=>setFilters(f=>({ ...f, [k]: !f[k] }))} />
      <div style={{ position:'absolute', left:0, right:0, top:56, display:'flex', justifyContent:'center', gap:10, zIndex:15 }}>
        <button onClick={()=>setShowTriples(true)} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)' }}>Show Triples</button>
        <button onClick={()=>setShowMobility(true)} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)' }}>Network Migration</button>
        <button onClick={()=>setShowPathFinding(true)} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)' }}>Path Finding v1</button>
        <button onClick={()=>setShowPeopleNetwork(true)} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)' }}>People Network</button>
      </div>
      {err && (
        <div style={{ position:'absolute', top:52, left:12, right:12, padding:'10px 12px', background:'rgba(200,40,60,0.2)', border:'1px solid rgba(255,80,100,0.35)', color:'#ffbfc9', borderRadius:10, zIndex:11 }}>
          {err}
        </div>
      )}
      {showSettings && (
        <Settings apiBase={apiBase} bearer={bearer} onSave={({apiBase,bearer})=>{ setApiBase(apiBase); setBearer(bearer); setApiConfig(apiBase,bearer); setShowSettings(false); }} onClose={()=>setShowSettings(false)} />
      )}
      {showTriples && (
        <TriplesModal open={showTriples} onClose={()=>setShowTriples(false)} triples={demoTriples} />
      )}
      {showMobility && (
        <div style={{ position:'absolute', inset:0, background:'rgba(2,6,23,0.8)', display:'grid', placeItems:'center', zIndex:40 }}>
          <div style={{ width:'98vw', height:'96vh', maxWidth:'98vw', maxHeight:'96vh', borderRadius:20, background:'#0b0c10', border:'1px solid rgba(255,255,255,0.08)', boxShadow:'0 28px 120px rgba(0,0,0,0.6)', overflow:'auto' }}>
            <div style={{ position:'absolute', top:16, right:16, zIndex:10 }}>
              <button onClick={()=>setShowMobility(false)} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)', fontSize:14 }}>Close</button>
            </div>
            <MobilitySankeyDemo />
      </div>
      {/* Optional: Job filter drawer (re-add button if you want always visible) */}
      {/*
      <JobFilterDrawer open={jobDrawer} onClose={()=>setJobDrawer(false)} titles={allJobTitles} selected={jobFilter} mode={'include'} onModeChange={()=>{}} onChange={(next)=>{ setJobFilter(next); try{ const ids=lastCompareIdsRef.current; if (ids && cacheTilesRef.current.a && cacheTilesRef.current.b){ const nextTile = buildCompareTile(cacheTilesRef.current.a as any, cacheTilesRef.current.b as any, { highlight: selectedRegion||undefined as any }); sceneRef.current?.setForeground(nextTile as any) } } catch{} }} />
      */}
        </div>
      )}
      {showPathFinding && (
        <div style={{ position:'absolute', inset:0, background:'rgba(2,6,23,0.8)', display:'grid', placeItems:'center', zIndex:40 }}>
          <div style={{ width:'98vw', height:'98vh', maxWidth:'98vw', maxHeight:'98vh', borderRadius:20, background:'#0b0c10', border:'1px solid rgba(255,255,255,0.08)', boxShadow:'0 28px 120px rgba(0,0,0,0.6)', overflow:'hidden', padding:16 }}>
            <div style={{ position:'absolute', top:16, right:16, zIndex:10 }}>
              <button onClick={()=>setShowPathFinding(false)} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)', fontSize:14 }}>Close</button>
            </div>
            <div style={{ background:'#fff', color:'#0b122a', borderRadius:16, overflow:'hidden' }}>
              <PathFindingDemo width={1100} height={demoHeight} />
            </div>
          </div>
        </div>
      )}
      {showPeopleNetwork && (
        <div style={{ position:'absolute', inset:0, background:'rgba(2,6,23,0.8)', display:'grid', placeItems:'center', zIndex:40 }}>
          <div style={{ width:'98vw', height:'96vh', maxWidth:'98vw', maxHeight:'96vh', borderRadius:20, background:'#0b0c10', border:'1px solid rgba(255,255,255,0.08)', boxShadow:'0 28px 120px rgba(0,0,0,0.6)', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:16, right:16, zIndex:10 }}>
              <button onClick={()=>setShowPeopleNetwork(false)} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)', fontSize:14 }}>Close</button>
            </div>
            <div style={{ position:'absolute', inset:0 }}>
              <PeopleNetwork />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


