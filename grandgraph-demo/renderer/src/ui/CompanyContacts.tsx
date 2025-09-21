import React, { useState } from "react";
import { resolveCompany, companyContacts } from "../lib/api";

export default function CompanyContacts(){
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Array<{ id: string, name: string, title: string|null, company: string|null, start_date?: string|null, end_date?: string|null, seniority?: number|null }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ id: string, name?: string } | null>(null);
  const [currentOnly, setCurrentOnly] = useState(false);

  async function onSearch(){
    const s = (query||"").trim(); if (!s) return;
    setLoading(true); setError(null); setContacts([]); setResolved(null);
    try {
      const rid = await resolveCompany(s);
      if (!rid){ setResolved(null); setContacts([]); setError('No matching company found.'); setLoading(false); return }
      const idStr = rid.replace(/^company:/,'');
      setResolved({ id: idStr });
      const rows = await companyContacts(rid, { currentOnly });
      setContacts(rows);
      // Try to enrich resolved name from results/company field
      try { if (rows && rows[0]?.company) setResolved({ id: idStr, name: rows[0].company||undefined }) } catch {}
    } catch (e:any) {
      const msg = e?.message || String(e)
      setError(msg)
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position:"absolute", top:56, left:12, right:12, bottom:12, zIndex:14, display:"grid", gridTemplateRows:"auto 1fr", gap:12 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <input
          value={query}
          onChange={e=>setQuery(e.currentTarget.value)}
          onKeyDown={e=>{ if (e.key==='Enter') onSearch() }}
          placeholder="Enter company name or domain (e.g., 'white.com')"
          style={{ padding:"10px 12px", borderRadius:10, background:"#111626", border:"1px solid rgba(255,255,255,0.18)", color:"#fff", minWidth:380 }}
        />
        <button onClick={onSearch} disabled={loading || !query.trim()} style={{ padding:"10px 12px", borderRadius:10, background: loading?"rgba(255,255,255,0.14)":"#4f7cff", color:"#fff", border:"1px solid rgba(255,255,255,0.18)" }}>{loading? 'Searching…':'Search'}</button>
        <label style={{ display:'flex', alignItems:'center', gap:8, marginLeft:8, color:'#cbd3ff', fontSize:13 }}>
          <input type="checkbox" checked={currentOnly} onChange={(e)=> setCurrentOnly(e.currentTarget.checked)} />
          Current only
        </label>
        {resolved && (
          <div style={{ marginLeft:12, fontSize:12, color:"#9ff0c8" }}>Resolved company: <span style={{ color:"#fff" }}>{resolved.name || '(unknown)'}</span> (id {resolved.id})</div>
        )}
      </div>
      <div style={{ border:"1px solid rgba(255,255,255,0.12)", borderRadius:12, background:"rgba(10,12,18,0.7)", overflow:"hidden" }}>
        {error && (
          <div style={{ position:'absolute', top:0, right:0, margin:12, padding:'10px 12px', color:'#ffbfc9', background:'rgba(200,40,60,0.22)', border:'1px solid rgba(255,80,100,0.35)', borderRadius:10, maxWidth:520 }}>
            {error}
          </div>
        )}
        {!error && !loading && contacts.length === 0 && (
          <div style={{ padding:16, color:"#cbd3ff" }}>No contacts yet. Try a different company name or domain.</div>
        )}
        {loading && (
          <div style={{ padding:16, color:"#cbd3ff" }}>Loading…</div>
        )}
        {!loading && contacts.length > 0 && (
          <div style={{ maxHeight:"calc(100% - 0px)", overflowY:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:"rgba(255,255,255,0.06)", color:"#9fb0ff" }}>
                  <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.12)", whiteSpace:'nowrap' }}>Name</th>
                  <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.12)", whiteSpace:'nowrap' }}>Title</th>
                  <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.12)", whiteSpace:'nowrap' }}>Start</th>
                  <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.12)", whiteSpace:'nowrap' }}>End</th>
                  <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.12)", whiteSpace:'nowrap' }}>Seniority</th>
                  <th style={{ width:60, textAlign:"left", padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.12)" }}></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c)=> {
                  const fmt = (d?: string|null)=>{
                    if (!d || d === 'null' || d === 'undefined') return '—'
                    const m = /^(\d{4})-(\d{2})/.exec(String(d))
                    return m ? `${m[1]}-${m[2]}` : '—'
                  }
                  const start = fmt(c.start_date)
                  const end = fmt(c.end_date)
                  const clip = `${c.name} — ${c.title||''} (${start}–${end})`
                  return (
                    <tr key={c.id}>
                      <td style={{ padding:"8px 10px", color:"#fff", borderBottom:"1px solid rgba(255,255,255,0.08)", whiteSpace:'nowrap' }}>{c.name}</td>
                      <td style={{ padding:"8px 10px", color:"#e7e7ef", borderBottom:"1px solid rgba(255,255,255,0.08)", whiteSpace:'nowrap', maxWidth:380, overflow:'hidden', textOverflow:'ellipsis' }}>{c.title || ''}</td>
                      <td style={{ padding:"8px 10px", color:"#cbd3ff", borderBottom:"1px solid rgba(255,255,255,0.08)", whiteSpace:'nowrap' }}>{start}</td>
                      <td style={{ padding:"8px 10px", color:"#cbd3ff", borderBottom:"1px solid rgba(255,255,255,0.08)", whiteSpace:'nowrap' }}>{end}</td>
                      <td style={{ padding:"8px 10px", color:"#cbd3ff", borderBottom:"1px solid rgba(255,255,255,0.08)", whiteSpace:'nowrap' }}>{(c.seniority ?? '') as any}</td>
                      <td style={{ padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                        <button onClick={()=> navigator.clipboard.writeText(clip)} style={{ padding:"6px 8px", borderRadius:8, background:"rgba(255,255,255,0.1)", color:'#fff', border:'1px solid rgba(255,255,255,0.2)' }}>Copy</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}


