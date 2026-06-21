# M2 Slice 12 — On-Canvas Rotation Handle (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §9)
Predecessor: Slice 11 — on-canvas gradient handles (merged `091c419`)

## 1. Goal

Let a user **rotate a vector object by dragging an on-canvas handle** — a stalk +
circle above the object's bounding box, as in every design tool — instead of
typing a number in the Inspector's `rotation` field. This is the last major
direct-manipulation gap: move (drag) and geometry-resize (Slice 1) and gradient
handles (Slice 11) all exist on-canvas, but rotation has no on-canvas control.

Non-goals (deferred, tracked in §10): on-canvas **scale** handles (overlap
geometry-resize semantics for vectors — separate concern); rotating **imported
SVG** objects (needs the absolute-anchor + asset-intrinsic-bbox path); Shift-to-snap
(15° increments); a rotation-cursor affordance.

## 2. Key property: editor chrome over real transform data

Rotation is a core, fully-supported field (`Transform2D.rotation` / the `rotation`
keyframe track, since M1 — `buildTransform`, `interpolate` with shortest/raw mode,
export, runtime all handle it). The handle simply **edits that data** through the
existing `setProperty('rotation', …)` store action. Therefore — exactly like
gradient handles (Slice 11) — this slice has:

- **no** change to engine render / runtime / export / persistence,
- **no** migration (project stays v4), **no** bundle regen,
- only a **pure geometry helper** + a **Stage overlay** + **drag wiring**.

## 3. The rotation pivot is a fixed point

`buildTransform` emits:
```
translate(x,y) rotate(rot, ax, ay) translate(ax,ay) scale(sx,sy) translate(-ax,-ay)
```
Working through the composition, the **object-local point `(ax, ay)` maps to the
rotation pivot in screen space, invariantly under `rot`** (rotation fixes its own
center). So the drag captures `pivot_screen` **once at pointer-down** by mapping
`(ax, ay)` through the overlay group's `getScreenCTM()`, and reuses it unchanged
for the whole drag — even as the object is imperatively rotated during the preview.

`(ax, ay)` are the resolved anchor coordinates from `resolveAnchor(obj, state,
shapeType, pathBox?)` — the same values `buildTransform` already uses.

## 4. Pure helper (new `src/ui/components/Stage/rotateHandle.ts`)

(Stage-local geometry, sibling to `resizeHandles.ts`/`drawGeometry.ts`.)

```ts
export interface Pt { x: number; y: number }

/** Screen-space angle (degrees) from pivot to point. */
export function angleDeg(pivot: Pt, p: Pt): number;

/** New rotation for a handle drag: start rotation + the angular delta the pointer
 *  swept around the pivot (cur vs start). Pure; relative so there is no jump if the
 *  grab point is off-center. */
export function rotationFromDrag(pivot: Pt, start: Pt, cur: Pt, startRotationDeg: number): number;
//   = startRotationDeg + angleDeg(pivot, cur) - angleDeg(pivot, start)

/** The connector base (bbox top-center) and the handle position (stalk above it),
 *  in object-local coordinates. */
export function rotateHandleLocal(
  bbox: { x: number; y: number; width: number; height: number },
  stalk: number,
): { base: Pt; handle: Pt };
//   base = { x: bbox.x + bbox.width/2, y: bbox.y }; handle = { base.x, base.y - stalk }
```

Rotation is NOT wrapped/normalized — `rotationFromDrag` may return any degree value
(e.g. spinning past 360), matching the Inspector field; the track's shortest/raw
mode governs interpolation.

## 5. Stage overlay + drag (`Stage.tsx`)

### 5.1 Selection memo

A new `selectedRotatable` memo (active under the **select** tool when a vector
object — rect/ellipse/**path** — is selected). Unlike `selectedVector` (which
excludes paths), this includes paths:

```ts
const state = sampleObject(obj, time);
const sampledPath = asset.shapeType === 'path' ? state.path ?? asset.path ?? EMPTY : undefined;
const bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath); // reuse Slice 11
const pathBox = sampledPath ? pathBounds(sampledPath) : undefined;
const anchor = resolveAnchor(obj, state, asset.shapeType, pathBox);
const transform = buildTransform(state, anchor.anchorX, anchor.anchorY);
return { obj, state, bbox, anchorX: anchor.anchorX, anchorY: anchor.anchorY, transform };
// null when not a selected vector under the select tool
```

### 5.2 Render

A `<g ref={rotateHandleGroupRef} transform={selectedRotatable.transform}
data-testid="rotate-handle-overlay">` in object-local space, containing:
- a stalk `<line>` from `base` to `handle` (`pointer-events: none`),
- a draggable `<circle data-testid="rotate-handle">` at `handle`, sized
  `HANDLE_SIZE / zoom` (matching the resize/gradient handles).

`stalk = ROTATE_STALK / zoom` (e.g. `ROTATE_STALK = 24`).

### 5.3 Drag

Mirror the resize/gradient drag machinery (a `rotateRef`), StrictMode-safe:
- `onRotateHandlePointerDown(e)`: `if (!selectedRotatable) return; stopPropagation;`
  set pointer capture. Map the pivot ONCE:
  `pivot = (rotateHandleGroupRef CTM).transform(anchorX, anchorY)` (in screen coords).
  Store `rotateRef = { objId, pivot, start: {x: e.clientX, y: e.clientY},
  startRotation: state.rotation, last: undefined }`.
- pointer MOVE: `next = rotationFromDrag(pivot, start, {x,y}, startRotation)`;
  `rotateRef.last = next`; **imperative preview** — build
  `previewTransform = buildTransform({ ...state, rotation: next }, anchorX, anchorY)`
  and set it on BOTH the object node (`nodes.get(objId)`) AND the overlay group
  (`rotateHandleGroupRef`), so the handle rotates with the shape.
- pointer UP: read `rotateRef` (null it immediately, StrictMode-safe). If
  `last !== undefined` (a move happened) commit once:
  `selectObject(objId); setProperty('rotation', last)` (autoKey ON → a rotation
  keyframe at the playhead; OFF → static `base.rotation`). One undo step.

> Works regardless of autoKey (unlike resize, which is autoKey-gated): rotation via
> `setProperty('rotation')` with autoKey off sets `base.rotation`, exactly as the
> Inspector rotation field does.

> The `pivot`, `start`, `startRotation` are snapshotted at pointer-down; the
> imperative preview uses the snapshotted `state` so concurrent re-renders don't
> drift the drag. The commit reads `rotateRef.last` from the ref (not React state),
> so there is no stale-closure risk.

### 5.4 No-op guard

If the pointer goes down and up with no move, `rotateRef.last` is `undefined` →
no commit (no spurious undo entry).

## 6. Interaction with existing overlays

- The rotate handle sits **above** the bbox (outside it), spatially clear of the
  resize handles (on the bbox, rect/ellipse only) and gradient handles (interior).
- It renders **after** the resize + gradient overlays (on top); its pointer-down
  calls `stopPropagation` so the object-move drag does not also fire.
- Paths get a rotate handle but no resize handles (consistent: path geometry is
  edited via the node tool).

## 7. Persistence & parity

No persistence/render/runtime/export change. Rotation already round-trips
(M1). The new pure helper gets unit tests (§8); the editor wiring gets Stage
unit + e2e coverage.

## 8. Testing

- **Unit (`rotateHandle.test.ts`):** `angleDeg` (0°/90°/180° from a pivot);
  `rotationFromDrag` (start rotation + swept delta; relative — a 90° sweep adds 90);
  `rotateHandleLocal` (base at bbox top-center, handle a stalk above).
- **Stage unit (`Stage.test.tsx`):**
  - selecting a rect renders `rotate-handle-overlay` + `rotate-handle`; a path too;
    a non-vector (imported SVG) renders none.
  - a drag test using the `stubIdentityCTM` helper: pointerdown on `rotate-handle`,
    move to sweep ~90° around the pivot, up → asserts `setProperty('rotation', …)`
    committed the expected rotation (autoKey off → `base.rotation` ≈ start+90).
- **e2e (Playwright, real chromium):** draw a rect → drag the rotate handle around
  the center → assert the object `<g data-savig-object>`'s `transform` now contains a
  non-zero `rotate(`. Optionally assert the Inspector `rotation` field reflects it.

## 9. Decisions (delegated to implementer, recorded)

1. **Slice = on-canvas rotation handle** (last direct-manipulation gap; universal;
   reuses the resize-overlay CTM pattern + Slice-11 `shapeLocalBBox`).
2. **Vector objects (rect/ellipse/path)**, select tool; stalk + circle above bbox.
3. **Pivot = resolved anchor `(ax,ay)`** mapped to screen at pointer-down (rotation-invariant).
4. **Relative drag**: `rotationFromDrag` adds the swept angular delta to the start
   rotation; imperative preview on object node + overlay group; commit `setProperty('rotation')` on release; works with autoKey on/off; no-op clicks skipped.
5. **No snapping** (Shift-snap deferred).
6. **One plan** — pure helper + Stage overlay/drag + e2e.

## 10. Deferred (tracked)

- On-canvas **scale** handles (transform scaleX/scaleY) — distinct from geometry resize.
- Rotating **imported SVG** objects (absolute anchor + asset-intrinsic bbox).
- **Shift-to-snap** to 15° increments; live angle readout near the cursor.
- A rotate **cursor** affordance on hover.
- `pointercancel` leaving the drag ref dangling — a pre-existing pattern shared by
  `resizeRef`/`dragRef`/`gradientDragRef`; a coordinated fix for all of them later.
- Boolean ops; multi-select / grouping (M4).
