import React from "react";

export default function HUD({ focus, nodes, fps, selectedIndex, onSettings, onBack, onForward, canBack, canForward, onReshape }:{ focus: string | null, nodes: number, fps: number, selectedIndex?: number | null, onSettings: ()=>void, onBack: ()=>void, onForward: ()=>void, canBack:boolean, canForward:boolean, onReshape?: (mode:'hierarchy'|'radial'|'grid'|'concentric')=>void }){
  return (
    <div style={{ position:"absolute", bottom:156, left:14, right:14, zIndex:22, display:"flex", flexDirection:'row', flexWrap:'wrap', gap:6, alignItems:"center" }}>
      <div style={{ padding:"4px 6px", background:"rgba(10,10,20,0.6)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, color:"#9fb0ff", fontSize:12 }}>
        Focus: <span style={{ color:"#fff" }}>{focus ?? "(none)"}</span>
        {selectedIndex != null && selectedIndex >= 0 && (
          <span style={{ marginLeft:8, color:'#ffc6f1' }}>Selected: #{selectedIndex}</span>
        )}
      </div>
      <div style={{ padding:"4px 6px", background:"rgba(10,10,20,0.6)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, color:"#9ff0c8", fontSize:12 }}>
        {nodes} nodes • {fps.toFixed(0)} FPS
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <button disabled={!canBack} onClick={onBack} style={{ padding:"4px 8px", borderRadius:8, background:"rgba(255,255,255,0.08)", color:"#fff", opacity:canBack?1:0.4, border:"1px solid rgba(255,255,255,0.15)", fontSize:12 }}>Back</button>
        <button disabled={!canForward} onClick={onForward} style={{ padding:"4px 8px", borderRadius:8, background:"rgba(255,255,255,0.08)", color:"#fff", opacity:canForward?1:0.4, border:"1px solid rgba(255,255,255,0.15)", fontSize:12 }}>Forward</button>
      </div>
      {/* concentric toggle removed */}
      {onReshape && (
        <div style={{ display:'flex', gap:6, alignItems:'center', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, padding:4, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:'#ddd', opacity:0.9, padding:'0 6px' }}>Layout</span>
          <button onClick={()=>onReshape('hierarchy')} style={{ padding:'2px 6px', borderRadius:6, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.12)', fontSize:11 }}>Hierarchy</button>
          <button onClick={()=>onReshape('radial')} style={{ padding:'2px 6px', borderRadius:6, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.12)', fontSize:11 }}>Radial</button>
          <button onClick={()=>onReshape('grid')} style={{ padding:'2px 6px', borderRadius:6, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.12)', fontSize:11 }}>Grid</button>
          <button onClick={()=>onReshape('concentric')} style={{ padding:'2px 6px', borderRadius:6, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.12)', fontSize:11 }}>Concentric</button>
        </div>
      )}
      <button onClick={onSettings} style={{ padding:"4px 8px", borderRadius:8, background:"rgba(255,255,255,0.08)", color:"#fff", border:"1px solid rgba(255,255,255,0.15)", whiteSpace:'nowrap', fontSize:12 }}>Settings</button>
    </div>
  )
}


