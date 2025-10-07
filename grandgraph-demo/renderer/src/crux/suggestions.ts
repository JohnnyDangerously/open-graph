import type { Expression, HistoryEntry, Suggestion, Token, FilterToken } from './types'
import { suggestCompanies, suggestPeople } from '../lib/api'

const FILTER_KEYS = [
  { key: 'role', description: 'Role or job function (role:engineer)' },
  { key: 'time', description: 'Tenure window like 24mo or Q2024' },
  { key: 'location', description: 'Geography or region filter' },
  { key: 'seniority', description: 'Level filter e.g. seniority:director+' },
  { key: 'top', description: 'Limit results (top:50)' },
  { key: 'rank', description: 'Sort metric e.g. rank:reachability' },
  { key: 'window', description: 'Temporal slice (window:Q2024)' },
  { key: 'growth', description: 'Require growth threshold (growth:>=20%)' },
  { key: 'decay', description: 'Decay guard rails' },
  { key: 'trust', description: 'Trust / strength threshold' },
  { key: 'hops', description: 'Hop limit for reachability (hops:2)' },
  { key: 'bucket', description: 'Bucket definition (bucket:tenure=[0-12,...])' },
  { key: 'groupby', description: 'Group results (groupby:role)' },
  { key: 'metric', description: 'Metric to aggregate (metric:net_flows)' },
  { key: 'score', description: 'Inline scoring weights score{...}' },
  { key: 'sources', description: 'Show evidence sources:show' },
  { key: 'consent', description: 'Consent scope (consent:team_only)' },
  { key: 'policy', description: 'Policy guard rails (policy:no_email_export)' },
  { key: 'redact', description: 'Redaction level for shares' },
  { key: 'cap', description: 'Operational cap e.g. cap:intros_per_week:10' },
]

const OP_SUGGESTIONS: Suggestion[] = [
  { id: 'op-bridge', type: 'operator', value: '^', label: '^ bridge', description: 'Find strongest bridge nodes between two entities' },
  { id: 'op-compare', type: 'operator', value: '><', label: '>< compare', description: 'Overlap and delta between entities' },
  { id: 'op-migration', type: 'operator', value: '*', label: '* flows', description: 'People flow / migration stream between entities' },
  { id: 'op-membership', type: 'operator', value: '#', label: '# membership', description: 'Lists or groups containing an entity' },
  { id: 'op-recenter', type: 'operator', value: '<', label: '< center', description: 'Re-center graph on entity or @me' },
  { id: 'op-reweight', type: 'operator', value: '>>', label: '>> reweight', description: 'Reweight scoring by outcome' },
  { id: 'op-reach', type: 'operator', value: '↗', label: '↗ reach', description: 'Reach cone within hop/trust bounds' },
  { id: 'op-similar', type: 'operator', value: '~', label: '~ similar', description: 'Find similar / fuzzy matches' },
  { id: 'op-delta', type: 'operator', value: 'Δ', label: 'Δ delta', description: 'Delta compared to prior window' },
]

// Always-visible seed suggestions to ensure UX never appears empty.
// Verified companies from the dataset
const ENTITY_STARTER: Suggestion[] = [
  // People with very high neighbor counts (verified)
  { id: 'seed-person-jill-cisneros', type: 'entity', value: 'person:17460185506374950457', label: 'Jill Cisneros', description: 'High-degree network' },
  { id: 'seed-person-jodi-gomez', type: 'entity', value: 'person:758661163615411016', label: 'Jodi Gomez', description: 'High-degree network' },
  { id: 'seed-person-mark-aguirre', type: 'entity', value: 'person:16187301763635908446', label: 'Mark Aguirre', description: 'High-degree network' },
  { id: 'seed-person-melissa-williams', type: 'entity', value: 'person:10148933528123724725', label: 'Melissa Williams', description: 'High-degree network' },

  // Quick command: Edge Decomposition for a known person id
  { id: 'seed-edge-decomp-jill', type: 'history', value: 'edge decomposition person:17460185506374950457', label: 'Edge Decomposition • Jill Cisneros', description: 'Run edge decomposition for person:17460185506374950457' },

  // Bridge examples (keep good pairings)
  { id: 'seed-bridge-amzn-walmart', type: 'history', value: 'company:11125032872491181068 ^ company:9946666062803016585', label: 'Bridges: Amazon.com Inc. ^ Walmart Inc.', description: 'Bridge candidates between companies' },
  { id: 'seed-bridge-deloitte-wells', type: 'history', value: 'company:15386976225069648853 ^ company:16859218261549140953', label: 'Bridges: Deloitte ^ Wells Fargo & Company', description: 'Bridge candidates between companies' },

  // Company placeholders (ids preserved, can be refined later)
  { id: 'seed-co-amzn', type: 'entity', value: 'company:11125032872491181068', label: 'Amazon.com Inc.', description: 'Company' },
  { id: 'seed-co-walmart', type: 'entity', value: 'company:9946666062803016585', label: 'Walmart Inc.', description: 'Company' },
  { id: 'seed-co-target', type: 'entity', value: 'company:3548474563734415132', label: 'Target Corporation', description: 'Company' },
  { id: 'seed-co-deloitte', type: 'entity', value: 'company:15386976225069648853', label: 'Deloitte', description: 'Company' },
]

const VIEW_SUGGESTIONS: Suggestion[] = [
  { id: 'view-graph', type: 'view', value: '@view:graph', label: 'View • Graph', description: 'Force graph view' },
  { id: 'view-flows', type: 'view', value: '@view:flows', label: 'View • Flows', description: 'Sankey / flows view' },
  { id: 'view-list', type: 'view', value: '@view:list', label: 'View • List', description: 'Ranked list view' },
  { id: 'view-sankey', type: 'view', value: '@view:sankey', label: 'View • Sankey', description: 'Sankey variant for flows' },
  { id: 'view-paths', type: 'view', value: '@view:paths', label: 'View • Paths', description: 'Path explorer for ^k queries' },
]

interface SuggestionContext {
  expecting: 'entity' | 'operator' | 'filter-key' | 'filter-value' | 'view' | 'pipe' | 'none'
  activeToken?: Token
}

function contextFor(expression: Expression, caret: number): SuggestionContext {
  let expecting: SuggestionContext['expecting'] = 'entity'
  let filterMode = false
  let activeToken: Token | undefined
  let pendingOperator = false

  for (const token of expression.tokens){
    if (caret >= token.start && caret <= token.end) {
      activeToken = token
    }
    if (token.end > caret) break
    switch (token.type) {
      case 'entity':
      case 'macro-ref':
        expecting = pendingOperator ? 'operator' : 'operator'
        pendingOperator = false
        break
      case 'operator': {
        const op = token.op
        if (op === '>' || op === 'filter') {
          filterMode = true
          expecting = 'filter-key'
          pendingOperator = false
        } else {
          pendingOperator = true
          expecting = 'entity'
        }
        break
      }
      case 'set-op':
        pendingOperator = false
        expecting = 'entity'
        break
      case 'filter':
        filterMode = true
        expecting = 'filter-key'
        break
      case 'view':
        expecting = 'none'
        break
      case 'pipe':
        expecting = 'pipe'
        break
      default:
        break
    }
  }

  if (activeToken) {
    if (activeToken.type === 'filter') {
      const filterToken = activeToken as FilterToken
      const colonIdx = activeToken.raw.indexOf(':')
      if (colonIdx >= 0) {
        const keyLen = filterToken.key?.length ?? colonIdx
        const relativeCaret = caret - activeToken.start
        expecting = relativeCaret <= keyLen + 1 ? 'filter-key' : 'filter-value'
      }
    } else if (activeToken.type === 'view') {
      expecting = 'view'
    } else if (activeToken.type === 'pipe') {
      expecting = 'pipe'
    }
  } else if (filterMode) {
    expecting = 'filter-key'
  }

  return { expecting, activeToken }
}

const SUGGESTION_LIMIT = 40

function filterSuggestions(prefix: string, items: Suggestion[]): Suggestion[] {
  if (!prefix) return items.slice(0, SUGGESTION_LIMIT)
  const lower = prefix.toLowerCase()
  return items
    .map(item => ({ item, score: scoreMatch(lower, item.value.toLowerCase(), item.label.toLowerCase()) }))
    .filter(entry => entry.score > -Infinity)
    .sort((a,b)=> b.score - a.score)
    .slice(0, SUGGESTION_LIMIT)
    .map(entry => entry.item)
}

function scoreMatch(query: string, value: string, label: string): number {
  if (!query) return 0
  if (value.startsWith(query)) return 10 + (10 - Math.min(10, value.length - query.length))
  if (label.startsWith(query)) return 9
  if (value.includes(query)) return 5
  if (label.includes(query)) return 4
  return -Infinity
}

// Async-capable suggestion fetcher. For now we expose a sync wrapper used by UI; the UI
// calls the async version via a small bridge to avoid changing its contract too much.
export async function getSuggestionsAsync(expression: Expression, caret: number, history: HistoryEntry[] = [], opts?: { signal?: AbortSignal }): Promise<Suggestion[]> {
  const { expecting, activeToken } = contextFor(expression, caret)
  const prefix = (() => {
    if (!activeToken) return ''
    return activeToken.raw.slice(0, Math.max(0, caret - activeToken.start)).trim()
  })()

  if (expecting === 'operator') {
    return filterSuggestions(prefix, OP_SUGGESTIONS)
  }
  if (expecting === 'filter-key') {
    const list = FILTER_KEYS.map(f => ({ id: `filter-${f.key}`, type:'filter' as const, value: `${f.key}:`, label: `${f.key}:`, description: f.description }))
    return filterSuggestions(prefix, list)
  }
  if (expecting === 'filter-value') {
    if (activeToken && activeToken.type === 'filter') {
      const filterToken = activeToken as FilterToken
      return suggestValuesForFilter(filterToken, prefix)
    }
    return []
  }
  if (expecting === 'view') {
    return filterSuggestions(prefix, VIEW_SUGGESTIONS)
  }
  if (expecting === 'pipe') {
    const actions: Suggestion[] = [
      { id: 'pipe-save', type: 'action', value: '| save:"Layer"', label: '| save:"Layer"', description: 'Save selection as layer' },
      { id: 'pipe-export', type: 'action', value: '| export:csv', label: '| export:csv', description: 'Export as CSV' },
      { id: 'pipe-share', type: 'action', value: '| share:@teammate', label: '| share:@teammate', description: 'Share view with teammate' },
      { id: 'pipe-feedback', type: 'action', value: '| feedback:good_paths', label: '| feedback:good_paths', description: 'Send quick feedback' },
    ]
    return filterSuggestions(prefix, actions)
  }

  // If no prefix, return curated seeds only (verified to work)
  if (!prefix) {
    return ENTITY_STARTER.slice(0, SUGGESTION_LIMIT)
  }

  // If user typed a canonical prefix, run targeted lookup; otherwise mixed search
  const pfx = (prefix || '').toLowerCase()
  const out: Suggestion[] = []
  try {
    if (pfx.startsWith('company:')) {
      const q = prefix.slice('company:'.length)
      const rows = await suggestCompanies(q, 8, { signal: opts?.signal })
      out.push(...rows.map((r, i) => ({ id: `co-${r.id}-${i}`, type: 'entity' as const, value: `company:${r.id}` , label: r.name || `company:${r.id}`, description: 'Company' })))
    } else if (pfx.startsWith('person:')) {
      const q = prefix.slice('person:'.length)
      const rows = await suggestPeople(q, 8, { signal: opts?.signal })
      out.push(...rows.map((r, i) => ({ id: `pe-${r.id}-${i}`, type: 'entity' as const, value: `person:${r.id}` , label: r.name || `person:${r.id}`, description: r.title ? `${r.title}${r.company ? ` • ${r.company}` : ''}` : (r.company || 'Person') })))
    } else if (pfx.length >= 2) {
      // Mixed search across both when user typed free text
      const [cos, ppl] = await Promise.all([
        suggestCompanies(prefix, 5, { signal: opts?.signal }).catch(()=>[]),
        suggestPeople(prefix, 5, { signal: opts?.signal }).catch(()=>[]),
      ])
      out.push(...cos.map((r, i) => ({ id: `co-${r.id}-${i}`, type: 'entity' as const, value: `company:${r.id}`, label: r.name || `company:${r.id}`, description: 'Company' })))
      out.push(...ppl.map((r, i) => ({ id: `pe-${r.id}-${i}`, type: 'entity' as const, value: `person:${r.id}`, label: r.name || `person:${r.id}`, description: r.title ? `${r.title}${r.company ? ` • ${r.company}` : ''}` : (r.company || 'Person') })))
    }
  } catch {}

  // Ensure at least some helpful starters
  const final = out.length > 0 ? [...out, ...ENTITY_STARTER] : ENTITY_STARTER
  return filterSuggestions(prefix, final)
}

// Back-compat synchronous shim: used by existing UI call sites. It returns the best known
// cached/fallback list immediately; the UI should ideally switch to getSuggestionsAsync.
export function getSuggestions(expression: Expression, caret: number, history: HistoryEntry[] = []): Suggestion[] {
  const { expecting } = contextFor(expression, caret)
  if (expecting === 'operator') return filterSuggestions('', OP_SUGGESTIONS)
  if (expecting === 'filter-key') {
    const list = FILTER_KEYS.map(f => ({ id: `filter-${f.key}`, type:'filter' as const, value: `${f.key}:`, label: `${f.key}:`, description: f.description }))
    return filterSuggestions('', list)
  }
  if (expecting === 'view') return filterSuggestions('', VIEW_SUGGESTIONS)
  return [...ENTITY_STARTER]
}

function suggestValuesForFilter(filterToken: FilterToken, prefix: string): Suggestion[] {
  const key = filterToken.key?.toLowerCase() ?? ''
  const base: Suggestion[] = []
  if (key === 'time' || key === 'window') {
    base.push(
      { id: 'time-24', type: 'filter', value: '24mo', label: '24mo', description: 'Last 24 months' },
      { id: 'time-q', type: 'filter', value: 'Q2024', label: 'Q2024', description: 'Quarter window' },
      { id: 'time-12', type: 'filter', value: '12mo', label: '12mo', description: 'Last 12 months' },
    )
  } else if (key === 'role') {
    base.push(
      { id: 'role-eng', type: 'filter', value: 'engineer', label: 'engineer', description: 'Engineering roles' },
      { id: 'role-swe', type: 'filter', value: 'software', label: 'software', description: 'Software roles' },
      { id: 'role-gtm', type: 'filter', value: 'gtm', label: 'gtm', description: 'Go-to-market roles' },
    )
  } else if (key === 'location') {
    base.push(
      { id: 'loc-nyc', type: 'filter', value: 'New York', label: 'New York', description: 'Location: New York' },
      { id: 'loc-sf', type: 'filter', value: 'San Francisco', label: 'San Francisco', description: 'Location: SF' },
      { id: 'loc-bos', type: 'filter', value: 'Boston', label: 'Boston', description: 'Location: Boston' },
    )
  } else if (key === 'seniority') {
    base.push(
      { id: 'sen-dir', type: 'filter', value: 'director+', label: 'director+', description: 'Director or higher' },
      { id: 'sen-svp', type: 'filter', value: 'svp+', label: 'svp+', description: 'SVP or higher' },
    )
  } else if (key === 'top') {
    base.push(
      { id: 'top-25', type: 'filter', value: '25', label: '25', description: 'Top 25 results' },
      { id: 'top-50', type: 'filter', value: '50', label: '50', description: 'Top 50 results' },
      { id: 'top-100', type: 'filter', value: '100', label: '100', description: 'Top 100 results' },
    )
  } else if (key === 'score') {
    base.push(
      { id: 'score-overlap', type: 'filter', value: '{overlap:0.6,seniority:0.3,trust:0.1}', label: '{overlap:0.6,...}', description: 'Weighted scoring template' },
    )
  }
  return filterSuggestions(prefix, base)
}
