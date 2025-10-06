import React from "react";
import { fetchNeighborCompanyAggregates, fetchNeighborIdsByCompany, fetchCurrentCompaniesForPeople } from "../lib/api";
import { MIN_OVERLAP_MONTHS } from "../lib/constants";

export default function TabCompanies({
  labels,
  metaNodes,
  onMask,
  onFocusIndex,
  onSetMaskMode,
}: {
  labels: string[];
  metaNodes: Array<Record<string, any>>;
  onMask: (mask: boolean[] | null) => void;
  onFocusIndex: (i: number) => void;
  onSetMaskMode?: (m: "hide" | "dim") => void;
}) {
  // no memberships — removed per new spec

  // Person network aggregate: companies of first-degree neighbors
  const centerId = React.useMemo(() => {
    try { return String((metaNodes?.[0] as any)?.id ?? '') } catch { return '' }
  }, [metaNodes])

  const [coAgg, setCoAgg] = React.useState<Array<{ company_id?: string|null, company?: string|null, count: number }>>([])
  const [loadingAgg, setLoadingAgg] = React.useState(false)
  const [mode, setMode] = React.useState<'visible' | 'neighbors'>('visible')
  // For visible-mode selection: map company key -> Set(person_id)
  const visibleGroupsRef = React.useRef<Map<string, Set<string>>>(new Map())
  React.useEffect(()=>{
    let cancelled = false
    const run = async ()=>{
      if (!centerId || !/^\d+$/.test(centerId)) { setCoAgg([]); return }
      setLoadingAgg(true)
      try {
        if (mode === 'visible') {
          // Group by current company for nodes visible in the tile (indices >=1)
          const ids = (metaNodes || []).slice(1).map((m:any)=> String(m?.id || '')).filter(Boolean)
          const rows = await fetchCurrentCompaniesForPeople(ids)
          const map = new Map<string, { company_id?: string|null, company?: string|null, count: number }>()
          const group = new Map<string, Set<string>>()
          for (const r of rows){
            const key = String(r.company_id || r.company || 'unknown')
            const cur = map.get(key) || { company_id: r.company_id || null, company: r.company || null, count: 0 }
            cur.count += 1
            cur.company_id = cur.company_id ?? (r.company_id || null)
            cur.company = cur.company ?? (r.company || null)
            map.set(key, cur)
            if (!group.has(key)) group.set(key, new Set())
            group.get(key)!.add(String(r.person_id))
          }
          const agg = Array.from(map.values()).sort((a,b)=> b.count - a.count || String(a.company||'').localeCompare(String(b.company||''))).slice(0, 200)
          visibleGroupsRef.current = group
          if (!cancelled) setCoAgg(agg)
        } else {
          const rows = await fetchNeighborCompanyAggregates({ S: centerId, minOverlapMonths: MIN_OVERLAP_MONTHS, limit: 80 })
          if (!cancelled) setCoAgg(rows)
        }
      } catch { if (!cancelled) setCoAgg([]) }
      finally { if (!cancelled) setLoadingAgg(false) }
    }
    run()
    return ()=>{ cancelled = true }
  }, [centerId, metaNodes, mode])

  const clearMask = React.useCallback(() => { onMask(null) }, [onMask]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ fontSize: 12, color: "var(--dt-text-dim)", marginBottom: 6, flex:1 }}>
            {mode === 'visible' ? 'Current companies of visible nodes' : 'Top companies in neighbor network'}
          </div>
          <button onClick={()=> setMode(m => m === 'visible' ? 'neighbors' : 'visible')} title="Toggle mode" style={{ padding:'4px 8px', fontSize:11, borderRadius:6, border:'1px solid var(--dt-border)', background:'var(--dt-fill-med)', color:'var(--dt-text)' }}>
            {mode === 'visible' ? 'Neighbors' : 'Visible'}
          </button>
          <button onClick={clearMask} title="Clear" style={{ padding:'4px 8px', fontSize:11, borderRadius:6, border:'1px solid var(--dt-border)', background:'var(--dt-fill-med)', color:'var(--dt-text)' }}>Clear</button>
        </div>
        {(!centerId || !/^\d+$/.test(centerId)) && (
          <div style={{ fontSize: 12, color: "var(--dt-text-dim)" }}>Company aggregates are available for person networks.</div>
        )}
        {loadingAgg && <div style={{ fontSize: 12, color: "var(--dt-text-dim)" }}>Loading…</div>}
        {!loadingAgg && coAgg.length > 0 && (
          <div style={{ display: 'grid', gap: 4 }}>
            {coAgg.map((row) => (
              <div key={`${row.company_id||row.company||'unknown'}`}
                   onClick={async ()=>{
                     try {
                       const n = Math.max(labels?.length || 0, metaNodes?.length || 0)
                       const mask = new Array<boolean>(n).fill(false)
                       if (mode === 'visible') {
                         const key = String(row.company_id || row.company || 'unknown')
                         const set = visibleGroupsRef.current.get(key) || new Set<string>()
                         for (let i=0;i<n;i++){
                           const id = String((metaNodes?.[i] as any)?.id ?? '')
                           if (i>0 && set.has(id)) mask[i] = true
                         }
                       } else {
                         if (!centerId) return
                         const ids = await fetchNeighborIdsByCompany({ S: centerId, companyId: row.company_id || '', minOverlapMonths: MIN_OVERLAP_MONTHS })
                         const set = new Set(ids.map(String))
                         for (let i=0;i<n;i++){
                           const id = String((metaNodes?.[i] as any)?.id ?? '')
                           if (set.has(id)) mask[i] = true
                         }
                       }
                       onSetMaskMode?.('dim'); onMask(mask)
                     } catch {}
                   }}
                   style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', border:'1px solid var(--dt-border)', borderRadius:6, background:'var(--dt-fill-weak)', cursor:'pointer' }}>
                <div style={{ fontSize:12, color:'var(--dt-text)', flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {row.company || 'Unknown'}
                </div>
                <div style={{ fontSize:12, color:'var(--dt-text-dim)' }}>{row.count.toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

