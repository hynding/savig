# Animated Boolean — Slice 2: Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alt+(boolean button or `Cmd/Ctrl+Shift+U/S/I/E`) creates a LIVE boolean from the selected vector leaves — a `SceneObject.boolean` node that keeps its operands and animates (Slice 1's render) — coexisting with the destructive boolean.

**Architecture:** Extend `booleanOp(op)` to `booleanOp(op, opts?: { live?: boolean })`; the `live` branch (after the shared eligibility computation) creates a `boolean`-field node from the selected non-group, non-boolean vector leaves, keeps the operands, selects the result, and commits — no clip/bake/removal. The Inspector buttons + keyboard shortcuts read `e.altKey` to set `live`.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- Live operands are selected NON-GROUP vector leaves that are NOT themselves live booleans (groups + nested live booleans deferred).
- Live op KEEPS its operands (no removal, no asset prune); the destructive path (no `opts.live`) is byte-identical to today.
- The live boolean node: path-typed `VectorAsset` (style from the topmost operand leaf, empty fallback `path`), `boolean: { op, operandIds }`, identity transform (`{ ...DEFAULT_TRANSFORM }`), selected after creation. One `commit` → undoable.
- Self-gate: `< 2` eligible leaf operands → no-op (never a silent partial op).
- `operandIds` order follows `s.selectedObjectIds`.
- Root-scene only (Slice 1 boundary).

---

### Task 1: `booleanOp(op, opts?)` live branch (store)

**Files:**
- Modify: `src/ui/store/store.ts` (interface decl line 272; `booleanOp` action line 1790, branch after `eligible` at ~1811)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: existing `activeObjects`, `project`, `activeAssetId`, `nextZOrder`, `withSceneObjects`, `createVectorAsset`, `createSceneObject`, `DEFAULT_TRANSFORM` (all in scope in `booleanOp`); `SceneObject.boolean` (Slice 1).
- Produces: `booleanOp(op: BoolOp, opts?: { live?: boolean }): void`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/store/store.test.ts (module-scope helpers addVectorShape/groupSelected exist)
describe('live boolean authoring (booleanOp live)', () => {
  function twoRects() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
    const a = useEditor.getState().selectedObjectId!;
    s.addVectorShape('rect', { x: 10, y: 0, width: 20, height: 20 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    return { a, b };
  }

  it('creates a boolean node, keeps the operands, selects the result, path-typed asset w/ topmost style', () => {
    const { a, b } = twoRects();
    const before = useEditor.getState().history.present.objects.length; // 2
    useEditor.getState().booleanOp('union', { live: true });
    const proj = useEditor.getState().history.present;
    expect(proj.objects.length).toBe(before + 1); // operands kept + 1 result
    const resultId = useEditor.getState().selectedObjectId!;
    const result = proj.objects.find((o) => o.id === resultId)!;
    expect(result.boolean).toEqual({ op: 'union', operandIds: [a, b] });
    expect(proj.objects.some((o) => o.id === a)).toBe(true);
    expect(proj.objects.some((o) => o.id === b)).toBe(true);
    const asset = proj.assets.find((x) => x.id === result.assetId) as VectorAsset;
    expect(asset.shapeType).toBe('path');
  });

  it('is undoable: undo removes the result and leaves the operands untouched', () => {
    const { a, b } = twoRects();
    useEditor.getState().booleanOp('union', { live: true });
    const resultId = useEditor.getState().selectedObjectId!;
    useEditor.getState().undo();
    const proj = useEditor.getState().history.present;
    expect(proj.objects.some((o) => o.id === resultId)).toBe(false);
    expect(proj.objects.some((o) => o.id === a)).toBe(true);
    expect(proj.objects.some((o) => o.id === b)).toBe(true);
  });

  it('self-gates: one leaf + one group selected -> no-op (only 1 leaf operand)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
    const leaf = useEditor.getState().selectedObjectId!;
    s.addVectorShape('rect', { x: 40, y: 0, width: 20, height: 20 });
    const g1 = useEditor.getState().selectedObjectId!;
    s.addVectorShape('rect', { x: 60, y: 0, width: 20, height: 20 });
    const g2 = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([g1, g2]);
    useEditor.getState().groupSelected();
    const groupId = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([leaf, groupId]);
    const before = useEditor.getState().history.present.objects.length;
    useEditor.getState().booleanOp('union', { live: true });
    expect(useEditor.getState().history.present.objects.length).toBe(before); // unchanged
  });

  it('excludes a nested live boolean operand', () => {
    const { a, b } = twoRects();
    useEditor.getState().booleanOp('union', { live: true });
    const liveBoolId = useEditor.getState().selectedObjectId!;
    // select the live boolean + ONE leaf -> only 1 real leaf operand -> no-op
    useEditor.getState().selectObjects([liveBoolId, a]);
    const before = useEditor.getState().history.present.objects.length;
    useEditor.getState().booleanOp('subtract', { live: true });
    expect(useEditor.getState().history.present.objects.length).toBe(before); // boolean excluded -> <2 -> no-op
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });

  it('non-live (no opts) stays destructive: removes operands + bakes', () => {
    const { a, b } = twoRects();
    const before = useEditor.getState().history.present.objects.length; // 2
    useEditor.getState().booleanOp('union');
    const proj = useEditor.getState().history.present;
    expect(proj.objects.length).toBe(before - 1); // 2 operands -> 1 baked result
    const result = proj.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
    expect(result.boolean).toBeUndefined(); // destructive result is NOT a live boolean
    expect(proj.objects.some((o) => o.id === a)).toBe(false); // operands removed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "live boolean authoring"`
Expected: FAIL — `booleanOp('union', { live: true })` is a 1-arg call type error / the live branch doesn't exist (result has no `boolean` field; operands removed).

- [ ] **Step 3: Update the interface signature**

In `src/ui/store/store.ts` line 272:

```ts
booleanOp(op: BoolOp, opts?: { live?: boolean }): void;
```

- [ ] **Step 4: Add the live branch**

In the `booleanOp` action, immediately AFTER `eligible` is computed and BEFORE the existing
`if (eligible.length < 2) return;` destructive gate (store.ts ~1811), insert:

```ts
    if (opts?.live) {
      // Live operands = selected NON-GROUP vector leaves that are not themselves live booleans
      // (groups + nested live booleans deferred).
      const liveOperands = s.selectedObjectIds
        .map((id) => activeObjects.find((o) => o.id === id))
        .filter((o): o is SceneObject => {
          if (!o || o.isGroup || o.boolean) return false;
          const a = project.assets.find((x) => x.id === o.assetId);
          return a?.kind === 'vector';
        });
      if (liveOperands.length < 2) return; // self-gate: never a silent partial op

      const topLeaf = liveOperands.slice().sort((a, b) => b.zOrder - a.zOrder)[0];
      const topAsset = project.assets.find((x) => x.id === topLeaf.assetId) as VectorAsset;
      const asset = createVectorAsset('path', { path: { nodes: [], closed: false }, style: { ...topAsset.style } });
      const label = `${op[0].toUpperCase()}${op.slice(1)}`;
      const obj = createSceneObject(asset.id, {
        name: `Animated ${label} ${nextZOrder(activeObjects) + 1}`,
        zOrder: nextZOrder(activeObjects),
        anchorMode: 'fraction',
        anchorX: 0.5,
        anchorY: 0.5,
        base: { ...DEFAULT_TRANSFORM },
        boolean: { op, operandIds: liveOperands.map((o) => o.id) },
      });
      const nextObjects = [...activeObjects, obj];
      let nextProject = withSceneObjects(project, activeAssetId, nextObjects);
      nextProject = { ...nextProject, assets: [...nextProject.assets, asset] };
      get().commit(nextProject);
      set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null });
      return;
    }
```

> Implementer: confirm `booleanOp` already destructures/computes `s`, `activeObjects`, `project`, `activeAssetId`, `time` near its top (the destructive path uses them), so the live branch has them in scope. The action signature is `booleanOp(op, opts) { … }` — add the `opts` parameter.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "live boolean authoring"` then `pnpm vitest run src/ui/store/store.test.ts -t "booleanOp"` (destructive parity) then `pnpm typecheck`
Expected: live tests pass; existing destructive `booleanOp` tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(boolean): booleanOp live branch — author a live boolean from the selection"
```

---

### Task 2: Alt modifier UI (Inspector buttons + keyboard) + e2e

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx` (4 boolean buttons, ~230-233)
- Modify: `src/ui/hooks/useKeyboard.ts` (4 shortcuts, ~39-42)
- Test: `src/ui/components/Inspector/Inspector.test.tsx`
- Test: `e2e/boolean-ops.spec.ts`

**Interfaces:**
- Consumes: `booleanOp(op, opts?)` (Task 1).

- [ ] **Step 1: Write the failing Inspector test**

```ts
// append to src/ui/components/Inspector/Inspector.test.tsx (reuse its existing render/store setup;
// match the helper that selects ≥2 vector objects and renders <Inspector/>)
it('Alt+click a boolean button routes to the LIVE boolean (operands kept, result has .boolean)', () => {
  // Build two overlapping rects and select both (mirror this file's existing selection setup).
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 10, y: 0, width: 20, height: 20 });
  const b = useEditor.getState().selectedObjectId!;
  act(() => { useEditor.getState().selectObjects([a, b]); });
  render(<Inspector />);
  // Alt+click Union -> live boolean (operands kept, result has .boolean)
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Union' }), { altKey: true }); });
  const proj = useEditor.getState().history.present;
  const result = proj.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
  expect(result.boolean).toEqual({ op: 'union', operandIds: [a, b] });
  expect(proj.objects.some((o) => o.id === a)).toBe(true); // operands kept (live, not destructive)
});
```

> Implementer: match the existing Inspector test's import list (`render`/`screen`/`fireEvent`/`act`, `useEditor`, `Inspector`, `addVectorShape` via the store). If this file lacks a "select 2 vector objects" path, build it inline as above. The button accessible name is its text (`Union`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx -t "Alt+click"`
Expected: FAIL — plain `booleanOp('union')` runs (destructive: operands removed, result has no `.boolean`).

- [ ] **Step 3: Wire the Inspector buttons**

In `src/ui/components/Inspector/Inspector.tsx` (~230-233), pass `{ live: e.altKey }` and add titles:

```tsx
<button disabled={!canBool} title="Alt: animated (live) boolean" onClick={(e) => booleanOp('union', { live: e.altKey })}>Union</button>
<button disabled={!canBool} title="Alt: animated (live) boolean" onClick={(e) => booleanOp('subtract', { live: e.altKey })}>Subtract</button>
<button disabled={!canBool} title="Alt: animated (live) boolean" onClick={(e) => booleanOp('intersect', { live: e.altKey })}>Intersect</button>
<button disabled={!canBool} title="Alt: animated (live) boolean" onClick={(e) => booleanOp('exclude', { live: e.altKey })}>Exclude</button>
```

- [ ] **Step 4: Wire the keyboard shortcuts**

In `src/ui/hooks/useKeyboard.ts` (~39-42), pass `{ live: e.altKey }`:

```ts
if (mod && e.shiftKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); s.booleanOp('union', { live: e.altKey }); return; }
if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); s.booleanOp('subtract', { live: e.altKey }); return; }
if (mod && e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); s.booleanOp('intersect', { live: e.altKey }); return; }
if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); s.booleanOp('exclude', { live: e.altKey }); return; }
```

- [ ] **Step 5: Run the Inspector test + typecheck**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx` then `pnpm typecheck`
Expected: pass (incl. existing Inspector tests); typecheck clean.

- [ ] **Step 6: Add the e2e**

In `e2e/boolean-ops.spec.ts`, add a test that draws two **separate** (non-overlapping) rects, selects both, **Alt+click**s Union, and asserts BOTH operands persist (3 `[data-savig-object]`: 2 operands + 1 result) and the result renders a `<path>`. A DISJOINT union is still non-empty (2 rings), so no overlap is needed — which also avoids the "drawing onto an existing object grabs it" gotcha.

The `draw` helper is LOCAL to each test in this spec (not shared) — copy the established pattern (init script + `draw`) into the new test:

```ts
test('Alt+Union creates a live boolean that keeps its operands', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };
  await drawRect(80, 80, 200, 200); // two separate rects (disjoint union is still non-empty)
  await drawRect(260, 80, 380, 200);

  const stage = page.locator('section[aria-label="Stage"]');
  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  // select both: click the first, shift-click the second
  await objects.nth(0).click({ position: { x: 8, y: 8 } });
  await objects.nth(1).click({ modifiers: ['Shift'], position: { x: 8, y: 8 } });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  await page.getByRole('button', { name: 'Union', exact: true }).click({ modifiers: ['Alt'] });
  // live boolean keeps its operands: 2 operands + 1 result = 3 (destructive would collapse to 1)
  await expect(objects).toHaveCount(3);
  await expect(stage.locator('[data-savig-object] path').first()).toBeVisible();
});
```

> Implementer: adjust the rect coords / selection click positions to this spec's CTM if needed (mirror the existing tests). The `/2 objects selected/i` text appears when 2 objects are selected (used by the curve-preserving test). Scope queries to `section[aria-label="Stage"]` (project lesson 293ccf5).

- [ ] **Step 7: Run e2e + full suites**

First kill any stale Vite, then:

Run: `pnpm e2e e2e/boolean-ops.spec.ts` then `pnpm test` then `pnpm typecheck`
Expected: e2e passes (incl. the new test); full unit suite green; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx src/ui/hooks/useKeyboard.ts e2e/boolean-ops.spec.ts
git commit -m "feat(boolean): Alt modifier creates a live boolean (Inspector buttons + shortcuts) + e2e"
```

---

## Self-Review

**Spec coverage:**
- `booleanOp(op, opts?)` live branch (create node, keep operands, identity transform, style from topmost leaf, select, commit) → Task 1. ✓
- Self-gate <2 leaf operands; exclude groups + nested booleans → Task 1 (filter + gate) + tests. ✓
- Non-live parity (destructive unchanged) → Task 1 test. ✓
- Undoable → Task 1 test. ✓
- Alt modifier on Inspector buttons + titles → Task 2. ✓
- Alt modifier on keyboard shortcuts → Task 2. ✓
- e2e (Alt+Union keeps operands, renders) → Task 2. ✓

**Placeholder scan:** No TBD/TODO. Test setup defers to each file's existing store/render helpers, flagged inline with full assertion bodies.

**Type consistency:** `booleanOp(op: BoolOp, opts?: { live?: boolean })`, `boolean: { op, operandIds }`, `liveOperands`, identity `{ ...DEFAULT_TRANSFORM }` are named/typed identically across tasks. `opts.live` read via `e.altKey` in both UI sites.

## Notes / Risks
- The live branch is placed before the destructive `eligible.length < 2` gate; it self-gates on `liveOperands.length` (a subset), so a 1-eligible selection still no-ops for live.
- Destructive parity is bounded: the `opts` param defaults undefined → `opts?.live` falsy → existing path runs verbatim.
