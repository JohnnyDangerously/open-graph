import React, { useRef, useState, useEffect, useMemo } from "react";
import CanvasScene from "./graph/CanvasScene";
import CosmoScene from "./graph/CosmoScene";
import CommandBar from "./ui/CommandBar";
import HUD from "./ui/HUD";
import Settings from "./ui/Settings";
import Sidebar from "./ui/Sidebar";
import { setApiConfig, fetchBridgesTileJSON } from "./lib/api";
import { resolveSmart, loadTileSmart } from "./smart";
// demo modules removed
import type { ParsedTile } from "./graph/parse";
import { parseJsonTile } from "./graph/parse";
import type { GraphSceneHandle } from "./graph/types";
import type { EvaluationResult, HistoryEntry as CommandHistoryEntry, Token as CruxToken, OperatorToken as CruxOperatorToken } from "./crux/types";

type SceneRef = GraphSceneHandle;

export default function App(){
  const [focus, setFocus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sceneRef = useRef<SceneRef | null>(null);
  const latestTileRef = useRef<ParsedTile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fps, setFps] = useState(60);
  const [nodeCount, setNodeCount] = useState(0);
  const [labels, setLabels] = useState<string[]>([]);
  const [metaNodes, setMetaNodes] = useState<Array<{ id?: string|number, title?: string|null }>>([]);
  const [jobFilter, setJobFilter] = useState<string | null>(null)
  const [avatars, setAvatars] = useState<string[]>([]);
  const [history, setHistory] = useState<Array<{ id: string, move?: { x:number, y:number }, turn?: number, at?: number }>>([]);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([]);
  const [cursor, setCursor] = useState(-1);
  // filters removed
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [apiBase, setApiBase] = useState<string>(()=>{
    try { return localStorage.getItem('API_BASE') || "http://34.192.99.41" } catch { return "http://34.192.99.41" }
  });
  const [bearer, setBearer] = useState<string>(()=>{
    try { return localStorage.getItem('API_BEARER') || "" } catch { return "" }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [concentric, setConcentric] = useState(false);
  // demo state removed
  const [spawnDir, setSpawnDir] = useState(0) // 0:N,1:E,2:S,3:W
  const [selectedRegion, setSelectedRegion] = useState<null | 'left' | 'right' | 'overlap'>(null)
  const [sidebarIndices, setSidebarIndices] = useState<number[] | null>(null)
  const [compareGroups, setCompareGroups] = useState<null | { left:number[], right:number[], overlap:number[] }>(null)
  const lastCompareIdsRef = useRef<{ a:string, b:string } | null>(null)
  const [rendererMode, setRendererMode] = useState<'canvas' | 'cosmograph'>('canvas')

  const handleSceneRef = (instance: SceneRef | null) => {
    sceneRef.current = instance
  }

  useEffect(() => {
    if (sceneRef.current && latestTileRef.current) {
      try {
        sceneRef.current.setForeground(latestTileRef.current, { noTrailSnapshot: true })
      } catch (e) {
        console.warn('Failed to reapply tile on renderer swap', e)
      }
    }
  }, [rendererMode])

  const visibleMask = useMemo(() => {
    if (!metaNodes || jobFilter === null || jobFilter.trim() === '') return null
    const q = jobFilter.toLowerCase()
    return metaNodes.map((m, idx) => {
      if (idx === 0) return true
      const title = (m?.title || '').toLowerCase()
      return title.includes(q)
    })
  }, [metaNodes, jobFilter])

  // demo resize removed

  // demo triples removed

  async function run(cmd: string, opts?: { pushHistory?: boolean, overrideMove?: { x:number, y:number }, turnRadians?: number }){
    const pushHistory = opts?.pushHistory !== false;
    const s = cmd.trim();
    if (!s) return;
    if (s.toLowerCase() === "clear") { sceneRef.current?.clear(); setFocus(null); return; }
    if (/^(demo\s*venn|venn30|compare\s*demo)$/i.test(s)) {
      const demo = buildVennDemoTile30()
      setFocus('demo:venn30')
      try { setLabels((demo as any).labels || []) } catch {}
      try { const av = new Array(demo.count).fill('').map((_, i)=>{ const seed = encodeURIComponent((demo as any).labels?.[i] || String(i)); return `https://api.dicebear.com/7.x/thumbs/svg?seed=${seed}` }); setAvatars(av) } catch {}
      sceneRef.current?.setForeground(demo as any)
      try { (sceneRef.current as any)?.focusIndex?.(0, { animate:true, ms:420, zoom: 2.0 }) } catch {}
      return
    }
    // Bridges mode: "bridges <companyA> + <companyB>"
    if (/^bridges\b/i.test(s)) {
      const raw = s.replace(/^bridges\s*/i, '')
      const parts = raw.split('+').map(t => t.trim()).filter(Boolean)
      if (parts.length !== 2) { setErr('Bridges expects two companies, e.g. "bridges Acme + Globex"'); return }
      const [aIn, bIn] = parts
      const [aId, bId] = await Promise.all([resolveSmart(aIn), resolveSmart(bIn)])
      if (!aId || !bId || !aId.startsWith('company:') || !bId.startsWith('company:')) { setErr('Both sides must resolve to company:<id>. Try exact names or a domain.'); return }
      try {
        setErr(null)
        setFocus(`${aId} bridges ${bId}`)
        const j = await fetchBridgesTileJSON(aId, bId, 180)
        // Decorate labels for bridges: append score/degree if provided
        const decorateLabels = (labelsIn: string[], payload: any): string[] => {
          try {
            const meta = Array.isArray(payload?.meta?.nodes) ? payload.meta.nodes : []
            const groups = Array.isArray(payload?.coords?.groups) ? payload.coords.groups : []
            if (!Array.isArray(labelsIn)) return []
            return labelsIn.map((lab, i) => {
              const g = typeof groups[i] === 'number' ? groups[i] : (typeof meta?.[i]?.group === 'number' ? meta[i].group : undefined)
              if (g === 1) {
                const sc = meta?.[i]?.score
                const deg = meta?.[i]?.degree
                const scorePart = (typeof sc === 'number') ? ` • score ${Number(sc).toFixed(2)}` : ''
                const degPart = (typeof deg === 'number') ? ` • deg ${deg}` : ''
                return `${lab || ''}${scorePart}${degPart}`.trim()
              }
              return lab
            })
          } catch { return labelsIn }
        }
        const tile = parseJsonTile(j as any)
        try {
          const labelsIn = (j as any).labels as string[] | undefined
          if (labelsIn) setLabels(decorateLabels(labelsIn, j))
        } catch {}
        try {
          const meta = (j as any)?.meta?.nodes as any[] | undefined
          const labelsLocal = (j as any).labels as string[] | undefined
          const av = new Array(tile.count).fill('').map((_, i)=>{
            const m = meta?.[i]
            const li = (m && typeof m.linkedin === 'string') ? m.linkedin as string : undefined
            if (li) {
              const url = /^https?:\/\//i.test(li) ? li : `https://www.linkedin.com/in/${String(li).replace(/^\/*in\//,'')}`
              return `https://unavatar.io/${encodeURIComponent(url)}?fallback=false`
            }
            const lab = labelsLocal?.[i] || `#${i}`
            const seed = encodeURIComponent(lab)
            return `https://api.dicebear.com/7.x/thumbs/svg?seed=${seed}`
          })
          setAvatars(av)
        } catch {}
        latestTileRef.current = tile as ParsedTile
        sceneRef.current?.setForeground(tile as any)
        return
      } catch (e:any) {
        setErr(e?.message || 'bridges failed')
        return
      }
    }
    // Compare mode: "<a> + <b>" or "compare <a> + <b>"
    if (/\+/.test(s)) {
      await runCompare(s);
      return;
    }
    if (/^suggest\s+best\s+compare$/i.test(s)){
      try {
        const best = await suggestBestPair()
        if (best) { await run(`compare ${best.a} + ${best.b}`); return }
        setErr('No suitable pair found in a quick scan.')
      } catch (e:any) { setErr(e?.message || 'suggest failed') }
      return
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
        const metaNodes: Array<{ avatar_url?: string, avatarUrl?: string, name?: string, full_name?: string, id?: string|number, linkedin?: string }> | undefined = (tile as any).meta?.nodes
        if (Array.isArray(metaNodes)) setMetaNodes(metaNodes as any)
        const av = new Array(tile.count).fill('').map((_, i)=>{
          const m = metaNodes?.[i]
          const url = (m?.avatar_url || m?.avatarUrl) as string | undefined
          if (url && typeof url === 'string') return url
          const li = (m?.linkedin && typeof m.linkedin === 'string') ? m.linkedin : undefined
          if (li) {
            const full = /^https?:\/\//i.test(li) ? li : `https://www.linkedin.com/in/${String(li).replace(/^\/*in\//,'')}`
            return `https://unavatar.io/${encodeURIComponent(full)}?fallback=false`
          }
          const label = (m?.full_name || m?.name || (tile as any).labels?.[i]) as string | undefined
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
        latestTileRef.current = tile as ParsedTile
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

  async function suggestBestPair(): Promise<{ a:string, b:string } | null> {
    // Quick heuristic: try last few history items and a few hard-coded seeds
    const seeds = new Set<string>()
    for (let i=Math.max(0, history.length-6); i<history.length; i++) seeds.add(history[i].id)
    // If nothing in history, try some labels from current sidebar
    for (let i=0;i<Math.min(labels.length, 20);i++){ const name = labels[i]; if (name) seeds.add(`person:${name}`) }
    const arr = Array.from(seeds).slice(0, 6)
    if (arr.length < 2) return null
    let best: any = null
    for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++){
      try {
        const [A, B] = await Promise.all([resolveSmart(arr[i]), resolveSmart(arr[j])])
        if (!A || !B) continue
        if (A === B) continue
        const [{ tile: aTile }, { tile: bTile }] = await Promise.all([loadTileSmart(A), loadTileSmart(B)])
        const da = degreesFor(aTile as any, { workOnly:true, minYears:24 })
        const db = degreesFor(bTile as any, { workOnly:true, minYears:24 })
        const m1 = intersectCount(da.firstIds, db.firstIds)
        const m2 = intersectCount(da.secondIds, db.secondIds)
        const cAB = intersectCount(da.firstIds, db.secondIds)
        const cBA = intersectCount(db.firstIds, da.secondIds)
        const aOnly = diffCount(new Set([...da.firstIds, ...da.secondIds]), new Set([...db.firstIds, ...db.secondIds]))
        const bOnly = diffCount(new Set([...db.firstIds, ...db.secondIds]), new Set([...da.firstIds, ...da.secondIds]))
        const score = m1*3 + m2*2 + Math.min(cAB, cBA) - Math.abs(aOnly - bOnly)*0.5
        if (!best || score > best.score) best = { a:A, b:B, score }
      } catch {}
    }
    return best ? { a: best.a, b: best.b } : null
  }

  function intersectCount(a:Set<string>, b:Set<string>){ let k=0; for (const x of a) if (b.has(x)) k++; return k }
  function diffCount(a:Set<string>, b:Set<string>){ let k=0; for (const x of a) if (!b.has(x)) k++; return k }

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

  function degreesFor(tile: ParsedTile, opts?: { workOnly?: boolean, minYears?: number }){
    const count = tile.count|0
    const edges = tile.edges || new Uint16Array(0)
    const weights: (Float32Array | Uint8Array | undefined) = (tile as any).edgeWeights

    const neighbors: number[][] = Array.from({ length: count }, () => [])
    const mAll = edges.length >>> 1
    const minYears = Math.max(0, Math.floor(opts?.minYears ?? 0))

    for (let i=0;i<mAll;i++){
      const a = edges[i*2]|0, b = edges[i*2+1]|0
      if (a>=count || b>=count) continue
      let keep = true
      if (opts?.workOnly){
        // STRICT: require explicit edgeWeights and meet threshold; otherwise drop
        keep = false
        if (weights && (weights as any).length === mAll){
          const w = Number((weights as any)[i])
          if (Number.isFinite(w) && w >= minYears) keep = true
        }
      }
      if (keep){ neighbors[a].push(b); neighbors[b].push(a) }
    }
    const first: number[] = Array.from(new Set(neighbors[0]||[])).filter(i=>i>0)
    const seen = new Set<number>([0, ...first])
    const second: number[] = []
    for (const f of first){ for (const n of neighbors[f]||[]){ if (!seen.has(n)){ seen.add(n); if (n>0) second.push(n) } } }
    const firstIds = new Set<string>(first.map(i=>nodeIdFor(tile as any, i)))
    const secondIds = new Set<string>(second.map(i=>nodeIdFor(tile as any, i)))
    return { first, second, firstIds, secondIds }
  }

  // Dual-threshold degrees: first-degree via >= minFirst months edges from center;
  // second-degree via neighbors-of-first where the second hop uses >= minSecond months.
  function degreesForDual(tile: ParsedTile, minFirstMonths: number, minSecondMonths: number){
    const count = tile.count|0
    const edges = tile.edges || new Uint16Array(0)
    const weights: (Float32Array | Uint8Array | undefined) = (tile as any).edgeWeights
    const mAll = edges.length >>> 1
    const neighbors24: number[][] = Array.from({ length: count }, () => [])
    const neighbors36: number[][] = Array.from({ length: count }, () => [])
    for (let i=0;i<mAll;i++){
      const a = edges[i*2]|0, b = edges[i*2+1]|0
      if (a>=count || b>=count) continue
      let w = 0
      if (weights && (weights as any).length === mAll){
        w = Number((weights as any)[i])
      }
      if (w >= minFirstMonths){ neighbors24[a].push(b); neighbors24[b].push(a) }
      if (w >= minSecondMonths){ neighbors36[a].push(b); neighbors36[b].push(a) }
    }
    const first = Array.from(new Set(neighbors24[0]||[])).filter(i=>i>0)
    const firstIds = new Set<string>(first.map(i=>nodeIdFor(tile as any, i)))
    const second: number[] = []
    const seen = new Set<number>([0, ...first])
    for (const f of first){
      const nbrs = neighbors36[f] || []
      for (const n of nbrs){ if (!seen.has(n)){ seen.add(n); if (n>0) second.push(n) } }
    }
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
    // Compute degrees with dual thresholds: 24m for first-degree, 36m for second-degree hops
    const degA = degreesForDual(a, 24, 36)
    const degB = degreesForDual(b, 24, 36)
    const mapA = buildIdLabelMap(a as any)
    const mapB = buildIdLabelMap(b as any)
    // Overlap categories
    const mutualF1 = Array.from(degA.firstIds).filter(id=>degB.firstIds.has(id))
    const mutualF2 = Array.from(degA.secondIds).filter(id=>degB.secondIds.has(id))
    const aF1_bF2 = Array.from(degA.firstIds).filter(id=>degB.secondIds.has(id) && !degB.firstIds.has(id))
    const bF1_aF2 = Array.from(degB.firstIds).filter(id=>degA.secondIds.has(id) && !degA.firstIds.has(id))
    const aOnly = Array.from(new Set<string>([...degA.firstIds, ...degA.secondIds])).filter(id=>!degB.firstIds.has(id) && !degB.secondIds.has(id))
    const bOnly = Array.from(new Set<string>([...degB.firstIds, ...degB.secondIds])).filter(id=>!degA.firstIds.has(id) && !degA.secondIds.has(id))

    // Sanity diagnostics: if strict work-only graph is empty, surface a clear message instead of drawing nothing
    const totalCats = degA.first.length + degA.second.length + degB.first.length + degB.second.length
    if (totalCats === 0) {
      try { setErr('No work-overlap edges (>=24 months) found for either ego. Please choose another pair or relax the threshold.'); } catch {}
    } else {
      try {
        console.log('Compare(work-only):', {
          A: { first: degA.first.length, second: degA.second.length },
          B: { first: degB.first.length, second: degB.second.length },
          mutual: { first: mutualF1.length, second: mutualF2.length },
          cross: { A1_B2: aF1_bF2.length, B1_A2: bF1_aF2.length }
        })
      } catch {}
    }

    // Map id -> source tile and original index to get labels
    const labelFor = (id:string)=> mapA.get(id) || mapB.get(id) || id

    // Deterministic helpers
    const hashStr01 = (s:string): number => {
      let h = 2166136261 >>> 0
      for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
      return (h % 100000) / 100000
    }
    const clamp = (x:number, a:number, b:number)=> Math.max(a, Math.min(b, x))
    const inSemiRing = (x:number,y:number,cx:number,cy:number,rIn:number,rOut:number)=>{
      const dx=x-cx, dy=y-cy; const d=Math.hypot(dx,dy)
      return (y <= cy + 1) && (d >= rIn) && (d <= rOut)
    }
    const projectIntoSemiRing = (x:number,y:number,cx:number,cy:number,rIn:number,rOut:number)=>{
      // Force into upper half
      const yy = Math.min(y, cy)
      const dx = x - cx, dy = yy - cy
      const d = Math.max(1e-6, Math.hypot(dx,dy))
      let r = clamp(d, Math.max(0,rIn), Math.max(rIn+1,rOut))
      const ux = dx / d, uy = dy / d
      return { x: cx + ux * r, y: cy + uy * r }
    }
    const placeDeterministic = (
      ids: string[], cx:number, cy:number, rMin:number, rMax:number,
      pred: (x:number,y:number)=> boolean,
      opts2:{ baseSize:number, bgSize:number, region:'left'|'right'|'overlap', ring:'first'|'second'|'cross', highlight?:boolean }
    )=>{
      const indices: number[] = []
      const highlightRegion = opts?.highlight || null
      const emphasize = (highlightRegion && highlightRegion === opts2.region)
      const ratio = emphasize ? 1.0 : (opts2.ring === 'first' || opts2.ring === 'cross' ? 0.22 : 0.16)
      const maxStrong = Math.ceil(ids.length * ratio)
      const strongEvery = Math.max(1, Math.floor(ids.length / Math.max(1, maxStrong)))
      for (let i=0;i<ids.length;i++){
        const id = ids[i]
        // deterministic angle in [0, PI]
        const t = hashStr01(id)
        const ang = Math.PI * t
        // deterministic radius within [rMin, rMax]
        const rj = rMin + (rMax - rMin) * hashStr01(id + ':r')
        let x = cx + Math.cos(ang) * rj
        let y = cy - Math.sin(ang) * rj
        if (!pred(x,y)){
          // try small deterministic jitter and then project
          const jx = (hashStr01(id + ':jx') - 0.5) * Math.min(18, (rMax - rMin) * 0.1)
          const jy = (hashStr01(id + ':jy') - 0.5) * Math.min(18, (rMax - rMin) * 0.1)
          let xx = x + jx, yy = y + jy
          if (!pred(xx,yy)){
            const p = projectIntoSemiRing(xx, yy, cx, cy, rMin, rMax)
            xx = p.x; yy = p.y
          }
          x = xx; y = yy
        }
        nodes.push(x, y)
        const isStrong = (i % strongEvery === 0) || emphasize
        size.push(isStrong ? opts2.baseSize : opts2.bgSize)
        alpha.push(isStrong ? 0.85 : 0.18)
        labels.push(labelFor(id))
        indices.push((nodes.length/2)-1)
      }
      return indices
    }

    // Even downsampling helper so we show ~1/2 of nodes per group
    const sampleEven = <T,>(arr: T[], fraction = 0.5): T[] => {
      const n = arr.length|0; if (n === 0) return arr
      const target = Math.max(1, Math.floor(n * fraction))
      if (target >= n) return arr
      const step = n / target
      const out: T[] = []
      for (let k=0;k<target;k++){
        const idx = Math.min(n-1, Math.floor(k * step))
        out.push(arr[idx])
      }
      return out
    }

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
    const seenIds = new Set<string>()

    // Center nodes for A and B (reserve their ids so no duplicates appear as orange dots)
    const centerAId = nodeIdFor(a as any, 0)
    const centerBId = nodeIdFor(b as any, 0)
    seenIds.add(centerAId); seenIds.add(centerBId)
    nodes.push(leftCX, baseCY); size.push(14); alpha.push(1.0); labels.push(labelFor(centerAId))
    nodes.push(rightCX, baseCY); size.push(14); alpha.push(1.0); labels.push(labelFor(centerBId))

    // Ring placements (deterministic & bounded). Dedupe by id before placing.
    function addGroupDet(idsIn:string[], cx:number, cy:number, rMin:number, rMax:number, opts2:{ baseSize:number, bgSize:number, region:'left'|'right'|'overlap', ring:'first'|'second'|'cross', pred?:(x:number,y:number)=>boolean }){
      const pred = opts2.pred || (()=>true)
      const ids = idsIn.filter(id=>{ if (seenIds.has(id)) return false; seenIds.add(id); return true })
      const placed = placeDeterministic(ids, cx, cy, Math.max(0,rMin), Math.max(rMin+1,rMax), pred, opts2)
      for (const idx of placed) indexGroups[opts2.region].push(idx)
    }

    // Geometry helpers for region predicates
    const insideHalfAnnulus = (x:number,y:number, cx:number, cy:number, rIn:number, rOut:number)=> inSemiRing(x,y,cx,cy,rIn,rOut)
    const dTo = (x:number,y:number,cx:number,cy:number)=> Math.hypot(x-cx,y-cy)
    const inLeftFirst = (x:number,y:number)=> dTo(x,y,leftCX,baseCY) <= r1 && y <= baseCY
    const inRightFirst = (x:number,y:number)=> dTo(x,y,rightCX,baseCY) <= r1 && y <= baseCY
    const inLeftSecond = (x:number,y:number)=> dTo(x,y,leftCX,baseCY) > r1 && dTo(x,y,leftCX,baseCY) <= r2 && y <= baseCY
    const inRightSecond = (x:number,y:number)=> dTo(x,y,rightCX,baseCY) > r1 && dTo(x,y,rightCX,baseCY) <= r2 && y <= baseCY

    // First-degree unique and mutual — keep a clear gap around centers so no dot sits on a center
    const firstInnerGap = Math.max(28, Math.floor(r1 * 0.18))
    addGroupDet(sampleEven(Array.from(degA.firstIds).filter(id=>!mutualF1.includes(id) && !aF1_bF2.includes(id))), leftCX, baseCY, firstInnerGap, r1, { baseSize:4.6, bgSize:0.8, region:'left', ring:'first', pred:(x,y)=> inLeftFirst(x,y) && !(inRightFirst(x,y) || inRightSecond(x,y)) })
    addGroupDet(sampleEven(Array.from(degB.firstIds).filter(id=>!mutualF1.includes(id) && !bF1_aF2.includes(id))), rightCX, baseCY, firstInnerGap, r1, { baseSize:4.6, bgSize:0.8, region:'right', ring:'first', pred:(x,y)=> inRightFirst(x,y) && !(inLeftFirst(x,y) || inLeftSecond(x,y)) })
    addGroupDet(sampleEven(mutualF1), midCX, baseCY, firstInnerGap, r1, { baseSize:5.0, bgSize:0.9, region:'overlap', ring:'first', pred:(x,y)=> inLeftFirst(x,y) && inRightFirst(x,y) })
    // Cross ring (first of A that are second of B) and vice versa → place near mid but biased
    addGroupDet(sampleEven(aF1_bF2), (leftCX+midCX)/2, baseCY, firstInnerGap, r1, { baseSize:4.4, bgSize:0.8, region:'overlap', ring:'cross', pred:(x,y)=> inLeftFirst(x,y) && inRightSecond(x,y) && !inRightFirst(x,y) })
    addGroupDet(sampleEven(bF1_aF2), (rightCX+midCX)/2, baseCY, firstInnerGap, r1, { baseSize:4.4, bgSize:0.8, region:'overlap', ring:'cross', pred:(x,y)=> inRightFirst(x,y) && inLeftSecond(x,y) && !inLeftFirst(x,y) })

    // Second-degree
    addGroupDet(sampleEven(Array.from(degA.secondIds).filter(id=>!mutualF2.includes(id))), leftCX, baseCY, r1, r2, { baseSize:3.4, bgSize:0.7, region:'left', ring:'second', pred:(x,y)=> inLeftSecond(x,y) && !(inRightFirst(x,y) || inRightSecond(x,y)) })
    addGroupDet(sampleEven(Array.from(degB.secondIds).filter(id=>!mutualF2.includes(id))), rightCX, baseCY, r1, r2, { baseSize:3.4, bgSize:0.7, region:'right', ring:'second', pred:(x,y)=> inRightSecond(x,y) && !(inLeftFirst(x,y) || inLeftSecond(x,y)) })
    addGroupDet(sampleEven(mutualF2), midCX, baseCY, r1, r2, { baseSize:3.6, bgSize:0.8, region:'overlap', ring:'second', pred:(x,y)=> inLeftSecond(x,y) && inRightSecond(x,y) && !(inLeftFirst(x,y) && inRightFirst(x,y)) })

    // Non-overlapping pools (optional, already covered above as A-only/B-only across rings)
    // Use small jitter around outer radius
    addGroupDet(sampleEven(aOnly), leftCX-40, baseCY, r2+10, r2+80, { baseSize:3.8, bgSize:1.6, region:'left', ring:'second' as any })
    addGroupDet(sampleEven(bOnly), rightCX+40, baseCY, r2+10, r2+80, { baseSize:3.8, bgSize:1.6, region:'right', ring:'second' as any })

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

  // Tiny in-app demo: 30 nodes distributed across regions with strong overlap
  function buildVennDemoTile30(): ParsedTile {
    const leftCX = -160, rightCX = 160, baseCY = 260
    const r1 = 200, r2 = 360
    const label = (i:number)=> `#${i}`
    const nodes: number[] = []
    const size: number[] = []
    const alpha: number[] = []
    const labelsArr: string[] = []

    // Centers (A,B)
    nodes.push(leftCX, baseCY); size.push(14); alpha.push(1.0); labelsArr.push('A')
    nodes.push(rightCX, baseCY); size.push(14); alpha.push(1.0); labelsArr.push('B')

    const dTo = (x:number,y:number,cx:number,cy:number)=> Math.hypot(x-cx,y-cy)
    const inL1 = (x:number,y:number)=> dTo(x,y,leftCX,baseCY) <= r1 && y <= baseCY
    const inR1 = (x:number,y:number)=> dTo(x,y,rightCX,baseCY) <= r1 && y <= baseCY
    const inL2 = (x:number,y:number)=> dTo(x,y,leftCX,baseCY) > r1 && dTo(x,y,leftCX,baseCY) <= r2 && y <= baseCY
    const inR2 = (x:number,y:number)=> dTo(x,y,rightCX,baseCY) > r1 && dTo(x,y,rightCX,baseCY) <= r2 && y <= baseCY

    const pushPts = (n:number, pred:(x:number,y:number)=>boolean, sStrong=5.0, sWeak=2.0)=>{
      const total = n
      const pts: Array<{x:number,y:number}> = []
      const areaSampler = ()=>{ const t=Math.random(); const r=Math.sqrt(t)*(r2-6); const a=Math.random()*Math.PI; const x = (Math.random()<0.5?leftCX:rightCX) + (r*Math.cos(a))*0.9; const y = baseCY - Math.abs(r*Math.sin(a)); return { x, y } }
      const min2 = 100
      while (pts.length<total){
        const p0 = areaSampler(); const x = Math.max(Math.min(p0.x, rightCX+r2), leftCX-r2); const y=p0.y
        if (!pred(x,y)) continue
        let ok=true; for (const q of pts){ const dx=x-q.x, dy=y-q.y; if (dx*dx+dy*dy<min2){ ok=false; break } }
        if (ok) pts.push({x,y})
      }
      for (let i=0;i<pts.length;i++){
        const p = pts[i]; nodes.push(p.x, p.y); const st = (i%3===0)?sStrong:sWeak; size.push(st); alpha.push(0.92); labelsArr.push(label(nodes.length/2))
      }
    }

    // Allocate ~28 nodes across regions
    pushPts(6, (x,y)=> inL1(x,y) && !(inR1(x,y)||inR2(x,y)))         // left-only 1st
    pushPts(6, (x,y)=> inR1(x,y) && !(inL1(x,y)||inL2(x,y)))         // right-only 1st
    pushPts(5, (x,y)=> inL1(x,y) && inR1(x,y))                       // mutual 1st
    pushPts(4, (x,y)=> inL1(x,y) && inR2(x,y) && !inR1(x,y))         // A1 ∩ B2
    pushPts(4, (x,y)=> inR1(x,y) && inL2(x,y) && !inL1(x,y))         // B1 ∩ A2
    pushPts(3, (x,y)=> inL2(x,y) && inR2(x,y) && !(inL1(x,y)&&inR1(x,y))) // mutual 2nd

    const out: ParsedTile = {
      count: nodes.length/2,
      nodes: new Float32Array(nodes),
      size: new Float32Array(size),
      alpha: new Float32Array(alpha),
      group: new Uint16Array(nodes.length/2),
    } as any
    ;(out as any).labels = labelsArr
    ;(out as any).compareOverlay = { regions:{ left:{ cx:leftCX, cy:baseCY, r1, r2 }, right:{ cx:rightCX, cy:baseCY, r1, r2 }, overlap:{ cx:0, cy:baseCY, r1, r2 } }, colors:{ leftFirst:'rgba(122,110,228,0.30)', leftSecond:'rgba(122,110,228,0.18)', rightFirst:'rgba(122,110,228,0.30)', rightSecond:'rgba(122,110,228,0.18)', overlapFirst:'rgba(255,195,130,0.30)', overlapSecond:'rgba(255,195,130,0.18)' } }
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
      if (aId === bId) { setErr('Please choose two different people to compare.'); return }
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
      try { (sceneRef.current as any)?.focusIndex?.(0, { animate:true, ms:480, zoom: 1.9 }) } catch {}
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
      if (e.key === 'ArrowDown' && typeof selectedIndex === 'number') setSelectedIndex((prev)=>{
        const cur = (typeof prev === 'number' ? prev : 0)
        return (cur + 1) % metaNodes.length
      })
      if (e.key === 'ArrowUp' && typeof selectedIndex === 'number') setSelectedIndex((prev)=>{
        const cur = (typeof prev === 'number' ? prev : 0)
        return (cur - 1 + metaNodes.length) % metaNodes.length
      })
      if (e.key === 'ArrowRight' && typeof selectedIndex === 'number') {
        setSelectedIndex((prev)=>{
          const next = ((typeof prev === 'number' ? prev : 0) + 1) % metaNodes.length
          ;(sceneRef.current as any)?.focusIndex?.(next, { zoom: 0.9 })
          return next
        })
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
        // Prefer promoting trail first; if none, use history
        const promoted = (sceneRef.current as any)?.promoteTrailPrevious?.() || false
        if (!promoted && cursor > 0 && history[cursor]) {
          const cur = history[cursor]
          const prev = history[cursor-1]
          setCursor(cursor-1)
          // reverse camera motion: use negative of the move we took to reach current
          if (cur?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: -(cur.turn||0) } }))
          run(prev.id, { pushHistory: false, overrideMove: { x: -(cur?.move?.x||0), y: -(cur?.move?.y||0) } })
        }
        return
      }
      // Delete key: promote previously dimmed graph to foreground (no duplication)
      if ((e.key === 'Delete' || e.key === 'Del') && !isTyping) {
        e.preventDefault()
        try { (sceneRef.current as any)?.promoteTrailPrevious?.() } catch {}
        return
      }
      if (e.metaKey && (e.key === '[' || e.key === 'BracketLeft')) {
        e.preventDefault()
        const promoted = (sceneRef.current as any)?.promoteTrailPrevious?.() || false
        if (!promoted && cursor > 0 && history[cursor]) { const cur = history[cursor]; const prev = history[cursor-1]; setCursor(cursor-1); if (cur?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: -(cur.turn||0) } })); run(prev.id, { pushHistory:false, overrideMove: { x: -(cur?.move?.x||0), y: -(cur?.move?.y||0) } }) }
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
      {rendererMode === 'canvas' ? (
        <CanvasScene
          ref={handleSceneRef}
          concentric={concentric}
          selectedIndex={selectedIndex}
          visibleMask={visibleMask}
          onPick={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate:true, ms:520, zoomMultiplier: 6 }); }}
          onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }}
          onStats={(fps,count)=>{ setFps(fps); setNodeCount(count) }}
          onRegionClick={onRegionClick}
        />
      ) : (
        <CosmoScene
          ref={handleSceneRef}
          concentric={concentric}
          selectedIndex={selectedIndex}
          visibleMask={visibleMask}
          onPick={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate:true, ms:520, zoomMultiplier: 6 }); }}
          onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }}
          onStats={(fps,count)=>{ setFps(fps); setNodeCount(count) }}
          onRegionClick={onRegionClick}
        />
      )}
      <div style={{ position:'absolute', top:16, right:24, zIndex:30, display:'flex', gap:8 }}>
        <button
          onClick={()=> setRendererMode(mode => mode === 'canvas' ? 'cosmograph' : 'canvas')}
          style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(255,255,255,0.24)', background:'rgba(255,255,255,0.08)', color:'#fff', fontSize:13 }}
        >
          Renderer: {rendererMode === 'canvas' ? 'Canvas' : 'Cosmograph'} (switch)
        </button>
      </div>
      <Sidebar 
        open={sidebarOpen} 
        onToggle={()=>setSidebarOpen(!sidebarOpen)} 
        items={(sidebarIndices ? sidebarIndices : Array.from({length: Math.max(0,nodeCount)},(_,i)=>i)).map((i)=>({ index:i, group:(i%8), name: labels[i], title: (metaNodes[i] as any)?.title || null, avatarUrl: avatars[i] }))}
        selectedIndex={selectedIndex}
        onSelect={(i)=>{ setSelectedIndex(i); }} 
        onDoubleSelect={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate: true, ms: 520, zoomMultiplier: 8 }); setSidebarOpen(false); }} 
      />
      {/* Job title filter */}
      <div style={{ position:'absolute', top:56, right:360, zIndex:20, display:'flex', gap:8, alignItems:'center' }}>
        <input placeholder="Filter by job title" value={jobFilter||''} onChange={(e)=> setJobFilter(e.currentTarget.value || null)}
          style={{ padding:'6px 8px', borderRadius:8, border:'1px solid rgba(255,255,255,0.2)', background:'rgba(255,255,255,0.06)', color:'#fff', width:220 }} />
        {jobFilter && <button onClick={()=> setJobFilter(null)} style={{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)' }}>Clear</button>}
      </div>
      <CommandBar
        onRun={run}
        focus={focus}
        selectedIndex={selectedIndex}
        nodes={nodeCount}
        fps={fps}
        onBack={()=>{ if(cursor>0 && history[cursor]){ const cur=history[cursor]; const prev=history[cursor-1]; setCursor(cursor-1); if (cur?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: -(cur.turn||0) } })); run(prev.id, { pushHistory:false, overrideMove:{ x: -(cur?.move?.x||0), y: -(cur?.move?.y||0) } }) } }}
        onForward={()=>{ if(cursor<history.length-1){ const next=history[cursor+1]; setCursor(cursor+1); if (next?.turn) window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians: next.turn||0 } })); run(next.id, { pushHistory:false, overrideMove:{ x: next?.move?.x||0, y: next?.move?.y||0 } }) } }}
        canBack={cursor>0}
        canForward={cursor<history.length-1}
        onReshape={(mode)=>{ (sceneRef.current as any)?.reshapeLayout?.(mode, { animate:true, ms:520 }) }}
        onSettings={()=>setShowSettings(true)}
      />
      {/* HUD is now replaced by inline controls within CommandBar */}
      {/* demo buttons removed */}
      {err && (
        <div style={{ position:'absolute', top:52, left:12, right:12, padding:'10px 12px', background:'rgba(200,40,60,0.2)', border:'1px solid rgba(255,80,100,0.35)', color:'#ffbfc9', borderRadius:10, zIndex:11 }}>
          {err}
        </div>
      )}
      {showSettings && (
        <Settings apiBase={apiBase} bearer={bearer} onSave={({apiBase,bearer})=>{ setApiBase(apiBase); setBearer(bearer); setApiConfig(apiBase,bearer); setShowSettings(false); }} onClose={()=>setShowSettings(false)} />
      )}
      {/* demo modals removed */}
    </div>
  );
}
