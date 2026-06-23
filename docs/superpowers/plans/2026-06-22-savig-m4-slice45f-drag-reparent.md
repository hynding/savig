# Savig M4 Slice 45f — Drag-reparent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking. Spec: `specs/2026-06-22-savig-m4-slice45f-drag-reparent-design.md`.

**Goal:** Drag a Layers row onto a group to add it (or onto a top-level row to remove it), preserving world position.

**Architecture:** `reparentObject(id, newParentId|null)` bakes the object out of its whole old ancestor chain (`bakeGroupIntoChild`, exists) then unbakes it into the new chain (`unbakeGroupFromChild`, the inverse — new pure helper). The Layers DnD calls it. No data/persistence change.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. `unbakeGroupFromChild` round-trips `bakeGroupIntoChild` (exact for translate/uniform-scale/rotate; shear caveat). Bake samples the group at t=0 (45d limit).
- One commit per reparent. Cycle (reparent into self/descendant) and same-parent are no-ops.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Engine — `unbakeGroupFromChild` (inverse of bake)

**Files:** `src/engine/groupTransform.ts`; test `src/engine/groupTransform.test.ts`.

**Interface:** `unbakeGroupFromChild(group, child, childAnchorX, childAnchorY): SceneObject` — the inverse of `bakeGroupIntoChild`: returns the child with `parentId = group.id` and `base` adjusted so that COMPOSING the group transform back onto it reproduces the child's current (world) position.

- [ ] **Step 1: Failing tests:** `unbakeGroupFromChild(g, bakeGroupIntoChild(g, child, ax, ay), ax, ay)` ≈ the original `child` (base x/y/scale/rotation), for a translate group, a uniform-scale group, and a rotate group; `unbake` sets `parentId = g.id`.
- [ ] **Step 2: Run** → FAIL (helper missing).
- [ ] **Step 3: Implement.** Add an inverse point map + the helper:
```ts
/** Inverse of mapPoint: solve M(p) = q for p. p = a + S⁻¹·R⁻¹·(q − (x,y) − a). */
function invMapPoint(
  t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  ax: number, ay: number, qx: number, qy: number,
): { x: number; y: number } {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = qx - t.x - ax;
  const dy = qy - t.y - ay;
  const rx = c * dx + s * dy;   // R⁻¹ row 1
  const ry = -s * dx + c * dy;  // R⁻¹ row 2
  return { x: ax + rx / t.scaleX, y: ay + ry / t.scaleY };
}

/** Inverse of bakeGroupIntoChild: place `child` (currently in the group's PARENT space) into
 *  `group`'s local space, world position preserved (drag-reparent INTO a group, slice 45f). */
export function unbakeGroupFromChild(
  group: SceneObject, child: SceneObject, childAnchorX: number, childAnchorY: number,
): SceneObject {
  const gs = sampleObject(group, 0);
  const cb = child.base;
  const local = invMapPoint(gs, group.anchorX, group.anchorY, childAnchorX + cb.x, childAnchorY + cb.y);
  return {
    ...child,
    parentId: group.id,
    base: {
      ...cb,
      x: local.x - childAnchorX,
      y: local.y - childAnchorY,
      scaleX: cb.scaleX / gs.scaleX,
      scaleY: cb.scaleY / gs.scaleY,
      rotation: cb.rotation - gs.rotation,
    },
  };
}
```
- [ ] **Step 4: Run** → PASS (round-trips).
- [ ] **Step 5: Commit** `feat(slice45f): unbakeGroupFromChild (inverse bake for reparent-in)`.

---

### Task 2: Store — `reparentObject` (bake-out chain + unbake-in chain)

**Files:** `src/ui/store/store.ts`; test `src/ui/store/store.test.ts`.

**Interface:** `reparentObject(id: string, newParentId: string | null): void`.

- [ ] **Step 1: Failing tests:** `reparentObject(topLevelObj, group)` → `parentId === group`, and the object's WORLD x (`sampleObject` + `groupTransformPrefix` composition, i.e. the on-screen position) is unchanged; `reparentObject(child, null)` → `parentId` undefined, world position unchanged; a cycle `reparentObject(group, aDescendantId)` is a no-op (parentId of `group` unchanged, no commit); same-parent is a no-op; a nested reparent (object from group A to sibling group B) preserves world position.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Declare** `reparentObject(id: string, newParentId: string | null): void;` in the interface (near `ungroupSelected`). Import `unbakeGroupFromChild`. Implement:
```ts
  reparentObject(id, newParentId) {
    const s = get();
    const project = s.history.present;
    const o0 = project.objects.find((x) => x.id === id);
    if (!o0) return;
    if ((o0.parentId ?? null) === newParentId) return; // no-op (same parent; reorder is separate)
    if (newParentId) {
      const np = project.objects.find((x) => x.id === newParentId);
      if (!np?.isGroup) return; // must drop into a group
      // cycle guard: newParent must not be the object or a descendant of it
      let cur: SceneObject | undefined = np;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        if (cur.id === id) return; // would nest a group inside itself
        seen.add(cur.id);
        cur = cur.parentId ? project.objects.find((x) => x.id === cur!.parentId) : undefined;
      }
    }
    // Resolve the object's absolute anchor (for the bake/unbake point maps).
    const r = resolveObjectAnchor(o0, project.assets.find((a) => a.id === o0.assetId), sampleObject(o0, snapToFrame(s.time, project.meta.fps)));
    const ax = r ? r.anchorX : o0.anchorX;
    const ay = r ? r.anchorY : o0.anchorY;
    // Bake OUT of the whole old ancestor chain (immediate → outermost) → world space.
    let cur2 = o0;
    for (let g = parentGroupOfStore(project.objects, o0); g; g = parentGroupOfStore(project.objects, g)) {
      cur2 = bakeGroupIntoChild(g, cur2, ax, ay);
    }
    // Unbake INTO the new chain (outermost → immediate).
    const newChain: SceneObject[] = [];
    for (let g = newParentId ? project.objects.find((x) => x.id === newParentId && x.isGroup) : undefined; g; g = parentGroupOfStore(project.objects, g)) {
      newChain.push(g);
    }
    for (const g of newChain.reverse()) cur2 = unbakeGroupFromChild(g, cur2, ax, ay);
    cur2 = { ...cur2, parentId: newParentId ?? undefined };
    get().commit(replaceObject(project, cur2));
    get().selectObject(id);
  },
```
Add a tiny module helper `parentGroupOfStore(objects, obj)` = the obj's parent group object or undefined (or reuse the engine `parentGroupOf` by constructing a `{objects}` shim — simplest: a 3-line local). (`bakeGroupIntoChild` is already imported; `resolveObjectAnchor`, `sampleObject`, `snapToFrame`, `replaceObject` are in scope.)
- [ ] **Step 4: Run** the store suite → PASS.
- [ ] **Step 5: Commit** `feat(slice45f): reparentObject — world-preserving reparent across the group chain`.

---

### Task 3: Layers DnD — drop onto a group reparents

**Files:** `src/ui/components/LayersPanel/LayersPanel.tsx`; test `src/ui/components/LayersPanel/LayersPanel.test.tsx`.

- [ ] **Step 1: Failing tests:** dropping a top-level object's row onto a group row reparents it (after, `objects.find(dragged).parentId === group`); dropping a child row onto a top-level non-group row removes it to root (`parentId` undefined). (Use `fireEvent.dragStart`/`dragOver`/`drop` with the row testids; `dragIdRef` is set on dragStart.)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Destructure `reparentObject` from the store. Re-enable drag for all rows: `draggable={!o.locked && editingId !== o.id}` (drop the `depth === 0` restriction); allow `onDragOver`/`onDrop` on all rows (drop the `depth === 0` guard). In `onDrop`, replace the `moveObjectToTarget` call with:
```ts
              const dragged = project.objects.find((x) => x.id === draggedId);
              if (o.isGroup) reparentObject(draggedId, o.id); // into the group
              else if ((dragged?.parentId ?? null) === (o.parentId ?? null)) moveObjectToTarget(draggedId, o.id); // same parent: reorder
              else reparentObject(draggedId, o.parentId ?? null); // join the drop target's parent / root
```
(Need `project` objects in scope — the component already reads `objects`; use that. Don't reparent onto self: keep the existing `draggedId !== o.id` implicit via the no-op guard, but also skip if `draggedId === o.id`.)
- [ ] **Step 4: Run** the Layers suite → PASS (existing reorder + tree tests still hold; child rows now draggable — update the slice-45c "child rows not draggable" test, which is now intentionally reversed).
- [ ] **Step 5: Commit** `feat(slice45f): Layers drag-reparent (drop onto a group / to root)`.

---

### Task 4: e2e + full gate

**Files:** `e2e/drag-reparent.spec.ts`.

- [ ] **Step 1:** Write `e2e/drag-reparent.spec.ts`: draw 3 rects; group A,B; in the Layers panel drag C's row onto the group row → C nests (a `layer-<C>` at depth 1 under the group); select the group and drag it → C moves with A,B; then drag A's row out onto C's row (now top-level) → A leaves the group (clicking A selects only A, one selection-outline). Use the Layers row testids + `dragTo` / manual drag events; model the world-position checks on `boundingBox`.
- [ ] **Step 2:** Run → PASS. (If HTML5 DnD is awkward in Playwright, drive `dragstart`/`dragover`/`drop` via `dispatchEvent`, or fall back to asserting the data-model `parentId` via the Layers depth after the drop.)
- [ ] **Step 3: Full gate** → all green.
- [ ] **Step 4: Commit** `test(slice45f): e2e drag-reparent (into a group, move-together, out to root)`.

---

## Self-Review (post-write)

- **Spec coverage:** unbake helper (T1) ✓; reparentObject chain bake/unbake + guards (T2) ✓; Layers DnD (T3) ✓; e2e (T4) ✓.
- **Type consistency:** `unbakeGroupFromChild` mirrors `bakeGroupIntoChild`'s signature; `reparentObject(id, newParentId|null)` consistent across the interface, store, and Layers caller.
- **Round-trip:** the engine test pins `unbake(bake(x)) == x`; the store test pins the composed WORLD position invariance (the real correctness criterion).
- **Cycle/no-op guards:** explicit in `reparentObject`; covered by tests.
- **45c test reversal:** the "child rows not draggable" test (45c) is intentionally reversed in T3 — listed, not a surprise.
- **Deferred (spec §5):** precise drop-index reorder while reparenting; shear caveat for non-uniform-scaled rotated ancestor chains.
