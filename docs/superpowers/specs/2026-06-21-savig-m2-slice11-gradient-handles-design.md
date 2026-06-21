# M2 Slice 11 — On-Canvas Gradient Handles (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §9)
Predecessor: Slice 10 — stroke dash / self-drawing (merged `8dbd0af`)

## 1. Goal

Let a user reshape a vector object's gradient **directly on the canvas** by
dragging handles, instead of (or in addition to) the Inspector's linear-angle
field. This is the **only** way to control **radial** gradient geometry
(`cx/cy/r/fx/fy`) — the Inspector exposes none of it today — and a far more
intuitive way to set a linear gradient's direction and length.

It completes the gradient feature area: **static** (Slice 8) → **animated**
(Slice 9) → **direct-manipulation** (this slice).

Non-goals (deferred, tracked in §10): a fill-vs-stroke handle toggle (v1 edits
fill-first), `gradientTransform`/skew, `userSpaceOnUse`, snapping, an
ellipse-radius pair (SVG radial `r` is a single scalar), on-canvas rotate/scale
transform handles (separate M1 thread), boolean ops / multi-select (M4).

## 2. Key property: editor-only chrome, zero pipeline change

Gradient handles **edit existing gradient data** through the existing
`setVectorGradient` store action and are **never exported** (like the motion-path
guide overlay). The gradient data already round-trips through render / runtime /
export / persistence (Slices 8–9). Therefore this slice has:

- **no** change to `renderShape`/`renderDocument`/`frame`/the runtime bundle,
- **no** persistence migration (project stays v4),
- only **pure geometry helpers** + a **Stage overlay** + **drag wiring**.

## 3. Coordinate model

A gradient uses `gradientUnits="objectBoundingBox"`: its coordinates are
fractions (0..1) of the shape's **object-local bounding box**. The Stage already
draws overlays in object-local space inside a `<g transform={…}>` and maps
client↔local via `group.getScreenCTM().inverse()` (the resize-handle technique).

Handle position in object-local space:

```
handle_local.x = bbox.x + fraction.x * bbox.width
handle_local.y = bbox.y + fraction.y * bbox.height
```

and the inverse (drag):

```
fraction.x = (local.x - bbox.x) / bbox.width    // clamped to [0,1], 0 if width==0
fraction.y = (local.y - bbox.y) / bbox.height
```

The object's bounding box in object-local coords (`bbox`):

| shapeType | bbox |
|-----------|------|
| `rect`    | `{ x: 0, y: 0, width, height }` |
| `ellipse` | `{ x: 0, y: 0, width: 2·radiusX, height: 2·radiusY }` |
| `path`    | `pathBounds(sampledPath)` (may have non-zero x/y after node edits) |

## 4. Pure helpers (new `src/engine/gradientHandles.ts`)

```ts
export interface LocalRect { x: number; y: number; width: number; height: number }

export type GradientHandleId = 'start' | 'end' | 'center' | 'radius' | 'focal';

export interface GradientHandle {
  id: GradientHandleId;
  x: number;   // object-local coords
  y: number;
}

/** Handle positions in object-local space for the gradient over `bbox`.
 *  Linear -> [start, end]; Radial -> [center, radius, focal].
 *  The radius handle sits at center + (r, 0) in fraction space (rightward edge).
 *  The focal handle defaults to the center when fx/fy are undefined. */
export function gradientHandlePositions(g: Gradient, bbox: LocalRect): GradientHandle[];

/** Pure update: drag `handleId` to object-local point `local`, return a new
 *  gradient with the corresponding coordinate(s) updated (fractions clamped to
 *  [0,1]; r clamped to >= 0). Unknown handle/gradient combos return `g` unchanged. */
export function applyGradientHandleDrag(
  g: Gradient,
  handleId: GradientHandleId,
  local: { x: number; y: number },
  bbox: LocalRect,
): Gradient;
```

Helper, also in `gradientHandles.ts` (or reuse if one exists):

```ts
/** The object-local bbox a gradient's objectBoundingBox normalizes against. */
export function shapeLocalBBox(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  path?: PathData,
): LocalRect;
```

`shapeLocalBBox` returns `{x:0,y:0,width:0,height:0}` defensively when geometry is
missing. For `path` it calls `pathBounds(path ?? emptyPath)`.

**Math details:**
- **Linear** `start` → sets `x1,y1`; `end` → sets `x2,y2` (each = fraction of drag point).
- **Radial** `center` → sets `cx,cy` only; `fx,fy` are left unchanged (simplest,
  predictable — the focal handle is dragged separately).
- **Radial** `radius` → `r = clamp0(distanceFraction(center, dragPoint))` where the
  distance is measured in fraction space: `fx = (local.x-bbox.x)/bbox.width - cx`,
  `fy = (local.y-bbox.y)/bbox.height - cy`, `r = hypot(fx, fy)` clamped `>= 0`.
- **Radial** `focal` → sets `fx,fy` (fraction of drag point, clamped [0,1]).

All pure, framework-free, fully unit-tested.

## 5. Stage overlay + drag (`Stage.tsx`)

### 5.1 Selection memo

A new `selectedGradient` memo (parallel to `selectedVector`), active when the
**select tool** is active and the selected vector object has a gradient:

```ts
// edits fill gradient if present, else stroke; reflects the SAMPLED gradient.
const sampled = sampleObject(obj, time);
const property = (sampled.fillGradient ?? asset.style.fillGradient) ? 'fill' : 'stroke';
const gradient = property === 'fill'
  ? (sampled.fillGradient ?? asset.style.fillGradient)
  : (sampled.strokeGradient ?? asset.style.strokeGradient);
// null when neither exists
const bbox = shapeLocalBBox(asset.shapeType, sampled.geometry ?? {}, sampledPath);
const transform = buildTransform(state, anchorX, anchorY); // same as resize/node overlays
```

(For a path, `sampledPath` is the morph-sampled path else `asset.path`, mirroring
the existing path-overlay resolution; the anchor uses `pathBounds`.)

### 5.2 Render

A `<g ref={gradientHandleGroupRef} transform={selectedGradient.transform}
data-testid="gradient-handles">` containing, for each handle from
`gradientHandlePositions(drag ?? gradient, bbox)`:
- a thin connector line (start→end for linear; center→radius and center→focal for
  radial) with `pointer-events: none`,
- a draggable circle per handle (`data-testid={\`gradient-handle-${id}\`}`),
  sized `HANDLE_SIZE / zoom` (matching the resize handles).

The shape's gradient `<GradientEl>` renders from `drag ?? sampled gradient` so the
fill updates live during a drag.

### 5.3 Drag

Mirror the resize-handle machinery (a `gradientDragRef`), StrictMode-safe:
- `onGradientHandlePointerDown(id, e)`: capture pointer; store
  `gradientDragRef = { id, startGradient: gradient, property }`; set a
  `gradientDrag` state = `gradient` (drives the live preview).
- pointer move (the existing window/SVG move handler, extended): map
  `client → object-local` via `gradientHandleGroupRef.getScreenCTM().inverse()`;
  `next = applyGradientHandleDrag(startGradient, id, local, bbox)`; `setGradientDrag(next)`.
- pointer up: read `gradientDragRef` (null it immediately to dedupe under
  StrictMode), and if present call `setVectorGradient(property, finalGradient)`
  **once** (autoKey ON → a gradient keyframe; OFF → static), then clear
  `gradientDrag`. One undo step.

> The existing pointer-move/up handlers already branch on `resizeRef` / pen / pathTools
> drags; add a `gradientDragRef` branch alongside.

## 6. Interaction with existing overlays

- Gradient handles render under the **select** tool. The resize handles also render
  under select for rect/ellipse. They coexist: resize handles sit on the bbox
  corners/edges; gradient handles sit at the gradient coordinates (interior). Both
  are small; to avoid a pick-fight, the gradient handles render **after** (on top of)
  the resize handles, and gradient-handle hit areas take precedence (their
  `onPointerDown` calls `stopPropagation`).
- Node-tool path overlay is unaffected (gradient handles are select-tool only).

## 7. Persistence & parity

No persistence change (v4). No render/runtime/export change — the existing
gradient export/runtime parity tests already cover the data the handles edit. The
new pure helpers get their own unit tests (§8).

## 8. Testing

- **Engine unit (`gradientHandles.test.ts`):**
  - `shapeLocalBBox`: rect (0,0,w,h), ellipse (0,0,2rx,2ry), path (pathBounds).
  - `gradientHandlePositions`: linear → start/end at the right local coords; radial
    → center/radius/focal (focal defaults to center when absent).
  - `applyGradientHandleDrag`: linear start/end set x1y1/x2y2; radial center sets
    cx/cy (fx/fy unchanged); radius sets r = fraction distance; focal sets fx/fy;
    fractions clamp to [0,1]; r clamps `>= 0`; width==0 → 0 fraction (no NaN).
- **Stage unit (`Stage.test.tsx`):**
  - selecting a rect with a fill gradient renders `gradient-handles` with
    `gradient-handle-start`/`-end` (linear) testids;
  - a radial gradient renders `-center`/`-radius`/`-focal`;
  - a dragging test using the identity-CTM stub (the Slice-6 `stubIdentityCTM`
    helper) → pointerdown on a handle, move, up → asserts `setVectorGradient`
    committed a gradient with the expected updated coord (autoKey off → static).
- **e2e (Playwright, real chromium):** draw a rect → set fill = linear gradient →
  drag the `end` handle → assert the rendered `<linearGradient>` `x2`/`y2` changed
  (and, with autoKey, that a gradient keyframe appears on the Timeline). Keep it to
  the editor-side assertion (handles are not exported); optionally export and assert
  the def reflects the dragged coords.

## 9. Decisions (delegated to implementer, recorded)

1. **Slice = on-canvas gradient handles** (completes gradients; fills the radial-geometry
   gap; single-object). Boolean ops/multi-select = M4; rotate handle = separate thread.
2. **Linear:** start+end. **Radial:** center+radius+focal. objectBoundingBox units.
3. **Edit fill-gradient-first, else stroke**; reflect the sampled gradient.
4. **center moves cx/cy only** (fx/fy unchanged) — simplest, predictable.
5. **One undo step per drag** via `setVectorGradient` on release (autoKey-aware).
6. **One plan** — pure helpers + Stage overlay/drag; no pipeline boundary to split on.

## 10. Deferred (tracked)

- Fill-vs-stroke handle toggle (when an object has both gradients).
- `gradientTransform` / skew handles; `userSpaceOnUse`; spreadMethod.
- Snapping handles to bbox center/edges/other handles.
- On-canvas rotate/scale transform handles (M1-transform polish, high value, separate slice).
- Boolean ops; multi-select / grouping (M4).
