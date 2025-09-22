import { parseExpression } from './parser'
import type {
  EvaluateOptions,
  EvaluationResult,
  Expression,
  EntityToken,
  FilterToken,
  OperatorToken,
  SetOpToken,
  ViewToken,
  PipeToken,
  ExplainToken,
  MacroRefToken,
  View,
  Token,
  BridgeVM,
  CompareVM,
  MigrationVM,
  FilterVM,
} from './types'
import { resolveSmart, loadTileSmart } from '../smart'
import { fetchBridgesTileJSON, fetchMigrationPairs } from '../lib/api'
import { parseJsonTile } from '../graph/parse'
import type { ParsedTile } from '../graph/parse'

interface EntityResolution {
  token: EntityToken | MacroRefToken
  id: string | null
  label: string
  kind: 'company' | 'person' | 'list' | 'raw' | 'macro' | 'group'
}

interface IntentContext {
  base?: EntityResolution
  steps: Array<{ operator: OperatorToken | SetOpToken; entity?: EntityResolution }>
  filters: FilterToken[]
  viewToken?: ViewToken
  pipes: PipeToken[]
  explains: ExplainToken[]
  errors: string[]
  warnings: string[]
}

const DEFAULT_COMPARE_FIRST_MONTHS = 24
const DEFAULT_COMPARE_SECOND_MONTHS = 36

function nodeIdFor(tile: ParsedTile, i: number): string {
  const meta: any = (tile as any)?.meta?.nodes?.[i]
  const val = meta?.id ?? meta?.linkedin_id ?? meta?.handle ?? (tile as any)?.labels?.[i]
  return String(val ?? i)
}

function degreesForDual(tile: ParsedTile, minFirstMonths: number, minSecondMonths: number){
  const count = tile.count|0
  const edges = tile.edges || new Uint16Array(0)
  const weights: (Float32Array | Uint8Array | undefined) = (tile as any).edgeWeights
  const mAll = edges.length >>> 1
  const neighborsFirst: number[][] = Array.from({ length: count }, () => [])
  const neighborsSecond: number[][] = Array.from({ length: count }, () => [])
  for (let i=0;i<mAll;i++){
    const a = edges[i*2]|0, b = edges[i*2+1]|0
    if (a>=count || b>=count) continue
    let w = 0
    if (weights && (weights as any).length === mAll){
      w = Number((weights as any)[i])
    }
    if (w >= minFirstMonths){ neighborsFirst[a].push(b); neighborsFirst[b].push(a) }
    if (w >= minSecondMonths){ neighborsSecond[a].push(b); neighborsSecond[b].push(a) }
  }
  const first = Array.from(new Set(neighborsFirst[0]||[])).filter(i=>i>0)
  const firstIds = new Set<string>(first.map(i=>nodeIdFor(tile, i)))
  const second: number[] = []
  const seen = new Set<number>([0, ...first])
  for (const f of first){
    const nbrs = neighborsSecond[f] || []
    for (const n of nbrs){ if (!seen.has(n)){ seen.add(n); if (n>0) second.push(n) } }
  }
  const secondIds = new Set<string>(second.map(i=>nodeIdFor(tile, i)))
  return { first, second, firstIds, secondIds }
}

async function resolveEntityToken(tok: EntityToken | MacroRefToken): Promise<EntityResolution> {
  if (tok.type === 'macro-ref') {
    return { token: tok, id: null, label: tok.raw, kind: 'macro' }
  }
  const raw = tok.value?.trim() ?? tok.raw.trim()
  if (!raw) {
    return { token: tok, id: null, label: '', kind: tok.entityKind }
  }
  if (tok.entityKind === 'group') {
    return { token: tok, id: null, label: raw, kind: 'group' }
  }
  const resolved = await resolveSmart(raw)
  const kind: EntityResolution['kind'] = resolved?.startsWith('company:') ? 'company' : resolved?.startsWith('person:') ? 'person' : tok.entityKind
  if (resolved) {
    tok.meta = { ...(tok.meta || {}), canonical: resolved, resolvedKind: kind }
  }
  return { token: tok, id: resolved, label: tok.raw || raw, kind }
}

function extractIntent(expression: Expression): IntentContext {
  const ctx: IntentContext = { steps: [], filters: [], pipes: [], explains: [], errors: [], warnings: [] }
  let pendingOp: OperatorToken | SetOpToken | null = null
  let filterMode = false

  for (const token of expression.tokens){
    switch (token.type) {
      case 'entity':
      case 'macro-ref': {
        const entTok = token as EntityToken | MacroRefToken
        if (!ctx.base){
          const baseKind = (entTok as any).entityKind ?? 'raw'
          ctx.base = { token: entTok as any, id: null, label: entTok.raw, kind: baseKind }
        } else if (pendingOp) {
          const entKind = (entTok as any).entityKind ?? 'raw'
          ctx.steps.push({ operator: pendingOp, entity: { token: entTok as any, id: null, label: entTok.raw, kind: entKind } })
          pendingOp = null
        } else if (!filterMode) {
          ctx.warnings.push(`Unexpected entity "${entTok.raw}"; ignoring`)
        }
        break
      }
      case 'operator': {
        const opTok = token as OperatorToken
        if (opTok.op === '>' || opTok.op === 'filter') {
          filterMode = true
          pendingOp = null
        } else {
          pendingOp = opTok
          filterMode = false
        }
        break
      }
      case 'set-op': {
        pendingOp = token
        filterMode = false
        break
      }
      case 'filter': {
        ctx.filters.push(token)
        break
      }
      case 'view': {
        ctx.viewToken = token
        break
      }
      case 'pipe': {
        ctx.pipes.push(token)
        break
      }
      case 'explain': {
        ctx.explains.push(token)
        break
      }
      default:
        break
    }
  }
  return ctx
}

async function hydrateIntent(ctx: IntentContext): Promise<IntentContext> {
  if (ctx.base) ctx.base = await resolveEntityToken(ctx.base.token as EntityToken)
  for (const step of ctx.steps){
    if (step.entity) step.entity = await resolveEntityToken(step.entity.token as EntityToken)
  }
  return ctx
}

function filterRecord(filters: FilterToken[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const f of filters){
    if (!f.key) continue
    record[f.key.toLowerCase()] = f.valueRaw.trim()
  }
  return record
}

function inferView(intent: IntentContext, explicit?: View): View {
  if (explicit && explicit !== 'auto') return explicit
  for (const step of intent.steps){
    const op = (step.operator as OperatorToken).op
    if (op === '^' || op === 'bridge') return 'graph'
    if (op === '*' || op === 'migration') return 'flows'
    if (op === '><' || op === 'compare') return 'list'
  }
  return explicit ?? (intent.filters.length ? 'list' : 'graph')
}

async function evaluateBridge(intent: IntentContext, step: { operator: OperatorToken; entity: EntityResolution | undefined }, filters: Record<string,string>): Promise<BridgeVM> {
  if (!intent.base) throw new Error('Bridge expression requires a left entity')
  const left = intent.base
  const right = step.entity
  if (!left?.id || !right?.id) throw new Error('Could not resolve both entities for bridge')
  const limit = filters.top ? Number(filters.top.replace(/[^0-9]/g,'')) || 120 : 120
  const rawTile = await fetchBridgesTileJSON(left.id, right.id, limit)
  const tile = parseJsonTile(rawTile as any)
  const metaNodes: Array<any> = (rawTile as any)?.meta?.nodes || []
  const groups: number[] | undefined = (rawTile as any)?.coords?.groups
  const bridges = metaNodes
    .map((node: any, idx: number) => ({ idx, node }))
    .filter(({ idx }) => groups ? groups[idx] === 1 : idx >= (metaNodes.length/3))
    .map(({ node }) => ({
      name: String(node?.name || node?.full_name || node?.id || 'Bridge'),
      score: typeof node?.score === 'number' ? Number(node.score) : 0,
      id: node?.id ? String(node.id) : undefined,
      stats: {
        left: Number(node?.left_degree ?? 0),
        right: Number(node?.right_degree ?? 0),
      }
    }))
    .sort((a,b)=> b.score - a.score)
    .slice(0, limit)
  return { view:'graph', left: left.label, right: right?.label ?? '', bridges, tile, raw: rawTile }
}

async function evaluateCompare(intent: IntentContext, step: { operator: OperatorToken; entity: EntityResolution | undefined }): Promise<CompareVM> {
  if (!intent.base) throw new Error('Compare expression expects a base entity')
  const left = intent.base
  const right = step.entity
  if (!left?.id || !right?.id) throw new Error('Could not resolve both sides for compare')
  const [{ tile: aTile }, { tile: bTile }] = await Promise.all([loadTileSmart(left.id), loadTileSmart(right.id)])
  const degA = degreesForDual(aTile as ParsedTile, DEFAULT_COMPARE_FIRST_MONTHS, DEFAULT_COMPARE_SECOND_MONTHS)
  const degB = degreesForDual(bTile as ParsedTile, DEFAULT_COMPARE_FIRST_MONTHS, DEFAULT_COMPARE_SECOND_MONTHS)
  const overlap = Array.from(degA.firstIds).filter(id => degB.firstIds.has(id)).length
  const setA = new Set<string>([...degA.firstIds, ...degA.secondIds])
  const uniqueA = Array.from(setA).filter(id => !degB.firstIds.has(id) && !degB.secondIds.has(id)).length
  const setB = new Set<string>([...degB.firstIds, ...degB.secondIds])
  const uniqueB = Array.from(setB).filter(id => !degA.firstIds.has(id) && !degA.secondIds.has(id)).length
  return { view:'list', left: left.label, right: right?.label ?? '', overlap, uniqueA, uniqueB, metrics: {
    firstDegreeOverlap: overlap,
    aFirst: degA.first.length,
    bFirst: degB.first.length,
  } as any, tiles: { left: aTile, right: bTile } }
}

async function evaluateMigration(intent: IntentContext, step: { operator: OperatorToken; entity: EntityResolution | undefined }, filters: Record<string,string>): Promise<MigrationVM> {
  if (!intent.base) throw new Error('Migration expression expects a base entity')
  const left = intent.base
  const right = step.entity
  if (!left?.id || !right?.id) throw new Error('Could not resolve both sides for migration')
  const windowMonths = filters.time ? parseInt(filters.time.replace(/[^0-9]/g,''), 10) || undefined : undefined
  const rows = await fetchMigrationPairs(left.id, right.id, { windowMonths, limit: filters.top ? Number(filters.top.replace(/[^0-9]/g,'')) : undefined })
  const pairs = rows.map((row: any) => ({
    from: row.from_name || row.from_id,
    to: row.to_name || row.to_id,
    count: Number(row.movers || 0),
    delta: row.avg_days != null ? Number(row.avg_days) : undefined,
  }))
  const total = pairs.reduce((sum, p) => sum + p.count, 0)
  return { view:'flows', total, pairs, rows }
}

async function evaluateFilters(filters: Record<string,string>): Promise<FilterVM> {
  return { view:'list', filters }
}

export async function evaluate(text: string, opts?: EvaluateOptions): Promise<EvaluationResult> {
  const started = performance.now()
  const expression = parseExpression(text)
  const intent = extractIntent(expression)
  await hydrateIntent(intent)
  const filters = filterRecord(intent.filters)
  const explicitView = intent.viewToken?.view
  const warnings = [...intent.warnings]

  let viewModel = null
  let inferredView: View = inferView(intent, explicitView)

  const opStep = intent.steps.find(step => step.entity && (step.operator as any).type === 'operator') as { operator: OperatorToken; entity?: EntityResolution } | undefined
  if (opStep && (opStep.operator as any).type === 'operator') {
    const op = (opStep.operator as OperatorToken).op
    try {
      if (op === '^' || op === 'bridge') {
        viewModel = await evaluateBridge(intent, opStep, filters)
        inferredView = 'graph'
      } else if (op === '><' || op === 'compare') {
        viewModel = await evaluateCompare(intent, opStep)
        inferredView = 'list'
      } else if (op === '*' || op === 'migration') {
        viewModel = await evaluateMigration(intent, opStep, filters)
        inferredView = 'flows'
      }
    } catch (err: any) {
      warnings.push(err?.message || String(err))
    }
  }

  if (!viewModel && intent.filters.length){
    viewModel = await evaluateFilters(filters)
    inferredView = inferredView || 'list'
  }

  const durationMs = performance.now() - started
  return { expression, viewModel, inferredView, warnings, executed: !!viewModel, durationMs }
}

export function describeExpression(text: string) {
  return parseExpression(text)
}
