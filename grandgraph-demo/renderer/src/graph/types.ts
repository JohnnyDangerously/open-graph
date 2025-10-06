import type { ParsedTile } from './parse'

export type WorldBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
  center: { x: number, y: number }
}

export type GraphSceneHandle = {
  setForeground: (fg: ParsedTile, opts?: { noTrailSnapshot?: boolean }) => void
  clear: () => void
  focusIndex: (index: number, opts?: { zoom?: number, zoomMultiplier?: number, animate?: boolean, ms?: number }) => void
  reshapeLayout: (mode: 'hierarchy' | 'radial' | 'grid' | 'concentric', opts?: { animate?: boolean, ms?: number }) => void
  promoteTrailPrevious?: () => boolean
  getCamera?: () => { scale: number, tx: number, ty: number, viewportCss: { width: number, height: number }, viewportWorld: WorldBounds }
  measureForegroundBounds?: (opts?: { mask?: boolean[] | null, groupId?: number | null, dropPercentile?: number }) => WorldBounds | null
  measureGroupBounds?: (groupId: number, opts?: { mask?: boolean[] | null, dropPercentile?: number }) => WorldBounds | null
  getVisibilityForBounds?: (bounds: WorldBounds) => { visibleFraction: number, viewport: WorldBounds }
}

export type GraphSceneProps = {
  onStats?: (fps: number, count: number) => void
  concentric?: boolean
  onPick?: (index: number) => void
  onClear?: () => void
  onRegionClick?: (region: 'left' | 'right' | 'overlap') => void
  selectedIndex?: number | null
  visibleMask?: boolean[] | null
  maskMode?: 'hide' | 'dim'
  degreeHighlight?: 'all' | 'first' | 'second'
  onUnselect?: () => void
}
