# Savig M4 Slice 38 — Marquee (rubber-band) selection

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4)
**Depends on:** Slice 36 (multi-select), Slice 33 (objectAABB), Slice 37 (multi-move)

## 1. Goal

Drag on the empty Stage with the Select tool to draw a rubber-band rectangle; on
release, select every object whose bounding box intersects it. Shift-drag ADDS to the
current selection. This is the other half of multi-select — today you can only build a
multi-selection by Shift-clicking objects one at a time.

## 2. Behavior

- **Select tool + left pointer-down on the Stage BACKGROUND** (not an object/handle) →
  begin a marquee. (Object pointer-downs `stopPropagation`, so the marquee is
  background-only; middle-button still pans; draw tools are unaffected.)
- **Drag** → a dashed rubber-band `<rect>` renders in artboard space.
- **Release after a real drag** → select the objects whose `objectAABB` INTERSECTS the
  marquee rect (visible + unlocked only — `!hidden && !locked`). Plain → replace the
  selection; Shift → union with the current selection.
- **Release without moving (a click)** → preserve today's behavior: plain click
  deselects (`selectObject(null)`); a Shift-click on the background is a no-op (don't
  clobber the selection).

## 3. The hit test

Both the marquee rect and each `objectAABB` are in the same artboard coordinate space
(`clientToLocal` ↔ the content `<g>`). A pure `aabbIntersect(a, b)` (AABB overlap:
`a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY`) decides
membership — touch-to-select (Figma-style), not full-containment.

## 4. Scope (YAGNI)

**In:** marquee drag on the Select-tool background; dashed rect overlay; intersect-based
hit test (visible+unlocked); plain (replace) and Shift (additive) modes; click-to-deselect
preserved.

**Out (deferred → next M4 slices):** contain-vs-touch toggle; marquee inside the Layers
panel; Alt-subtract; multi-object transform; grouping; boolean ops. Locked/hidden objects
are not marquee-selectable.

**Editor-only:** no engine/export/runtime/persistence change (v4).

## 5. Implementation surface

- `src/ui/components/Stage/snapping.ts`: add a pure `aabbIntersect(a: AABB, b: AABB): boolean`.
  (AABB already lives here; it is the editor-geometry module.)
- `src/ui/components/Stage/Stage.tsx`:
  - `marqueeRef = useRef<{ start: {x,y}; additive: boolean; moved: boolean } | null>` and a
    `marquee` React state `{ minX, minY, maxX, maxY } | null` for the overlay.
  - `onBackgroundPointerDown` (Select tool, `button === 0`): start the marquee
    (`start = clientToLocal(...)`, `additive = e.shiftKey`) instead of the immediate
    `selectObject(null)`.
  - `onMove`: if `marqueeRef` set, compute the current artboard point, set `marquee`
    (normalized), mark `moved`.
  - `onUp`: if `marqueeRef` set — if `moved`, compute hits = objects with
    `!hidden && !locked` whose `objectAABB` intersects the marquee, then
    `selectObjects(additive ? union(current, hits) : hits)`; else (click) plain →
    `selectObject(null)`, Shift → no-op. Clear `marqueeRef`/`marquee`.
  - Render a `<rect data-testid="marquee">` (dashed, faint fill, `pointerEvents:none`) in
    the pan/zoom content `<g>` when `marquee` is set.

## 6. Testing

**Pure (`snapping.test.ts`):** `aabbIntersect` — overlapping → true; disjoint → false;
edge-touching → true; one fully inside the other → true.

**Stage (`Stage.test.tsx`):** with two rects, a background drag whose marquee covers both
selects both (`selectedObjectIds` has both; two outlines); a marquee covering only one
selects one; Shift-marquee adds to an existing selection; a background CLICK (no move)
deselects; a locked/hidden object inside the marquee is NOT selected.

**e2e (`marquee.spec.ts`):** draw two rects; drag a marquee around both on the empty
Stage → both show selection outlines; press Delete → 0 objects.

## 7. Risks

- **Coordinate space:** the marquee (from `clientToLocal`) and `objectAABB` must be in the
  same artboard space — they are (the draw tools + snapping already rely on this).
- **Click vs drag:** a tiny accidental move shouldn't turn a deselect-click into an empty
  marquee — use a `moved` flag set only on `onMove` (any move counts; a 0-area marquee
  selects nothing → equivalent to deselect for the plain case).
- **Interplay with object drags:** marquee only starts on the background handler; object
  pointer-downs stop propagation, so the two never both fire.
