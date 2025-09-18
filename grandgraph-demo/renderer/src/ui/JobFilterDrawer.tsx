import React, { useMemo, useState } from "react";

export default function JobFilterDrawer({ open=true, onClose, titles, selected, onChange, mode='include', onModeChange }:{ open?: boolean, onClose: ()=>void, titles: string[], selected: string[], onChange: (next:string[])=>void, mode?: 'include'|'exclude', onModeChange?: (m:'include'|'exclude')=>void }){
  const [query, setQuery] = useState("")
  const set = useMemo(()=> new Set(selected), [selected])
  const shown = useMemo(()=>{
    const q = query.trim().toLowerCase()
    const arr = Array.from(new Set(titles.filter(Boolean)))
    const filtered = q ? arr.filter(t=> t.toLowerCase().includes(q)) : arr
    // limit for perf
    return filtered.slice(0, 200)
  }, [titles, query])
  const presets = [
    'Engineer','Software','Product','Designer','Data','Analytics','Sales','Marketing','Finance','Operations','HR','Recruit','Support','Success','Legal','Executive','Founder','CTO','CFO','CEO','VP','Director','Manager'
  ]

  if (!open) return null
  return (
    <div style={{ position:'absolute', right:0, top:0, bottom:0, width:340, background:'rgba(12,14,22,0.95)', borderLeft:'1px solid rgba(255,255,255,0.08)', color:'#fff', padding:'14px 12px', zIndex:44 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <div style={{ fontSize:16, fontWeight:600 }}>Job Filters</div>
        <div style={{ flex:1 }} />
        <button onClick={onClose} style={{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)' }}>Close</button>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <span style={{ fontSize:12, opacity:0.85 }}>Mode</span>
        <button onClick={()=> onModeChange?.('include')} style={{ padding:'6px 10px', borderRadius:8, background: mode==='include'?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)' }}>Include</button>
        <button onClick={()=> onModeChange?.('exclude')} style={{ padding:'6px 10px', borderRadius:8, background: mode==='exclude'?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)' }}>Exclude</button>
      </div>
      <input
        placeholder="Search job titles…"
        value={query}
        onChange={(e)=> setQuery(e.target.value)}
        style={{ width:'100%', padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)', outline:'none', marginBottom:10 }}
      />
      <div style={{ display:'flex', gap:8, marginBottom:10 }}>
        <button onClick={()=> onChange([])} style={{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)' }}>Clear</button>
        <button onClick={()=> onChange(shown)} style={{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)' }}>Select Shown</button>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
        {presets.map(p=>{
          const checked = set.has(p)
          return (
            <button key={p} onClick={()=>{ const next = new Set(set); if (checked) next.delete(p); else next.add(p); onChange(Array.from(next)) }} title={checked?"Remove preset":"Add preset"} style={{ padding:'6px 10px', borderRadius:999, background: checked?'rgba(255,255,255,0.25)':'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)', fontSize:12 }}>
              {p}
            </button>
          )
        })}
      </div>
      <div style={{ overflow:'auto', position:'absolute', top:116, bottom:12, left:12, right:12 }}>
        <div style={{ display:'grid', gap:6 }}>
          {shown.map((t)=>{
            const checked = set.has(t)
            return (
              <label key={t} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderRadius:8, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)' }}>
                <input type="checkbox" checked={checked} onChange={(e)=>{
                  const next = new Set(set)
                  if (e.target.checked) next.add(t); else next.delete(t)
                  onChange(Array.from(next))
                }} />
                <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t}</span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}


