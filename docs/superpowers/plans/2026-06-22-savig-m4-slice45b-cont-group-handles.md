# Savig M4 Slice 45b (continuation) — Group scale/rotate handles + e2e

> Finishes slice 45b. Spec: `specs/2026-06-22-savig-m4-slice45-group-container-design.md`. Prior 45b commits (store/select/move + guards) are on branch `m4-slice45b-group-container-ui`, 940 unit green.

**Goal:** A single selected group shows the slice-40/41 bbox handles (move already works); scaling/rotating them writes the group's STATIC base. Then e2e + full gate + review → merge.

**Architecture:** Reuse the existing group-bbox handles. They already build `items` from `selectedIds` and a group's `resolveObjectAnchor` returns null → the handler falls back to the group's ABSOLUTE `anchorX/anchorY`. The commit (`setObjectsTransforms`) already base-writes a group. So the only gaps: a `groupAABB` (children union through the group transform) so `groupBounds` is non-null for one group, and bypassing the handlers' `!autoKey` early-return for a static group.

## Global Constraints

- TS strict; no new deps. Group transform STATIC (base; no keyframes) — preview==export holds.
- One undo step per handle drag (the existing `setObjectsTransforms` commit).
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `groupAABB` helper

**Files:** `src/ui/components/Stage/snapping.ts`; test `src/ui/components/Stage/snapping.test.ts`.

**Interface:** `groupAABB(group: SceneObject, objects: SceneObject[], assets: Asset[], time: number): AABB | null` — the union of the group's children's AABBs, each mapped through the group's transform `M(p)=(gx,gy)+ga+R(grot)·S(gsx,gsy)·(p−ga)`; null when the group has no children.

- [ ] **Step 1: Failing test:** a group at identity with two child rects → `groupAABB` = their union; after the group `base.scaleX=2` (about its anchor), the bbox widens about the anchor.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `groupAABB` (map each child AABB's 4 corners through the group transform; union). Reuse `objectAABB(child, assetFor(child), time)` for each child's own box.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(slice45b): groupAABB (children union through the group transform)`.

---

### Task 2: Stage — show + drive the bbox handles for a single group

**Files:** `src/ui/components/Stage/Stage.tsx`; test `src/ui/components/Stage/Stage.test.tsx`.

- [ ] **Step 1: Failing tests:** selecting a group renders `group-handles`; dragging a corner handle scales the group BASE (sampleObject(group).scaleX changes; the children's own base scaleX unchanged); dragging the rotate handle writes the group base rotation.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:**
  - `groupBounds` memo: when `selectedIds.length === 1` and that object `isGroup`, return `groupAABB(group, project.objects, project.assets, time)`; keep the `> 1` union path. Add `project` to deps as needed.
  - `onGroupHandlePointerDown` + `onGroupRotatePointerDown`: replace `if (!groupBounds || !useEditor.getState().autoKey) return;` with `if (!groupBounds) return;` then bypass auto-key for a single group: `const single = selectedIds.length === 1 && proj.objects.find(o=>o.id===selectedIds[0])?.isGroup; if (!single && !useEditor.getState().autoKey) return;`. (The `setObjectsTransforms` commit already base-writes the group regardless of auto-key.)
- [ ] **Step 4:** Run the Stage suite → PASS.
- [ ] **Step 5: Commit** `feat(slice45b): scale/rotate a selected group via the reused bbox handles`.

---

### Task 3: e2e + full gate + merge

**Files:** rework `e2e/grouping.spec.ts`; new `e2e/group-container.spec.ts`.

- [ ] **Step 1:** Rework `e2e/grouping.spec.ts` to container behavior: draw 2 rects; select both; Group; clicking ONE selects the group (ONE selection outline on the group bbox); drag it → both move together; Ungroup → click one selects only it.
- [ ] **Step 2:** New `e2e/group-container.spec.ts`: group 2 rects; the group bbox handles appear; drag a corner handle → both children grow; Ungroup → children keep their world size and are independently selectable.
- [ ] **Step 3:** Full gate → all green. Sweep for stray `groupId`.
- [ ] **Step 4: Commit** `test(slice45b): e2e for group containers; full gate green`. Then review loop → merge.

---

## Self-Review

- **Coverage:** groupAABB (T1) ✓; handles show+drive for one group (T2) ✓; e2e (T3) ✓. Move/select/ungroup already done in the prior 45b commits.
- **Reuse soundness:** the handler `items` already fall back to the group's absolute anchor (no `resolveObjectAnchor` group case needed); the commit already base-writes a group; only `groupBounds` + the auto-key gate need touching — minimal surface.
- **Parity:** group stays static-base → preview==export unchanged.
- **Risk:** the slice-40/41 scale/rotate math is exact for the group's absolute anchor for translate/uniform-scale/rotate (same caveats as for any object); the Stage test pins the group base change to confirm.
- **Deferred (45c+):** animatable group transform; Layers-tree group rows; double-click-enter; nested groups.
