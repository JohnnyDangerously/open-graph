import React, { useRef, useState } from "react";
import ReglScene from "./graph/ReglScene";
import CommandBar from "./ui/CommandBar";
import HUD from "./ui/HUD";
import Settings from "./ui/Settings";
import Sidebar from "./ui/Sidebar";
import { setApiConfig } from "./api";
import { resolveSmart, loadTileSmart } from "./smart";
import TriplesModal from "./ui/TriplesModal";
import MobilitySankeyDemo from "./ui/MobilitySankeyDemo";

type SceneRef = { setForeground: (fg: any) => void; clear: () => void };

export default function App(){
  const [focus, setFocus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sceneRef = useRef<SceneRef | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fps, setFps] = useState(60);
  const [nodeCount, setNodeCount] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [filters, setFilters] = useState({ email:false, work:false, social:false, phone:false });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [apiBase, setApiBase] = useState<string>(()=>{
    try { return localStorage.getItem('API_BASE') || "http://34.192.99.41" } catch { return "http://34.192.99.41" }
  });
  const [bearer, setBearer] = useState<string>(()=>{
    try { return localStorage.getItem('API_BEARER') || "" } catch { return "" }
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [concentric, setConcentric] = useState(false);
  const [showTriples, setShowTriples] = useState(false);
  const [showMobility, setShowMobility] = useState(false);

  const demoTriples = React.useMemo(()=>{
    const person = (name:string, title?:string)=>({ name, title, avatarUrl:`https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(name)}` })
    return [
      {
        left: person('Alex Kim','PM'),
        middle: person('Jordan Lee','Staff Eng'),
        right: person('Priya Patel','VP Eng'),
        scores: { pairLM:0.74, pairMR:0.88, pairLR:0.32, triadicClosure:0.69, transactionalSymmetry:'junior_to_senior' as const, opportunityFit:82, fanIn:91 },
      },
      {
        left: person('Sam Rivera','Founder'),
        middle: person('Morgan Chen','Director'),
        right: person('Taylor Brooks','CPO'),
        scores: { pairLM:0.41, pairMR:0.52, pairLR:0.28, triadicClosure:0.39, transactionalSymmetry:'peer_to_peer' as const, opportunityFit:46, fanIn:55 },
      },
      {
        left: person('Avery Johnson','IC4'),
        middle: person('Riley Thompson','Sr. Manager'),
        right: person('Casey Nguyen','Head of Data'),
        scores: { pairLM:0.91, pairMR:0.85, pairLR:0.63, triadicClosure:0.88, transactionalSymmetry:'junior_to_senior' as const, opportunityFit:94, fanIn:97 },
        highlighted: true,
      },
      {
        left: person('Jamie Park','BizOps'),
        middle: person('Chris Adams','Sr. Eng'),
        right: person('Quinn Bailey','CTO'),
        scores: { pairLM:0.36, pairMR:0.58, pairLR:0.22, triadicClosure:0.33, transactionalSymmetry:'senior_to_junior' as const, opportunityFit:38, fanIn:49 },
      },
      {
        left: person('Drew Carter','AE'),
        middle: person('Skylar Green','Solutions'),
        right: person('Harper Fox','SVP Sales'),
        scores: { pairLM:0.67, pairMR:0.71, pairLR:0.29, triadicClosure:0.61, transactionalSymmetry:'junior_to_senior' as const, opportunityFit:73, fanIn:84 },
      }
    ]
  },[])

  async function run(cmd: string){
    const s = cmd.trim();
    if (!s) return;
    if (s.toLowerCase() === "clear") { sceneRef.current?.clear(); setFocus(null); return; }
    const m = /^show\s+(.+)$/i.exec(s);
    let id = (m ? m[1] : s).trim();
    // resolve via cache-first or backend fallback
    const r = await resolveSmart(id)
    if (r) id = r
    setFocus(id);
    setHistory(h=>{ const nh=[...h.slice(0,cursor+1), id]; setCursor(nh.length-1); return nh })
    setErr(null);
    try {
      const { tile } = await loadTileSmart(id)
      sceneRef.current?.setForeground(tile as any);
    } catch (e: any) {
      setErr(e?.message || "fetch failed");
    }
  }

  return (
    <div className="w-full h-full" style={{ background: "#0a0a12", color: "white", position:'fixed', inset:0, overflow:'hidden' }}>
      <ReglScene ref={sceneRef as any} concentric={concentric} filters={filters} onPick={(i)=>{ setSelectedIndex(i) }} onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }} onStats={(fps,count)=>{ setFps(fps); setNodeCount(count) }} />
      <Sidebar open={sidebarOpen} onToggle={()=>setSidebarOpen(!sidebarOpen)} items={Array.from({length: Math.max(0,nodeCount)},(_,i)=>({index:i, group: (i%8)}))} onSelect={(i)=>{/* future: refocus */}} />
      <CommandBar onRun={run} />
      <HUD focus={focus} nodes={nodeCount} fps={fps} selectedIndex={selectedIndex} concentric={concentric} onToggleConcentric={()=>setConcentric(c=>!c)} onSettings={()=>setShowSettings(true)} onBack={()=>{ if(cursor>0){ const id=history[cursor-1]; setCursor(cursor-1); run(id) } }} onForward={()=>{ if(cursor<history.length-1){ const id=history[cursor+1]; setCursor(cursor+1); run(id) } }} canBack={cursor>0} canForward={cursor<history.length-1} filters={filters} onToggleFilter={(k)=>setFilters(f=>({ ...f, [k]: !f[k] }))} />
      <div style={{ position:'absolute', left:0, right:0, bottom:18, display:'flex', justifyContent:'center', gap:12, zIndex:15 }}>
        <button onClick={()=>setShowTriples(true)} style={{ padding:'12px 16px', borderRadius:14, background:'#ffffff', color:'#0b122a', border:'1px solid rgba(255,255,255,0.25)', boxShadow:'0 14px 40px rgba(11,18,42,0.45)' }}>Show Triples</button>
        <button onClick={()=>setShowMobility(true)} style={{ padding:'12px 16px', borderRadius:14, background:'linear-gradient(135deg, #ff6a00, #ff3b3b)', color:'#ffffff', border:'1px solid rgba(255,255,255,0.25)', boxShadow:'0 14px 40px rgba(255,106,0,0.3)' }}>People Movin'</button>
      </div>
      {err && (
        <div style={{ position:'absolute', top:52, left:12, right:12, padding:'10px 12px', background:'rgba(200,40,60,0.2)', border:'1px solid rgba(255,80,100,0.35)', color:'#ffbfc9', borderRadius:10, zIndex:11 }}>
          {err}
        </div>
      )}
      {showSettings && (
        <Settings apiBase={apiBase} bearer={bearer} onSave={({apiBase,bearer})=>{ setApiBase(apiBase); setBearer(bearer); setApiConfig(apiBase,bearer); setShowSettings(false); }} onClose={()=>setShowSettings(false)} />
      )}
      {showTriples && (
        <TriplesModal open={showTriples} onClose={()=>setShowTriples(false)} triples={demoTriples} />
      )}
      {showMobility && (
        <div style={{ position:'absolute', inset:0, background:'rgba(2,6,23,0.8)', display:'grid', placeItems:'center', zIndex:40 }}>
          <div style={{ width:'98vw', height:'96vh', maxWidth:'98vw', maxHeight:'96vh', borderRadius:20, background:'#0b0c10', border:'1px solid rgba(255,255,255,0.08)', boxShadow:'0 28px 120px rgba(0,0,0,0.6)', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:16, right:16, zIndex:10 }}>
              <button onClick={()=>setShowMobility(false)} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)', fontSize:14 }}>Close</button>
            </div>
            <MobilitySankeyDemo />
          </div>
        </div>
      )}
    </div>
  );
}


