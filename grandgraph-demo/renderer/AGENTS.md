# Agent Tasks: DevTools Sidebar + Graph UX

This directory contains the renderer (React + Vite). Work is organized into small, independent modules that can be implemented in parallel. Keep changes scoped to the files listed for each module. Follow the existing style: functional components, inline styles with the `--dt-*` CSS variables.

Global context
- App entry: `src/App.tsx` holds app state and graph orchestration.
- Canvas API: `src/graph/CanvasScene.tsx` accepts `visibleMask`, `selectedIndex` and exposes a ref with helpers.
- Tiles: `src/graph/parse.ts` (`ParsedTile`) with `labels` and `meta.nodes`.
- Commands/DSL: `src/ui/CommandBar.tsx`, `src/crux/*` for previews.

Rules
- Do not break existing commands or tiles.
- Minimize edits to shared files (prefer adding small, focused components under `src/ui`).
- Keep UI fast; avoid heavy work in render; memoize as needed.

Modules (easiest → hardest)

1) Side Drawer Shell (DONE)
- Files: `src/ui/SideDrawer.tsx` (new), `src/App.tsx` (mount).
- Goal: DevTools-like drawer with tabs and content area. Used now to host a simple "Nodes" list via `NodeList`.

2) Dim/Hide Engine
- Files: `src/graph/CanvasScene.tsx`, `src/App.tsx` (prop plumbing).
- Add `maskMode: 'hide' | 'dim'` prop. When `dim`, render masked nodes/edges at reduced alpha and disable picking on them. Default remains `hide`.

3) People Search + Node List
- Files: `src/ui/TabPeople.tsx` (new), `src/App.tsx` (mount in `SideDrawer`).
- Build a search box + list filtered from current tile (`labels`, `meta.nodes`). Support `/regex/` input. Emits a `visibleMask` and `onFocusIndex`.

4) Companies (Membership)
- Files: `src/ui/TabCompanies.tsx` (new), optional loader: `data/memberships.json`.
- Load membership IDs from: `localStorage('MEMBERSHIP_COMPANIES')` → `data/memberships.json` → ClickHouse table (if available).
- Toggles: "Only Membership", "Dim Others", "Clear". Build masks accordingly.

5) Connections (1st/2nd)
- Files: `src/ui/TabConnections.tsx` (new).
- For person-ego tiles, compute first/second-degree cohorts and provide actions to focus/mask. Control `highlightDegree` in `CanvasScene`.

6) Compare Groups Browser
- Files: `src/ui/TabCompare.tsx` (new).
- Use existing `compareGroups` and `selectedRegion` state in `App.tsx` to list Left/Overlap/Right nodes and apply masks.

7) Paths (Intro Paths)
- Files: `src/ui/TabPaths.tsx` (new).
- Use `introPathsResult`, `selectedPathIndex`, `introPathsTileMask`, `nearbyExecs` already in `App.tsx`. Mask S→M→T for the chosen path.

8) Saved Filters (Canvas-scoped)
- Files: `src/ui/TabSearch.tsx` (extend or new), `src/lib/search.ts` (new).
- Save simple filters (title regex, months thresholds) to `localStorage` and re-apply on the current tile → mask + counts.

9) Metrics Overlay
- Files: `src/ui/TabMetrics.tsx` (new), optional paint-only toggle in `CanvasScene`.
- Compute degree centrality from edges; color nodes by normalized score.

Agent template prompt
```
You are implementing Module <N>: <Name> in the `open-graph/grandgraph-demo/renderer` project.

Scope:
- Files to add/edit: <files>
- Inputs: `ParsedTile.labels`, `ParsedTile.meta.nodes`, graph ref from `App.tsx`.
- Outputs: UI component + callbacks (e.g., `onMask(mask:boolean[])`, `onFocusIndex(i:number)`).

Constraints:
- Keep changes isolated to listed files and minimal `App.tsx` wiring.
- Preserve existing behaviors and commands.
- Use `--dt-*` color variables; follow inline style approach.

Acceptance:
- Manual test on bridges/person/compare tiles yields expected UI without console errors.
```

