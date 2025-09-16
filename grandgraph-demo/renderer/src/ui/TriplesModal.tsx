import React from "react";

type Person = {
  name: string;
  title?: string;
  avatarUrl: string;
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
    const avatarSize = isMain ? 88 : 44;
    const gap = isMain ? 24 : 12;
    const rowOpacity = isMain ? 1 : 0.55;
    const rowScale = isMain ? 1 : 0.9;

    const Pill = ({ color, label, value }:{ color:string, label:string, value:string | number }) => (
      <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background:`${color}15`, color, fontSize:12, border:`1px solid ${color}40` }}>
        <span style={{ fontWeight:600 }}>{label}</span>
        <span style={{ opacity:0.9 }}>{value}</span>
      </div>
    );

    const Arrow = ({ dir }:{ dir:"ltm"|"mtr"|"ltr" }) => {
      const map:{[k:string]:string} = { ltm: "→", mtr: "→", ltr: "↔" };
      return <span style={{ margin:'0 6px', opacity:0.7 }}>{map[dir]}</span>;
    }

    const symmetryColor = t.scores.transactionalSymmetry === 'junior_to_senior' ? '#ff9f43' : t.scores.transactionalSymmetry === 'senior_to_junior' ? '#ffa552' : '#ffa552';

    if (!isMain) {
      return (
        <div style={{ transform:`scale(${rowScale})`, opacity: rowOpacity, transition:'all 160ms ease', padding:'10px 14px', borderRadius:14 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:gap }}>
            {[t.left, t.middle, t.right].map((p,i)=> (
              <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                <img src={p.avatarUrl} alt={p.name} style={{ width:avatarSize, height:avatarSize, borderRadius:'50%', objectFit:'cover', boxShadow:'0 4px 14px rgba(0,0,0,0.2)', border:'1px solid rgba(0,0,0,0.08)' }} />
                <div style={{ fontSize:11, fontWeight:500, color:'#0b122a', opacity:0.85 }}>{p.name}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Highlighted row with bracketed scoring overlay
    const WIDTH = 680;
    const AV = avatarSize; // 88
    const GAP = 120; // generous spacing
    const center = WIDTH / 2;
    const c1 = center - (AV + GAP);
    const c2 = center;
    const c3 = center + (AV + GAP);
    const topY = 22;
    const abovePairY = 44;
    const avatarY = 78;
    const belowPairY = 138;
    const triadicY = 164;
    const bottomY = 180;
    const leftBracketX = c1 - AV/2 - 56;
    const rightBracketX = c3 + AV/2 + 56;

    const Line = ({ x1, x2, y }:{ x1:number, x2:number, y:number }) => (
      <line x1={x1} x2={x2} y1={y} y2={y} stroke="#0b122a" strokeOpacity={0.25} strokeWidth={6} strokeLinecap="round" />
    );

    const VLine = ({ x, y1, y2 }:{ x:number, y1:number, y2:number }) => (
      <line x1={x} x2={x} y1={y1} y2={y2} stroke="#0b122a" strokeOpacity={0.25} strokeWidth={6} strokeLinecap="round" />
    );

    const Badge = ({ x, y, color, label }:{ x:number, y:number, color:string, label:string }) => (
      <foreignObject x={x} y={y} width={260} height={28} style={{ overflow:'visible' }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background:`${color}12`, color, fontSize:12, border:`1px solid ${color}40`, transform:'translate(-50%, -50%)' }}>{label}</div>
      </foreignObject>
    );

    return (
      <div style={{ transform:`scale(${rowScale})`, opacity: rowOpacity, transition:'all 160ms ease', padding:'16px 14px 10px 14px', borderRadius:16, border:'1px solid rgba(79,124,255,0.18)', background:'linear-gradient(180deg, rgba(79,124,255,0.06), rgba(79,124,255,0.02))' }}>
        <div style={{ width:WIDTH, maxWidth:'92vw', position:'relative', margin:'0 auto' }}>
          {/* SVG overlay for brackets */}
          <svg width={WIDTH} height={200} style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
            {/* Top bracket across all three */}
            <Line x1={c1 - AV/2} x2={c3 + AV/2} y={topY} />
            <Badge x={center} y={topY} color="#0ea5e9" label={`Overall Rank: #1 of 5`} />

            {/* Above pair brackets */}
            <Line x1={c1 + AV/2} x2={c2 - AV/2} y={abovePairY} />
            <Badge x={(c1 + c2)/2} y={abovePairY - 16} color="#22c55e" label={`L–M ${t.scores.pairLM.toFixed(2)}`} />
            <Line x1={c2 + AV/2} x2={c3 - AV/2} y={abovePairY} />
            <Badge x={(c2 + c3)/2} y={abovePairY - 16} color="#22c55e" label={`M–R ${t.scores.pairMR.toFixed(2)}`} />

            {/* Below pair brackets */}
            <Line x1={c1 + AV/2} x2={c2 - AV/2} y={belowPairY} />
            <Badge x={(c1 + c2)/2} y={belowPairY + 16} color="#22c55e" label={`L–M ${t.scores.pairLM.toFixed(2)}`} />
            <Line x1={c2 + AV/2} x2={c3 - AV/2} y={belowPairY} />
            <Badge x={(c2 + c3)/2} y={belowPairY + 16} color="#22c55e" label={`M–R ${t.scores.pairMR.toFixed(2)}`} />

            {/* Wide triadic bracket under all three */}
            <Line x1={c1 - AV/3} x2={c3 + AV/3} y={triadicY} />
            <Badge x={center} y={triadicY + 18} color="#3b82f6" label={`Triadic Closure ${t.scores.triadicClosure.toFixed(2)} • Fan-In ${Math.round(t.scores.fanIn)}pctl`} />

            {/* Left relevance vertical bracket */}
            <VLine x={leftBracketX} y1={topY} y2={bottomY} />
            <Badge x={leftBracketX - 4} y={(topY + bottomY)/2} color="#64748b" label={`Relevance Index`} />

            {/* Right overall triple score vertical bracket */}
            <VLine x={rightBracketX} y1={topY} y2={bottomY} />
            <Badge x={rightBracketX + 4} y={(topY + bottomY)/2} color="#111827" label={`Triple Score`} />
          </svg>

          {/* Avatars row */}
          <div style={{ height:200 }} />
          <div style={{ position:'absolute', left:0, right:0, top:avatarY - AV/2, display:'flex', justifyContent:'center', gap:GAP }}>
            {[t.left, t.middle, t.right].map((p,i)=> (
              <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                <img src={p.avatarUrl} alt={p.name} style={{ width:AV, height:AV, borderRadius:'50%', objectFit:'cover', boxShadow:'0 10px 26px rgba(0,0,0,0.25)', border:'2px solid rgba(255,255,255,0.95)' }} />
                <div style={{ fontSize:13, fontWeight:600, color:'#0b122a' }}>{p.name}</div>
              </div>
            ))}
          </div>

          {/* Center badges for symmetry and opportunity fit */}
          <div style={{ position:'absolute', left:0, right:0, top:avatarY + AV/2 + 6, display:'flex', justifyContent:'center', gap:10 }}>
            <Pill color={symmetryColor} label="Transactional" value={symbolizeSymmetry(t.scores.transactionalSymmetry)} />
            <Pill color="#6d28d9" label="Opportunity Fit" value={`${Math.round(t.scores.opportunityFit)}%`} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ position:'absolute', inset:0, background:'rgba(10,12,20,0.45)', display:'grid', placeItems:'center', zIndex:40 }}>
      <div style={{ width:780, maxWidth:'92vw', padding:22, borderRadius:20, background:'#ffffff', color:'#0b122a', border:'1px solid rgba(0,0,0,0.08)', boxShadow:'0 18px 80px rgba(10,12,20,0.35)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:18, fontWeight:700 }}>Top Triples</div>
          <div style={{ fontSize:12, opacity:0.65 }}>AI-ranked introductions</div>
        </div>

        <div style={{ display:'grid', gap:12, alignItems:'center', justifyItems:'stretch' }}>
          {triples.map((t, i)=> (
            <Row key={i} t={t} index={i} />
          ))}
        </div>

        <div style={{ display:'flex', justifyContent:'center', marginTop:16 }}>
          <button onClick={onClose} style={{ padding:'12px 16px', borderRadius:12, background:'#0b122a', color:'#fff', border:'1px solid rgba(0,0,0,0.12)', boxShadow:'0 8px 30px rgba(11,18,42,0.35)' }}>Close</button>
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



