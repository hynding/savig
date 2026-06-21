# M2 Slice 22 — On-canvas rotation handle for imported-SVG objects (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §7)
Predecessor: Slice 21 — object clipboard (merged `4ae1d0a`)

## 1. Goal

Give **imported-SVG objects** an on-canvas **rotation handle**, like vector objects
already have (Slice 12). Savig's core purpose is *animating imported SVGs*, yet every
on-canvas direct-manipulation affordance built so far — resize (S1), gradient handles
(S11), the rotation handle (S12) — is **vector-only**. An imported SVG can currently
only be rotated through the Inspector's rotation field; this slice adds the same
drag-to-rotate handle the vector objects have.

Scope is **rotation only**. On-canvas resize/scale for imported-SVG (and paths) is a
separate, mathier slice; gradient handles do not apply to imported SVGs. Non-goals
(deferred, tracked in §8): scale/resize handles for svg/path; resize handles for svg;
rotating the imported-SVG asset's own contents.

## 2. The one change — `selectedRotatable` accepts imported-SVG

The rotation handle is driven by the `selectedRotatable` memo in `Stage.tsx`. It returns
`{ obj, state, bbox, anchorX, anchorY, transform }`; the overlay render, the
`rotateHandle.ts` math (`angleDeg`/`rotationFromDrag`/`rotateHandleLocal`), the
`onRotateHandlePointerDown/Move/Up` handlers, and the rotation-keyframe commit all
consume that shape and are **completely type-agnostic**. So the entire feature is one
memo change: compute `bbox`/`anchor` for an imported-SVG object instead of bailing out.

Current guard (drops everything non-vector):

```ts
if (!obj || obj.hidden || obj.locked || !asset || asset.kind !== 'vector') return null;
```

New shape — keep the null guards, then branch by asset kind:

```ts
if (!obj || obj.hidden || obj.locked || !asset) return null;
const state = sampleObject(obj, time);
let bbox: LocalRect;
let anchorX: number;
let anchorY: number;
if (asset.kind === 'vector') {
  const sampledPath =
    asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
  bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
  const pathBox = sampledPath ? pathBounds(sampledPath) : undefined;
  const a = resolveAnchor(obj, state, asset.shapeType, pathBox);
  anchorX = a.anchorX;
  anchorY = a.anchorY;
} else if (asset.kind === 'svg') {
  // An imported-SVG object's local box is its intrinsic size; its anchor is absolute
  // (addObject seeds anchorX/Y = width/2, height/2, with no 'fraction' anchorMode), so
  // resolveAnchor returns (obj.anchorX, obj.anchorY) directly — shapeType is irrelevant.
  bbox = { x: 0, y: 0, width: asset.width, height: asset.height };
  const a = resolveAnchor(obj, state, undefined);
  anchorX = a.anchorX;
  anchorY = a.anchorY;
} else {
  return null; // audio etc. — no rotate handle
}
const transform = buildTransform(state, anchorX, anchorY);
return { obj, state, bbox, anchorX, anchorY, transform };
```

`LocalRect` is the type already used for `shapeLocalBBox`'s return in this file. No other
Stage memo changes: `selectedVector` (resize) and `selectedGradient` still early-return
for non-vector, so an imported-SVG object shows **only** the rotation handle.

## 3. Why everything else just works

- **Rotation data is universal.** `Transform2D.rotation` exists on every `SceneObject`
  and `buildTransform` applies `rotate(rot, ax, ay)` for any object — imported SVGs have
  rotated correctly via the Inspector since M1. The handle commits to `tracks.rotation`
  (a scalar track), which is valid for any object.
- **The drag math is bbox-relative.** `rotateHandleLocal(bbox, stalk)` places the handle
  above the bbox's top-center; the pivot is the resolved anchor mapped to screen space
  via the object group's CTM. Both work for an svg bbox `(0,0,width,height)` and a
  centered absolute anchor.
- **autoKey parity.** As for vectors, the handle renders whenever the object is selected,
  but a drag only commits when auto-key is on (the existing `onMove`/`onUp` guard). No
  change.

## 4. Persistence & parity

No engine/render/runtime/export/migration change. `rotation` already round-trips,
animates, and exports for imported-SVG objects. Stays v4.

## 5. Edge cases

- **Hidden / locked svg objects** are excluded by the unchanged `obj.hidden || obj.locked`
  guard, consistent with vectors (Slice 17/19).
- **autoKey off:** the handle renders but a drag no-ops (vector parity).
- **The svg asset has zero width/height** (degenerate import): bbox collapses to a point;
  the handle still renders at the anchor and rotation still applies. Not special-cased.

## 6. Testing

- **Stage unit (`Stage.test.tsx`):**
  - FLIP the existing "renders no rotate handle for a non-vector (imported svg) object"
    test → it now asserts the `rotate-handle` **is** present for a selected imported-SVG
    object.
  - ADD: dragging the rotate handle on an imported-SVG object commits a rotation keyframe
    (mirror the existing rect drag test: a 100×100 svg → anchor (50,50); start above the
    pivot, drag to the side → ~90°; assert `tracks.rotation?.[0].value`).
- **e2e (Playwright):** import `e2e/fixtures/box.svg` → click the `box.svg` asset to
  instance it (auto-selected) → Select tool → drag the `rotate-handle` in an arc → the
  object's `transform` gains a non-zero `rotate(...)` (mirror `rotate-handle.spec.ts`,
  swapping the drawn rect for the imported svg).

## 7. Decisions (delegated to implementer, recorded)

1. **Slice = on-canvas rotation handle for imported-SVG objects** (extend Slice 12).
2. **`selectedRotatable` branches by asset kind**: svg → bbox `(0,0,width,height)`, absolute anchor.
3. **Rotation only** — not resize/scale (mathier, deferred) or gradients (N/A to svg).
4. **Editor-only** — no engine/render/runtime/export/migration change.
5. **One plan.**

## 8. Deferred (tracked)

- On-canvas **scale/resize** handles for imported-SVG and path objects (the bigger
  direct-manipulation gap; opposite-corner-fixed scale math, like `applyHandleResize`).
- Gradient handles for imported SVG (N/A — imported SVGs carry their own paint).
- Editing the imported-SVG asset's internal contents.
- Multi-object rotate (M4).

## 9. Open verification (implementer confirms during TDD)

- `SvgAsset` exposes `width`/`height` (used by `addObject` already — `asset.width / 2`).
- `resolveAnchor(obj, state, undefined)` returns the absolute `(anchorX, anchorY)` for an
  imported-SVG object (its `anchorMode` is not `'fraction'`). The Stage drag test pins
  this by asserting the committed rotation value.
