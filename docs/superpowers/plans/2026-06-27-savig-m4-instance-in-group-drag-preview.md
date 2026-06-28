# Instance-in-Group Drag Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A group drag (move/scale/rotate) live-previews its entire subtree — leaf children, symbol-instance children, and nested groups — instead of freezing the no-DOM-node children until commit.

**Architecture:** Converge the group preview onto the recompute-frame model the instance preview already uses: build a project where the group carries its in-progress `Transform2D`, run the shared `computeFrame` (parent-chain-aware), and apply only the group's subtree leaves to their DOM nodes. A pure `groupDescendantIds` engine helper backs the subtree filter; a shared `previewSubtree` Stage helper backs both the instance and group previews.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL. Client-only.

## Global Constraints

- No change to the commit path (`setObjectsTransforms`) — already correct.
- `computeFrame(project, time): FrameItem[]` and `applyFrameToNodes(nodes: Map<string, Element>, items: FrameItem[])` are the existing shared runtime functions; `FrameItem.objectId` is the renderId (plain object id, or composite `instanceId/internalPath`).
- The preview must apply ONLY the dragged container's own leaves (a mixed multi-select drag must never revert a sibling's in-progress preview) — same guarantee the instance preview gives.
- Leaf-only group drags must stay visually correct (parity); the leaf-preview behavior is unchanged, only the transform string FORMAT may change (flattened vs concatenated).
- `groupDescendantIds` excludes the group itself, includes leaves/instances/nested-groups + their descendants, cycle-guarded.

---

### Task 1: `groupDescendantIds` pure engine helper

**Files:**
- Modify: `src/engine/groupTransform.ts`
- Test: `src/engine/groupTransform.test.ts`

**Interfaces:**
- Consumes: `SceneObject` (already imported in `groupTransform.ts`).
- Produces: `export function groupDescendantIds(objects: SceneObject[], groupId: string): Set<string>`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/groupTransform.test.ts
import { groupDescendantIds } from './groupTransform';
import { createGroupObject, createSceneObject } from './project';

describe('groupDescendantIds', () => {
  it('collects leaves, instances, and nested groups + their descendants (not the group itself)', () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const leaf = createSceneObject('a', { id: 'leaf', parentId: 'g' });
    const inst = createSceneObject('sym', { id: 'inst', parentId: 'g' }); // a symbol instance child
    const ng = createGroupObject({ id: 'ng', anchorX: 0, anchorY: 0, zOrder: 1 });
    ng.parentId = 'g';
    const ngLeaf = createSceneObject('b', { id: 'ngLeaf', parentId: 'ng' });
    const outside = createSceneObject('c', { id: 'outside' }); // not under g
    const ids = groupDescendantIds([g, leaf, inst, ng, ngLeaf, outside], 'g');
    expect(ids.has('leaf')).toBe(true);
    expect(ids.has('inst')).toBe(true);
    expect(ids.has('ng')).toBe(true);
    expect(ids.has('ngLeaf')).toBe(true);
    expect(ids.has('g')).toBe(false); // excludes itself
    expect(ids.has('outside')).toBe(false);
  });

  it('terminates on a cyclic parentId chain', () => {
    const a = createSceneObject('x', { id: 'a', parentId: 'b' });
    const b = createSceneObject('x', { id: 'b', parentId: 'a' });
    expect(() => groupDescendantIds([a, b], 'a')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/groupTransform.test.ts -t groupDescendantIds`
Expected: FAIL — `groupDescendantIds` not exported.

- [ ] **Step 3: Implement**

```ts
// src/engine/groupTransform.ts — add (near parentGroupOf)
/** Every object whose parentId chain reaches `groupId` (leaves, instances, nested groups
 *  and their descendants). Excludes the group itself. Cycle-guarded. */
export function groupDescendantIds(objects: SceneObject[], groupId: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const o of objects) {
      if (o.parentId !== pid || out.has(o.id)) continue;
      out.add(o.id);
      walk(o.id);
    }
  };
  walk(groupId);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/groupTransform.test.ts -t groupDescendantIds`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/groupTransform.ts src/engine/groupTransform.test.ts
git commit -m "feat(group): groupDescendantIds pure helper (subtree membership)"
```

---

### Task 2: Extract `previewSubtree`; refactor `previewInstanceChildren` onto it

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (`previewInstanceChildren`, add `previewSubtree`)

**Interfaces:**
- Consumes: existing `computeFrame`, `applyFrameToNodes`, `nodes` (the Stage prop Map), `Project`, `SceneObject`, `Transform2D`.
- Produces (Stage-local):
  - `previewSubtree(proj: Project, containerId: string, base: Transform2D, time: number, ownRenderId: (id: string) => boolean): void`
  - `previewInstanceChildren(proj, instance, time, base)` unchanged signature, now delegating.

**Note:** This is a behavior-preserving refactor. The existing instance-preview RTL test (Stage.test.tsx ~1380, asserting `nodes.get('inst/inner')` transform changes mid-drag) must stay green with NO test change.

- [ ] **Step 1: Add `previewSubtree` and re-point `previewInstanceChildren`**

Replace the current `previewInstanceChildren` (Stage.tsx ~850) with:

```tsx
// Recompute-frame preview for a container that has no DOM node of its own (group or symbol
// instance): put its in-progress transform as a static base (tracks stripped → samples to
// base), recompute the shared frame, and apply ONLY this container's own leaves so a mixed
// multi-select drag never reverts a sibling's in-progress preview.
const previewSubtree = (
  proj: Project,
  containerId: string,
  base: Transform2D,
  time: number,
  ownRenderId: (id: string) => boolean,
) => {
  const container = proj.objects.find((o) => o.id === containerId);
  if (!container) return;
  const previewObj = { ...container, base, tracks: {} };
  const previewProj = { ...proj, objects: proj.objects.map((o) => (o.id === containerId ? previewObj : o)) };
  const own = computeFrame(previewProj, time).filter((it) => ownRenderId(it.objectId));
  applyFrameToNodes(nodes, own);
};

const previewInstanceChildren = (proj: Project, instance: SceneObject, time: number, base: Transform2D) => {
  previewSubtree(proj, instance.id, base, time, (id) => id.startsWith(`${instance.id}/`));
};
```

> Implementer: keep the explanatory comment that was on the old `previewInstanceChildren` (the slice-47b multi-select rationale) — fold it into `previewSubtree`'s comment as above. Confirm `computeFrame` and `applyFrameToNodes` are already imported in Stage.tsx (the old `previewInstanceChildren` used them); if `Transform2D`/`Project`/`SceneObject` aren't imported, add them from `../../../engine`.

- [ ] **Step 2: Verify instance preview parity**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "instance"` then `pnpm typecheck`
Expected: the instance-preview test passes unchanged; typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx
git commit -m "refactor(stage): extract previewSubtree; previewInstanceChildren delegates (no behavior change)"
```

---

### Task 3: Recompute-frame `previewGroupChildren` + call sites + tests (the fix)

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (`previewGroupChildren`, 3 call sites)
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `previewSubtree` (Task 2), `groupDescendantIds` (Task 1).
- Produces: `previewGroupChildren(proj: Project, group: SceneObject, time: number, base: Transform2D)` (signature changed from `(proj, groupId, time, prefixString)`).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/components/Stage/Stage.test.tsx (mirrors the group-scale-preview test ~1190
// and the instance-preview test ~1380; reuse this file's existing imports/helpers:
// stubIdentityCTM, render, screen, fireEvent, act, createSymbolAsset, createSceneObject, Stage)
it('a group containing a symbol instance previews the instance’s leaf mid-drag (instance-in-group)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  // a symbol with one inner leaf
  const inner = createVectorAsset('rect', { id: 'inner-asset' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  // an instance + a plain leaf, grouped
  const instance = createSceneObject('sym-1', { id: 'inst', zOrder: 0, anchorX: 10, anchorY: 10 });
  const leafAsset = createVectorAsset('rect', { id: 'leaf-asset' });
  const leafObj = createSceneObject('leaf-asset', { id: 'leaf', zOrder: 1, base: { x: 60, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  const project = createProject();
  project.assets = [inner, sym, leafAsset];
  project.objects = [instance, leafObj];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObjects(['inst', 'leaf']);
    useEditor.getState().groupSelected();
    useEditor.getState().setSnapEnabled(false);
  });
  // nodes: the plain leaf by id, the instance's flattened leaf by composite id (groups/instances have no node)
  const nodes = new Map<string, SVGGraphicsElement>();
  nodes.set('leaf', document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  nodes.set('inst/inner', document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  render(<Stage nodes={nodes} />);
  const before = nodes.get('inst/inner')!.getAttribute('transform');
  // drag the group SE scale handle (group is selected after groupSelected)
  fireEvent.pointerDown(screen.getByTestId('group-handle-se'), { clientX: 100, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 80 });
  const during = nodes.get('inst/inner')!.getAttribute('transform');
  expect(during).not.toBe(before); // the instance's leaf is previewed (was frozen before this fix)
  fireEvent.pointerUp(window, { clientX: 200, clientY: 80 });
});
```

> Implementer: adjust the handle coords to this file's CTM stub convention (mirror the exact numbers the ~1190 group-scale test uses for its `group-handle-se` down/move so the drag registers a real scale). The assertion is `during !== before` (the leaf moved), not an exact transform — robust to the flattened-format change. If `createVectorAsset` isn't imported in this test file, add it from `../../../engine` (the symbol-preview test already imports `createSymbolAsset`/`createSceneObject`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "instance-in-group"`
Expected: FAIL — `during === before` (the instance leaf is skipped by the old string-prefix `previewGroupChildren`).

- [ ] **Step 3: Rewrite `previewGroupChildren`**

Replace the current `previewGroupChildren` (Stage.tsx ~833) with:

```tsx
// Recompute-frame preview for a group (no DOM node of its own): its subtree leaves —
// leaf children, instance leaves (instId/…), and nested-group leaves — are all resolved by
// computeFrame's parent-chain walk. Filter to the group's own subtree (split at the first
// '/' to map a composite renderId back to its proj.objects-level producer) so a mixed
// multi-select drag never reverts a sibling's preview.
const previewGroupChildren = (proj: Project, group: SceneObject, time: number, base: Transform2D) => {
  const descendants = groupDescendantIds(proj.objects, group.id);
  previewSubtree(proj, group.id, base, time, (id) => descendants.has(id.split('/')[0]));
};
```

Add `groupDescendantIds` to the existing `../../../engine` import in Stage.tsx.

- [ ] **Step 4: Update the three call sites**

Each currently passes `(proj, obj.id, time, xf)` (a transform string); change to `(proj, obj, time, base)` mirroring the `previewInstanceChildren` call beside it:

```tsx
// SCALE handler (Stage.tsx ~973)
else if (obj.isGroup)
  previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy, rotation: sampled.rotation, opacity: sampled.opacity });

// ROTATE handler (Stage.tsx ~1011)
else if (obj.isGroup)
  previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: it.orot + theta, opacity: sampled.opacity });

// MOVE handler (Stage.tsx ~1430)
else if (obj.isGroup)
  previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity });
```

> Implementer: the `xf` local in each handler is still used by the leaf branch (`if (node) node.setAttribute('transform', xf)`) — leave it; only the `obj.isGroup` branch changes. Each new `base` is identical to the `previewInstanceChildren` base on the line below it.

- [ ] **Step 5: Run the new test + existing group-preview parity**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx` then `pnpm typecheck`
Expected: the new instance-in-group test passes; the existing group tests pass. **If the group-scale preview test (~1190, `toContain('scale(2')`) fails**, the child still scales 2× but the flattened transform string differs from the old concatenated one — verify the child IS previewed at 2× and update that single assertion to match behavior (e.g. assert the transform changed and contains `scale(2` of the flattened form, or assert position moved), NOT the old concatenated format. Do not weaken any behavioral guarantee.

- [ ] **Step 6: Add the leaf-only parity + nested-group tests**

```ts
// append to src/ui/components/Stage/Stage.test.tsx
it('a leaf-only group still previews its leaf mid-drag (parity)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  act(() => {
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    useEditor.getState().setSnapEnabled(false);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    if (o.isGroup) continue;
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  render(<Stage nodes={nodes} />);
  const before = nodes.get(a)!.getAttribute('transform');
  fireEvent.pointerDown(screen.getByTestId('group-handle-se'), { clientX: 140, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 280, clientY: 80 });
  expect(nodes.get(a)!.getAttribute('transform')).not.toBe(before); // leaf still previews
  fireEvent.pointerUp(window, { clientX: 280, clientY: 80 });
});
```

> Implementer: a nested-group preview case is also valuable but heavier to set up; if the instance-in-group test already exercises the `descendants.has(split('/')[0])` filter through both a leaf and an instance, a separate nested-group RTL test is optional — add it only if the filter's recursion isn't otherwise covered. `groupDescendantIds`'s nested-group recursion is unit-covered in Task 1.

- [ ] **Step 7: Run full Stage suite + typecheck**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx` then `pnpm typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(stage): recompute-frame group preview — instances/nested groups preview during group drags"
```

---

## Self-Review

**Spec coverage:**
- `groupDescendantIds` pure engine helper → Task 1. ✓
- `previewSubtree` shared core → Task 2. ✓
- `previewInstanceChildren` refactored onto it (parity) → Task 2. ✓
- `previewGroupChildren` recompute-frame rewrite + subtree filter → Task 3. ✓
- 3 call sites (move/scale/rotate) pass `Transform2D` base → Task 3 Step 4. ✓
- Mixed multi-select safety (own-leaves filter) → Task 3 (filter) + leaf-only/instance tests. ✓
- Leaf-only parity, instance-in-group fix → Task 3 tests. ✓
- Nested-group coverage → Task 1 unit (recursion) + optional RTL (Task 3 Step 6 note). ✓
- Edge cases (empty group → empty frame no-op; locked/hidden via computeFrame) → covered by computeFrame semantics, no extra task. ✓

**Placeholder scan:** No TBD/TODO. Test coords/import notes defer to the file's existing CTM-stub convention and imports, flagged inline with full assertion bodies (behavior assertions, not format-coupled).

**Type consistency:** `groupDescendantIds(objects, groupId): Set<string>`, `previewSubtree(proj, containerId, base, time, ownRenderId)`, `previewGroupChildren(proj, group, time, base)`, `previewInstanceChildren(proj, instance, time, base)` are named/typed identically across tasks. The `previewGroupChildren` signature change (Task 3) is consumed only by the 3 call sites updated in the same task.

## Notes / Risks
- The string-format change (concatenated prefix → flattened transform) may break a format-coupled assertion in the existing group-scale preview test (~1190); Task 3 Step 5 handles it by asserting behavior. This is the one place existing tests may need a (behavioral, not weakening) edit.
- Per-move frame recompute for a group is the accepted instance-preview cost (Global Constraints / spec).
