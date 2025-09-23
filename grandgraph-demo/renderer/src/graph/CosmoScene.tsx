import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ParsedTile } from './parse'
import type { GraphSceneHandle, GraphSceneProps } from './types'
import { Cosmograph } from '@cosmograph/react'

type CosmoNode = {
  id: number
  label: string
  x: number
  y: number
  size: number
  color: string
}

type CosmoEdge = {
  source: number
  target: number
  weight: number
  color: string
}

const groupPalette = {
  0: '#f35d8f', // left cohort
  1: '#ffd369', // bridge cluster
  2: '#4ad7d1'  // right cohort
} as const

const edgePalette = {
  default: 'rgba(186, 188, 198, 0.35)',
  left: 'rgba(243, 93, 143, 0.45)',
  right: 'rgba(74, 215, 209, 0.45)',
  bridge: 'rgba(255, 211, 105, 0.4)'
} as const

const CosmoScene = forwardRef<GraphSceneHandle, GraphSceneProps>(function CosmoScene(props: GraphSceneProps, ref) {
  const [tile, setTile] = useState<ParsedTile | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setDimensions({ width, height })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  useImperativeHandle(ref, () => ({
    setForeground: (fg: ParsedTile) => {
      setTile(fg)
    },
    clear: () => {
      setTile(null)
      props.onClear?.()
    },
    focusIndex: () => {},
    reshapeLayout: () => {},
    promoteTrailPrevious: () => false
  }), [props])

  const nodes = useMemo<CosmoNode[]>(() => {
    if (!tile) return []
    const list: CosmoNode[] = new Array(tile.count)
    for (let i = 0; i < tile.count; i++) {
      const x = tile.nodes[i * 2]
      const y = tile.nodes[i * 2 + 1]
      const size = Math.max(1, tile.size?.[i] ?? 1)
      const group = tile.group?.[i] ?? 1
      list[i] = {
        id: i,
        label: (tile.labels && tile.labels[i]) || `#${i}`,
        x,
        y,
        size,
        color: groupPalette[group as 0 | 1 | 2] ?? groupPalette[1]
      }
    }
    return list
  }, [tile])

  const edges = useMemo<CosmoEdge[]>(() => {
    if (!tile || !tile.edges) return []
    const list: CosmoEdge[] = []
    for (let i = 0; i < tile.edges.length; i += 2) {
      const source = tile.edges[i]
      const target = tile.edges[i + 1]
      const weight = tile.edgeWeights ? tile.edgeWeights[i / 2] ?? 1 : 1
      const sg = tile.group?.[source] ?? 1
      const tg = tile.group?.[target] ?? 1
      let color = edgePalette.default
      if ((sg === 0 && tg === 1) || (sg === 1 && tg === 0)) color = edgePalette.left
      else if ((sg === 2 && tg === 1) || (sg === 1 && tg === 2)) color = edgePalette.right
      else if (sg === 1 && tg === 1) color = edgePalette.bridge
      list.push({ source, target, weight, color })
    }
    return list
  }, [tile])

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
      {tile ? (
        // @ts-ignore Cosmograph type definitions accept these props at runtime
        <Cosmograph
          width={Math.max(0, Math.floor(dimensions.width))}
          height={Math.max(0, Math.floor(dimensions.height))}
          nodes={nodes}
          links={edges}
          nodeColor={(node: CosmoNode) => node.color}
          linkColor={(edge: CosmoEdge) => edge.color}
          nodeSize={(node: CosmoNode) => Math.max(1.5, Math.sqrt(node.size) * 2)}
          linkWidth={(edge: CosmoEdge) => Math.min(2, Math.max(0.2, edge.weight * 0.1))}
          renderForces={false}
          zoomLevel={1}
          fitView
          onNodeClick={(node: CosmoNode) => props.onPick?.(node.id)}
          onNodeDoubleClick={(node: CosmoNode) => {
            try {
              const idx = node.id
              const t: any = tile as any
              let rawId: string | null = null
              try {
                const metaNode = t?.meta?.nodes?.[idx]
                if (metaNode && (metaNode.id != null || metaNode.linkedin_id != null || metaNode.handle != null)) {
                  rawId = String(metaNode.id ?? metaNode.linkedin_id ?? metaNode.handle)
                }
              } catch {}
              if (!rawId) {
                try {
                  const lbl = (t?.labels && Array.isArray(t.labels)) ? t.labels[idx] : null
                  if (lbl && /^(company|person):\d+$/i.test(lbl)) rawId = lbl
                } catch {}
              }
              if (!rawId) return
              const mode = t?.meta?.mode as string | undefined
              const grp = (Array.isArray((t as any)?.group) ? (t as any).group[idx] : (t as any)?.group?.[idx])
              let canonical = rawId
              if (/^(company|person):\d+$/i.test(rawId)) {
                canonical = rawId.toLowerCase()
              } else if (/^\d+$/.test(rawId)) {
                if (mode === 'graph') {
                  canonical = (grp === 1) ? `person:${rawId}` : `company:${rawId}`
                } else if (mode === 'person') {
                  canonical = `person:${rawId}`
                } else if (mode === 'flows') {
                  canonical = (idx === 0 || idx === 1) ? `company:${rawId}` : ''
                } else {
                  canonical = `person:${rawId}`
                }
              }
              if (!canonical) return
              window.dispatchEvent(new CustomEvent('crux_insert', { detail: { text: canonical } }))
            } catch {}
          }}
        />
      ) : null}
    </div>
  )
})

export default CosmoScene
