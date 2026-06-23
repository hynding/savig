# Savig M4 Slice 45e — Nested groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking. Spec: `specs/2026-06-22-savig-m4-slice45e-nested-groups-design.md`.

**Goal:** A group can contain another group. Make the five shared one-level helpers walk the parent chain / recurse, plus the Layers tree render recursively.

**Architecture:** `groupTransformPrefix` composes all ancestor group transforms (outermost-first); `isRenderHidden` + `resolveToEntity` walk the chain; `groupAABB` recurses; `groupSelected` allows grouping top-level groups; `ungroupSelected` reparents freed children to the grandparent; `LayersPanel` renders the tree recursively. No data/persistence change.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. `parentId`/`isGroup` already support arbitrary depth — no schema change.
- preview==export: `computeFrame` and `renderDocument` both use the SAME `groupTransformPrefix`; the cascade sites all use the same `isRenderHidden`.
- All chain-walkers carry a cycle guard (visited set / depth cap), even though the UI can't create a cycle.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Engine — chain-walking `groupTransformPrefix` + `isRenderHidden`

**Files:** `src/engine/groupTransform.ts`; test `src/engine/groupTransform.test.ts`.

- [ ] **Step 1: Failing tests:** `groupTransformPrefix` for a child whose parent group P (translate 10,0) is itself in group GP (translate 100,0) → the prefix starts with `translate(100, 0)` (GP, outermost) then contains `translate(10, 0)` (P). `isRenderHidden` true when only the GRANDPARENT group is hidden.
- [ ] **Step 2: Run** → FAIL (today only one level).
- [ ] **Step 3: Implement.**
```ts
export function groupTransformPrefix(project: Project, obj: SceneObject, time: number): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = parentGroupOf(project, obj);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.push(buildTransform(sampleObject(cur, time), cur.anchorX, cur.anchorY));
    cur = parentGroupOf(project, cur); // walk up
  }
  return parts.reverse().join(' '); // outermost ancestor first
}

export function isRenderHidden(obj: SceneObject, objectsById: Map<string, SceneObject>): boolean {
  if (obj.hidden) return true;
  const seen = new Set<string>();
  let pid = obj.parentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = objectsById.get(pid);
    if (!p?.isGroup) break;
    if (p.hidden) return true;
    pid = p.parentId;
  }
  return false;
}
```
- [ ] **Step 4: Run** the engine + the computeFrame parity tests → PASS (one-level cases unchanged: a single ancestor reverses to itself).
- [ ] **Step 5: Commit** `feat(slice45e): groupTransformPrefix + isRenderHidden walk the ancestor chain`.

---

### Task 2: Frame + snapping — nested composition + recursive `groupAABB`

**Files:** `src/runtime/frame.test.ts`; `src/ui/components/Stage/snapping.ts` + `snapping.test.ts`.

- [ ] **Step 1: Failing tests:** `frame.test.ts` — a child in inner P (translate 10,0) in outer GP (translate 100,0): `computeFrame(project, 0)` child transform starts `translate(100, 0)` then `translate(10, 0)` then the child's own. `snapping.test.ts` — `groupAABB(outer, …)` unions the inner group's box (an outer group containing only an inner group with two rects → the outer bbox equals the inner union).
- [ ] **Step 2: Run** → frame PASS already (uses the new prefix); snapping FAIL (groupAABB doesn't recurse).
- [ ] **Step 3: Implement `groupAABB` recursion** — for each child: `const cb = child.isGroup ? groupAABB(child, objects, assets, time) : objectAABB(child, assets.find((a) => a.id === child.assetId), time);` (rest unchanged: map the 4 corners through the group transform, union).
- [ ] **Step 4: Run** both → PASS.
- [ ] **Step 5: Commit** `feat(slice45e): nested composition in computeFrame + recursive groupAABB`.

---

### Task 3: Store — group/ungroup nested + outermost-resolve selection

**Files:** `src/ui/store/store.ts`; test `src/ui/store/store.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `resolveToEntity` of a doubly-nested child returns the OUTERMOST group.
  - `groupSelected` of [a top-level group G, a top-level object X] creates an OUTER group; G.parentId and X.parentId == the outer id; the outer is selected.
  - `ungroupSelected` of an INNER group reparents its children to the OUTER group (parentId == outer, not undefined) and removes the inner; a child's world x (via `sampleObject` composed through `groupTransformPrefix`) is preserved.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - `resolveToEntity(objects, id)`: walk up to the outermost ancestor group (cycle-guarded); return its id, else `id`. (`groupOf` stays immediate-parent for other uses.)
  - `groupSelected`: change the targets filter to `!!o && !o.locked && !o.parentId` (drop `!o.isGroup`); the bbox `boxes` map uses `o.isGroup ? groupAABB(o, project.objects, project.assets, time) : objectAABB(o, project.assets.find((a) => a.id === o.assetId), time)`. Import `groupAABB` from `../components/Stage/snapping`.
  - `ungroupSelected`: when baking each child, set `parentId: group.parentId` instead of `undefined` (reparent to the grandparent). i.e. `return { ...bakeGroupIntoChild(group, o, ax, ay), parentId: group.parentId };`
- [ ] **Step 4: Run** the store suite (incl. the 45b/45d group tests) → PASS.
- [ ] **Step 5: Commit** `feat(slice45e): nest/ungroup groups; selection resolves to the outermost group`.

---

### Task 4: Layers tree — recursive render

**Files:** `src/ui/components/LayersPanel/LayersPanel.tsx`; test `src/ui/components/LayersPanel/LayersPanel.test.tsx`.

- [ ] **Step 1: Failing test:** an outer group containing an inner group (with two rects) renders the inner group at depth 1 and the rects at depth 2; collapsing the inner group removes the depth-2 rows but keeps the inner group row; collapsing the outer removes everything below it.
- [ ] **Step 2: Run** → FAIL (today builds depth 0/1 only).
- [ ] **Step 3: Implement** the recursive render-list build:
```tsx
const rows: { obj: SceneObject; depth: number }[] = [];
const seen = new Set<string>();
const pushSubtree = (o: SceneObject, depth: number) => {
  if (seen.has(o.id)) return; // cycle guard
  seen.add(o.id);
  rows.push({ obj: o, depth });
  if (o.isGroup && !collapsed.has(o.id)) {
    for (const c of objects.filter((x) => x.parentId === o.id).sort((a, b) => b.zOrder - a.zOrder)) pushSubtree(c, depth + 1);
  }
};
for (const top of objects.filter((x) => !x.parentId).sort((a, b) => b.zOrder - a.zOrder)) pushSubtree(top, 0);
```
Indentation already uses the `child` class for `depth`; make it scale with depth: `style={{ paddingLeft: depth ? `calc(var(--space-3) + ${depth * 16}px)` : undefined }}` (drop the fixed `.child` padding or keep it for depth 1 and add the inline scale).
- [ ] **Step 4: Run** the Layers suite → PASS (the existing one-level + drag tests still hold).
- [ ] **Step 5: Commit** `feat(slice45e): Layers tree renders nested groups recursively`.

---

### Task 5: e2e + full gate

**Files:** `e2e/nested-groups.spec.ts`.

- [ ] **Step 1:** Write `e2e/nested-groups.spec.ts`: draw 3 rects; select 2, Group (inner); select the inner group + the 3rd rect, Group (outer); the Layers panel shows depth 0 (outer) / depth 1 (inner group + rect C) / depth 2 (rects A,B); click any rect → the outer group's bbox handles show (outermost selected); drag the outer group → all three move together.
- [ ] **Step 2:** Run → PASS.
- [ ] **Step 3: Full gate** → all green.
- [ ] **Step 4: Commit** `test(slice45e): e2e for nested groups (build/select/move two levels)`.

---

## Self-Review (post-write)

- **Spec coverage:** chain-walk prefix + cascade (T1) ✓; nested frame + recursive groupAABB (T2) ✓; group/ungroup nested + outermost-resolve (T3) ✓; recursive Layers (T4) ✓; e2e (T5) ✓.
- **Type consistency:** `groupTransformPrefix`/`isRenderHidden`/`resolveToEntity`/`groupAABB` signatures unchanged (internal recursion only); `groupAABB` imported into the store for `groupSelected`.
- **Parity:** one shared `groupTransformPrefix` (computeFrame + renderDocument) + one `isRenderHidden` → preview==export holds; a two-level frame test pins the composition order.
- **Cycle safety:** every chain-walker has a visited set / `!o.isGroup` break.
- **Deferred (spec §4):** double-click-to-enter; drag-reparent.
