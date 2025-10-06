import React from "react";
import { createPortal } from "react-dom";
import { browseCompanies, browsePeople } from "../lib/api";

export default function EntityBrowser({ onPick, onClose }: { onPick: (value: string) => void; onClose: () => void }){
  const [tab, setTab] = React.useState<'companies'|'people'>('companies')
  const [q, setQ] = React.useState('')
  const [items, setItems] = React.useState<Array<{ id:string, name:string, title?:string|null, company?:string|null }>>([])
  const [page, setPage] = React.useState<number>(0)
  const [nextPage, setNextPage] = React.useState<number|null>(0)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async (reset = false)=>{
    setLoading(true)
    try {
      const p = reset ? 0 : (nextPage ?? 0)
      if (tab === 'companies'){
        const res = await browseCompanies({ q, page: p, pageSize: 25 })
        setItems(prev => reset ? res.items : [...prev, ...res.items])
        setPage(p)
        setNextPage(res.nextPage ?? null)
      } else {
        const res = await browsePeople({ q, page: p, pageSize: 25 })
        setItems(prev => reset ? res.items : [...prev, ...res.items])
        setPage(p)
        setNextPage(res.nextPage ?? null)
      }
    } finally { setLoading(false) }
  }, [tab, q, nextPage])

  React.useEffect(()=>{ load(true) }, [tab])

  return createPortal(
    <div style={{ position:'fixed', left:0, right:0, top:0, bottom:0, background:'rgba(0,0,0,0.44)', display:'flex', alignItems:'flex-start', justifyContent:'center', zIndex:99999, overflow:'auto' }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ width: 640, margin:'8vh 0 6vh', maxHeight: '86vh', background:'var(--dt-bg)', border:'1px solid var(--dt-border)', borderRadius:12, display:'grid', gridTemplateRows:'auto auto 1fr auto', boxShadow:'0 10px 40px rgba(0,0,0,0.45)' }}>
        <div style={{ display:'flex', borderBottom:'1px solid var(--dt-border)' }}>
          <button onClick={()=> setTab('companies')} style={{ padding:'8px 12px', border:'none', background: tab==='companies' ? 'var(--dt-fill-med)' : 'transparent', color:'var(--dt-text)', cursor:'pointer' }}>Companies</button>
          <button onClick={()=> setTab('people')} style={{ padding:'8px 12px', border:'none', background: tab==='people' ? 'var(--dt-fill-med)' : 'transparent', color:'var(--dt-text)', cursor:'pointer' }}>People</button>
          <div style={{ flex:1 }} />
          <button onClick={onClose} style={{ padding:'8px 12px', border:'none', background:'transparent', color:'var(--dt-text)' }}>Close</button>
        </div>
        <div style={{ display:'flex', gap:8, padding:12, borderBottom:'1px solid var(--dt-border)' }}>
          <input value={q} onChange={e=> setQ(e.target.value)} placeholder={tab==='companies' ? 'Search companies…' : 'Search people…'}
                 onKeyDown={e=>{ if (e.key==='Enter') load(true) }}
                 style={{ flex:1, padding:'8px 10px', background:'var(--dt-fill-weak)', color:'var(--dt-text)', border:'1px solid var(--dt-border)', borderRadius:8 }} />
          <button onClick={()=> load(true)} style={{ padding:'8px 12px', border:'1px solid var(--dt-border)', background:'var(--dt-fill-med)', color:'var(--dt-text)', borderRadius:8 }}>Search</button>
        </div>
        <div style={{ overflow:'auto' }}>
          <div style={{ display:'grid' }}>
            {items.map((it)=> (
              <button key={`${tab}-${it.id}`} onClick={()=> onPick(tab==='companies' ? `company:${it.id}` : `person:${it.id}`)}
                      style={{ display:'flex', textAlign:'left', gap:8, padding:'8px 12px', border:'none', borderBottom:'1px solid var(--dt-border)', background:'transparent', color:'var(--dt-text)', cursor:'pointer' }}>
                <div style={{ fontSize:13, flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.name || it.id}</div>
                {tab==='people' && <div style={{ fontSize:12, color:'var(--dt-text-dim)' }}>{[it.title, it.company].filter(Boolean).join(' • ')}</div>}
              </button>
            ))}
            {(!loading && (nextPage != null)) && (
              <button onClick={()=> load(false)} style={{ padding:'10px 12px', border:'1px solid var(--dt-border)', background:'var(--dt-fill-weak)', color:'var(--dt-text)', margin:12, borderRadius:8 }}>Load more</button>
            )}
            {loading && <div style={{ padding:12, fontSize:12, color:'var(--dt-text-dim)' }}>Loading…</div>}
          </div>
        </div>
        <div style={{ padding:12, borderTop:'1px solid var(--dt-border)', display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button onClick={onClose} style={{ padding:'8px 12px', border:'1px solid var(--dt-border)', background:'var(--dt-fill-med)', color:'var(--dt-text)', borderRadius:8 }}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  )
}


