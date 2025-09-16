import React from "react";

type Person = {
  name: string;
  title?: string;
  avatarUrl?: string; // optional, but not used in this visualization
};

type Triple = {
  left: Person;   // asker
  middle: Person; // intermediary
  right: Person;  // target
  scores: {
    pairLM: number; // L–M relationship strength
    pairMR: number; // M–R relationship strength
    pairLR: number; // L–R relationship strength
    triadicClosure: number; // how cohesive the trio is
    transactionalSymmetry: "junior_to_senior" | "senior_to_junior" | "peer_to_peer";
    opportunityFit: number; // 0..100
    fanIn: number; // percentile 0..100
  };
  highlighted?: boolean;
};

export default function TriplesModal({ open, onClose, triples }:{ open:boolean, onClose:()=>void, triples: Triple[] }){
  if (!open) return null;

  const Row = ({ t, index }:{ t: Triple, index: number }) => {
    const isMain = !!t.highlighted;
    const nodeSize = isMain ? 84 : 22;
    const gap = isMain ? 56 : 10;
    const rowOpacity = isMain ? 1 : 0.55;
    const rowScale = isMain ? 1 : 0.9;

    const Pill = ({ color, label, value, hint }:{ color:string, label:string, value:string | number, hint?:string }) => (
      <div title={hint} aria-label={hint} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background:`${color}15`, color, fontSize:12, border:`1px solid ${color}40` }}>
        <span style={{ fontWeight:600 }}>{label}</span>
        <span style={{ opacity:0.9 }}>{value}</span>
      </div>
    );

    const Arrow = ({ dir }:{ dir:"ltm"|"mtr"|"ltr" }) => {
      const map:{[k:string]:string} = { ltm: "→", mtr: "→", ltr: "↔" };
      return <span style={{ margin:'0 6px', opacity:0.7 }}>{map[dir]}</span>;
    }

    const symmetryColor = t.scores.transactionalSymmetry === 'junior_to_senior' ? '#ff9f43' : t.scores.transactionalSymmetry === 'senior_to_junior' ? '#ffa552' : '#ffa552';

    const NodeToken = ({ label, size, idx }:{ label:string, size:number, idx:number }) => (
      <div style={{ width:size, height:size, borderRadius:'50%', display:'grid', placeItems:'center', fontSize: Math.max(12, size*0.3), fontWeight:800, color:'#fff', background: gradientForIndex(idx), boxShadow:'0 14px 38px rgba(0,0,0,0.45)', border:'2px solid rgba(255,255,255,0.85)' }}>{label}</div>
    );

    if (!isMain) {
      return (
        <div style={{ transform:`scale(${rowScale})`, opacity: rowOpacity, transition:'all 160ms ease', padding:'10px 14px', borderRadius:12, background:'linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))', border:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:12 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:24 }}>
              <NodeToken label={getInitials(t.left.name)} size={nodeSize} idx={0} />
              <NodeToken label={getInitials(t.middle.name)} size={nodeSize} idx={1} />
              <NodeToken label={getInitials(t.right.name)} size={nodeSize} idx={2} />
            </div>
            <div style={{ justifySelf:'end' }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background:'rgba(255,255,255,0.04)', color:'#e5ecff', fontSize:11, border:'1px solid rgba(255,255,255,0.12)' }}>Score {Math.round((t.scores.triadicClosure*100 + t.scores.opportunityFit)/2)}</div>
            </div>
          </div>
        </div>
      );
    }

    // Highlighted row with bracketed scoring overlay
    const WIDTH = 1280;
    const AV = nodeSize; // 84
    const GAP = 260; // much more generous spacing to avoid crowding
    const center = WIDTH / 2;
    const c1 = center - (AV + GAP);
    const c2 = center;
    const c3 = center + (AV + GAP);
    const topY = 40;
    const abovePairY = 90;
    const avatarY = 160;
    const belowPairY = 230;
    const triadicY = 260;
    const bottomY = 285;
    const leftBracketX = c1 - AV/2 - 80;
    const rightBracketX = c3 + AV/2 + 80;

    const Line = ({ x1, x2, y }:{ x1:number, x2:number, y:number }) => (
      <line x1={x1} x2={x2} y1={y} y2={y} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={3} strokeLinecap="round" />
    );

    const VLine = ({ x, y1, y2 }:{ x:number, y1:number, y2:number }) => (
      <line x1={x} x2={x} y1={y1} y2={y2} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={3} strokeLinecap="round" />
    );

    const Badge = ({ x, y, color, label, hint }:{ x:number, y:number, color:string, label:string, hint?:string }) => (
      <foreignObject x={x} y={y} width={260} height={28} style={{ overflow:'visible', pointerEvents:'auto' }}>
        <div title={hint} aria-label={hint} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background:`${color}12`, color, fontSize:12, border:`1px solid ${color}40`, transform:'translate(-50%, -50%)' }}>{label}</div>
      </foreignObject>
    );

    return (
      <div style={{ transform:`scale(${rowScale})`, opacity: rowOpacity, transition:'all 160ms ease', padding:'18px 16px 12px 16px', borderRadius:16, border:'1px solid rgba(79,124,255,0.22)', background:'linear-gradient(180deg, rgba(79,124,255,0.10), rgba(79,124,255,0.04))' }}>
        <div style={{ width:WIDTH, maxWidth:'98vw', position:'relative', margin:'0 auto' }}>
          {/* SVG overlay for brackets */}
          <svg width={WIDTH} height={320} style={{ position:'absolute', inset:0 }}>
            {/* Top bracket across all three */}
            <Line x1={c1 - AV/2} x2={c3 + AV/2} y={topY} />
            <Badge x={center} y={topY} color="#38bdf8" label={`Overall Rank: #1 of 5`} hint="Overall Triple Rank vs other candidates in the list" />

            {/* Above pair brackets */}
            <Line x1={c1 + AV/2} x2={c2 - AV/2} y={abovePairY} />
            <Badge x={(c1 + c2)/2} y={abovePairY - 16} color="#22c55e" label={`L–M ${t.scores.pairLM.toFixed(2)}`} hint="Pairwise Relationship Strength (Left ↔ Middle), normalized 0–1" />
            <Line x1={c2 + AV/2} x2={c3 - AV/2} y={abovePairY} />
            <Badge x={(c2 + c3)/2} y={abovePairY - 16} color="#22c55e" label={`M–R ${t.scores.pairMR.toFixed(2)}`} hint="Pairwise Relationship Strength (Middle ↔ Right), normalized 0–1" />

            {/* Below pair brackets */}
            <Line x1={c1 + AV/2} x2={c2 - AV/2} y={belowPairY} />
            <Badge x={(c1 + c2)/2} y={belowPairY + 16} color="#22c55e" label={`L–M ${t.scores.pairLM.toFixed(2)}`} hint="Pairwise Relationship Strength (Left ↔ Middle), normalized 0–1" />
            <Line x1={c2 + AV/2} x2={c3 - AV/2} y={belowPairY} />
            <Badge x={(c2 + c3)/2} y={belowPairY + 16} color="#22c55e" label={`M–R ${t.scores.pairMR.toFixed(2)}`} hint="Pairwise Relationship Strength (Middle ↔ Right), normalized 0–1" />

            {/* Wide triadic bracket under all three */}
            <Line x1={c1 - AV/3} x2={c3 + AV/3} y={triadicY} />
            <Badge x={center} y={triadicY + 18} color="#60a5fa" label={`Triadic Closure ${t.scores.triadicClosure.toFixed(2)} • Fan-In ${Math.round(t.scores.fanIn)}pctl`} hint="Group connectivity: how tightly these three are connected • Fan-In indicates how this triple compares to the network (percentile)." />

            {/* Left relevance vertical bracket */}
            <VLine x={leftBracketX} y1={topY} y2={bottomY} />
            <Badge x={leftBracketX - 4} y={(topY + bottomY)/2} color="#94a3b8" label={`Relevance Index`} hint="How relevant this triple is to the input ask (context-specific)." />

            {/* Right overall triple score vertical bracket */}
            <VLine x={rightBracketX} y1={topY} y2={bottomY} />
            <Badge x={rightBracketX + 4} y={(topY + bottomY)/2} color="#e5ecff" label={`Triple Score`} hint="Composite of relevance, closure, symmetry, fit, and fan-in." />
          </svg>

          {/* Node tokens row (no avatars) */}
          <div style={{ height:300 }} />
          <div style={{ position:'absolute', left:0, right:0, top:avatarY - AV/2, display:'flex', justifyContent:'center', gap:GAP }}>
            {[t.left, t.middle, t.right].map((p,i)=> (
              <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                <NodeToken label={getInitials(p.name)} size={AV} idx={i} />
                <div style={{ fontSize:13, fontWeight:600, color:'#0b122a' }}>{p.name}</div>
              </div>
            ))}
          </div>

          {/* Center badges for symmetry and opportunity fit */}
          <div style={{ position:'absolute', left:0, right:0, top:avatarY + AV/2 + 6, display:'flex', justifyContent:'center', gap:10 }}>
            <Pill color={symmetryColor} label="Transactional" value={symbolizeSymmetry(t.scores.transactionalSymmetry)} hint="Direction of influence for the introduction (junior → senior, senior → junior, or peers)." />
            <Pill color="#a78bfa" label="Opportunity Fit" value={`${Math.round(t.scores.opportunityFit)}%`} hint="Likelihood the ask succeeds given opportunity alignment and timing." />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ position:'absolute', inset:0, background:'rgba(2,6,23,0.7)', display:'grid', placeItems:'center', zIndex:40 }}>
      <div style={{ width:1400, maxWidth:'98vw', padding:30, borderRadius:28, background:'#0b122a', color:'#e5ecff', border:'1px solid rgba(255,255,255,0.08)', boxShadow:'0 40px 160px rgba(0,0,0,0.65)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:18, fontWeight:700 }}>Top Triples</div>
          <div style={{ fontSize:12, opacity:0.7 }}>AI-ranked introductions</div>
        </div>

        <div style={{ display:'grid', gap:22, alignItems:'center', justifyItems:'stretch' }}>
          {triples.map((t, i)=> (
            // ts: key is valid on ReactElement; cast to any to satisfy relaxed shim
            (Row as any)({ t, index: i, key: i })
          ))}
        </div>

        <div style={{ display:'flex', justifyContent:'center', marginTop:24 }}>
          <button onClick={onClose} style={{ padding:'12px 16px', borderRadius:12, background:'linear-gradient(180deg, #0f172a, #0b122a)', color:'#e5ecff', border:'1px solid rgba(255,255,255,0.12)', boxShadow:'0 12px 40px rgba(0,0,0,0.5)' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function symbolizeSymmetry(s: Triple['scores']['transactionalSymmetry']): string {
  if (s === 'junior_to_senior') return '↗ junior → senior';
  if (s === 'senior_to_junior') return '↘ senior → junior';
  return '↔ peer ↔ peer';
}

function getInitials(name: string){
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length-1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

function gradientForIndex(i:number){
  const gradients = [
    'linear-gradient(135deg, #6EE7B7 0%, #3B82F6 100%)',
    'linear-gradient(135deg, #FDE68A 0%, #F59E0B 100%)',
    'linear-gradient(135deg, #FCA5A5 0%, #EF4444 100%)',
  ];
  return gradients[i % gradients.length];
}



