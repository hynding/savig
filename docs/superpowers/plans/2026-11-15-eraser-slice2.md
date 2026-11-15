# Eraser — slice 2 plan

Spec: `specs/2026-11-15-paint-bucket-eraser-design.md` (Eraser section).

1. Engine `geom/eraser.ts`: `eraserArea(points, size)` (round dab or round-capped sweep) and
   `applyEraser(project, points, size, time, {newId?})` returning `{objects, assets, erased,
   deleted, skipped}`. Per vector leaf the sweep is mapped into the shape's own coordinates
   (inverse group chain + object transform), so the cut is exact under rotation/scale/groups.
   Filled shapes lose fill area (stroke retraces the edges); stroke-only shapes are outlined
   first; rect/ellipse become paths; anchor pinned absolute; shape/primitive/trim tracks dropped;
   shared assets forked; erased-away shapes removed (mask links unlinked). Locked, shape-keyed
   and animated-size shapes are skipped.
2. Editor state: `ToolMode 'eraser'`, `eraserSize` (1..500, default 20) + `setEraserSize`,
   `eraseAlong(points)` (one commit; prunes assets of deleted shapes; toast when only skipped
   shapes were touched).
3. UI: `tool.eraser` on X, palette button + icon, "Eraser options" size field, Stage drag via
   `useEraserTool` with a round translucent preview stroke.
4. Agent: core `erase`, MCP `erase`.
5. Tests: engine, store, VM, registry, core raster, MCP, e2e `eraser.spec.ts`.
