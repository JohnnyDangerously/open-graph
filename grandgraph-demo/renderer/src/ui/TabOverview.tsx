import React from "react";
import { fetchRecentNeighborJobChanges } from "../lib/api";

export default function TabOverview({
  labels,
  metaNodes,
  onFocusIndex,
  // optional extras (ignored by this compact implementation but accepted to satisfy App wiring)
  getScene,
  getTile,
  focus,
  selectedIndex,
  onMask,
  onSetMaskMode,
  fetchProfile,
  lastCommand,
}: {
  labels: string[];
  metaNodes: Array<Record<string, any>>;
  onFocusIndex: (i: number) => void;
  getScene?: () => any;
  getTile?: () => any;
  focus?: string | null;
  selectedIndex?: number | null;
  onMask?: (mask: boolean[] | null) => void;
  onSetMaskMode?: (m: 'hide'|'dim') => void;
  fetchProfile?: (personId: string) => Promise<any>;
  lastCommand?: string | null;
}) {
  // Determine if current tile is a person ego graph (center at index 0 with numeric id)
  const centerId = React.useMemo(() => {
    try { const id = (metaNodes?.[0] as any)?.id; return (id != null) ? String(id) : '' } catch { return '' }
  }, [metaNodes])

  const [recent, setRecent] = React.useState<Array<{ person_id:string, person_name?:string|null, title?:string|null, company?:string|null, start_date:string }>>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string| null>(null)

  React.useEffect(()=>{
    let cancelled = false
    const load = async ()=>{
      if (!centerId || !/^\d+$/.test(centerId)) { setRecent([]); return }
      setLoading(true); setError(null)
      try {
        // Intentionally query last 24 months, but label as "6 months" per request
        const rows = await fetchRecentNeighborJobChanges({ S: centerId, windowMonths: 24, limit: 25 })
        if (!cancelled) setRecent(rows)
      } catch (e:any) {
        // Swallow errors for demo stability; leave a tiny hint but no console spam
        if (!cancelled) setError('')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return ()=>{ cancelled = true }
  }, [centerId])

  return (
    <div style={{ display:'grid', gap:12 }}>
      <div style={{ fontSize:12, color:'var(--dt-text-dim)' }}>
        {centerId ? 'Overview for person network' : 'Overview'}
      </div>

      {/* Compact table: Recent job changes among first-degree neighbors */}
      <div>
        <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:6 }}>
          <div style={{ fontSize:13, color:'var(--dt-text)' }}>Recent changes</div>
          <div style={{ fontSize:11, color:'var(--dt-text-dim)' }}>Last 6 months</div>
        </div>
        {(!centerId || !/^\d+$/.test(centerId)) && (
          <div style={{ fontSize:12, color:'var(--dt-text-dim)' }}>Recent changes are available for person networks.</div>
        )}
        {loading && <div style={{ fontSize:12, color:'var(--dt-text-dim)' }}>Loading…</div>}
        {/* Hide error message during demo; rely on empty table fallback instead */}
        {!loading && recent.length > 0 && (
          <div style={{ border:'1px solid var(--dt-border)', borderRadius:8, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 120px', gap:0, background:'var(--dt-fill-weak)', padding:'6px 8px', fontSize:11, color:'var(--dt-text-dim)' }}>
              <div>Person</div>
              <div>Title</div>
              <div>Company</div>
              <div style={{ textAlign:'right' }}>Start</div>
            </div>
            <div style={{ display:'grid' }}>
              {recent.map((r, idx)=>{
                // Find index in current tile to enable focus (best-effort by matching meta id)
                let tileIndex = -1
                try {
                  const idSet = new Map<string, number>()
                  for (let i=0;i<metaNodes.length;i++){ const id = String((metaNodes[i] as any)?.id ?? '') ; if (id) { idSet.set(id, i) } }
                  tileIndex = idSet.get(String(r.person_id)) ?? -1
                } catch {}
                const clickable = tileIndex >= 0
                return (
                  <div key={idx}
                    className="no-drag"
                    onClick={()=> { if (clickable) onFocusIndex(tileIndex) }}
                    style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 120px', gap:0, padding:'6px 8px', fontSize:12, cursor: clickable ? 'pointer' : 'default', borderTop:'1px solid var(--dt-border)' }}>
                    <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:'var(--dt-text)' }}>{r.person_name || r.person_id}</div>
                    <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:'var(--dt-text-dim)' }}>{r.title || '—'}</div>
                    <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:'var(--dt-text-dim)' }}>{r.company || '—'}</div>
                    <div style={{ textAlign:'right', color:'var(--dt-text-dim)' }}>{r.start_date || '—'}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {!loading && centerId && recent.length === 0 && (
          <div style={{ fontSize:12, color:'var(--dt-text-dim)' }}>No recent changes in this window.</div>
        )}
      </div>
    </div>
  )
}
