import React, { useState } from "react";

export default function Sidebar({ open=true, onToggle, items, onSelect, onDoubleSelect, selectedIndex }:{ open?: boolean, onToggle: ()=>void, items: Array<{index:number, group:number, flag?:number, name?:string, title?: string|null, avatarUrl?: string}>, onSelect: (i:number)=>void, onDoubleSelect?: (i:number)=>void, selectedIndex?: number|null }){
  const [isOpen, setIsOpen] = useState(open)
  const toggle = ()=>{ setIsOpen(!isOpen); onToggle() }
  return (
    <div style={{ position:'absolute', top:0, right:0, height:'100%', width: isOpen ? 320 : 32, transition:'width 160ms ease', zIndex:30 }}>
      <div onClick={toggle} title={isOpen?"Collapse":"Expand"} style={{ position:'absolute', left:0, top:56, width:32, height:32, borderRadius:8, background:'var(--dt-fill-med)', color:'var(--dt-text)', display:'grid', placeItems:'center', cursor:'pointer', border:'1px solid var(--dt-border)', boxShadow:'0 6px 20px rgba(0,0,0,0.35)', zIndex: 100 }}>{isOpen?'❯':'❮'}</div>
      {isOpen && (
        <div style={{ position:'absolute', right:0, top:0, bottom:0, width:320, padding:'42px 12px 12px 12px', background:'var(--dt-bg-elev-1)', borderLeft:'1px solid var(--dt-border)', color:'var(--dt-text)', overflow:'auto' }}>
          <div style={{ fontSize:16, marginBottom:10, color:'var(--dt-text)' }}>Nodes</div>
          <div style={{ display:'grid', gap:6 }}>
            {items.slice(0,300).map((it)=> {
              const isSel = typeof selectedIndex==='number' && selectedIndex===it.index
              return (
              <div key={it.index} onClick={()=>onSelect(it.index)} onDoubleClick={()=> onDoubleSelect?.(it.index)} style={{ padding:'8px 10px', borderRadius:8, background: isSel? 'var(--dt-fill-strong)':'var(--dt-fill-weak)', border: isSel? '1px solid var(--dt-border-strong)':'1px solid var(--dt-border)', cursor:'pointer' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {it.avatarUrl ? (
                    <img src={it.avatarUrl} alt={it.name || `#${it.index}`}
                      style={{ width:24, height:24, borderRadius:6, objectFit:'cover', flex:'0 0 auto', background:'var(--dt-fill-med)', border:'1px solid var(--dt-border)' }} />
                  ) : (
                    <div style={{ width:24, height:24, borderRadius:6, display:'grid', placeItems:'center', background:'var(--dt-fill-weak)', border:'1px solid var(--dt-border)', color:'var(--dt-text)', fontSize:11 }}>
                      {(it.name||'')[0]?.toUpperCase() || '#'}
                    </div>
                  )}
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:'var(--dt-text)' }}>{it.name || `#${it.index}`}</div>
                    {it.title && (
                      <div style={{ fontSize:11, opacity:0.72, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:'var(--dt-text-dim)' }}>{it.title}</div>
                    )}
                  </div>
                </div>
              </div>
            )})}
          </div>
        </div>
      )}
    </div>
  )
}


