import React, { useRef, useState } from "react";
import ReglScene from "./graph/ReglScene";
import CommandBar from "./ui/CommandBar";
import HUD from "./ui/HUD";
import Settings from "./ui/Settings";
import Sidebar from "./ui/Sidebar";
import { setApiConfig } from "./api";
import { resolveSmart, loadTileSmart } from "./smart";

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
      <ReglScene ref={sceneRef as any} concentric={concentric} onPick={(i)=>{ setSelectedIndex(i) }} onClear={()=>{ sceneRef.current?.clear(); setFocus(null); }} onStats={(fps,count)=>{ setFps(fps); setNodeCount(count) }} />
      <Sidebar open={sidebarOpen} onToggle={()=>setSidebarOpen(!sidebarOpen)} items={Array.from({length: Math.max(0,nodeCount)},(_,i)=>({index:i, group: (i%8)}))} onSelect={(i)=>{/* future: refocus */}} />
      <CommandBar onRun={run} />
      <HUD focus={focus} nodes={nodeCount} fps={fps} selectedIndex={selectedIndex} concentric={concentric} onToggleConcentric={()=>setConcentric(c=>!c)} onSettings={()=>setShowSettings(true)} onBack={()=>{ if(cursor>0){ const id=history[cursor-1]; setCursor(cursor-1); run(id) } }} onForward={()=>{ if(cursor<history.length-1){ const id=history[cursor+1]; setCursor(cursor+1); run(id) } }} canBack={cursor>0} canForward={cursor<history.length-1} filters={filters} onToggleFilter={(k)=>setFilters(f=>({ ...f, [k]: !f[k] }))} />
      {err && (
        <div style={{ position:'absolute', top:52, left:12, right:12, padding:'10px 12px', background:'rgba(200,40,60,0.2)', border:'1px solid rgba(255,80,100,0.35)', color:'#ffbfc9', borderRadius:10, zIndex:11 }}>
          {err}
        </div>
      )}
      {showSettings && (
        <Settings apiBase={apiBase} bearer={bearer} onSave={({apiBase,bearer})=>{ setApiBase(apiBase); setBearer(bearer); setApiConfig(apiBase,bearer); setShowSettings(false); }} onClose={()=>setShowSettings(false)} />
      )}
    </div>
  );
}


