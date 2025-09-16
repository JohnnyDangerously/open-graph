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
};

type Props = { onDone?: () => void; onConnect?: () => void; config?: MegaConfig };

export default function LoginScene({ onDone, onConnect, config }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reglRef = useRef<Regl | null>(null);
  const rafRef = useRef<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const startedRef = useRef(false);
  const doneRef = useRef(false);
  const filledRef = useRef(0); // number of points currently generated

  const cfg = {
    particleCount: 300000,
    clusterCount: 9,
    pointSizePx: 2.9,
    baseColor: [0.70, 0.62, 0.94] as [number, number, number],
    background: [0.04, 0.04, 0.07] as [number, number, number],
    glow: 0.95,
    ...(config || {})
  };

  // animated uniform sources
  const phaseRef = useRef(0.0); // 0..1 (3D → 2D)
  const zoomRef = useRef(700);  // perspective-ish scaler
  const tiltRef = useRef(15 * Math.PI / 180); // tilt around X

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;

    // --- data (300k points, generated in chunks to avoid blocking) ---
    const N = Math.max(1, cfg.particleCount | 0);
    const pos0 = new Float32Array(N * 3);
    const seed = new Float32Array(N);

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
    // smooth radius samplers (no shells!)
    function radiusCore() { return 0.02 + 0.18 * Math.pow(Math.random(), 1.6); }
    function radiusBody() { return 0.30 + 0.60 * Math.pow(Math.random(), 0.9); }
    function radiusShell() { return 0.86 + 0.14 * Math.pow(Math.random(), 2.0); }

    // mixture weights (soft)
    const wCore = 0.14, wClusterSmall = 0.22, wClusterMid = 0.20, wClusterFull = 0.20, wShell = 0.14, wDust = 0.10;
    const wSum = wCore + wClusterSmall + wClusterMid + wClusterFull + wShell + wDust;
    function fillRange(start: number, end: number){
      for (let i = start; i < end; i++) {
        const u = Math.random() * wSum;
        let x = 0, y = 0, z = 0;
        if (u < wCore) {
          const d = uniformDir(); const R = radiusCore(); x = d[0] * R; y = d[1] * R; z = d[2] * R;
        } else if (u < wCore + wClusterSmall) {
          const c = centers[(Math.random() * CLUSTERS) | 0]; const d = sampleAround(c, 0.22);
          const s = 0.28 + 0.18 * Math.random(); const R = 0.85 * (0.80 + 0.20 * Math.random());
          x = d[0] * s * R; y = d[1] * s * R; z = d[2] * s * R;
        } else if (u < wCore + wClusterSmall + wClusterMid) {
          const c = centers[(Math.random() * CLUSTERS) | 0]; const d = sampleAround(c, 0.18);
          const s = 0.45 + 0.22 * Math.random(); const R = 0.88 * (0.85 + 0.25 * Math.random());
          x = d[0] * s * R; y = d[1] * s * R; z = d[2] * s * R;
        } else if (u < wCore + wClusterSmall + wClusterMid + wClusterFull) {
          const c = centers[(Math.random() * CLUSTERS) | 0]; const d = sampleAround(c, 0.12);
          const R = radiusBody(); x = d[0] * R; y = d[1] * R; z = d[2] * R;
        } else if (u < wCore + wClusterSmall + wClusterMid + wClusterFull + wShell) {
          const d = uniformDir(); const R = radiusShell(); x = d[0] * R; y = d[1] * R; z = d[2] * R;
        } else {
          const d = uniformDir(); const R = 0.20 + 0.80 * Math.random();
          x = d[0] * R; y = d[1] * R; z = d[2] * R;
        }
        const j = 3 * i;
        pos0[j + 0] = x; pos0[j + 1] = y; pos0[j + 2] = z;
        seed[i] = Math.random();
      }
    }

    // no decorative lines; particles only

    const regl = createREGL({ canvas, attributes: { antialias: false, alpha: false, depth: false } });
    reglRef.current = regl;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    };
    resize();
    window.addEventListener('resize', resize);

    // --- buffers ---
    const posBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: pos0.byteLength });
    const sedBuf = regl.buffer({ usage: 'dynamic', type: 'float', length: seed.byteLength });
    // no edges buffer since lines are removed

    const draw = regl({
      vert: `
      precision highp float;
      attribute vec3 a_pos0;
      attribute float a_group, a_seed;
      uniform float u_time, u_phase, u_zoom;
      uniform vec2  u_view;
      uniform mat3  u_rot;
      uniform float u_pointPx;
      uniform float u_glow;
      uniform vec3  u_color;
      varying float v_alpha;

      float hash11(float p){
        p = fract(p*0.1031);
        p *= p + 33.33;
        p *= p + p;
        return fract(p);
      }
      // subtle swirl removed to avoid visible banding; use gentle global yaw below
      void main(){
        vec3 p = a_pos0;
        float j = 0.008 * sin(u_time*1.7 + a_seed*6.28);
        p += j * normalize(vec3(sin(a_seed*4.1), cos(a_seed*3.7), sin(a_seed*2.3)));
        p.z *= (1.0 - u_phase);
        // global slow yaw to feel alive
        float cy = cos(u_time*0.12), sy = sin(u_time*0.12);
        mat3 ry = mat3(cy,0.0,sy, 0.0,1.0,0.0, -sy,0.0,cy);
        vec3 pr = u_rot * (ry * p);
        float f = 1.0 / (1.0 + pr.z * 0.8);
        vec2 screen = pr.xy * (u_zoom * f);
        // centered mapping (no offset), so the globe sits in the middle
        vec2 clip = (screen / (0.5 * u_view));
        gl_Position = vec4(clip, 0.0, 1.0);
        gl_PointSize = u_pointPx;
        v_alpha = (0.10 + 0.20 * hash11(a_seed*9.9)) * u_glow;
      }
      `,
      frag: `
      precision highp float;
      uniform vec3 u_color;
      varying float v_alpha;
      void main(){
        vec2 p = gl_PointCoord*2.0 - 1.0;
        float d = dot(p,p);
        if (d>1.0) discard;
        float fall = exp(-3.6*d);
        float alpha = v_alpha * fall;
        gl_FragColor = vec4(u_color, alpha);
      }
      `,
      attributes: {
        a_pos0: { buffer: posBuf, size: 3 },
        a_seed: sedBuf,
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
        u_glow: () => cfg.glow,
        u_color: () => cfg.baseColor,
      },
      count: () => filledRef.current,
      primitive: 'points',
      depth: { enable: false },
      blend: { enable: true, func: { srcRGB: 'src alpha', srcAlpha: 'one', dstRGB: 'one minus src alpha', dstAlpha: 'one minus src alpha' } }
    });

    // removed drawLines pass

    const loop = () => {
      regl.poll();
      regl.clear({ color: [cfg.background[0], cfg.background[1], cfg.background[2], 1] });
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();

    // Start non-blocking data generation and update buffers incrementally
    const CHUNK = 20000;
    const scheduler = (cb: any) => {
      const ric: any = (window as any).requestIdleCallback;
      if (ric) ric(cb, { timeout: 16 }); else setTimeout(cb, 0);
    };
    const step = (start: number) => {
      const end = Math.min(N, start + CHUNK);
      fillRange(start, end);
      // upload subranges
      posBuf.subdata(pos0.subarray(3 * start, 3 * end), 3 * start * 4);
      sedBuf.subdata(seed.subarray(start, end), start * 4);
      filledRef.current = end;
      if (end < N) scheduler(() => step(end));
    };
    scheduler(() => step(0));

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      try { regl.destroy(); } catch {}
      reglRef.current = null;
    };
  }, []);

  // Connect animation: 2s; zoom forward, tilt to top-down, flatten to 2D
  const start = () => {
    if (startedRef.current || animating || !reglRef.current) return;
    startedRef.current = true;
    setAnimating(true);
    const T = 2000;
    const t0 = performance.now();

    const tick = (now: number) => {
      const dt = now - t0;
      const p = clamp01(dt / T);
      const zP = clamp01(dt / 600);
      const rP = clamp01((dt - 200) / 1200);
      const fP = clamp01((dt - 600) / 1000);

      zoomRef.current = 700 + 400 * easeInOutCubic(zP);
      tiltRef.current = (15 + 75 * easeInOutCubic(rP)) * Math.PI / 180;
      phaseRef.current = easeInOutCubic(fP);

      if (p < 1) requestAnimationFrame(tick);
      else {
        if (!doneRef.current) {
          doneRef.current = true;
          setAnimating(false);
          (onDone || onConnect)?.();
        }
      }
    };

    requestAnimationFrame(tick);
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      {!animating && (
        <button
          onMouseDown={(e: React.MouseEvent<HTMLButtonElement>)=>{ e.preventDefault(); e.stopPropagation(); start(); }}
          onClick={(e: React.MouseEvent<HTMLButtonElement>)=>{ e.preventDefault(); e.stopPropagation(); }}
          disabled={startedRef.current}
          style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 1000,
            padding: '14px 28px',
            background: 'linear-gradient(180deg, rgba(135,124,255,0.85), rgba(255,134,219,0.85))',
            color: '#0b0b12',
            border: '1px solid rgba(255,255,255,0.35)',
            borderRadius: 14,
            cursor: 'pointer',
            boxShadow: '0 8px 30px rgba(186,128,255,0.35), 0 2px 8px rgba(0,0,0,0.35)',
            fontWeight: 700,
            letterSpacing: 0.6,
            fontSize: 18,
            backdropFilter: 'blur(3px)',
            transition: 'transform 180ms ease, box-shadow 180ms ease, filter 180ms ease',
            outline: '2px solid rgba(255,255,255,0.18)'
          }}
          onMouseEnter={(e: any)=>{ e.currentTarget.style.transform='translate(-50%,-50%) scale(1.04)'; e.currentTarget.style.boxShadow='0 10px 36px rgba(200,150,255,0.45), 0 3px 10px rgba(0,0,0,0.4)'; }}
          onMouseLeave={(e: any)=>{ e.currentTarget.style.transform='translate(-50%,-50%) scale(1.0)'; e.currentTarget.style.boxShadow='0 8px 30px rgba(186,128,255,0.35), 0 2px 8px rgba(0,0,0,0.35)'; }}
          onFocus={(e: any)=>{ e.currentTarget.style.filter='brightness(1.05)'; }}
          onBlur={(e: any)=>{ e.currentTarget.style.filter='none'; }}
        >
          Connect
        </button>
      )}

      {/* bottom-right typing: "vector" with blinking underscore */}
      <div style={{ position:'absolute', right:18, bottom:14, zIndex:999, color:'#fff', fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', opacity:0.85, letterSpacing:0.5, fontSize:14 }}>
        <Typewriter text="vector" />
      </div>
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

