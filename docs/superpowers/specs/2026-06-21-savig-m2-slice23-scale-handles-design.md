# M2 Slice 23 — On-canvas scale handles for imported-SVG & path objects (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §8)
Predecessor: Slice 22 — svg rotate handle (merged `3d8e1cc`)

## 1. Goal

Give **imported-SVG and path objects** on-canvas **scale handles** — four corner
handles that resize the object by editing `Transform2D.scaleX/scaleY`, with the
opposite corner held fixed (rotation-aware), exactly like the rect/ellipse **resize**
handles hold their opposite corner. This closes the last on-canvas direct-manipulation
gap: rect/ellipse have geometry-resize (S1), every object can move (S1) and rotate
(S12/S22), but **imported-SVG and path objects have no on-canvas sizing at all**.

The division stays clean — every object type has exactly **one** on-canvas size
affordance: rect/ellipse → geometry **resize** (unchanged); imported-SVG & path →
transform **scale** (this slice). The two never both appear on one object.

Non-goals (deferred, §9): edge (single-axis) handles; shift-to-keep-aspect / uniform
scale; negative scale / flipping; scale handles for rect/ellipse; multi-object scale (M4).

## 2. The pure math — `applyScaleHandleDrag`

`buildTransform` composes `translate(x,y) · rotate(rot, a) · scaleAround(s, a)` (anchor
`a`), so a local point `p` maps to its parent (stage-content) position:

```
content(p) = a + R(rot) · S · (p − a) + (x, y)         S = diag(sx, sy)
```

Hold the opposite corner `o` fixed in content space and make the dragged corner `c`
follow the pointer `P` (also in content space). Solving (derivation validated by hand):

```
u  = R(−rot) · (P − a − (x0, y0)) − S0 · (o − a)        // a 2-vector
sx1 = u.x / (c.x − o.x)        sy1 = u.y / (c.y − o.y)   // c−o is the diagonal; non-zero for corners
(clamp sx1, sy1 to ≥ MIN_SCALE = 0.05; no flip in v1)
(x1, y1) = (x0, y0) + R(rot) · (S0 − S1) · (o − a)       // translation compensation, from the CLAMPED S1
```

where `R(θ)` is the 2×2 rotation matrix, `a`/`o`/`c` are **object-local** coords, and
`P`/`(x0,y0)` are **content** coords. Pure file `src/ui/components/Stage/scaleHandles.ts`:

```ts
export type ScaleHandleId = 'nw' | 'ne' | 'se' | 'sw';
export const SCALE_HANDLE_IDS: readonly ScaleHandleId[] = ['nw', 'ne', 'se', 'sw'];
export const MIN_SCALE = 0.05;

/** The four corner positions in the object's local space (respects a non-zero bbox origin, e.g. paths). */
export function scaleHandleLocalPositions(bbox: { x: number; y: number; width: number; height: number }): Record<ScaleHandleId, { x: number; y: number }>;

/** The diagonally opposite corner id (the one held fixed while dragging `id`). */
export function oppositeCorner(id: ScaleHandleId): ScaleHandleId;

export interface ScaleInput {
  corner: { x: number; y: number };     // dragged corner, local
  opposite: { x: number; y: number };   // fixed corner, local
  anchorX: number; anchorY: number;     // resolved anchor, local
  startScaleX: number; startScaleY: number;
  baseX: number; baseY: number;         // start translation, content
  rotationDeg: number;
  pointerX: number; pointerY: number;   // pointer, content
}
export interface ScaleResult { scaleX: number; scaleY: number; x: number; y: number; }
export function applyScaleHandleDrag(i: ScaleInput): ScaleResult;
```

A worked check (no rotation, bbox 100×100, anchor (50,50), start scale 1, base (0,0)):
dragging SE `(100,100)` to content `(200,200)` → `sx1=sy1=2`, `(x1,y1)=(50,50)`; the NW
corner stays at content `(0,0)` and SE lands at `(200,200)`. (This is a unit test.)

## 3. Stage — `selectedScalable` memo

A sibling to `selectedRotatable`, but **only for path & imported-SVG** (rect/ellipse →
null, they use the resize overlay):

```ts
const selectedScalable = useMemo(() => {
  if (activeTool !== 'select' || !selectedId) return null;
  const obj = project.objects.find((o) => o.id === selectedId);
  const asset = obj ? assetsById.get(obj.assetId) : undefined;
  if (!obj || obj.hidden || obj.locked || !asset) return null;
  const state = sampleObject(obj, time);
  let bbox: LocalRect;
  let anchorX: number; let anchorY: number;
  if (asset.kind === 'vector' && asset.shapeType === 'path') {
    const sampledPath = state.path ?? asset.path ?? { nodes: [], closed: false };
    bbox = shapeLocalBBox('path', state.geometry ?? {}, sampledPath);
    const a = resolveAnchor(obj, state, 'path', pathBounds(sampledPath));
    anchorX = a.anchorX; anchorY = a.anchorY;
  } else if (asset.kind === 'svg') {
    bbox = { x: 0, y: 0, width: asset.width, height: asset.height };
    const a = resolveAnchor(obj, state, undefined);
    anchorX = a.anchorX; anchorY = a.anchorY;
  } else {
    return null; // rect/ellipse (resize) and audio — no scale handle
  }
  const transform = buildTransform(state, anchorX, anchorY);
  return { obj, state, bbox, anchorX, anchorY, transform };
}, [activeTool, selectedId, project.objects, assetsById, time]);
```

(`shapeLocalBBox('path', …)` returns the path's bbox; for svg the local box is its
intrinsic `width×height` at origin — same facts the S22 rotate handle relies on.)

## 4. Stage — overlay + drag machinery

Mirrors the resize-handle overlay and the rotate/gradient drag machines:

- **Overlay:** `{selectedScalable && <g ref={scaleGroupRef} transform={selectedScalable.transform} data-testid="scale-handles">…}` rendering a circle per corner at `scaleHandleLocalPositions(bbox)[id]`, `data-testid="scale-handle-<id>"`, `onPointerDown={(e) => onScaleHandlePointerDown(id, e)}`. (Same circle radius/zoom-scaling as the resize handles.)
- **`scaleRef`** holds `{ id, snapshot, last }`. `onScaleHandlePointerDown(id, e)`:
  `e.stopPropagation()`; if `!autoKey` return (edit parity); snapshot
  `{ objId, state, corner, opposite, anchorX, anchorY, startScaleX, startScaleY, baseX, baseY, rotationDeg }`
  from `selectedScalable` — `state` is the sampled RenderState at drag start (used to rebuild the
  preview transform); `startScaleX/Y`, `baseX/Y`, `rotationDeg` are read off `state` (`state.scaleX`,
  `state.x`, `state.rotation`, …); `corner`/`opposite` via `scaleHandleLocalPositions`/`oppositeCorner`.
- **`onMove`** (the existing window `pointermove`): a `scaleRef` branch BEFORE the resize/drag
  branches — `const local = clientToLocal(e)` (content coords); `r = applyScaleHandleDrag({ …snap, pointerX: local.x, pointerY: local.y })`; `scaleRef.last = r`; imperative preview — set the object node's `transform` to `buildTransform({ ...snap.state, scaleX: r.scaleX, scaleY: r.scaleY, x: r.x, y: r.y }, snap.anchorX, snap.anchorY)` AND set `scaleGroupRef`'s transform to the same (so the handles track). No geometry attrs change (scale is a transform).
- **`onUp`** (window `pointerup`): a `scaleRef` branch — `const snap = scaleRef.current?.snapshot; const last = scaleRef.current?.last; scaleRef.current = null; if (last) { s.selectObject(snap.objId); s.setProperties({ scaleX: last.scaleX, scaleY: last.scaleY, x: last.x, y: last.y }); }` — one `commit` (StrictMode-safe: ref nulled before commit).

`setProperties` already commits `scaleX/scaleY/x/y` (all `AnimatableProperty`) as one undo
step (auto-keys at the playhead when auto-key is on — the same path resize uses).

## 5. Coexistence with the rotation handle

A selected imported-SVG/path object shows **both** the scale corner handles and the
rotate handle (S22) — exactly as a rect shows resize handles + the rotate handle. They
are separate testid'd elements with separate `onPointerDown`; no interaction.

## 6. Persistence & parity

No engine/render/runtime/export/migration change. `scaleX/scaleY/x/y` already round-trip,
animate, and export. Stays v4. The slice is editor-only chrome over existing Transform2D
data.

## 7. Edge cases

- **Hidden/locked** objects → excluded by the unchanged `obj.hidden || obj.locked` guard.
- **autoKey off:** the handles render, but a drag no-ops (parity with resize/rotate).
- **MIN_SCALE clamp:** dragging a corner toward/past the anchor clamps each axis to 0.05
  (no zero/negative/flip in v1); the opposite corner stays fixed at the clamped scale.
- **Degenerate bbox** (zero-size path/svg): corners coincide; `c−o` could be 0 → guard
  each axis (if `c.x===o.x` keep `startScaleX`, likewise y). Handles still render.
- **Rect/ellipse** never get scale handles (they have resize); only the resize overlay
  shows for them — unchanged.

## 8. Decisions (delegated to implementer, recorded)

1. **Slice = on-canvas scale handles** (4 corners, opposite-corner-fixed, rotation-aware,
   per-axis) for imported-SVG & path objects, editing `Transform2D.scaleX/scaleY` (+ x/y).
2. **Pure `applyScaleHandleDrag`** + corner helpers in `scaleHandles.ts`; the math above.
3. **`selectedScalable` memo** (svg + path only) + overlay + `scaleRef` drag machine
   mirroring resize/rotate; commit via `setProperties({scaleX,scaleY,x,y})`.
4. **Editor-only** — no engine/render/runtime/export/migration change.
5. **One plan.**

## 9. Deferred (tracked)

- Edge (single-axis) scale handles; shift-to-keep-aspect / uniform scale.
- Negative scale / flipping (clamp ≥ MIN_SCALE for now).
- On-canvas scale for rect/ellipse (they have geometry-resize; a unified "resize OR scale"
  model is out of scope).
- Multi-object scale; scaling a group (M4).

## 10. Testing

- **Pure unit (`scaleHandles.test.ts`):**
  - `applyScaleHandleDrag`: SE corner, no rotation, drag `(100,100)→(200,200)` on a
    100×100 bbox / anchor (50,50) / scale 1 / base (0,0) → `{scaleX:2, scaleY:2, x:50, y:50}`
    (and the NW corner, recomputed via the result, lands back at content `(0,0)`).
  - a **rotated** case (rotationDeg 90) keeps the opposite corner fixed in content space
    (assert by recomputing `content(opposite)` from the result ≈ the start content position).
  - MIN_SCALE clamp: a drag that would scale below 0.05 clamps to 0.05.
  - `scaleHandleLocalPositions` (respects bbox origin) + `oppositeCorner` mapping.
- **Stage unit (`Stage.test.tsx`):**
  - a selected imported-SVG object renders `scale-handles` + the four `scale-handle-<id>`;
  - a selected **path** object renders the scale handles;
  - a selected **rect** renders **no** `scale-handles` (it has `resize-handles`);
  - dragging a corner on an imported-SVG object commits `scaleX`/`scaleY` (`stubIdentityCTM`;
    assert `tracks.scaleX?.[0].value` changed from 1).
- **e2e (Playwright):** import `e2e/fixtures/box.svg` → instance → Select → reposition into
  the stage interior (Inspector x/y, as in the S22 e2e) → drag a `scale-handle-se` corner
  outward → the object's `transform` `scale(...)` is no longer `scale(1, 1)`.
