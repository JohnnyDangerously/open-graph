import React, { useState } from "react";
import "./App.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import LoginScene from "./graph/LoginScene";
// UX demo removed

function Root(){
  const [view, setView] = useState<'app'>('app')
  const [connected, setConnected] = useState(false)
  const [blend, setBlend] = useState(false)
  const [dense, setDense] = useState<boolean>(()=>{
    try {
      const sp = new URLSearchParams(window.location.search)
      const q = sp.get('dense')
      if (q === '1') { localStorage.setItem('DENSE_LOGIN','1'); return true }
      if (q === '0') { localStorage.removeItem('DENSE_LOGIN'); return false }
      return localStorage.getItem('DENSE_LOGIN') === '1'
    } catch { return false }
  })
  const [palette, setPalette] = useState<'default'|'random'|'whiteBlue'|'allWhite'|'whiteBluePurple'>(()=>{
    try {
      const stored = localStorage.getItem('PALETTE_LOGIN');
      if (!stored) return 'whiteBluePurple';
      return (stored === 'default' ? 'whiteBluePurple' : (stored as any));
    } catch { return 'whiteBluePurple' }
  })
  const [brightness, setBrightness] = useState<number>(()=>{
    try { return parseFloat(localStorage.getItem('BRIGHTNESS_LOGIN')||'1') } catch { return 1 }
  })
  const [showEdges, setShowEdges] = useState<boolean>(()=>{
    try {
      const v = localStorage.getItem('EDGES_ON');
      if (v === null) return true; // default ON
      return v === '1';
    } catch { return true }
  })
  const [edgeMultiplier, setEdgeMultiplier] = useState<number>(()=>{
    try { return parseInt(localStorage.getItem('EDGE_MULT')||'3', 10) || 3 } catch { return 3 }
  })
  React.useEffect(()=>{ try { localStorage.setItem('EDGE_MULT', String(edgeMultiplier)) } catch {} }, [edgeMultiplier])
  React.useEffect(()=>{ try { localStorage.setItem('EDGES_ON', showEdges ? '1':'0') } catch {} }, [showEdges])
  React.useEffect(()=>{ try { if (palette) localStorage.setItem('PALETTE_LOGIN', palette) } catch {} }, [palette])
  const [fourCores, setFourCores] = useState<boolean>(false)
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false)
  const [nodeScale, setNodeScale] = useState<number>(()=>{ try { return parseFloat(localStorage.getItem('NODE_SCALE')||'1') } catch { return 1 } })
  const [edgeFraction, setEdgeFraction] = useState<number>(()=>{ try { return parseFloat(localStorage.getItem('EDGE_FRACTION')||'1') } catch { return 1 } })
  const [edgeAlpha, setEdgeAlpha] = useState<number>(()=>{ try { return parseFloat(localStorage.getItem('EDGE_ALPHA')||'1') } catch { return 1 } })
  const [sizeScale, setSizeScale] = useState<number>(()=>{ try { return parseFloat(localStorage.getItem('SIZE_SCALE')||'1') } catch { return 1 } })
  const [rotSpeed, setRotSpeed] = useState<number>(()=>{ try { return parseFloat(localStorage.getItem('ROT_SPEED')||'0.02') } catch { return 0.02 } })
  const [edgeColor, setEdgeColor] = useState<string>(()=>{ try { return localStorage.getItem('EDGE_COLOR') || '#4da3ff' } catch { return '#4da3ff' } })
  const [sideHole, setSideHole] = useState<boolean>(()=>{ try { return localStorage.getItem('SIDE_HOLE') === '1' } catch { return false } })
  const [sectorDensity, setSectorDensity] = useState<boolean>(()=>{ try { return localStorage.getItem('SECTOR_DENSITY') === '1' } catch { return false } })
  const [bgPaused, setBgPaused] = useState<boolean>(true)
  const [bgRotSpeed, setBgRotSpeed] = useState<number>(0.0)
  React.useEffect(()=>{ try{ localStorage.setItem('NODE_SCALE', String(nodeScale)) }catch{} }, [nodeScale])
  React.useEffect(()=>{ try{ localStorage.setItem('EDGE_FRACTION', String(edgeFraction)) }catch{} }, [edgeFraction])
  React.useEffect(()=>{ try{ localStorage.setItem('EDGE_ALPHA', String(edgeAlpha)) }catch{} }, [edgeAlpha])
  React.useEffect(()=>{ try{ localStorage.setItem('SIZE_SCALE', String(sizeScale)) }catch{} }, [sizeScale])
  React.useEffect(()=>{ try{ localStorage.setItem('ROT_SPEED', String(rotSpeed)) }catch{} }, [rotSpeed])
  React.useEffect(()=>{ try{ localStorage.setItem('EDGE_COLOR', edgeColor) }catch{} }, [edgeColor])
  React.useEffect(()=>{ try{ localStorage.setItem('SIDE_HOLE', sideHole ? '1':'0') }catch{} }, [sideHole])
  React.useEffect(()=>{ try{ localStorage.setItem('SECTOR_DENSITY', sectorDensity ? '1':'0') }catch{} }, [sectorDensity])
  React.useEffect(()=>{
    const onKey = (e: KeyboardEvent)=>{
      if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)){
        setDense(v=>{ const nv = !v; try { if(nv) localStorage.setItem('DENSE_LOGIN','1'); else localStorage.removeItem('DENSE_LOGIN') } catch {}; return nv })
      }
    }
    window.addEventListener('keydown', onKey)
    return ()=> window.removeEventListener('keydown', onKey)
  },[])
  // Save current style once if not saved
  React.useEffect(()=>{
    try {
      if (!localStorage.getItem('STYLE_PRESET_LOGIN')){
        const preset = { dense, palette, brightness, showEdges, edgeMultiplier, fourCores };
        localStorage.setItem('STYLE_PRESET_LOGIN', JSON.stringify(preset));
      }
    } catch {}
  }, [])
  const applyPreset = ()=>{
    try {
      const raw = localStorage.getItem('STYLE_PRESET_LOGIN');
      if (!raw) return;
      const p = JSON.parse(raw);
      setDense(!!p.dense);
      setPalette((p.palette || 'whiteBluePurple'));
      setBrightness(typeof p.brightness === 'number' ? p.brightness : 1);
      setShowEdges(!!p.showEdges);
      setEdgeMultiplier(p.edgeMultiplier || 3);
      setFourCores(!!p.fourCores);
      try {
        localStorage.setItem('DENSE_LOGIN', p.dense ? '1' : '');
        localStorage.setItem('PALETTE_LOGIN', p.palette || 'whiteBluePurple');
        localStorage.setItem('BRIGHTNESS_LOGIN', String(p.brightness ?? 1));
        localStorage.setItem('EDGES_ON', p.showEdges ? '1' : '0');
        localStorage.setItem('EDGE_MULT', String(p.edgeMultiplier || 3));
      } catch {}
    } catch {}
  }
  // one-shot gate to avoid double login in dev/StrictMode or remounts
  const already = typeof window !== 'undefined' && sessionStorage.getItem('logged_in') === '1'
  const showLogin = !connected && !already
  React.useEffect(()=>{
    // Pause when not on login; optionally allow tiny rotation
    setBgPaused(!showLogin)
    setBgRotSpeed(showLogin ? 0.0 : 0.0) // default to fully stopped; adjust to 0.005 for tiny motion
  }, [showLogin])
  return (
    <div style={{ position:'fixed', inset:0 }}>
      {/* UX demo removed */}
      {/* Single persistent scene: acts as login when showLogin, becomes background after connect */}
      <LoginScene asBackground={!showLogin} dense={dense} palette={'allWhite'} brightness={brightness} showEdges={showEdges} edgeMultiplier={edgeMultiplier} fourCores={fourCores} nodeScale={nodeScale} edgeFraction={edgeFraction} edgeAlpha={edgeAlpha} sizeScale={sizeScale} rotSpeed={rotSpeed} edgeColor={edgeColor} sideHole={sideHole} sectorDensity={sectorDensity} bgPaused={bgPaused} bgRotSpeed={bgRotSpeed} hideDots={false} syncKey="bg" onDone={()=>{ try{ sessionStorage.setItem('logged_in','1') }catch{}; setConnected(true); setBlend(true); setTimeout(()=>setBlend(false), 260); }} onConnect={()=>{ try{ sessionStorage.setItem('logged_in','1') }catch{}; setConnected(true); setBlend(true); setTimeout(()=>setBlend(false), 260); }} />
      {/* App on top */}
      <div style={{ position:'absolute', inset:0, opacity: (!showLogin || connected) ? 1 : (blend ? 1 : 0), transition:'opacity 260ms linear', pointerEvents: (!showLogin || connected) ? 'auto' : 'none' }}>
        <App />
      </div>
      {/* Tiny entry to open demo without code churn */}
      {/* Open UX Demo link removed */}
      {showLogin && (
        <div style={{ position:'absolute', left:0, right:0, bottom:0, zIndex:31, display:'flex', justifyContent:'center', pointerEvents:'none' }}>
          {!drawerOpen && (
            <button onClick={()=>setDrawerOpen(true)} style={{ pointerEvents:'auto', marginBottom:12, padding:'8px 12px', borderRadius:999, background:'var(--dt-fill-med)', color:'var(--dt-text)', border:'1px solid var(--dt-border)', fontSize:12 }}>Show Controls ▴</button>
          )}
          {drawerOpen && (
            <div style={{ pointerEvents:'auto', width:'min(96vw, 980px)', background:'var(--dt-bg-elev-1)', border:'1px solid var(--dt-border)', borderTopLeftRadius:14, borderTopRightRadius:14, boxShadow:'0 -18px 80px rgba(0,0,0,0.6)', padding:'12px 14px 16px 14px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ color:'var(--dt-text)', fontSize:12, opacity:0.9 }}>Display Controls</div>
                <button onClick={()=>setDrawerOpen(false)} style={{ padding:'6px 10px', borderRadius:8, background:'var(--dt-fill-med)', color:'var(--dt-text)', border:'1px solid var(--dt-border)', fontSize:12 }}>Close ▾</button>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'center' }}>
                <button onClick={applyPreset} style={{ padding:'10px 14px', borderRadius:10, background:'var(--dt-accent)', color:'#fff', border:'1px solid var(--dt-border)', fontSize:12, letterSpacing:0.5, cursor:'pointer' }} title="Apply saved style preset">Blue Sparse Preset</button>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--dt-fill-weak)', padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)' }}>
                  <label style={{ fontSize:11, color:'var(--dt-text)' }}>Nodes</label>
                  <input type="range" min="0.25" max="2.5" step="0.05" value={nodeScale} onChange={(e)=> setNodeScale(parseFloat(e.target.value))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--dt-fill-weak)', padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)' }}>
                  <label style={{ fontSize:11, color:'var(--dt-text)' }}>Edges</label>
                  <input type="range" min="0" max="1" step="0.02" value={edgeFraction} onChange={(e)=> setEdgeFraction(parseFloat(e.target.value))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--dt-fill-weak)', padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)' }}>
                  <label style={{ fontSize:11, color:'var(--dt-text)' }}>Edge Bright</label>
                  <input type="range" min="0" max="2" step="0.05" value={edgeAlpha} onChange={(e)=> setEdgeAlpha(parseFloat(e.target.value))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--dt-fill-weak)', padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)' }}>
                  <label style={{ fontSize:11, color:'var(--dt-text)' }}>Point Size</label>
                  <input type="range" min="0.5" max="2.5" step="0.05" value={sizeScale} onChange={(e)=> setSizeScale(parseFloat(e.target.value))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--dt-fill-weak)', padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)' }}>
                  <label style={{ fontSize:11, color:'var(--dt-text)' }}>Rotation</label>
                  <input type="range" min="0" max="0.2" step="0.005" value={rotSpeed} onChange={(e)=> setRotSpeed(parseFloat(e.target.value))} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--dt-fill-weak)', padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)' }}>
                  <label style={{ fontSize:11, color:'var(--dt-text)' }}>Edge Color</label>
                  <input type="color" value={edgeColor} onChange={(e)=> setEdgeColor(e.target.value)} />
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{ color:'var(--dt-text)', fontSize:11, opacity:0.9, marginRight:4 }}>Palette</span>
                  <button onClick={()=> setPalette('whiteBluePurple')} style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-fill-weak)', color:'#e0c1ff', fontSize:11 }}>W/B/P</button>
                  <button onClick={()=> setPalette('whiteBlue')} style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-fill-weak)', color:'#9ecbff', fontSize:11 }}>White/Blue</button>
                  <button onClick={()=> setPalette('allWhite')} style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-fill-weak)', color:'var(--dt-text)', fontSize:11 }}>All White</button>
                  <button onClick={()=> setPalette('random')} style={{ padding:'6px 8px', borderRadius:8, border:'1px solid var(--dt-border)', background:'var(--dt-fill-weak)', color:'var(--dt-text)', fontSize:11 }}>Random</button>
                </div>
                <button onClick={()=> setSideHole(v=>!v)} style={{ padding:'8px 10px', borderRadius:10, background:'var(--dt-fill-med)', color:'var(--dt-text)', border:'1px solid var(--dt-border)', fontSize:12, letterSpacing:0.5, cursor:'pointer' }} title="Toggle side hole">Side Hole: {sideHole ? 'On' : 'Off'}</button>
                <button onClick={()=> setSectorDensity(v=>!v)} style={{ padding:'8px 10px', borderRadius:10, background:'var(--dt-fill-med)', color:'var(--dt-text)', border:'1px solid var(--dt-border)', fontSize:12, letterSpacing:0.5, cursor:'pointer' }} title="Toggle non-uniform sectors">Sector Density: {sectorDensity ? 'On' : 'Off'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const root = createRoot(document.getElementById("root")!);
root.render(<Root />);


