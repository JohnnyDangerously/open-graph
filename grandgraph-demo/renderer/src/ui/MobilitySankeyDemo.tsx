import React, { useMemo, useState, useEffect } from "react";

/**
 * MobilitySankeyDemo - Employee movement between companies over 16 quarters.
 * Optimized version with reduced line count while maintaining functionality.
 */

// Visual theme - updated to match screenshot aesthetic with transparency
const BG = "rgba(0, 0, 0, 0.95)", NODE_TEXT = "#ffffff", NODE_FILL = "#1a1a1a", NODE_STROKE = "#333333";
const LINK_GRAD_START = "#ff4500", LINK_GRAD_END = "#ff6b35";

// Seeded RNG for deterministic demo data
function mulberry32(seed: number) {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEFT_COMPANIES = ["Apple","Microsoft","Google","Amazon","Meta","Netflix","NVIDIA","Adobe","Salesforce","IBM","Oracle","Uber","Airbnb","Tesla","Stripe","Shopify","Snowflake","ServiceNow","Intel","AMD"];
const RIGHT_COMPANIES = [...LEFT_COMPANIES, "OpenAI","Databricks","Palantir","Coinbase","Block","SpaceX","TikTok","Cisco","Atlassian","Dropbox"];

// 16 quarters (last 4 years)
const QUARTERS = (() => {
  const now = new Date(), list: string[] = [], qNames = ["Q1","Q2","Q3","Q4"];
  const startYear = now.getFullYear() - 4;
  for (let y = startYear; y < startYear + 4; y++) {
    for (let q = 0; q < 4; q++) list.push(`${qNames[q]} ${y}`);
  }
  return list;
})();

// Generate base world data
function makeWorld(seed = 7) {
  const rnd = mulberry32(seed);
  const leftSizes = LEFT_COMPANIES.map((c, i) => {
    const tier = i < 5 ? 1.0 : i < 10 ? 0.6 : i < 15 ? 0.4 : 0.3;
    return Math.round(900 * tier + 200 * rnd());
  });

  const base: number[][] = LEFT_COMPANIES.map(() => RIGHT_COMPANIES.map(() => 0));
  for (let i = 0; i < LEFT_COMPANIES.length; i++) {
    for (let j = 0; j < RIGHT_COMPANIES.length; j++) {
      let v = 0.2 + 0.8 * rnd();
      const L = LEFT_COMPANIES[i], R = RIGHT_COMPANIES[j];
      if (["Apple","Microsoft","Google","Amazon","Meta"].includes(L)) {
        if (["OpenAI","Databricks","SpaceX","Stripe","Snowflake"].includes(R)) v *= 2.4;
        if (["Palantir","Coinbase","Block","Shopify"].includes(R)) v *= 1.6;
      }
      if (["Intel","AMD","NVIDIA"].includes(L) && ["NVIDIA","AMD","Intel","OpenAI","Databricks"].includes(R)) v *= 1.8;
      if (L === R) v *= 0.25;
      base[i][j] = v;
    }
  }
  return { leftSizes, base };
}

// Create flows for quarter - increased density with lots of connections
function makeFlows(world: ReturnType<typeof makeWorld>, qIdx: number) {
  const rnd = mulberry32(100 + qIdx * 13), flows: { from: number; to: number; count: number }[] = [];
  const { leftSizes, base } = world;

  // Define main migration leaders but allow more connections overall
  const mainLeaders = [0, 1, 2, 3]; // Apple, Microsoft, Google, Amazon indices
  
  for (let i = 0; i < LEFT_COMPANIES.length; i++) {
    const isMainLeader = mainLeaders.includes(i);
    const baseChurnRate = isMainLeader ? 0.06 : 0.03; // Higher base rates for more connections
    const churnRate = baseChurnRate + 0.03 * rnd();
    const movers = Math.max(6, Math.round(leftSizes[i] * churnRate));
    
    const weights = base[i].map((b) => b * (0.7 + 0.6 * rnd()));
    const sum = weights.reduce((a, b) => a + b, 0);
    
    // Allow more connections - main leaders get many, others get several
    const maxConnections = isMainLeader ? 12 : 8;
    const sortedTargets = weights.map((w, j) => ({ j, w })).sort((a, b) => b.w - a.w).slice(0, maxConnections);
    
    for (const { j, w } of sortedTargets) {
      const portion = w / sum;
      const count = Math.round(movers * portion * (0.7 + 0.6 * rnd()));
      
      // Lower thresholds for more connections
      const minCount = isMainLeader ? 4 : 2;
      if (count >= minCount && LEFT_COMPANIES[i] !== RIGHT_COMPANIES[j]) {
        flows.push({ from: i, to: j, count });
      }
    }
  }
  return flows;
}

// Layout constants and helpers
const LEFT_X = 140, RIGHT_X = 960, WIDTH = 1100, HEIGHT = 760, NODE_W = 130, GAP = 10;

function layoutNodes(names: string[], sizes: number[], x: number) {
  const total = sizes.reduce((a, b) => a + b, 0);
  const scale = (HEIGHT - GAP * (names.length + 1)) / total;
  let y = GAP;
  return names.map((name, i) => {
    const h = Math.max(6, sizes[i] * scale);
    const node = { name, x, y, width: NODE_W, height: h };
    y += h + GAP;
    return node;
  });
}

function computeRightOrder(flows: { from: number; to: number; count: number }[]) {
  const inflow = RIGHT_COMPANIES.map((_, j) => ({ j, val: flows.filter(f => f.to === j).reduce((a, b) => a + b.count, 0) }));
  inflow.sort((a, b) => b.val - a.val);
  return inflow.map(x => x.j);
}

function makePaths(leftNodes: any[], rightNodes: any[], leftSizes: number[], rightSizes: number[], flows: { from: number; to: number; count: number }[]) {
  const leftTotal = leftSizes.reduce((a, b) => a + b, 0), rightTotal = rightSizes.reduce((a, b) => a + b, 0);
  const leftScale = (HEIGHT - GAP * (leftNodes.length + 1)) / leftTotal;
  const rightScale = (HEIGHT - GAP * (rightNodes.length + 1)) / rightTotal;

  const L = leftNodes.map((n, i) => ({ ...n, cursor: n.y, size: leftSizes[i] }));
  const R = rightNodes.map((n, i) => ({ ...n, cursor: n.y, size: rightSizes[i] }));

  return flows.map((f, idx) => {
    const thicknessL = Math.max(1.2, f.count * leftScale), thicknessR = Math.max(1.2, f.count * rightScale);
    const yL = L[f.from].cursor; L[f.from].cursor += thicknessL;
    const yR = R[f.to].cursor; R[f.to].cursor += thicknessR;

    const x0 = leftNodes[f.from].x + NODE_W, y0 = yL + thicknessL / 2;
    const x1 = rightNodes[f.to].x, y1 = yR + thicknessR / 2;
    const dx = (x1 - x0), c1x = x0 + dx * 0.25, c2x = x0 + dx * 0.75;
    const d = `M ${x0},${y0} C ${c1x},${y0} ${c2x},${y1} ${x1},${y1}`;

    return { key: `${f.from}-${f.to}-${idx}`, d, width: Math.max(1, (thicknessL + thicknessR) / 2), from: f.from, to: f.to, count: f.count };
  });
}

export default function MobilitySankeyDemo() {
  const [q, setQ] = useState(0);
  const world = useMemo(() => makeWorld(42), []);
  const leftNodes = useMemo(() => layoutNodes(LEFT_COMPANIES, world.leftSizes, LEFT_X), [world.leftSizes]);

  const { flows, rightNodes, rightSizes } = useMemo(() => {
    const f = makeFlows(world, q), order = computeRightOrder(f);
    const sizesRight = RIGHT_COMPANIES.map((_, j) => f.filter(x => x.to === j).reduce((a,b)=>a+b.count,0) + 200);
    const reorderedNames = order.map(j => RIGHT_COMPANIES[j]), reorderedSizes = order.map(j => sizesRight[j]);
    const nodesRight = layoutNodes(reorderedNames, reorderedSizes, RIGHT_X);
    
    const mapJ: Record<number, number> = {};
    order.forEach((j, pos) => mapJ[j] = pos);
    const remapped = f.map(fl => ({ ...fl, to: mapJ[fl.to] }));
    
    return { flows: remapped, rightNodes: nodesRight, rightSizes: reorderedSizes };
  }, [q, world]);

  const paths = useMemo(() => makePaths(leftNodes, rightNodes, world.leftSizes, rightSizes, flows), [leftNodes, rightNodes, world.leftSizes, rightSizes, flows]);

  // Removed auto-progression - user controls manually

  return (
    <div className="w-full h-full flex flex-col" style={{ background: BG, minHeight: '100%', padding: '24px' }}>
      <div className="mb-4 flex-shrink-0">
        <h2 className="text-2xl font-bold tracking-tight mb-2" style={{ color: NODE_TEXT }}>
          Migratory <span style={{ color: LINK_GRAD_START }}>Patterns</span>
        </h2>
        <p className="text-sm opacity-60" style={{ color: NODE_TEXT }}>
          migration flows across the world.
        </p>
      </div>

      <div className="flex-1 relative rounded-lg overflow-hidden mb-4" style={{ border: `1px solid ${NODE_STROKE}` }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="gLink" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={LINK_GRAD_START} />
              <stop offset="100%" stopColor={LINK_GRAD_END} />
            </linearGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {paths.map((p) => (
            <path key={p.key} d={p.d} stroke="url(#gLink)" strokeWidth={p.width} strokeOpacity={0.7} fill="none" filter="url(#glow)" />
          ))}

          {leftNodes.map((n: any, i: number) => (
            <g key={`L-${i}`}>
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={4} fill={NODE_FILL} stroke={NODE_STROKE} strokeWidth={0.5} />
              <text x={n.x + 8} y={n.y + n.height / 2} fill={NODE_TEXT} fontSize={10} textAnchor="start" dominantBaseline="middle" opacity={0.9}>{LEFT_COMPANIES[i]}</text>
            </g>
          ))}

          {rightNodes.map((n: any, i: number) => (
            <g key={`R-${i}`}>
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={4} fill={NODE_FILL} stroke={NODE_STROKE} strokeWidth={0.5} />
              <text x={n.x + n.width - 8} y={n.y + n.height / 2} fill={NODE_TEXT} fontSize={10} textAnchor="end" dominantBaseline="middle" opacity={0.9}>{rightNodes[i].name}</text>
            </g>
          ))}
        </svg>
      </div>

      {/* Quarter slider at bottom - now properly contained */}
      <div className="flex-shrink-0 flex items-center justify-center gap-4 py-2">
        <div className="text-sm font-medium" style={{ color: NODE_TEXT, minWidth: '80px' }}>
          {QUARTERS[q]}
        </div>
        <div className="flex-1 max-w-md">
          <input 
            type="range" 
            min={0} 
            max={QUARTERS.length - 1} 
            value={q} 
            onChange={(e) => setQ(parseInt(e.target.value))} 
            className="w-full h-2 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, ${LINK_GRAD_START} 0%, ${LINK_GRAD_START} ${(q / (QUARTERS.length - 1)) * 100}%, #333 ${(q / (QUARTERS.length - 1)) * 100}%, #333 100%)`,
              outline: 'none'
            }}
          />
        </div>
        <div className="text-xs opacity-50" style={{ color: NODE_TEXT, minWidth: '120px', textAlign: 'right' }}>
          Quarter {q + 1} of {QUARTERS.length}
        </div>
      </div>
    </div>
  );
}
