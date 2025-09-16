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
    const avatarSize = isMain ? 72 : 44;
    const gap = isMain ? 18 : 12;
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

    return (
      <div style={{ transform:`scale(${rowScale})`, opacity: rowOpacity, transition:'all 160ms ease', padding:'10px 14px', borderRadius:14, border: isMain? '1px solid rgba(79,124,255,0.25)':'1px solid rgba(0,0,0,0)', background: isMain? 'linear-gradient(180deg, rgba(79,124,255,0.08), rgba(79,124,255,0.03))':'transparent' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:gap }}>
          {[t.left, t.middle, t.right].map((p,i)=> (
            <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
              <img src={p.avatarUrl} alt={p.name} style={{ width:avatarSize, height:avatarSize, borderRadius:'50%', objectFit:'cover', boxShadow: isMain? '0 8px 24px rgba(0,0,0,0.25)':'0 4px 14px rgba(0,0,0,0.2)', border: isMain? '2px solid rgba(255,255,255,0.9)':'1px solid rgba(255,255,255,0.6)' }} />
              <div style={{ fontSize:isMain? 13:11, fontWeight:500, color:'#0b122a' }}>{p.name}</div>
            </div>
          ))}
        </div>

        {/* Badges around the main row */}
        <div style={{ display:'flex', justifyContent:'center', gap:10, marginTop: isMain? 14: 10, flexWrap:'wrap' }}>
          <Pill color="#22c55e" label="L–M" value={t.scores.pairLM.toFixed(2)} />
          <Pill color="#22c55e" label="M–R" value={t.scores.pairMR.toFixed(2)} />
          <Pill color="#22c55e" label="L–R" value={t.scores.pairLR.toFixed(2)} />
          <Pill color="#3b82f6" label="Triadic" value={`${t.scores.triadicClosure.toFixed(2)}`} />
          <Pill color={symmetryColor} label="Transactional" value={symbolizeSymmetry(t.scores.transactionalSymmetry)} />
          <Pill color="#6d28d9" label="Opportunity Fit" value={`${Math.round(t.scores.opportunityFit)}%`} />
          <Pill color="#0ea5e9" label="Fan-In" value={`${Math.round(t.scores.fanIn)}pctl`} />
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



