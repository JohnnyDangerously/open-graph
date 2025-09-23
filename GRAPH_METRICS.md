### Graph metrics and camera/visibility APIs

This document defines a consistent, world-space way to measure graph/network sizes and exposes camera/viewport helpers you can use anywhere in the app to align canvas objects, compute spacing, and reason about what is visible to the user.

### Coordinate system

- World space: The coordinates stored in a `ParsedTile` (`nodes: Float32Array`) and used for layout. Metrics should be computed in world space so they are independent of zoom.
- Screen/CSS space: What the user sees on the canvas after the world is transformed by the camera.

### Canonical bounds metric (world-space)

For any subset of nodes, we measure a world-space axis-aligned bounding box and derive common scalars.

- Inputs
  - nodes: tile nodes (optionally filtered)
  - optional mask: `boolean[]` aligned with nodes to ignore hidden items
  - optional `groupId`: filter where `tile.group[i] === groupId`
  - optional `dropPercentile`: trim N% outliers at each end per axis for stability (e.g. 2–5)

- Outputs (WorldBounds)
  - `minX, maxX, minY, maxY`
  - `width = maxX - minX`, `height = maxY - minY`
  - `center = ((minX+maxX)/2, (minY+maxY)/2)`

Use width/height (or diameter = max(width, height)) as a consistent “size” metric across view modes.

### Scene API (GraphSceneHandle)

The canvas scene exposes the following helper methods (world-space):

- `getCamera(): { scale, tx, ty, viewportCss: { width, height }, viewportWorld: WorldBounds }`
  - `scale`: zoom factor
  - `tx, ty`: world→screen translation in CSS pixels
  - `viewportCss`: canvas size in CSS pixels
  - `viewportWorld`: world rectangle corresponding to the current viewport

- `measureForegroundBounds(opts?): WorldBounds | null`
  - Options: `{ mask?: boolean[] | null, groupId?: number | null, dropPercentile?: number }`
  - Returns bounds for the current foreground tile (filtered by mask/group and with optional outlier trimming).

- `measureGroupBounds(groupId, opts?): WorldBounds | null`
  - Convenience wrapper: bounds for one cohort (group) id.

- `getVisibilityForBounds(bounds): { visibleFraction: number, viewport: WorldBounds }`
  - Computes intersection of `bounds` with the current viewport in world space and returns the fraction visible (0..1).

Types live in `grandgraph-demo/renderer/src/graph/types.ts` (`WorldBounds`) and are implemented in `CanvasScene.tsx`.

### Usage examples

```ts
// Get camera/viewport
const cam = sceneRef.current?.getCamera?.()

// Foreground size with mild outlier trimming
const fg = sceneRef.current?.measureForegroundBounds?.({ dropPercentile: 2 })

// Specific group (e.g., left cohort = 0)
const left = sceneRef.current?.measureGroupBounds?.(0, { dropPercentile: 2 })

// Visibility of the foreground in current viewport
const vis = fg && sceneRef.current?.getVisibilityForBounds?.(fg)
// vis.visibleFraction ∈ [0,1]
```

### Consistent spacing/alignment

To place two networks A and B side-by-side with consistent world spacing:

```ts
const a = sceneRef.current?.measureForegroundBounds?.({ /* bounds of A */ })!
const b = /* bounds for B before placement */
const padding = 240
const distance = 0.5 * Math.max(a.width, a.height) + 0.5 * Math.max(b.width, b.height) + padding
// Move B’s center to (a.center.x + distance, a.center.y)
```

This uses diameter = max(width, height) as the size metric so spacing is robust across shapes.

### Camera math (intuitive reference)

Given world point `(wx, wy)` and camera `{ scale, tx, ty }`, the screen position `(sx, sy)` in CSS pixels is:

```text
sx = wx * scale + tx
sy = wy * scale + ty
```

The world rectangle currently visible in the canvas of size `(W, H)` CSS pixels is:

```text
minX = (-tx) / scale
maxX = (W - tx) / scale
minY = (-ty) / scale
maxY = (H - ty) / scale
```

These are returned as `getCamera().viewportWorld`.

### Compare view

If the foreground tile includes a `compareOverlay`, its world-space regions carry `{ cx, cy, r1, r2 }`. You can derive a coarse overall size as:

```text
diameter ≈ 2 * max(region.r2)
center ≈ average of left/right centers (or the provided focusWorld)
```

For precise spacing, prefer `measureForegroundBounds()` which uses the actual node positions.

### Notes

- Always prefer world-space metrics for layout and alignment; only convert to screen space for UI drawing.
- When highlighting subsets (e.g., filters), pass the `visibleMask` you already compute in App so metrics reflect what the user cares about.
- For very spiky graphs, set `dropPercentile` to 2–5 to avoid a few outliers dominating the measured size.


