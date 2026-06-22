# Savig M4 Slice 41 — Multi-object rotate (group rotate)

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4)
**Depends on:** Slice 40 (group scale: groupBounds, setObjectsTransforms, overlay gating), Slice 22 (rotate handle)

## 1. Goal

A rotate handle above the group bounding box; dragging it rotates the WHOLE
multi-selection about the group center by the same angle, in one undo step. Each
object orbits the group center AND spins by θ. Completes group transform (scale = 40).

## 2. The math (artboard space)

Rotation composes exactly (unlike non-uniform scale) — group rotate is exact for all
objects. For a group rotation by `θ` about the group center `c`, for each object:

- Its anchor point in artboard = `anchorLocal + base` (the content map sends the local
  anchor to `anchor + base` for any rotation/scale — the slice-40 identity).
- New anchor point: `p' = c + R(θ)·(p − c)`, where `R(θ) = [cos −sin; sin cos]`
  (y-down degrees, same convention as `buildTransform`'s `rotate(θ)`).
- New base: `base' = p' − anchorLocal` (anchorLocal unchanged — geometry untouched).
- New rotation: `rotation' = rotation + θ`. Scale unchanged.

`θ = rotationFromDrag(c, start, cur, 0)` (degrees) — the angular delta the pointer
sweeps about `c` (`rotateHandle.ts`, already used by the single-object handle).

## 3. Architecture (reuses slice 40)

- `groupBounds` (slice 40) gives the bbox; the group **center** = its midpoint.
- A `groupRotateRef` drag captures `c`, the start pointer (artboard), and each object's
  origin (`base x/y`, `rotation`, resolved `anchorLocal` via `resolveObjectAnchor`).
  onMove previews each object via `buildTransform`; onUp commits.
- **Generalize `setObjectsTransforms`** (slice 40): make the fields OPTIONAL
  (`{ id; x?; y?; scaleX?; scaleY?; rotation? }`) and upsert only the provided keys.
  The slice-40 scale caller still passes x/y/scaleX/scaleY; the rotate caller passes
  x/y/rotation. One generic group-transform commit.
- A `<circle data-testid="group-rotate-handle">` above the group bbox top-center
  (stalk = `ROTATE_STALK/zoom`), with a connector line; `onGroupRotatePointerDown`.

## 4. Scope (YAGNI)

**In:** the group rotate handle + drag; generalized `setObjectsTransforms` (+ rotation);
artboard-space rotate-about-center math.

**Out (deferred → next M4 slices):** snap-to-angle (shift = 15° steps); group scale +
rotate combined into a richer transform box; group shift-uniform scale / Alt-from-centre
(slice-40 deferrals); grouping; boolean ops. Locked/hidden members excluded.

**Editor-only:** no engine/export/runtime/persistence change (v4).

## 5. Implementation surface

- `src/ui/store/store.ts`: widen `setObjectsTransforms` updates to optional fields;
  upsert only the present ones (x/y/scaleX/scaleY/rotation).
- `src/ui/store/store.test.ts`: a rotation-only `setObjectsTransforms` test (existing
  scale test still passes — it provides all 4).
- `src/ui/components/Stage/Stage.tsx`: `groupRotateRef` + `onGroupRotatePointerDown`;
  `onMove`/`onUp` group-rotate branches (rotate-about-center per object); render the
  rotate handle (circle + connector) above `groupBounds` in the `group-handles` overlay.

## 6. Testing

**Store:** `setObjectsTransforms([{id, x, y, rotation}])` upserts x/y/rotation in one
commit (scale tracks untouched). The existing scale test stays green.

**Stage (`Stage.test.tsx`):** two unrotated rects (a@0..40, b@100..140); group center
(70,20). Drag the rotate handle from straight-up to the right → θ=90°: assert
`a.base=(50,−50)`, `a.rotation=90`; `b.base=(50,50)`, `b.rotation=90` (hand-verified
R(90) about (70,20)). Scale unchanged. Single-object rotate handle NOT shown in a
2-selection (already gated, slice 40).

**e2e (`group-rotate.spec.ts`):** draw two rects, Shift-select both, drag the group
rotate handle → both objects' transforms gain a non-zero rotation (assert `rotate(` in
each `[data-savig-object]` transform, or the bounding boxes change).

## 7. Risks

- **Angle units:** `rotationFromDrag` returns DEGREES; `R(θ)` for the position uses
  radians (`θ·π/180`); `rotation += θ` is degrees. Keep them straight.
- **Pivot = group center**, not a per-object anchor — the whole selection orbits one
  point.
- **Stale closures:** the onMove/onUp rotate branches read store via `getState()` +
  origins from `groupRotateRef` (slice-38 lesson); `onGroupRotatePointerDown` calls
  `setPointerCapture` (slice-40 review lesson).
- **Generalized action:** making fields optional must NOT change slice-40 behavior
  (all 4 always provided there).
