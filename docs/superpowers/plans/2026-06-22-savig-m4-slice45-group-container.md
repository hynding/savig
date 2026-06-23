# Savig M4 Slice 45 — Group containers (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking.

**Goal:** A group is a real container object with its own STATIC transform; move/scale/rotate the group as a unit; nested composition via flatten-at-compute (no DOM nesting).

**Architecture:** Group = `SceneObject{isGroup, assetId:'', base, anchorX/Y, no tracks}`; children via `parentId`. The shared `computeFrame` + `renderDocument` prepend the parent group's transform string to each child and skip group objects (no DOM node). Group handles reuse the slice-40/41 bbox UI, writing the group's base via `setGroupTransform`. Replaces slice-42 `groupId`.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. Editor + engine + export; NO runtime-source change (groups are static → the runtime never animates them; it only needs the flattened initial markup, which `renderDocument` produces).
- Preview == export: the group-transform prefix MUST be applied identically in `computeFrame` (src/runtime/frame.ts) and `renderDocument`.
- Group transform is STATIC (writes `base`, never tracks). One undo step per group/ungroup/transform.
- Skip group objects BEFORE any `assetsById.get`/asset resolution (a group's `assetId` is `''`).
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Data model — `isGroup`, group factory, drop `groupId`

**Files:** `src/engine/types.ts`, `src/engine/project.ts`; tests `src/engine/project.test.ts`.

**Interfaces:**
- Produces: `SceneObject.isGroup?: boolean`; `createGroupObject(opts: { id: string; name?: string; anchorX: number; anchorY: number; zOrder: number }): SceneObject`.

- [ ] **Step 1:** In `types.ts` remove `groupId?: string` (slice 42) and add, near `parentId`:
```ts
  /** True for a group CONTAINER object (slice 45): no asset, its own transform, children
   *  reference it via parentId. Skipped by shape rendering; its transform composes onto
   *  children at compute time. */
  isGroup?: boolean;
```
- [ ] **Step 2: Failing test** in `project.test.ts`: `createGroupObject` returns an object with `isGroup: true`, `assetId: ''`, identity `base`, the given anchor/zOrder, empty `tracks`.
- [ ] **Step 3:** Implement `createGroupObject` in `project.ts` (mirror `createSceneObject`'s base defaults: `base={x:0,y:0,scaleX:1,scaleY:1,rotation:0,opacity:1}`, `tracks:{}`, `anchorMode:'absolute'` if that field exists — check `createSceneObject`).
- [ ] **Step 4:** Run `pnpm vitest run src/engine/project.test.ts`; fix any other `groupId` references the compiler flags (`pnpm typecheck` — slice-42 store/tests still reference it; they're reworked in later tasks, so expect failures there until Task 5 — to keep Task 1 green in isolation, only assert the engine test here and defer the full typecheck to Task 5's completion).
- [ ] **Step 5: Commit** `feat(slice45): isGroup container + createGroupObject; drop groupId`.

---

### Task 2: Pure group-transform helpers

**Files:** `src/engine/groupTransform.ts` (new), `src/engine/index.ts` (export); test `src/engine/groupTransform.test.ts`.

**Interfaces:**
- Produces:
  - `groupTransformPrefix(project: Project, obj: SceneObject, time: number): string` — the parent group's `buildTransform` string, or `''` when `obj.parentId` is unset/not a group.
  - `bakeGroupIntoChild(group: SceneObject, groupState: RenderState, child: SceneObject, childState: RenderState): SceneObject` — returns the child with `parentId` cleared and `base` adjusted so its WORLD position is preserved (exact for translate/uniform-scale/rotate).
- Consumes: `sampleObject`, `buildTransform`, `resolveAnchor`, types.

- [ ] **Step 1: Failing tests** in `groupTransform.test.ts`:
```ts
// groupTransformPrefix: a child under a group at (10,20) -> prefix contains translate(10, 20)
// an ungrouped object -> ''
// bakeGroupIntoChild: group translate (10,20), child base (5,7) -> child base (15,27), parentId undefined
```
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement. `groupTransformPrefix`: find `project.objects.find(o => o.id === obj.parentId && o.isGroup)`; if none → `''`; else sample the group at `time` and return `buildTransform(groupState, group.anchorX, group.anchorY)`. `bakeGroupIntoChild`: for v1, compose translation exactly and (uniform) scale/rotation about the group anchor — implement the general affine via the group's sampled transform applied to the child's base position + multiply scale + add rotation; cover the translate path exactly and the scale/rotate path for uniform scale (document the shear caveat in a comment).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(slice45): groupTransformPrefix + bakeGroupIntoChild helpers`.

---

### Task 3: Flatten composition in `computeFrame` (shared editor+runtime)

**Files:** `src/runtime/frame.ts`; test `src/runtime/frame.test.ts`.

- [ ] **Step 1: Failing test** in `frame.test.ts`: a project with a group at translate(10,20) + a child rect at base (5,7); `computeFrame(project, 0)` yields NO item for the group, and the child's `transform` STARTS WITH the group prefix then the child transform (e.g. `expect(item.transform.startsWith('translate(10, 20)')).toBe(true)` and it also contains the child's `translate(5, 7)`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `computeFrame`, after `sampleProject(...).map(state => …)`: skip group objects (`if (obj.isGroup) return null` then `.filter(Boolean)`), and set `item.transform = (prefix ? prefix + ' ' : '') + buildTransform(state, anchorX, anchorY)` where `prefix = groupTransformPrefix(project, obj, time)`. (Resolve `obj` before the asset lookup; a group is filtered before `assetsById.get`.)
- [ ] **Step 4:** Run → PASS; run the full `frame.test.ts` + any parity test green.
- [ ] **Step 5: Commit** `feat(slice45): computeFrame skips groups + prepends the group transform`.

---

### Task 4: Flatten composition in `renderDocument` (export parity)

**Files:** `src/services/export/renderDocument.ts`; test `src/services/export/renderDocument.test.ts`.

- [ ] **Step 1: Failing test**: a project with a group + child; `renderSvgDocument(project)` contains the child `<g>`/`<use>` with `transform` starting with the group prefix, and emits NO element for the group object.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In the `sampleProject(project, 0).map(state => …)` loop: `if (obj.isGroup) return '';` BEFORE the asset lookup; and prepend `groupTransformPrefix(project, obj, 0)` to the child `transform` (both the vector `<g>` and the `<use>` branches).
- [ ] **Step 4:** Run → PASS; run `renderDocument.test.ts` + the preview==export parity test.
- [ ] **Step 5: Commit** `feat(slice45): renderDocument skips groups + prepends the group transform`.

---

### Task 5: Store — group/ungroup containers, setGroupTransform, parent-based selection

**Files:** `src/ui/store/store.ts`; test `src/ui/store/store.test.ts`.

**Interfaces:**
- `groupSelected()` reworked: create `createGroupObject` (identity base, anchor = selected bbox centre via `objectAABB`+`groupBBox`, zOrder = max+? ), set each selected non-locked object's `parentId`, commit, select the group.
- `ungroupSelected()` reworked: bake each child via `bakeGroupIntoChild`, clear parentId, remove the group object, commit, select the freed children.
- `setGroupTransform(id, partial: { x?; y?; scaleX?; scaleY?; rotation? })`: write the group's `base` (NOT tracks), one commit.
- Selection: `selectObjectOrGroup(id)` → if the object has a `parentId` group, select the GROUP; `groupChildrenOf(project, groupId)`.

- [ ] **Step 1: Failing tests** (rework the slice-42 grouping describe block): groupSelected creates a group object (`isGroup`, identity base, anchor=centre), children get `parentId`, group is selected, one commit; ungroupSelected bakes a translated group (child world x preserved), removes the group; setGroupTransform writes base (sampleObject of the group reflects x, `tracks.x` empty); clicking-equivalent `selectObjectOrGroup(child)` selects the group.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the reworked actions + remove the `groupId`/`groupMatesOf`/`expandToGroups` slice-42 logic, replacing with parent-based helpers. Update `setObjectsTransforms`/move paths so they ignore group children appropriately (a group's children move with the group, not individually — but for v1 the children are not individually selectable, so leave member move as-is).
- [ ] **Step 4:** Run the store suite → PASS.
- [ ] **Step 5: Commit** `feat(slice45): group containers in the store (group/ungroup/setGroupTransform/select)`.

---

### Task 6: Stage — select the group, group bbox + handles, render flat

**Files:** `src/ui/components/Stage/Stage.tsx`, `src/ui/components/Inspector/Inspector.tsx`; tests `Stage.test.tsx`, `Inspector.test.tsx`.

- [ ] **Step 1: Failing test** (Stage): clicking a member selects its group; a selected group renders `group-handles` (bbox = children union) and dragging a corner writes the group's base scale (sampleObject(group).scaleX changes; children visually compose).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Stage: (a) `onObjectPointerDown` selects the group when the clicked object has a parent group; (b) render is flat but SKIP group objects in the `visibleObjects` map (groups have no shape/node — they're filtered, like `computeFrame`); (c) when the selected object `isGroup`, compute its bbox (children union transformed by the group transform) and render the reused slice-40/41 bbox handles; their drag handlers write `setGroupTransform` instead of `setObjectsTransforms`. Inspector: when the primary selection `isGroup`, show a "Group" panel (name + Ungroup) — do NOT run the asset-dependent single-object editors (avoid a missing-asset crash).
- [ ] **Step 4:** Run Stage + Inspector suites → PASS.
- [ ] **Step 5: Commit** `feat(slice45): Stage selects/transforms a group via reused bbox handles`.

---

### Task 7: Persistence + e2e + full gate

**Files:** `src/services/persistence/savig.test.ts`; `e2e/group-container.spec.ts`.

- [ ] **Step 1:** Persistence test: a group + 2 children round-trips `isGroup`/`parentId` (additive, version unchanged).
- [ ] **Step 2:** e2e (`group-container.spec.ts`, modeled on `grouping.spec.ts`): draw 2 rects; select both; Group (button); a group bbox/handles appear; drag a corner handle → both children scale together (their boxes grow); Ungroup → click one → only it is selected and it kept its scaled size.
- [ ] **Step 3:** Full gate — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test` → all green. Fix any remaining slice-42 `groupId` references surfaced by typecheck (tests/specs from slice 42).
- [ ] **Step 4: Commit** `test(slice45): persistence + e2e for group containers; full gate green`.

---

## Self-Review (post-write)

- **Spec coverage:** data model (T1) ✓; flatten helpers (T2) ✓; computeFrame (T3) + renderDocument (T4) flatten/skip ✓; store group/ungroup/setGroupTransform/select (T5) ✓; Stage handles + Inspector group-state (T6) ✓; persistence + e2e (T7) ✓.
- **Type consistency:** `isGroup`, `parentId`, `createGroupObject`, `groupTransformPrefix`, `bakeGroupIntoChild`, `setGroupTransform`, `groupChildrenOf` spelled consistently across tasks.
- **Sequencing risk:** dropping `groupId` (T1) breaks slice-42 store/tests until T5/T7 rework them — Task 1 keeps only its engine test green; the FULL typecheck/suite is restored at T5 (store) and T7 (tests/specs/e2e). This is the one place the repo is transiently red between commits; acceptable on a feature branch, green by the final task.
- **Parity:** the same `groupTransformPrefix` feeds T3 and T4 → preview==export holds (guarded by the parity test).
- **Deferred (spec §6):** animatable group transform, Layers-tree rows, double-click-enter, nested groups, sheared-ungroup exactness.
