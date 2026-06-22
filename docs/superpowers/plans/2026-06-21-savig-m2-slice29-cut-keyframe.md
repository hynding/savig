# Slice 29 Cut Keyframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cmd/Ctrl+X on a selected keyframe cuts it (copy + remove), completing the keyframe clipboard.

**Architecture:** Extract the 6-branch keyframe-removal routing from the `useKeyboard` Delete chain into a `deleteSelectedKeyframe()` store action; add `cutKeyframe()` = `copyKeyframe()` + `deleteSelectedKeyframe()`. Rewire Delete to call `deleteSelectedKeyframe` (DRY, behaviour-preserving) and Cmd/Ctrl+X to route `kfSelected ? cutKeyframe : cut`. Editor-only — thin compositions of existing actions.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- `deleteSelectedKeyframe()` routes the SAME order as the existing Delete chain: progress → gradient → color → dash → shape → scalar (the `remove*` actions: `removeSelectedProgressKeyframe`, `removeSelectedGradientKeyframe`, `removeSelectedColorKeyframe`, `removeSelectedDashKeyframe`, `removeShapeKeyframe`, `removeSelectedKeyframe`); no-op if no keyframe selected.
- `cutKeyframe()` = `copyKeyframe()` (snapshot to `keyframeClipboard`, no commit) THEN `deleteSelectedKeyframe()` (one commit, clears selection). The copy must precede the delete.
- Keyboard: Delete uses `deleteSelectedKeyframe` (replacing the 6 inline branches, gated by the existing `kfSelected`); Cmd/Ctrl+X → `kfSelected ? cutKeyframe() : cut()`.
- Editor-only: no engine/store-shape/persistence/render/runtime/export/migration change (v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Store — `deleteSelectedKeyframe` + `cutKeyframe`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: existing `removeSelectedProgressKeyframe`/`removeSelectedGradientKeyframe`/`removeSelectedColorKeyframe`/`removeSelectedDashKeyframe`/`removeShapeKeyframe`/`removeSelectedKeyframe`, `copyKeyframe`, `pasteKeyframe` (all already in `store.ts`).
- Produces: actions `deleteSelectedKeyframe(): void`, `cutKeyframe(): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('deleteSelectedKeyframe / cutKeyframe', () => {
  beforeEach(() => useEditor.setState({ keyframeClipboard: null, clipboard: null }));

  it('deleteSelectedKeyframe removes the selected SCALAR keyframe (no-op if none)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 30);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().deleteSelectedKeyframe();
    expect(useEditor.getState().history.present.objects[0].tracks.rotation ?? []).toHaveLength(0);
    const past = useEditor.getState().history.past.length;
    useEditor.getState().deleteSelectedKeyframe(); // nothing selected -> no-op
    expect(useEditor.getState().history.past.length).toBe(past);
  });

  it('deleteSelectedKeyframe removes a selected COLOR keyframe', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setVectorColor('fill', '#abcdef');
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().deleteSelectedKeyframe();
    expect(useEditor.getState().history.present.objects[0].colorTracks?.fill ?? []).toHaveLength(0);
  });

  it('deleteSelectedKeyframe removes a selected SHAPE keyframe', () => {
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    useEditor.getState().deleteSelectedKeyframe();
    expect(useEditor.getState().history.present.objects[0].shapeTrack ?? []).not.toContainEqual(
      expect.objectContaining({ time: 0 }),
    );
  });

  it('cutKeyframe snapshots into the clipboard then removes; paste re-inserts at a new time', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 45);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().cutKeyframe();
    expect(useEditor.getState().keyframeClipboard?.kind).toBe('scalar'); // snapshotted
    expect(useEditor.getState().history.present.objects[0].tracks.rotation ?? []).toHaveLength(0); // removed
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    const track = useEditor.getState().history.present.objects[0].tracks.rotation!;
    expect(track.find((k) => Math.abs(k.time - 1) < 1e-6)!.value).toBe(45); // round-trips
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "deleteSelectedKeyframe / cutKeyframe"`
Expected: FAIL — `deleteSelectedKeyframe` / `cutKeyframe` undefined.

- [ ] **Step 3: Add the interface entries + actions**

In `src/ui/store/store.ts`, add to the actions interface (next to `pasteKeyframe(): void;`):

```ts
  deleteSelectedKeyframe(): void;
  cutKeyframe(): void;
```

Add the actions immediately after `pasteKeyframe` (before `retimeSelectedKeyframe`):

```ts
  deleteSelectedKeyframe() {
    const s = get();
    if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
    else if (s.selectedGradientKeyframe) s.removeSelectedGradientKeyframe();
    else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
    else if (s.selectedDashKeyframe) s.removeSelectedDashKeyframe();
    else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
    else if (s.selectedKeyframe) s.removeSelectedKeyframe();
  },
  cutKeyframe() {
    get().copyKeyframe(); // snapshot into keyframeClipboard (S24); no commit
    get().deleteSelectedKeyframe(); // then remove it (one commit)
  },
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "deleteSelectedKeyframe / cutKeyframe"`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice29): deleteSelectedKeyframe + cutKeyframe store actions"
```

---

### Task 2: Keyboard wiring (DRY Delete + Cmd/Ctrl+X) + e2e

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/hooks/useKeyboard.test.ts`
- Create: `e2e/cut-keyframe.spec.ts`

**Interfaces:**
- Consumes: store `deleteSelectedKeyframe`/`cutKeyframe`/`cut`/`pasteKeyframe` (Task 1 + existing).

- [ ] **Step 1: Write the failing keyboard tests**

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('Cmd/Ctrl+X cuts the SELECTED KEYFRAME (not the object)', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null, keyframeClipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const id = useEditor.getState().selectedObjectId!;
  s.seek(0);
  s.setProperty('rotation', 30);
  s.selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
  fireEvent.keyDown(window, { key: 'x', metaKey: true });
  expect(useEditor.getState().keyframeClipboard?.kind).toBe('scalar'); // cut into the keyframe clipboard
  expect(useEditor.getState().history.present.objects[0].tracks.rotation ?? []).toHaveLength(0); // removed
  expect(useEditor.getState().history.present.objects).toHaveLength(1); // object NOT cut
});

it('Delete removes the selected keyframe via the shared action', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const id = useEditor.getState().selectedObjectId!;
  s.seek(0);
  s.setProperty('x', 5);
  s.selectKeyframe({ objectId: id, property: 'x', time: 0 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects[0].tracks.x ?? []).toHaveLength(0);
  expect(useEditor.getState().history.present.objects).toHaveLength(1); // object kept
});
```

> The existing keyboard tests already cover "Cmd/Ctrl+X cuts the object" (no keyframe
> selected) and "Delete removes the selected object when no keyframe is selected" — those
> must still pass after the rewire (regression guards).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts -t "cuts the SELECTED KEYFRAME"`
Expected: FAIL — Cmd/Ctrl+X currently no-ops while a keyframe is selected.

- [ ] **Step 3: Rewire the Delete chain + Cmd/Ctrl+X**

In `src/ui/hooks/useKeyboard.ts`:

1. Replace the six inline keyframe branches in the Delete case:

```ts
        case 'Delete':
        case 'Backspace':
          if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
          else if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
          else if (s.selectedGradientKeyframe) s.removeSelectedGradientKeyframe();
          else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
          else if (s.selectedDashKeyframe) s.removeSelectedDashKeyframe();
          else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
          else if (s.selectedKeyframe) s.removeSelectedKeyframe();
          else if (s.selectedObjectId) s.deleteSelectedObject();
          break;
```

with:

```ts
        case 'Delete':
        case 'Backspace':
          if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
          else if (kfSelected) s.deleteSelectedKeyframe();
          else if (s.selectedObjectId) s.deleteSelectedObject();
          break;
```

(`kfSelected` is already computed earlier in the handler and is in scope in the `switch`.)

2. Replace the Cmd/Ctrl+X block:

```ts
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        if (!kfSelected) s.cut(); // cut-keyframe deferred: X is a no-op while a keyframe is selected
        return;
      }
```

with:

```ts
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        if (kfSelected) s.cutKeyframe();
        else s.cut();
        return;
      }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: PASS (the 2 new tests + all existing keyboard tests, incl. the Delete-removes-object, Cmd+X-cuts-object, and the per-type Delete-removes-keyframe tests).

- [ ] **Step 5: Write the e2e**

Create `e2e/cut-keyframe.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('cut a keyframe and paste it at a new time', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (auto-selected); key rotation at t=0 via the Inspector.
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  const rotField = page.getByLabel('rotation', { exact: true });
  await rotField.fill('40');
  await rotField.blur();

  // Select the rotation diamond at t=0, cut it.
  await page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first().click();
  await page.keyboard.press('ControlOrMeta+KeyX');
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]')).toHaveCount(0);

  // Move the playhead to t=1 and paste it back.
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await page.keyboard.press('ControlOrMeta+KeyV');
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(1);
});
```

- [ ] **Step 6: Run the e2e**

Run: `pnpm exec playwright test e2e/cut-keyframe.spec.ts`
Expected: PASS.

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts e2e/cut-keyframe.spec.ts
git commit -m "feat(slice29): Cmd/Ctrl+X cuts a selected keyframe; Delete uses the shared action + e2e"
```

---

## Self-Review (plan vs spec)

- **§2 `deleteSelectedKeyframe` (6-branch, same order; no-op if none) + `cutKeyframe` (copy then delete)** → Task 1 Step 3 + the scalar/color/shape delete tests + the cut-round-trip test. ✅
- **§3 Delete uses `deleteSelectedKeyframe` (DRY, behaviour-preserving); Cmd/Ctrl+X routes kfSelected** → Task 2 Step 3 + the Cmd+X-cuts-keyframe + Delete-removes-keyframe tests (and the existing object-cut / object-delete regression guards). ✅
- **§4 editor-only (thin compositions; no engine/persistence)** → only `store.ts` + `useKeyboard.ts` + tests + one e2e. ✅
- **§5 edges (no-kf no-op; cut→paste round-trip; behaviour-preserving extraction)** → the no-op assertion + the cut-round-trip store test + the e2e. ✅
- **§8 testing (store ×4, keyboard ×2, e2e)** → Tasks 1–2. ✅
- **Type/name consistency:** `deleteSelectedKeyframe()` / `cutKeyframe()` identical in interface, store, keyboard, and tests; the 6 `remove*` names match the existing Delete chain (`removeShapeKeyframe` for shape, the rest `removeSelected*`); `kfSelected` is the existing boolean. ✅
- **Placeholder scan:** every step carries concrete code; the e2e mirrors the proven keyframe-clipboard / retime specs (diamond testids, ruler click, ControlOrMeta). ✅
