# M2 Slice 26 — Edge scale handles (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §6)
Predecessor: Slice 25 — drag-to-retime keyframes (merged `98797b0`)

## 1. Goal

Add the four **edge** scale handles (n/e/s/w) to the on-canvas scale overlay for
imported-SVG and path objects, completing Slice 23 (which shipped the four corners) to
the same **8-handle** layout the rect/ellipse resize handles already use. An edge handle
scales a **single axis** (the other axis is unchanged), holding the opposite edge fixed.

This is a focused completion: it gives svg/path objects single-axis stretch (you can only
free-scale via corners today) and brings the scale overlay to visual parity with resize.

Non-goals (deferred, §7): shift-to-keep-aspect / uniform scale (a separate cross-cutting
nicety that would apply to resize too — resize has no uniform mode either); edge handles
for rect/ellipse (they use geometry-resize); negative scale / flipping (clamp ≥ MIN_SCALE).

## 2. The change is almost entirely in the pure helper

`applyScaleHandleDrag` already supports single-axis scaling: its `dcx === 0 ? startScaleX`
and `dcy === 0 ? startScaleY` guards keep an axis unchanged when the dragged and opposite
handles share that coordinate — which is exactly the case for an edge handle. So the math
is **unchanged**; only the handle set + positions + opposite mapping grow.

`src/ui/components/Stage/scaleHandles.ts`:

```ts
export type ScaleHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const SCALE_HANDLE_IDS: readonly ScaleHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
// MIN_SCALE unchanged.

export function scaleHandleLocalPositions(
  bbox: { x: number; y: number; width: number; height: number },
): Record<ScaleHandleId, { x: number; y: number }> {
  const { x, y, width, height } = bbox;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: y + height / 2 },
    se: { x: x + width, y: y + height },
    s: { x: x + width / 2, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: y + height / 2 },
  };
}

// Renamed from `oppositeCorner` — it now maps edges too (the handle kept fixed during a drag).
export function oppositeHandle(id: ScaleHandleId): ScaleHandleId {
  return ({ nw: 'se', se: 'nw', ne: 'sw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' } as const)[id];
}
```

`applyScaleHandleDrag` is unchanged (its doc comment's "corner" wording becomes "handle",
since it now also drives edge handles). The `ScaleInput` `corner`/`opposite` fields keep
their names (they are just "the dragged handle's local position" / "the opposite handle's
local position").

## 3. Stage — auto-renders, one rename

`Stage.tsx` already maps `SCALE_HANDLE_IDS` to render a `<rect data-testid="scale-handle-<id>">`
per id, and `onScaleHandlePointerDown(id)` already looks up `scaleHandleLocalPositions(bbox)[id]`
and `oppositeCorner(id)`. So:

- Adding the four edges to `SCALE_HANDLE_IDS` **auto-renders** four more handles (now 8,
  testids `scale-handle-n` / `-e` / `-s` / `-w`).
- The drag machinery is **id-agnostic** — it already passes the dragged handle's position
  and `oppositeHandle(id)`'s position into `applyScaleHandleDrag`, which scales one axis
  for an edge.
- The only edit is renaming the imported `oppositeCorner` → `oppositeHandle` (import + the
  one call site).

No new overlay logic, no drag-machine change. An edge drag commits `setProperties({scaleX,
scaleY, x, y})` exactly as a corner drag does — one of scaleX/scaleY simply equals its
start value.

## 4. Persistence & parity

No engine/render/runtime/export/migration change. Reuses the Slice-23 scale infrastructure
(`Transform2D.scaleX/scaleY` + x/y compensation). Stays v4.

## 5. Edge cases

- **Single-axis fixed:** dragging `e`/`w` keeps `scaleY` at its start (the `dcy === 0`
  guard); `n`/`s` keep `scaleX`. The opposite EDGE stays fixed in content space (same
  opposite-handle-fixed math as corners).
- **MIN_SCALE clamp** and **rotation-awareness** are inherited unchanged from
  `applyScaleHandleDrag`.
- **Coexistence:** a selected svg/path now shows 8 scale handles + the rotate handle (S22);
  rect/ellipse still show 8 resize handles + rotate — visually consistent. The scale and
  resize overlays remain mutually exclusive (svg/path → scale; rect/ellipse → resize).

## 6. Decisions (delegated to implementer, recorded)

1. **Slice = add the 4 edge scale handles** (n/e/s/w), completing S23 to 8 handles for svg/path.
2. **Pure helper only:** extend `ScaleHandleId`/`SCALE_HANDLE_IDS`/`scaleHandleLocalPositions`;
   rename `oppositeCorner` → `oppositeHandle` (maps edges); `applyScaleHandleDrag` UNCHANGED.
3. **Stage:** the overlay + drag are id-agnostic — only the `oppositeCorner`→`oppositeHandle`
   rename is needed; the four edges auto-render and auto-work.
4. **Editor-only** — no engine/persistence change; reuses S23.
5. **One plan.**

## 7. Deferred (tracked)

- Shift-to-keep-aspect / uniform scale (would apply to resize + scale alike).
- Edge/uniform handles for rect/ellipse resize (separate from this svg/path scale slice).
- Negative scale / flipping past MIN_SCALE.

## 8. Testing

- **Pure unit (`scaleHandles.test.ts`):**
  - `scaleHandleLocalPositions` returns all 8 handles at the right positions (corners +
    edge midpoints, respecting a non-zero bbox origin).
  - `oppositeHandle` maps every handle to its opposite (nw↔se, ne↔sw, n↔s, e↔w).
  - `applyScaleHandleDrag` for the `e` handle (corner = right-edge mid, opposite =
    left-edge mid) scales **only X** (scaleY equals start) and holds the left edge fixed;
    for `n` it scales only Y. (Reuse the 100×100 / anchor (50,50) / scale-1 fixture.)
- **Stage unit (`Stage.test.tsx`):** a selected imported-svg object renders
  `scale-handle-e`; dragging it (`stubIdentityCTM`, pointerDown at content (100,50) →
  move to (200,50)) commits `scaleX ≈ 2` and `scaleY ≈ 1` (single-axis).
- **e2e (Playwright):** import box.svg → instance → Select → reposition into the stage
  interior → drag the `scale-handle-e` right → the object's `transform` has a non-1 X
  scale with Y still 1 (e.g. `scale(<≠1>, 1)`), confirming single-axis stretch.
