# Savig M4 — Distribute by Centers

**Date:** 2026-06-26
**Milestone:** M4
**Status:** design — a bounded layout follow-up (slice 43 align/distribute family).

---

## 1. Motivation

`distributeSelected(axis)` distributes by equal GAP (equal whitespace between consecutive boxes). The
other standard mode is equal-CENTERS spacing (centroids evenly spaced) — the right choice when boxes
are different sizes and you want their centres on a regular grid. Adding it completes the distribute
family.

## 2. Architecture

Mirror `computeDistribute`. New pure helper in `Stage/align.ts`:

```ts
/** Distribute by equal CENTER spacing along `axis`: the first and last items (by center) stay put;
 *  intermediate items are moved so all centers are evenly spaced. Needs >=3 items. */
export function computeDistributeCenters(
  items: AlignItem[],
  axis: DistributeAxis,
): { id: string; x?: number; y?: number }[] {
  if (items.length < 3) return [];
  const horizontal = axis === 'h';
  const center = (a: AABB) => (horizontal ? (a.minX + a.maxX) / 2 : (a.minY + a.maxY) / 2);
  const sorted = [...items].sort((p, q) => center(p.aabb) - center(q.aabb));
  const firstC = center(sorted[0].aabb);
  const lastC = center(sorted[sorted.length - 1].aabb);
  const step = (lastC - firstC) / (sorted.length - 1);
  const out: { id: string; x?: number; y?: number }[] = [];
  sorted.forEach((it, i) => {
    const targetC = firstC + i * step;
    const d = targetC - center(it.aabb);
    if (Math.abs(d) >= EPS) out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
  });
  return out;
}
```

(`AABB`, `AlignItem`, `DistributeAxis`, `EPS`, `groupBBox` are already in `align.ts`. `EPS` is a
file-local const, reused.)

New store action `distributeCentersSelected(axis)` mirroring `distributeSelected`:

```ts
distributeCentersSelected(axis) {
  const updates = alignItemsUpdates(get(), (items) => computeDistributeCenters(items, axis));
  if (updates.length) get().setObjectsTransforms(updates);
}
```

### UI

Two buttons in the multi-select panel next to the existing distribute buttons: "Distribute horizontal
centers" / "Distribute vertical centers" (aria-labelled), gated by the existing `canDistribute`
(`movableCount >= 3`).

## 3. Parity, regression-safety, undo

- **Parity:** editor layout op via `setObjectsTransforms` → no render change → preview==export
  untouched.
- **Regression-safe:** purely additive (new helper + action + 2 buttons); the existing
  gap-distribute is untouched. Inherits the align-family `autoKey` gate.
- **Undo:** one commit via `setObjectsTransforms`.

## 4. Scope vs deferred

**In:** `computeDistributeCenters`; `distributeCentersSelected`; the two buttons; tests.

**Out:** a numeric spacing INPUT (specify an exact gap/step); distribute relative to the artboard.

## 5. Testing strategy

- `align.test.ts`: `computeDistributeCenters` — three boxes whose centres are at 0, 30, 100 along x
  (sizes irrelevant) → the middle one moves so centres are 0, 50, 100 (step 50); fewer than 3 → `[]`;
  already-even → `[]`; works on the `v` axis. Include differently-SIZED boxes to show centres (not
  gaps) are equalised (contrast with `computeDistribute`).
- `store.test.ts`: `distributeCentersSelected('h')` with autoKey on + 3 selected objects evens their
  centres; one undo step.
- RTL (`Inspector.test.tsx`): the two center-distribute buttons render for a ≥3 selection and click
  invokes the action.
