# Savig M4 Slice 43 — Align & Distribute (multi-selection)

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4 multi-object toolkit)
**Depends on:** Slices 36–42 (multi-select, group transform via `setObjectsTransforms`, grouping)

## 1. Goal

Align and distribute the multi-selection: 6 align ops (left / h-center / right / top /
v-center / bottom) and 2 distribute ops (horizontal / vertical equal-gap spacing). A
staple editor feature that completes the M4 multi-object toolkit. Each op is ONE undo
step and reuses the existing `setObjectsTransforms`.

## 2. Why this is low-risk

Alignment is pure axis-aligned-bounding-box (AABB) arithmetic. Because `transformedAABB`
adds the base translation AFTER scale/rotation, translating an object by `dx` shifts its
whole AABB by `dx` — so `newX = sampledX + (targetEdge − aabb.minX)` is EXACT for any
rotation/scale, no solving. The result is committed through `setObjectsTransforms`
(slices 40/41): already multi-object, one-undo-step, locked-skipping. No engine, export,
runtime, or persistence change.

## 3. Behavior

Computed over the selected, NON-locked, NON-hidden objects' stage AABBs:

- **Align left/right:** every object's AABB min/max X → the group's min/max X.
- **Align h-center:** every object's AABB center X → the group center X. (Analogous for
  top/bottom/v-center on Y.)
- **Distribute horizontal (≥3):** sort by AABB min X; pin the extreme edges (first.minX,
  last.maxX); place the rest so the GAPS between consecutive boxes are equal
  (`gap = ((last.maxX − first.minX) − Σwidths) / (n − 1)`). Analogous for vertical.
- Each op writes only the changed axis (x for horizontal ops, y for vertical), skipping
  near-zero deltas (no spurious keyframes), in ONE `setObjectsTransforms` commit.
- Gated on `autoKey` (consistent with nudge/group-transform). Align no-op for < 2
  movable objects; distribute no-op for < 3.

## 4. Data model & refactor

No data change. One focused refactor: move the AABB helpers `resolveObjectAnchor` and
`objectAABB` out of the 1800-line `Stage.tsx` into `snapping.ts` (where `transformedAABB`
/ `groupBBox` already live), exported, and import them back into `Stage.tsx`. This makes
the per-object stage AABB reusable by the align logic. Behavior-preserving.

## 5. Implementation surface

- `src/ui/components/Stage/snapping.ts`: receive `resolveObjectAnchor` + `objectAABB`
  (exported). New pure `computeAlign(items, edge)` / `computeDistribute(items, axis)` go
  in a sibling `align.ts` (keeps `snapping.ts` focused on AABB primitives).
  - `AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'`
  - `DistributeAxis = 'h' | 'v'`
  - `AlignItem = { id: string; aabb: AABB; x: number; y: number }`
  - returns `{ id: string; x?: number; y?: number }[]` (only changed entries/axis).
- `src/ui/components/Stage/Stage.tsx`: import the two moved helpers from `./snapping`.
- `src/ui/store/store.ts`: actions `alignSelected(edge)` / `distributeSelected(axis)`.
  Gather items (sample each selected non-locked, non-hidden object's AABB + x/y at the
  frame-snapped time), call the pure fn, feed `setObjectsTransforms`.
- `src/ui/components/Inspector/Inspector.tsx`: an align/distribute button row in the
  multi-state (> 1 selected); the two Distribute buttons disabled when < 3 selected.
  Each button has an `aria-label` (e.g. "Align left", "Distribute horizontally").

## 6. Scope (YAGNI)

**In:** 6 align + 2 distribute ops; pure geometry + store actions + Inspector buttons;
lift the AABB helpers into `snapping.ts`.

**Out (deferred):** align to a "key object"/last-selected; align to the artboard/canvas;
distribute-by-centers (vs equal-gap); spacing-value input; alignment of a nested group as
one unit (groups already move together, but align treats each member individually this
slice); snap/smart-distance guides during align.

## 7. Testing

- **`align.test.ts` (pure):** each align edge with 2–3 boxes (verify target edge/center);
  `computeDistribute('h')` on 3 UNEQUAL-width boxes → equal gaps, extremes fixed; < 3 →
  empty; near-zero deltas filtered.
- **`snapping.test.ts`:** a basic `objectAABB` test (locks the moved helper).
- **`store.test.ts`:** `alignSelected('left')` makes all selected AABB minX equal;
  `distributeSelected('h')` equalizes gaps; a LOCKED member is not moved and does not
  anchor; `autoKey` off → no-op; one undo step (`history.past` +1).
- **`Inspector.test.tsx`:** the multi-state shows the align buttons; Distribute disabled
  for 2, enabled for 3; clicking "Align left" aligns.
- **e2e (`align-distribute.spec.ts`):** draw 3 rects at different x/y; select all; click
  "Align top" → all share a top edge (equal `boundingBox().y`); click "Distribute
  horizontally" → equal gaps between consecutive boxes.

## 8. Risks

- **Refactor blast radius:** moving `objectAABB`/`resolveObjectAnchor` touches `Stage.tsx`
  imports; the existing Stage + snapping suites guard behavior. Mechanical, no logic
  change.
- **Frame-snap consistency:** sample the AABB and x/y at the SAME frame-snapped time that
  `setObjectsTransforms` writes to, so the computed delta matches the committed keyframe.
- **Locked/hidden:** excluded from BOTH the reference bbox and the writes (consistent with
  "locked objects don't participate").
