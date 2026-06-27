# Savig M4 — Center Selection on Canvas (align-to-artboard)

**Date:** 2026-06-26
**Milestone:** M4
**Status:** design — a bounded layout follow-up (slice 43 align/distribute family).

---

## 1. Motivation

Align (slice 43) aligns selected objects to EACH OTHER (needs ≥2). There's no way to center content on
the ARTBOARD. "Center on canvas" — move the selection so its combined bounding box is centred on the
artboard — is a common layout need and works for a SINGLE object too.

## 2. Architecture

Mirror the existing align plumbing. New pure helper in `Stage/align.ts`:

```ts
/** Shift every item by ONE delta so the selection's combined bbox centre lands on the frame centre
 *  (frameW/2, frameH/2). Moves the selection as a rigid group (relative positions preserved).
 *  Works for >=1 item. */
export function computeCenterOnFrame(
  items: AlignItem[],
  frameW: number,
  frameH: number,
): { id: string; x?: number; y?: number }[] {
  const g = groupBBox(items.map((i) => i.aabb));
  if (!g || items.length < 1) return [];
  const dx = frameW / 2 - (g.minX + g.maxX) / 2;
  const dy = frameH / 2 - (g.minY + g.maxY) / 2;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return [];
  return items.map((it) => ({ id: it.id, x: it.x + dx, y: it.y + dy }));
}
```

New store action `centerOnCanvas()` reusing the existing `alignItemsUpdates` collector (selection →
movable `AlignItem[]` with stage AABBs; inherits the established `autoKey` gate — normal objects are
positioned through keyframes in this editor, identical to align/distribute):

```ts
centerOnCanvas() {
  const { width, height } = get().history.present.meta;
  const updates = alignItemsUpdates(get(), (items) => computeCenterOnFrame(items, width, height));
  if (updates.length) get().setObjectsTransforms(updates);
}
```

`setObjectsTransforms` already writes the ACTIVE scene (works inside a symbol), keyframes-or-base per
the autoKey/group rules, and is one undo step.

### UI

A "Center on canvas" button (aria-label "Center on canvas") in TWO Inspector spots so it's reachable
for both single and multi selections:
- the single-object panel (near the transform fields),
- the multi-select panel (alongside align/distribute).

Both call `centerOnCanvas()`. (Edge-align-to-artboard — left/top/… to the artboard — is a trivial
future extension via a `computeAlignToFrame(items, edge, w, h)`; out of scope here, which is just the
centre.)

## 3. Parity, regression-safety, undo

- **Parity:** editor layout op; writes object transforms through the existing `setObjectsTransforms`
  → no render-pipeline change → preview==export untouched.
- **Regression-safe:** purely additive (new helper + action + buttons). The `autoKey` gate matches
  align/distribute, so behaviour is consistent (a single normal object with autoKey off → no-op, like
  any transform write; documented).
- **Undo:** one `commitActiveScene` via `setObjectsTransforms`.

## 4. Scope vs deferred

**In:** `computeCenterOnFrame`; `centerOnCanvas` action; the two buttons; tests.

**Out:** edge-align-to-artboard (left/right/top/bottom/edges); a "fit to canvas" scale; per-object
(vs group) centring.

## 5. Testing strategy

- `align.test.ts`: `computeCenterOnFrame` — one object whose bbox is at (0..10, 0..10) on a 100×100
  frame → delta (45,45) → x/y shifted by 45; a two-object selection shifts BOTH by the same delta
  (relative offset preserved); already-centred → `[]`; empty → `[]`.
- `store.test.ts`: `centerOnCanvas` with autoKey on centres a single object's bbox on the artboard;
  inside a symbol it centres within the symbol scene (active-scene routed); is one undo step.
- RTL (`Inspector.test.tsx`): the "Center on canvas" button is present for a single selection and
  clicking it invokes the action (object recenters).
