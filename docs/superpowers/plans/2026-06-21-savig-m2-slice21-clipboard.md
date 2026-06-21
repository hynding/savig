# Slice 21 Object Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an object clipboard — Cmd/Ctrl+C copies the selected object, +X cuts, +V pastes a copy.

**Architecture:** A transient `clipboard: { object; asset? } | null` store field (outside `TRANSIENT_DEFAULTS`, so it survives `newProject`). `copySelected`/`cut`/`paste` store actions; `paste` reuses the existing `duplicateObject` engine helper and re-adds a missing asset for cross-project paste. `useKeyboard` maps Cmd/Ctrl+C/X/V to the actions, before the tool-switch and under the existing `isEditable` guard. Editor-only: no persistence/render/runtime/migration change.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- `clipboard: { object: SceneObject; asset?: Asset } | null` is **transient** (not in `history`, **not** in `TRANSIENT_DEFAULTS`) with initial value `null` — it survives `newProject`/`loadProject` so a copied object can be pasted into a new project.
- The store is immutable (edits `commit` new `{...obj}` refs), so the references captured at copy time are a frozen snapshot — NO deep clone at copy time.
- `copySelected`/`cut` are no-ops when nothing is selected; `paste` is a no-op with an empty clipboard. `paste` is exactly ONE `commit` (one undo step) and selects the new copy.
- `paste` reuses `duplicateObject(clip.object, clip.asset, { objectId: newId(), assetId: newId() }, DUP_OFFSET)`, places at `nextZOrder`, and re-adds the asset if absent (clonedAsset for a vector asset; `clip.asset` if a shared/svg asset is missing — cross-project paste).
- `cut` = `copySelected()` + `deleteSelectedObject()` (already lock-guarded → cut of a locked object copies but does not remove).
- Keyboard Cmd/Ctrl+C/X/V live in the `mod` block BEFORE the `switch` (so `Cmd+V` ≠ bare `v` select-tool), each `preventDefault` + `return`; the existing `isEditable(e.target)` early-return keeps native text-field copy/paste intact.
- Editor-only: NO persistence/render/runtime/migration change. Stays v4.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Store — clipboard state + `copySelected` / `cut` / `paste`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: existing `duplicateObject` (engine), `newId`, `DUP_OFFSET`, `nextZOrder`, `deleteSelectedObject`, `selectObject` (all already in `store.ts`).
- Produces: state `clipboard: { object: SceneObject; asset?: Asset } | null`; actions `copySelected(): void`, `cut(): void`, `paste(): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('clipboard (copy/cut/paste)', () => {
  it('copySelected snapshots the selected object; paste adds an offset copy (one undo step)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    const src = useEditor.getState().history.present.objects[0];
    useEditor.getState().copySelected();
    expect(useEditor.getState().clipboard?.object.id).toBe(id);
    const past = useEditor.getState().history.past.length;
    useEditor.getState().paste();
    const objs = useEditor.getState().history.present.objects;
    expect(objs).toHaveLength(2);
    const copy = objs.find((o) => o.id !== id)!;
    expect(copy.id).not.toBe(id); // fresh id
    expect(copy.base.x).toBe(src.base.x + 10); // DUP_OFFSET
    expect(copy.name).toBe(`${src.name} copy`);
    expect(useEditor.getState().selectedObjectId).toBe(copy.id); // copy selected
    expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit
  });
  it('paste clones a vector object onto an independent asset', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const srcAssetId = useEditor.getState().history.present.objects[0].assetId;
    useEditor.getState().copySelected();
    useEditor.getState().paste();
    const copy = useEditor.getState().history.present.objects.at(-1)!;
    expect(copy.assetId).not.toBe(srcAssetId); // independent cloned asset
    expect(useEditor.getState().history.present.assets.some((a) => a.id === copy.assetId)).toBe(true);
  });
  it('copySelected is a no-op with nothing selected; paste is a no-op with an empty clipboard', () => {
    useEditor.getState().selectObject(null);
    useEditor.getState().copySelected();
    expect(useEditor.getState().clipboard).toBeNull();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().paste();
    expect(useEditor.getState().history.past.length).toBe(past); // no commit
  });
  it('the clipboard snapshot is frozen — editing the source after copy does not change the paste', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    useEditor.getState().copySelected();
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 500); // edit the source after copying
    useEditor.getState().paste();
    const copy = useEditor.getState().history.present.objects.at(-1)!;
    expect(copy.base.x).toBe(0 + 10); // from the frozen snapshot (x=0), NOT 500
  });
  it('cut copies then deletes the selected object', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().cut();
    expect(useEditor.getState().clipboard?.object.id).toBe(id);
    expect(useEditor.getState().history.present.objects).toHaveLength(0); // removed
  });
  it('cut of a locked object copies it but does not remove it', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id); // locks + deselects
    useEditor.getState().selectObject(id); // re-select (out-of-band, like the Slice-19 residual)
    useEditor.getState().cut();
    expect(useEditor.getState().clipboard?.object.id).toBe(id);
    expect(useEditor.getState().history.present.objects).toHaveLength(1); // NOT deleted (locked)
  });
  it('cross-project paste re-adds a missing imported-svg asset', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
    useEditor.getState().addAsset({ id: 'svg1', kind: 'svg', name: 'box', normalizedContent: svg, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('svg1');
    useEditor.getState().copySelected();
    useEditor.getState().newProject(); // clipboard survives; project (and its assets) reset
    useEditor.getState().paste();
    const copy = useEditor.getState().history.present.objects.at(-1)!;
    expect(useEditor.getState().history.present.assets.some((a) => a.id === copy.assetId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "clipboard"`
Expected: FAIL — `clipboard` / `copySelected` / `cut` / `paste` undefined.

- [ ] **Step 3: Add the state field**

In `src/ui/store/store.ts`, find the state-shape interface where `selectedObjectId: string | null;` is declared (the `EditorState` actions+state interface) and add, near it:

```ts
  clipboard: { object: SceneObject; asset?: Asset } | null;
```

Then in the store creator's initial state — where `...TRANSIENT_DEFAULTS,` is spread for the initial `set` (the object literal that also holds `history`/the actions, NOT inside `TRANSIENT_DEFAULTS` itself) — add the initial value so it survives `newProject`:

```ts
  clipboard: null as { object: SceneObject; asset?: Asset } | null,
```

> `Asset` and `SceneObject` are already imported as types in `store.ts`. Do NOT add `clipboard` to `TRANSIENT_DEFAULTS` — it must persist across `newProject`/`loadProject`.

- [ ] **Step 4: Add the interface entries + actions**

In the actions interface (near `duplicateSelected(): void;`):

```ts
  copySelected(): void;
  cut(): void;
  paste(): void;
```

Add the actions next to `duplicateSelected` in the store body:

```ts
  copySelected() {
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === get().selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    set({ clipboard: { object: obj, asset } }); // immutable refs = frozen snapshot
  },
  cut() {
    get().copySelected();
    get().deleteSelectedObject(); // lock-guarded
  },
  paste() {
    const clip = get().clipboard;
    if (!clip) return;
    const project = get().history.present;
    const { object, clonedAsset } = duplicateObject(
      clip.object,
      clip.asset,
      { objectId: newId(), assetId: newId() },
      DUP_OFFSET,
    );
    const placed = { ...object, zOrder: nextZOrder(project.objects) };
    let assets = project.assets;
    if (clonedAsset) assets = [...assets, clonedAsset];
    else if (clip.asset && !assets.some((a) => a.id === placed.assetId)) assets = [...assets, clip.asset];
    get().commit({ ...project, assets, objects: [...project.objects, placed] });
    get().selectObject(placed.id);
  },
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "clipboard"`
Expected: PASS (all 7).

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice21): store clipboard + copySelected/cut/paste (reuses duplicateObject)"
```

---

### Task 2: Keyboard shortcuts + e2e

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/hooks/useKeyboard.test.ts`
- Create: `e2e/clipboard.spec.ts`

**Interfaces:**
- Consumes: store `copySelected`/`cut`/`paste` (Task 1).

- [ ] **Step 1: Write the failing keyboard tests**

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('Cmd/Ctrl+C then Cmd/Ctrl+V copies and pastes the selected object', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  fireEvent.keyDown(window, { key: 'c', metaKey: true });
  expect(useEditor.getState().clipboard).not.toBeNull();
  fireEvent.keyDown(window, { key: 'v', metaKey: true });
  expect(useEditor.getState().history.present.objects).toHaveLength(2);
});

it('Cmd/Ctrl+X cuts the selected object', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  fireEvent.keyDown(window, { key: 'x', metaKey: true });
  expect(useEditor.getState().clipboard).not.toBeNull();
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
});

it('does not hijack copy/paste while typing in an input', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: 'c', metaKey: true });
  expect(useEditor.getState().clipboard).toBeNull(); // native copy, not the object clipboard
  input.remove();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts -t "Cmd"`
Expected: FAIL — `Cmd+C`/`+X`/`+V` are not wired (and bare `v` would change the tool, not paste).

- [ ] **Step 3: Wire the shortcuts**

In `src/ui/hooks/useKeyboard.ts`, immediately after the existing `Cmd+D` block (`if (mod && (e.key === 'd' || e.key === 'D')) { … return; }`), add:

```ts
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        s.copySelected();
        return;
      }
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        s.cut();
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        s.paste();
        return;
      }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: PASS (3 new + all existing keyboard tests).

- [ ] **Step 5: Write the e2e**

Create `e2e/clipboard.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('copy and paste an object via the keyboard', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (auto-selected).
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
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);

  // Move focus off the stage tool button so the shortcut hits the window handler,
  // then copy + paste. ControlOrMeta = Cmd on macOS, Ctrl elsewhere.
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('ControlOrMeta+KeyC');
  await page.keyboard.press('ControlOrMeta+KeyV');

  await expect(page.locator('[data-savig-object]')).toHaveCount(2);
});
```

- [ ] **Step 6: Run the e2e**

Run: `pnpm exec playwright test e2e/clipboard.spec.ts`
Expected: PASS.

> If the `body` click lands on empty canvas and deselects the rect before copy, instead click a neutral chrome area that does not deselect — but the copy reads `selectedObjectId`, so verify the rect is still selected after the focus click; if not, drop the focus click (the draw already leaves the window focused) and press the shortcuts directly.

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts e2e/clipboard.spec.ts
git commit -m "feat(slice21): Cmd/Ctrl+C/X/V copy/cut/paste shortcuts + e2e"
```

---

## Self-Review (plan vs spec)

- **§2 transient `clipboard` outside `TRANSIENT_DEFAULTS` (survives newProject); frozen-by-immutability**
  → Task 1 Step 3 + the frozen-snapshot test + the cross-project test. ✅
- **§3 `copySelected`/`cut`/`paste` (no-ops; one undo step; reuse `duplicateObject`; asset re-add)**
  → Task 1 Step 4 + 7 store tests. ✅
- **§4 keyboard Cmd/Ctrl+C/X/V before the switch, under `isEditable`**
  → Task 2 Step 3 + the 3 keyboard tests (incl. the input-guard test). ✅
- **§5 editor-only (no persistence/render/runtime/migration)** → only store + useKeyboard + one e2e touched. ✅
- **§6 edges (cut-locked copies-not-deletes; cross-project paste re-adds asset)** → the cut-locked + cross-project store tests. ✅
- **§9 testing (store ×7, keyboard ×3, e2e)** → Tasks 1–2. ✅
- **Type/name consistency:** `clipboard: { object: SceneObject; asset?: Asset } | null` identical in the state field, initial value, and action bodies; `copySelected`/`cut`/`paste` names match across interface, store, and keyboard. `DUP_OFFSET` (=10) is the offset used by both duplicate and paste. ✅
- **Placeholder scan:** every step carries concrete code; the e2e has a documented focus/selection fallback; `ControlOrMeta+KeyC/V` is the cross-platform Playwright modifier. ✅
