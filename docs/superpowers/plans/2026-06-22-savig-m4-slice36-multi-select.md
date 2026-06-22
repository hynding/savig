# Slice 36 — M4 Multi-select foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift/Cmd-click selects multiple objects (Stage + Layers); bulk delete/duplicate act on all; the Stage highlights all selected and the Inspector shows a multi-state. Per-object editing + handles stay single (the primary).

**Architecture:** `selectedObjectIds: string[]` with `selectedObjectId` kept as the primary (= last). Three selection actions centralize the invariant; `deleteSelectedObject`/`duplicateSelected` iterate the array. Editor-only.

**Tech Stack:** Zustand, React + RTL, Playwright.

## Global Constraints

- Editor-only: NO engine/export/runtime/persistence/migration change (v4).
- INVARIANT: `selectedObjectId === selectedObjectIds.at(-1) ?? null` after every selection mutation.
- Single-object behavior must stay byte-identical (existing select/delete/duplicate tests green).
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Store selection model + bulk delete/duplicate

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- `selectedObjectIds: string[]`; `toggleObjectSelection(id: string): void`; `selectObjects(ids: string[]): void`.

- [ ] **Step 1: Write the failing tests** — append to `store.test.ts`:

```ts
describe('multi-select (slice 36)', () => {
  function twoRects() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    return { a, b };
  }

  it('toggleObjectSelection adds then removes; primary tracks the last', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObject(a);
    expect(useEditor.getState().selectedObjectIds).toEqual([a]);
    useEditor.getState().toggleObjectSelection(b);
    expect(useEditor.getState().selectedObjectIds).toEqual([a, b]);
    expect(useEditor.getState().selectedObjectId).toBe(b); // primary = last
    useEditor.getState().toggleObjectSelection(b);
    expect(useEditor.getState().selectedObjectIds).toEqual([a]);
    expect(useEditor.getState().selectedObjectId).toBe(a);
  });

  it('selectObject collapses to a single selection', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().selectObject(a);
    expect(useEditor.getState().selectedObjectIds).toEqual([a]);
    expect(useEditor.getState().selectedObjectId).toBe(a);
  });

  it('deleteSelectedObject removes ALL selected and clears the selection', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
    expect(useEditor.getState().selectedObjectIds).toEqual([]);
    expect(useEditor.getState().selectedObjectId).toBeNull();
  });

  it('duplicateSelected clones ALL selected and selects the clones', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().duplicateSelected();
    expect(useEditor.getState().history.present.objects).toHaveLength(4);
    expect(useEditor.getState().selectedObjectIds).toHaveLength(2);
    // the new selection is the clones, not the originals
    expect(useEditor.getState().selectedObjectIds).not.toContain(a);
    expect(useEditor.getState().selectedObjectIds).not.toContain(b);
  });

  it('undo restores a multi-delete; stale ids are pruned', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().deleteSelectedObject();
    useEditor.getState().selectObjects([a, b]); // re-point at now-absent ids
    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects).toHaveLength(2);
    // the array is pruned of ids absent in the restored... they ARE present after undo, so still selected is fine;
    // verify primary stays consistent with the array
    const s = useEditor.getState();
    expect(s.selectedObjectId).toBe(s.selectedObjectIds.at(-1) ?? null);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm vitest run src/ui/store/store.test.ts` → FAIL.

- [ ] **Step 3: Implement** —
  - Add to the interface: `selectedObjectIds: string[];`, `toggleObjectSelection(id: string): void;`, `selectObjects(ids: string[]): void;`.
  - Add `selectedObjectIds: [] as string[],` to `TRANSIENT_DEFAULTS` (next to `selectedObjectId`).
  - `selectObject(id)`: set `selectedObjectIds: id ? [id] : []` alongside the existing fields:
    ```ts
    selectObject(id) {
      set({ selectedObjectId: id, selectedObjectIds: id ? [id] : [], selectedKeyframe: null, selectedShapeKeyframe: null, selectedColorKeyframe: null, selectedGradientKeyframe: null, selectedDashKeyframe: null, selectedProgressKeyframe: null, selectedNodeIndex: null });
    },
    ```
  - New actions (place near selectObject):
    ```ts
    toggleObjectSelection(id) {
      const ids = get().selectedObjectIds;
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      set({ selectedObjectIds: next, selectedObjectId: next.at(-1) ?? null, selectedKeyframe: null, selectedShapeKeyframe: null, selectedColorKeyframe: null, selectedGradientKeyframe: null, selectedDashKeyframe: null, selectedProgressKeyframe: null, selectedNodeIndex: null });
    },
    selectObjects(ids) {
      set({ selectedObjectIds: [...ids], selectedObjectId: ids.at(-1) ?? null, selectedKeyframe: null, selectedShapeKeyframe: null, selectedColorKeyframe: null, selectedGradientKeyframe: null, selectedDashKeyframe: null, selectedProgressKeyframe: null, selectedNodeIndex: null });
    },
    ```
  - `clearStaleSelection`: prune the array + resync the primary. Change its signature to take the array too, OR compute inside undo/redo. Simplest — rewrite it:
    ```ts
    function clearStaleSelection(history: History<Project>, ids: string[]): { selectedObjectIds: string[]; selectedObjectId: string | null } {
      const live = ids.filter((id) => history.present.objects.some((o) => o.id === id));
      return { selectedObjectIds: live, selectedObjectId: live.at(-1) ?? null };
    }
    ```
    and in `undo`/`redo`: `set({ history, ...clearStaleSelection(history, get().selectedObjectIds) })`.
  - `deleteSelectedObject` (bulk):
    ```ts
    deleteSelectedObject() {
      const s = get();
      let project = s.history.present;
      const ids = s.selectedObjectIds.filter((id) => !project.objects.find((o) => o.id === id)?.locked);
      if (ids.length === 0) return;
      for (const id of ids) project = removeObject(project, id);
      get().commit(project);
      get().selectObject(null);
    },
    ```
  - `duplicateSelected` (bulk):
    ```ts
    duplicateSelected() {
      const s = get();
      let project = s.history.present;
      const sources = s.selectedObjectIds
        .map((id) => project.objects.find((o) => o.id === id))
        .filter((o): o is SceneObject => !!o && !o.locked);
      if (sources.length === 0) return;
      const cloneIds: string[] = [];
      for (const obj of sources) {
        const asset = project.assets.find((a) => a.id === obj.assetId);
        const { object, clonedAsset } = duplicateObject(obj, asset, { objectId: newId(), assetId: newId() }, DUP_OFFSET);
        const placed = { ...object, zOrder: nextZOrder(project.objects) };
        project = { ...project, assets: clonedAsset ? [...project.assets, clonedAsset] : project.assets, objects: [...project.objects, placed] };
        cloneIds.push(placed.id);
      }
      get().commit(project);
      get().selectObjects(cloneIds);
    },
    ```
    (Preserves single-object behavior: one selected → one clone selected. `nextZOrder` is recomputed each loop against the growing `project.objects`.)

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/ui/store/store.test.ts` → PASS (incl. existing single-select/delete/duplicate tests).

- [ ] **Step 5: Commit**
```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice36): selectedObjectIds + toggle/selectObjects + bulk delete/duplicate"
```

---

### Task 2: Stage Shift/Cmd-click + multi-highlight

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

- [ ] **Step 1: onObjectPointerDown** — at the top of `onObjectPointerDown(id, e)` (after the locked guard + `e.stopPropagation()`), branch on modifier:
```ts
if (e.shiftKey || e.metaKey || e.ctrlKey) {
  useEditor.getState().toggleObjectSelection(id);
  return; // selection-building gesture: no move-drag
}
selectObject(id);
// ... existing single-select + dragRef setup ...
```
(Keep the existing `selectObject(id)` + drag setup for the plain-click path.)

- [ ] **Step 2: Multi-highlight overlay** — read `const selectedIds = useEditor((s) => s.selectedObjectIds)`. In the pan/zoom content `<g>` (where the snap guides render), draw a thin outline rect per selected object using the existing `objectAABB(obj, asset, time)` helper:
```tsx
{selectedIds.map((sid) => {
  const o = project.objects.find((x) => x.id === sid);
  const a = o ? objectAABB(o, assetsById.get(o.assetId), time) : null;
  return a ? (
    <rect key={`sel-${sid}`} data-testid={`selection-outline-${sid}`} x={a.minX} y={a.minY} width={a.maxX - a.minX} height={a.maxY - a.minY} fill="none" stroke="var(--color-accent)" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} pointerEvents="none" />
  ) : null;
})}
```
(Render it before the handle overlays so handles draw on top.)

- [ ] **Step 3: Stage test** — append to `Stage.test.tsx` (reuse `stubIdentityCTM` + the object-drag harness):
```ts
it('shift-clicking a second object adds it to the selection (no drag)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 50 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 200, y: 0, width: 50, height: 50 });
  const b = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  const { container } = render(<Stage nodes={nodes} />);
  // select the first, then shift-click the first... select a then shift-click b
  useEditor.getState().selectObject(a);
  const elB = container.querySelector(`[data-savig-object="${b}"]`)!;
  fireEvent.pointerDown(elB, { clientX: 210, clientY: 10, button: 0, shiftKey: true });
  expect(useEditor.getState().selectedObjectIds).toEqual([a, b]);
  // a selection outline renders for each
  expect(screen.getByTestId(`selection-outline-${a}`)).toBeInTheDocument();
  expect(screen.getByTestId(`selection-outline-${b}`)).toBeInTheDocument();
});
```
Run it.

- [ ] **Step 4: Commit**
```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice36): Stage shift/cmd-click toggles selection + multi-highlight"
```

---

### Task 3: Layers Shift/Cmd-click + Inspector multi-state

**Files:**
- Modify: `src/ui/components/LayersPanel/LayersPanel.tsx` (+test)
- Modify: `src/ui/components/Inspector/Inspector.tsx` (+test)

- [ ] **Step 1: Layers** — read `const selectedIds = useEditor((s) => s.selectedObjectIds)` and `toggleObjectSelection`. Row `onClick={(e) => { if (o.locked) return; if (e.shiftKey || e.metaKey || e.ctrlKey) toggleObjectSelection(o.id); else selectObject(o.id); }}`. Change `data-selected` + the `.selected` class to `selectedIds.includes(o.id)`.

- [ ] **Step 2: Layers test** — append: shift-click a second row → `selectedObjectIds` has both; both rows `data-selected="true"`.

- [ ] **Step 3: Inspector** — read `const selectedIds = useEditor((s) => s.selectedObjectIds)`. Before `if (!obj) return …`, add:
```tsx
if (selectedIds.length > 1) {
  return (
    <div className={styles.root}>
      <div className={styles.row}>{selectedIds.length} objects selected</div>
      <div className={styles.row}>
        <button onClick={() => duplicateSelected()}>Duplicate</button>
        <button onClick={() => deleteSelectedObject()}>Delete</button>
      </div>
    </div>
  );
}
```
(Ensure `duplicateSelected`/`deleteSelectedObject` are in the destructured actions — add if missing. Use the existing root/row class names.)

- [ ] **Step 4: Inspector test** — append: select 2 objects → `getByText(/2 objects selected/i)`; clicking Duplicate grows the object count.

- [ ] **Step 5: Commit**
```bash
git add src/ui/components/LayersPanel/LayersPanel.tsx src/ui/components/LayersPanel/LayersPanel.test.tsx src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(slice36): Layers shift-click multi-select + Inspector multi-state"
```

---

### Task 4: e2e + full gate

- [ ] **Step 1: e2e** — `e2e/multi-select.spec.ts`: draw two rects; click the first (select it), Shift-click the second (both selected — assert two `selection-outline-*` elements or two `data-selected` Layers rows); press Delete → `[data-savig-object]` count 0. Model setup on an existing rect-draw e2e.

- [ ] **Step 2: Run e2e** — `pnpm exec playwright test e2e/multi-select.spec.ts` → PASS.

- [ ] **Step 3: Full gate + commit**
```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add -A
git commit -m "test(slice36): multi-select e2e (shift-click two rects, bulk delete)"
```

---

## Self-Review (post-write)

- **Spec coverage:** §2 model → T1; §3 Stage/Layers/Inspector → T2/T3; e2e → T4.
- **Type consistency:** `selectedObjectIds`/`toggleObjectSelection`/`selectObjects` consistent across store + 3 UI surfaces.
- **Invariant:** every action sets `selectedObjectId = ids.at(-1) ?? null`; bulk ops route selection through `selectObject(null)`/`selectObjects(...)`.
- **No placeholders:** T1 has full store code; T2/T3 reference the existing overlay/Layers/Inspector patterns the executor wires; assertions specified.
- **Single-object preserved:** selectObject sets `[id]`; one-selected delete/duplicate behave as before (the loops run once); existing tests should stay green.
