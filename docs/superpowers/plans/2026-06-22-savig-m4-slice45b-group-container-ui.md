# Savig M4 Slice 45b — Group containers, store + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking. Finishes slice 45a (the compose-engine foundation, already merged). Design: `specs/2026-06-22-savig-m4-slice45-group-container-design.md`.

**Goal:** Make group containers usable: Group/Ungroup create/dissolve real containers; clicking a member selects the GROUP; move/scale/rotate the group as a unit (writes its static base); remove slice-42 `groupId`.

**Architecture:** A group is the selection unit (`selectedObjectIds` holds top-level object/group ids, never group members). The group transform is edited via the REUSED slice-40/41 bbox handles (gate them to also fire for a single selected group) and the move-drag, all writing the group's BASE (static — groups have no runtime node, so animating them would break export parity). 45a's `computeFrame`/`renderDocument` already compose the group transform onto children.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. Group transform is STATIC: the transform actions write `base` (not keyframes) when the target `isGroup`.
- Group objects have NO DOM node: Stage render + every transform/selection path must skip/redirect them (a group's `assetId` is `''`).
- One undo step per group/ungroup/transform. Selection invariant preserved (`selectObjects` etc.).
- Removing `groupId` ripples through store/Stage/Layers/Inspector/keyboard/tests/e2e — done together; the branch is transiently red between tasks, GREEN by the final task.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Store — containers, base-writing, parent-based selection; drop `groupId`

**Files:** `src/ui/store/store.ts`, `src/engine/types.ts`, `src/engine/duplicate.ts`; test `src/ui/store/store.test.ts`.

**Interfaces (produced):**
- `groupSelected()`: create `createGroupObject` (identity base; `anchorX/Y` = selected bbox centre; `zOrder` = max selected zOrder + 1); set each selected non-locked NON-group object's `parentId` to the new id; commit; select the group. No-op for < 2 groupable objects.
- `ungroupSelected()`: for each selected GROUP, `bakeGroupIntoChild` each child (resolve the child's absolute anchor via `resolveObjectAnchor`), clear `parentId`, remove the group object; commit; select the freed children.
- `setGroupTransform(id, p: {x?;y?;scaleX?;scaleY?;rotation?})`: write the group's `base`, one commit (used by the move-drag + handles).
- `selectObjectOrGroup(id)` → select the parent group if `id` is grouped, else `id`. `toggleObjectOrGroup(id)` / `selectObjectsExpandingGroups(ids)` → resolve each to its group-or-self, dedupe.
- Base-writing: `setObjectsTransforms`, `nudgeSelected`, `setProperties` write `base` (not tracks) when the object `isGroup`.

- [ ] **Step 1: Failing store tests** (rework the slice-42 grouping describe block to containers):
```ts
// groupSelected: creates a group object (isGroup, identity base, anchor=bbox centre); children get parentId; group selected; one commit; <2 no-op.
// ungroupSelected: a translated group -> children keep WORLD x/y (bake), parentId cleared, group removed, children selected.
// setGroupTransform: writes group base (sampleObject(group).x reflects it; tracks.x empty).
// selectObjectOrGroup(child): selects the GROUP id (not the child).
// setObjectsTransforms on a group writes base not tracks.
```
- [ ] **Step 2:** Run `pnpm vitest run src/ui/store/store.test.ts` → FAIL.
- [ ] **Step 3:** Remove `groupId` from `types.ts` and the `delete object.groupId` line in `duplicate.ts`. Replace `groupMatesOf`/`expandToGroups` with parent-based helpers: `groupOf(objects,id)` (the parent group object or null), `resolveToEntity(objects,id)` (group id if grouped, else id). Rework `groupSelected`/`ungroupSelected`/selection actions per the interfaces. Add `setGroupTransform` (interface line near `setObjectsTransforms`). Add the `isGroup → base` branch to `setObjectsTransforms`/`nudgeSelected`/`setProperties` (a small `applyTransform(obj, partial, time, autoKey)` that writes base for groups, upserts tracks otherwise). For the bbox centre use `objectAABB` (snapping) + `groupBBox`.
- [ ] **Step 4:** Run store tests → PASS. (Typecheck/other suites still red — consumers fixed in later tasks.)
- [ ] **Step 5: Commit** `feat(slice45b): group containers in the store; base-writing; drop groupId`.

---

### Task 2: Group bbox in `snapping.ts` (`objectAABB`/`resolveObjectAnchor`)

**Files:** `src/ui/components/Stage/snapping.ts`; test `src/ui/components/Stage/snapping.test.ts`.

- [ ] **Step 1: Failing test:** `objectAABB(group, undefined, 0)` for a group returns the union of its children's AABBs mapped through the group transform (pass the project's objects so the helper can find children — see signature note).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `objectAABB`/`resolveObjectAnchor` currently take `(obj, asset, time)`. A group needs its children. Add an overload taking the objects list: `objectAABB(obj, asset, time, allObjects?)`. For `obj.isGroup`: bbox = `groupBBox(children.map(c => objectAABB(c, assetOf(c), time)) mapped through the group transform)`; `resolveObjectAnchor` for a group returns `{ anchorX: obj.anchorX, anchorY: obj.anchorY, bbox: <group local bbox> }`. (Children resolved from `allObjects`; callers in Stage already have the project.) Map each child AABB's 4 corners through the group transform (`buildTransform` matrix) and union — looser-but-safe for a rotated group (handles chrome).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(slice45b): objectAABB/resolveObjectAnchor handle group containers`.

---

### Task 3: Stage — skip groups, member→group select, group move-drag + handles

**Files:** `src/ui/components/Stage/Stage.tsx`; test `src/ui/components/Stage/Stage.test.tsx`.

- [ ] **Step 1: Failing tests:** clicking a member selects its group; a single selected group renders `group-handles` (bbox = children union); dragging a member moves the GROUP (sampleObject(group).x changes, child base unchanged); dragging a scale handle scales the group base.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:**
  - `visibleObjects` memo: filter out `o.isGroup` (groups have no node).
  - `groupBounds` gate (line 211): show when `selectedIds.length > 1` OR the single selected object `isGroup`; compute bounds via the new `objectAABB(group,…,allObjects)`.
  - `onObjectPointerDown(id)`: the clicked node is a child; resolve to its group. Shift/Cmd → `toggleObjectOrGroup`. Plain → `selectObjectOrGroup`; the move-drag TARGETS the group (set `d.id = groupId`); on release write the group (base) — extend the single-drag `onUp` so a group target calls `setGroupTransform({x,y})` instead of `setProperties`.
  - The slice-40/41 handle drag handlers commit via `setObjectsTransforms` — which now base-writes for the group. Pass the group through (the single-group selection makes `selectedIds=[groupId]`, and the handlers iterate `selectedIds`). Resolve the group's anchor via the new `resolveObjectAnchor` group case.
- [ ] **Step 4:** Run Stage suite → PASS.
- [ ] **Step 5: Commit** `feat(slice45b): Stage selects/moves/scales a group container via reused handles`.

---

### Task 4: Inspector + Layers + keyboard consumers

**Files:** `src/ui/components/Inspector/Inspector.tsx`, `src/ui/components/LayersPanel/LayersPanel.tsx`, `src/ui/hooks/useKeyboard.ts`; tests for each.

- [ ] **Step 1: Failing tests:** Inspector shows a Group panel (name + Ungroup) when the primary selection `isGroup` (no asset-editor crash); the multi-state `someGrouped` is parent-based; a Layers member row selects the group.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Inspector: if `obj?.isGroup`, return a group panel (`{obj.name} (group)` + an Ungroup button) BEFORE the asset-dependent code; fix `someGrouped` to `selectedIds.some(id => objects.find(o=>o.id===id)?.parentId || objects.find(o=>o.id===id)?.isGroup)` (or simply: any selected is a group). Keyboard Cmd+G/Cmd+Shift+G unchanged (call the reworked actions). Layers unchanged (it already calls `selectObjectOrGroup`/`toggleObjectOrGroup`, now parent-based). Update the slice-42 tests in each to the container behavior.
- [ ] **Step 4:** Run the three suites → PASS.
- [ ] **Step 5: Commit** `feat(slice45b): Inspector group panel; Layers/keyboard container selection`.

---

### Task 5: Persistence + e2e + full gate

**Files:** `src/services/persistence/savig.test.ts`; `e2e/grouping.spec.ts` (rework), `e2e/group-container.spec.ts` (new).

- [ ] **Step 1:** Persistence test: a group + 2 children round-trips `isGroup`/`parentId` (drop the old `groupId` round-trip test).
- [ ] **Step 2:** Rework `e2e/grouping.spec.ts` → container behavior (group two rects; clicking one selects the group → ONE selection outline on the group bbox, not two; drag moves both; ungroup → click one selects only it). New `e2e/group-container.spec.ts`: group → scale via a corner handle → both children grow; ungroup → children keep world size + are independently selectable.
- [ ] **Step 3:** Full gate — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test` → all green. Sweep for any remaining `groupId` references.
- [ ] **Step 4: Commit** `test(slice45b): persistence + e2e for group containers; full gate green`.

---

## Self-Review (post-write)

- **Spec coverage (45 §3–5,7–8):** store group/ungroup/setGroupTransform/select (T1) ✓; group bbox (T2) ✓; Stage skip/select/move/scale-rotate (T3) ✓; Inspector group panel + consumers (T4) ✓; persistence + e2e (T5) ✓; remove `groupId` (T1, swept T5) ✓.
- **Type consistency:** `isGroup`, `parentId`, `createGroupObject`, `bakeGroupIntoChild`, `setGroupTransform`, `groupOf`, `resolveToEntity` consistent; `objectAABB` group overload threaded to Stage callers.
- **Sequencing:** dropping `groupId` (T1) reds the repo until T3–T5 fix consumers; store-only green at T1, full green at T5 (same controlled-red pattern as 45a's plan).
- **Risks:** (a) the group move-drag must write the group BASE, not a child track — covered by a Stage test asserting child base unchanged. (b) Inspector must not run asset editors on a group — covered by the group-panel-first return. (c) preview==export parity stays intact (45a unchanged; groups remain static-base — the base-writing branch guarantees no group tracks).
- **Deferred (45c+):** animatable group transform; Layers-tree group rows; double-click-enter; nested groups.
