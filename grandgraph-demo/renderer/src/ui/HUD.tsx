import React from "react";

export default function HUD({ focus, nodes, fps, selectedIndex, concentric, onToggleConcentric, onSettings, onBack, onForward, canBack, canForward }:{ focus: string | null, nodes: number, fps: number, selectedIndex?: number | null, concentric?: boolean, onToggleConcentric?: ()=>void, onSettings: ()=>void, onBack: ()=>void, onForward: ()=>void, canBack:boolean, canForward:boolean }){
  return (
    <div style={{ position:"absolute", top:10, right:10, zIndex:20, display:"flex", gap:8, alignItems:"center" }}>
      <div style={{ padding:"10px 12px", background:"rgba(10,10,20,0.6)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, color:"#9fb0ff" }}>
        Focus: <span style={{ color:"#fff" }}>{focus ?? "(none)"}</span>
        {selectedIndex != null && selectedIndex >= 0 && (
          <span style={{ marginLeft:10, color:'#ffc6f1' }}>Selected: #{selectedIndex}</span>
        )}
      </div>
      <div style={{ padding:"10px 12px", background:"rgba(10,10,20,0.6)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, color:"#9ff0c8" }}>
        {nodes} nodes • {fps.toFixed(0)} FPS
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <button disabled={!canBack} onClick={onBack} style={{ padding:"8px 10px", borderRadius:8, background:"rgba(255,255,255,0.08)", color:"#fff", opacity:canBack?1:0.4, border:"1px solid rgba(255,255,255,0.15)" }}>Back</button>
        <button disabled={!canForward} onClick={onForward} style={{ padding:"8px 10px", borderRadius:8, background:"rgba(255,255,255,0.08)", color:"#fff", opacity:canForward?1:0.4, border:"1px solid rgba(255,255,255,0.15)" }}>Forward</button>
      </div>
      {/* filters removed */}
      {onToggleConcentric && (
        <button onClick={onToggleConcentric} style={{ padding:"8px 10px", borderRadius:8, background: 'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)' }}>Concentric: {concentric? 'ON':'OFF'}</button>
      )}
      <button onClick={onSettings} style={{ padding:"10px 12px", borderRadius:12, background:"rgba(255,255,255,0.08)", color:"#fff", border:"1px solid rgba(255,255,255,0.15)" }}>Settings</button>
    </div>
  )
}


