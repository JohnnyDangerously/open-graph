import React, { useEffect, useMemo, useRef, useState } from "react";

export type NodeId = string;
export type Edge = { id: string; source: NodeId; target: NodeId; weight: number };
export type Node = {
  id: NodeId;
  x: number;
  y: number;
  r?: number;
  name?: string;
  title?: string;
  company?: string;
  avatarUrl?: string | null;
};
export type NetworkData = { nodes: Node[]; edges: Edge[] };

// Attempt to load /data/contacts.db with sql.js at runtime (no build deps).
async function loadContactsDb(): Promise<NetworkData> {
  try {
    const initSqlJs = (await import("https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/sql-wasm.js" as any)).default;
    const SQL = await initSqlJs({ locateFile: () => "https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/sql-wasm.wasm" });
    const buf = await fetch("/data/contacts.db").then((r) => r.arrayBuffer());
    const db = new SQL.Database(new Uint8Array(buf));

    // Discover tables/columns
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")?.[0]?.values?.flat?.() || [];
    const hasContacts = tables.includes("contacts") || tables.includes("people");
    const contactsTbl = tables.includes("contacts") ? "contacts" : (tables.includes("people") ? "people" : "contacts");
    const edgesTbl = tables.includes("links") ? "links" : (tables.includes("edges") ? "edges" : "links");

    const nodes: Node[] = [];
    if (hasContacts) {
      // Try several column name variants
      const colsRes = db.exec(`PRAGMA table_info(${contactsTbl})`);
      const cols = colsRes?.[0]?.values?.map((v: any[]) => String(v[1]).toLowerCase()) || [];
      const idCol = cols.find((c: string) => c === "id" || c === "person_id") || "id";
      const nameCol = cols.find((c: string) => ["full_name","name"].includes(c)) || "full_name";
      const titleCol = cols.find((c: string) => ["title","job_title"].includes(c)) || "title";
      const companyCol = cols.find((c: string) => ["company","company_name"].includes(c)) || "company";
      const avatarCol = cols.find((c: string) => ["avatar_url","image","photo"].includes(c)) || "avatar_url";
      const xCol = cols.find((c: string) => c === "x");
      const yCol = cols.find((c: string) => c === "y");
      const q = db.exec(`SELECT * FROM ${contactsTbl}`);
      const rows = q?.[0]?.values || [];
      const rmap = (name: string) => q?.[0]?.columns?.findIndex((c: string) => c.toLowerCase() === name) ?? -1;
      const iId = rmap(idCol), iName = rmap(nameCol), iTitle = rmap(titleCol), iCo = rmap(companyCol), iAv = rmap(avatarCol), iX = rmap(String(xCol||"x")), iY = rmap(String(yCol||"y"));
      for (const row of rows) {
        nodes.push({
          id: String(row[iId]),
          x: iX >= 0 ? Number(row[iX]) : (Math.random()-0.5)*1800,
          y: iY >= 0 ? Number(row[iY]) : (Math.random()-0.5)*1200,
          r: 26,
          name: row[iName] ? String(row[iName]) : undefined,
          title: row[iTitle] ? String(row[iTitle]) : undefined,
          company: row[iCo] ? String(row[iCo]) : undefined,
          avatarUrl: row[iAv] ? String(row[iAv]) : null,
        });
      }
    }

    const edges: Edge[] = [];
    if (tables.includes(edgesTbl)) {
      const q = db.exec(`SELECT * FROM ${edgesTbl}`);
      if (q && q[0]) {
        const cols = q[0].columns.map((c: string) => c.toLowerCase());
        const iS = cols.findIndex((c: string) => ["source_id","src","source"].includes(c));
        const iT = cols.findIndex((c: string) => ["target_id","dst","target"].includes(c));
        const iW = cols.findIndex((c: string) => ["weight","w","score"].includes(c));
        let eid = 0;
        for (const row of q[0].values) {
          const s = String(row[iS]);
          const t = String(row[iT]);
          if (!s || !t) continue;
          edges.push({ id: `E${eid++}`, source: s, target: t, weight: Math.max(0, Math.min(100, Number(row[iW] ?? 50))) });
        }
      }
    }

    db.close();
    return { nodes, edges };
  } catch {
    // Fallback demo data if db or wasm missing
    return makeDemoData();
  }
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeDemoData(count = 22, seed = 7): NetworkData {
  const rand = mulberry32(seed);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({ id: `N${i}`, x: (rand()-0.5)*1800, y:(rand()-0.5)*1200, r:26, name:`Person ${i}`, avatarUrl: null });
  }
  let eid=0; for(let i=0;i<count;i++){ for(let j=i+1;j<count;j++){ if(rand()<0.2){ edges.push({ id:`E${eid++}`, source:nodes[i].id, target:nodes[j].id, weight: 40+Math.floor(rand()*60) }) } } }
  return { nodes, edges };
}

export default function PeopleNetwork(){
  const [data, setData] = useState<NetworkData | null>(null)
  useEffect(()=>{ loadContactsDb().then(setData) },[])
  if (!data) return <div style={{ width:'100%', height:'100%', display:'grid', placeItems:'center', color:'#fff' }}>Loading…</div>
  return <NetworkCanvasDemo data={data} />
}

// ---------- Canvas component (pan/zoom/drag + avatars) ----------
function NetworkCanvasDemo({ data }: { data?: NetworkData }){
  const [world] = useState<NetworkData>(()=> data!)
  const canvasRef = useRef<HTMLCanvasElement|null>(null)
  const [tx, setTx] = useState(0), [ty, setTy] = useState(0), [scale, setScale] = useState(1)
  const draggingNodeRef = useRef<Node|null>(null); const dragLastRef = useRef<{x:number,y:number}|null>(null); const isPanningRef = useRef(false)
  const imgCache = useRef(new Map<string, HTMLImageElement>())

  useEffect(()=>{ fitToContent() },[])
  function worldToScreen(wx:number,wy:number){ return { x: wx*scale+tx, y: wy*scale+ty } }
  function screenToWorld(sx:number,sy:number){ return { x:(sx-tx)/scale, y:(sy-ty)/scale } }
  function fitToContent(padding=140){ const c=canvasRef.current; if(!c) return; const xs=world.nodes.map(n=>n.x); const ys=world.nodes.map(n=>n.y); const minX=Math.min(...xs)-padding, maxX=Math.max(...xs)+padding, minY=Math.min(...ys)-padding, maxY=Math.max(...ys)+padding; const w=c.width, h=c.height; const sx=w/(maxX-minX), sy=h/(maxY-minY); const s=Math.min(1.4, Math.min(sx,sy)); setScale(s); setTx(-minX*s); setTy(-minY*s) }

  useEffect(()=>{ const c=canvasRef.current; if(!c) return; const ro=new ResizeObserver(()=>resizeCanvas()); ro.observe(c); resizeCanvas(); return ()=>ro.disconnect() },[])
  function resizeCanvas(){ const c=canvasRef.current; if(!c) return; const dpr=Math.max(1, Math.floor(window.devicePixelRatio||1)); const rect=c.getBoundingClientRect(); c.width=Math.max(600, Math.floor(rect.width*dpr)); c.height=Math.max(400, Math.floor(rect.height*dpr)); const ctx=c.getContext('2d'); if(ctx) ctx.setTransform(dpr,0,0,dpr,0,0); draw() }

  function draw(){ const c=canvasRef.current; if(!c) return; const ctx=c.getContext('2d'); if(!ctx) return; ctx.save(); ctx.clearRect(0,0,c.width,c.height); drawGrid(ctx,c.width,c.height,tx,ty,scale); for(const e of world.edges){ const a=world.nodes.find(n=>n.id===e.source)!; const b=world.nodes.find(n=>n.id===e.target)!; const A=worldToScreen(a.x,a.y), B=worldToScreen(b.x,b.y); const w=0.5+(e.weight/100)*2.5; const alpha=0.35+(e.weight/100)*0.45; ctx.strokeStyle=`rgba(64,64,72,${alpha.toFixed(3)})`; ctx.lineWidth=w; ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.stroke(); const mx=(A.x+B.x)/2, my=(A.y+B.y)/2; drawScorePill(ctx, `${e.weight}`, mx, my) } for(const n of world.nodes){ const p=worldToScreen(n.x,n.y); drawNode(ctx,n,p.x,p.y,(n.r??24)) } ctx.restore() }

  function drawNode(ctx:CanvasRenderingContext2D,n:Node,x:number,y:number,r:number){ ctx.save(); ctx.beginPath(); ctx.arc(x,y,r+5,0,Math.PI*2); ctx.strokeStyle="rgba(99,102,241,0.25)"; ctx.lineWidth=2; ctx.stroke(); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.closePath(); ctx.clip(); if(n.avatarUrl){ let img=imgCache.current.get(n.avatarUrl); if(!img){ img=new Image(); img.crossOrigin='anonymous'; img.src=n.avatarUrl; img.onload=()=>draw(); img.onerror=()=>draw(); imgCache.current.set(n.avatarUrl,img) } const im=imgCache.current.get(n.avatarUrl); if(im && im.complete && im.naturalWidth) ctx.drawImage(im,x-r,y-r,r*2,r*2); else { ctx.fillStyle='#e5e7eb'; ctx.fillRect(x-r,y-r,r*2,r*2) } } else { ctx.fillStyle='#e5e7eb'; ctx.fillRect(x-r,y-r,r*2,r*2) } ctx.restore(); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.strokeStyle="#111827"; ctx.lineWidth=1.5; ctx.stroke(); if(n.name) drawLabel(ctx,n.name,x,y+r+16) }
  function drawLabel(ctx:CanvasRenderingContext2D, text:string, x:number, y:number){ ctx.save(); ctx.font='12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto'; const padding=6; const metrics=ctx.measureText(text); const w=metrics.width+padding*2, h=18, rx=8; ctx.fillStyle='#ffffff'; roundRect(ctx,x-w/2,y-h/2,w,h,rx,true,false); ctx.strokeStyle='#a78bfa'; ctx.lineWidth=1; roundRect(ctx,x-w/2,y-h/2,w,h,rx,false,true); ctx.fillStyle='#111827'; ctx.fillText(text,x-w/2+padding,y+4); ctx.restore() }
  function drawScorePill(ctx:CanvasRenderingContext2D, text:string, x:number, y:number){ ctx.save(); ctx.font='11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto'; const padding=5; const m=ctx.measureText(text); const w=m.width+padding*2, h=16, rx=8; ctx.globalAlpha=0.9; ctx.fillStyle='#f9fafb'; roundRect(ctx,x-w/2,y-h/2,w,h,rx,true,false); ctx.strokeStyle='#d1d5db'; ctx.lineWidth=1; roundRect(ctx,x-w/2,y-h/2,w,h,rx,false,true); ctx.fillStyle='#374151'; ctx.fillText(text,x-w/2+padding,y+4); ctx.restore() }
  function roundRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,fill:boolean,stroke:boolean){ const min=Math.min(w,h)/2; r=Math.min(r,min); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); if(fill) ctx.fill(); if(stroke) ctx.stroke() }
  function drawGrid(ctx:CanvasRenderingContext2D,width:number,height:number,tx:number,ty:number,s:number){ ctx.save(); ctx.fillStyle='#0a0a12'; ctx.fillRect(0,0,width,height); const spacing=80*s; const startX=(( -tx % spacing)+spacing)%spacing; const startY=(( -ty % spacing)+spacing)%spacing; ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1; for(let x=startX;x<width;x+=spacing){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke() } for(let y=startY;y<height;y+=spacing){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke() } ctx.restore() }

  useEffect(()=>{ const c=canvasRef.current; if(!c) return; const onWheel=(e:WheelEvent)=>{ e.preventDefault(); const rect=c.getBoundingClientRect(); const mx=e.clientX-rect.left, my=e.clientY-rect.top; const before=screenToWorld(mx,my); const delta=-e.deltaY*0.001; const newScale=clamp(scale*(1+delta),0.2,3.5); setScale(newScale); const sx=before.x*newScale+tx; const sy=before.y*newScale+ty; setTx(tx+(mx-sx)); setTy(ty+(my-sy)); requestAnimationFrame(draw) }; const onDown=(e:PointerEvent)=>{ const r=c.getBoundingClientRect(); const sx=e.clientX-r.left, sy=e.clientY-r.top; const w=screenToWorld(sx,sy); const hit=pickNode(world.nodes,w.x,w.y,(n)=>n.r??24); if(hit) draggingNodeRef.current=hit; else isPanningRef.current=true; dragLastRef.current={x:sx,y:sy}; (e.target as Element).setPointerCapture(e.pointerId) }; const onMove=(e:PointerEvent)=>{ if(!dragLastRef.current) return; const r=c.getBoundingClientRect(); const sx=e.clientX-r.left, sy=e.clientY-r.top; const dx=sx-dragLastRef.current.x, dy=sy-dragLastRef.current.y; dragLastRef.current={x:sx,y:sy}; const dragging=draggingNodeRef.current; if(dragging){ dragging.x += dx/scale; dragging.y += dy/scale } else if(isPanningRef.current){ setTx((p)=>p+dx); setTy((p)=>p+dy) } requestAnimationFrame(draw) }; const onUp=()=>{ draggingNodeRef.current=null; isPanningRef.current=false; dragLastRef.current=null; requestAnimationFrame(draw) }; c.addEventListener('wheel', onWheel, { passive:false }); c.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); return ()=>{ c.removeEventListener('wheel', onWheel as any); c.removeEventListener('pointerdown', onDown as any); window.removeEventListener('pointermove', onMove as any); window.removeEventListener('pointerup', onUp as any) } },[scale,tx,ty,world])
  useEffect(()=>{ draw() })
  function pickNode(nodes:Node[], wx:number, wy:number, rfn:(n:Node)=>number){ for(let i=nodes.length-1;i>=0;i--){ const n=nodes[i]; const r=rfn(n); const dx=wx-n.x, dy=wy-n.y; if(dx*dx+dy*dy<=r*r) return n } return null }
  function clamp(v:number,a:number,b:number){ return Math.max(a, Math.min(b,v)) }
  return (
    <div style={{ width:'100%', height:'100%', position:'relative', background:'#0a0a12' }}>
      <div style={{ position:'absolute', top:10, left:10, zIndex:2, display:'flex', gap:8 }}>
        <button onClick={()=>fitToContent()} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)' }}>Fit</button>
        <button onClick={()=>{ setTx(0); setTy(0); setScale(1); requestAnimationFrame(draw) }} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.08)', color:'#fff', border:'1px solid rgba(255,255,255,0.15)' }}>Reset</button>
      </div>
      <canvas ref={canvasRef} style={{ width:'100%', height:'100%', display:'block', cursor:'grab' }} />
    </div>
  )
}


