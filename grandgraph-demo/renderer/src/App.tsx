import React, { useRef, useState, useEffect, useMemo } from "react";
import { MIN_OVERLAP_MONTHS } from "./lib/constants";
import CanvasScene from "./graph/CanvasScene";
import CosmoScene from "./graph/CosmoScene";
import CommandBar from "./ui/CommandBar";
import HUD from "./ui/HUD";
import { fetchPersonProfile, type PersonProfile } from "./lib/api";
import Settings from "./ui/Settings";
import Sidebar from "./ui/Sidebar";
import { setApiConfig, fetchBridgesTileJSON, fetchAvatarMap } from "./lib/api";
import { fetchIntroPaths, type IntroPathsResult, fetchNearbyExecsAtCompany, fetchNetworkByFilter } from "./lib/api";
import { resolveSmart, loadTileSmart } from "./smart";
import { askNlq, type NlqResult } from "./lib/nlq";
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

export default function App(){
  const [focus, setFocus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sceneRef = useRef<SceneRef | null>(null);
  const latestTileRef = useRef<ParsedTile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [labels, setLabels] = useState<string[]>([]);
  const [metaNodes, setMetaNodes] = useState<Array<{ id?: string|number, title?: string|null }>>([]);
  const [jobFilter, setJobFilter] = useState<string | null>(null)
  const [avatars, setAvatars] = useState<string[]>([]);
  const [history, setHistory] = useState<Array<{ id: string, move?: { x:number, y:number }, turn?: number, at?: number }>>([]);
  const [cursor, setCursor] = useState(-1);
  // filters removed
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [apiBase, setApiBase] = useState<string>(()=>{
    try { return localStorage.getItem('API_BASE_URL') || "http://34.236.80.1:8123" } catch { return "http://34.236.80.1:8123" }
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
  const [featureNlq, setFeatureNlq] = useState<boolean>(()=>{ try{ return localStorage.getItem('FEATURE_NLQ')==='1' }catch{return false} })
  const runNlq = async (qIn?: string) => {
    if (!featureNlq) { setErr('NLQ is disabled in Settings'); return }
    try {
      const q = (qIn ?? '').trim()
      if (!q) { setErr('Please enter a question'); return }
      const res: NlqResult = await askNlq(q)
      if (res.intent === 'unsupported') { setErr(res.reason || 'Question not supported'); return }
      if (res.intent === 'show') { await run(`show ${res.args.id}`); return }
      if (res.intent === 'bridges') { await run(`bridges ${res.args.left} + ${res.args.right}`); return }
      if (res.intent === 'compare') { await run(`compare ${res.args.left} + ${res.args.right}`); return }
      if (res.intent === 'paths') { await run(`paths ${res.args.S} -> ${res.args.company}${res.args.icp?` icp:${res.args.icp}`:''}${res.args.k?` k:${res.args.k}`:''}${res.args.minRMT!=null?` min_r_mt:${res.args.minRMT}`:''}`); return }
      if (res.intent === 'migration') { await run(`migration ${res.args.left} * ${res.args.right}`); return }
    } catch (e:any) { setErr(e?.message || 'NLQ failed') }
  }
  const [featureCompanyId, setFeatureCompanyId] = useState<boolean>(()=>{ try{ return localStorage.getItem('FEATURE_COMPANY_ID')==='1' }catch{return false} })
  const [profile, setProfile] = useState<PersonProfile | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [introPathsResult, setIntroPathsResult] = useState<IntroPathsResult | null>(null)
  const [introPathsTileMask, setIntroPathsTileMask] = useState<boolean[] | null>(null)
  const [selectedPathIndex, setSelectedPathIndex] = useState<number | null>(null)
  const [nearbyExecs, setNearbyExecs] = useState<Array<{ person_id:string, title?:string|null, seniority?:string|null, months_overlap:number }>>([])
  const runIdRef = useRef(0)

  const handleSceneRef = (instance: SceneRef | null) => {
    sceneRef.current = instance
  }

  // Keep API module in sync with UI state on mount and whenever values change
  useEffect(() => {
    try { setApiConfig(apiBase, bearer) } catch {}
  }, [apiBase, bearer])

  // Migrate old/stale API base values to the new host automatically
  useEffect(() => {
    try {
      const cur = (localStorage.getItem('API_BASE_URL') || '').trim()
      const needsUpdate = /34\.192\.99\.41/.test(cur) || /127\.0\.0\.1/.test(cur)
      if (needsUpdate) {
        const next = 'http://34.236.80.1:8123'
        localStorage.setItem('API_BASE_URL', next)
        setApiBase(next)
        setApiConfig(next, bearer)
      }
    } catch {}
  // run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (sceneRef.current && latestTileRef.current) {
      try {
        sceneRef.current.setForeground(latestTileRef.current, { noTrailSnapshot: true })
      } catch {}
    }
  }, [rendererMode])

  const visibleMask = useMemo(() => {
    // If Intro Paths selection mask is active, prioritize it
    if (introPathsTileMask && introPathsTileMask.length) return introPathsTileMask
    if (!metaNodes || jobFilter === null || jobFilter.trim() === '') return null
    const q = jobFilter.toLowerCase()
    return metaNodes.map((m, idx) => {
      if (idx === 0) return true
      const title = (m?.title || '').toLowerCase()
      return title.includes(q)
    })
  }, [metaNodes, jobFilter, introPathsTileMask])

  // demo resize removed

  // demo triples removed

  const ensureCompanyId = async (input: string): Promise<string> => {
    const trimmed = (input ?? '').trim()
    if (!trimmed) throw new Error('Company value required for bridges')
    if (/^company:\d+$/i.test(trimmed)) return `company:${trimmed.slice(trimmed.indexOf(':') + 1)}`
    if (/^\d+$/.test(trimmed)) return `company:${trimmed}`
    // Gate name lookup behind feature toggle; otherwise require canonical id
    try {
      if (featureCompanyId) {
        // naive pass-through for now; future: resolve name -> id
        throw new Error('Provide canonical company:<id> (numeric)')
      }
    } catch {}
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
  function buildIntroPathsTile(result: IntroPathsResult){
    // Build 3-row layout: Start (S) at top, Bridges (unique Ms from top paths) middle, Targets (unique Ts from top paths) bottom
    const uniqueM = Array.from(new Set(result.top3.map(p=>p.M)))
    const uniqueT = Array.from(new Set(result.top3.map(p=>p.T)))
    const mCount = Math.min(10, uniqueM.length || result.Ms.length)
    const tCount = Math.min(10, uniqueT.length || result.Ts.length)
    const ms = (uniqueM.length ? uniqueM : result.Ms.map(m=>m.id)).slice(0, mCount)
    const ts = (uniqueT.length ? uniqueT : result.Ts.map(t=>t.id)).slice(0, tCount)

    const count = 1 + ms.length + ts.length
    const nodes = new Float32Array(count * 2)
    const size = new Float32Array(count)
    const alpha = new Float32Array(count)
    const group = new Uint16Array(count)
    const labelsLocal: string[] = new Array(count)
    const metaLocal: Array<Record<string, unknown>> = new Array(count)

    // Positions
    const yTop = -280, yMid = 0, yBot = 280
    // Center S
    nodes[0] = 0; nodes[1] = yTop; size[0] = 16; alpha[0] = 1; group[0] = 0
    labelsLocal[0] = introPathsResult?.paths?.[0]?.names?.S || result.S
    metaLocal[0] = { id: result.S, name: labelsLocal[0], group: 0 }

    const placeRow = (ids: string[], startIndex: number, y: number, groupValue: number, names: Map<string, string|undefined>) => {
      const n = ids.length
      const spacing = Math.max(80, Math.min(260, Math.floor(800 / Math.max(1, n))))
      const total = (n - 1) * spacing
      for (let k=0;k<n;k++){
        const i = startIndex + k
        const x = -total/2 + k * spacing
        nodes[i*2] = x
        nodes[i*2+1] = y
        size[i] = 9
        alpha[i] = 0.96
        group[i] = groupValue
        const id = ids[k]
        const label = names.get(id) || id
        labelsLocal[i] = label as string
        metaLocal[i] = { id, name: label, group: groupValue }
      }
    }

    // Name maps
    const mNames = new Map<string, string|undefined>()
    result.Ms.forEach(m=>{ if (!mNames.has(m.id)) mNames.set(m.id, (m as any).name) })
    const tNames = new Map<string, string|undefined>()
    result.Ts.forEach(t=>{ if (!tNames.has(t.id)) tNames.set(t.id, (t as any).name) })

    // Place rows
    placeRow(ms, 1, yMid, 1, mNames)
    placeRow(ts, 1 + ms.length, yBot, 2, tNames)

    // Build edges for Top-3 only
    const edgesArr: Array<[number, number]> = []
    const weights: number[] = []
    const idToIndex = (id: string): number => {
      const idxM = ms.indexOf(id); if (idxM >= 0) return 1 + idxM
      const idxT = ts.indexOf(id); if (idxT >= 0) return 1 + ms.length + idxT
      return -1
    }
    const usedPairs = new Set<string>()
    for (const p of result.top3){
      const mIdx = idToIndex(p.M)
      const tIdx = idToIndex(p.T)
      if (mIdx === -1 || tIdx === -1) continue
      const key = `${mIdx}->${tIdx}`
      if (usedPairs.has(key)) continue
      usedPairs.add(key)
      // S->M edge
      edgesArr.push([0, mIdx])
      weights.push(Math.max(1, Math.round(p.scores.R_SM * 10)))
      // M->T edge
      edgesArr.push([mIdx, tIdx])
      weights.push(Math.max(1, Math.round(p.scores.R_MT * 10)))
    }

    const edges = new Uint16Array(edgesArr.length * 2)
    const edgeWeights = new Float32Array(weights.length)
    for (let i=0;i<edgesArr.length;i++){
      edges[i*2] = edgesArr[i][0]; edges[i*2+1] = edgesArr[i][1]; edgeWeights[i] = weights[i]
    }

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
    ;(tile as any).focusWorld = { x: 0, y: yMid }
    return { tile, ms, ts }
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

    const labels = Array.isArray((compareTile as any).labels) ? (compareTile as any).labels as string[] : []
    setLabels(labels)
    setMetaNodes([])
    // For compare, skip external avatar fallbacks to avoid rate limits
    try { setAvatars(new Array(compareTile.count).fill('')) } catch { setAvatars([]) }

    const groups = (compareTile as any).compareIndexGroups as
      | { left?: number[]; right?: number[]; overlap?: number[] }
      | undefined
    if (groups) {
      setCompareGroups(groups)
      if (selectedRegion && (groups as any)[selectedRegion]) {
        setSidebarIndices((groups as any)[selectedRegion] || null)
      } else {
        setSidebarIndices(null)
      }
    } else {
      setCompareGroups(null)
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

    const anchors: Array<{ id: string; name: string; x: number; y: number; group: number }> = [
      { id: leftId, name: opts?.leftName || leftId, x: -480, y: 0, group: 0 },
      { id: rightId, name: opts?.rightName || rightId, x: 480, y: 0, group: 2 },
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

      const flowLabel = `${row.from_name || row.from_id} → ${row.to_name || row.to_id}`
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
    const leftName = rows.find((row) => row.from_id === leftId)?.from_name
      || rows.find((row) => row.to_id === leftId)?.to_name
    const rightName = rows.find((row) => row.from_id === rightId)?.from_name
      || rows.find((row) => row.to_id === rightId)?.to_name
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

  async function run(cmd: string, opts?: RunOptions, evaluation?: EvaluationResult | null){
    const rid = ++runIdRef.current
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
          const idStr = String(m?.id || '')
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
    // Compute degrees with dual thresholds: 24m for both first and second-degree hops
    const degA = degreesForDual(a, MIN_OVERLAP_MONTHS, MIN_OVERLAP_MONTHS)
    const degB = degreesForDual(b, MIN_OVERLAP_MONTHS, MIN_OVERLAP_MONTHS)
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
      if (e.key === '1') { setProfileOpen(v=>!v); return }
      if (e.key === 'ArrowDown' && typeof selectedIndex === 'number') setSelectedIndex((prev)=>{
        const cur = (typeof prev === 'number' ? prev : 0)
        return (cur + 1) % metaNodes.length
      })
      if (e.key === 'ArrowUp' && typeof selectedIndex === 'number') setSelectedIndex((prev)=>{
        const cur = (typeof prev === 'number' ? prev : 0)
        return (cur - 1 + metaNodes.length) % metaNodes.length
      })
      // Move focus to next node with Left Arrow (was Right Arrow)
      if (e.key === 'ArrowLeft' && typeof selectedIndex === 'number') {
        setSelectedIndex((prev)=>{
          const next = ((typeof prev === 'number' ? prev : 0) + 1) % metaNodes.length
          ;(sceneRef.current as any)?.focusIndex?.(next, { zoom: 0.9 })
          return next
        })
      }
      // Spawn selected person's graph with Right Arrow (was Left Arrow)
      if (e.key === 'ArrowRight') {
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
    <div className="w-full h-full" style={{ background: "var(--dt-bg)", color: "var(--dt-text)", position:'fixed', inset:0, overflow:'hidden' }}>
      {rendererMode === 'canvas' ? (
        <CanvasScene
          ref={handleSceneRef}
          concentric={concentric}
          selectedIndex={selectedIndex}
          visibleMask={visibleMask}
          onPick={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate:true, ms:520, zoomMultiplier: 6 }); }}
          onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }}
          onStats={(_,count)=>{ setNodeCount(count) }}
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
          onStats={(_,count)=>{ setNodeCount(count) }}
          onRegionClick={onRegionClick}
        />
      )}
      {/* renderer toggle moved into CommandBar */}
      <Sidebar 
        open={sidebarOpen} 
        onToggle={()=>setSidebarOpen(!sidebarOpen)} 
        items={(sidebarIndices ? sidebarIndices : Array.from({length: Math.max(0,nodeCount)},(_,i)=>i)).map((i)=>({ index:i, group:(i%8), name: labels[i], title: (metaNodes[i] as any)?.title || (metaNodes[i] as any)?.job_title || (metaNodes[i] as any)?.headline || (metaNodes[i] as any)?.role || (metaNodes[i] as any)?.position || null, avatarUrl: avatars[i] }))}
        selectedIndex={selectedIndex}
        onSelect={(i)=>{ setSelectedIndex(i); }} 
        onDoubleSelect={(i)=>{ setSelectedIndex(i); (sceneRef.current as any)?.focusIndex?.(i, { animate: true, ms: 520, zoomMultiplier: 8 }); setSidebarOpen(false); }} 
      />
      {/* Intro Paths: Top-3 list + Nearby panel */}
      {introPathsResult && (
        <div style={{ position:'absolute', left:12, top:56, zIndex:22, display:'flex', gap:12 }}>
          <div style={{ minWidth:280, background:'var(--dt-bg-elev-1)', border:'1px solid var(--dt-border)', borderRadius:10, padding:10 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>Top Paths</div>
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
      <HUD profile={profile} profileOpen={profileOpen} />
      <CommandBar
        onRun={(expression, evaluation)=> run(expression, undefined, evaluation)}
        focus={focus}
        selectedIndex={selectedIndex}
        onSettings={()=>setShowSettings(true)}
        rendererMode={rendererMode}
        onRendererChange={(mode)=> setRendererMode(mode)}
        enableNlq={featureNlq}
        onNlq={runNlq}
      />
      {/* HUD is now replaced by inline controls within CommandBar */}
      {/* demo buttons removed */}
      {err && (
        <div style={{ position:'absolute', top:52, left:12, right:12, padding:'10px 12px', background:'rgba(200,40,60,0.20)', border:'1px solid var(--dt-danger)', color:'#ffbfc9', borderRadius:10, zIndex:11 }}>
          {err}
        </div>
      )}
      {showSettings && (
        <Settings
          apiBase={apiBase}
          bearer={bearer}
          features={{ enableNlq: featureNlq, enableCompanyId: featureCompanyId }}
          onFeaturesChange={({ enableNlq, enableCompanyId })=>{ setFeatureNlq(enableNlq); setFeatureCompanyId(enableCompanyId) }}
          onSave={({apiBase,bearer,user,password,profilesDb,viaDb})=>{
            setApiBase(apiBase); setBearer(bearer); setApiConfig(apiBase,bearer,user,password); try{ localStorage.setItem('DB_PROFILES', profilesDb||'default'); localStorage.setItem('DB_VIA', viaDb||'via_cluster') }catch{}; setShowSettings(false);
          }}
          onClose={()=>setShowSettings(false)}
        />
      )}
      {/* demo modals removed */}
    </div>
  );
}
