# Multi-Select Bounds Span Groups & Instances Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the multi-select scale-handle box include symbol instances and group containers, not
just plain vector/svg objects.

**Architecture:** Extract the multi-select union into a pure `multiSelectionAABB` helper in
`snapping.ts` that dispatches through the existing `entityAABB`; call it from `Stage.tsx`.
Editor-chrome only — no engine/parity change.

**Tech Stack:** React 18 + TS strict, Vitest.

## Global Constraints

- preview == export parity is non-negotiable (untouched here: selection-handle chrome only).
- TS strict; no `any`. Follow existing snapping.ts AABB-helper patterns.

---

### Task 1: `multiSelectionAABB` helper + Stage call-site

**Files:**
- Modify: `src/ui/components/Stage/snapping.ts` (add `multiSelectionAABB` after `entityAABB`, ~line 284).
- Modify: `src/ui/components/Stage/Stage.tsx` (import + the `groupBounds` `>1` branch, ~line 233-241).
- Test: `src/ui/components/Stage/snapping.test.ts` (new describe block).

**Interfaces:**
- Consumes: `entityAABB(obj, objects, assets, time): AABB | null` and `groupBBox(boxes): AABB | null`
  (both already in snapping.ts); `AABB = { minX, minY, maxX, maxY }`.
- Produces: `multiSelectionAABB(ids: string[], objects: SceneObject[], assets: Asset[], time: number): AABB | null`.

- [ ] **Step 1: Write the failing unit tests**

Append to `src/ui/components/Stage/snapping.test.ts` (the file already imports
`createSceneObject, createGroupObject, createVectorAsset, createSymbolAsset` and the snapping
helpers; add `multiSelectionAABB` to the `./snapping` import):

```ts
describe('multiSelectionAABB (47b polish)', () => {
  const vec = createVectorAsset('rect', { id: 'rect', shapeType: 'rect' });
  const innerAsset = createVectorAsset('rect', { id: 'inner', shapeType: 'rect' });
  const makeInner = () => {
    const o = createSceneObject('inner', { id: 'r', zOrder: 0 });
    o.shapeBase = { width: 10, height: 10 };
    return o;
  };

  it('spans a symbol instance in the selection (not dropped like objectAABB did)', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [makeInner()], width: 10, height: 10 });
    const plain = createSceneObject('rect', { id: 'p', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    plain.shapeBase = { width: 10, height: 10 };
    const inst = createSceneObject('sym', { id: 'i', base: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = multiSelectionAABB(['p', 'i'], [plain, inst], [vec, innerAsset, sym], 0)!;
    expect(box.minX).toBeCloseTo(0, 4);
    expect(box.minY).toBeCloseTo(0, 4);
    expect(box.maxX).toBeCloseTo(110, 4); // would be 10 if the instance were dropped
    expect(box.maxY).toBeCloseTo(60, 4);
  });

  it('spans a group container in the selection', () => {
    const g = createGroupObject({ id: 'g' });
    const a = createSceneObject('rect', { id: 'a', parentId: 'g', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    a.shapeBase = { width: 10, height: 10 };
    const b = createSceneObject('rect', { id: 'b', parentId: 'g', base: { x: 40, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    b.shapeBase = { width: 10, height: 10 };
    const plain = createSceneObject('rect', { id: 'p', base: { x: 200, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    plain.shapeBase = { width: 10, height: 10 };
    const box = multiSelectionAABB(['g', 'p'], [g, a, b, plain], [vec], 0)!;
    expect(box.minX).toBeCloseTo(0, 4); // group's left child
    expect(box.maxX).toBeCloseTo(210, 4); // plain's right edge
  });

  it('skips hidden/locked members and returns null when nothing contributes', () => {
    const a = createSceneObject('rect', { id: 'a' });
    a.shapeBase = { width: 10, height: 10 };
    a.hidden = true;
    const b = createSceneObject('rect', { id: 'b' });
    b.shapeBase = { width: 10, height: 10 };
    b.locked = true;
    expect(multiSelectionAABB(['a', 'b'], [a, b], [vec], 0)).toBeNull();
  });
});
```

NOTE before running: confirm `createGroupObject` is exported from `../../../engine` (snapping.test.ts
already imports it) and that `SceneObject.hidden`/`.locked` are the correct field names (grep
`snapping.ts` — `objectAABB`'s caller in Stage uses `o.hidden || o.locked`). Adjust the group AABB
expectations only if `createGroupObject`'s default anchor/transform differs (the existing
`groupAABB (slice 45b)` test at snapping.test.ts:126 is the authoritative numeric model — mirror its
setup if numbers differ).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/components/Stage/snapping.test.ts -t "multiSelectionAABB"`
Expected: FAIL — `multiSelectionAABB` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/ui/components/Stage/snapping.ts`, after `entityAABB` (~line 284), add:

```ts
// The union AABB of a MULTI-selection (slice 47b polish): each selected object contributes its
// entityAABB, so groups and symbol instances are included — not just plain vectors. Hidden/locked
// objects are skipped (not transformable). Null when nothing contributes.
export function multiSelectionAABB(
  ids: string[],
  objects: SceneObject[],
  assets: Asset[],
  time: number,
): AABB | null {
  const boxes: AABB[] = [];
  for (const id of ids) {
    const o = objects.find((x) => x.id === id);
    if (!o || o.hidden || o.locked) continue;
    const a = entityAABB(o, objects, assets, time);
    if (a) boxes.push(a);
  }
  return groupBBox(boxes);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/components/Stage/snapping.test.ts -t "multiSelectionAABB"`
Expected: PASS.

- [ ] **Step 5: Wire the helper into Stage.tsx**

In `src/ui/components/Stage/Stage.tsx`, add `multiSelectionAABB` to the `./snapping` import (line 5).
Then replace the inline `>1` loop in the `groupBounds` useMemo:

```ts
    if (selectedIds.length <= 1) return null;
    const boxes: AABB[] = [];
    for (const id of selectedIds) {
      const o = project.objects.find((x) => x.id === id);
      if (!o || o.hidden || o.locked) continue;
      const a = objectAABB(o, assetsById.get(o.assetId), time);
      if (a) boxes.push(a);
    }
    return groupBBox(boxes);
```

with:

```ts
    if (selectedIds.length <= 1) return null;
    return multiSelectionAABB(selectedIds, project.objects, project.assets, time);
```

If `objectAABB`, `groupBBox`, or the `AABB` type become unused in Stage.tsx after this, remove them
from the import to keep lint clean (verify with eslint in Step 6 — they may still be used elsewhere
in the file).

- [ ] **Step 6: Verify whole suite + typecheck + lint**

Run: `npx vitest run src/ui/components/Stage && npm run typecheck && npx eslint src/ui/components/Stage/snapping.ts src/ui/components/Stage/Stage.tsx`
Expected: PASS, no type errors, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/Stage/snapping.ts src/ui/components/Stage/snapping.test.ts src/ui/components/Stage/Stage.tsx
git commit -m "fix(stage): multi-select bounds include groups & instances via entityAABB (47b polish)"
```

---

## Self-Review

- **Spec coverage:** helper (Step 3), Stage wiring (Step 5), instance/group/hidden-locked tests
  (Step 1) — all spec items covered.
- **Placeholder scan:** the "NOTE before running" is a real verification step (confirm
  `createGroupObject` export and `hidden`/`locked` field names against the authoritative
  `groupAABB (slice 45b)` test), not a placeholder — concrete fallback (mirror that test's numbers)
  is given.
- **Type consistency:** `multiSelectionAABB` signature is identical across spec, helper, and the
  Stage call. `entityAABB`/`groupBBox` names match snapping.ts exports.
