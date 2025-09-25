// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import createREGL, { Regl } from 'regl';

function easeInOutCubic(t: number) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }
function clamp01(x: number) { return Math.min(1, Math.max(0, x)) }

type MegaConfig = {
  particleCount?: number;
  clusterCount?: number;
  pointSizePx?: number;
  baseColor?: [number, number, number];
  background?: [number, number, number];
  glow?: number; // alpha scaler
  spokeFraction?: number; // 0..1 of particles biased along great-circle spokes
};

type Props = { onDone?: () => void; onConnect?: () => void; config?: MegaConfig; dense?: boolean; palette?: 'default' | 'random' | 'whiteBlue' | 'allWhite' | 'whiteBluePurple'; brightness?: number; showEdges?: boolean; edgeMultiplier?: number; fourCores?: boolean; asBackground?: boolean; syncKey?: string; nodeScale?: number; edgeFraction?: number; edgeAlpha?: number; sizeScale?: number; rotSpeed?: number; edgeColor?: string; sideHole?: boolean; sectorDensity?: boolean; bgPaused?: boolean; bgRotSpeed?: number };

export default function LoginScene({ onDone, onConnect, config, dense, palette = 'default', brightness = 1.0, showEdges = false, edgeMultiplier = 1, fourCores = false, asBackground = false, syncKey = 'bg', nodeScale = 1.0, edgeFraction = 1.0, edgeAlpha = 1.0, sizeScale = 1.0, rotSpeed = 0.0, edgeColor = '#4da3ff', sideHole = false, sectorDensity = false, bgPaused = false, bgRotSpeed = 0.0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reglRef = useRef<Regl | null>(null);
  const rafRef = useRef<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const startedRef = useRef(false);
  const doneRef = useRef(false);
  const filledRef = useRef(0); // number of points currently generated
  const [companyTags, setCompanyTags] = useState<Array<{id: number, company: string, x: number, y: number, startTime: number, angle: number}>>([]);
  // single hopping sparkle state
  const [sparkles, setSparkles] = useState<Array<{id: number, edgeIndex: number, progress: number, startTime: number, color: [number, number, number]}>>([]);
  const [flowParticles, setFlowParticles] = useState<Array<never>>([] as any);
  const paletteRef = useRef<number>(0);
  const brightnessRef = useRef<number>(brightness);
  const nodeScaleRef = useRef<number>(Math.max(0.25, Math.min(4.0, nodeScale)));
  const edgeFractionRef = useRef<number>(Math.max(0.0, Math.min(1.0, edgeFraction)));
  const edgeAlphaRef = useRef<number>(Math.max(0.0, Math.min(2.0, edgeAlpha)));
  const sizeScaleRef = useRef<number>(Math.max(0.25, Math.min(3.0, sizeScale)));
  const rotSpeedRef = useRef<number>(Math.max(0.0, Math.min(0.2, rotSpeed)));
  function hexToRgbVec3(hex: string): [number, number, number] {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#4da3ff');
    const r = m ? parseInt(m[1], 16) : 77;
    const g = m ? parseInt(m[2], 16) : 163;
    const b = m ? parseInt(m[3], 16) : 255;
    return [r/255, g/255, b/255];
  }
  const edgeColorRef = useRef<[number,number,number]>(hexToRgbVec3(edgeColor));

  const isDense = !!dense;
  const cfg = {
    // Reduced particle count for better performance while maintaining visual appeal
    particleCount: Math.max(200, Math.floor((isDense ? 35000 : 18000) * nodeScaleRef.current)),
    clusterCount: 6, // reduced from 9
    pointSizePx: isDense ? 1.8 : 7.0, // slightly larger points to compensate for fewer particles
    // Softer cyan/blue glow
    baseColor: isDense ? ([0.72, 0.62, 0.94] as [number, number, number]) : ([0.45, 0.80, 1.0] as [number, number, number]),
    background: [0.04, 0.04, 0.07] as [number, number, number],
    glow: isDense ? 1.25 : 1.05, // slightly higher glow to compensate for fewer particles
    spokeFraction: isDense ? 0.20 : 0.10,
    ...(config || {})
  };
  // Four-core hubs: two large, one medium, one small — clearly separated in space
  const hubDirs: Array<[number,number,number]> = [
    [0.85, 0.05, 0.52],    // large A
    [-0.78, -0.08, 0.62],  // large B
    [0.12, 0.92, 0.38],    // medium
    [-0.18, -0.36, -0.92], // small
  ];
  const hubCenterR = [0.58, 0.62, 0.48, 0.70]; // place centers well away from origin
  const hubSigma =     [0.12, 0.12, 0.24, 0.05]; // double medium hub spread to avoid hot core
  function norm3v(v:[number,number,number]){ const L=Math.hypot(v[0],v[1],v[2])||1e-6; return [v[0]/L,v[1]/L,v[2]/L] as [number,number,number] }
  const hubUnit = hubDirs.map(norm3v);
  const hubCenters: Array<[number,number,number]> = hubUnit.map((u,i)=>[u[0]*hubCenterR[i], u[1]*hubCenterR[i], u[2]*hubCenterR[i]] as [number,number,number]);
  function sampleHub(i:number){
    const c = hubCenters[i]; const s = hubSigma[i];
    const gx = (Math.random()*2-1)+(Math.random()*2-1)+(Math.random()*2-1);
    const gy = (Math.random()*2-1)+(Math.random()*2-1)+(Math.random()*2-1);
    const gz = (Math.random()*2-1)+(Math.random()*2-1)+(Math.random()*2-1);
    return [c[0] + s*gx, c[1] + s*gy, c[2] + s*gz] as [number,number,number];
  }
  function nearAnyHub(x:number,y:number,z:number): boolean {
    if (!fourCores) return false;
    for (let i=0;i<hubCenters.length;i++){
      const c = hubCenters[i]; const s = hubSigma[i]*2.5; // influence radius
      const dx=x-c[0], dy=y-c[1], dz=z-c[2];
      if (dx*dx+dy*dy+dz*dz < s*s) return true;
    }
    return false;
  }

  function paletteToId(p: typeof palette): number {
    switch (p) {
      case 'random': return 4;
      case 'whiteBlue': return 1;
      case 'allWhite': return 2;
      case 'whiteBluePurple': return 3;
      default: return 0; // default single color
    }
  }

  React.useEffect(()=>{ paletteRef.current = paletteToId(palette); }, [palette]);
  React.useEffect(()=>{ brightnessRef.current = Math.max(0.2, Math.min(2.5, brightness)); }, [brightness]);
  React.useEffect(()=>{ nodeScaleRef.current = Math.max(0.25, Math.min(4.0, nodeScale)); }, [nodeScale]);
  React.useEffect(()=>{ edgeFractionRef.current = Math.max(0.0, Math.min(1.0, edgeFraction)); }, [edgeFraction]);
  React.useEffect(()=>{ edgeAlphaRef.current = Math.max(0.0, Math.min(2.0, edgeAlpha)); }, [edgeAlpha]);
  React.useEffect(()=>{ sizeScaleRef.current = Math.max(0.25, Math.min(3.0, sizeScale)); }, [sizeScale]);
  React.useEffect(()=>{ rotSpeedRef.current = Math.max(0.0, Math.min(0.2, rotSpeed)); }, [rotSpeed]);
  React.useEffect(()=>{ edgeColorRef.current = hexToRgbVec3(edgeColor); }, [edgeColor]);

  // Bite configuration for "unfinished sphere" effect
  const biteDir = [0.82, 0.06, 0.57] as const; // approximate front-right
  const biteDir2 = [-0.78, 0.04, 0.58] as const; // front-left secondary bite
  const biteCosAngle = Math.cos(55 * Math.PI / 180); // ~55° cone
  const biteFeather = 0.10; // soften boundary
  const biteJaggedStrength = 0.22; // 0..1 noise-amplitude along boundary

  function inBiteCone(x: number, y: number, z: number): boolean {
    const L = Math.hypot(x, y, z) || 1e-6;
    const ux = x / L, uy = y / L, uz = z / L;
    const d1 = ux * biteDir[0] + uy * biteDir[1] + uz * biteDir[2];
    const d2 = ux * biteDir2[0] + uy * biteDir2[1] + uz * biteDir2[2];
    // Feathered, noisy edge
    const edgeNoise = (Math.sin(x * 9.3 + y * 8.1 + z * 7.2) * Math.cos(x * 6.7 - y * 5.5 + z * 4.9) * 0.5 + 0.5);
    const jagged = (edgeNoise - 0.5) * 2 * biteJaggedStrength; // [-s, s]
    return (d1 > (biteCosAngle + jagged - biteFeather)) || (d2 > (biteCosAngle + jagged - biteFeather));
  }

  // Returns 0..1: how far inside the bite cone the vector is (with jagged edge)
  function biteAmount(x: number, y: number, z: number): number {
    const L = Math.hypot(x, y, z) || 1e-6;
    const ux = x / L, uy = y / L, uz = z / L;
    const d1 = ux * biteDir[0] + uy * biteDir[1] + uz * biteDir[2];
    const d2 = ux * biteDir2[0] + uy * biteDir2[1] + uz * biteDir2[2];
    const d = Math.max(d1, d2);
    const edgeNoise = (Math.sin(x * 9.3 + y * 8.1 + z * 7.2) * Math.cos(x * 6.7 - y * 5.5 + z * 4.9) * 0.5 + 0.5);
    const jagged = (edgeNoise - 0.5) * 2 * biteJaggedStrength;
    const threshold = biteCosAngle + jagged - biteFeather;
    const t = (d - threshold) / (1 - threshold);
    return Math.max(0, Math.min(1, t));
  }

  // animated uniform sources
  const phaseRef = useRef(0.0); // keep 3D orb shape (we won't push to 1)
  const zoomRef = useRef(700);  // perspective-ish scaler
  const tiltRef = useRef(15 * Math.PI / 180); // gentle tilt around X
  const yawRef = useRef(0.0)
  const yawStartRef = useRef(0.0)
  const yawTargetRef = useRef(0.0)
  const rotateStartRef = useRef(0)
  const lastT = useRef(0)
  // Parallax shift from foreground camera (in screen pixels)
  const pxRef = useRef(0)
  const pyRef = useRef(0)
  // Store edge data for sparkle effects
  const edgeDataRef = useRef<Float32Array | null>(null)
  const edgeCountRef = useRef(0)
 
  // No separate flat layer anymore; keep single starfield and zoom in

  // Company names for random tags
  const companies = [
    'Apple', 'Microsoft', 'Google', 'Amazon', 'Meta', 'Tesla', 'Netflix', 'Spotify', 'Adobe', 'Salesforce',
    'Oracle', 'IBM', 'Intel', 'NVIDIA', 'AMD', 'Cisco', 'VMware', 'ServiceNow', 'Zoom', 'Slack',
    'Shopify', 'Square', 'PayPal', 'Stripe', 'Coinbase', 'Robinhood', 'Uber', 'Lyft', 'Airbnb', 'DoorDash',
    'Snowflake', 'Palantir', 'MongoDB', 'Atlassian', 'Twilio', 'Okta', 'CrowdStrike', 'Datadog', 'Unity', 'Roblox',
    'Pinterest', 'Snap', 'Twitter', 'LinkedIn', 'TikTok', 'Discord', 'Reddit', 'Dropbox', 'Box', 'Figma'
  ];

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;

    // Track GL context health to avoid uploads after loss/teardown
    let alive = true;
    const onContextLost = (e: any) => { try { e.preventDefault(); } catch {} ; alive = false; };
    const onContextRestored = () => { /* handled by component remount */ };
    try {
      canvas.addEventListener('webglcontextlost', onContextLost as any, false)
      canvas.addEventListener('webglcontextrestored', onContextRestored as any, false)
    } catch {}

    // --- data (300k points, generated in chunks to avoid blocking) ---
    // Return to normal density for performance
    const N = Math.max(1, (cfg.particleCount | 0));
    const pos0 = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const hubMaskArr = new Float32Array(N);      // 0 outside hubs, 1 inside hubs
    const hubAlphaArr = new Float32Array(N);     // per-point alpha scaler (<=1)
    const clusterIdArr = new Int8Array(N);       // 0..3 cluster id (or nearest), -1 if none

    // cluster centers via Fibonacci sphere
    const CLUSTERS = Math.max(1, cfg.clusterCount | 0);
    const centers: Array<[number, number, number]> = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < CLUSTERS; k++) {
      const y = 1 - 2 * (k + 0.5) / CLUSTERS;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = golden * (k + 1);
      centers.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }

    // helpers
    function norm3(x: number, y: number, z: number) { const L = Math.hypot(x, y, z) || 1e-6; return [x / L, y / L, z / L] as const; }
    function dot3(a: readonly [number,number,number], b: readonly [number,number,number]){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2] }
    function slerp(a: readonly [number,number,number], b: readonly [number,number,number], t: number){
      let omega = Math.acos(Math.max(-1, Math.min(1, dot3(a,b))))
      if (omega < 1e-4){
        return norm3(
          a[0]*(1-t)+b[0]*t,
          a[1]*(1-t)+b[1]*t,
          a[2]*(1-t)+b[2]*t
        )
      }
      const so = Math.sin(omega)
      const s0 = Math.sin((1-t)*omega)/so
      const s1 = Math.sin(t*omega)/so
      return [a[0]*s0 + b[0]*s1, a[1]*s0 + b[1]*s1, a[2]*s0 + b[2]*s1] as const
    }
    function sampleAround(mu: readonly [number, number, number], sigma: number) {
      const gx = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1);
      const gy = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1);
      const gz = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1);
      return norm3(mu[0] + sigma * gx, mu[1] + sigma * gy, mu[2] + sigma * gz);
    }
    function uniformDir() {
      const u = Math.random(), v = Math.random();
      const z = 2 * v - 1, r = Math.sqrt(Math.max(0, 1 - z * z)), phi = 2 * Math.PI * u;
      return [r * Math.cos(phi), r * Math.sin(phi), z] as const;
    }
    // Multi-octave 3D noise for larger, irregular shell holes
    function noise3d(x: number, y: number, z: number) {
      // Lower frequency for bigger chunks
      const n1 = Math.sin(x * 2.1 + y * 1.7 + z * 2.8) * Math.cos(x * 1.5 + y * 2.9 + z * 1.3);
      const n2 = Math.sin(x * 4.2 + y * 3.4 + z * 5.6) * Math.cos(x * 3.0 + y * 5.8 + z * 2.6);
      const combined = n1 * 0.7 + n2 * 0.3; // Mix scales for irregular chunks
      return (combined + 1) * 0.5; // 0..1
    }
    // smooth radius samplers (no shells!)
    function radiusCore() { return 0.02 + 0.18 * Math.pow(Math.random(), 1.6); }
    function radiusBody() { return 0.30 + 0.60 * Math.pow(Math.random(), 0.9); }
    // Emphasize outer halo near boundary for 5x shell test
    function radiusShell() { return 0.94 + 0.05 * Math.pow(Math.random(), 1.8); }

    // mixture weights (soft) - force only core for experiment
    // Favor a thin shell look like the reference image
    const wCore = 0.15;
    const wClusterSmall = 0.0, wClusterMid = 0.0, wClusterFull = 0.0, wShell = 0.85, wDust = 0.0;
    const wHubs = 0.0; // no hubs
    const wSum = wCore + wClusterSmall + wClusterMid + wClusterFull + wShell + wDust + wHubs;

    function fillRange(start: number, end: number){
      for (let i = start; i < end; i++) {
        let x = 0, y = 0, z = 0;
        // a portion of points lie along great-circle arcs between cluster centers (faint spokes)
        if (Math.random() < 0.05) {
          const a = centers[(Math.random() * CLUSTERS) | 0]
          let bIdx = (Math.random() * CLUSTERS) | 0
          if (bIdx === 0 && CLUSTERS>1) bIdx = 1
          const b = centers[bIdx]
          const t = Math.pow(Math.random(), 0.65) // bias towards endpoints to hint lobes
          const dir = slerp(a, b, t)
          const R = 0.78 + 0.22 * Math.random()
          const jitter = 0.06 * (Math.random()*2-1)
          x = (dir[0] + jitter) * R
          y = (dir[1] + jitter*0.7) * R
          z = (dir[2] + jitter) * R
        } else {
          // Multi-cluster sampling: strongly favor several large hubs
          if (Math.random() < 0.65) {
            const idx = (Math.random() * hubCenters.length) | 0
            const s = hubSigma[idx] * 2.4
            const c = hubCenters[idx]
            const gx = (Math.random()*2-1)+(Math.random()*2-1)+(Math.random()*2-1)
            const gy = (Math.random()*2-1)+(Math.random()*2-1)+(Math.random()*2-1)
            const gz = (Math.random()*2-1)+(Math.random()*2-1)+(Math.random()*2-1)
            x = c[0] + s*gx; y = c[1] + s*gy; z = c[2] + s*gz
            clusterIdArr[i] = idx as any
          } else {
            // Place near shell with mild jitter
            const d = uniformDir();
            let R = (Math.random() < wShell / (wCore + wShell)) ? radiusShell() : radiusCore();
            // Pull dense outer clumps slightly inward
            if (R > 0.90) R *= 0.92;
            x = d[0] * R; y = d[1] * R; z = d[2] * R;
            // Assign nearest hub for cluster id
            let best = 0; let bd = 1e9
            for (let h=0; h<hubCenters.length; h++){
              const dx = x - hubCenters[h][0], dy = y - hubCenters[h][1], dz = z - hubCenters[h][2]
              const d2 = dx*dx+dy*dy+dz*dz; if (d2 < bd){ bd = d2; best = h }
            }
            clusterIdArr[i] = best as any
          }
        }
        // Constrain to a near-spherical shell band: project to target radius with soft jitter
        {
          const L = Math.hypot(x,y,z) || 1e-6
          const ux = x/L, uy = y/L, uz = z/L
          const target = 0.88 + 0.06 * Math.random()
          const jitter = 0.02
          x = ux * target + (Math.random()*2-1) * jitter
          y = uy * target + (Math.random()*2-1) * jitter
          z = uz * target + (Math.random()*2-1) * jitter
        }
        const r0 = Math.hypot(x, y, z) || 1e-6;
        const aBite = biteAmount(x, y, z);
        if (sideHole) {
          if (aBite > 0.02) {
            // Stronger/larger side hole: push points well inward inside cone
            const innerTarget = 0.10 + 0.08 * Math.random();
            const L = r0 || 1e-6; const ux = x / L, uy = y / L, uz = z / L;
            const t = 0.80 + 0.20 * aBite; // deeper toward cone axis
            const rNew = innerTarget * t;
            x = ux * rNew; y = uy * rNew; z = uz * rNew;
          }
        }
        // Non-uniform sector density: compress radius near several lobe directions
        if (sectorDensity) {
          const L = Math.hypot(x, y, z) || 1e-6; const ux = x / L, uy = y / L, uz = z / L;
          const dirs = hubUnit.length === 4 ? hubUnit : [[0.9,0.0,0.4],[ -0.8,0.1,0.6],[0.1,0.95,0.3],[ -0.2,-0.3,-0.9]] as any;
          let w = 0.0;
          for (let ii = 0; ii < dirs.length; ii++) {
            const d = Math.max(0.0, ux*dirs[ii][0] + uy*dirs[ii][1] + uz*dirs[ii][2]);
            w = Math.max(w, Math.pow(d, 6.0)); // sharp lobes
          }
          const comp = 1.0 - 0.18 * w; // up to 18% inward near lobes
          x *= comp; y *= comp; z *= comp;
        }
        // Remove any residual central core — keep a hollow center
        {
          const cutR = 0.50;
          if (r0 < cutR) {
            const dir = (r0 > 1e-6) ? [x/r0, y/r0, z/r0] : uniformDir();
            const bandMin = 0.78;
            const bandMax = 0.90;
            const newR = bandMin + (bandMax - bandMin) * Math.random();
            // slight tangential jitter to avoid banding
            const jx = (Math.random()*2-1) * 0.04;
            const jy = (Math.random()*2-1) * 0.04;
            const jz = (Math.random()*2-1) * 0.04;
            x = dir[0] * newR + jx; y = dir[1] * newR + jy; z = dir[2] * newR + jz;
            // ensure not treated as a hub point
            hubMaskArr[i] = 0.0;
            hubAlphaArr[i] = 1.0;
          }
        }
        // Slightly smaller sphere to emphasize shell
        const scale = 0.78;
        const j = 3 * i;
        pos0[j + 0] = x * scale; pos0[j + 1] = y * scale; pos0[j + 2] = z * scale;
        seed[i] = Math.random();
        if (hubMaskArr[i] === 0) hubAlphaArr[i] = 1.0; // default
      }
    }

    // Build decorative triangulation-style edges on the shell for a clean poly look

    const regl = createREGL({ canvas, attributes: { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false } });
    reglRef.current = regl;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (w <= 0 || h <= 0) {
        return;
      }
      canvas.width = Math.max(1, Math.floor(w));
      canvas.height = Math.max(1, Math.floor(h));
    };
    resize();
    window.addEventListener('resize', resize);

    // --- buffers ---
    const posBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: pos0.byteLength });
    const sedBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: seed.byteLength });
    const hubMaskBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: hubMaskArr.byteLength });
    const hubAlphaBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: hubAlphaArr.byteLength });
    
    // Curved edge system for better visual appeal  
    const mult = Math.max(1, Math.min(2, Math.round(edgeMultiplier)));
    // Edge count with curve segments (each edge becomes 3 segments for curves)
    const BASE_EDGES = (isDense ? 150000 : (showEdges ? 40000 : 20000)) * mult;
    const MAX_EDGES = BASE_EDGES * 3; // multiply by 3 for curve segments
    const edgeData = new Float32Array(MAX_EDGES * 6); // 2 points * 3 coords each
    const edgeKind = new Float32Array(MAX_EDGES);     // 1=intra-cluster, 0=inter-cluster
    let edgeCount = 0;
    
    // Helper function to create curved edge between two points
    function addCurvedEdge(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, kind: number): boolean {
      if (edgeCount >= MAX_EDGES - 3) return false; // need space for 3 segments
      
      // Calculate control point for curve - offset perpendicular to the line
      const mx = (x1 + x2) * 0.5;
      const my = (y1 + y2) * 0.5;
      const mz = (z1 + z2) * 0.5;
      
      // Create a control point that bends outward from the sphere center
      const centerDist = Math.hypot(mx, my, mz) || 1e-6;
      const bendAmount = 0.12; // how much to bend the curve
      // Bend inward (toward center) so edges do not poke outside silhouette
      let cx = mx - (mx / centerDist) * bendAmount;
      let cy = my - (my / centerDist) * bendAmount;
      let cz = mz - (mz / centerDist) * bendAmount;
      // Clamp control point to rim to guarantee segments stay inside the sphere
      const RCLAMP = 0.85 * 0.985; // match edge RMAX with small margin
      const cL = Math.hypot(cx, cy, cz) || 1e-6;
      if (cL > RCLAMP) { const s = RCLAMP / cL; cx *= s; cy *= s; cz *= s; }
      
      // Create 3 line segments for the curve
      // Segment 1: start to quarter point
      let q1x = x1 * 0.75 + cx * 0.25;
      let q1y = y1 * 0.75 + cy * 0.25;
      let q1z = z1 * 0.75 + cz * 0.25;
      
      // Segment 2: quarter to three-quarter point  
      let q3x = x2 * 0.25 + cx * 0.75;
      let q3y = y2 * 0.25 + cy * 0.75;
      let q3z = z2 * 0.25 + cz * 0.75;
      // Clamp intermediate points to keep them within rim
      let qL = Math.hypot(q1x, q1y, q1z) || 1e-6; if (qL > RCLAMP) { const s = RCLAMP / qL; q1x *= s; q1y *= s; q1z *= s; }
      qL = Math.hypot(q3x, q3y, q3z) || 1e-6; if (qL > RCLAMP) { const s = RCLAMP / qL; q3x *= s; q3y *= s; q3z *= s; }
      
      // Add the three segments
      const ei = edgeCount;
      
      // Segment 1: start to quarter
      edgeData[ei * 6 + 0] = x1; edgeData[ei * 6 + 1] = y1; edgeData[ei * 6 + 2] = z1;
      edgeData[ei * 6 + 3] = q1x; edgeData[ei * 6 + 4] = q1y; edgeData[ei * 6 + 5] = q1z;
      edgeKind[ei] = kind;
      
      // Segment 2: quarter to three-quarter
      edgeData[(ei + 1) * 6 + 0] = q1x; edgeData[(ei + 1) * 6 + 1] = q1y; edgeData[(ei + 1) * 6 + 2] = q1z;
      edgeData[(ei + 1) * 6 + 3] = q3x; edgeData[(ei + 1) * 6 + 4] = q3y; edgeData[(ei + 1) * 6 + 5] = q3z;
      edgeKind[ei + 1] = kind;
      
      // Segment 3: three-quarter to end
      edgeData[(ei + 2) * 6 + 0] = q3x; edgeData[(ei + 2) * 6 + 1] = q3y; edgeData[(ei + 2) * 6 + 2] = q3z;
      edgeData[(ei + 2) * 6 + 3] = x2; edgeData[(ei + 2) * 6 + 4] = y2; edgeData[(ei + 2) * 6 + 5] = z2;
      edgeKind[ei + 2] = kind;
      
      edgeCount += 3;
      return true;
    }
    // screen-space quad for outer sphere ring
    const quad = regl.buffer(new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]));

    // Disabled outer ring (no-op) to avoid any background tint; outputs transparent color to satisfy drivers
    const drawOuter = regl({
      vert: `
      precision highp float;
      attribute vec2 a_pos; // clip-space
      void main(){
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }`,
      frag: `
      precision highp float;
      void main(){ gl_FragColor = vec4(0.0); }
      `,
      attributes: { a_pos: { buffer: quad, size: 2 } },
      uniforms: {},
      primitive: 'triangle strip',
      count: 4,
      depth: { enable: false },
      blend: { enable: false }
    });
    // no edges buffer since lines are removed

    const pointBlend = isDense
      ? { enable: true, func: { srcRGB: 'one', srcAlpha: 'one', dstRGB: 'one', dstAlpha: 'one' } }
      : { enable: true, func: { srcRGB: 'src alpha', srcAlpha: 'one', dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' } };
    const draw = regl({
      vert: `
      precision highp float;
      attribute vec3 a_pos0;
      attribute float a_seed;
      attribute float a_hubMask;
      attribute float a_hubAlpha;
      uniform float u_time, u_phase, u_zoom;
      uniform vec2  u_view;
      uniform mat3  u_rot;
      uniform float u_pointPx;
      uniform float u_pointScale;
      uniform float u_rotSpeed;
      uniform float u_nodeScale;
      uniform float u_glow;
      uniform vec3  u_color;
      uniform float u_jitterAmp;
      uniform vec2  u_shiftClip; // small clip-space shift for parallax
      uniform vec2  u_frontFade; // [start,end] z thresholds to fade near camera
      varying float v_alpha;
      varying float v_seed;
      varying float v_hubMask;
      varying float v_hubAlpha;
      varying float v_r0;
      varying float v_viewZ;

      float hash11(float p){
        p = fract(p*0.1031);
        p *= p + 33.33;
        p *= p + p;
        return fract(p);
      }
      // subtle swirl removed to avoid visible banding; use gentle global yaw below
      void main(){
        vec3 p = a_pos0;
        float j = u_jitterAmp * sin(u_time*0.9 + a_seed*6.28);
        p += j * normalize(vec3(sin(a_seed*4.1), cos(a_seed*3.7), sin(a_seed*2.3)));
        p.z *= (1.0 - u_phase);
        // global slow yaw to feel alive
        float cy = cos(u_time*u_rotSpeed), sy = sin(u_time*u_rotSpeed);
        mat3 ry = mat3(cy,0.0,sy, 0.0,1.0,0.0, -sy,0.0,cy);
        vec3 pr = u_rot * (ry * p);
        float f = 1.0 / (1.0 + pr.z * 0.8);
        vec2 screen = pr.xy * (u_zoom * f);
        // centered mapping (no offset), so the globe sits in the middle
        vec2 clip = (screen / (0.5 * u_view)) + u_shiftClip;
        gl_Position = vec4(clip, 0.0, 1.0);
        v_viewZ = pr.z;
        float lp = length(p);
        float shellBoost = smoothstep(0.82, 0.99, lp);
        // shrink points when node count increases so the change is visible
        float scaleByNodes = 1.0 / max(0.8, sqrt(max(0.25, u_nodeScale)));
        float baseSize = (u_pointPx * u_pointScale * scaleByNodes) * (1.0 + 0.9 * shellBoost);
        // shrink hub point size based on per-point hub alpha (smaller alpha -> smaller points)
        float hubShrink = 0.25 + 0.60 * clamp(a_hubAlpha, 0.0, 1.0);
        gl_PointSize = mix(baseSize, baseSize * hubShrink, clamp(a_hubMask,0.0,1.0));
        // slightly lower point alpha overall so edges read better
        v_alpha = (0.10 + 0.20 * hash11(a_seed*9.9)) * (u_glow + 5.0 * shellBoost) * mix(1.0, a_hubAlpha, clamp(a_hubMask,0.0,1.0));
        v_seed = a_seed;
        v_hubMask = a_hubMask;
        v_hubAlpha = a_hubAlpha;
        v_r0 = length(a_pos0);
      }
      `,
      frag: `
      precision highp float;
      uniform vec3 u_color;
      uniform float u_brightness;
      uniform int u_palette;
      uniform float u_rimMax;
      uniform vec2  u_frontFade;
      varying float v_alpha;
      varying float v_seed;
      varying float v_hubMask;
      varying float v_r0;
      varying float v_viewZ;

      vec3 hsv2rgb(float h, float s, float v){
        vec3 k = vec3(1.0, 2.0/3.0, 1.0/3.0);
        vec3 p = abs(fract(vec3(h)+k)*6.0 - 3.0);
        vec3 a = clamp(p-1.0, 0.0, 1.0);
        return v * mix(vec3(1.0), a, s);
      }

      float rnd(float x){ return fract(sin(x)*43758.5453); }

      vec3 paletteColor(){
        if (u_palette == 0) return u_color;
        if (u_palette == 1) {
          float t = rnd(v_seed*13.1);
          return mix(vec3(0.85,0.90,1.0), vec3(0.62,0.70,0.98), t);
        }
        if (u_palette == 2) return vec3(1.0);
        if (u_palette == 3) {
          float t = rnd(v_seed*19.7);
          if (t < 0.33) return vec3(1.0);
          else if (t < 0.66) return vec3(0.62,0.72,1.0);
          else return vec3(0.90,0.70,1.0);
        }
        // random HSV
        float h = rnd(v_seed*7.3);
        return hsv2rgb(h, 0.85, 0.90);
      }
      void main(){
        if (v_r0 > u_rimMax) discard; // cull outside sphere
        vec2 p = gl_PointCoord*2.0 - 1.0;
        float d = dot(p,p);
        if (d>1.0) discard;
        float fall = exp(-3.6*d);
        float alpha = v_alpha * fall * u_brightness; // brightness affects intensity
        vec3 base = paletteColor();
        // tint hubs bluish to preserve fidelity
        vec3 hubTint = vec3(0.80, 0.88, 1.0);
        vec3 col = mix(base, hubTint, clamp(v_hubMask,0.0,1.0));
        // depth cue: cooler and brighter toward rim
        float rN = clamp((v_r0 - 0.20) / 0.65, 0.0, 1.0);
        vec3 rimBoost = vec3(0.90, 0.95, 1.0);
        col = mix(vec3(0.78,0.80,0.88), col, rN);
        alpha *= mix(0.85, 1.20, rN);
        // Fade points near the camera (positive view-space z)
        float frontMask = 1.0 - smoothstep(u_frontFade.x, u_frontFade.y, v_viewZ);
        // Weight fade by how close to surface to emphasize front shell removal
        float surfaceW = smoothstep(0.30, 0.86, v_r0);
        alpha *= mix(1.0, frontMask, surfaceW);
        gl_FragColor = vec4(col, alpha);
      }
      `,
      attributes: {
        a_pos0: { buffer: posBuf, size: 3 },
        a_seed: sedBuf,
        a_hubMask: hubMaskBuf,
        a_hubAlpha: hubAlphaBuf,
      },
      uniforms: {
        u_time: () => performance.now() / 1000,
        u_phase: () => phaseRef.current,
        u_zoom: () => zoomRef.current,
        u_view: ({ viewportWidth, viewportHeight }: any) => [viewportWidth, viewportHeight],
        u_rot: () => {
          const c = Math.cos(tiltRef.current), s = Math.sin(tiltRef.current);
          return [1, 0, 0, 0, c, -s, 0, s, c];
        },
        u_pointPx: () => cfg.pointSizePx,
        u_pointScale: () => sizeScaleRef.current,
        u_rotSpeed: () => (asBackground ? Math.max(0.0, Math.min(0.05, bgRotSpeed || 0.0)) : rotSpeedRef.current),
        u_jitterAmp: () => (asBackground ? 0.0 : 0.0035),
        u_nodeScale: () => nodeScaleRef.current,
        u_glow: () => cfg.glow,
        u_color: () => cfg.baseColor,
        u_palette: () => paletteRef.current | 0,
        u_brightness: () => brightnessRef.current,
        u_rimMax: () => 0.846,
        u_shiftClip: ({ viewportWidth, viewportHeight }: any) => {
          // Convert px/py (pixels) to clip offset and dampen heavily for subtlety
          const k = 0.10
          const sx = (pxRef.current || 0) / (0.5 * (viewportWidth  || 1))
          const sy = (pyRef.current || 0) / (0.5 * (viewportHeight || 1))
          return [ -k * sx, -k * sy ]
        },
        u_frontFade: () => (asBackground ? [0.10, 0.40] : [10.0, 11.0])
      },
      count: () => filledRef.current,
      primitive: 'points',
      depth: { enable: !isDense },
      blend: pointBlend
    });

    // Edge renderer (used for dense mode and/or scaffolding)
    const edgeBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: edgeData.byteLength });
    const edgeKindBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: edgeKind.byteLength });
    const drawEdges = regl({
      vert: `
      precision highp float;
      attribute vec3 a_pos;
      attribute float a_kind;
      uniform float u_time, u_zoom, u_phase;
      uniform vec2 u_view;
      uniform mat3 u_rot;
      uniform float u_rotSpeed;
      varying float v_a;
      varying float v_r;
      varying float v_eViewZ;
      varying float v_kind;
      void main(){
        float cy = cos(u_time*u_rotSpeed), sy = sin(u_time*u_rotSpeed);
        mat3 ry = mat3(cy,0.0,sy, 0.0,1.0,0.0, -sy,0.0,cy);
        vec3 p = a_pos; p.z *= (1.0 - u_phase);
        vec3 pr = u_rot * (ry * p);
        float f = 1.0 / (1.0 + pr.z * 0.8);
        vec2 screen = pr.xy * (u_zoom * f);
        vec2 clip = (screen / (0.5 * u_view));
        gl_Position = vec4(clip, 0.0, 1.0);
        float r = length(a_pos);
        v_r = r;
        v_eViewZ = pr.z;
        // per-line brightness variation (light/dark)
        float h = fract(sin(dot(a_pos, vec3(12.9898,78.233,37.719))) * 43758.5453);
        v_a = mix(0.45, 1.0, h); // baseline, scaled by uniform in fragment
        v_kind = a_kind;
      }`,
      frag: `
      precision highp float;
      varying float v_a;
      varying float v_r;
      varying float v_eViewZ;
      varying float v_kind;
      uniform float u_centerCut;
      uniform float u_edgeAlpha;
      uniform vec3  u_edgeColorIntra;
      uniform vec3  u_edgeColorInter;
      uniform float u_globalBrightness;
      uniform vec2  u_frontFade;
      uniform float u_frontCut;
      uniform float u_frontRadMin;
      void main(){
        // Prefer shell edges; softly suppress interior
        if (v_eViewZ > u_frontCut && v_r > u_frontRadMin) discard;
        // Keep some visibility toward center: minimum alpha via mix
        float suppress = smoothstep(u_centerCut - 0.20, u_centerCut + 0.05, v_r);
        float a = v_a * mix(0.45, 1.0, suppress) * u_edgeAlpha * clamp(u_globalBrightness, 0.2, 2.5);
        // Hide edges near front of sphere
        float frontMask = 1.0 - smoothstep(u_frontFade.x, u_frontFade.y, v_eViewZ);
        a *= frontMask;
        vec3 col = mix(u_edgeColorInter, u_edgeColorIntra, clamp(v_kind, 0.0, 1.0));
        gl_FragColor = vec4(col, a);
      }`,
      attributes: { a_pos: { buffer: edgeBuf, size: 3 }, a_kind: { buffer: edgeKindBuf, size: 1 } },
      uniforms: {
        u_time: () => performance.now() / 1000,
        u_zoom: () => zoomRef.current,
        u_phase: () => phaseRef.current,
        u_view: ({ viewportWidth, viewportHeight }: any) => [viewportWidth, viewportHeight],
        u_rot: () => {
          const c = Math.cos(tiltRef.current), s = Math.sin(tiltRef.current);
          return [1, 0, 0, 0, c, -s, 0, s, c];
        },
        u_rotSpeed: () => (asBackground ? Math.max(0.0, Math.min(0.05, bgRotSpeed || 0.0)) : rotSpeedRef.current),
        u_centerCut: () => 0.65, // allow more interior edges
        u_edgeAlpha: () => (asBackground ? Math.min(0.4, edgeAlphaRef.current * 0.5) : Math.min(0.75, edgeAlphaRef.current * 0.6)), // 50% less opaque
        u_edgeColorIntra: () => [0.55, 0.85, 1.0], // brighter blue
        u_edgeColorInter: () => [0.85, 0.65, 1.0], // brighter purple
        u_globalBrightness: () => brightnessRef.current,
        u_frontFade: () => (asBackground ? [0.10, 0.40] : [10.0, 11.0]),
        u_frontCut: () => (asBackground ? 0.06 : 99.0),
        u_frontRadMin: () => (asBackground ? 0.70 : 2.0),
      },
      count: () => Math.max(0, Math.floor(edgeCount * Math.max(0.0, Math.min(1.0, (asBackground ? edgeFractionRef.current * 0.3 : edgeFractionRef.current)))) * 2),
      primitive: 'lines',
      depth: { enable: false },
      blend: { enable: true, func: { srcRGB: 'src alpha', srcAlpha: 'one', dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' } }
    });

    // Sparkle and flow particle rendering system
    const drawSparkles = () => {
      if (!edgeDataRef.current || (sparkles.length === 0 && flowParticles.length === 0)) return;
      
      // Create positions for both sparkles and flow particles
      const sparklePositions: number[] = [];
      const sparkleColors: number[] = [];
      const flowPositions: number[] = [];
      const flowColors: number[] = [];
      
      // Process sparkles (bright, pulsing effects)
      sparkles.forEach(sparkle => {
        if (sparkle.edgeIndex >= edgeCountRef.current) return;
        
        const edgeStart = sparkle.edgeIndex * 6;
        const x1 = edgeDataRef.current![edgeStart + 0];
        const y1 = edgeDataRef.current![edgeStart + 1];
        const z1 = edgeDataRef.current![edgeStart + 2];
        const x2 = edgeDataRef.current![edgeStart + 3];
        const y2 = edgeDataRef.current![edgeStart + 4];
        const z2 = edgeDataRef.current![edgeStart + 5];
        
        // Interpolate position along edge
        const t = sparkle.progress;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;
        const z = z1 + (z2 - z1) * t;
        
        sparklePositions.push(x, y, z);
        sparkleColors.push(sparkle.color[0], sparkle.color[1], sparkle.color[2]);
      });
      
      // Process flow particles (smooth, continuous movement)
      flowParticles.forEach(particle => {
        if (particle.edgeIndex >= edgeCountRef.current) return;
        
        const edgeStart = particle.edgeIndex * 6;
        const x1 = edgeDataRef.current![edgeStart + 0];
        const y1 = edgeDataRef.current![edgeStart + 1];
        const z1 = edgeDataRef.current![edgeStart + 2];
        const x2 = edgeDataRef.current![edgeStart + 3];
        const y2 = edgeDataRef.current![edgeStart + 4];
        const z2 = edgeDataRef.current![edgeStart + 5];
        
        // Smooth interpolation with easing
        const t = particle.progress;
        const easedT = t * t * (3 - 2 * t); // smooth step easing
        const x = x1 + (x2 - x1) * easedT;
        const y = y1 + (y2 - y1) * easedT;
        const z = z1 + (z2 - z1) * easedT;
        
        flowPositions.push(x, y, z);
        flowColors.push(particle.color[0], particle.color[1], particle.color[2]);
      });
      
      // Render sparkles if any exist
      if (sparklePositions.length > 0) {
        const sparklePosBuf = regl.buffer({
          usage: 'dynamic',
          type: 'float',
          data: sparklePositions
        });
        
        const sparkleColBuf = regl.buffer({
          usage: 'dynamic',
          type: 'float', 
          data: sparkleColors
        });
        
        // Render sparkles as bright pulsing points
        const drawSparklePoints = regl({
        vert: `
        precision highp float;
        attribute vec3 a_pos;
        attribute vec3 a_color;
        uniform float u_time, u_zoom;
        uniform vec2 u_view;
        uniform mat3 u_rot;
        uniform float u_rotSpeed;
        varying vec3 v_color;
        varying float v_alpha;
        
        void main() {
          float cy = cos(u_time*u_rotSpeed), sy = sin(u_time*u_rotSpeed);
          mat3 ry = mat3(cy,0.0,sy, 0.0,1.0,0.0, -sy,0.0,cy);
          vec3 pr = u_rot * (ry * a_pos);
          float f = 1.0 / (1.0 + pr.z * 0.8);
          vec2 screen = pr.xy * (u_zoom * f);
          vec2 clip = screen / (0.5 * u_view);
          gl_Position = vec4(clip, 0.0, 1.0);
          gl_PointSize = 8.0 * f; // larger sparkly points
          v_color = a_color;
          v_alpha = 1.0;
        }`,
        frag: `
        precision highp float;
        varying vec3 v_color;
        varying float v_alpha;
        uniform float u_time;
        
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float d = dot(p, p);
          if (d > 1.0) discard;
          
          // Sparkly effect with pulsing
          float pulse = 0.7 + 0.3 * sin(u_time * 8.0);
          float sparkle = exp(-3.0 * d) * pulse;
          
          gl_FragColor = vec4(v_color * 2.0, sparkle * v_alpha);
        }`,
        attributes: {
          a_pos: { buffer: sparklePosBuf, size: 3 },
          a_color: { buffer: sparkleColBuf, size: 3 }
        },
        uniforms: {
          u_time: () => performance.now() / 1000,
          u_zoom: () => zoomRef.current,
          u_view: ({ viewportWidth, viewportHeight }: any) => [viewportWidth, viewportHeight],
          u_rot: () => {
            const c = Math.cos(tiltRef.current), s = Math.sin(tiltRef.current);
            return [1, 0, 0, 0, c, -s, 0, s, c];
          },
          u_rotSpeed: () => rotSpeedRef.current
        },
        count: sparklePositions.length / 3,
        primitive: 'points',
        depth: { enable: false },
        blend: { enable: true, func: { srcRGB: 'one', srcAlpha: 'one', dstRGB: 'one', dstAlpha: 'one' } }
      });
      
      drawSparklePoints();
      
      // Clean up temporary buffers
      sparklePosBuf.destroy();
      sparkleColBuf.destroy();
      }
      
      // Render flow particles if any exist
      if (flowPositions.length > 0) {
        const flowPosBuf = regl.buffer({
          usage: 'dynamic',
          type: 'float',
          data: flowPositions
        });
        
        const flowColBuf = regl.buffer({
          usage: 'dynamic',
          type: 'float', 
          data: flowColors
        });
        
        // Render flow particles as smooth moving points
        const drawFlowPoints = regl({
          vert: `
          precision highp float;
          attribute vec3 a_pos;
          attribute vec3 a_color;
          uniform float u_time, u_zoom;
          uniform vec2 u_view;
          uniform mat3 u_rot;
          uniform float u_rotSpeed;
          varying vec3 v_color;
          varying float v_alpha;
          
          void main() {
            float cy = cos(u_time*u_rotSpeed), sy = sin(u_time*u_rotSpeed);
            mat3 ry = mat3(cy,0.0,sy, 0.0,1.0,0.0, -sy,0.0,cy);
            vec3 pr = u_rot * (ry * a_pos);
            float f = 1.0 / (1.0 + pr.z * 0.8);
            vec2 screen = pr.xy * (u_zoom * f);
            vec2 clip = screen / (0.5 * u_view);
            gl_Position = vec4(clip, 0.0, 1.0);
            gl_PointSize = 5.0 * f; // smaller, smoother flow particles
            v_color = a_color;
            v_alpha = 0.8; // more subtle than sparkles
          }`,
          frag: `
          precision highp float;
          varying vec3 v_color;
          varying float v_alpha;
          uniform float u_time;
          
          void main() {
            vec2 p = gl_PointCoord * 2.0 - 1.0;
            float d = dot(p, p);
            if (d > 1.0) discard;
            
            // Smooth flowing effect without pulsing
            float glow = exp(-2.5 * d);
            
            gl_FragColor = vec4(v_color * 1.2, glow * v_alpha);
          }`,
          attributes: {
            a_pos: { buffer: flowPosBuf, size: 3 },
            a_color: { buffer: flowColBuf, size: 3 }
          },
          uniforms: {
            u_time: () => performance.now() / 1000,
            u_zoom: () => zoomRef.current,
            u_view: ({ viewportWidth, viewportHeight }: any) => [viewportWidth, viewportHeight],
            u_rot: () => {
              const c = Math.cos(tiltRef.current), s = Math.sin(tiltRef.current);
              return [1, 0, 0, 0, c, -s, 0, s, c];
            },
            u_rotSpeed: () => rotSpeedRef.current
          },
          count: flowPositions.length / 3,
          primitive: 'points',
          depth: { enable: false },
          blend: { enable: true, func: { srcRGB: 'src alpha', srcAlpha: 'one', dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' } }
        });
        
        drawFlowPoints();
        
        // Clean up temporary buffers
        flowPosBuf.destroy();
        flowColBuf.destroy();
      }
    };

    const loop = () => {
      if (!alive || !reglRef.current) { rafRef.current = null; return }
      try { regl.poll(); } catch {}
      try { regl.clear({ color: [cfg.background[0], cfg.background[1], cfg.background[2], 1], depth: 1 }); } catch {}
      try { drawOuter(); } catch {}
      try { if (edgeCount > 0 && (isDense || showEdges || asBackground)) drawEdges(); } catch {}
      try { draw(); } catch {}
      try { if (!asBackground) drawSparkles(); } catch {}
      // If background is paused, draw once and stop scheduling frames
      if (asBackground && bgPaused) { rafRef.current = null; return }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();

    // Background: listen for foreground zoom sync and lerp toward it
    let syncHandler: any = null
    if (asBackground) {
      syncHandler = (e: CustomEvent)=>{
        const target = (e?.detail?.zoom || zoomRef.current)
        // Smoothly move 30% toward target per frame for a second
        const start = performance.now()
        const prev = zoomRef.current
        const step = ()=>{
          const t = (performance.now() - start) / 600
          if (t >= 1) { zoomRef.current = target; return }
          zoomRef.current = prev + (target - prev) * Math.min(1, t)
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }
      try { window.addEventListener(`login_zoom_sync_${syncKey}`, syncHandler as any as EventListener) } catch {}
    }

    // Company tag animation system (disabled in background mode)
    let tagRafId: number | null = null;
    let sparkleRafId: number | null = null;
    let flowRafId: number | null = null;
    if (!asBackground) {
    const updateCompanyTags = () => {
      const now = performance.now();
      setCompanyTags(prev => {
        const active = prev.filter(tag => now - tag.startTime < 5000);
          if (active.length < 5 && Math.random() < 0.02) {
          const company = companies[Math.floor(Math.random() * companies.length)];
          const canvas = canvasRef.current;
          if (canvas) {
              const newTag = { id: Math.random(), company, x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6, startTime: now, angle: Math.random() * Math.PI * 2 };
            
            // Trigger sparkles when a new company tag appears
            if (edgeCountRef.current > 0) {
              const numSparkles = 2 + Math.floor(Math.random() * 3); // 2-4 sparkles per tag
              for (let i = 0; i < numSparkles; i++) {
                setTimeout(() => {
                  const edgeIndex = Math.floor(Math.random() * edgeCountRef.current);
                  const colors: Array<[number, number, number]> = [
                    [1.0, 0.95, 0.4], // golden yellow
                    [0.4, 0.95, 1.0], // bright cyan
                    [1.0, 0.4, 0.95], // bright magenta
                    [0.4, 1.0, 0.6], // bright green
                    [1.0, 0.7, 0.4], // orange
                  ];
                  const color = colors[Math.floor(Math.random() * colors.length)];
                  setSparkles(prevSparkles => [...prevSparkles, {
                    id: Math.random(),
                    edgeIndex,
                    progress: 0,
                    startTime: now + i * 200, // stagger sparkles
                    color
                  }]);
                }, i * 100); // stagger creation timing
              }
            }
            
            return [...active, newTag];
          }
        }
        return active;
      });
      tagRafId = requestAnimationFrame(updateCompanyTags);
    };
    updateCompanyTags();
    
    // Sparkle effect management - maintain a single hopping sparkle
    const updateSparkles = () => {
      const now = performance.now();
      setSparkles(prev => {
        let list = prev;
        // Ensure exactly one sparkle exists
        if (list.length === 0 && edgeCountRef.current > 0) {
          const edgeIndex = Math.floor(Math.random() * edgeCountRef.current);
          list = [{ id: Math.random(), edgeIndex, progress: 0, startTime: now, color: [1.0, 0.9, 0.4] }];
        }
        if (list.length === 0) return list;
        const s = list[0];
        const progress = (now - s.startTime) / 1400; // 1.4s per hop
        if (progress >= 1.0) {
          // hop to a new random edge
          const nextEdge = Math.floor(Math.random() * Math.max(1, edgeCountRef.current));
          return [{ id: Math.random(), edgeIndex: nextEdge, progress: 0, startTime: now, color: s.color }];
        }
        return [{ ...s, progress: Math.min(1.0, progress) }];
      });
      sparkleRafId = requestAnimationFrame(updateSparkles);
    };
    updateSparkles();
    
    // disable flow system (single sparkle only)
    }

    // Start non-blocking data generation and update buffers incrementally
    const CHUNK = 8000; // smaller chunks for less blocking
    const scheduler = (cb: any) => {
      const ric: any = (window as any).requestIdleCallback;
      if (ric) ric(cb, { timeout: 16 }); else setTimeout(cb, 0);
    };
    const step = (start: number) => {
      if (!alive || !reglRef.current) return;
      const end = Math.min(N, start + CHUNK);
      fillRange(start, end);
      // upload subranges
      // Guard against GL context loss or destroyed buffers
      if (alive) { try { posBuf.subdata(pos0.subarray(3 * start, 3 * end), 3 * start * 4) } catch {} }
      if (alive) { try { sedBuf.subdata(seed.subarray(start, end), start * 4) } catch {} }
      if (alive) { try { hubMaskBuf.subdata(hubMaskArr.subarray(start, end), start * 4) } catch {} }
      if (alive) { try { hubAlphaBuf.subdata(hubAlphaArr.subarray(start, end), start * 4) } catch {} }
      filledRef.current = end;
      
      // Generate edges immediately at startup (no waiting for chunks)
      if ((edgeCount === 0 || end === N) && end >= Math.min(N, 10000)) {  // build once early, rebuild at completion
        // Simplified parameters for better performance
        const mult = Math.max(1, Math.min(2, Math.round(edgeMultiplier))); // reduced from 3 to 2
        const SAMPLE_STEP = isDense ? Math.max(25, 80 / mult) : (showEdges ? Math.max(20, 60 / mult) : 1000); // increased steps for less sampling
        const MAX_DIST = isDense ? 0.15 : (showEdges ? 0.16 : 0.12); // reduced max distances
        let ei = 0;
        
        // Use only the currently generated points for edge creation
        const M = end; // important: do not sample zeroed points beyond 'end'
        
        // Account for saved scale (0.85): derive thresholds in saved units
        const RMAX = 0.85;
        const CENTER_EDGE_CUT = RMAX * 0.45; // ~0.3825
        const OUTER_RING_MIN = RMAX * 0.92;   // ~0.782
        for (let i = 0; i < M && ei < MAX_EDGES; i += SAMPLE_STEP) {
          const x1 = pos0[i * 3], y1 = pos0[i * 3 + 1], z1 = pos0[i * 3 + 2];
          const r1 = Math.hypot(x1, y1, z1) || 1e-6;
          if (r1 < CENTER_EDGE_CUT) continue; // avoid edges originating at center
          if (!isDense && !showEdges) {
            // Default: only interior scaffolding within bite
            const insideBite1 = inBiteCone(x1, y1, z1);
            if (!(insideBite1 && r1 < 0.95)) continue;
          }

          if (isDense) {
            // Dense mode: add several radial-biased neighbors quickly without O(N^2)
            const ux1 = x1 / r1, uy1 = y1 / r1, uz1 = z1 / r1;
            for (let k = 0; k < 100 * mult && ei < MAX_EDGES; k++) {  // more attempts
              const span = 120 + ((k * 113) % 700);
              const j = (i + span) % M;
            const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
              const r2 = Math.hypot(x2, y2, z2) || 1e-6;
              if (r2 < CENTER_EDGE_CUT) continue;
              const ux2 = x2 / r2, uy2 = y2 / r2, uz2 = z2 / r2;
              const angular = ux1 * ux2 + uy1 * uy2 + uz1 * uz2; // cos angle
            const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
              if (angular > 0.80 && r2 >= r1 && dist < 0.24) {  // relax thresholds
                if (Math.random() < 0.95) {
                  if (addCurvedEdge(x1, y1, z1, x2, y2, z2, (clusterIdArr[i] === clusterIdArr[j]) ? 1.0 : 0.0)) {
                    ei = edgeCount; // update ei to current edge count
                  }
                }
              }
            }
            // Extra dense intra-hub wires when near hubs
            if (fourCores && nearAnyHub(x1, y1, z1)) {
              for (let t = 0; t < 80 * mult && ei < MAX_EDGES; t++) {
                const j = (i + 1 + ((Math.random() * 400) | 0)) % M;
                const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
                if (!nearAnyHub(x2, y2, z2)) continue;
                const r2 = Math.hypot(x2, y2, z2) || 1e-6; if (r2 < CENTER_EDGE_CUT) continue;
                const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
                if (dist < 0.08) {  // slightly longer
                  edgeData[ei * 6 + 0] = x1; edgeData[ei * 6 + 1] = y1; edgeData[ei * 6 + 2] = z1;
                  edgeData[ei * 6 + 3] = x2; edgeData[ei * 6 + 4] = y2; edgeData[ei * 6 + 5] = z2;
                  edgeKind[ei] = (clusterIdArr[i] === clusterIdArr[j]) ? 1.0 : 0.0;
                  ei++;
                }
              }
            }
            // Strong outer ring connections
            if (r1 > OUTER_RING_MIN && ei < MAX_EDGES) {
              const j = (i + 200) % M;
              const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
              const r2 = Math.hypot(x2, y2, z2) || 1e-6;
              const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
              // Reduce outer-ring connections near silhouette to avoid sticking out
              if (r2 > OUTER_RING_MIN && dist < 0.06) {
                if (addCurvedEdge(x1, y1, z1, x2, y2, z2, (clusterIdArr[i] === clusterIdArr[j]) ? 1.0 : 0.0)) {
                  ei = edgeCount;
                }
              }
            }
          } else {
            // Graph-test mode (showEdges=true): local webbing only
            const ux1 = x1 / r1, uy1 = y1 / r1, uz1 = z1 / r1;
            for (let k = 1; k <= (120 * mult) && ei < MAX_EDGES; k++) { // much more sampling
              const j = (i + k * (SAMPLE_STEP + 37)) % M;
              const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
              const r2 = Math.hypot(x2, y2, z2) || 1e-6;
              if (r2 < CENTER_EDGE_CUT) continue;
              const ux2 = x2 / r2, uy2 = y2 / r2, uz2 = z2 / r2;
              const angular = ux1 * ux2 + uy1 * uy2 + uz1 * uz2;
              const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
              if (dist < MAX_DIST && angular > 0.50) { // relax angular constraint heavily
                if (addCurvedEdge(x1, y1, z1, x2, y2, z2, (clusterIdArr[i] === clusterIdArr[j]) ? 1.0 : 0.0)) {
                  ei = edgeCount; // update ei to current edge count
                }
              }
            }
            // Guarantee baseline density: connect to a few immediate neighbors in index order
            for (let s = 1; s <= 8 && ei < MAX_EDGES; s++) {
              const j = (i + s) % M;
              const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
              const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
              if (dist < 0.22) {
                edgeData[ei * 6 + 0] = x1; edgeData[ei * 6 + 1] = y1; edgeData[ei * 6 + 2] = z1;
                edgeData[ei * 6 + 3] = x2; edgeData[ei * 6 + 4] = y2; edgeData[ei * 6 + 5] = z2;
                ei++;
              }
            }
          }
        }

        // Fallback: if very few edges were generated, top up with short random edges
        if (ei < Math.min(60000 * mult, MAX_EDGES)) {
          const target = Math.min(MAX_EDGES, ei + 60000 * mult);
          while (ei < target) {
            const i = ((Math.random() * M) | 0);
            const j = (i + 1 + ((Math.random() * 500) | 0)) % M;
            const x1 = pos0[i * 3], y1 = pos0[i * 3 + 1], z1 = pos0[i * 3 + 2];
            const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
            const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
            if (dist < (MAX_DIST*1.2)) {  // longer
              edgeData[ei * 6 + 0] = x1; edgeData[ei * 6 + 1] = y1; edgeData[ei * 6 + 2] = z1;
              edgeData[ei * 6 + 3] = x2; edgeData[ei * 6 + 4] = y2; edgeData[ei * 6 + 5] = z2;
              edgeKind[ei] = (clusterIdArr[i] === clusterIdArr[j]) ? 1.0 : 0.0;
              ei++;
            }
          }
        }

        // Sparse-areas fill: add extra edges where not near hubs and at mid radii
        if (ei < MAX_EDGES) {
          const target = Math.min(MAX_EDGES, ei + Math.floor((MAX_EDGES - ei) * 0.95));
          const step = isDense ? 140 : 180;
          for (let i = 0; i < M && ei < target; i += step) {
            const x1 = pos0[i * 3], y1 = pos0[i * 3 + 1], z1 = pos0[i * 3 + 2];
            const r1 = Math.hypot(x1, y1, z1) || 1e-6;
            if (nearAnyHub(x1, y1, z1)) continue;
            const MID_MIN = RMAX * 0.35; // ~0.298
            const MID_MAX = RMAX * 0.88; // ~0.748
            if (r1 < MID_MIN || r1 > MID_MAX) continue;
            for (let k = 0; k < 20 && ei < target; k++) {
              const j = (i + 40 + ((Math.random() * 360) | 0)) % M;
              const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
              const r2 = Math.hypot(x2, y2, z2) || 1e-6; if (r2 < CENTER_EDGE_CUT) continue;
              if (nearAnyHub(x2, y2, z2)) continue;
              const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
              if (dist < 0.08) {
                edgeData[ei * 6 + 0] = x1; edgeData[ei * 6 + 1] = y1; edgeData[ei * 6 + 2] = z1;
                edgeData[ei * 6 + 3] = x2; edgeData[ei * 6 + 4] = y2; edgeData[ei * 6 + 5] = z2;
                ei++;
              }
            }
          }
        }

        // Simplified micro-edge pass: fewer but more targeted short edges for performance
        if (ei < MAX_EDGES) {
          const target = Math.min(MAX_EDGES, ei + 80000 * mult); // greatly reduced from 288000
          const MICRO_STEP = 50; // increased step for less sampling
          for (let i = 0; i < M && ei < target; i += MICRO_STEP) {
            const x1 = pos0[i * 3], y1 = pos0[i * 3 + 1], z1 = pos0[i * 3 + 2];
            const r1 = Math.hypot(x1, y1, z1) || 1e-6;
            const MICRO_MIN = RMAX * 0.85; // tightened range
            const MICRO_MAX = RMAX * 0.98;
            if (r1 < MICRO_MIN || r1 > MICRO_MAX) continue;
            for (let k = 0; k < 6 && ei < target; k++) { // reduced from 15 to 6 attempts
              const span = 8 + ((Math.random() * 40) | 0); // smaller search range
              const j = (i + span) % M;
              const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
              const r2 = Math.hypot(x2, y2, z2) || 1e-6;
              if (r2 < MICRO_MIN || r2 > MICRO_MAX) continue;
              const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
              if (dist < 0.04) {
                edgeData[ei * 6 + 0] = x1; edgeData[ei * 6 + 1] = y1; edgeData[ei * 6 + 2] = z1;
                edgeData[ei * 6 + 3] = x2; edgeData[ei * 6 + 4] = y2; edgeData[ei * 6 + 5] = z2;
                ei++;
              }
            }
          }
        }

        // Simplified clustered edge groups: basic connectivity for performance
        if (ei < MAX_EDGES && fourCores) {
          const CL_RAD = RMAX * 0.15;   // reduced radius
          const LOCAL_DIST = 0.06;      // shorter connections
          const STRIDE = 20;            // larger stride for less sampling
          for (let c = 0; c < Math.min(2, hubCenters.length) && ei < MAX_EDGES; c++) { // only process 2 clusters
            const cx = hubCenters[c][0], cy = hubCenters[c][1], cz = hubCenters[c][2];
            for (let i = 0; i < M && ei < MAX_EDGES; i += STRIDE) {
              const x1 = pos0[i * 3], y1 = pos0[i * 3 + 1], z1 = pos0[i * 3 + 2];
              const dx = x1 - cx, dy = y1 - cy, dz = z1 - cz;
              if ((dx*dx + dy*dy + dz*dz) > (CL_RAD*CL_RAD)) continue;
              // simplified connection pattern
              for (let k = 1; k <= 8 && ei < MAX_EDGES; k++) { // reduced from 40 to 8
                const j = (i + k * (STRIDE + 5)) % M;
                const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
                const dd = (x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1);
                if (dd < LOCAL_DIST*LOCAL_DIST) {
                  edgeData[ei * 6 + 0] = x1; edgeData[ei * 6 + 1] = y1; edgeData[ei * 6 + 2] = z1;
                  edgeData[ei * 6 + 3] = x2; edgeData[ei * 6 + 4] = y2; edgeData[ei * 6 + 5] = z2;
                  edgeKind[ei] = 1.0; // all intra-cluster for simplicity
                  ei++;
                }
              }
            }
          }
        }

        // Radial spokes: connect outer rim inward along similar direction for structure
        if (ei < MAX_EDGES) {
          const SPOKE_STEP = 24;
          for (let i = 0; i < M && ei < MAX_EDGES; i += SPOKE_STEP) {
            const x1 = pos0[i * 3], y1 = pos0[i * 3 + 1], z1 = pos0[i * 3 + 2];
            const r1 = Math.hypot(x1, y1, z1) || 1e-6;
            const RMAX = 0.85; const OUTER_RING_MIN = RMAX * 0.92; const INNER_BAND = RMAX * 0.55;
            if (r1 < OUTER_RING_MIN) continue;
            const ux1 = x1 / r1, uy1 = y1 / r1, uz1 = z1 / r1;
            for (let k = 0; k < 12 && ei < MAX_EDGES; k++) {
              const j = (i + 200 + ((Math.random() * 1200) | 0)) % M;
              const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
              const r2 = Math.hypot(x2, y2, z2) || 1e-6;
              if (r2 > OUTER_RING_MIN || r2 < INNER_BAND) continue;
              const ux2 = x2 / r2, uy2 = y2 / r2, uz2 = z2 / r2;
              const angular = ux1 * ux2 + uy1 * uy2 + uz1 * uz2;
              const dist = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) + (z2-z1)*(z2-z1));
              if (angular > 0.92 && dist < 0.14) {
                edgeData[ei * 6 + 0] = x1; edgeData[ei * 6 + 1] = y1; edgeData[ei * 6 + 2] = z1;
                edgeData[ei * 6 + 3] = x2; edgeData[ei * 6 + 4] = y2; edgeData[ei * 6 + 5] = z2;
                edgeKind[ei] = (clusterIdArr[i] === clusterIdArr[j]) ? 1.0 : 0.0;
                ei++;
              }
            }
          }
        }

        // Core-chord edges: occasional long edges that cross the interior to add center structure
        if (ei < MAX_EDGES) {
          const CHORD_STEP = 60;
          for (let i = 0; i < M && ei < MAX_EDGES; i += CHORD_STEP) {
            const x1 = pos0[i * 3], y1 = pos0[i * 3 + 1], z1 = pos0[i * 3 + 2];
            const r1 = Math.hypot(x1, y1, z1) || 1e-6;
            if (r1 < 0.45) continue; // skip deep center origins
            // pick a roughly opposite point to ensure center-crossing
            const j = (i + ((M / 2) | 0) + ((Math.random() * 200) | 0)) % M;
            const x2 = pos0[j * 3], y2 = pos0[j * 3 + 1], z2 = pos0[j * 3 + 2];
            const r2 = Math.hypot(x2, y2, z2) || 1e-6;
            if (r2 < 0.45) continue;
            // strong angular separation
            const ux1 = x1 / r1, uy1 = y1 / r1, uz1 = z1 / r1;
            const ux2 = x2 / r2, uy2 = y2 / r2, uz2 = z2 / r2;
            const angular = ux1 * ux2 + uy1 * uy2 + uz1 * uz2; // cos angle
            if (angular < -0.2) { // more opposite
              // add a gentle curve as well
              if (addCurvedEdge(x1, y1, z1, x2, y2, z2, (clusterIdArr[i] === clusterIdArr[j]) ? 1.0 : 0.0)) {
                ei = edgeCount;
              }
            }
          }
        }

        
        edgeCount = ei;
        // Store edge data for sparkle effects
        edgeCountRef.current = edgeCount;
        edgeDataRef.current = edgeData.slice(0, edgeCount * 6);
        if (edgeCount > 0) {
        // Optimized edge retention for performance while maintaining visual appeal
        const KEEP_RATIO = isDense ? 0.25 : 0.45; // reduced for better performance
          if (edgeCount > 0) {
            let write = 0;
            for (let t = 0; t < edgeCount; t++) {
              if (Math.random() <= KEEP_RATIO) {
                const r = write * 6, s = t * 6;
                edgeData[r + 0] = edgeData[s + 0];
                edgeData[r + 1] = edgeData[s + 1];
                edgeData[r + 2] = edgeData[s + 2];
                edgeData[r + 3] = edgeData[s + 3];
                edgeData[r + 4] = edgeData[s + 4];
                edgeData[r + 5] = edgeData[s + 5];
                write++;
              }
            }
            edgeCount = write;
          }
        // Second pass reduction - conservative for performance
          if (edgeCount > 0) {
            let write2 = 0;
            for (let t = 0; t < edgeCount; t++) {
            if (Math.random() <= (isDense ? 0.20 : 0.50)) { // reduced for better performance
                const r = write2 * 6, s = t * 6;
                edgeData[r + 0] = edgeData[s + 0];
                edgeData[r + 1] = edgeData[s + 1];
                edgeData[r + 2] = edgeData[s + 2];
                edgeData[r + 3] = edgeData[s + 3];
                edgeData[r + 4] = edgeData[s + 4];
                edgeData[r + 5] = edgeData[s + 5];
                write2++;
              }
            }
            edgeCount = write2;
          }
          // Guarantee at least one connection per node (nearest-neighbor) for coherence
          if (edgeCount < MAX_EDGES) {
            const MNN = M;
            const deg: Uint16Array = new Uint16Array(MNN);
            for (let t = 0; t < edgeCount; t++) {
              const s = t * 6;
              const i = Math.max(0, Math.min(MNN-1, Math.floor(s/6) >= 0 ? (():number=>{ const ax=edgeData[s+0], ay=edgeData[s+1], az=edgeData[s+2]; /* find original index by comparing to pos0 (cheap hash) */ let best=0,bd=1e9; for(let q=0;q<MNN;q++){ const dx=pos0[q*3]-ax, dy=pos0[q*3+1]-ay, dz=pos0[q*3+2]-az; const d=dx*dx+dy*dy+dz*dz; if(d<bd){bd=d; best=q} } return best })() : 0));
              const j = (():number=>{ const bx=edgeData[s+3], by=edgeData[s+4], bz=edgeData[s+5]; let best=0,bd=1e9; for(let q=0;q<MNN;q++){ const dx=pos0[q*3]-bx, dy=pos0[q*3+1]-by, dz=pos0[q*3+2]-bz; const d=dx*dx+dy*dy+dz*dz; if(d<bd){bd=d; best=q} } return best })();
              deg[i]++; deg[j]++;
            }
            for (let i = 0; i < MNN && edgeCount < MAX_EDGES; i++) {
              if (deg[i] > 0) continue;
              let best = -1; let bd = 1e9;
              const ix = pos0[i*3], iy = pos0[i*3+1], iz = pos0[i*3+2];
              for (let j = 0; j < MNN; j++) { if (j===i) continue; const dx=pos0[j*3]-ix, dy=pos0[j*3+1]-iy, dz=pos0[j*3+2]-iz; const d = dx*dx+dy*dy+dz*dz; if (d < bd) { bd = d; best = j } }
              if (best >= 0) {
                const r = edgeCount * 6;
                edgeData[r+0] = ix; edgeData[r+1] = iy; edgeData[r+2] = iz;
                edgeData[r+3] = pos0[best*3]; edgeData[r+4] = pos0[best*3+1]; edgeData[r+5] = pos0[best*3+2];
                edgeCount++;
                deg[i]++; deg[best]++;
              }
            }
          }
          try { if (alive) edgeBuf.subdata(edgeData.subarray(0, Math.min(edgeCount, MAX_EDGES) * 6)) } catch {}
          try { if (!(window as any).__EDGE_LOGGED__) { (window as any).__EDGE_LOGGED__ = true; } } catch {}
        }
      }
      
      if (end < N) scheduler(() => step(end));
    };
    scheduler(() => step(0));

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (tagRafId) cancelAnimationFrame(tagRafId);
      if (sparkleRafId) cancelAnimationFrame(sparkleRafId);
      if (flowRafId) cancelAnimationFrame(flowRafId);
      if (asBackground && syncHandler) {
        try { window.removeEventListener(`login_zoom_sync_${syncKey}`, syncHandler as any as EventListener) } catch {}
      }
      window.removeEventListener('resize', resize);
      try {
        canvas.removeEventListener('webglcontextlost', onContextLost as any, false)
        canvas.removeEventListener('webglcontextrestored', onContextRestored as any, false)
      } catch {}
      if (reglRef.current) {
        try { reglRef.current.destroy(); } catch {}
      }
      reglRef.current = null;
      alive = false;
    };
  }, [isDense, showEdges, edgeMultiplier, fourCores, nodeScale, sideHole, sectorDensity, bgPaused, bgRotSpeed]);

  // Parallax with foreground pans
  useEffect(()=>{
    if (!asBackground) return
    const pan = (e: CustomEvent)=>{
      const d = e?.detail || {}
      // Smoothly follow tx/ty for a sense of camera motion (translation only)
      const lerp = (a:number,b:number,t:number)=> a + (b-a)*t
      pxRef.current = lerp(pxRef.current, d.tx || 0, 0.25)
      pyRef.current = lerp(pyRef.current, d.ty || 0, 0.25)
      // Do not rotate or change zoom in background mode
      tiltRef.current = 0
    }
    const turn = (e: CustomEvent)=>{
      // Ignore turns in background; keep static
      tiltRef.current = 0
    }
    try { window.addEventListener('graph_pan', pan as any) } catch {}
    try { window.addEventListener('graph_turn', turn as any) } catch {}
    return ()=>{ try { window.removeEventListener('graph_pan', pan as any) } catch {}; try { window.removeEventListener('graph_turn', turn as any) } catch {} }
  }, [asBackground])

  // Connect animation: 2s; zoom + gentle rotate; persists as background
  const start = () => {
    if (startedRef.current || animating || !reglRef.current) return;
    startedRef.current = true;
    setAnimating(true);
    const T = 2000; // 2s transition
    const t0 = performance.now();

    const tick = (now: number) => {
      const dt = now - t0;
      const p = clamp01(dt / T);
      const zP = clamp01(dt / 2000);  // zoom over full 2s
      const rP = clamp01(dt / 2000);  // rotate gently over full 2s
      const fP = clamp01((dt - 800) / 800); // fade-in flat layer in last 1.2s

      // Zoom deeper but keep within safe clip bounds
      const z = 700 + 1800 * easeInOutCubic(zP);
      zoomRef.current = z;
      // Keep tilt near face-on, add a touch of oscillation for life
      const startTiltDeg = 10;
      const targetTiltDeg = 0;
      tiltRef.current = (startTiltDeg + (targetTiltDeg - startTiltDeg) * easeInOutCubic(rP)) * Math.PI / 180;
      // Keep phase at zero to guarantee no flattening (no disk/line)
      phaseRef.current = 0.0;

      if (p < 1) requestAnimationFrame(tick);
      else {
        if (!doneRef.current) {
          doneRef.current = true;
          setAnimating(false);
          // Broadcast final zoom to background listeners
          try { window.dispatchEvent(new CustomEvent(`login_zoom_sync_${syncKey}`, { detail: { zoom: zoomRef.current } })) } catch {}
          (onDone || onConnect)?.();
        }
      }
    };

    requestAnimationFrame(tick);
  };

  // Resume loop when unpausing background
  useEffect(()=>{
    if (!asBackground) return
    if (!bgPaused && !rafRef.current && reglRef.current) {
      const start = () => {
        try {
          const regl = reglRef.current!
          const drawOuter = ()=>{}
          const step = () => {
            regl.poll();
            regl.clear({ color: [0,0,0,1], depth: 1 });
            // The main loop established in mount effect will handle drawing
          }
          requestAnimationFrame(step)
        } catch {}
      }
      requestAnimationFrame(start)
    }
  }, [bgPaused, asBackground])

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: asBackground ? 'none' as const : 'auto' as const }}>
      <div style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        width: '100%', 
        height: '30px', 
        WebkitAppRegion: 'drag', 
        zIndex: 1001 
      }} />
      <style>{`
        @keyframes shimmer {
          0% { left: -100%; }
          100% { left: 100%; }
        }
      `}</style>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      {/* Wordmark + button stack (hidden in background mode) */}
      {!asBackground && (
      <div style={{ position:'absolute', left:'20%', top:'85%', transform:'translate(-50%, -50%)', zIndex:1000, color:'#fff', textAlign:'left' as const }}>
        <div style={{ fontFamily: 'Orbitron, monospace', fontWeight: 400, opacity:0.9, letterSpacing:1.2, fontSize:60, lineHeight:1 }}>
          <Typewriter text="OpenGraph" />
        </div>
        {!animating && (
          <button
            onClick={(e: React.MouseEvent<HTMLButtonElement>)=>{ 
              e.preventDefault(); 
              e.stopPropagation(); 
              start(); 
            }}
            disabled={startedRef.current}
            style={{
              marginTop: 20,
              padding: '14px 32px',
              background: 'linear-gradient(145deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05))',
              color: '#ffffff',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 16,
              cursor: 'pointer',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
              fontWeight: 600,
              letterSpacing: 1.5,
              fontSize: 14,
              textTransform: 'uppercase' as const,
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
              position: 'relative' as const,
              overflow: 'hidden' as const,
            }}
            onMouseEnter={(e: any)=>{ 
              e.currentTarget.style.transform='scale(1.05) translateY(-1px)'; 
              e.currentTarget.style.boxShadow='0 12px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3)';
              e.currentTarget.style.background='linear-gradient(145deg, rgba(255,255,255,0.2), rgba(255,255,255,0.08))';
            }}
            onMouseLeave={(e: any)=>{ 
              e.currentTarget.style.transform='scale(1.0) translateY(0px)'; 
              e.currentTarget.style.boxShadow='0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)';
              e.currentTarget.style.background='linear-gradient(145deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05))';
            }}
            onMouseDown={(e: any)=>{ 
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.style.transform='scale(0.98) translateY(1px)'; 
            }}
            onMouseUp={(e: any)=>{ 
              e.currentTarget.style.transform='scale(1.05) translateY(-1px)'; 
            }}
          >
            <span style={{ position: 'relative', zIndex: 1 }}>Connect</span>
            <div style={{
              position: 'absolute',
              top: 0,
              left: '-100%',
              width: '100%',
              height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
              animation: 'shimmer 2s infinite',
              zIndex: 0
            }} />
          </button>
        )}
      </div>
      )}

      {/* Floating company tags (disabled in background mode) */}
      {!asBackground && companyTags.map(tag => {
        const now = performance.now();
        const elapsed = now - tag.startTime;
        const progress = elapsed / 5000; // 0..1 over 5 seconds
        const opacity = progress < 0.1 ? progress * 10 : progress > 0.9 ? (1 - progress) * 10 : 1;
        const rotation = tag.angle + (elapsed / 1000) * 0.5; // slow rotation
        const radius = 30 + Math.sin(elapsed / 800) * 8; // gentle orbit
        const offsetX = Math.cos(rotation) * radius;
        const offsetY = Math.sin(rotation) * radius;

        return (
          <div
            key={tag.id}
            style={{
              position: 'absolute',
              left: `${tag.x * 100}%`,
              top: `${tag.y * 100}%`,
              transform: `translate(${offsetX - 50}px, ${offsetY - 50}px)`,
              opacity,
              color: '#fff',
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              background: 'rgba(0,0,0,0.6)',
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.2)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 999
            }}
          >
            {tag.company}
          </div>
        );
      })}
    </div>
  );
}

// Lightweight typewriter with smooth stepping and persistent blinking underscore
function Typewriter({ text }: { text: string }){
  const [t, setT] = useState(0)
  const [blink, setBlink] = useState(true)
  const raf = useRef<number | null>(null)
  const start = useRef<number>(0)
  useEffect(() => {
    const total = text.length
    const duration = 900 // ms to complete typing
    const step = (now: number) => {
      if (!start.current) start.current = now
      const p = Math.min(1, (now - start.current) / duration)
      // ease then round to character
      const eased = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3)/2
      setT(Math.round(eased * total))
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    const id = setInterval(()=> setBlink(b=>!b), 530)
    return () => { if (raf.current) cancelAnimationFrame(raf.current); clearInterval(id) }
  }, [text])
  const shown = text.slice(0, t)
  return <span>{shown}{blink ? <span style={{ opacity:0.9 }}>_</span> : <span style={{ opacity:0 }}>_</span>}</span>
}
