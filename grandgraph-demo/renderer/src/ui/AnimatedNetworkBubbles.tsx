import React, { useMemo, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as d3 from "d3";

export type Role =
  | "Engineers"
  | "Product"
  | "Sales"
  | "Marketing"
  | "HR"
  | "Executives";

export type BubbleDatum = {
  id: string;
  role: Role;
  label?: string;
  population: number;
  strength: number;
  quarterlyJobChanges: { q: string; count: number }[];
};

function mkTrend(startQ: string, base: number, diffs: number[]): { q: string; count: number }[] {
  const [startY, startQi] = startQ.split("Q").map((v) => parseInt(v, 10));
  const out: { q: string; count: number }[] = [];
  let y = startY;
  let qi = startQi;
  diffs.forEach((n) => {
    out.push({ q: `${y}Q${qi}`, count: Math.max(0, n) + base });
    qi += 1;
    if (qi > 4) {
      qi = 1;
      y += 1;
    }
  });
  return out;
}

const MOCK: BubbleDatum[] = [
  { id: "eng", role: "Engineers", population: 820, strength: 0.72, quarterlyJobChanges: mkTrend("2023Q1", 10, [8, 9, 12, 11, 14, 12, 15, 16]) },
  { id: "pm", role: "Product", population: 360, strength: 0.65, quarterlyJobChanges: mkTrend("2023Q1", 6, [7, 6, 5, 8, 9, 7, 10, 12]) },
  { id: "sales", role: "Sales", population: 540, strength: 0.58, quarterlyJobChanges: mkTrend("2023Q1", 12, [13, 12, 10, 9, 11, 13, 15, 14]) },
  { id: "mkt", role: "Marketing", population: 290, strength: 0.51, quarterlyJobChanges: mkTrend("2023Q1", 5, [4, 5, 6, 4, 7, 6, 7, 8]) },
  { id: "hr", role: "HR", population: 160, strength: 0.47, quarterlyJobChanges: mkTrend("2023Q1", 3, [4, 3, 3, 2, 3, 4, 5, 4]) },
  { id: "exec", role: "Executives", population: 120, strength: 0.84, quarterlyJobChanges: mkTrend("2023Q1", 2, [1, 2, 2, 2, 3, 2, 3, 2]) }
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function strengthColor(v: number) {
  const scale = d3.scaleLinear<string>().domain([0, 0.4, 0.7, 1]).range(["#e74c3c", "#f39c12", "#f1c40f", "#2ecc71"]);
  return scale(v);
}

function radius(pop: number, popMax: number, minR = 14, maxR = 68) {
  const s = Math.sqrt(pop / popMax);
  return lerp(minR, maxR, s);
}

function useContainerSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) });
    return () => ro.disconnect();
  }, []);
  return { ref, w: size.w, h: size.h };
}

function computeTargets(
  data: BubbleDatum[],
  mode: Mode,
  dims: { w: number; h: number }
): Record<string, { x: number; y: number }> {
  const { w, h } = dims;
  const cx = w / 2;
  const cy = h / 2;

  if (mode === "overview") {
    const r = Math.min(w, h) * 0.18;
    const step = (2 * Math.PI) / Math.max(1, data.length);
    const anchors: Record<string, { x: number; y: number }> = {};
    data.forEach((d, i) => { anchors[d.id] = { x: cx + Math.cos(i * step) * r, y: cy + Math.sin(i * step) * r }; });
    return anchors;
  }

  if (mode === "changes") {
    const qMax = d3.max(data.map((d) => d.quarterlyJobChanges.at(-1)?.count ?? 0)) || 1;
    const pad = 90;
    const anchors: Record<string, { x: number; y: number }> = {};
    const x = d3.scalePoint(data[0]?.quarterlyJobChanges.map((q) => q.q) || [], [pad, w - pad]);
    const y = d3.scaleLinear().domain([0, qMax]).range([h - pad, pad]);
    data.forEach((d, i) => {
      const qp = d.quarterlyJobChanges.at(-1);
      anchors[d.id] = { x: x(qp?.q ?? "") ?? lerp(pad, w - pad, i / data.length), y: y(qp?.count ?? 0) };
    });
    return anchors;
  }

  const roles = Array.from(new Set(data.map((d) => d.role)));
  const R = Math.min(w, h) * 0.28;
  const anchors: Record<string, { x: number; y: number }> = {};
  roles.forEach((role, ri) => {
    const theta = (ri / roles.length) * Math.PI * 2;
    const rx = cx + Math.cos(theta) * R;
    const ry = cy + Math.sin(theta) * R;
    const pack = data.filter((d) => d.role === role);
    const r = Math.min(w, h) * 0.12;
    pack.forEach((d, i) => {
      const t = (i / Math.max(1, pack.length)) * Math.PI * 2;
      anchors[d.id] = { x: rx + Math.cos(t) * r * 0.6, y: ry + Math.sin(t) * r * 0.6 };
    });
  });
  return anchors;
}

// Deterministic blue-noise-ish packing inside a region predicate
function packPoints(count: number, pred: (x:number,y:number)=>boolean, center:{x:number,y:number}, bounds:{w:number,h:number}, minDist=18){
  const pts: Array<{x:number,y:number}> = []
  const maxAttempts = Math.max(400, count*40)
  const randInBounds = ()=>({ x: Math.random()*bounds.w, y: Math.random()*bounds.h })
  // seed around center first for stable convergence
  for (let i=0;i<Math.min(6,count);i++){
    const a = (i/6) * Math.PI*2
    const r = 8 + i*6
    const x = center.x + Math.cos(a)*r, y = center.y + Math.sin(a)*r
    if (pred(x,y)) pts.push({x,y})
  }
  for (let k=0; k<maxAttempts && pts.length<count; k++){
    const p0 = randInBounds();
    const x = p0.x, y = p0.y
    if (!pred(x,y)) continue
    let ok = true
    for (let j=0;j<pts.length;j++){ const q=pts[j]; const dx=x-q.x, dy=y-q.y; if (dx*dx+dy*dy < minDist*minDist){ ok=false; break } }
    if (ok) pts.push({x,y})
  }
  while (pts.length < count){ // fallback: place near center
    const a = Math.random()*Math.PI*2
    const r = 6 + Math.random()*minDist*0.6
    const x = center.x + Math.cos(a)*r, y = center.y + Math.sin(a)*r
    if (pred(x,y)) pts.push({x,y})
  }
  return pts
}

export type Mode = "overview" | "changes" | "categories";

export default function AnimatedNetworkBubbles({ data = MOCK }: { data?: BubbleDatum[] }) {
  const mode: Mode = "overview";
  const { ref, w, h } = useContainerSize();

  const popMax = useMemo(() => d3.max(data.map((d) => d.population)) || 1, [data]);

  // Create many more bubbles by expanding each cohort into one large + many micro-bubbles
  const bubbles = useMemo(() => {
    const out: Array<{ id: string; role: Role; r: number; fill: string; d: BubbleDatum }> = [];
    for (const d of data) {
      const baseR = radius(d.population, popMax);
      // Large representative bubble
      out.push({ id: `${d.id}__main`, role: d.role, r: baseR, fill: strengthColor(d.strength), d });
      // Number of micro-bubbles scaled by cohort size (kept reasonable for perf)
      const microCount = Math.max(10, Math.min(40, Math.round(baseR)));
      for (let i = 0; i < microCount; i++) {
        const t = i / Math.max(1, microCount - 1);
        // Smaller radii with slight variance
        const rSmall = baseR * (0.10 + 0.25 * (0.6 + 0.4 * Math.random()));
        // Slightly vary strength color brightness by t
        const fill = strengthColor(Math.min(1, Math.max(0, d.strength * (0.9 + 0.2 * (t - 0.5)))));
        out.push({ id: `${d.id}__m${i}`, role: d.role, r: Math.max(6, rSmall), fill, d });
      }
    }
    return out;
  }, [data, popMax]);

  // Base targets derived from cohorts
  const baseAnchors = useMemo(() => computeTargets(data, mode, { w, h }), [data, mode, w, h]);
  // Deterministic jitter per id so instances cluster near their cohort anchor but not exactly overlapping
  const jitterFor = (id: string): { jx: number; jy: number } => {
    // simple deterministic hash → [-0.5,0.5)
    let hsh = 0;
    for (let i = 0; i < id.length; i++) hsh = (hsh * 1664525 + id.charCodeAt(i) + 1013904223) >>> 0;
    const rnd = (seed: number) => ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1;
    const jx = rnd(hsh) - 0.5;
    const jy = rnd(hsh ^ 0x9e3779b9) - 0.5;
    return { jx, jy };
  };
  // Replace force layout with deterministic packing inside three canonical regions: left, right, overlap
  const regions = useMemo(() => {
    const cx = w/2, cy = h/2
    const r1 = Math.min(w,h)*0.34
    const r2 = Math.min(w,h)*0.54
    const left  = { cx: cx - r1*0.55, cy, r: r1 }
    const right = { cx: cx + r1*0.55, cy, r: r1 }
    const overlap = { cx, cy, r: r2*0.42 }
    const predCircle = (C:{cx:number,cy:number,r:number}) => (x:number,y:number)=>{ const dx=x-C.cx, dy=y-C.cy; return dx*dx+dy*dy <= C.r*C.r }
    return { left, right, overlap, pred:{ left: predCircle(left), right: predCircle(right), overlap: predCircle(overlap) } }
  }, [w, h])

  // Assign cohorts to regions (Engineers/Product -> left, Sales/Marketing -> right, Executives/HR -> overlap)
  const regionOf = (role: Role)=> (role==='Engineers'||role==='Product') ? 'left' : (role==='Sales'||role==='Marketing') ? 'right' : 'overlap'

  const positions = useMemo(()=>{
    const buckets: Record<'left'|'right'|'overlap', typeof bubbles> = { left:[], right:[], overlap:[] } as any
    for (const b of bubbles) buckets[regionOf(b.role)].push(b)
    const out: Record<string, { x:number, y:number }> = {}
    const bounds = { w, h }
    const place = (key:'left'|'right'|'overlap')=>{
      const arr = buckets[key]
      if (arr.length===0) return
      const center = { x: (regions as any)[key].cx, y: (regions as any)[key].cy }
      const pred = (regions as any).pred[key]
      // Space-aware min distance based on bubble size median
      const sizes = arr.map(b=>b.r).sort((a,b)=>a-b)
      const med = sizes[Math.floor(sizes.length*0.5)] || 14
      const pts = packPoints(arr.length, pred, center, bounds, Math.max(12, med*0.7))
      for (let i=0;i<arr.length;i++){ out[arr[i].id] = { x: pts[i].x, y: pts[i].y } }
    }
    place('left'); place('right'); place('overlap')
    return out
  }, [bubbles, regions, w, h])

  const floatY = (_i: number) => 0; // keep static to respect region packing
  const strengthLegend = [0.1, 0.4, 0.7, 1.0];

  return (
    <div ref={ref} className="w-full h-full relative">
      <svg width={w} height={h} className="absolute inset-0">
          <AnimatePresence>
            {bubbles.map((b, i) => {
              const p = positions[b.id] || { x: w / 2, y: h / 2 };
              return (
                <motion.g key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <motion.circle
                    cx={p.x}
                    cy={p.y + floatY(i)}
                    r={b.r}
                    fill={b.fill}
                    stroke="#0a0a0a"
                    strokeWidth={1}
                    animate={{ cx: p.x, cy: p.y + floatY(i) }}
                    transition={{ type: "spring", stiffness: 42, damping: 20, mass: 1.2 }}
                  />
                </motion.g>
              );
            })}
          </AnimatePresence>
      </svg>
    </div>
  );
}

// Removed labels and auxiliary overlays to keep the visual minimal


