import React, { useState } from "react";

export default function Sidebar({ open=true, onToggle, items, onSelect, onDoubleSelect }:{ open?: boolean, onToggle: ()=>void, items: Array<{index:number, group:number, flag?:number, name?:string, avatarUrl?: string}>, onSelect: (i:number)=>void, onDoubleSelect?: (i:number)=>void }){
  const [isOpen, setIsOpen] = useState(open)
  const toggle = ()=>{ setIsOpen(!isOpen); onToggle() }
  return (
    <div style={{ position:'absolute', top:0, right:0, height:'100%', width: isOpen ? 320 : 32, transition:'width 160ms ease', zIndex:30 }}>
      <div onClick={toggle} title={isOpen?"Collapse":"Expand"} style={{ position:'absolute', left:0, top:56, width:32, height:32, borderRadius:8, background:'rgba(255,255,255,0.12)', color:'#fff', display:'grid', placeItems:'center', cursor:'pointer', border:'1px solid rgba(255,255,255,0.2)', boxShadow:'0 6px 20px rgba(0,0,0,0.35)', zIndex: 100 }}>{isOpen?'❯':'❮'}</div>
      {isOpen && (
        <div style={{ position:'absolute', right:0, top:0, bottom:0, width:320, padding:'42px 12px 12px 12px', background:'rgba(12,14,22,0.9)', borderLeft:'1px solid rgba(255,255,255,0.08)', backdropFilter:'blur(8px)', color:'#fff', overflow:'auto' }}>
          <div style={{ fontSize:16, marginBottom:10, opacity:0.85 }}>Nodes</div>
          <div style={{ display:'grid', gap:6 }}>
            {items.slice(0,300).map((it)=> (
              <div key={it.index} onClick={()=>onSelect(it.index)} onDoubleClick={()=> onDoubleSelect?.(it.index)} style={{ padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {it.avatarUrl ? (
                    <img src={it.avatarUrl} alt={it.name || `#${it.index}`}
                      style={{ width:24, height:24, borderRadius:6, objectFit:'cover', flex:'0 0 auto', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.15)' }} />
                  ) : (
                    <div style={{ width:24, height:24, borderRadius:6, display:'grid', placeItems:'center', background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.12)', color:'#fff', fontSize:11 }}>
                      {(it.name||'')[0]?.toUpperCase() || '#'}
                    </div>
                  )}
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.name || `#${it.index}`}</div>
                    <div style={{ fontSize:11, opacity:0.75 }}>group {it.group}{it.flag!==undefined?` • flags ${it.flag}`:''}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


