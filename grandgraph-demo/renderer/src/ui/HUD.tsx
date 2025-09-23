import React from "react";
import type { PersonProfile } from "../lib/api";

export default function HUD({ profile, profileOpen }:{ profile?: PersonProfile | null, profileOpen?: boolean }){
  if (!profileOpen || !profile) return null
  return (
    <div style={{ position:'absolute', right:16, top:64, zIndex:50, width:360, background:'var(--dt-bg-elev-1)', border:'1px solid var(--dt-border)', borderRadius:12, color:'var(--dt-text)', boxShadow:'0 12px 36px rgba(0,0,0,0.45)' }}>
      <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--dt-border)' }}>
        <div style={{ fontSize:16, fontWeight:700, color:'var(--dt-text)' }}>{profile.name || `person:${profile.id}`}</div>
        <div style={{ fontSize:12, opacity:0.85, color:'var(--dt-text-dim)' }}>{[profile.current_title, profile.current_company_name].filter(Boolean).join(' @ ')}</div>
      </div>
      <div style={{ maxHeight:280, overflow:'auto', padding:'10px 14px', display:'grid', gap:8 }}>
        {(profile.history||[]).slice(0,30).map((h, i)=> (
          <div key={i} style={{ fontSize:12, background:'var(--dt-bg-elev-1)', border:'1px solid var(--dt-border)', borderRadius:8, padding:'8px 10px', color:'var(--dt-text)' }}>
            <div style={{ fontWeight:600, color:'var(--dt-text)' }}>{h.title || '—'}</div>
            <div style={{ opacity:0.9, color:'var(--dt-text-dim)' }}>{h.company || '—'}</div>
            <div style={{ opacity:0.75, fontSize:11, color:'var(--dt-text-muted)' }}>{[h.start_date, h.end_date && h.end_date !== 'null' ? `→ ${h.end_date}` : '→ Present'].filter(Boolean).join(' ')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}


