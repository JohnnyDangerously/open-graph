import React, { useMemo, useState } from "react";

export default function PathFindingDemo({
  width = 1000,
  height = 620,
  numBridges = 36,
  numTargets = 10,
  bridgeFanout = [1, 4] as [number, number],
  seed = 42,
  title = "Path Finding — Hover to Explore",
}:{
  width?: number;
  height?: number;
  numBridges?: number;
  numTargets?: number;
  bridgeFanout?: [number, number];
  seed?: number;
  title?: string;
}){
  const PAD = 24;
  const COL_X = useMemo(()=>({
    source: Math.round(width * 0.06),
    bridge: Math.round(width * 0.50),
    target: Math.round(width * 0.96),
  } as const), [width]);

  const r = {
    source: 22,
    bridge: 10,
    bridgeHover: 13,
    target: 14,
    targetHover: 18,
  } as const;

  function mulberry32(a: number){
    return function(){
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // bezier helpers for label alignment
  function bezierPoint(x0:number,y0:number,x1:number,y1:number,x2:number,y2:number,x3:number,y3:number,t:number){
    const mt = 1 - t;
    const x = mt*mt*mt*x0 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3;
    const y = mt*mt*mt*y0 + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3;
    return { x, y };
  }
  function bezierAngle(x0:number,y0:number,x1:number,y1:number,x2:number,y2:number,x3:number,y3:number,t:number){
    const mt = 1 - t;
    const dx = 3*mt*mt*(x1-x0) + 6*mt*t*(x2-x1) + 3*t*t*(x3-x2);
    const dy = 3*mt*mt*(y1-y0) + 6*mt*t*(y2-y1) + 3*t*t*(y3-y2);
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

  const data = useMemo(()=>{
    const rand = mulberry32(seed);
    const source = { id: "S0", x: COL_X.source, y: height / 2 } as const;

    const bridges = Array.from({ length: numBridges }, (_, i) => {
      const colH = height - PAD * 2;
      const gap = colH / (numBridges + 1);
      const y = PAD + gap * (i + 1) + (rand() - 0.5) * gap * 0.25;
      return { id: `B${i}`, x: COL_X.bridge, y };
    });

    const firstNames = [
      'Alex','Jordan','Priya','Sam','Morgan','Taylor','Avery','Riley','Casey','Jamie',
      'Chris','Quinn','Drew','Skylar','Harper','Cameron','Rowan','Parker','Logan','Reese'
    ];
    const lastNames = [
      'Kim','Lee','Patel','Rivera','Chen','Brooks','Johnson','Thompson','Nguyen','Park',
      'Adams','Bailey','Carter','Green','Fox','Morgan','Diaz','Singh','Wright','Lopez'
    ];

    const targets = Array.from({ length: numTargets }, (_, i) => {
      const colH = height - PAD * 2;
      const gap = colH / (numTargets + 1);
      const y = PAD + gap * (i + 1);
      const fname = firstNames[Math.floor(rand() * firstNames.length)];
      const lname = lastNames[Math.floor(rand() * lastNames.length)];
      const label = `${fname} ${lname}`;
      return { id: `T${i}`, x: COL_X.target, y, label } as const;
    });

    const edgesSB = bridges.map((b) => ({ from: source.id, to: b.id }));

    const edgesBT: { from: string; to: string }[] = [];
    targets.forEach((t) => {
      const idx = Math.floor(rand() * numBridges);
      edgesBT.push({ from: `B${idx}`, to: t.id });
    });

    for (let i = 0; i < numBridges; i++){
      const extra = Math.floor(
        bridgeFanout[0] + rand() * (bridgeFanout[1] - bridgeFanout[0] + 1)
      );
      const chosen = new Set<string>();
      for (let k = 0; k < extra; k++){
        const t = Math.floor(rand() * numTargets);
        chosen.add(`T${t}`);
      }
      chosen.forEach((tid) => edgesBT.push({ from: `B${i}`, to: tid }));
    }

    const targetsByBridge = new Map<string, string[]>();
    bridges.forEach((b) => targetsByBridge.set(b.id, []));
    edgesBT.forEach((e) => targetsByBridge.get(e.from)!.push(e.to));

    const bridgesByTarget = new Map<string, string[]>();
    targets.forEach((t) => bridgesByTarget.set(t.id, []));
    edgesBT.forEach((e) => bridgesByTarget.get(e.to)!.push(e.from));

    // scoring (deterministic by seed)
    const bridgeScores = new Map<string, { symmetry: number; connection: number; relevancy: number }>();
    bridges.forEach((b)=>{
      const symmetry = 0.4 + rand() * 0.6;
      const connection = 0.35 + rand() * 0.65;
      const relevancy = Math.round((0.5 + rand() * 0.5) * 100);
      bridgeScores.set(b.id, { symmetry, connection, relevancy });
    });

    const btScores = new Map<string, number>();
    edgesBT.forEach((e)=>{
      const v = 0.3 + rand() * 0.7;
      btScores.set(`${e.from}_${e.to}`, v);
    });

    const targetOpportunity = new Map<string, number>();
    targets.forEach((t)=>{
      const v = Math.round((0.5 + rand() * 0.5) * 100);
      targetOpportunity.set(t.id, v);
    });

    return { source, bridges, targets, edgesSB, edgesBT, targetsByBridge, bridgesByTarget, bridgeScores, btScores, targetOpportunity } as const;
  }, [bridgeFanout, height, numBridges, numTargets, seed, COL_X.source, COL_X.bridge, COL_X.target]);

  const [hoverBridge, setHoverBridge] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [lockedBridge, setLockedBridge] = useState<string | null>(null);
  const [lockedTarget, setLockedTarget] = useState<string | null>(null);
  const [showScores, setShowScores] = useState<boolean>(false);

  const activeBridge = lockedBridge ?? hoverBridge;
  const activeTarget = lockedTarget ?? hoverTarget;

  function isSBHighlighted(sb: { from: string; to: string }){
    if (activeTarget){
      return data.bridgesByTarget.get(activeTarget)?.includes(sb.to) ?? false;
    }
    if (activeBridge) return sb.to === activeBridge;
    return true;
  }

  function isBTHighlighted(bt: { from: string; to: string }){
    if (activeBridge) return bt.from === activeBridge;
    if (activeTarget) return bt.to === activeTarget;
    return true;
  }

  const baseEdgeOpacity = 0.15;
  const highlightOpacity = 0.9;

  const Title = () => (
    <div style={{ padding:'12px 14px' }}>
      {/* removed small Demo tag */}
      <div style={{ fontSize:22, fontWeight:600, color:'#e5ecff' }}>{title}</div>
      <div style={{ fontSize:12, color:'#9fb0ff', marginTop:4 }}>Hover bridges or targets to light up the best paths.</div>
    </div>
  );

  function getRelevancy(){
    if (activeBridge){
      return (data.bridgeScores.get(activeBridge)?.relevancy ?? 50) / 100;
    }
    if (activeTarget){
      const bridges = data.bridgesByTarget.get(activeTarget) || [];
      if (bridges.length === 0) return 0.5;
      const sum = bridges.reduce((acc,b)=> acc + ((data.bridgeScores.get(b)?.relevancy ?? 50)/100), 0);
      return sum / bridges.length;
    }
    return 0.5;
  }

  return (
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', background:'#0a0a12', color:'#e5ecff' }}>
      <Title />
      <div style={{ flex:1, borderRadius:16, boxShadow:'0 20px 80px rgba(0,0,0,0.45)', border:'1px solid rgba(255,255,255,0.08)', background:'#0b0c10', position:'relative', overflow:'hidden', display:'grid', placeItems:'center' }}>
        <div style={{ position:'absolute', top:10, right:10, zIndex:5, display:'flex', gap:8 }}>
          <button onClick={()=>setShowScores(s=>!s)} style={{ padding:'8px 12px', borderRadius:10, background: showScores ? 'rgba(111,171,255,0.18)' : 'rgba(255,255,255,0.08)', color:'#e5ecff', border:'1px solid rgba(255,255,255,0.22)' }}>Scoring: {showScores? 'ON' : 'OFF'}</button>
          {/* removed locked status chip */}
        </div>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display:'block', margin:'0 auto' }}>
          <defs>
            <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="50%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#B45309" />
            </linearGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g opacity="0.14">
            <line x1={COL_X.source} x2={COL_X.source} y1={16} y2={height - 16} stroke="#ffffff" />
            <line x1={COL_X.bridge} x2={COL_X.bridge} y1={16} y2={height - 16} stroke="#ffffff" />
            <line x1={COL_X.target} x2={COL_X.target} y1={16} y2={height - 16} stroke="#ffffff" />
          </g>

          <text x={COL_X.source} y={28} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill:'#cbd5e1' }}>john kalogerakis</text>
          <text x={COL_X.bridge} y={28} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill:'#cbd5e1' }}>Seed network (bridges)</text>
          <text x={Math.min(COL_X.target - 12, width - 12)} y={28} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill:'#cbd5e1' }}>HubSpot (people)</text>

          <g>
            {data.edgesSB.map((e, i) => {
              const b = data.bridges.find((x) => x.id === e.to)!;
              const highlighted = isSBHighlighted(e);
              const dx = (b.x - data.source.x) * 0.46;
              const x0 = data.source.x, y0 = data.source.y;
              const x1 = data.source.x + dx, y1 = data.source.y;
              const x2 = b.x - dx, y2 = b.y;
              const x3 = b.x, y3 = b.y;
              const mid = bezierPoint(x0,y0,x1,y1,x2,y2,x3,y3,0.5);
              const ang = bezierAngle(x0,y0,x1,y1,x2,y2,x3,y3,0.5);
              return (
                <g key={`sb-${i}`}>
                  <path
                    d={`M ${x0} ${y0} C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`}
                    stroke={highlighted ? "url(#gold)" : "#9CA3AF"}
                    strokeWidth={highlighted ? 2 : 1}
                    opacity={highlighted ? highlightOpacity : baseEdgeOpacity}
                    fill="none"
                    onMouseEnter={()=>{ if(!lockedBridge && !lockedTarget){ setHoverBridge(b.id); setHoverTarget(null); } }}
                    onMouseLeave={()=>{ if(!lockedBridge){ setHoverBridge(null) } }}
                    onClick={()=>{ setLockedTarget(null); setLockedBridge(lb=> lb===b.id ? null : b.id) }}
                    style={{ cursor:'pointer' }}
                  />
                  {showScores && highlighted && (
                    (()=>{
                      const sc = data.bridgeScores.get(b.id)!;
                      const label = `Sym ${Math.round(sc.symmetry*100)} • Conn ${Math.round(sc.connection*100)}`;
                      const w = 200, h = 22;
                      return (
                        <g transform={`translate(${mid.x},${mid.y}) rotate(${ang})`} style={{ pointerEvents:'none' }}>
                          <rect x={-w/2} y={-h/2} width={w} height={h} rx={h/2} fill="rgba(15,23,42,0.6)" stroke="rgba(147,197,253,0.6)" />
                          <text x={0} y={6} textAnchor="middle" style={{ fontSize:12, fill:'#e5ecff' }}>{label}</text>
                        </g>
                      );
                    })()
                  )}
                </g>
              );
            })}
          </g>

          <g>
            {data.edgesBT.map((e, i) => {
              const b = data.bridges.find((x) => x.id === e.from)!;
              const t = data.targets.find((x) => x.id === e.to)!;
              const highlighted = isBTHighlighted(e);
              const dx = (t.x - b.x) * 0.46;
              const x0 = b.x, y0 = b.y;
              const x1 = b.x + dx, y1 = b.y;
              const x2 = t.x - dx, y2 = t.y;
              const x3 = t.x, y3 = t.y;
              const mid = bezierPoint(x0,y0,x1,y1,x2,y2,x3,y3,0.5);
              const ang = bezierAngle(x0,y0,x1,y1,x2,y2,x3,y3,0.5);
              const score = data.btScores?.get(`${b.id}_${t.id}`) ?? 0.5;
              return (
                <g key={`bt-${i}`}>
                  <path
                    d={`M ${x0} ${y0} C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`}
                    stroke={highlighted ? "#7C3AED" : "#9CA3AF"}
                    strokeWidth={highlighted ? 2.5 : 1}
                    opacity={highlighted ? highlightOpacity : baseEdgeOpacity}
                    fill="none"
                    onMouseEnter={()=>{ if(!lockedBridge && !lockedTarget){ setHoverBridge(b.id); setHoverTarget(t.id); } }}
                    onMouseLeave={()=>{ if(!lockedBridge){ setHoverBridge(null) } if(!lockedTarget){ setHoverTarget(null) } }}
                    onClick={()=>{ setLockedBridge(lb=> lb===b.id ? null : b.id); setLockedTarget(lt=> lt===t.id ? null : t.id) }}
                    style={{ cursor:'pointer' }}
                  />
                  {showScores && highlighted && (
                    (()=>{
                      const label = `Net ${Math.round(score*100)}`;
                      const w = 64, h = 20;
                      return (
                        <g transform={`translate(${mid.x},${mid.y}) rotate(${ang})`} style={{ pointerEvents:'none' }}>
                          <rect x={-w/2} y={-h/2} width={w} height={h} rx={h/2} fill="rgba(124,58,237,0.22)" stroke="rgba(124,58,237,0.6)" />
                          <text x={0} y={6} textAnchor="middle" style={{ fontSize:11, fill:'#e5ecff' }}>{label}</text>
                        </g>
                      );
                    })()
                  )}
                </g>
              );
            })}
          </g>

          <g filter="url(#glow)">
            <circle cx={data.source.x} cy={data.source.y} r={r.source} fill="url(#gold)" stroke="#92400E" strokeWidth={1.5} />
            {showScores && (activeBridge || activeTarget) && (
              (()=>{
                const rel = getRelevancy();
                const label = `Relevancy ${Math.round(rel*100)}%`;
                const w = 140, h = 24;
                return (
                  <g>
                    <rect x={data.source.x - w/2} y={data.source.y - 44} width={w} height={h} rx={12} fill="rgba(17,24,39,0.7)" stroke="rgba(255,255,255,0.22)" />
                    <text x={data.source.x} y={data.source.y - 28} textAnchor="middle" style={{ fontSize:12, fill:'#e5ecff' }}>{label}</text>
                  </g>
                );
              })()
            )}
          </g>

          <g>
            {data.bridges.map((b) => {
              const isOnPath = activeTarget ? (data.bridgesByTarget.get(activeTarget!)?.includes(b.id) ?? false) : activeBridge === b.id;
              const rr = isOnPath ? r.bridgeHover : r.bridge;
              return (
                <g key={b.id} onMouseEnter={() => { if(!lockedBridge && !lockedTarget){ setHoverBridge(b.id); setHoverTarget(null); } }} onMouseLeave={() => { if(!lockedBridge){ setHoverBridge(null) } }} onClick={()=>{ setLockedTarget(null); setLockedBridge(lb=> lb===b.id ? null : b.id) }} style={{ cursor: "pointer" }}>
                  <circle cx={b.x} cy={b.y} r={rr} fill={isOnPath ? "#0EA5E9" : "#60A5FA"} stroke="#0C4A6E" strokeWidth={isOnPath ? 2 : 1} opacity={activeTarget && !isOnPath ? 0.35 : 1} />
                  {lockedBridge === b.id && (
                    <circle cx={b.x} cy={b.y} r={rr + 6} fill="none" stroke="#93c5fd" strokeOpacity={0.9} strokeWidth={2} />
                  )}
                </g>
              );
            })}
          </g>

          <g>
            {data.targets.map((t) => {
              const isOnPath = activeBridge ? (data.targetsByBridge.get(activeBridge!)?.includes(t.id) ?? false) : activeTarget === t.id;
              const rr = isOnPath ? r.targetHover : r.target;
              return (
                <g key={t.id} onMouseEnter={() => { if(!lockedBridge && !lockedTarget){ setHoverTarget(t.id); setHoverBridge(null); } }} onMouseLeave={() => { if(!lockedTarget){ setHoverTarget(null) } }} onClick={()=>{ setLockedBridge(null); setLockedTarget(lt=> lt===t.id ? null : t.id) }} style={{ cursor: "pointer" }}>
                  <circle cx={t.x} cy={t.y} r={rr} fill={isOnPath ? "#A78BFA" : "#C4B5FD"} stroke="#4C1D95" strokeWidth={isOnPath ? 2 : 1} opacity={activeBridge && !isOnPath ? 0.35 : 1} />
                  {lockedTarget === t.id && (
                    <circle cx={t.x} cy={t.y} r={rr + 6} fill="none" stroke="#c4b5fd" strokeOpacity={0.9} strokeWidth={2} />
                  )}
                  {('label' in t) && (()=>{
                    const label = (t as any).label as string;
                    const pillW = Math.max(64, 16 + label.length * 7);
                    const pillH = 22;
                    let px = t.x + rr + 10;
                    const py = t.y - pillH/2;
                    const margin = 8;
                    if (px + pillW + margin > width){
                      px = t.x - rr - 10 - pillW; // flip to left side if overflowing
                    }
                    return (
                      <g style={{ pointerEvents:'none' }}>
                        <rect x={px} y={py} width={pillW} height={pillH} rx={pillH/2} fill="rgba(2,6,23,0.7)" stroke="rgba(255,255,255,0.25)" />
                        <text x={px + pillW/2} y={py + 14} textAnchor="middle" style={{ fontSize:12, fill:'#e5ecff' }}>{label}</text>
                      </g>
                    );
                  })()}

                  {showScores && (()=>{
                    const opp = data.targetOpportunity.get(t.id)!;
                    const lab = `Opp ${opp}%`;
                    const w2 = Math.max(64, 20 + lab.length * 7);
                    const h2 = 22;
                    let px2 = t.x + rr + 14;
                    const py2 = t.y + rr + 8;
                    if (px2 + w2 + 8 > width){ px2 = t.x - rr - 14 - w2 }
                    return (
                      <g style={{ pointerEvents:'none' }}>
                        <rect x={px2} y={py2} width={w2} height={h2} rx={h2/2} fill="rgba(67,56,202,0.35)" stroke="rgba(167,139,250,0.8)" />
                        <text x={px2 + w2/2} y={py2 + 14} textAnchor="middle" style={{ fontSize:12, fill:'#e5ecff' }}>{lab}</text>
                      </g>
                    )
                  })()}
                </g>
              );
            })}
          </g>
        </svg>

        <div style={{ position:'absolute', left:12, bottom:12, background:'rgba(2,6,23,0.75)', backdropFilter:'blur(6px)', padding:'8px 10px', borderRadius:12, border:'1px solid rgba(255,255,255,0.12)', boxShadow:'0 6px 16px rgba(0,0,0,0.2)', fontSize:12, color:'#cbd5e1', display:'flex', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:12, height:12, borderRadius:999, display:'inline-block', background: 'linear-gradient(135deg,#FDE68A,#F59E0B,#B45309)' }} />
            <span>john kalogerakis</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:12, height:12, borderRadius:999, display:'inline-block', background:'#38bdf8' }} />
            <span>Bridges (seed network)</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:12, height:12, borderRadius:999, display:'inline-block', background:'#c4b5fd' }} />
            <span>HubSpot (people)</span>
          </div>
          <div style={{ marginLeft:6, color:'#93a2ff' }}>Hover bridges or targets to change the lit path. Use Scoring to toggle values.</div>
        </div>
      </div>

      <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'repeat(4, minmax(0, 1fr))', gap:8, fontSize:12, color:'#9fb0ff' }}>
        <Knob label="Bridges" value={numBridges} note="prop" />
        <Knob label="Targets" value={numTargets} note="prop" />
        <Knob label="Fanout" value={`${bridgeFanout[0]}–${bridgeFanout[1]}`} note="prop" />
        <Knob label="Seed" value={seed} note="prop" />
      </div>
    </div>
  );
}

function Knob({ label, value, note }: { label: string; value: React.ReactNode; note?: string }){
  return (
    <div style={{ borderRadius:10, border:'1px solid rgba(255,255,255,0.12)', padding:'8px 12px', background:'rgba(2,6,23,0.6)', boxShadow:'0 2px 8px rgba(0,0,0,0.24)' }}>
      <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:0.6, color:'#93a2ff' }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:600, color:'#e5ecff' }}>{value}</div>
      {note ? <div style={{ fontSize:10, color:'#7ea2ff' }}>{note}</div> : null}
    </div>
  );
}


