# Per-Object Dashed Selection-Outline via entityAABB Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A group/instance member of a multi-selection gets its own dashed selection outline.

**Architecture:** Swap the per-object outline's `objectAABB` for the existing `entityAABB` dispatcher
in Stage.tsx. Editor-chrome only → parity untouched.

**Tech Stack:** React 18 + TS strict, Vitest + RTL.

## Global Constraints

- preview == export parity non-negotiable (preserved: selection-chrome only).
- TS strict; no `any`. `entityAABB` is already imported in Stage.tsx.

---

### Task 1: Route the dashed outline through entityAABB

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (the per-object outline map, ~line 1871).
- Test: `src/ui/components/Stage/Stage.test.tsx`.

**Interfaces:**
- Consumes: `entityAABB(obj, objects, assets, time)` (already imported); the edit-scoped `project`.

- [ ] **Step 1: Write the failing Stage test**

Append to `Stage.test.tsx` (mirror the multi-select-outline test at ~866 for the selection gesture and
the instance-handles test at ~1251 for the symbol fixture). Build a project with a plain rect AND a
symbol instance; select both; assert the instance's outline renders:

```tsx
it('draws a dashed selection-outline for a symbol instance in a multi-selection (47b polish)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  // a plain rect (selectable, has an objectAABB)
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 50 });
  const a = useEditor.getState().selectedObjectId!;
  // a symbol instance (objectAABB is null for it; entityAABB -> instanceAABB)
  const project = useEditor.getState().history.present;
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10, base: { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  act(() => {
    useEditor.getState().commit({ ...project, assets: [...project.assets, inner, sym], objects: [...project.objects, instance] });
    useEditor.getState().setSelectedObjects([a, 'inst']);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('selection-outline-inst')).toBeInTheDocument(); // was absent under objectAABB
  expect(screen.getByTestId(`selection-outline-${a}`)).toBeInTheDocument();
});
```

NOTE before running: confirm the multi-select API used to select both ids — the existing test at ~866
builds the multi-selection via a shift-click pointer gesture; check whether a direct store action
(`setSelectedObjects`/`selectObjects`/`toggleObjectOrGroup`) exists and use the real name. Confirm
`createVectorAsset`/`createSceneObject`/`createSymbolAsset` are imported in Stage.test.tsx (they are —
the slice-47a test at the top uses them). Confirm `act` is imported. If no bulk-select store action
exists, build the selection with the same shift-click gesture the ~866 test uses (pointerDown on the
instance leaf with `shiftKey: true` after selecting `a`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/components/Stage/Stage.test.tsx -t "dashed selection-outline for a symbol instance"`
Expected: FAIL — `selection-outline-inst` absent (objectAABB returns null for the instance).

- [ ] **Step 3: Make the swap**

In `src/ui/components/Stage/Stage.tsx`, in the per-object outline map (~line 1871), change:

```tsx
const a = o && !o.hidden ? objectAABB(o, assetsById.get(o.assetId), time) : null;
```

to:

```tsx
const a = o && !o.hidden ? entityAABB(o, project.objects, project.assets, time) : null;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/components/Stage/Stage.test.tsx -t "dashed selection-outline for a symbol instance"`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `npx vitest run src/ui/components/Stage && npm run typecheck && npx eslint src/ui/components/Stage/Stage.tsx`
Expected: all green. If `objectAABB` becomes unused in Stage.tsx after the swap, remove it from the
import (verify with eslint — it is used elsewhere in the file at lines ~662/699/1213, so it likely
stays).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "fix(stage): per-object dashed selection-outline spans groups & instances via entityAABB (47b polish)"
```

---

## Self-Review

- **Spec coverage:** the one-line swap (Step 3) + the instance-outline test (Step 1) cover the spec.
- **Placeholder scan:** the "NOTE before running" verifies the real multi-select API + imports — a
  concrete check with a fallback (the shift-click gesture from the ~866 test).
- **Type consistency:** `entityAABB(o, project.objects, project.assets, time)` matches the signature
  used by `multiSelectionAABB`/single-select bounds in the same file.
