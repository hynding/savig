# Stage-Size Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user set the active artboard's width/height from the Inspector's empty (nothing-selected) state, with presets, undoably, without moving content.

**Architecture:** A new undoable store action `setStageSize` mutates the active artboard (root `meta` normally, the edited symbol's `width/height` in symbol-edit mode) via the existing `commit`/history path. The neutral `inspectorViewModel` empty descriptor is enriched with the current dims + scope; a neutral `setStageSize` intent and `STAGE_PRESETS` const are added; the React Inspector renders a size panel in the empty branch. `NumberField` gains a `min` prop that clamps and self-heals its display.

**Tech Stack:** TypeScript (strict), vanilla Zustand store (`@savig/editor-state`), neutral view-models/intents (`@savig/ui-core`), React 18 UI (`apps/react`), Vitest (unit/component), Playwright (e2e).

## Global Constraints

- TypeScript strict; no `any`. Follow existing file patterns.
- Store mutations go through `get().commit(next)` (pushes history → undoable). No-op guard before commit (skip when unchanged) to avoid empty undo steps.
- Stage dims are integers `>= 1`. Content is never moved by a resize.
- Neutral packages (`editor-state`, `ui-core`) must not import from `apps/*`. Only `apps/react` gets UI wiring.
- Run unit tests with `pnpm test` (Vitest) and e2e with `pnpm e2e` (Playwright) from repo root; kill any stale vite dev server before a definitive e2e run.

---

### Task 1: Store action `setStageSize`

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` (action interface, near `setSymbolDuration` ~line 278)
- Modify: `packages/editor-state/src/store.ts` (implementation, after `setSymbolDuration` ~line 1117)
- Test: `packages/editor-state/src/stage-size.test.ts` (new)

**Interfaces:**
- Consumes: existing `get().commit(next)`, `get().editPath`, `get().history.present`.
- Produces: `setStageSize(width: number, height: number): void` on `EditorState`.

- [ ] **Step 1: Write the failing test**

Create `packages/editor-state/src/stage-size.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createSymbolAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

describe('setStageSize', () => {
  it('resizes the root artboard (meta) and is undoable', () => {
    store.getState().setStageSize(800, 600);
    expect(store.getState().history.present.meta.width).toBe(800);
    expect(store.getState().history.present.meta.height).toBe(600);
    store.getState().undo();
    expect(store.getState().history.present.meta.width).toBe(1280);
    expect(store.getState().history.present.meta.height).toBe(720);
  });

  it('clamps to integers >= 1', () => {
    store.getState().setStageSize(0, -5);
    expect(store.getState().history.present.meta.width).toBe(1);
    expect(store.getState().history.present.meta.height).toBe(1);
    store.getState().setStageSize(640.6, 360.2);
    expect(store.getState().history.present.meta.width).toBe(641);
    expect(store.getState().history.present.meta.height).toBe(360);
  });

  it('no-ops (no history push) when the size is unchanged', () => {
    const before = store.getState().history.past.length;
    store.getState().setStageSize(1280, 720); // already the default
    expect(store.getState().history.past.length).toBe(before);
  });

  it('in symbol-edit mode, resizes the symbol asset, not meta (clip box follows w/h)', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [], width: 100, height: 100 });
    store.getState().addAsset(sym);
    store.getState().enterSymbol('sym');
    store.getState().setStageSize(300, 200);
    const asset = store.getState().history.present.assets.find((a) => a.id === 'sym');
    expect(asset).toMatchObject({ width: 300, height: 200 });
    expect(store.getState().history.present.meta.width).toBe(1280); // meta untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @savig/editor-state test -- stage-size`
Expected: FAIL — `setStageSize is not a function`.

- [ ] **Step 3: Add the action to the interface**

In `packages/editor-state/src/store-internals.ts`, immediately after the `setSymbolDuration(symId: string, duration: number): void;` line (~278), add:

```ts
  /** Set the ACTIVE artboard's size: the edited symbol's width/height in symbol-edit mode,
   *  else the root meta.width/height. Clamps each dim to an integer >= 1; no-ops when unchanged.
   *  Content is not moved. Undoable (routed through commit). */
  setStageSize(width: number, height: number): void;
```

- [ ] **Step 4: Implement the action**

In `packages/editor-state/src/store.ts`, immediately after the `setSymbolDuration` action (the block ending at line 1117), add:

```ts
  setStageSize(width, height) {
    const s = get();
    const project = s.history.present;
    const w = Math.round(Math.max(1, width));
    const h = Math.round(Math.max(1, height));
    // Active scope mirrors selectActiveAssetId / activeSceneDims: last editPath entry, and only
    // when it resolves to a symbol asset. Otherwise the root artboard (meta).
    const symId = get().editPath.at(-1) ?? null;
    const sym = symId ? project.assets.find((a) => a.id === symId) : undefined;
    if (sym && sym.kind === 'symbol') {
      if (sym.width === w && sym.height === h) return; // no-op -> no commit
      get().commit({
        ...project,
        assets: project.assets.map((a) => (a.id === symId ? { ...a, width: w, height: h } : a)),
      });
      return;
    }
    if (project.meta.width === w && project.meta.height === h) return; // no-op -> no commit
    get().commit({ ...project, meta: { ...project.meta, width: w, height: h } });
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @savig/editor-state test -- stage-size`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/editor-state/src/store-internals.ts packages/editor-state/src/store.ts packages/editor-state/src/stage-size.test.ts
git commit -m "feat(editor-state): setStageSize action (active-scope, clamped, undoable)"
```

---

### Task 2: Enrich the empty inspector view-model

**Files:**
- Modify: `packages/ui-core/src/viewmodels/inspector.ts` (`InspectorEmptyVM` type ~line 62; import block ~line 40; empty return ~line 217)
- Test: `packages/ui-core/src/viewmodels/inspector.test.ts` (extend the "empty selection" describe ~line 12)

**Interfaces:**
- Consumes: `activeSceneDims(s)`, `selectActiveAssetId(s)` from `@savig/editor-state`.
- Produces: `InspectorEmptyVM = { kind: 'empty'; scope: 'root' | 'symbol'; dims: { width: number; height: number } }`.

- [ ] **Step 1: Write the failing test**

In `packages/ui-core/src/viewmodels/inspector.test.ts`, add inside the existing `describe('inspectorViewModel — empty selection', ...)` block (after the existing `it` at line 16):

```ts
  it('reports root dims + scope at the root artboard', () => {
    store.getState().selectObject(null);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'empty') throw new Error('expected empty');
    expect(vm.scope).toBe('root');
    expect(vm.dims).toEqual({ width: 1280, height: 720 });
  });

  it('reports symbol dims + scope in symbol-edit mode', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [], width: 100, height: 80 });
    store.getState().addAsset(sym);
    store.getState().enterSymbol('sym');
    store.getState().selectObject(null);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'empty') throw new Error('expected empty');
    expect(vm.scope).toBe('symbol');
    expect(vm.dims).toEqual({ width: 100, height: 80 });
  });
```

(`createSymbolAsset` is already imported at the top of this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @savig/ui-core test -- inspector`
Expected: FAIL — `vm.scope`/`vm.dims` are `undefined` (and a TS error that `scope`/`dims` don't exist on `InspectorEmptyVM`).

- [ ] **Step 3: Extend the `InspectorEmptyVM` type**

In `packages/ui-core/src/viewmodels/inspector.ts`, replace:

```ts
export interface InspectorEmptyVM {
  kind: 'empty';
}
```

with:

```ts
export interface InspectorEmptyVM {
  kind: 'empty';
  /** 'symbol' only when editing a symbol (root fallback otherwise) — drives the panel label. */
  scope: 'root' | 'symbol';
  /** The active artboard's current size (root meta, or the edited symbol's intrinsic size). */
  dims: { width: number; height: number };
}
```

- [ ] **Step 4: Import `activeSceneDims`**

In the same file, in the `from '@savig/editor-state'` import block (the one that already lists `selectActiveAssetId,` at line 41), add `activeSceneDims,` to the imported names.

- [ ] **Step 5: Populate the empty descriptor**

In `inspectorViewModel`, replace:

```ts
  const obj = selectSelectedObject(s);
  if (!obj) return { kind: 'empty' };
```

with:

```ts
  const obj = selectSelectedObject(s);
  if (!obj) {
    const aid = selectActiveAssetId(s);
    const sym = aid ? s.history.present.assets.find((a) => a.id === aid) : undefined;
    // Same guard as activeSceneDims: symbol scope only when the active asset is really a symbol,
    // so scope and dims can never disagree.
    const scope: 'root' | 'symbol' = sym && sym.kind === 'symbol' ? 'symbol' : 'root';
    return { kind: 'empty', scope, dims: activeSceneDims(s) };
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @savig/ui-core test -- inspector`
Expected: PASS (existing empty test + 2 new).

- [ ] **Step 7: Commit**

```bash
git add packages/ui-core/src/viewmodels/inspector.ts packages/ui-core/src/viewmodels/inspector.test.ts
git commit -m "feat(ui-core): empty inspector VM carries active dims + scope"
```

---

### Task 3: `setStageSize` intent + `STAGE_PRESETS`

**Files:**
- Modify: `packages/ui-core/src/viewmodels/inspector.ts` (add exports near the other exports; add intent inside `inspectorIntents` return ~line 484)
- Test: `packages/ui-core/src/viewmodels/inspector.test.ts`

**Interfaces:**
- Consumes: `setStageSize` on the store (Task 1); `inspectorIntents(store)` factory.
- Produces: `STAGE_PRESETS: StagePreset[]`, `interface StagePreset { label: string; width: number; height: number }`, and `intents.setStageSize(width, height)`.

- [ ] **Step 1: Write the failing test**

In `packages/ui-core/src/viewmodels/inspector.test.ts`, add a new describe block at the end of the file:

```ts
describe('stage-size intent + presets', () => {
  it('exposes the stage presets', () => {
    expect(STAGE_PRESETS.map((p) => p.label)).toEqual(['720p', '1080p', 'Square', 'Portrait']);
  });

  it('setStageSize intent resizes the active artboard', () => {
    inspectorIntents(store).setStageSize(500, 400);
    expect(store.getState().history.present.meta.width).toBe(500);
    expect(store.getState().history.present.meta.height).toBe(400);
  });
});
```

Add `inspectorIntents` and `STAGE_PRESETS` to the existing import from `./inspector` at the top of the file:

```ts
import { inspectorViewModel, inspectorIntents, STAGE_PRESETS } from './inspector';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @savig/ui-core test -- inspector`
Expected: FAIL — `STAGE_PRESETS` undefined / `intents.setStageSize is not a function`.

- [ ] **Step 3: Add the presets export**

In `packages/ui-core/src/viewmodels/inspector.ts`, add near the top-level exports (e.g. just above `export function inspectorViewModel`):

```ts
export interface StagePreset {
  label: string;
  width: number;
  height: number;
}

/** Common artboard sizes offered in the Inspector's stage-size panel (neutral data). */
export const STAGE_PRESETS: StagePreset[] = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Portrait', width: 1080, height: 1920 },
];
```

- [ ] **Step 4: Add the intent**

In the `inspectorIntents` return object (right after the `setSymbolDuration:` line ~495), add:

```ts
    setStageSize: (width: number, height: number) => s().setStageSize(width, height),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @savig/ui-core test -- inspector`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui-core/src/viewmodels/inspector.ts packages/ui-core/src/viewmodels/inspector.test.ts
git commit -m "feat(ui-core): setStageSize intent + STAGE_PRESETS"
```

---

### Task 4: `NumberField` gains a clamping `min` prop

**Files:**
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (the `NumberField` component, lines 22-71)
- Test: covered by Task 5's component tests (the `min` self-heal test). No separate test here — `NumberField` is a private component exercised through the panel.

**Interfaces:**
- Consumes: nothing new.
- Produces: `NumberField` accepts optional `min?: number`; clamps the committed value to `>= min` and rewrites the visible draft to the clamped value when a clamp occurs.

- [ ] **Step 1: Add the `min` prop and clamp in `commit`**

In `apps/react/src/ui/components/Inspector/Inspector.tsx`, update the `NumberField` component. Change the props destructure/type to add `min`:

```tsx
function NumberField({
  label,
  value,
  step,
  min,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
```

and replace the `commit` function:

```tsx
  const commit = () => {
    const raw = Number(draft);
    if (!Number.isFinite(raw)) return;
    const n = min != null ? Math.max(min, raw) : raw;
    if (n !== value) onCommit(n);
    // Self-heal the visible draft when a clamp changed the value, so a sub-min entry that the
    // store no-ops (clamped result == current) doesn't leave the bad text showing.
    if (min != null && n !== raw) setDraft(String(n));
  };
```

Also pass `min` through to the `<input>` for native affordance — add `min={min}` to the existing `<input>` element (next to `step={step ?? 1}`):

```tsx
      type="number"
      step={step ?? 1}
      min={min}
      disabled={disabled}
```

- [ ] **Step 2: Verify the existing suite still compiles/passes**

Run: `pnpm --filter @savig/app-react test -- Inspector`
Expected: PASS — existing NumberField callers omit `min`, so behavior is unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/react/src/ui/components/Inspector/Inspector.tsx
git commit -m "feat(app-react): NumberField optional min with self-healing draft"
```

---

### Task 5: Document/Symbol size panel in the empty Inspector

**Files:**
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (import `STAGE_PRESETS`; replace the empty-branch hint at line 130)
- Test: `apps/react/src/ui/components/Inspector/Inspector.test.tsx` (new cases)

**Interfaces:**
- Consumes: `vm.dims`, `vm.scope` (Task 2); `intents.setStageSize` (Task 3); `STAGE_PRESETS` (Task 3); `NumberField` `min` (Task 4).
- Produces: rendered panel with `aria-label` inputs `"Stage width"`, `"Stage height"`, and select `"Stage size preset"`.

- [ ] **Step 1: Write the failing tests**

In `apps/react/src/ui/components/Inspector/Inspector.test.tsx`, add at the end of the file:

```tsx
it('empty inspector shows a stage-size panel that resizes the artboard', async () => {
  useEditor.getState().newProject();
  useEditor.getState().selectObject(null); // ensure the empty branch (beforeEach adds+selects an object)
  render(<Inspector />);
  expect(screen.getByText('Document')).toBeInTheDocument();
  const w = screen.getByLabelText('Stage width');
  await userEvent.clear(w);
  await userEvent.type(w, '900');
  await userEvent.tab();
  expect(useEditor.getState().history.present.meta.width).toBe(900);
});

it('a preset resizes both dimensions', async () => {
  useEditor.getState().newProject();
  useEditor.getState().selectObject(null);
  render(<Inspector />);
  await userEvent.selectOptions(screen.getByLabelText('Stage size preset'), '1'); // index 1 = 1080p
  expect(useEditor.getState().history.present.meta.width).toBe(1920);
  expect(useEditor.getState().history.present.meta.height).toBe(1080);
});

it('NumberField self-heals the display even when the clamp is a store no-op', async () => {
  useEditor.getState().newProject();
  useEditor.getState().selectObject(null);
  useEditor.getState().setStageSize(1, 500); // width already at the min
  render(<Inspector />);
  const w = screen.getByLabelText('Stage width') as HTMLInputElement;
  expect(w.value).toBe('1');
  await userEvent.clear(w);
  await userEvent.type(w, '0'); // clamps back to 1 == current -> store no-ops
  await userEvent.tab();
  expect(w.value).toBe('1'); // display healed despite no store change
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @savig/app-react test -- Inspector`
Expected: FAIL — `getByText('Document')` / `getByLabelText('Stage width')` not found (empty branch still renders the plain hint).

- [ ] **Step 3: Import `STAGE_PRESETS`**

In `apps/react/src/ui/components/Inspector/Inspector.tsx`, add `STAGE_PRESETS` to the existing import from `@savig/ui-core` (the one that already brings in `inspectorViewModel` / `inspectorIntents`).

- [ ] **Step 4: Replace the empty-branch hint**

Replace this line (line 130):

```tsx
  if (vm.kind === 'empty') return <div className={styles.hint}>No object selected</div>;
```

with:

```tsx
  if (vm.kind === 'empty') {
    const { dims, scope } = vm;
    const presetIndex = STAGE_PRESETS.findIndex(
      (p) => p.width === dims.width && p.height === dims.height,
    );
    return (
      <div className={styles.panel}>
        <div className={styles.row}>{scope === 'symbol' ? 'Symbol size' : 'Document'}</div>
        <div className={styles.row}>
          <NumberField
            label="Stage width"
            value={dims.width}
            min={1}
            onCommit={(n) => intents.setStageSize(n, dims.height)}
          />
          <NumberField
            label="Stage height"
            value={dims.height}
            min={1}
            onCommit={(n) => intents.setStageSize(dims.width, n)}
          />
        </div>
        <div className={styles.row}>
          <select
            aria-label="Stage size preset"
            value={presetIndex}
            onChange={(e) => {
              const p = STAGE_PRESETS[Number(e.target.value)];
              if (p) intents.setStageSize(p.width, p.height);
            }}
          >
            <option value={-1}>Custom</option>
            {STAGE_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label} ({p.width}×{p.height})
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @savig/app-react test -- Inspector`
Expected: PASS (3 new + existing).

- [ ] **Step 6: Commit**

```bash
git add apps/react/src/ui/components/Inspector/Inspector.tsx apps/react/src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(app-react): stage-size panel in the empty Inspector"
```

---

### Task 6: End-to-end coverage

**Files:**
- Test: `e2e/stage-size.spec.ts` (new)

**Interfaces:**
- Consumes: the full wired feature (panel → intent → store → Stage viewBox).
- Produces: an e2e proof that resizing via input + preset updates the Stage `viewBox`, and undo restores it.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/stage-size.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('resize the stage via the Inspector document panel', async ({ page }) => {
  await page.goto('/');

  // Fresh project, nothing selected -> the Inspector shows the Document size panel.
  const inspector = page.locator('section[aria-label="Inspector"]');
  await expect(inspector.getByText('Document')).toBeVisible();

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  await expect(svg).toHaveAttribute('viewBox', '0 0 1280 720');

  // Type a new width.
  const width = inspector.getByLabel('Stage width');
  await width.fill('800');
  await width.press('Enter');
  await expect(svg).toHaveAttribute('viewBox', '0 0 800 720');

  // A preset resizes both dimensions.
  await inspector.getByLabel('Stage size preset').selectOption({ label: '1080p (1920×1080)' });
  await expect(svg).toHaveAttribute('viewBox', '0 0 1920 1080');

  // Undo restores the previous size.
  await page.keyboard.press('Control+z');
  await expect(svg).toHaveAttribute('viewBox', '0 0 800 720');
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm e2e -- stage-size`
Expected: PASS. (If a stale vite dev server is running, kill it first.)

- [ ] **Step 3: Full regression**

Run: `pnpm test` then `pnpm e2e`
Expected: entire suite green (all prior unit + e2e still pass).

- [ ] **Step 4: Commit**

```bash
git add e2e/stage-size.spec.ts
git commit -m "test(e2e): stage-size resize via Inspector panel + preset + undo"
```

---

## Self-Review

**Spec coverage:**
- Store action (active-scope, clamp, no-op, undoable) → Task 1. ✓
- VM enrichment (dims + scope, matching guard) → Task 2. ✓
- Neutral intent + `STAGE_PRESETS` → Task 3. ✓
- `NumberField` `min` + self-heal → Task 4 (+ regression test in Task 5). ✓
- React panel (label by scope, W/H fields, `Custom`-sentinel preset select) → Task 5. ✓
- Tests: store unit, VM unit, intent/preset unit, NumberField self-heal component, panel component, e2e (input + preset + undo) → Tasks 1-6. ✓
- Warnings (symbol resize Stage-inert, project-wide across scenes, camera untouched, no migration) are documented in the spec; no code needed. ✓

**Placeholder scan:** none — every step carries exact code/commands.

**Type consistency:** `setStageSize(width: number, height: number): void` is identical across store-internals interface (Task 1), store impl (Task 1), intent (Task 3), and callers (Task 5). `InspectorEmptyVM { kind, scope: 'root'|'symbol', dims: {width,height} }` is defined in Task 2 and consumed unchanged in Task 5. `StagePreset { label, width, height }` defined and consumed consistently (Tasks 3, 5). Preset select uses numeric index values (`-1` = Custom) consistently in render and tests.
