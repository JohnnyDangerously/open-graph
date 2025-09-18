import React, { useEffect, useRef } from 'react'
import createREGL from 'regl'

type Props = {
  width: number
  height: number
  phase?: number // 0 = 3D, 1 = 2D flattened
  zoom?: number
  tilt?: number
  particleCount?: number
  pointSizePx?: number
  alpha?: number // brightness scaler (0..1+)
}

export default function ParticleBackground({ 
  width, 
  height, 
  phase = 1, 
  zoom = 400, 
  tilt = 90, 
  particleCount = 100000,
  pointSizePx = 2.5,
  alpha = 0.15,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reglRef = useRef<any>(null)
  const rafRef = useRef<number>(0)
  const startTimeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Initialize WebGL context
    const regl = createREGL({ 
      canvas, 
      attributes: { antialias: false, alpha: true, depth: false } 
    })
    reglRef.current = regl
    startTimeRef.current = performance.now()

    // Generate particle data
    const N = Math.max(1000, particleCount)
    const pos0 = new Float32Array(N * 3)
    const seed = new Float32Array(N)

    // Cluster centers using Fibonacci sphere distribution
    const CLUSTERS = 8
    const centers: Array<[number, number, number]> = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    
    for (let k = 0; k < CLUSTERS; k++) {
      const y = 1 - 2 * (k + 0.5) / CLUSTERS
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const th = golden * (k + 1)
      centers.push([Math.cos(th) * r, y, Math.sin(th) * r])
    }

    // Helper functions from LoginScene
    function norm3(x: number, y: number, z: number) { 
      const L = Math.hypot(x, y, z) || 1e-6
      return [x / L, y / L, z / L] as const
    }
    
    function sampleAround(mu: readonly [number, number, number], sigma: number) {
      const gx = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1)
      const gy = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1)
      const gz = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) + (Math.random() * 2 - 1)
      return norm3(mu[0] + sigma * gx, mu[1] + sigma * gy, mu[2] + sigma * gz)
    }
    
    function uniformDir() {
      const u = Math.random(), v = Math.random()
      const z = 2 * v - 1, r = Math.sqrt(Math.max(0, 1 - z * z)), phi = 2 * Math.PI * u
      return [r * Math.cos(phi), r * Math.sin(phi), z] as const
    }

    // Generate particles with cluster distribution
    const wCore = 0.0; // disable dense core
    const wClusterSmall = 0.14, wClusterMid = 0.12, wClusterFull = 0.16, wShell = 0.40 + 0.08, wDust = 0.10; // add wCore weight to shell
    const wSum = wCore + wClusterSmall + wClusterMid + wClusterFull + wShell + wDust;

    for (let i = 0; i < N; i++) {
      let x = 0, y = 0, z = 0
      const u = Math.random() * wSum
      
      if (u < wCore + wClusterSmall) {
        // Small clusters
        const c = centers[(Math.random() * CLUSTERS) | 0]
        const d = sampleAround(c, 0.20)
        const s = 0.30 + 0.18 * Math.random()
        const R = 0.84 * (0.80 + 0.20 * Math.random())
        x = d[0] * s * R; y = d[1] * s * R; z = d[2] * s * R
      } else if (u < wCore + wClusterSmall + wClusterMid) {
        // Medium clusters
        const c = centers[(Math.random() * CLUSTERS) | 0]
        const d = sampleAround(c, 0.16)
        const s = 0.48 + 0.20 * Math.random()
        const R = 0.90 * (0.85 + 0.25 * Math.random())
        x = d[0] * s * R; y = d[1] * s * R; z = d[2] * s * R
      } else if (u < wCore + wClusterSmall + wClusterMid + wClusterFull) {
        // Full body clusters
        const c = centers[(Math.random() * CLUSTERS) | 0]
        const d = sampleAround(c, 0.11)
        const R = 0.30 + 0.60 * Math.pow(Math.random(), 0.9)
        x = d[0] * R; y = d[1] * R; z = d[2] * R
      } else if (u < wCore + wClusterSmall + wClusterMid + wClusterFull + wShell) {
        // Outer shell
        const d = uniformDir()
        const R = 0.92 + 0.08 * Math.pow(Math.random(), 1.8)
        x = d[0] * R; y = d[1] * R; z = d[2] * R
      } else {
        // Dust particles
        const d = uniformDir()
        const R = 0.20 + 0.80 * Math.random()
        x = d[0] * R; y = d[1] * R; z = d[2] * R
      }

      // Scale down overall size for background
      const scale = 0.6
      pos0[3 * i + 0] = x * scale
      pos0[3 * i + 1] = y * scale
      pos0[3 * i + 2] = z * scale
      seed[i] = Math.random()
    }

    // Create buffers
    const posBuf = regl.buffer(pos0)
    const seedBuf = regl.buffer(seed)

    // Particle shader (adapted from LoginScene)
    const drawParticles = regl({
      vert: `
      precision highp float;
      attribute vec3 a_pos0;
      attribute float a_seed;
      uniform float u_time, u_phase, u_zoom;
      uniform vec2 u_view;
      uniform mat3 u_rot;
      uniform float u_pointPx;
      uniform float u_alpha;
      varying float v_alpha;

      float hash11(float p){
        p = fract(p*0.1031);
        p *= p + 33.33;
        p *= p + p;
        return fract(p);
      }

      void main(){
        vec3 p = a_pos0;
        
        // Subtle jitter animation
        float j = 0.006 * sin(u_time*1.2 + a_seed*6.28);
        p += j * normalize(vec3(sin(a_seed*4.1), cos(a_seed*3.7), sin(a_seed*2.3)));
        
        // Phase transition from 3D to 2D
        p.z *= (1.0 - u_phase);
        
        // Gentle rotation
        float cy = cos(u_time*0.08), sy = sin(u_time*0.08);
        mat3 ry = mat3(cy,0.0,sy, 0.0,1.0,0.0, -sy,0.0,cy);
        vec3 pr = u_rot * (ry * p);
        
        // Perspective projection
        float f = 1.0 / (1.0 + pr.z * 0.6);
        vec2 screen = pr.xy * (u_zoom * f);
        
        // Center the projection
        vec2 clip = (screen / (0.5 * u_view));
        gl_Position = vec4(clip, 0.0, 1.0);
        
        // Variable point size based on distance and seed
        float lp = length(p);
        float sizeVar = 0.8 + 0.4 * hash11(a_seed * 7.3);
        gl_PointSize = u_pointPx * sizeVar * f;
        
        // Alpha based on distance and phase
        float distAlpha = smoothstep(1.2, 0.0, lp);
        v_alpha = u_alpha * distAlpha * (0.3 + 0.7 * hash11(a_seed * 9.1));
      }`,
      
      frag: `
      precision highp float;
      uniform vec3 u_color;
      varying float v_alpha;
      
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float d = dot(p, p);
        if (d > 1.0) discard;
        
        float falloff = exp(-2.5 * d);
        float alpha = v_alpha * falloff;
        gl_FragColor = vec4(u_color, alpha);
      }`,
      
      attributes: {
        a_pos0: posBuf,
        a_seed: seedBuf,
      },
      
      uniforms: {
        u_time: () => (performance.now() - startTimeRef.current) / 1000,
        u_phase: () => phase,
        u_zoom: () => zoom,
        u_view: () => [width, height],
        u_rot: () => {
          const tiltRad = (tilt * Math.PI) / 180
          const c = Math.cos(tiltRad), s = Math.sin(tiltRad)
          return [1, 0, 0, 0, c, -s, 0, s, c]
        },
        u_pointPx: () => pointSizePx,
        u_alpha: () => alpha, // brightness scaler
        u_color: () => [0.70, 0.62, 0.94], // Purple-ish background color
      },
      
      count: N,
      primitive: 'points',
      depth: { enable: false },
      blend: { 
        enable: true, 
        func: { 
          srcRGB: 'src alpha', 
          srcAlpha: 'one', 
          dstRGB: 'one minus src alpha', 
          dstAlpha: 'one minus src alpha' 
        } 
      }
    })

    // Animation loop
    const animate = () => {
      regl.poll()
      regl.clear({ color: [0, 0, 0, 0], depth: 1 }) // Transparent background
      drawParticles()
      rafRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      try { regl.destroy() } catch {}
    }
  }, [width, height, particleCount])

  // Update canvas size when props change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
  }, [width, height])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none', // Allow interactions to pass through to graph
        zIndex: 0 // Behind the graph
      }}
    />
  )
}
