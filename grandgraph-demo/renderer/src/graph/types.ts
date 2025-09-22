import type { ParsedTile } from './parse'

export type GraphSceneHandle = {
  setForeground: (fg: ParsedTile, opts?: { noTrailSnapshot?: boolean }) => void
  clear: () => void
  focusIndex: (index: number, opts?: { zoom?: number, zoomMultiplier?: number, animate?: boolean, ms?: number }) => void
  reshapeLayout: (mode: 'hierarchy' | 'radial' | 'grid' | 'concentric', opts?: { animate?: boolean, ms?: number }) => void
  promoteTrailPrevious?: () => boolean
}

export type GraphSceneProps = {
  onStats?: (fps: number, count: number) => void
  concentric?: boolean
  onPick?: (index: number) => void
  onClear?: () => void
  onRegionClick?: (region: 'left' | 'right' | 'overlap') => void
  selectedIndex?: number | null
  visibleMask?: boolean[] | null
}

