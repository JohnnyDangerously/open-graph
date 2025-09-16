import React, { useState } from "react";

export default function Settings({ apiBase, bearer, onSave, onClose }:{ apiBase: string, bearer: string, onSave:(v:{apiBase:string,bearer:string})=>void, onClose:()=>void }){
  const [base, setBase] = useState(apiBase);
  const [tok, setTok] = useState(bearer);
  return (
    <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.35)", display:"grid", placeItems:"center", zIndex:30 }}>
      <div style={{ width:460, padding:20, borderRadius:16, background:"#0e0f18", color:"#fff", border:"1px solid rgba(255,255,255,0.1)", boxShadow:"0 12px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ fontSize:18, marginBottom:12 }}>Settings</div>
        <div style={{ display:"grid", gap:10 }}>
          <label style={{ fontSize:12, opacity:0.8 }}>API Base</label>
          <input value={base} onChange={e=>setBase(e.target.value)} style={{ padding:"10px 12px", borderRadius:10, background:"#111626", border:"1px solid rgba(255,255,255,0.12)", color:"#fff" }}/>
          <label style={{ fontSize:12, opacity:0.8 }}>Bearer (optional)</label>
          <input value={tok} onChange={e=>setTok(e.target.value)} style={{ padding:"10px 12px", borderRadius:10, background:"#111626", border:"1px solid rgba(255,255,255,0.12)", color:"#fff" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:16 }}>
          <button onClick={onClose} style={{ padding:"10px 12px", borderRadius:10, background:"rgba(255,255,255,0.08)", color:"#fff", border:"1px solid rgba(255,255,255,0.15)" }}>Cancel</button>
          <button onClick={()=>{ try{ localStorage.setItem('API_BASE', base); localStorage.setItem('API_BEARER', tok) }catch{}; onSave({apiBase:base,bearer:tok}) }} style={{ padding:"10px 12px", borderRadius:10, background:"#4f7cff", color:"#fff", border:"1px solid rgba(255,255,255,0.15)" }}>Save</button>
        </div>
      </div>
    </div>
  )
}


