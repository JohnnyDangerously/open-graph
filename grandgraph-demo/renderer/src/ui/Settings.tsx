import React, { useState } from "react";

export default function Settings({ apiBase, bearer, onSave, onClose, features, onFeaturesChange }:{ apiBase: string, bearer: string, onSave:(v:{apiBase:string,bearer:string,user?:string,password?:string,profilesDb?:string,viaDb?:string})=>void, onClose:()=>void, features?: { enableNlq?: boolean, enableCompanyId?: boolean }, onFeaturesChange?: (v:{ enableNlq:boolean, enableCompanyId:boolean })=>void }){
  const [base, setBase] = useState(apiBase);
  const [tok, setTok] = useState(bearer);
  const [user, setUser] = useState<string>(()=>{ try{ return localStorage.getItem('API_USER') || '' }catch{return ''} })
  const [password, setPassword] = useState<string>(()=>{ try{ return localStorage.getItem('API_PASSWORD') || '' }catch{return ''} })
  const [profilesDb, setProfilesDb] = useState<string>(()=>{ try{ return localStorage.getItem('DB_PROFILES') || 'default' }catch{return 'default'} })
  const [viaDb, setViaDb] = useState<string>(()=>{ try{ return localStorage.getItem('DB_VIA') || 'via_cluster' }catch{return 'via_cluster'} })
  const [nlq, setNlq] = useState<boolean>(()=> (features?.enableNlq ?? (()=>{ try{ return localStorage.getItem('FEATURE_NLQ')==='1' }catch{return false} })()));
  const [companyLookup, setCompanyLookup] = useState<boolean>(()=> (features?.enableCompanyId ?? (()=>{ try{ return localStorage.getItem('FEATURE_COMPANY_ID')==='1' }catch{return false} })()));
  const [openai, setOpenai] = useState<string>(()=>{ try{ return localStorage.getItem('OPENAI_API_KEY') || '' } catch { return '' } })
  const handleSave = ()=>{
    try {
      // Persist with current keys; keep legacy key for compatibility
      localStorage.setItem('API_BASE_URL', base);
      localStorage.setItem('API_BASE', base);
      localStorage.setItem('API_BEARER', tok);
      if (openai) localStorage.setItem('OPENAI_API_KEY', openai);
      if (user) localStorage.setItem('API_USER', user);
      if (password) localStorage.setItem('API_PASSWORD', password);
      if (profilesDb) localStorage.setItem('DB_PROFILES', profilesDb);
      if (viaDb) localStorage.setItem('DB_VIA', viaDb);
    } catch {}
    onSave({ apiBase: base, bearer: tok, user, password, profilesDb, viaDb });
  }
  const handleFeatureToggle = (next:{ enableNlq:boolean, enableCompanyId:boolean })=>{
    setNlq(next.enableNlq)
    setCompanyLookup(next.enableCompanyId)
    try{ localStorage.setItem('FEATURE_NLQ', next.enableNlq ? '1' : '0'); localStorage.setItem('FEATURE_COMPANY_ID', next.enableCompanyId ? '1' : '0') }catch{}
    onFeaturesChange?.(next)
  }
  return (
    <div style={{ position:"absolute", inset:0, zIndex:30 }}>
      {/* overlay */}
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"var(--dt-overlay)" }} />
      {/* right drawer */}
      <div style={{ position:"absolute", top:0, right:0, bottom:0, width:420, background:"var(--dt-bg-elev-1)", borderLeft:"1px solid var(--dt-border)", boxShadow:"-12px 0 48px rgba(0,0,0,0.45)", color:"var(--dt-text)", display:"grid", gridTemplateRows:"auto 1fr auto" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 14px", borderBottom:"1px solid var(--dt-border)" }}>
          <div style={{ fontSize:16, fontWeight:700 }}>Settings</div>
          <button onClick={onClose} title="Close" style={{ padding:"6px 10px", borderRadius:8, background:"var(--dt-fill-med)", color:"var(--dt-text)", border:"1px solid var(--dt-border)" }}>✕</button>
        </div>
        <div style={{ padding:14, overflow:"auto", display:"grid", gap:14 }}>
          <div>
            <div style={{ fontSize:12, opacity:0.8, color:"var(--dt-text-dim)", marginBottom:6 }}>API Base</div>
            <input value={base} onChange={e=>setBase(e.target.value)} placeholder="http://host:port" style={{ width:'100%', padding:"10px 12px", borderRadius:10, background:"var(--dt-bg-elev-2)", border:"1px solid var(--dt-border)", color:"var(--dt-text)" }}/>
          </div>
          <div>
            <div style={{ fontSize:12, opacity:0.8, color:"var(--dt-text-dim)", marginBottom:6 }}>Bearer (optional)</div>
            <input value={tok} onChange={e=>setTok(e.target.value)} placeholder="token" style={{ width:'100%', padding:"10px 12px", borderRadius:10, background:"var(--dt-bg-elev-2)", border:"1px solid var(--dt-border)", color:"var(--dt-text)" }}/>
          </div>
          <div>
            <div style={{ fontSize:12, opacity:0.8, color:"var(--dt-text-dim)", marginBottom:6 }}>OpenAI API Key</div>
            <input value={openai} onChange={e=>setOpenai(e.target.value)} placeholder="sk-..." style={{ width:'100%', padding:"10px 12px", borderRadius:10, background:"var(--dt-bg-elev-2)", border:"1px solid var(--dt-border)", color:"var(--dt-text)" }} type="password" />
          </div>
          <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid var(--dt-border)' }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>Database</div>
            <div style={{ display:'grid', gap:10 }}>
              <div style={{ display:'grid', gap:6 }}>
                <div style={{ fontSize:12, opacity:0.8, color:'var(--dt-text-dim)' }}>ClickHouse User (optional)</div>
                <input value={user} onChange={e=>setUser(e.target.value)} placeholder="username" style={{ width:'100%', padding:'10px 12px', borderRadius:10, background:'var(--dt-bg-elev-2)', border:'1px solid var(--dt-border)', color:'var(--dt-text)' }} />
              </div>
              <div style={{ display:'grid', gap:6 }}>
                <div style={{ fontSize:12, opacity:0.8, color:'var(--dt-text-dim)' }}>ClickHouse Password</div>
                <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="password" type="password" style={{ width:'100%', padding:'10px 12px', borderRadius:10, background:'var(--dt-bg-elev-2)', border:'1px solid var(--dt-border)', color:'var(--dt-text)' }} />
              </div>
              <div style={{ display:'grid', gap:6, gridTemplateColumns:'1fr 1fr' }}>
                <div>
                  <div style={{ fontSize:12, opacity:0.8, color:'var(--dt-text-dim)' }}>Profiles DB</div>
                  <input value={profilesDb} onChange={e=>setProfilesDb(e.target.value)} placeholder="default" style={{ width:'100%', padding:'10px 12px', borderRadius:10, background:'var(--dt-bg-elev-2)', border:'1px solid var(--dt-border)', color:'var(--dt-text)' }} />
                </div>
                <div>
                  <div style={{ fontSize:12, opacity:0.8, color:'var(--dt-text-dim)' }}>Via DB</div>
                  <input value={viaDb} onChange={e=>setViaDb(e.target.value)} placeholder="via_cluster" style={{ width:'100%', padding:'10px 12px', borderRadius:10, background:'var(--dt-bg-elev-2)', border:'1px solid var(--dt-border)', color:'var(--dt-text)' }} />
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid var(--dt-border)' }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>Features (Alpha)</div>
            <div style={{ display:'grid', gap:10 }}>
              <label style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'8px 10px', border:'1px solid var(--dt-border)', borderRadius:10, background:'var(--dt-bg-elev-2)' }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:600 }}>Natural Language Query</div>
                  <div style={{ fontSize:11, opacity:0.75 }}>Type questions in plain English to generate graph queries</div>
                </div>
                <input
                  type="checkbox"
                  checked={nlq}
                  onChange={e=> handleFeatureToggle({ enableNlq: e.target.checked, enableCompanyId: companyLookup })}
                  title="Enable Natural Language Query (Alpha)"
                />
              </label>
              <label style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'8px 10px', border:'1px solid var(--dt-border)', borderRadius:10, background:'var(--dt-bg-elev-2)' }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:600 }}>Company ID Lookup</div>
                  <div style={{ fontSize:11, opacity:0.75 }}>Resolve company names to canonical company:&lt;id&gt;</div>
                </div>
                <input
                  type="checkbox"
                  checked={companyLookup}
                  onChange={e=> handleFeatureToggle({ enableNlq: nlq, enableCompanyId: e.target.checked })}
                  title="Enable Company ID Lookup (Alpha)"
                />
              </label>
            </div>
          </div>
          {/* Future groups: Appearance, Rendering, Labels, Simulation */}
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8, padding:14, borderTop:"1px solid var(--dt-border)" }}>
          <button onClick={onClose} style={{ padding:"10px 12px", borderRadius:10, background:"var(--dt-fill-med)", color:"var(--dt-text)", border:"1px solid var(--dt-border)" }}>Cancel</button>
          <button onClick={handleSave} style={{ padding:"10px 12px", borderRadius:10, background:"var(--dt-accent)", color:"#fff", border:"1px solid var(--dt-border)" }}>Save</button>
        </div>
      </div>
    </div>
  )
}


