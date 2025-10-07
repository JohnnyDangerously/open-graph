import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { MIN_OVERLAP_MONTHS } from "./lib/constants";
import CanvasScene from "./graph/CanvasScene";
import CosmoScene from "./graph/CosmoScene";
import GpuScene from "./graph/GpuScene";
import CommandBar from "./ui/CommandBar";
import TabOverview from "./ui/TabOverview";
import { fetchPersonProfile, type PersonProfile } from "./lib/api";
// Legacy Sidebar retained for reference; replaced by SideDrawer
import SideDrawer from "./ui/SideDrawer";
import NodeList from "./ui/NodeList";
import TabPeople from "./ui/TabPeople";
import CompareLists from "./ui/CompareLists";
import TabCompanies from "./ui/TabCompanies";
import TabConnections from "./ui/TabConnections";
import { fetchBridgesTileJSON, fetchAvatarMap, fetchEdgeDecomposition, fetchMigrationPairs, type EdgeDecompositionData } from "./lib/api";
import { fetchIntroPaths, type IntroPathsResult, fetchNearbyExecsAtCompany, fetchNetworkByFilter } from "./lib/api";
import { resolveSmart, loadTileSmart } from "./smart";
// demo modules removed
import type { ParsedTile } from "./graph/parse";
import { parseJsonTile } from "./graph/parse";
import type { GraphSceneHandle } from "./graph/types";
import type {
  EvaluationResult,
  FilterToken as CruxFilterToken,
  OperatorToken as CruxOperatorToken,
  EntityToken as CruxEntityToken,
} from "./crux/types";

type SceneRef = GraphSceneHandle;

type RunOptions = {
  pushHistory?: boolean;
  overrideMove?: { x: number; y: number };
  turnRadians?: number;
};

type EdgeFacetSummary = {
  key: string
  label: string
  color: string
  count: number
}

type EdgeDecompositionEdge = {
  source: number
  target: number
  weight: number
  facets: string[]
}

type EdgeDecompositionNeighborView = EdgeDecompositionData["neighbors"][number] & {
  index: number
  facets: string[]
  // Optional fields for 1- vs 2-hop grouping when we build from an existing tile
  distance?: 1 | 2
  viaIndex?: number | null
}

type EdgeDecompositionView = {
  tile: ParsedTile
  center: EdgeDecompositionData["center"]
  neighbors: EdgeDecompositionNeighborView[]
  edges: EdgeDecompositionEdge[]
  labels: string[]
  metaNodes: Array<Record<string, unknown>>
  facets: EdgeFacetSummary[]
  palette: Record<string, string>
}

export default function App(){
  const [focus, setFocus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sceneRef = useRef<SceneRef | null>(null);
  const latestTileRef = useRef<ParsedTile | null>(null);
  const [showFeaturePanel, setShowFeaturePanel] = useState(true);
  const [nodeCount, setNodeCount] = useState(0);
  const [labels, setLabels] = useState<string[]>([]);
  const [metaNodes, setMetaNodes] = useState<Array<{ id?: string|number, title?: string|null }>>([]);
  const [jobFilter, setJobFilter] = useState<string | null>(null)
  const [avatars, setAvatars] = useState<string[]>([]);
  const [history, setHistory] = useState<Array<{ id: string, move?: { x:number, y:number }, turn?: number, at?: number }>>([]);
  const [cursor, setCursor] = useState(-1);
  // filters removed
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [concentric, setConcentric] = useState(false);
  // demo state removed
  const [spawnDir, setSpawnDir] = useState(0) // 0:N,1:E,2:S,3:W
  const [selectedRegion, setSelectedRegion] = useState<null | 'left' | 'right' | 'overlap'>(null)
  const [sidebarIndices, setSidebarIndices] = useState<number[] | null>(null)
  const [compareGroups, setCompareGroups] = useState<null | { left:number[], right:number[], overlap:number[] }>(null)
  const [compareLists, setCompareLists] = useState<null | { mutualF1:number[], aF1_bF2:number[], bF1_aF2:number[], aOnly:number[], bOnly:number[], mutualF1Raw?: string[], aF1_bF2Raw?: string[], bF1_aF2Raw?: string[] }>(null)
  const lastCompareIdsRef = useRef<{ a:string, b:string } | null>(null)
  const [rendererMode, setRendererMode] = useState<'canvas' | 'cosmograph' | 'gpu'>(()=>{
    try {
      const sp = new URLSearchParams(window.location.search)
      const q = sp.get('renderer') || localStorage.getItem('RENDERER_MODE') || 'canvas'
      if (q === 'gpu' || q === 'cosmograph' || q === 'canvas') return q as any
    } catch {}
    return 'canvas'
  })
  React.useEffect(()=>{ try { localStorage.setItem('RENDERER_MODE', rendererMode) } catch {} }, [rendererMode])
  const [maskMode, setMaskMode] = useState<'hide'|'dim'>('hide')
  const [companiesMask, setCompaniesMask] = useState<boolean[] | null>(null)
  const [connectionsMask, setConnectionsMask] = useState<boolean[] | null>(null)
  const [degreeHighlight, setDegreeHighlight] = useState<'all'|'first'|'second'>('all')
  const [profile, setProfile] = useState<PersonProfile | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [introPathsResult, setIntroPathsResult] = useState<IntroPathsResult | null>(null)
  const [introPathsTileMask, setIntroPathsTileMask] = useState<boolean[] | null>(null)
  const [peopleSearchMask, setPeopleSearchMask] = useState<boolean[] | null>(null)
  const [selectedPathIndex, setSelectedPathIndex] = useState<number | null>(null)
  const [nearbyExecs, setNearbyExecs] = useState<Array<{ person_id:string, title?:string|null, seniority?:string|null, months_overlap:number }>>([])
  const runIdRef = useRef(0)
  const [activeDrawerTab, setActiveDrawerTab] = useState<string>('nodes')
  const [edgeDecompView, setEdgeDecompView] = useState<EdgeDecompositionView | null>(null)
  const [edgeDecompFacet, setEdgeDecompFacet] = useState<string | null>(null)
  const [edgeDecompMask, setEdgeDecompMask] = useState<boolean[] | null>(null)
  const [edgeDecompLoading, setEdgeDecompLoading] = useState(false)
  // Focus Paths (≤2 hops)
  const [focusPathsView, setFocusPathsView] = useState<null | { tile: ParsedTile, srcIndex: number, dstIndex: number, midIndices: number[], direct: boolean }>(null)
  const [focusPathsLimit, setFocusPathsLimit] = useState<number>(10)

  const handleSceneRef = (instance: SceneRef | null) => {
    sceneRef.current = instance
  }

  const clearEdgeDecomposition = useCallback(() => {
    setEdgeDecompView(null)
    setEdgeDecompFacet(null)
    setEdgeDecompMask(null)
    setEdgeDecompLoading(false)
  }, [])

  // API base is now configured via env/query/localStorage automatically in lib/api.ts

  useEffect(() => {
    if (sceneRef.current && latestTileRef.current) {
      try {
        sceneRef.current.setForeground(latestTileRef.current, { noTrailSnapshot: true })
      } catch {}
    }
  }, [rendererMode])


  // Restore active tab and focus from URL hash (best-effort)
  useEffect(()=>{
    try {
      const raw = (window.location.hash||'').replace(/^#/,'')
      if (!raw) return
      const p = new URLSearchParams(raw)
      const tab = p.get('tab')
      const f = p.get('focus')
      if (tab) setActiveDrawerTab(tab)
      if (f) setFocus(f)
    } catch {}
  }, [])

  const visibleMask = useMemo(() => {
    // Priority: Edge Decomposition mask → Intro Paths → People Search → legacy filters
    if (edgeDecompMask && edgeDecompMask.length) return edgeDecompMask
    if (introPathsTileMask && introPathsTileMask.length) return introPathsTileMask
    if (peopleSearchMask && peopleSearchMask.length) return peopleSearchMask
    if (connectionsMask && connectionsMask.length) return connectionsMask
    if (companiesMask && companiesMask.length) return companiesMask
    if (!metaNodes || jobFilter === null || jobFilter.trim() === '') return null
    const q = jobFilter.toLowerCase()
    return metaNodes.map((m, idx) => {
      if (idx === 0) return true
      const title = (m?.title || '').toLowerCase()
      return title.includes(q)
    })
  }, [metaNodes, jobFilter, edgeDecompMask, introPathsTileMask, peopleSearchMask, connectionsMask, companiesMask])

  // demo resize removed

  // demo triples removed

  const ensureCompanyId = async (input: string): Promise<string> => {
    const trimmed = (input ?? '').trim()
    if (!trimmed) throw new Error('Company value required for bridges')
    if (/^company:\d+$/i.test(trimmed)) return `company:${trimmed.slice(trimmed.indexOf(':') + 1)}`
    if (/^\d+$/.test(trimmed)) return `company:${trimmed}`
    throw new Error('Provide canonical company:<id> (numeric)')
  }

  const ensureEntityId = async (input: string): Promise<string> => {
    const trimmed = (input ?? '').trim()
    if (!trimmed) throw new Error('Entity value required')
    const m = /^(company|person):([0-9]+)$/i.exec(trimmed)
    if (m) return `${m[1].toLowerCase()}:${m[2]}`
    if (/^\d+$/.test(trimmed)) return `person:${trimmed}`
    throw new Error('Provide canonical person:<id> or company:<id> (numeric)')
  }

  // --- Intro Paths: tile builder and command ---
  const clearIntroPanels = () => {
    try {
      setIntroPathsResult(null)
      setSelectedPathIndex(null)
      setIntroPathsTileMask(null)
      setNearbyExecs([])
    } catch {}
  }
  function buildIntroPathsTile(result: IntroPathsResult){
    // Left–right, bridge-like layout: S anchor on left, company anchor on right, Ms and Ts between
    const ms = result.Ms.map(m=>m.id).slice(0, Math.min(80, result.Ms.length))
    const ts = result.Ts.map(t=>t.id).slice(0, Math.min(240, result.Ts.length))

    const count = 2 + ms.length + ts.length
    const nodes = new Float32Array(count * 2)
    const size = new Float32Array(count)
    const alpha = new Float32Array(count)
    const group = new Uint16Array(count)
    const labelsLocal: string[] = new Array(count)
    const metaLocal: Array<Record<string, unknown>> = new Array(count)

    // Anchors
    const leftX = -3600, rightX = 3600
    nodes[0] = leftX; nodes[1] = 0; size[0] = 14; alpha[0] = 1; group[0] = 0
    labelsLocal[0] = (result as any).sName || introPathsResult?.paths?.[0]?.names?.S || result.S
    metaLocal[0] = { id: result.S, name: labelsLocal[0], group: 0 }
    nodes[1] = rightX; nodes[3] = 0; size[1] = 14; alpha[1] = 1; group[1] = 2
    labelsLocal[1] = (result as any).companyName || `company:${result.companyId}`
    metaLocal[1] = { id: result.companyId, name: labelsLocal[1], group: 2 }

    // Name maps
    const mNames = new Map<string, string|undefined>()
    result.Ms.forEach(m=>{ if (!mNames.has(m.id)) mNames.set(m.id, (m as any).name) })
    const tNames = new Map<string, string|undefined>()
    result.Ts.forEach(t=>{ if (!tNames.has(t.id)) tNames.set(t.id, (t as any).name) })

    // Ms in a wider grid near the left half
    const startM = 2
    const mCols = Math.min(12, Math.max(6, Math.ceil(Math.sqrt(Math.max(1, ms.length)))))
    const mRows = Math.max(1, Math.ceil(ms.length / mCols))
    const mX0 = -1600, mColGap = 260, mRowGap = 180
    for (let idx=0; idx<ms.length; idx++){
      const col = idx % mCols
      const row = Math.floor(idx / mCols)
      const i = startM + idx
      const x = mX0 + col * mColGap
      const y = (row - (mRows-1)/2) * mRowGap
      nodes[i*2] = x; nodes[i*2+1] = y
      size[i] = 10; alpha[i] = 0.96; group[i] = 1
      const id = ms[idx]; const label = mNames.get(id) || id
      labelsLocal[i] = label as string
      metaLocal[i] = { id, name: label, group: 1 }
    }

    // Ts in a wide grid near the right half
    const startT = startM + ms.length
    const tCols = Math.min(18, Math.max(8, Math.ceil(Math.sqrt(Math.max(1, ts.length)) * 1.6)))
    const tRows = Math.max(1, Math.ceil(ts.length / tCols))
    const tX0 = 400, tColGap = 260, tRowGap = 120
    for (let idx=0; idx<ts.length; idx++){
      const col = idx % tCols
      const row = Math.floor(idx / tCols)
      const i = startT + idx
      const x = tX0 + col * tColGap
      const y = (row - (tRows-1)/2) * tRowGap
      nodes[i*2] = x; nodes[i*2+1] = y
      size[i] = 9; alpha[i] = 0.95; group[i] = 2
      const id = ts[idx]; const label = tNames.get(id) || id
      labelsLocal[i] = label as string
      metaLocal[i] = { id, name: label, group: 2 }
    }

    // Edges: only highlight Top-3 paths (S->M->T). Keep nodes for full slate.
    const edgesArr: Array<[number, number]> = []
    const weights: number[] = []
    const idToIndex = (id: string): number => {
      const mIdx = ms.indexOf(id); if (mIdx >= 0) return startM + mIdx
      const tIdx = ts.indexOf(id); if (tIdx >= 0) return startT + tIdx
      return -1
    }
    const top = Array.isArray((result as any).top3) ? (result as any).top3 as any[] : []
    for (const p of top){
      const mi = idToIndex(p.M)
      const ti = idToIndex(p.T)
      if (mi>=0){ edgesArr.push([0, mi]); weights.push(Math.max(2, Math.round((p?.scores?.R_SM||0)*10))) }
      if (mi>=0 && ti>=0){ edgesArr.push([mi, ti]); weights.push(Math.max(2, Math.round((p?.scores?.R_MT||0)*10))) }
    }

    const edges = new Uint16Array(edgesArr.length * 2)
    const edgeWeights = new Float32Array(weights.length)
    for (let i=0;i<edgesArr.length;i++){ edges[i*2] = edgesArr[i][0]; edges[i*2+1] = edgesArr[i][1]; edgeWeights[i] = weights[i] }

    const tile: ParsedTile & { labels?: string[], meta?: { nodes: Array<Record<string, unknown>> } } = {
      count,
      nodes,
      size,
      alpha,
      group,
      edges,
      edgeWeights,
    } as any
    ;(tile as any).labels = labelsLocal
    ;(tile as any).meta = { nodes: metaLocal }
    ;(tile as any).focusWorld = { x: 0, y: 0 }
    return { tile, ms, ts }
  }

  const hashString = (s: string): number => {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return h >>> 0
  }

  function buildEdgeDecompositionView(data: EdgeDecompositionData): EdgeDecompositionView {
    const neighborsSorted = (data.neighbors || [])
      .filter((n) => n && n.overlapDays > 0)
      .sort((a, b) => (b.overlapDays || 0) - (a.overlapDays || 0))

    const maxNeighbors = 180
    const topNeighbors = neighborsSorted.slice(0, maxNeighbors)
    const count = 1 + topNeighbors.length

    const nodes = new Float32Array(count * 2)
    const size = new Float32Array(count)
    const alpha = new Float32Array(count)
    const group = new Uint16Array(count)
    const labels: string[] = new Array(count)
    const metaNodes: Array<Record<string, unknown>> = new Array(count)
    const neighborIndexMap = new Map<string, number>()
    const neighborsView: EdgeDecompositionNeighborView[] = []

    const centerLabel = data.center.name || data.center.id || `person:${data.center.id}`
    nodes[0] = 0
    nodes[1] = 0
    size[0] = 13
    alpha[0] = 1
    group[0] = 1
    labels[0] = centerLabel
    metaNodes[0] = {
      id: data.center.id,
      name: data.center.name || data.center.id,
      title: data.center.title || null,
      company: data.center.company || null,
      company_id: data.center.companyId || null,
      seniority: data.center.seniority ?? null,
      linkedin_connections: data.center.linkedinConnections ?? null,
      group: 1,
    }

    const maxOverlap = Math.max(1, topNeighbors[0]?.overlapDays ?? 1)
    const ringConfigs = [
      { radius: 320, capacity: 12 },
      { radius: 520, capacity: 32 },
      { radius: 760, capacity: 60 },
      { radius: 980, capacity: Number.POSITIVE_INFINITY },
    ]

    let placed = 0
    let nodeIndex = 1
    for (const ring of ringConfigs) {
      const remaining = topNeighbors.length - placed
      if (remaining <= 0) break
      const take = Math.min(ring.capacity, remaining)
      for (let local = 0; local < take; local += 1) {
        const neighbor = topNeighbors[placed]
        const idx = nodeIndex
        const baseAngle = (local / Math.max(1, take)) * Math.PI * 2
        const angleJitter = ((hashString(`${neighbor.id}:angle`) % 3600) / 3600 - 0.5) * (Math.PI / 6)
        const angle = baseAngle + angleJitter
        const radiusJitter = ((hashString(`${neighbor.id}:radius`) % 1000) / 1000 - 0.5) * 48
        const radius = ring.radius + radiusJitter
        nodes[idx * 2] = Math.cos(angle) * radius
        nodes[idx * 2 + 1] = Math.sin(angle) * radius
        const strength = Math.max(1, neighbor.overlapDays || 0)
        const sizeNorm = Math.max(3.2, 5.2 * Math.pow(strength / maxOverlap, 0.32))
        size[idx] = sizeNorm
        alpha[idx] = 0.92
        group[idx] = 1
        const label = neighbor.name || neighbor.company || neighbor.id
        labels[idx] = label || neighbor.id
        metaNodes[idx] = {
          id: neighbor.id,
          name: neighbor.name || neighbor.id,
          title: neighbor.title || null,
          company: neighbor.company || null,
          company_id: neighbor.companyId || null,
          overlap_days: neighbor.overlapDays,
          peer_days: neighbor.peerDays,
          community_days: neighbor.communityDays,
          calendar_days: neighbor.calendarDays,
          email_score: neighbor.emailScore,
          linkedin_connections: neighbor.linkedinConnections,
          shared_companies: neighbor.sharedCompanies,
          companies: neighbor.companies,
          group: 1,
        }
        neighborIndexMap.set(neighbor.id, idx)
        neighborsView.push({ ...neighbor, index: idx, facets: [], distance: 1, viaIndex: null })
        placed += 1
        nodeIndex += 1
      }
    }

    const paletteDefaults: Record<string, string> = {
      "Work History": "#60a5fa",
      Email: "#22c55e",
      Calendar: "#fb7185",
      Peership: "#eab308",
      Community: "#a78bfa",
      Commercial: "#f97316",
      LinkedIn: "#64748b",
      "Triadic Closure": "#10b981",
    }
    const palette: Record<string, string> = { ...paletteDefaults }
    if (typeof window !== 'undefined') {
      try {
        const style = window.getComputedStyle(document.documentElement)
        const getVar = (name: string, fallback: string) => {
          const v = style.getPropertyValue(name).trim()
          return v || fallback
        }
        palette["Work History"] = getVar('--facet-work', palette["Work History"])
        palette.Email = getVar('--facet-email', palette.Email)
        palette.Calendar = getVar('--facet-calendar', palette.Calendar)
        palette.Peership = getVar('--facet-peership', palette.Peership)
        palette.Community = getVar('--facet-community', palette.Community)
        palette.Commercial = getVar('--facet-commercial', palette.Commercial)
        palette.LinkedIn = getVar('--facet-linkedin', palette.LinkedIn)
        palette["Triadic Closure"] = getVar('--facet-triadic', palette["Triadic Closure"])
      } catch {}
    }

    const edges: EdgeDecompositionEdge[] = []
    const facetCounts = new Map<string, number>()

    const addFacetCount = (facet: string) => {
      facetCounts.set(facet, (facetCounts.get(facet) ?? 0) + 1)
    }

    const threshold = {
      email: 60,
      calendarDays: 30,
      communityDays: 45,
      peerDays: 45,
      linkedin: 400,
    }

    const computeFacets = (neighbor: EdgeDecompositionNeighborView): string[] => {
      const facets: string[] = ["Work History"]
      if (neighbor.emailScore >= threshold.email) facets.push("Email")
      if (neighbor.calendarDays >= threshold.calendarDays) facets.push("Calendar")
      if (neighbor.peerDays >= threshold.peerDays) facets.push("Peership")
      if (neighbor.communityDays >= threshold.communityDays) facets.push("Community")
      const centerCompanyId = data.center.companyId || null
      if (neighbor.sharedCompanies >= 2 && centerCompanyId && neighbor.companyId && neighbor.companyId !== centerCompanyId) {
        facets.push("Commercial")
      }
      if (neighbor.linkedinConnections >= threshold.linkedin) facets.push("LinkedIn")
      return facets
    }

    topNeighbors.forEach((neighbor, idx) => {
      const nodeIdx = neighborIndexMap.get(neighbor.id)
      if (typeof nodeIdx !== 'number') return
      const weight = Math.max(1, (neighbor.overlapDays || 0) / 30)
      const neighborView = neighborsView[idx]
      if (!neighborView) return
      const facets = computeFacets(neighborView)
      neighborView.facets = facets
      facets.forEach(addFacetCount)
      edges.push({ source: 0, target: nodeIdx, weight, facets })
    })

    const triadicPairs = new Set<string>()
    const maxTriadicEdges = 80
    const companyMap = new Map<string, number[]>()
    topNeighbors.forEach((neighbor) => {
      const nodeIdx = neighborIndexMap.get(neighbor.id)
      if (typeof nodeIdx !== 'number') return
      (neighbor.companies || []).forEach((companyId) => {
        if (!companyId) return
        let arr = companyMap.get(companyId)
        if (!arr) {
          arr = []
          companyMap.set(companyId, arr)
        }
        if (arr.length < 6) arr.push(nodeIdx)
      })
    })

    for (const [, indices] of companyMap.entries()) {
      if (triadicPairs.size >= maxTriadicEdges) break
      for (let a = 0; a < indices.length; a += 1) {
        for (let b = a + 1; b < indices.length; b += 1) {
          if (triadicPairs.size >= maxTriadicEdges) break
          const i = indices[a]
          const j = indices[b]
          if (i === j) continue
          const key = i < j ? `${i}-${j}` : `${j}-${i}`
          if (triadicPairs.has(key)) continue
          triadicPairs.add(key)
          edges.push({ source: i, target: j, weight: 1, facets: ["Triadic Closure"] })
          addFacetCount("Triadic Closure")
        }
      }
      if (triadicPairs.size >= maxTriadicEdges) break
    }

    const edgesArr = new Uint32Array(edges.length * 2)
    const edgeWeights = new Float32Array(edges.length)
    edges.forEach((edge, index) => {
      edgesArr[index * 2] = edge.source
      edgesArr[index * 2 + 1] = edge.target
      edgeWeights[index] = edge.weight
    })

    const tile: ParsedTile & { labels?: string[]; meta?: { nodes: Array<Record<string, unknown>> } } = {
      count,
      nodes,
      size,
      alpha,
      group,
      edges: edgesArr,
      edgeWeights,
    } as any
    ;(tile as any).labels = labels
    ;(tile as any).meta = { nodes: metaNodes }
    ;(tile as any).focusWorld = { x: 0, y: 0 }

    const facetOrder: Array<{ key: string; label: string }> = [
      { key: "Work History", label: "Work History" },
      { key: "Email", label: "Email" },
      { key: "Calendar", label: "Calendar" },
      { key: "Peership", label: "Peership" },
      { key: "Community", label: "Community" },
      { key: "Commercial", label: "Commercial" },
      { key: "LinkedIn", label: "LinkedIn" },
      { key: "Triadic Closure", label: "Triadic Closure" },
    ]

    const facets: EdgeFacetSummary[] = facetOrder
      .map(({ key, label }) => ({ key, label, color: palette[key] || '#888', count: facetCounts.get(key) ?? 0 }))
      .filter((f) => f.count > 0)

    return {
      tile,
      center: data.center,
      neighbors: neighborsView,
      edges,
      labels,
      metaNodes,
      facets,
      palette,
    }
  }

  // Build a 1- and 2-hop subgraph from the CURRENT tile using adjacency, limited to depth 2.
  // If targetCanonical is provided, constrain to paths that end at that target.
  function buildTwoHopPathsViewFromTile(sourceCanonical: string, targetCanonical?: string | null): EdgeDecompositionView {
    const src = String(sourceCanonical||'').trim()
    const dst = (targetCanonical||'') ? String(targetCanonical).trim() : null
    const base = latestTileRef.current as ParsedTile | null
    if (!base) { throw new Error('No active graph to compute paths from.') }

    // Map canonical id to index in current tile using meta.nodes if available
    const meta = (base as any)?.meta?.nodes as Array<any> | undefined
    const labelsArr: string[] | undefined = (base as any)?.labels
    const normalize = (s:string)=> s.toLowerCase()
    const matchesCanonical = (node:any, canonical:string)=>{
      const c = normalize(canonical)
      const idA = String(node?.id ?? '').toLowerCase()
      const pid = String(node?.person_id ?? '').toLowerCase()
      const cid = String(node?.company_id ?? '').toLowerCase()
      // Accept raw numeric id too
      const raw = c.replace(/^person:|^company:/,'')
      return (idA === c || idA === raw) || (pid && (pid === c || pid === raw)) || (cid && (cid === c || cid === raw))
    }
    const findIndexForCanonical = (canonical:string): number => {
      if (Array.isArray(meta)) {
        for (let i=0;i<meta.length;i++){ if (matchesCanonical(meta[i], canonical)) return i }
      }
      // Fallback: try label exact match
      if (Array.isArray(labelsArr)){
        const idx = labelsArr.findIndex(l=> String(l||'').toLowerCase() === normalize(canonical))
        if (idx >= 0) return idx
      }
      // Last resort: if canonical is like person:0 or company:0 and tile index exists
      try { const raw = Number.parseInt(canonical.replace(/[^0-9]/g,''),10); if (Number.isFinite(raw) && raw>=0 && raw < (base.count|0)) return raw } catch {}
      return -1
    }

    const srcIdx = findIndexForCanonical(src)
    if (srcIdx < 0) throw new Error(`Source not found in current graph: ${sourceCanonical}`)
    const dstIdx = dst ? findIndexForCanonical(dst) : -1
    if (dst && dstIdx < 0) throw new Error(`Target not found in current graph: ${targetCanonical}`)

    // Build adjacency from base.edges
    const count = base.count|0
    const rawEdges: Uint32Array | Uint16Array | undefined = (base as any).edges
    const baseEdgeWeights: Float32Array | undefined = (base as any).edgeWeights
    const adj: number[][] = Array.from({length: count}, ()=>[])
    const wMap = new Map<string, number>()
    if (rawEdges && rawEdges.length >= 2){
      for (let i=0;i<rawEdges.length;i+=2){
        const a = rawEdges[i]|0, b = rawEdges[i+1]|0
        if (a<count && b<count && a!==b){
          adj[a].push(b); adj[b].push(a)
          const ei = i/2
          const w = (baseEdgeWeights && baseEdgeWeights.length>ei) ? (baseEdgeWeights[ei] || 1) : 1
          const k1 = a<b?`${a}-${b}`:`${b}-${a}`
          if (!wMap.has(k1)) wMap.set(k1, w)
        }
      }
    }

    // 1-hop neighbors
    const first = new Set<number>(adj[srcIdx])
    // 2-hop paths (src -> mid -> t). If dst provided, constrain to that t.
    const secondPairs: Array<{ via:number, t:number }>=[]
    const seenPair = new Set<string>()
    for (const mid of first){
      const step2 = adj[mid]
      for (const t of step2){
        if (t === srcIdx) continue
        if (dst && t !== dstIdx) continue
        // allow t==mid? skip self
        if (first.has(t)){
          // If also direct, we still record the introducer path separately
        }
        const key = `${mid}-${t}`
        if (seenPair.has(key)) continue
        seenPair.add(key)
        secondPairs.push({ via: mid, t })
      }
    }

    // Collect nodes to include: src, all direct neighbors (optionally filtered if dst specified to those equal to dst), and second-hop targets
    const include = new Set<number>()
    include.add(srcIdx)
    first.forEach(n=>{ if (!dst || n===dstIdx) include.add(n) })
    for (const p of secondPairs){ include.add(p.via); include.add(p.t) }

    // Build compact tile
    const indexMap = new Map<number, number>()
    const rev: number[] = []
    Array.from(include.values()).forEach((oldIdx, i)=>{ indexMap.set(oldIdx, i); rev[i]=oldIdx })
    const nCount = include.size
    const nodes = new Float32Array(nCount*2)
    const size = new Float32Array(nCount)
    const alpha = new Float32Array(nCount)
    const group = new Uint16Array(nCount)
    const labels: string[] = new Array(nCount)
    const metaNodes: Array<Record<string, unknown>> = new Array(nCount)
    for (let i=0;i<nCount;i++){
      const old = rev[i]
      nodes[i*2] = (base as any).nodes[old*2]
      nodes[i*2+1] = (base as any).nodes[old*2+1]
      size[i] = (base as any).size?.[old] || 6
      alpha[i] = (base as any).alpha?.[old] || 1
      group[i] = (base as any).group?.[old] || 1
      labels[i] = (labelsArr?.[old]) || String(meta?.[old]?.full_name || meta?.[old]?.name || meta?.[old]?.company || meta?.[old]?.id || `#${old}`)
      metaNodes[i] = (meta?.[old] ? { ...meta[old] } : { id: old }) as any
    }

    const edgeList: Array<{ a:number, b:number, w:number }>=[]
    const addEdge = (oa:number, ob:number)=>{
      const a = indexMap.get(oa)!, b = indexMap.get(ob)!
      if (typeof a !== 'number' || typeof b !== 'number') return
      const k = a<b?`${a}-${b}`:`${b}-${a}`
      if ((edgeList as any)._seen?.has(k)) return
      ;((edgeList as any)._seen ||= new Set()).add(k)
      const w = wMap.get(oa<ob?`${oa}-${ob}`:`${ob}-${oa}`) || 1
      edgeList.push({ a, b, w })
    }

    // Add only edges that are part of 1- or 2-hop relationships from src
    for (const n of first){ if (!dst || n===dstIdx) addEdge(srcIdx, n) }
    for (const p of secondPairs){ addEdge(srcIdx, p.via); addEdge(p.via, p.t) }

    const edgesArr = new Uint32Array(edgeList.length*2)
    const outEdgeWeights = new Float32Array(edgeList.length)
    edgeList.forEach((e,i)=>{ edgesArr[i*2]=e.a; edgesArr[i*2+1]=e.b; outEdgeWeights[i]=e.w })

    const tile: ParsedTile & { labels?: string[]; meta?: { nodes: Array<Record<string, unknown>> } } = {
      count: nCount,
      nodes,
      size,
      alpha,
      group,
      edges: edgesArr,
      edgeWeights: outEdgeWeights,
    } as any
    ;(tile as any).labels = labels
    ;(tile as any).meta = { nodes: metaNodes }
    ;(tile as any).focusWorld = { x: (((base as any)?.focusWorld?.x) ?? nodes[0]) || 0, y: (((base as any)?.focusWorld?.y) ?? nodes[1]) || 0 }

    // Neighbors view with grouping
    const neighborsView: EdgeDecompositionNeighborView[] = []
    // Direct
    for (const n of first){
      if (dst && n!==dstIdx) continue
      const idx = indexMap.get(n)!
      const label = labels[idx]
      const node = metaNodes[idx]
      neighborsView.push({ id: String((node as any)?.id ?? n), name: (node as any)?.name as any, title: (node as any)?.title as any, company: (node as any)?.company as any, companyId: (node as any)?.company_id as any, overlapDays: 0, peerDays: 0, communityDays: 0, calendarDays: 0, sharedCompanies: 0, emailScore: 0, linkedinConnections: 0, companies: [], index: idx, facets: ["Work History"], distance: 1, viaIndex: null })
    }
    // Introducers
    for (const p of secondPairs){
      const tIdxNew = indexMap.get(p.t)!
      const viaIdxNew = indexMap.get(p.via)!
      const node = metaNodes[tIdxNew]
      neighborsView.push({ id: String((node as any)?.id ?? p.t), name: (node as any)?.name as any, title: (node as any)?.title as any, company: (node as any)?.company as any, companyId: (node as any)?.company_id as any, overlapDays: 0, peerDays: 0, communityDays: 0, calendarDays: 0, sharedCompanies: 0, emailScore: 0, linkedinConnections: 0, companies: [], index: tIdxNew, facets: ["Work History"], distance: 2, viaIndex: viaIdxNew })
    }

    // Palette/facets minimal
    const palette: Record<string,string> = { "Work History": '#60a5fa' }
    const facets: EdgeFacetSummary[] = [{ key:'Work History', label:'Work History', color: palette['Work History'], count: neighborsView.length }]

    // Center info from meta[srcIdx]
    const centerNode = meta?.[srcIdx] || {}
    const center = {
      id: String((centerNode as any)?.id ?? srcIdx),
      canonicalId: (typeof (centerNode as any)?.id === 'string' && /^(person|company):/i.test(String((centerNode as any)?.id))) ? String((centerNode as any)?.id) : undefined,
      name: (centerNode as any)?.name || labelsArr?.[srcIdx] || null,
      title: (centerNode as any)?.title || null,
      company: (centerNode as any)?.company || null,
      companyId: (centerNode as any)?.company_id != null ? String((centerNode as any)?.company_id) : null,
      seniority: null,
      linkedinConnections: null,
    }

    return { tile, center, neighbors: neighborsView, edges: edgeList.map(e=>({ source:e.a, target:e.b, weight:e.w, facets:["Work History"] })), labels, metaNodes, facets, palette }
  }

  const executeIntroPathsCommand = async (params: { S: string, company: string, icp?: string, k?: number, minRMT?: number }) => {
    const SId = await ensureEntityId(params.S)
    const CId = await ensureCompanyId(params.company)
    const result = await fetchIntroPaths({ S: SId, companyId: CId, icpRegex: params.icp, k: params.k, minRMT: params.minRMT })
    setIntroPathsResult(result)
    const built = buildIntroPathsTile(result)
    latestTileRef.current = built.tile as ParsedTile
    setErr(null)
    setLabels((built.tile as any).labels || [])
    setMetaNodes(((built.tile as any).meta?.nodes || []) as any)
    try { const meta = (built.tile as any).meta?.nodes || []; console.log('Meta(nodes) sample (intro paths):', meta.slice(0,6).map((n:any)=>({ id:n?.id, person_id:n?.person_id, person_id_str:n?.person_id_str, linkedin:n?.linkedin }))) } catch {}
    // Reset selection/masks
    setSelectedPathIndex(null)
    setIntroPathsTileMask(null)
    setNearbyExecs([])
    // Inject avatars into tile meta for CanvasScene
    try {
      const meta: any[] | undefined = (built.tile as any)?.meta?.nodes
      const idsForLookup = Array.isArray(meta) ? meta.map((n:any)=> String(n?.id ?? n?.person_id ?? '')).filter(Boolean) : []
      let chMap = new Map<string,string>()
      try { if (idsForLookup.length) chMap = await fetchAvatarMap(idsForLookup) } catch {}
      const av = new Array((built.tile as any).count||0).fill('').map((_, i)=>{
        const node:any = meta?.[i] || {}
        const explicit = (node?.avatar_url || node?.avatarUrl) as string | undefined
        if (explicit) return explicit
        const keyA = String(node?.id ?? '')
        const keyB = String(node?.person_id ?? '')
        const fromCH = (keyA && chMap.has(keyA)) ? chMap.get(keyA)! : (keyB && chMap.has(keyB)) ? chMap.get(keyB)! : ''
        return fromCH || ''
      })
      setAvatars(av)
      try { if (Array.isArray(meta)) meta.forEach((n:any, idx:number)=>{ const u = av[idx]; if (u) n.avatar_url = u }) } catch {}
    } catch {}
    sceneRef.current?.setForeground(built.tile as any)
    setFocus(`Intro Paths: ${result.S} → company:${result.companyId}`)
    try { (sceneRef.current as any)?.focusIndex?.(0, { animate: true, ms: 480, zoom: 1.4 }) } catch {}
    return { SId, CId, result, built }
  }

  type OperatorContext = {
    left: string | null
    right: string | null
    filters: Record<string, string>
  }

  const extractOperatorEntities = (
    expression: EvaluationResult['expression'] | undefined,
    ops: Array<CruxOperatorToken['op']>
  ): OperatorContext => {
    const tokens = expression?.tokens ?? []
    const filters: Record<string, string> = {}
    let left: string | null = null
    let right: string | null = null

    const opIndex = tokens.findIndex(
      (tok) => tok.type === 'operator' && ops.includes((tok as CruxOperatorToken).op)
    )

    if (opIndex !== -1) {
      for (let i = opIndex - 1; i >= 0; i--) {
        const tok = tokens[i]
        if (tok.type === 'entity' || tok.type === 'macro-ref') {
          const entityTok = tok as CruxEntityToken
          const metaCanonical = typeof (entityTok.meta as any)?.canonical === 'string'
            ? (entityTok.meta as any).canonical
            : null
          left = metaCanonical || entityTok.value?.trim() || entityTok.raw.trim()
          break
        }
      }
      for (let i = opIndex + 1; i < tokens.length; i++) {
        const tok = tokens[i]
        if (tok.type === 'entity' || tok.type === 'macro-ref') {
          const entityTok = tok as CruxEntityToken
          const metaCanonical = typeof (entityTok.meta as any)?.canonical === 'string'
            ? (entityTok.meta as any).canonical
            : null
          right = metaCanonical || entityTok.value?.trim() || entityTok.raw.trim()
          break
        }
      }
    }

    for (const token of tokens) {
      if (token.type === 'filter') {
        const filter = token as CruxFilterToken
        const key = filter.key?.toLowerCase()
        if (key) filters[key] = filter.valueRaw.trim()
      }
    }

    return { left, right, filters }
  }

  const executeBridgeCommand = async (params: { left: string; right: string; limit?: number; focusLabel?: string }) => {
    const rid = ++runIdRef.current
    const leftId = await ensureCompanyId(params.left)
    const rightId = await ensureCompanyId(params.right)
    const limit = Number.isFinite(params.limit) && params.limit ? Math.max(10, Math.floor(params.limit)) : 180
    const payload = await fetchBridgesTileJSON(leftId, rightId, limit)
    if (rid !== runIdRef.current) return { tile: undefined as any, leftId, rightId, payload } as any
    const tile = parseJsonTile(payload as any)
    latestTileRef.current = tile as ParsedTile
    setErr(null)

    const meta = Array.isArray((payload as any)?.meta?.nodes) ? (payload as any).meta.nodes : []
    setMetaNodes(meta as any)
    try { console.log('Meta(nodes) sample (bridges):', (meta||[]).slice(0,6).map((n:any)=>({ id:n?.id, person_id:n?.person_id, person_id_str:n?.person_id_str, linkedin:n?.linkedin }))) } catch {}

    const groups = Array.isArray((payload as any)?.coords?.groups) ? (payload as any).coords.groups : []
    const labelsIn = Array.isArray((payload as any)?.labels) ? (payload as any).labels as string[] : undefined

    const decorateLabels = (labelsSource: string[] | undefined): string[] | undefined => {
      if (!Array.isArray(labelsSource)) return undefined
      try {
        return labelsSource.map((lab, i) => {
          const node = meta?.[i] ?? {}
          const groupValue = typeof groups?.[i] === 'number' ? groups?.[i] : typeof node?.group === 'number' ? node.group : undefined
          if (groupValue === 1) {
            const score = typeof node?.score === 'number' ? node.score : undefined
            const leftDegree = typeof node?.left_degree === 'number' ? node.left_degree : undefined
            const rightDegree = typeof node?.right_degree === 'number' ? node.right_degree : undefined
            const scorePart = typeof score === 'number' && Number.isFinite(score) ? ` • overlap ${Math.round(score)}m` : ''
            const degreePart = (Number.isFinite(leftDegree) || Number.isFinite(rightDegree))
              ? ` • L:${Math.max(0, Number(leftDegree || 0))} R:${Math.max(0, Number(rightDegree || 0))}`
              : ''
            return `${lab}${scorePart}${degreePart}`.trim()
          }
          return lab
        })
      } catch {
        return labelsSource
      }
    }

    const fallbackLabels = meta.map((node: any, idx: number) => (
      node?.full_name || node?.name || node?.title || (labelsIn?.[idx]) || String(node?.id ?? `#${idx}`)
    ))
    const nextLabels = decorateLabels(labelsIn) || labelsIn || fallbackLabels
    setLabels(nextLabels)

    // Avatar assignment priority: explicit url -> ClickHouse avatar -> LinkedIn (no DiceBear)
    const explicit = new Array(tile.count).fill(null as string | null).map((_, i)=>{
      const node = meta?.[i] ?? {}
      const u = (node?.avatar_url || node?.avatarUrl) as string | undefined
      return (u && typeof u === 'string') ? u : null
    })
    const idsForLookup = meta.map((n:any)=> String(n?.id ?? n?.person_id ?? '')).filter(Boolean)
    let chMap = new Map<string,string>()
    try {
      if (idsForLookup.length) {
        console.log('AvatarMap(graph) request ids sample:', idsForLookup.slice(0,10))
        chMap = await fetchAvatarMap(idsForLookup)
        try { console.log('AvatarMap(graph): ids', idsForLookup.length, 'mapped', chMap.size, 'sample', Array.from(chMap.entries()).slice(0,4)) } catch {}
      }
    } catch (e) { console.warn('AvatarMap(graph) failed', e) }
    const avatars = new Array(tile.count).fill('').map((_, i) => {
      const node = meta?.[i] ?? {}
      const exp = explicit[i]
      if (exp) return exp
      const keyA = String(node?.id ?? '')
      const keyB = String(node?.person_id ?? '')
      let fromCH = ''
      if (keyA && chMap.has(keyA)) fromCH = chMap.get(keyA) || ''
      else if (keyB && chMap.has(keyB)) fromCH = chMap.get(keyB) || ''
      if (fromCH) return fromCH
      return ''
    })
    setAvatars(avatars)
    try {
      if ((tile as any)?.meta?.nodes) {
        (tile as any).meta.mode = 'graph'
        ;(tile as any).meta.nodes.forEach((n:any, idx:number)=>{ const u = avatars[idx]; if (u) n.avatar_url = u })
        // Ensure labels/meta get pushed with avatar urls for CanvasScene consumption
        latestTileRef.current = tile as any
      }
    } catch {}

    const deriveFocusLabel = (): string => {
      const anchorName = (node: any) => node?.full_name || node?.name || node?.company || node?.id
      const leftName = anchorName(meta?.[0]) || leftId
      const rightName = anchorName(meta?.[1]) || rightId
      return params.focusLabel || `Bridges: ${leftName} ↔ ${rightName}`
    }
    setFocus(deriveFocusLabel())

    setCompareGroups(null)
    setSidebarIndices(null)
    setSelectedRegion(null)

    if (rid === runIdRef.current) sceneRef.current?.setForeground(tile as any)
    return { tile, leftId, rightId, payload }
  }

  const getBridgeContextFromExpression = (expression: EvaluationResult['expression']) => {
    const { left, right, filters } = extractOperatorEntities(expression, ['^', 'bridge'])
    const parsedLimit = filters.top ? parseInt(filters.top.replace(/[^0-9]/g, ''), 10) : undefined
    return { left, right, limit: Number.isFinite(parsedLimit) && parsedLimit ? parsedLimit : undefined }
  }

  const getCompareContextFromExpression = (expression: EvaluationResult['expression']) => {
    return extractOperatorEntities(expression, ['><', 'compare'])
  }

  const getMigrationContextFromExpression = (expression: EvaluationResult['expression']) => {
    const context = extractOperatorEntities(expression, ['*', 'migration'])
    const limit = context.filters.top ? parseInt(context.filters.top.replace(/[^0-9]/g, ''), 10) : undefined
    const timeFilter = context.filters.time || context.filters.window || ''
    const months = (() => {
      if (!timeFilter) return undefined
      const num = parseInt(timeFilter.replace(/[^0-9]/g, ''), 10)
      return Number.isFinite(num) && num > 0 ? num : undefined
    })()
    const since = context.filters.since?.trim() || undefined
    const until = context.filters.until?.trim() || undefined
    return {
      left: context.left,
      right: context.right,
      limit: Number.isFinite(limit) && limit ? limit : undefined,
      windowMonths: months,
      since,
      until,
    }
  }

  type CompareRegion = 'left' | 'right' | 'overlap'

  interface ApplyCompareParams {
    leftId: string
    rightId: string
    leftTile: ParsedTile
    rightTile: ParsedTile
    leftLabel?: string | null
    rightLabel?: string | null
    focusLabel?: string
    highlight?: CompareRegion
    selectedRegion?: CompareRegion | null
    autoFocus?: boolean
  }

  const applyCompareTiles = (params: ApplyCompareParams) => {
    const {
      leftId,
      rightId,
      leftTile,
      rightTile,
      leftLabel,
      rightLabel,
      focusLabel,
      highlight,
      selectedRegion,
      autoFocus = true,
    } = params

    lastCompareIdsRef.current = { a: leftId, b: rightId }
    const compareTile = buildCompareTile(leftTile as any, rightTile as any, highlight ? { highlight } : undefined)
    try { console.log('buildCompareTile produced', {
      count: compareTile.count,
      labels: Array.isArray((compareTile as any).labels) ? (compareTile as any).labels.length : 0,
      compareGroups: compareTile && (compareTile as any).compareIndexGroups ? {
        left: ((compareTile as any).compareIndexGroups.left || []).length,
        right: ((compareTile as any).compareIndexGroups.right || []).length,
        overlap: ((compareTile as any).compareIndexGroups.overlap || []).length,
      } : null,
      compareLists: compareTile && (compareTile as any).compareLists ? {
        shared: ((compareTile as any).compareLists.mutualF1 || []).length,
        a1b2: ((compareTile as any).compareLists.aF1_bF2 || []).length,
        b1a2: ((compareTile as any).compareLists.bF1_aF2 || []).length,
        aOnly: ((compareTile as any).compareLists.aOnly || []).length,
        bOnly: ((compareTile as any).compareLists.bOnly || []).length,
      } : null,
    }) } catch {}
    try { (window as any).__COMPARE_LAST_TILE = compareTile } catch {}

    const labels = Array.isArray((compareTile as any).labels) ? (compareTile as any).labels as string[] : []
    try { console.log('Compare tile labels', labels.length) } catch {}
    setLabels(labels)
    setMetaNodes([])
    // Inject avatars for Compare: prefer explicit urls first; then async ClickHouse lookup (no await)
    try {
      const meta: any[] | undefined = (compareTile as any)?.meta?.nodes
      const idsForLookup = Array.isArray(meta) ? meta.map((n:any)=> String(n?.id ?? n?.person_id ?? '')).filter(Boolean) : []
      let chMap = new Map<string,string>()
      // Initial pass using only explicit URLs
      const initial = new Array(compareTile.count).fill('').map((_, i)=>{
        const node:any = meta?.[i] || {}
        const explicit = (node?.avatar_url || node?.avatarUrl) as string | undefined
        if (explicit) return explicit
        return ''
      })
      setAvatars(initial)
      try { if (Array.isArray(meta)) meta.forEach((n:any, idx:number)=>{ const u = initial[idx]; if (u) n.avatar_url = u }) } catch {}
      try { latestTileRef.current = compareTile as ParsedTile } catch {}
      // Async enrichment from ClickHouse avatar map
      try {
        if (idsForLookup.length) {
          fetchAvatarMap(idsForLookup).then((m)=>{
            chMap = m || new Map<string,string>()
            const enriched = new Array(compareTile.count).fill('').map((_, i)=>{
              const node:any = meta?.[i] || {}
              const explicit = (node?.avatar_url || node?.avatarUrl) as string | undefined
              if (explicit) return explicit
              const keyA = String(node?.id ?? '')
              const keyB = String(node?.person_id ?? '')
              const fromCH = (keyA && chMap.has(keyA)) ? chMap.get(keyA)! : (keyB && chMap.has(keyB)) ? chMap.get(keyB)! : ''
              return fromCH || ''
            })
            setAvatars(enriched)
            try { if (Array.isArray(meta)) meta.forEach((n:any, idx:number)=>{ const u = enriched[idx]; if (u) n.avatar_url = u }) } catch {}
          }).catch(()=>{})
        }
      } catch {}
    } catch { try { setAvatars(new Array(compareTile.count).fill('')) } catch { setAvatars([]) } }

    const groups = (compareTile as any).compareIndexGroups as
      | { left?: number[]; right?: number[]; overlap?: number[] }
      | undefined
    if (groups) {
      const safeGroups: { left: number[]; right: number[]; overlap: number[] } = {
        left: groups.left || [],
        right: groups.right || [],
        overlap: groups.overlap || [],
      }
      setCompareGroups(safeGroups)
      try { setCompareLists(((compareTile as any)?.compareLists) || null) } catch { setCompareLists(null) }
      try { (window as any).__COMPARE_GROUPS = { groups, lists: (compareTile as any)?.compareLists || null } } catch {}
      try { console.log('Compare groups stats', {
        left: groups.left?.length || 0,
        right: groups.right?.length || 0,
        overlap: groups.overlap?.length || 0,
        lists: {
          shared: ((compareTile as any)?.compareLists?.mutualF1 || []).length,
          a1b2: ((compareTile as any)?.compareLists?.aF1_bF2 || []).length,
          b1a2: ((compareTile as any)?.compareLists?.bF1_aF2 || []).length,
          aOnly: ((compareTile as any)?.compareLists?.aOnly || []).length,
          bOnly: ((compareTile as any)?.compareLists?.bOnly || []).length,
        }
      }) } catch {}
      if (selectedRegion && (groups as any)[selectedRegion]) {
        setSidebarIndices((groups as any)[selectedRegion] || null)
      } else {
        setSidebarIndices(null)
      }
    } else {
      // If groups missing but tile has compare data, synthesize minimal groups for Overview
      const compAny: any = compareTile as any
      const fallbackGroups = compAny?.compareIndexGroups || null
      setCompareGroups(fallbackGroups)
      try { setCompareLists(compAny?.compareLists || null) } catch { setCompareLists(null) }
      try { (window as any).__COMPARE_GROUPS = { groups: fallbackGroups, lists: compAny?.compareLists || null } } catch {}
      try { console.log('Compare fallback stats', {
        left: fallbackGroups?.left?.length || 0,
        right: fallbackGroups?.right?.length || 0,
        overlap: fallbackGroups?.overlap?.length || 0,
        lists: {
          shared: (compAny?.compareLists?.mutualF1 || []).length,
          a1b2: (compAny?.compareLists?.aF1_bF2 || []).length,
          b1a2: (compAny?.compareLists?.bF1_aF2 || []).length,
          aOnly: (compAny?.compareLists?.aOnly || []).length,
          bOnly: (compAny?.compareLists?.bOnly || []).length,
        }
      }) } catch {}
      setSidebarIndices(null)
    }

    const focusLeft = leftLabel || leftId
    const focusRight = rightLabel || rightId
    if (focusLabel) setFocus(focusLabel)
    else setFocus(`${focusLeft} + ${focusRight}`)

    setSelectedRegion(selectedRegion ?? null)
    latestTileRef.current = compareTile as ParsedTile
    sceneRef.current?.setForeground(compareTile as any)
    if (autoFocus) {
      try { (sceneRef.current as any)?.focusIndex?.(0, { animate: true, ms: 480, zoom: 1.9 }) } catch {}
    }
    return compareTile as ParsedTile
  }

  const executeCompareCommand = async (params: {
    left: string
    right: string
    leftTile?: ParsedTile
    rightTile?: ParsedTile
    leftLabel?: string | null
    rightLabel?: string | null
    focusLabel?: string
    highlight?: CompareRegion
    selectedRegion?: CompareRegion | null
    autoFocus?: boolean
  }) => {
    const rid = ++runIdRef.current
    const leftId = await ensureEntityId(params.left)
    const rightId = await ensureEntityId(params.right)
    if (leftId === rightId) throw new Error('Please choose two different entities to compare.')
    const leftTile = params.leftTile ?? (await loadTileSmart(leftId)).tile
    const rightTile = params.rightTile ?? (await loadTileSmart(rightId)).tile
    setErr(null)
    if (rid !== runIdRef.current) return { leftId, rightId }
    applyCompareTiles({
      leftId,
      rightId,
      leftTile: leftTile as ParsedTile,
      rightTile: rightTile as ParsedTile,
      leftLabel: params.leftLabel ?? null,
      rightLabel: params.rightLabel ?? null,
      focusLabel: params.focusLabel,
      highlight: params.highlight,
      selectedRegion: params.selectedRegion ?? null,
      autoFocus: params.autoFocus,
    })
    return { leftId, rightId }
  }

  interface MigrationRow {
    from_id: string
    to_id: string
    movers: number
    from_name?: string
    to_name?: string
    avg_days?: number
  }

  const buildMigrationTile = (
    leftId: string,
    rightId: string,
    rows: MigrationRow[],
    opts?: { leftName?: string; rightName?: string }
  ): ParsedTile & { labels?: string[]; meta?: { nodes: Array<Record<string, unknown>> } } => {
    const flowCount = rows.length
    const anchorCount = 2
    const count = anchorCount + flowCount
    const nodes = new Float32Array(count * 2)
    const size = new Float32Array(count)
    const alpha = new Float32Array(count)
    const group = new Uint16Array(count)

    const leftLabel = (opts?.leftName && String(opts.leftName).trim()) || `company:${leftId.replace(/^company:/i, '')}`
    const rightLabel = (opts?.rightName && String(opts.rightName).trim()) || `company:${rightId.replace(/^company:/i, '')}`
    const anchors: Array<{ id: string; name: string; x: number; y: number; group: number }> = [
      { id: leftId, name: leftLabel, x: -480, y: 0, group: 0 },
      { id: rightId, name: rightLabel, x: 480, y: 0, group: 2 },
    ]

    anchors.forEach((anchor, idx) => {
      nodes[idx * 2] = anchor.x
      nodes[idx * 2 + 1] = anchor.y
      size[idx] = 18
      alpha[idx] = 1
      group[idx] = anchor.group
    })

    const edgesPerFlow = 2
    const totalEdges = Math.max(0, flowCount * edgesPerFlow)
    const edges = new Uint16Array(totalEdges * 2)
    const edgeWeights = new Float32Array(totalEdges)

    const labels = new Array<string>(count)
    labels[0] = `${anchors[0].name} • origin`
    labels[1] = `${anchors[1].name} • destination`

    const metaNodes: Array<Record<string, unknown>> = [
      { id: leftId, name: anchors[0].name, group: 0 },
      { id: rightId, name: anchors[1].name, group: 2 },
    ]

    let edgePtr = 0
    const verticalSpread = 200
    rows.forEach((row, idx) => {
      const nodeIndex = anchorCount + idx
      const dir = row.from_id === leftId && row.to_id === rightId ? 1 : -1
      const xOffset = dir > 0 ? 80 : -80
      const yOffset = (idx - (flowCount - 1) / 2) * verticalSpread
      nodes[nodeIndex * 2] = xOffset
      nodes[nodeIndex * 2 + 1] = yOffset
      const magnitude = Math.max(1, Number(row.movers || 0))
      size[nodeIndex] = Math.min(26, 8 + Math.sqrt(magnitude))
      alpha[nodeIndex] = 0.92
      group[nodeIndex] = 1

      const fromIndex = row.from_id === leftId ? 0 : row.from_id === rightId ? 1 : 0
      const toIndex = row.to_id === rightId ? 1 : row.to_id === leftId ? 0 : 1
      edges[edgePtr * 2] = fromIndex
      edges[edgePtr * 2 + 1] = nodeIndex
      edgeWeights[edgePtr] = magnitude
      edgePtr += 1
      edges[edgePtr * 2] = nodeIndex
      edges[edgePtr * 2 + 1] = toIndex
      edgeWeights[edgePtr] = magnitude
      edgePtr += 1

      const fromNum = String(row.from_id)
      const toNum = String(row.to_id)
      const fromIsLeft = fromNum === leftId.replace(/^company:/i, '')
      const fromIsRight = fromNum === rightId.replace(/^company:/i, '')
      const toIsRight = toNum === rightId.replace(/^company:/i, '')
      const toIsLeft = toNum === leftId.replace(/^company:/i, '')
      const fromName = fromIsLeft ? leftLabel : fromIsRight ? rightLabel : (row.from_name || `company:${fromNum}`)
      const toName = toIsRight ? rightLabel : toIsLeft ? leftLabel : (row.to_name || `company:${toNum}`)
      const flowLabel = `${fromName} → ${toName}`
      labels[nodeIndex] = `${flowLabel} • ${magnitude.toLocaleString()} movers`
      metaNodes.push({
        id: `${row.from_id}-${row.to_id}`,
        from_id: row.from_id,
        to_id: row.to_id,
        movers: magnitude,
        avg_days: row.avg_days,
        name: flowLabel,
        group: 1,
      })
    })

    const tile: ParsedTile & { labels?: string[]; meta?: { nodes: Array<Record<string, unknown>> } } = {
      count,
      nodes,
      size,
      alpha,
      group,
      edges,
      edgeWeights,
    } as any
    tile.labels = labels
    tile.meta = { nodes: metaNodes }
    ;(tile as any).focusWorld = { x: 0, y: 0 }
    return tile
  }

  const executeMigrationCommand = async (params: {
    left: string
    right: string
    limit?: number
    windowMonths?: number
    since?: string
    until?: string
    rows?: MigrationRow[]
    focusLabel?: string
  }) => {
    const rid = ++runIdRef.current
    const leftId = await ensureCompanyId(params.left)
    const rightId = await ensureCompanyId(params.right)
    if (leftId === rightId) throw new Error('Please choose two different companies to analyze migration.')
    const rows = params.rows ?? (await fetchMigrationPairs(leftId, rightId, {
      limit: params.limit,
      windowMonths: params.windowMonths,
      since: params.since,
      until: params.until,
    }))
    if (!rows.length) {
      throw new Error('No migration flows found for that pair.')
    }
    // Normalize for name lookup: rows carry numeric ids; anchors are canonical `company:<id>`
    const leftNum = leftId.replace(/^company:/i, '')
    const rightNum = rightId.replace(/^company:/i, '')
    const leftName = rows.find((row: any) => row.from_id === leftNum)?.from_name
      || rows.find((row: any) => row.to_id === leftNum)?.to_name
    const rightName = rows.find((row: any) => row.from_id === rightNum)?.from_name
      || rows.find((row: any) => row.to_id === rightNum)?.to_name
    const tile = buildMigrationTile(leftId, rightId, rows, { leftName, rightName })
    setErr(null)
    setLabels(tile.labels || [])
    setMetaNodes(tile.meta?.nodes as any)
    try {
      const ids = ((tile as any).meta?.nodes || []).map((n:any)=> String(n?.id ?? n?.person_id ?? ''))
      let chMap = new Map<string,string>()
      try {
        if (ids.length) {
          console.log('AvatarMap(flows) request ids sample:', ids.slice(0,10))
          chMap = await fetchAvatarMap(ids)
          try { console.log('AvatarMap(flows): ids', ids.length, 'mapped', chMap.size, 'sample', Array.from(chMap.entries()).slice(0,4)) } catch {}
        }
      } catch (e) { console.warn('AvatarMap(flows) failed', e) }
      const av = new Array(tile.count).fill('').map((_, i) => {
        const node:any = (tile as any).meta?.nodes?.[i] || {}
        const exp = (node?.avatar_url || node?.avatarUrl) as string | undefined
        if (exp) return exp
        const idStr = String(node?.id || '')
        const fromCH = (idStr && chMap.has(idStr)) ? chMap.get(idStr)! : ''
        if (fromCH) return fromCH
        return ''
      })
      setAvatars(av)
      try {
        if ((tile as any)?.meta?.nodes) {
          (tile as any).meta.mode = 'flows'
          ;(tile as any).meta.nodes.forEach((n:any, idx:number)=>{ const u = av[idx]; if (u) n.avatar_url = u })
          latestTileRef.current = tile as any
        }
      } catch {}
    } catch { setAvatars([]) }
    setCompareGroups(null)
    setSidebarIndices(null)
    setSelectedRegion(null)
    const focusText = params.focusLabel || `Migration: ${(leftName || leftId)} ↦ ${(rightName || rightId)}`
    setFocus(focusText)
    latestTileRef.current = tile as ParsedTile
    if (rid === runIdRef.current) sceneRef.current?.setForeground(tile as any)
    try { (sceneRef.current as any)?.focusIndex?.(0, { animate: true, ms: 520, zoom: 1.6 }) } catch {}
    return { leftId, rightId, rows, tile }
  }

  const handleBridgeFromEvaluation = async (evaluation: EvaluationResult | null): Promise<{ leftId: string; rightId: string } | null> => {
    if (!evaluation) return null
    const viewModel = evaluation.viewModel as any
    if (!viewModel || viewModel.view !== 'graph' || !Array.isArray(viewModel.bridges)) return null

    const context = getBridgeContextFromExpression(evaluation.expression)
    let leftInput = context.left
    let rightInput = context.right

    const rawMeta = Array.isArray(viewModel?.raw?.meta?.nodes) ? viewModel.raw.meta.nodes : []
    if (!leftInput && typeof rawMeta?.[0]?.id === 'string') leftInput = String(rawMeta[0].id)
    if (!rightInput && typeof rawMeta?.[1]?.id === 'string') rightInput = String(rawMeta[1].id)

    if (!leftInput || !rightInput) return null

    try {
      const result = await executeBridgeCommand({
        left: leftInput,
        right: rightInput,
        limit: context.limit,
        focusLabel: viewModel?.left && viewModel?.right ? `Bridges: ${viewModel.left} ↔ ${viewModel.right}` : undefined,
      })
      return { leftId: result.leftId, rightId: result.rightId }
    } catch (error: any) {
      setErr(error?.message || 'bridges failed')
    }
    return null
  }

  const handleCompareFromEvaluation = async (evaluation: EvaluationResult | null): Promise<{ leftId: string; rightId: string } | null> => {
    if (!evaluation) return null
    const viewModel = evaluation.viewModel as any
    const tiles = viewModel?.tiles
    if (!viewModel || viewModel.view !== 'list' || !tiles || !tiles.left || !tiles.right) return null

    const context = getCompareContextFromExpression(evaluation.expression)
    const leftInput = context.left
    const rightInput = context.right
    if (!leftInput || !rightInput) return null

    try {
      const result = await executeCompareCommand({
        left: leftInput,
        right: rightInput,
        leftTile: tiles.left as ParsedTile,
        rightTile: tiles.right as ParsedTile,
        leftLabel: viewModel.left ?? null,
        rightLabel: viewModel.right ?? null,
        focusLabel: viewModel.left && viewModel.right ? `Compare: ${viewModel.left} ↔ ${viewModel.right}` : undefined,
      })
      return result
    } catch (error: any) {
      setErr(error?.message || 'compare failed')
      return null
    }
  }

  const handleMigrationFromEvaluation = async (evaluation: EvaluationResult | null): Promise<{ leftId: string; rightId: string } | null> => {
    if (!evaluation) return null
    const viewModel = evaluation.viewModel as any
    if (!viewModel || viewModel.view !== 'flows' || !Array.isArray(viewModel.pairs)) return null

    const context = getMigrationContextFromExpression(evaluation.expression)
    const leftInput = context.left
    const rightInput = context.right
    if (!leftInput || !rightInput) return null

    try {
      const result = await executeMigrationCommand({
        left: leftInput,
        right: rightInput,
        limit: context.limit,
        windowMonths: context.windowMonths,
        since: context.since,
        until: context.until,
        rows: Array.isArray(viewModel.rows) ? (viewModel.rows as MigrationRow[]) : undefined,
      })
      return { leftId: result.leftId, rightId: result.rightId }
    } catch (error: any) {
      setErr(error?.message || 'migration failed')
      return null
    }
  }

  const runEdgeDecompositionCommand = async (
    ridLocal: number,
    commandText: string,
    personCanonical: string,
    pushHistory: boolean,
  ) => {
    setEdgeDecompLoading(true)
    try {
      // Optional syntax: "edge decomposition <src> -> <dst>"
      let view: EdgeDecompositionView | null = null
      const arrow = commandText.split(/->/i)
      if (arrow.length >= 2) {
        const left = arrow[0].replace(/edge\s+decomposition/i,'').trim() || personCanonical
        const right = arrow[1].trim()
        // Focus Paths (≤2 hops) mode using induced subgraph and fixed layout
        try {
          const focus = await (async()=>{
            // inline small builder to avoid large refactor
            const result = await (async()=>{
              // reuse buildTwoHopPathsViewFromTile to ensure ids exist (no heavy compute)
              return await (async()=>{ return null })()
            })()
            return await (async()=>{ return await (buildFocusPathsViewFromTile as any)(left, right, focusPathsLimit) })()
          })()
          if (ridLocal !== runIdRef.current) return
          setFocusPathsView(focus)
          setEdgeDecompView(null)
          setEdgeDecompFacet(null)
          setEdgeDecompMask(null)
          setIntroPathsResult(null)
          setIntroPathsTileMask(null)
          setPeopleSearchMask(null)
          setConnectionsMask(null)
          setCompaniesMask(null)
          setCompareGroups(null)
          setSidebarIndices(null)
          setSelectedRegion(null)
          setNearbyExecs([])
          setSelectedIndex(null)
          latestTileRef.current = focus.tile as any
          try { (focus.tile as any).meta.mode = 'focus' } catch {}
          sceneRef.current?.setForeground(focus.tile as any)
          const leftName = (focus.tile as any)?.labels?.[focus.srcIndex] || left
          const rightName = (focus.tile as any)?.labels?.[focus.dstIndex] || right
          setFocus(`Focus Paths: ${leftName} → ${rightName}`)
          setErr(null)
        } catch (e:any) {
          setErr(e?.message || 'Focus Paths failed')
        }
        return
      } else {
        const data = await fetchEdgeDecomposition(personCanonical)
        if (ridLocal !== runIdRef.current) return
        view = buildEdgeDecompositionView(data)
      }
      if (ridLocal !== runIdRef.current || !view) return
      setEdgeDecompView(view)
      setEdgeDecompFacet(null)
      setEdgeDecompMask(null)
      setIntroPathsResult(null)
      setIntroPathsTileMask(null)
      setPeopleSearchMask(null)
      setConnectionsMask(null)
      setCompaniesMask(null)
      setCompareGroups(null)
      setSidebarIndices(null)
      setSelectedRegion(null)
      setNearbyExecs([])
      setSelectedIndex(null)
      setMetaNodes(view.metaNodes as any)
      setLabels(view.labels)

      try {
        const idsForLookup = view.metaNodes
          .map((node: any) => String(node?.id ?? node?.person_id ?? ''))
          .filter((id) => id && /^\d+$/.test(id))
        let chMap = new Map<string, string>()
        if (idsForLookup.length) {
          chMap = await fetchAvatarMap(idsForLookup)
        }
        if (ridLocal !== runIdRef.current) return
        const avatarsNext = new Array(view.tile.count).fill('').map((_, idx) => {
          const node = view.metaNodes[idx] || {}
          const explicit = (node as any).avatar_url || (node as any).avatarUrl
          if (explicit && typeof explicit === 'string') return explicit
          const keyA = String(node?.id ?? '')
          const keyB = String((node as any)?.person_id ?? '')
          if (keyA && chMap.has(keyA)) return chMap.get(keyA) || ''
          if (keyB && chMap.has(keyB)) return chMap.get(keyB) || ''
          return ''
        })
        setAvatars(avatarsNext)
        // Write avatar urls back into the tile meta so CanvasScene can lazy-load images
        try {
          const metaArr: any[] | undefined = (view.tile as any)?.meta?.nodes
          if (Array.isArray(metaArr)){
            const n = Math.min(metaArr.length, avatarsNext.length)
            for (let i=0;i<n;i++){
              const u = avatarsNext[i]
              if (u) { try { (metaArr[i] as any).avatar_url = u } catch {} }
            }
          }
        } catch {}
      } catch (avatarErr) {
        console.warn('AvatarMap(edge decomposition) failed', avatarErr)
        if (ridLocal === runIdRef.current) {
          setAvatars(new Array(view.tile.count).fill(''))
        }
      }

      latestTileRef.current = view.tile as ParsedTile
      try { (view.tile as any).meta.mode = 'person' } catch {}
      sceneRef.current?.setForeground(view.tile as any)
      try { (sceneRef.current as any)?.reshapeLayout?.('hierarchy', { animate: true, ms: 600 }) } catch {}

      const focusLabel = view.center.name || view.center.canonicalId || personCanonical
      setFocus(`Edge Decomposition: ${focusLabel}`)
      setErr(null)

      if (pushHistory) {
        setHistory((h) => {
          const nh = [...h.slice(0, cursor + 1), { id: commandText, move: { x: 0, y: 0 }, turn: 0 }]
          setCursor(nh.length - 1)
          return nh
        })
      }
    } catch (error: any) {
      if (ridLocal === runIdRef.current) {
        clearEdgeDecomposition()
        setErr(error?.message || 'Edge decomposition failed')
      }
    } finally {
      setEdgeDecompLoading(false)
    }
  }

  useEffect(() => {
    if (!edgeDecompView || !edgeDecompFacet) {
      if (edgeDecompMask) setEdgeDecompMask(null)
      return
    }
    const mask = new Array(edgeDecompView.tile.count).fill(false)
    mask[0] = true
    edgeDecompView.edges.forEach((edge) => {
      if (edge.facets.includes(edgeDecompFacet)) {
        mask[edge.source] = true
        mask[edge.target] = true
      }
    })
    setEdgeDecompMask(mask)
  }, [edgeDecompView, edgeDecompFacet])

  async function run(cmd: string, opts?: RunOptions, evaluation?: EvaluationResult | null){
    const rid = ++runIdRef.current
    const pushHistory = opts?.pushHistory !== false;
    const s = cmd.trim();
    if (!s) return;
    if (/^edge\s+decomposition/i.test(s)) {
      const personMatch = s.match(/person\s*:?\s*(\d{3,})/i)
      const userMatch = s.match(/user\s*:?\s*(\d{3,})/i)
      const fallbackMatch = s.match(/\b(\d{3,})\b/)
      const numericId = personMatch?.[1] || userMatch?.[1] || fallbackMatch?.[1]
      if (!numericId) {
        setErr('Edge decomposition requires person:<id>')
        return
      }
      const personCanonical = `person:${numericId}`
      await runEdgeDecompositionCommand(rid, s, personCanonical, pushHistory)
      return
    }
    clearEdgeDecomposition()
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
    if (evaluation) {
      const bridgeHandled = await handleBridgeFromEvaluation(evaluation)
      if (bridgeHandled) {
        if (pushHistory) {
          const commandKey = `bridges ${bridgeHandled.leftId} + ${bridgeHandled.rightId}`
          setHistory((h) => {
            const nh = [...h.slice(0, cursor + 1), { id: commandKey, move: { x: 0, y: 0 }, turn: 0 }]
            setCursor(nh.length - 1)
            return nh
          })
        }
        return
      }
      const compareHandled = await handleCompareFromEvaluation(evaluation)
      if (compareHandled) {
        if (pushHistory) {
          const commandKey = `compare ${compareHandled.leftId} + ${compareHandled.rightId}`
          setHistory((h) => {
            const nh = [...h.slice(0, cursor + 1), { id: commandKey, move: { x: 0, y: 0 }, turn: 0 }]
            setCursor(nh.length - 1)
            return nh
          })
        }
        return
      }
      const migrationHandled = await handleMigrationFromEvaluation(evaluation)
      if (migrationHandled) {
        if (pushHistory) {
          const commandKey = `migration ${migrationHandled.leftId} * ${migrationHandled.rightId}`
          setHistory((h) => {
            const nh = [...h.slice(0, cursor + 1), { id: commandKey, move: { x: 0, y: 0 }, turn: 0 }]
            setCursor(nh.length - 1)
            return nh
          })
        }
        return
      }
      const unsupportedOps = new Set<CruxOperatorToken['op']>(['membership', 'center', 'reweight', 'reach', 'similar'])
      const unsupportedToken = evaluation.expression?.tokens.find(
        (tok) => tok.type === 'operator' && unsupportedOps.has((tok as CruxOperatorToken).op)
      ) as CruxOperatorToken | undefined
      if (unsupportedToken) {
        const label = unsupportedToken.raw || unsupportedToken.op
        setErr(`Operator "${label}" is not implemented yet.`)
        return
      }
    }
    // Algebraic role/icp filters without a leading verb
    // Examples:
    //   person:<id> role:"(engineer|software|sre)" [min:<months>] [top:<n>]
    //   person:<id> -> company:<id> role:"(vp|director|head)" [k:<n>] [min_r_mt:<0-1>]
    if (/(?:\brole:|\bicp:)/i.test(s)){
      try {
        const rest = s.trim()
        const restNoVerb = rest.replace(/^paths\s*/i, '')
        const roleMatch = restNoVerb.match(/(?:role|icp):(\"[^\"]+\"|'[^']+'|[^\s]+)/i)
        const role = roleMatch ? roleMatch[1].replace(/^['"]|['"]$/g,'').trim() : undefined
        const kMatch = restNoVerb.match(/\bk:(\d+)/i); const k = kMatch ? parseInt(kMatch[1],10) : undefined
        const minRmtMatch = restNoVerb.match(/\bmin_r_mt:([0-1](?:\.\d+)?|0?\.\d+)/i); const minRMT = minRmtMatch ? Math.max(0, Math.min(1, parseFloat(minRmtMatch[1]))) : undefined
        const minMatch = restNoVerb.match(/\bmin:(\d+)/i); const minMonths = minMatch ? Math.max(1, parseInt(minMatch[1],10)) : 24
        const topMatch = restNoVerb.match(/\btop:(\d+)/i); const top = topMatch ? Math.max(1, parseInt(topMatch[1],10)) : 80

        const arrowSplit = restNoVerb.split(/\s*->\s*/)
        if (arrowSplit.length === 2) {
          const left = arrowSplit[0].replace(/(?:role|icp):(\"[^\"]+\"|'[^']+'|[^\s]+)/i,'').trim()
          const right = arrowSplit[1].replace(/\bk:\d+|\bmin_r_mt:[0-9.]+|\s*(?:role|icp):(\"[^\"]+\"|'[^']+'|[^\s]+)/ig,'').trim()
          await executeIntroPathsCommand({ S: left, company: right, icp: role, k, minRMT })
          if (pushHistory) { const commandKey = `${left} -> ${right}`; setHistory((h)=>{ const nh=[...h.slice(0,cursor+1), { id: commandKey, move:{x:0,y:0}, turn:0 }]; setCursor(nh.length-1); return nh }) }
        } else {
          // Person-anchored network filter: render tile
          const personId = await ensureEntityId(restNoVerb.replace(/\s*(?:role|icp):(\"[^\"]+\"|'[^']+'|[^\s]+)/i,'').replace(/\bmin:\d+|\btop:\d+/ig,'').trim())
          const result = await fetchNetworkByFilter({ S: personId, roleRegex: role, minOverlapMonths: minMonths, limitFirst: top, limitSecond: Math.max(top, Math.min(600, top * 3)), minSecondMonths: 24 })

          const n1 = result.first.length
          const n2 = result.second.length
          const n = 1 + n1 + n2
          const nodes = new Float32Array(n * 2)
          const size = new Float32Array(n)
          const alpha = new Float32Array(n)
          const group = new Uint16Array(n)
          const edgesArr: Array<[number, number]> = []
          const weights: number[] = []
          const labelsLocal = new Array<string>(n)
          const metaLocal: Array<Record<string, unknown>> = new Array(n)

          // Center
          const pid = personId.replace(/^person:/i,'')
          let centerName = `person:${pid}`
          try { const p = await fetchPersonProfile(pid); if (p?.name) centerName = p.name } catch {}
          nodes[0] = 0; nodes[1] = 0; size[0] = 16; alpha[0] = 1; group[0] = 0
          labelsLocal[0] = centerName
          metaLocal[0] = { id: pid, name: centerName, group: 0 }

          // Place first-degree matches in inner ring
          const R1 = 320
          const m1 = Math.max(1, n1)
          for (let i=0;i<n1;i++){
            const ang = (i / m1) * Math.PI * 2
            const idx = 1 + i
            nodes[idx*2] = Math.cos(ang) * R1 + (Math.random()*2-1)*14
            nodes[idx*2+1] = Math.sin(ang) * R1 + (Math.random()*2-1)*14
            size[idx] = 10; alpha[idx] = 0.95; group[idx] = 1
            const row = result.first[i]
            labelsLocal[idx] = row.name || row.id
            metaLocal[idx] = { id: row.id, name: row.name || row.id, title: row.title || null, group: 1 }
            edgesArr.push([0, idx]); weights.push(Math.max(1, Math.round(Number(row.overlap_months || 0))))
          }

          // Index map for first-degree ids to node index
          const idxOfFirst = new Map<string, number>()
          for (let i=0;i<n1;i++){ idxOfFirst.set(String(result.first[i].id), 1 + i) }

          // Place second-degree matches in outer ring; link to their first-degree anchor
          const start2 = 1 + n1
          const R2 = 560
          const m2 = Math.max(1, n2)
          for (let i=0;i<n2;i++){
            const ang = (i / m2) * Math.PI * 2 + (Math.random()*0.08-0.04)
            const idx = start2 + i
            nodes[idx*2] = Math.cos(ang) * R2 + (Math.random()*2-1)*16
            nodes[idx*2+1] = Math.sin(ang) * R2 + (Math.random()*2-1)*16
            size[idx] = 9; alpha[idx] = 0.92; group[idx] = 2
            const row = result.second[i]
            labelsLocal[idx] = row.name || row.id
            metaLocal[idx] = { id: row.id, name: row.name || row.id, title: row.title || null, group: 2 }
            const fi = idxOfFirst.get(String(row.first_id))
            if (typeof fi === 'number') { edgesArr.push([fi, idx]); weights.push(Math.max(1, Math.round(Number(row.overlap_months || 0)))) }
          }

          const edges = new Uint16Array(edgesArr.length * 2)
          const edgeWeights = new Float32Array(weights.length)
          for (let i=0;i<edgesArr.length;i++){ edges[i*2]=edgesArr[i][0]; edges[i*2+1]=edgesArr[i][1]; edgeWeights[i]=weights[i] }

          const tile: ParsedTile & { labels?: string[], meta?: { nodes: Array<Record<string, unknown>> } } = {
            count: n,
            nodes, size, alpha, group, edges, edgeWeights,
          } as any
          ;(tile as any).labels = labelsLocal
          ;(tile as any).meta = { nodes: metaLocal }
          ;(tile as any).meta.mode = 'person'
          ;(tile as any).focusWorld = { x: 0, y: 0 }

          // Avatars
          const idsForLookup = metaLocal.map((m:any)=> String(m?.id || '')).filter(Boolean)
          let chMap = new Map<string,string>()
          try { if (idsForLookup.length) chMap = await fetchAvatarMap(idsForLookup) } catch {}
          const av = new Array(n).fill('').map((_, i)=>{ const idStr = String((metaLocal[i] as any)?.id || ''); return (idStr && chMap.has(idStr)) ? chMap.get(idStr)! : '' })
          setAvatars(av)
          try { (tile as any)?.meta?.nodes?.forEach((m:any, idx:number)=>{ const u = av[idx]; if (u) m.avatar_url = u }) } catch {}

          latestTileRef.current = tile as ParsedTile
          setErr(null)
          setLabels(labelsLocal)
          setMetaNodes(metaLocal as any)
          setSidebarOpen(true)
          sceneRef.current?.setForeground(tile as any)

          const summary = `${result.matched}/${result.total} matched (${(result.share * 100).toFixed(1)}%) | 1°:${n1} 2°:${n2}`
          setFocus(`person:${pid} • ${summary}`)
          try { (sceneRef.current as any)?.focusIndex?.(0, { animate: true, ms: 460, zoom: 1.6 }) } catch {}
        }
      } catch (e:any) {
        setErr(e?.message || 'role/icp query failed')
      }
      return
    }

    // Intro Paths: "paths <personId> -> <companyId> [icp:<regex>] [k:<n>]"
    if (/^paths\b/i.test(s)){
      try {
        const rest = s.replace(/^paths\s*/i, '')
        // Extract icp and k filters
        const icpMatch = rest.match(/icp:([^\s]+(?:\s[^k]+)?)$/i)
        const kMatch = rest.match(/\bk:(\d+)/i)
        const icp = icpMatch ? icpMatch[1].trim() : undefined
        const cleaned = rest.replace(/icp:[^\n]+/i,'').trim()
        const arrowSplit = cleaned.split(/\s*->\s*/)
        if (arrowSplit.length !== 2) { setErr('paths syntax: paths person:<id> -> company:<id> icp:<regex> k:<n>'); return }
        const left = arrowSplit[0].trim()
        const right = arrowSplit[1].replace(/\bk:\d+/i,'').trim()
        await executeIntroPathsCommand({ S: left, company: right, icp, k: kMatch ? parseInt(kMatch[1], 10) : undefined })
        if (pushHistory) {
          const commandKey = `paths ${left} -> ${right}`
          setHistory((h)=>{ const nh=[...h.slice(0,cursor+1), { id: commandKey, move: { x:0, y:0 }, turn: 0 }]; setCursor(nh.length-1); return nh })
        }
      } catch (e:any) {
        const step = (e && e.step) || 'unknown'
        const code = (e && e.code) || 'ERR'
        setErr(`Failed at ${step}: ${code} — ${e?.message || 'paths failed'}`)
      }
      return
    }

    // Bridges mode: "bridges <companyA> + <companyB>"
    if (/^bridges\b/i.test(s)) {
      const raw = s.replace(/^bridges\s*/i, '')
      const parts = raw.split('+').map(t => t.trim()).filter(Boolean)
      if (parts.length !== 2) { setErr('Bridges expects two companies, e.g. "bridges Acme + Globex"'); return }
      try {
        const result = await executeBridgeCommand({ left: parts[0], right: parts[1], limit: 180 })
        if (pushHistory) {
          const commandKey = `bridges ${result.leftId} + ${result.rightId}`
          setHistory((h)=>{ const nh=[...h.slice(0,cursor+1), { id: commandKey, move: { x:0, y:0 }, turn: 0 }]; setCursor(nh.length-1); return nh })
        }
      } catch (e:any) {
        const step = (e && e.step) || 'unknown'
        const code = (e && e.code) || 'ERR'
        setErr(`Failed at ${step}: ${code} — ${e?.message || 'bridges failed'}`)
        return
      }
      return
    }
    if (/\*/.test(s) || /^migration\b/i.test(s)) {
      const cleaned = s.replace(/^migration\s*/i, '')
      const parts = cleaned.split(/\s*\*\s*/).filter(Boolean)
      if (parts.length !== 2) { setErr('Migration expects two companies, e.g. "Acme * Globex"'); return }
      try {
        const result = await executeMigrationCommand({ left: parts[0], right: parts[1] })
        if (pushHistory) {
          const commandKey = `migration ${result.leftId} * ${result.rightId}`
          setHistory((h)=>{ const nh=[...h.slice(0,cursor+1), { id: commandKey, move: { x:0, y:0 }, turn: 0 }]; setCursor(nh.length-1); return nh })
        }
      } catch (e:any) {
        const step = (e && e.step) || 'unknown'
        const code = (e && e.code) || 'ERR'
        setErr(`Failed at ${step}: ${code} — ${e?.message || 'migration failed'}`)
      }
      return
    }
    // Compare mode: "<a> + <b>" or "compare <a> + <b>"
    if (/>\s*<|\+/.test(s)) {
      await runCompare(s, { pushHistory });
      return;
    }
    // disable heuristic compare suggestions in strict mode
    const m = /^show\s+(.+)$/.exec(s);
    let id = (m ? m[1] : s).trim();
    // Strict: only canonical ids allowed
    if (!/^(company|person):\d+$/i.test(id)) { setErr('Provide canonical company:<id> or person:<id>'); return }
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
        const ids = (metaNodes || []).map((n:any)=> String(n?.id ?? n?.person_id ?? ''))
        let chMap = new Map<string,string>()
        try {
          if (ids.length) {
            console.log('AvatarMap(person) request ids sample:', ids.slice(0,10))
            chMap = await fetchAvatarMap(ids)
            try { console.log('AvatarMap(person): ids', ids.length, 'mapped', chMap.size, 'sample', Array.from(chMap.entries()).slice(0,4)) } catch {}
          }
        } catch (e) { console.warn('AvatarMap(person) failed', e) }
        const av = new Array(tile.count).fill('').map((_, i)=>{
          const m:any = metaNodes?.[i] || {}
          const exp = (m?.avatar_url || m?.avatarUrl) as string | undefined
          if (exp) return exp
          const idStr = String(m?.id ?? m?.person_id ?? '')
          const fromCH = (idStr && chMap.has(idStr)) ? chMap.get(idStr)! : ''
          if (fromCH) return fromCH
          return ''
        })
        setAvatars(av)
        try {
          if ((tile as any)?.meta?.nodes) {
            (tile as any).meta.mode = 'person'
            ;(tile as any).meta.nodes.forEach((n:any, idx:number)=>{ const u = av[idx]; if (u) n.avatar_url = u })
            latestTileRef.current = tile as any
          }
        } catch {}
      } catch {}

      // Centralize spawn in CanvasScene: no App-level offset. Mark spawn as zero and record zero move in history.
      try {
        if (tile?.nodes && typeof tile.nodes.length === 'number'){
          ;(tile as any).spawn = { x: 0, y: 0 }
          try { (tile as any).focusWorld = { x: tile.nodes[0], y: tile.nodes[1] } } catch {}
          if (pushHistory) {
            const usedMove = { x: 0, y: 0 }
            setHistory(h=>{ const nh=[...h.slice(0,cursor+1), { id, move: usedMove, turn: opts?.turnRadians || 0 }]; setCursor(nh.length-1); return nh })
          }
        }
      } catch {}

      try {
        latestTileRef.current = tile as ParsedTile
        if (rid === runIdRef.current) sceneRef.current?.setForeground(tile as any);
      } catch {}
      // If person: preload profile and open profile panel
      try {
        if (/^person:\d+$/i.test(id)) {
          const pid = id.replace(/^person:/i, '')
          const p = await fetchPersonProfile(pid)
          if (p) { setProfile(p); setProfileOpen(true) }
        } else { setProfile(null); setProfileOpen(false) }
      } catch {}
    } catch (e: any) {
      const step = (e && e.step) || 'unknown'
      const code = (e && e.code) || 'ERR'
      setErr(`Failed at ${step}: ${code} — ${e?.message || "fetch failed"}`);
    }
  }

  // Strict mode: suggestion heuristic removed
  // Canonicalize an entity id for the currently loaded tile + index (mirrors CanvasScene dblclick)
  function canonicalIdForIndex(i: number): string | null {
    try {
      const t: any = latestTileRef.current as any
      if (!t || !Array.isArray((t as any)?.meta?.nodes)) return null
      const meta = (t as any).meta.nodes?.[i] || {}
      const mode = (t as any)?.meta?.mode as string | undefined
      const grp = (Array.isArray((t as any)?.group) ? (t as any).group[i] : (t as any)?.group?.[i])
      const prefer = (keys: string[]) => {
        for (const k of keys) { const v = meta?.[k]; if (v != null && String(v).trim() !== '') return String(v) }
        return null
      }
      // Choose best raw id
      let raw: string | null = prefer(['id', 'person_id', 'linkedin_id', 'handle'])
      if (!raw) return null
      // Normalize purely numeric ids
      if (/^\d+$/.test(raw)) {
        if (mode === 'graph') return (grp === 1) ? `person:${raw}` : `company:${raw}`
        if (mode === 'company') return `person:${raw}`
        if (mode === 'person') return `person:${raw}`
        return `person:${raw}`
      }
      // If already canonical like person:123 / company:123
      if (/^(company|person):\d+$/i.test(raw)) return raw.toLowerCase()
      return null
    } catch { return null }
  }

  function intersectCount(a:Set<string>, b:Set<string>){ let k=0; for (const x of a) if (b.has(x)) k++; return k }
  function diffCount(a:Set<string>, b:Set<string>){ let k=0; for (const x of a) if (!b.has(x)) k++; return k }

  // --- Compare Mode Implementation ---
  function nodeIdFor(tile: any, i: number): string {
    const meta = tile?.meta?.nodes?.[i]
    const raw = meta?.id ?? meta?.person_id ?? meta?.linkedin_id ?? meta?.handle ?? tile?.labels?.[i]
    const val = String(raw ?? i)
    const lower = val.toLowerCase()
    if (/^person:\d+$/i.test(lower)) return lower
    if (/^company:\d+$/i.test(lower)) return lower
    if (/^(linkedin|http)/i.test(lower)) return lower
    if (/^\d+$/.test(lower)) return `person:${lower}`
    return lower
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
          if (Number.isFinite(w) && w >= (opts?.minYears ?? 24)) keep = true
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
      if (w >= Math.max(24, minFirstMonths)){ neighbors24[a].push(b); neighbors24[b].push(a) }
      if (w >= Math.max(24, minSecondMonths)){ neighbors36[a].push(b); neighbors36[b].push(a) }
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
    // Compute degree sets
    const degA = degreesForDual(a, MIN_OVERLAP_MONTHS, MIN_OVERLAP_MONTHS)
    const degB = degreesForDual(b, MIN_OVERLAP_MONTHS, MIN_OVERLAP_MONTHS)
    const mapA = buildIdLabelMap(a as any)
    const mapB = buildIdLabelMap(b as any)
    const mutualF1 = Array.from(degA.firstIds).filter(id => degB.firstIds.has(id))
    const mutualF2 = Array.from(degA.secondIds).filter(id => degB.secondIds.has(id))
    const aF1_bF2 = Array.from(degA.firstIds).filter(id => degB.secondIds.has(id) && !degB.firstIds.has(id))
    const bF1_aF2 = Array.from(degB.firstIds).filter(id => degA.secondIds.has(id) && !degA.firstIds.has(id))
    const aOnly = Array.from(new Set<string>([...degA.firstIds, ...degA.secondIds])).filter(id => !degB.firstIds.has(id) && !degB.secondIds.has(id))
    const bOnly = Array.from(new Set<string>([...degB.firstIds, ...degB.secondIds])).filter(id => !degA.firstIds.has(id) && !degA.secondIds.has(id))
    try { console.log('compare category sizes (tree)', { mutualF1: mutualF1.length, mutualF2: mutualF2.length, aF1_bF2: aF1_bF2.length, bF1_aF2: bF1_aF2.length, aOnly: aOnly.length, bOnly: bOnly.length }) } catch {}

    const totalCats = degA.first.length + degA.second.length + degB.first.length + degB.second.length
    if (totalCats === 0) { try { setErr('No work-overlap edges (>=24 months) found for either ego.'); } catch {} }

    const labelFor = (id: string) => mapA.get(id) || mapB.get(id) || id
    const hash01 = (s: string) => { let h = 2166136261 >>> 0; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 } return (h % 100000) / 100000 }

    // Geometry for tree layout
    const baseCY = 260
    const leftCX = -200
    const rightCX = 200
    const trunkLen = 230
    const topY = baseCY - trunkLen - 60
    const midCX = 0
    // Bands (rects) for placing nodes deterministically
    const band = (x1:number,x2:number,y1:number,y2:number,id:string)=>({
      x: x1 + (x2-x1) * hash01(id),
      y: y1 + (y2-y1) * hash01(id + ':y')
    })

    const nodes: number[] = []
    const size: number[] = []
    const alpha: number[] = []
    const labels: string[] = []
    const groups: number[] = []
    const indexGroups = { left: [] as number[], right: [] as number[], overlap: [] as number[] }
    const lists = { mutualF1: [] as number[], aF1_bF2: [] as number[], bF1_aF2: [] as number[], aOnly: [] as number[], bOnly: [] as number[] } as any
    const regionToGroup: Record<'left'|'right'|'overlap', number> = { left: 0, overlap: 1, right: 2 }
    const seenIds = new Set<string>()

    // Anchor people at the top of each tree
    const centerAId = nodeIdFor(a as any, 0)
    const centerBId = nodeIdFor(b as any, 0)
    seenIds.add(centerAId); seenIds.add(centerBId)
    nodes.push(leftCX, topY)
    size.push(14); alpha.push(1.0); labels.push(labelFor(centerAId))
    groups.push(regionToGroup.left)
    nodes.push(rightCX, topY)
    size.push(14); alpha.push(1.0); labels.push(labelFor(centerBId))
    groups.push(regionToGroup.right)

    // Selection limits: default ~18 nodes with ~65% overlaps
    const pickK = (ids: string[], k: number): string[] => {
      if (!Array.isArray(ids) || ids.length === 0 || k >= ids.length) return [...ids]
      const arr = [...ids].sort((a,b)=> hash01(a) - hash01(b))
      return arr.slice(0, Math.max(0, k))
    }
    const TARGET_TOTAL = 18
    const overlapTarget = Math.max(4, Math.round(TARGET_TOTAL * 0.65))
    const uniqueTarget = Math.max(2, TARGET_TOTAL - overlapTarget)
    const leftUniqueTarget = Math.floor(uniqueTarget/2)
    const rightUniqueTarget = uniqueTarget - leftUniqueTarget
    // Build prioritized overlap slate
    const overlapSelected: string[] = []
    const takeInto = (src: string[], k: number) => { const want = Math.max(0, k); const add = pickK(src.filter(id=>!overlapSelected.includes(id)), want); overlapSelected.push(...add) }
    takeInto(mutualF1, Math.min(mutualF1.length, Math.round(overlapTarget * 0.6)))
    if (overlapSelected.length < overlapTarget) takeInto(aF1_bF2, Math.round((overlapTarget - overlapSelected.length) * 0.5))
    if (overlapSelected.length < overlapTarget) takeInto(bF1_aF2, overlapTarget - overlapSelected.length)
    if (overlapSelected.length < overlapTarget) takeInto(mutualF2, overlapTarget - overlapSelected.length)
    // Unique picks
    const aOnlySelected = pickK(aOnly, leftUniqueTarget)
    const bOnlySelected = pickK(bOnly, rightUniqueTarget)
    // If still under target (rare), backfill from remaining pools
    let deficit = TARGET_TOTAL - (2 + overlapSelected.length + aOnlySelected.length + bOnlySelected.length)
    if (deficit > 0) {
      const pools = [
        mutualF1.filter(id=>!overlapSelected.includes(id)),
        aF1_bF2.filter(id=>!overlapSelected.includes(id)),
        bF1_aF2.filter(id=>!overlapSelected.includes(id)),
        mutualF2.filter(id=>!overlapSelected.includes(id)),
        aOnly.filter(id=>!aOnlySelected.includes(id)),
        bOnly.filter(id=>!bOnlySelected.includes(id)),
      ]
      for (const pool of pools){
        if (deficit <= 0) break
        const add = pickK(pool, Math.min(deficit, Math.ceil(deficit/2)))
        overlapSelected.push(...add)
        deficit = TARGET_TOTAL - (2 + overlapSelected.length + aOnlySelected.length + bOnlySelected.length)
      }
    }

    // Helper to place ids into a rectangular band with deterministic jitter
    const placeBand = (idsIn: string[], x1:number,x2:number,y1:number,y2:number, opts:{ base:number, bg:number, region:'left'|'right'|'overlap', listKey?: string }) => {
      const ids = idsIn.filter(id=>{ if (seenIds.has(id)) return false; seenIds.add(id); return true })
      const strongEvery = Math.max(1, Math.floor(ids.length / Math.max(1, Math.ceil(ids.length * 0.28))))
      for (let i=0;i<ids.length;i++){
        const id = ids[i]
        const p = band(x1,x2,y1,y2,id)
        nodes.push(p.x, p.y)
        const strong = (i % strongEvery) === 0
        size.push(strong ? opts.base : opts.bg)
        alpha.push(strong ? 0.88 : 0.2)
        labels.push(labelFor(id))
        groups.push(regionToGroup[opts.region])
        const idx = (nodes.length/2)-1
        indexGroups[opts.region].push(idx)
        if (opts.listKey) { (lists as any)[opts.listKey].push(idx) }
      }
    }

    // Layout bands
    const leftOuterX1 = leftCX - 320, leftOuterX2 = leftCX - 60
    const rightOuterX1 = rightCX + 60, rightOuterX2 = rightCX + 320
    const outerY1 = topY + trunkLen * 0.35, outerY2 = baseCY + 180
    const midX1 = -120, midX2 = 120
    const midY1 = topY + trunkLen * 0.55, midY2 = baseCY + 60
    const crossLeftX1 = -180, crossLeftX2 = -20
    const crossRightX1 = 20, crossRightX2 = 180

    // Unique near outer roots (limited)
    placeBand(aOnlySelected, leftOuterX1, leftOuterX2, topY + trunkLen*0.35, baseCY + 180, { base: 4.8, bg: 1.0, region: 'left', listKey: 'aOnly' })
    placeBand(bOnlySelected, rightOuterX1, rightOuterX2, topY + trunkLen*0.35, baseCY + 180, { base: 4.8, bg: 1.0, region: 'right', listKey: 'bOnly' })
    // Overlap/bridge area in the middle (limited prioritized set)
    const selMutualF1 = overlapSelected.filter(id=>mutualF1.includes(id))
    const selAF1B2 = overlapSelected.filter(id=>aF1_bF2.includes(id))
    const selBF1A2 = overlapSelected.filter(id=>bF1_aF2.includes(id))
    const selMutualF2 = overlapSelected.filter(id=>mutualF2.includes(id))
    placeBand(selMutualF1, midX1, midX2, midY1, midY2, { base: 5.2, bg: 1.2, region: 'overlap', listKey: 'mutualF1' })
    placeBand(selAF1B2, crossLeftX1, crossLeftX2, midY1, midY2, { base: 4.6, bg: 1.0, region: 'overlap', listKey: 'aF1_bF2' })
    placeBand(selBF1A2, crossRightX1, crossRightX2, midY1, midY2, { base: 4.6, bg: 1.0, region: 'overlap', listKey: 'bF1_aF2' })
    placeBand(selMutualF2, midX1+10, midX2-10, baseCY + 40, baseCY + 140, { base: 3.8, bg: 0.9, region: 'overlap' })

    const out: ParsedTile = { count: nodes.length/2, nodes: new Float32Array(nodes), size: new Float32Array(size), alpha: new Float32Array(alpha), group: new Uint16Array(groups) } as any
    ;(out as any).labels = labels
    ;(out as any).compareIndexGroups = indexGroups
    ;(out as any).compareLists = lists
    // Keep existing compareOverlay contract for hit tests; colors emphasize overlap when highlighted
    const r1 = 200, r2 = 360
    ;(out as any).compareOverlay = { regions:{ left:{ cx:-160, cy:baseCY, r1, r2 }, right:{ cx:160, cy:baseCY, r1, r2 }, overlap:{ cx:0, cy:baseCY, r1, r2 } }, colors:{ leftFirst:'rgba(122,110,228,0.30)', leftSecond:'rgba(122,110,228,0.18)', rightFirst:'rgba(122,110,228,0.30)', rightSecond:'rgba(122,110,228,0.18)', overlapFirst: opts?.highlight==='overlap' ? 'rgba(255,195,130,0.34)' : 'rgba(255,195,130,0.26)', overlapSecond: opts?.highlight==='overlap' ? 'rgba(255,195,130,0.22)' : 'rgba(255,195,130,0.16)' } }
    ;(out as any).focusWorld = { x: midCX, y: baseCY }
    ;(out as any).meta = { mode: 'person' }
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

  async function runCompare(raw: string, opts?: { pushHistory?: boolean }){
    const pushHistory = opts?.pushHistory !== false
    try {
      const cleaned = raw.replace(/^compare\s*/i, '').trim()
      const parts = cleaned.split(/\s*(?:\+|><)\s*/).filter(Boolean)
      if (parts.length !== 2) { setErr('Compare expects exactly two ids, e.g. "Alice + Bob"'); return }
      const [leftRaw, rightRaw] = parts
      const result = await executeCompareCommand({ left: leftRaw, right: rightRaw })
      if (pushHistory) {
        const commandKey = `compare ${result.leftId} + ${result.rightId}`
        setHistory((h)=>{ const nh=[...h.slice(0,cursor+1), { id: commandKey, move: { x:0, y:0 }, turn: 0 }]; setCursor(nh.length-1); return nh })
      }
    } catch (e:any) {
      setErr(e?.message || 'compare failed')
    }
  }

  // Region click handling in compare mode
  async function onRegionClick(region: 'left'|'right'|'overlap'){
    try {
      const ids = lastCompareIdsRef.current
      if (!ids) return
      const [{ tile: aTile }, { tile: bTile }] = await Promise.all([loadTileSmart(ids.a), loadTileSmart(ids.b)])
      applyCompareTiles({
        leftId: ids.a,
        rightId: ids.b,
        leftTile: aTile as ParsedTile,
        rightTile: bTile as ParsedTile,
        highlight: region,
        selectedRegion: region,
        autoFocus: false,
        focusLabel: focus || undefined,
      })
    } catch {}
  }

  // Left-arrow: recenter on selected node → load that person's ego and rotate background
  useEffect(()=>{
    const onKey = (e: KeyboardEvent)=>{
      const active = document.activeElement as HTMLElement | null
      const isTyping = !!(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as any)?.isContentEditable))
      const tileMode = (()=>{ try { return (latestTileRef.current as any)?.meta?.mode || null } catch { return null } })()
      // remove: '1' key profile HUD toggle
      if (e.key === 'ArrowDown' && typeof selectedIndex === 'number') setSelectedIndex((prev)=>{
        const cur = (typeof prev === 'number' ? prev : 0)
        return (cur + 1) % metaNodes.length
      })
      if (e.key === 'ArrowUp' && typeof selectedIndex === 'number') setSelectedIndex((prev)=>{
        const cur = (typeof prev === 'number' ? prev : 0)
        return (cur - 1 + metaNodes.length) % metaNodes.length
      })
      // Company mode: Left Arrow spawns selected person's ego (quick handoff)
      if (e.key === 'ArrowLeft') {
        if (tileMode === 'company') {
          if (isTyping) return
          if (typeof selectedIndex !== 'number' || selectedIndex < 0) return
          const idCanon = canonicalIdForIndex(selectedIndex)
          if (!idCanon || !/^person:\d+$/i.test(idCanon)) return
          // Skip if center (company) is selected
          if (selectedIndex === 0) return
          run(`show ${idCanon}`)
          const radians = (Math.random() > 0.5 ? 1 : -1) * (Math.PI/2)
          window.dispatchEvent(new CustomEvent('graph_turn', { detail: { radians } }))
          return
        } else if (typeof selectedIndex === 'number') {
          // Default behavior: move focus to next node
        setSelectedIndex((prev)=>{
          const next = ((typeof prev === 'number' ? prev : 0) + 1) % metaNodes.length
          ;(sceneRef.current as any)?.focusIndex?.(next, { zoom: 0.9 })
          return next
        })
        }
      }
      // Spawn selected person's graph with Right Arrow (was Left Arrow)
      if (e.key === 'ArrowRight') {
        if (isTyping) return
        if (typeof selectedIndex !== 'number' || selectedIndex < 0) return
        const idCanon = canonicalIdForIndex(selectedIndex)
        if (!idCanon || !/^person:\d+$/i.test(idCanon)) return
        run(`show ${idCanon}`)
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
      // ESC: close Top Paths / Nearby panel if open
      if (e.key === 'Escape') {
        if (introPathsResult) { clearIntroPanels(); return }
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
    <div className="w-full h-full" style={{ background: "var(--dt-bg)", color: "var(--dt-text)", position:'fixed', inset:0, overflow:'hidden' }}>
      {rendererMode === 'canvas' ? (
        <CanvasScene
          ref={handleSceneRef}
          concentric={concentric}
          selectedIndex={selectedIndex}
          visibleMask={visibleMask}
          maskMode={maskMode}
          degreeHighlight={degreeHighlight}
          onUnselect={()=> setSelectedIndex(null)}
          onPick={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate:true, ms:520, zoomMultiplier: 6 }); }}
          onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }}
          onStats={(_,count)=>{ setNodeCount(count) }}
          onRegionClick={onRegionClick}
        />
      ) : rendererMode === 'cosmograph' ? (
        <CosmoScene
          ref={handleSceneRef}
          concentric={concentric}
          selectedIndex={selectedIndex}
          visibleMask={visibleMask}
          maskMode={maskMode}
          onUnselect={()=> setSelectedIndex(null)}
          onPick={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate:true, ms:520, zoomMultiplier: 6 }); }}
          onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }}
          onStats={(_,count)=>{ setNodeCount(count) }}
          onRegionClick={onRegionClick}
        />
      ) : (
        <GpuScene
          ref={handleSceneRef}
          concentric={concentric}
          selectedIndex={selectedIndex}
          visibleMask={visibleMask}
          maskMode={maskMode}
          degreeHighlight={degreeHighlight}
          onUnselect={()=> setSelectedIndex(null)}
          onPick={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate:true, ms:520, zoomMultiplier: 6 }); }}
          onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }}
          onStats={(_,count)=>{ setNodeCount(count) }}
          onRegionClick={onRegionClick}
        />
      )}

      {edgeDecompView && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            zIndex: 32,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxWidth: 420,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--dt-bg-elev-2)',
              border: '1px solid var(--dt-border)',
              borderRadius: 12,
              padding: '10px 12px',
              boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.15 }}>Edge Decomposition</div>
              <div style={{ fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {edgeDecompView.center.name || edgeDecompView.center.canonicalId || `person:${edgeDecompView.center.id}`}
              </div>
              {edgeDecompView.center.company && (
                <div style={{ fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {edgeDecompView.center.company}
                </div>
              )}
            </div>
        <button
              className="no-drag"
              onClick={clearEdgeDecomposition}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                borderRadius: 8,
                border: '1px solid var(--dt-border)',
                background: 'var(--dt-fill-weak)',
                color: 'var(--dt-text)',
                cursor: 'pointer',
              }}
            >
              Close
        </button>
      </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="no-drag"
              onClick={() => setEdgeDecompFacet(null)}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: '1px solid var(--dt-border)',
                background: edgeDecompFacet === null ? 'var(--dt-fill-med)' : 'rgba(0,0,0,0.55)',
                color: edgeDecompFacet === null ? 'var(--dt-text)' : 'rgba(255,255,255,0.6)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              All
            </button>
            {edgeDecompView.facets.map((facet) => {
              const active = edgeDecompFacet === facet.key
              const color = facet.color || '#60a5fa'
              return (
                <button
                  key={facet.key}
                  className="no-drag"
                  onClick={() => setEdgeDecompFacet(active ? null : facet.key)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: `1px solid ${color}`,
                    background: active ? color : 'rgba(0,0,0,0.65)',
                    color: active ? '#050505' : color,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <span>{facet.label}</span>
                  <span style={{ fontSize: 11, opacity: active ? 0.75 : 0.8 }}>{facet.count}</span>
                </button>
              )
            })}
          </div>

          <div
            style={{
              background: 'var(--dt-bg-elev-2)',
              border: '1px solid var(--dt-border)',
              borderRadius: 12,
              padding: '10px 12px',
              boxShadow: '0 8px 18px rgba(0,0,0,0.32)',
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            {(()=>{
              const direct = edgeDecompView.neighbors.filter(n=> (n as any).distance !== 2)
              const intro = edgeDecompView.neighbors.filter(n=> (n as any).distance === 2)
              const renderItem = (neighbor: any) => {
                const months = neighbor.overlapDays ? Math.round(neighbor.overlapDays / 30) : 0
                return (
                  <button
                    key={`${neighbor.id}-${neighbor.index}`}
                    className="no-drag"
                    onClick={() => {
                      setSelectedIndex(neighbor.index)
                      try { (sceneRef.current as any)?.focusIndex?.(neighbor.index, { animate: true, ms: 520, zoomMultiplier: 7 }) } catch {}
                    }}
                    style={{
                      textAlign: 'left',
                      border: '1px solid var(--dt-border)',
                      borderRadius: 10,
                      background: 'rgba(0,0,0,0.55)',
                      padding: '8px 10px',
                      fontSize: 12,
                      color: 'var(--dt-text)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {neighbor.name || neighbor.company || neighbor.id}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {neighbor.title || neighbor.company || '—'}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ opacity: 0.75 }}>{months}m shared</span>
                      {(neighbor.facets || []).slice(0, 2).map((facet: string) => (
                        <span key={facet} style={{ opacity: 0.65 }}>{facet}</span>
                      ))}
                      {(neighbor as any).distance === 2 && typeof (neighbor as any).viaIndex === 'number' && (
                        <span style={{ opacity: 0.75 }}>via {labels[(neighbor as any).viaIndex as number] || '—'}</span>
                      )}
                    </div>
                  </button>
                )
              }
              return (
                <div style={{ display:'grid', gap:8 }}>
                  {direct.length>0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px 0', letterSpacing: 0.15 }}>1️⃣ Direct connections</div>
                      <div style={{ display:'grid', gap:6 }}>{direct.slice(0,6).map(renderItem)}</div>
                    </div>
                  )}
                  {intro.length>0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 6px 0', letterSpacing: 0.15 }}>2️⃣ Introducers</div>
                      <div style={{ display:'grid', gap:6 }}>{intro.slice(0,6).map(renderItem)}</div>
                    </div>
                  )}
                  {direct.length===0 && intro.length===0 && (
                    <div style={{ fontSize: 11, opacity: 0.68 }}>No connections in 1–2 hops.</div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {edgeDecompLoading && !edgeDecompView && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            zIndex: 32,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--dt-border)',
            background: 'rgba(0,0,0,0.65)',
            color: 'var(--dt-text)',
            fontSize: 12,
          }}
        >
          Loading edge decomposition…
        </div>
      )}

      {/* Controls moved into SideDrawer > Settings */}
      {(()=>{
        // SideDrawer scaffolding: tabs and pluggable content. For now, keep a "Nodes" tab
        const items = (sidebarIndices ? sidebarIndices : Array.from({length: Math.max(0,nodeCount)},(_,i)=>i))
          .map((i)=>({
            index:i,
            group:(i%8),
            name: labels[i],
            title: (metaNodes[i] as any)?.title || (metaNodes[i] as any)?.job_title || (metaNodes[i] as any)?.headline || (metaNodes[i] as any)?.role || (metaNodes[i] as any)?.position || null,
            avatarUrl: avatars[i]
          }))
        const getScene = ()=> sceneRef.current
        const getTile = ()=> latestTileRef.current
        const lastCommand = (()=>{ try{ return history.length ? history[cursor]?.id || history[history.length-1]?.id || null : null } catch { return null } })()
        const tabs = [
          { id:'overview', label:'Overview', render: ()=> (
            <div>
              <div style={{ fontSize:13, marginBottom:8, color:'var(--dt-text-dim)' }}>Overview</div>
              <div style={{ fontSize:11, color:'var(--dt-text-dim)', marginBottom:8 }}>Compare overview: {compareGroups ? 'compareGroups set' : 'compareGroups null'} | lists {compareLists ? 'present' : 'null'}</div>
              {(() => {
                const comp: any = latestTileRef.current as any
                const cg = compareGroups || (comp && comp.compareIndexGroups) || null
                const lists = compareLists || comp?.compareLists || null
                if (cg && lists) {
                  return (
                    <div>
                      <div style={{ fontSize:11, color:'var(--dt-text-dim)', marginBottom:6 }}>Debug · shared:{lists.mutualF1.length} a1∩b2:{lists.aF1_bF2.length} a2∩b1:{lists.bF1_aF2.length} a-only:{lists.aOnly.length} b-only:{lists.bOnly.length}</div>
                      <CompareLists
                        labels={labels}
                        metaNodes={metaNodes as any}
                        groups={{ ...(cg as any), lists: lists as any }}
                        onFocusIndex={(i)=> setSelectedIndex(i)}
                      />
                    </div>
                  )
                }
                return <div style={{ fontSize:12, color:'var(--dt-text-dim)', padding:'8px 0' }}>No compare breakdown yet. Run compare A + B.</div>
              })()}
            </div>
          ), disabled: false },
          { id:'connections', label:'Connections', badge: (function(){
              try {
                const t:any = (latestTileRef.current as any)
                if (!t || (t?.meta?.mode !== 'person')) return undefined
                // rough count from current sliders via TabConnections callback memo
                const el = document.getElementById('connections-badge-proxy') as any
                const v = el && el.getAttribute ? el.getAttribute('data-count') : null
                return v ? Number(v) : undefined
              } catch { return undefined }
            })(), render: ()=> (
            <div>
              <div style={{ fontSize:13, marginBottom:8, color:'var(--dt-text-dim)', letterSpacing:0.2 }}>1st/2nd Degree</div>
              <TabConnections
                labels={labels}
                metaNodes={metaNodes as any}
                getTile={()=> latestTileRef.current}
                onMask={(mask)=> setConnectionsMask(mask)}
                onFocusIndex={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate:true, ms:520, zoomMultiplier: 8 }); }}
                onSetMaskMode={(m)=> setMaskMode(m)}
                onSetDegreeHighlight={(d)=> setDegreeHighlight(d)}
                onCountsChange={(f,s)=>{
                  try {
                    let el = document.getElementById('connections-badge-proxy')
                    if (!el) {
                      el = document.createElement('div')
                      el.id = 'connections-badge-proxy'
                      el.style.display = 'none'
                      document.body.appendChild(el)
                    }
                    el.setAttribute('data-count', String( (Number(f||0) + Number(s||0)) ))
                  } catch {}
                }}
              />
            </div>
          ), disabled: false },
          { id:'search', label:'Search', render: ()=> (
            <div>
              <div style={{ fontSize:13, marginBottom:8, color:'var(--dt-text-dim)', letterSpacing:0.2 }}>People Search</div>
              <TabPeople
                labels={labels}
                metaNodes={metaNodes as any}
                onMask={(mask)=> setPeopleSearchMask(mask)}
                onSetMaskMode={(m)=> setMaskMode(m)}
                onFocusIndex={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate: true, ms: 520, zoomMultiplier: 8 }); }}
              />
            </div>
          ), disabled: false },
          { id:'companies', label:'Companies', render: ()=> (
            <div>
              <div style={{ fontSize:13, marginBottom:8, color:'var(--dt-text-dim)', letterSpacing:0.2 }}>Membership Companies</div>
              <TabCompanies
                labels={labels}
                metaNodes={metaNodes as any}
                onMask={(mask)=> setCompaniesMask(mask)}
                onFocusIndex={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate: true, ms: 520, zoomMultiplier: 8 }); }}
                onSetMaskMode={(m)=> setMaskMode(m)}
              />
            </div>
          ), disabled: false },
          { id:'paths', label:'Paths', render: ()=> (
            <div style={{ color:'var(--dt-text-dim)', fontSize:13 }}>Intro paths controls coming soon.</div>
          ), disabled: false },
          { id:'compare', label:'Compare', render: ()=> (
            <div style={{ color:'var(--dt-text-dim)', fontSize:13 }}>Compare groups browser coming soon.</div>
          ), disabled: false },
          { id:'settings', label:'Settings', render: ()=> (
            <div style={{ display:'grid', gap:12, minWidth: 360 }}>
              <div>
                <div style={{ fontSize:12, color:'var(--dt-text-dim)', marginBottom:4 }}>Renderer</div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={()=> setRendererMode('canvas')} style={{ padding:'6px 10px', fontSize:12, border:'1px solid var(--dt-border)', borderRadius:6, background: rendererMode==='canvas' ? 'var(--dt-fill-strong)' : 'var(--dt-fill-weak)', color:'var(--dt-text)' }}>Canvas</button>
                  <button onClick={()=> setRendererMode('cosmograph')} style={{ padding:'6px 10px', fontSize:12, border:'1px solid var(--dt-border)', borderRadius:6, background: rendererMode==='cosmograph' ? 'var(--dt-fill-strong)' : 'var(--dt-fill-weak)', color:'var(--dt-text)' }}>Cosmograph</button>
                  <button onClick={()=> setRendererMode('gpu')} style={{ padding:'6px 10px', fontSize:12, border:'1px solid var(--dt-border)', borderRadius:6, background: rendererMode==='gpu' ? 'var(--dt-fill-strong)' : 'var(--dt-fill-weak)', color:'var(--dt-text)' }}>GPU</button>
                </div>
              </div>
              <div>
                <div style={{ fontSize:12, color:'var(--dt-text-dim)', marginBottom:4 }}>Mask Mode</div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={()=> setMaskMode('hide')} style={{ padding:'6px 10px', fontSize:12, border:'1px solid var(--dt-border)', borderRadius:6, background: maskMode==='hide' ? 'var(--dt-fill-strong)' : 'var(--dt-fill-weak)', color:'var(--dt-text)' }}>Hide</button>
                  <button onClick={()=> setMaskMode('dim')} style={{ padding:'6px 10px', fontSize:12, border:'1px solid var(--dt-border)', borderRadius:6, background: maskMode==='dim' ? 'var(--dt-fill-strong)' : 'var(--dt-fill-weak)', color:'var(--dt-text)' }}>Dim</button>
                </div>
              </div>
              <div>
                <div style={{ fontSize:12, color:'var(--dt-text-dim)', marginBottom:4 }}>Canvas UI</div>
                <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                  <input type="checkbox" checked={showFeaturePanel} onChange={(e)=> setShowFeaturePanel(e.target.checked)} />
                  <span>Show feature panel</span>
                </label>
              </div>
              <div>
                <div style={{ fontSize:12, color:'var(--dt-text-dim)', marginBottom:4 }}>Developer</div>
                <button
                  onClick={()=>{
                    try {
                      const er = (window as any)?.require ? (window as any).require('electron') : null
                      if (er?.ipcRenderer?.invoke) { er.ipcRenderer.invoke('open-devtools'); return }
                    } catch {}
                    try { (console as any).log('DevTools request (no Electron ipc)') } catch {}
                  }}
                  style={{ padding:'6px 10px', fontSize:12, border:'1px solid var(--dt-border)', borderRadius:6, background:'var(--dt-fill-weak)', color:'var(--dt-text)' }}
                >
                  Open Dev Console
                </button>
              </div>
            </div>
          ), disabled: false },
          { id:'nodes', label:'Nodes', badge: items.length, render: ()=> (
            <div>
              <div style={{ fontSize:13, marginBottom:8, color:'var(--dt-text-dim)', letterSpacing:0.2 }}>Nodes</div>
              <NodeList
                items={items}
                selectedIndex={selectedIndex ?? undefined}
                onSelect={(i)=> setSelectedIndex(i)}
                onDoubleSelect={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate: true, ms: 520, zoomMultiplier: 8 }); }}
              />
            </div>
          ) }
        ]

        return (
          <SideDrawer
            open={sidebarOpen}
            onToggle={()=> setSidebarOpen(!sidebarOpen)}
            activeTab={activeDrawerTab}
            onTabChange={setActiveDrawerTab}
            tabs={tabs as any}
          />
        )
      })()}
      {/* Intro Paths: Top-3 list + Nearby panel */}
      {introPathsResult && (
        <div style={{ position:'absolute', left:12, top:56, zIndex:22, display:'flex', gap:12 }}>
          <div style={{ minWidth:280, background:'var(--dt-bg-elev-1)', border:'1px solid var(--dt-border)', borderRadius:10, padding:10 }}>
            <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
              <div style={{ fontSize:14, fontWeight:700, flex:1 }}>Top Paths</div>
              <button onClick={clearIntroPanels}
                      title="Close"
                      style={{ padding:'4px 8px', fontSize:12, border:'1px solid var(--dt-border)', borderRadius:6, background:'var(--dt-fill-weak)', color:'var(--dt-text)' }}>Close</button>
            </div>
            <div style={{ display:'grid', gap:6 }}>
              {introPathsResult.top3.map((p, idx)=>{
                const active = selectedPathIndex === idx
                const label = `${p.names.S||('person:'+p.S)} → ${p.names.M||('person:'+p.M)} → ${p.names.T||('person:'+p.T)}`
                const facts = `p:${p.scores.p.toFixed(3)} • R_SM:${p.scores.R_SM.toFixed(2)} • R_MT:${p.scores.R_MT.toFixed(2)} • ICP:${p.scores.icp.toFixed(1)} • overlap:${p.scores.overlap.toFixed(2)}`
                return (
                  <div key={`${p.S}-${p.M}-${p.T}-${idx}`} onClick={()=>{
                    setSelectedPathIndex(idx)
                    // Build mask to highlight S, M, T for this path
                    try {
                      const tile = latestTileRef.current as any
                      const n = tile?.count|0
                      const mask = new Array<boolean>(n).fill(false)
                      // S at index 0
                      mask[0] = true
                      const meta = tile?.meta?.nodes || []
                      const findIndex = (id:string)=> meta.findIndex((m:any)=> String(m?.id) === String(id))
                      const mi = findIndex(p.M)
                      const ti = findIndex(p.T)
                      if (mi>=0) mask[mi] = true
                      if (ti>=0) mask[ti] = true
                      setIntroPathsTileMask(mask)
                    } catch {}
                    // Nearby execs for T
                    fetchNearbyExecsAtCompany({ T: p.T, companyId: introPathsResult.companyId, limit: 5 }).then(setNearbyExecs).catch(()=> setNearbyExecs([]))
                  }} style={{ cursor:'pointer', padding:'8px 10px', borderRadius:8, background: active ? 'var(--dt-fill-strong)' : 'var(--dt-fill-weak)', border: active ? '1px solid var(--dt-border-strong)' : '1px solid var(--dt-border)' }}>
                    <div style={{ fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{label}</div>
                    <div style={{ fontSize:11, opacity:0.8 }}>{facts}</div>
                  </div>
                )
              })}
            </div>
          </div>
          {Array.isArray(nearbyExecs) && nearbyExecs.length>0 && (
            <div style={{ minWidth:260, background:'var(--dt-bg-elev-1)', border:'1px solid var(--dt-border)', borderRadius:10, padding:10 }}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>Nearby Execs</div>
              <div style={{ display:'grid', gap:6 }}>
                {nearbyExecs.map((r)=> (
                  <div key={r.person_id} style={{ padding:'8px 10px', borderRadius:8, background:'var(--dt-fill-weak)', border:'1px solid var(--dt-border)' }}>
                    <div style={{ fontSize:13 }}>person:{r.person_id}</div>
                    <div style={{ fontSize:11, opacity:0.82 }}>{[r.title, r.seniority].filter(Boolean).join(' • ') || '—'}</div>
                    <div style={{ fontSize:11, opacity:0.7 }}>overlap {Math.max(0, Number(r.months_overlap||0)).toFixed(0)}m</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* profile HUD disabled */}
      <CommandBar
        onRun={(expression, evaluation)=> run(expression, undefined, evaluation)}
        focus={focus}
        selectedIndex={selectedIndex}
      />
      {/* HUD is now replaced by inline controls within CommandBar */}
      {/* demo buttons removed */}
      {err && (
        <div style={{ position:'absolute', top:52, left:12, right:12, padding:'10px 12px', background:'rgba(200,40,60,0.20)', border:'1px solid var(--dt-danger)', color:'#ffbfc9', borderRadius:10, zIndex:11 }}>
          {err}
        </div>
      )}
      {/* Settings modal removed; API server is configured via env/query/localStorage */}
      {/* demo modals removed */}

      {/* In-app overlay for the Next.js demo (no popup) */}
    </div>
  );
}
