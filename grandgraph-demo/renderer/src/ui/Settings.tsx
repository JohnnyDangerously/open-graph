import React, { useState } from "react";

export default function Settings({ apiBase, bearer, onSave, onClose }:{ apiBase: string, bearer: string, onSave:(v:{apiBase:string,bearer:string})=>void, onClose:()=>void }){
  const [base, setBase] = useState(apiBase);
  const [tok, setTok] = useState(bearer);
  const openDevtools = ()=>{
    try {
      const { ipcRenderer } = (window as any).require ? (window as any).require('electron') : { ipcRenderer: null }
      if (ipcRenderer && ipcRenderer.invoke) { ipcRenderer.invoke('open-devtools'); return }
      // Fallback: no-op in web build
    } catch {}
  }
  return (
    <div style={{ position:"absolute", inset:0, background:"var(--dt-overlay)", display:"grid", placeItems:"center", zIndex:30 }}>
      <div style={{ width:460, padding:20, borderRadius:16, background:"var(--dt-bg-elev-1)", color:"var(--dt-text)", border:"1px solid var(--dt-border)", boxShadow:"0 12px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ fontSize:18, marginBottom:12 }}>Settings</div>
        <div style={{ display:"grid", gap:10 }}>
          <label style={{ fontSize:12, opacity:0.8, color:"var(--dt-text-dim)" }}>API Base</label>
          <input value={base} onChange={e=>setBase(e.target.value)} style={{ padding:"10px 12px", borderRadius:10, background:"var(--dt-bg-elev-2)", border:"1px solid var(--dt-border)", color:"var(--dt-text)" }}/>
          <label style={{ fontSize:12, opacity:0.8, color:"var(--dt-text-dim)" }}>Bearer (optional)</label>
          <input value={tok} onChange={e=>setTok(e.target.value)} style={{ padding:"10px 12px", borderRadius:10, background:"var(--dt-bg-elev-2)", border:"1px solid var(--dt-border)", color:"var(--dt-text)" }}/>
          <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid var(--dt-border)' }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>Developer</div>
            <button onClick={openDevtools} style={{ padding:"10px 12px", borderRadius:10, background:"var(--dt-fill-med)", color:"var(--dt-text)", border:"1px solid var(--dt-border)" }}>Open Dev Console</button>
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:16 }}>
          <button onClick={onClose} style={{ padding:"10px 12px", borderRadius:10, background:"var(--dt-fill-med)", color:"var(--dt-text)", border:"1px solid var(--dt-border)" }}>Cancel</button>
          <button onClick={()=>{ try{ localStorage.setItem('API_BASE', base); localStorage.setItem('API_BEARER', tok) }catch{}; onSave({apiBase:base,bearer:tok}) }} style={{ padding:"10px 12px", borderRadius:10, background:"var(--dt-accent)", color:"#fff", border:"1px solid var(--dt-border)" }}>Save</button>
        </div>
      </div>
    </div>
  )
}


