# 47d — Symbols Library Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A small symbols library — browse every `SymbolAsset` with a live instance count, click to place a fresh instance into the active scene, and swap a selected instance to a different symbol — all gated by an authoring-time cycle guard.

**Architecture:** Two pure engine helpers (`symbolContains` = the transitive authoring cycle guard #2; `countSymbolInstances`) + two active-scene-routed store actions (`placeSymbolInstance`, `swapSymbol`) + UI (an AssetPanel "Symbols" section and an Inspector swap-symbol select). Everything reuses existing machinery: `commitActiveScene` (47-edit) so place/swap work at the root AND inside a symbol; `sceneContentAABB` (47b) for the placed instance's content-centre anchor; the `flattenInstances` visited-set as the render-time cycle backstop. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom component), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `engine/symbol.ts::flattenInstances`, `runtime/frame.ts`, or `services/export/`. The new engine helpers are pure read functions.
- **No new dependencies.**
- **Cycle guard #2 (authoring-time):** placing/swapping an instance of `symId` into the active scene is rejected (toast, no commit) when the active scene is a symbol `C` and (`symId === C` or `symbolContains(symId, C, assets)`). At the root, `C` is null → always allowed. `symbolContains` MUST be transitive and cycle-guarded (terminate on a corrupt graph).
- **Active-scene routed:** both actions read `selectActiveObjects` and write `commitActiveScene` (so they target the root OR a symbol in edit mode).
- **Swap preserves the instance** — only `assetId` changes; base/keyframes/`symbolTime`/anchor are kept (v1 does not recompute the anchor).
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green; engine/parity suites green.

---

### Task 1: Engine helpers — `symbolContains` + `countSymbolInstances`

Pure, cycle-guarded read helpers.

**Files:**
- Modify: `src/engine/symbol.ts`
- Test: `src/engine/symbol.test.ts`

**Interfaces:**
- Produces:
  - `symbolContains(containerSymId: string, targetSymId: string, assets: Asset[]): boolean`
  - `countSymbolInstances(symId: string, project: Project): number`

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/symbol.test.ts` (it imports the engine factories from `./project`; add `symbolContains`, `countSymbolInstances` to the `./symbol` import):

```ts
describe('symbolContains (slice 47d cycle guard)', () => {
  // A contains an instance of B; B contains an instance of C; C is a leaf rect.
  function nestedAssets() {
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symC = createSymbolAsset({ id: 'C', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const symB = createSymbolAsset({ id: 'B', objects: [createSceneObject('C', { id: 'b-c' })], width: 10, height: 10 });
    const symA = createSymbolAsset({ id: 'A', objects: [createSceneObject('B', { id: 'a-b' })], width: 10, height: 10 });
    return [rectAsset, symA, symB, symC];
  }
  it('is true for direct containment', () => {
    expect(symbolContains('B', 'C', nestedAssets())).toBe(true);
  });
  it('is true for transitive containment', () => {
    expect(symbolContains('A', 'C', nestedAssets())).toBe(true);
  });
  it('is false for unrelated symbols and for self', () => {
    expect(symbolContains('C', 'A', nestedAssets())).toBe(false);
    expect(symbolContains('A', 'A', nestedAssets())).toBe(false); // A does not contain ITSELF (no cycle present)
  });
  it('terminates on a corrupt self-referential graph', () => {
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symX = createSymbolAsset({ id: 'X', objects: [createSceneObject('X', { id: 'x-x' }), createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    expect(symbolContains('X', 'rect-asset', [rectAsset, symX])).toBe(false); // finite; rect is a leaf not a symbol
    expect(symbolContains('X', 'X', [rectAsset, symX])).toBe(true); // X transitively contains an instance of X
  });
});

describe('countSymbolInstances (slice 47d)', () => {
  it('counts references across the root scene and symbol scenes', () => {
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symC = createSymbolAsset({ id: 'C', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const symB = createSymbolAsset({ id: 'B', objects: [createSceneObject('C', { id: 'b-c1' }), createSceneObject('C', { id: 'b-c2' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, symB, symC];
    p.objects = [createSceneObject('C', { id: 'root-c' }), createSceneObject('B', { id: 'root-b' })];
    expect(countSymbolInstances('C', p)).toBe(3); // 1 at root + 2 inside B
    expect(countSymbolInstances('B', p)).toBe(1);
    expect(countSymbolInstances('rect-asset', p)).toBe(1); // the leaf inside C
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/symbol.test.ts -t "symbolContains|countSymbolInstances"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the helpers**

In `src/engine/symbol.ts`, add `Asset` to the type import (`import type { Asset, Project, SceneObject, SymbolTiming } from './types';`) and add:

```ts
/** Does `containerSymId` transitively contain an instance of `targetSymId`? Walks the container
 *  symbol's scene, recursing into nested symbol instances; cycle-guarded by a visited-asset Set so
 *  a corrupt self-referential file terminates. Used as the authoring-time cycle guard (slice 47d). */
export function symbolContains(containerSymId: string, targetSymId: string, assets: Asset[]): boolean {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  const seen = new Set<string>();
  const walk = (symId: string): boolean => {
    if (seen.has(symId)) return false; // already visited on this search -> no new finding
    seen.add(symId);
    const sym = byId.get(symId);
    if (!sym || sym.kind !== 'symbol') return false;
    for (const o of sym.objects) {
      const child = byId.get(o.assetId);
      if (child && child.kind === 'symbol') {
        if (o.assetId === targetSymId) return true;
        if (walk(o.assetId)) return true;
      }
    }
    return false;
  };
  return walk(containerSymId);
}

/** Total objects referencing `symId` across the root scene AND every symbol asset's objects[] (slice 47d). */
export function countSymbolInstances(symId: string, project: Project): number {
  let n = 0;
  const countIn = (objects: SceneObject[]): void => {
    for (const o of objects) if (o.assetId === symId) n++;
  };
  countIn(project.objects);
  for (const a of project.assets) if (a.kind === 'symbol') countIn(a.objects);
  return n;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/symbol.test.ts`
Expected: PASS (new tests + all existing symbol tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/symbol.ts src/engine/symbol.test.ts
git commit -m "feat(47d): symbolContains (cycle guard #2) + countSymbolInstances engine helpers"
```

---

### Task 2: Store actions — `placeSymbolInstance` + `swapSymbol`

Active-scene-routed, cycle-guarded, undoable.

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects`/`selectActiveAssetId`/`commitActiveScene` (47-edit), `sceneContentAABB`/`isSymbolInstance` (snapping), `symbolContains` (Task 1), `createSceneObject`/`nextZOrder`/`snapToFrame`, `pushToast`.
- Produces: `placeSymbolInstance(symId: string): void`, `swapSymbol(instanceId: string, newSymId: string): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('placeSymbolInstance + swapSymbol (slice 47d)', () => {
  function twoSymbols() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symP = createSymbolAsset({ id: 'symP', name: 'P', objects: [createSceneObject('rect-asset', { id: 'p-leaf' })], width: 10, height: 10 });
    const symQ = createSymbolAsset({ id: 'symQ', name: 'Q', objects: [createSceneObject('rect-asset', { id: 'q-leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, symP, symQ];
    p.objects = [createSceneObject('symP', { id: 'inst-p' })];
    s.commit(p);
  }

  it('placeSymbolInstance appends an instance to the root scene and selects it', () => {
    twoSymbols();
    useEditor.getState().placeSymbolInstance('symQ');
    const objs = useEditor.getState().history.present.objects;
    expect(objs.filter((o) => o.assetId === 'symQ')).toHaveLength(1);
    expect(useEditor.getState().selectedObjectId).toBe(objs.find((o) => o.assetId === 'symQ')!.id);
  });

  it('placeSymbolInstance appends into the active symbol scene in edit mode', () => {
    twoSymbols();
    const s = useEditor.getState();
    s.enterSymbol('symP'); // editing symP's scene
    s.placeSymbolInstance('symQ'); // placing Q inside P is fine (Q does not contain P)
    const symP = useEditor.getState().history.present.assets.find((a) => a.id === 'symP') as { objects: import('../../engine').SceneObject[] };
    expect(symP.objects.some((o) => o.assetId === 'symQ')).toBe(true);
  });

  it('placeSymbolInstance rejects a cycle (placing P inside P) with no commit', () => {
    twoSymbols();
    const s = useEditor.getState();
    s.enterSymbol('symP');
    const before = useEditor.getState().history.past.length;
    s.placeSymbolInstance('symP'); // P inside P -> cycle
    expect(useEditor.getState().history.past.length).toBe(before); // no commit
    expect((useEditor.getState().history.present.assets.find((a) => a.id === 'symP') as { objects: unknown[] }).objects).toHaveLength(1);
  });

  it('swapSymbol changes only assetId, preserving the transform and symbolTime', () => {
    twoSymbols();
    const s = useEditor.getState();
    s.selectObject('inst-p');
    s.setSymbolTiming({ loop: true });
    s.swapSymbol('inst-p', 'symQ');
    const inst = useEditor.getState().history.present.objects.find((o) => o.id === 'inst-p')!;
    expect(inst.assetId).toBe('symQ');
    expect(inst.symbolTime?.loop).toBe(true); // preserved
  });

  it('swapSymbol rejects a cycle-creating swap inside a symbol', () => {
    twoSymbols();
    const s = useEditor.getState();
    // Put an instance of Q inside P, enter P, try to swap it to P -> cycle.
    s.enterSymbol('symP');
    s.placeSymbolInstance('symQ');
    const qInstId = (useEditor.getState().history.present.assets.find((a) => a.id === 'symP') as { objects: import('../../engine').SceneObject[] }).objects.find((o) => o.assetId === 'symQ')!.id;
    const before = useEditor.getState().history.past.length;
    s.swapSymbol(qInstId, 'symP'); // swapping to P (the containing symbol) -> cycle
    expect(useEditor.getState().history.past.length).toBe(before); // no commit
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "placeSymbolInstance"`
Expected: FAIL — actions not defined.

- [ ] **Step 3: Implement the actions**

In `src/ui/store/store.ts`:

(a) Add `symbolContains` to the `'../../engine'` import; add `sceneContentAABB, isSymbolInstance` to the `'../components/Stage/snapping'` import.

(b) Add the interface declarations (near `createSymbol`):
```ts
  /** Place a fresh instance of a symbol into the active scene (slice 47d). Cycle-guarded. */
  placeSymbolInstance(symId: string): void;
  /** Repoint a symbol instance at a different symbol, preserving its transform (slice 47d). */
  swapSymbol(instanceId: string, newSymId: string): void;
```

(c) Add the implementations (near `createSymbol`):
```ts
  placeSymbolInstance(symId) {
    const s = get();
    const project = s.history.present;
    const symbol = project.assets.find((a) => a.id === symId);
    if (!symbol || symbol.kind !== 'symbol') return;
    const containing = selectActiveAssetId(s);
    if (containing && (symId === containing || symbolContains(symId, containing, project.assets))) {
      get().pushToast('error', `Can't place ${symbol.name} here — it would contain itself.`);
      return;
    }
    const objects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    const box = sceneContentAABB(symbol.objects, project.assets, time);
    const cx = box ? (box.minX + box.maxX) / 2 : 0;
    const cy = box ? (box.minY + box.maxY) / 2 : 0;
    const instance = createSceneObject(symId, {
      name: `${symbol.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorX: cx,
      anchorY: cy,
    });
    get().commitActiveScene([...objects, instance]);
    get().selectObject(instance.id);
  },
  swapSymbol(instanceId, newSymId) {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const inst = objects.find((o) => o.id === instanceId);
    if (!inst || !isSymbolInstance(inst, project.assets) || inst.assetId === newSymId) return;
    const newSym = project.assets.find((a) => a.id === newSymId);
    if (!newSym || newSym.kind !== 'symbol') return;
    const containing = selectActiveAssetId(s);
    if (containing && (newSymId === containing || symbolContains(newSymId, containing, project.assets))) {
      get().pushToast('error', `Can't swap to ${newSym.name} — it would contain itself.`);
      return;
    }
    get().commitActiveScene(objects.map((o) => (o.id === instanceId ? { ...o, assetId: newSymId } : o)));
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ui/store/store.test.ts -t "placeSymbolInstance"`
Expected: PASS. Then the whole store suite:
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(47d): placeSymbolInstance + swapSymbol store actions (active-scene, cycle-guarded)"
```

---

### Task 3: AssetPanel "Symbols" section

List symbols with instance counts + click-to-place; remove symbols from the generic (broken-click) list.

**Files:**
- Modify: `src/ui/components/AssetPanel/AssetPanel.tsx`, `src/ui/components/AssetPanel/AssetPanel.module.css`
- Test: `src/ui/components/AssetPanel/AssetPanel.test.tsx`

**Interfaces:**
- Consumes: `placeSymbolInstance` (Task 2), `countSymbolInstances`/`symbolContains` (Task 1), `selectActiveAssetId` (selectors).

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/AssetPanel/AssetPanel.test.tsx` (extend its imports with `act` and the engine factories `createProject`/`createSceneObject`/`createSymbolAsset`/`createVectorAsset`):

```ts
it('lists symbols with an instance count and places one on click (slice 47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Star', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  const btn = screen.getByTestId('symbol-sym');
  expect(btn).toHaveTextContent('Star (1)');
  await userEvent.click(btn);
  expect(useEditor.getState().history.present.objects.filter((o) => o.assetId === 'sym')).toHaveLength(2);
});

it('disables a symbol row that would create a cycle in edit mode (slice 47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Self', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.enterSymbol('sym'); }); // editing sym -> placing sym inside itself is a cycle
  render(<AssetPanel />);
  expect(screen.getByTestId('symbol-sym')).toBeDisabled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx -t "slice 47d"`
Expected: FAIL — no `symbol-sym` testid.

- [ ] **Step 3: Implement the section**

Rewrite `src/ui/components/AssetPanel/AssetPanel.tsx` to add the symbols section and filter symbols out of the generic list:

```tsx
import { useId } from 'react';
import { importAudio, importSvg } from '../../../services';
import { countSymbolInstances, symbolContains } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectActiveAssetId } from '../../store/selectors';
import { readFileBytes, readFileText } from './readFile';
import styles from './AssetPanel.module.css';

export function AssetPanel() {
  const project = useEditor((s) => s.history.present);
  const assets = project.assets;
  const activeAssetId = useEditor(selectActiveAssetId);
  const { addAsset, addObject, addAudioClip, placeSymbolInstance, pushToast } = useEditor.getState();
  const svgId = useId();
  const audioId = useId();

  const onSvg = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { asset, warnings } = importSvg(await readFileText(file), file.name);
      addAsset(asset);
      warnings.forEach((w) => pushToast('info', w));
    } catch (err) {
      pushToast('error', (err as Error).message);
    }
  };

  const onAudio = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bytes = await readFileBytes(file);
      const { asset } = importAudio(file.name, bytes, file.type);
      addAsset(asset, bytes);
    } catch (err) {
      pushToast('error', (err as Error).message);
    }
  };

  const symbols = assets.filter((a) => a.kind === 'symbol');
  const nonSymbols = assets.filter((a) => a.kind !== 'symbol');

  return (
    <div className={styles.panel}>
      <div className={styles.imports}>
        <label className={styles.fileBtn} htmlFor={svgId}>Import SVG</label>
        <input
          id={svgId}
          className={styles.hidden}
          type="file"
          accept=".svg,image/svg+xml"
          aria-label="Import SVG"
          onChange={(e) => void onSvg(e.target.files?.[0])}
        />
        <label className={styles.fileBtn} htmlFor={audioId}>Import Audio</label>
        <input
          id={audioId}
          className={styles.hidden}
          type="file"
          accept="audio/*"
          aria-label="Import Audio"
          onChange={(e) => void onAudio(e.target.files?.[0])}
        />
      </div>
      <div className={styles.list}>
        {nonSymbols.map((a) => (
          <button
            key={a.id}
            className={styles.item}
            onClick={() => (a.kind === 'svg' ? addObject(a.id) : addAudioClip(a.id))}
          >
            {a.kind === 'audio' ? '♪ ' : ''}
            {a.name}
          </button>
        ))}
      </div>
      {symbols.length > 0 && (
        <div className={styles.symbols} data-testid="symbols-section">
          <div className={styles.sectionTitle}>Symbols</div>
          {symbols.map((sym) => {
            const cyclic = !!activeAssetId && (sym.id === activeAssetId || symbolContains(sym.id, activeAssetId, assets));
            return (
              <button
                key={sym.id}
                className={styles.item}
                data-testid={`symbol-${sym.id}`}
                disabled={cyclic}
                title={cyclic ? 'Would create a containment cycle' : 'Place an instance'}
                onClick={() => placeSymbolInstance(sym.id)}
              >
                {sym.name} ({countSymbolInstances(sym.id, project)})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

> Confirmed import paths: `engine/index.ts` re-exports `symbol.ts` (`export * from './symbol'`), so `countSymbolInstances`/`symbolContains` resolve from `'../../../engine'`. The services barrel does NOT re-export engine, so `importSvg`/`importAudio` stay on `'../../../services'` and the engine helpers come from `'../../../engine'` (as written above). `selectActiveAssetId` is exported from `'../../store/selectors'` (47-edit).

- [ ] **Step 4: Add the CSS**

Append to `src/ui/components/AssetPanel/AssetPanel.module.css`:
```css
.symbols {
  border-top: 1px solid var(--color-border, #333);
  margin-top: 6px;
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sectionTitle {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--color-text-muted, #888);
  padding: 2px 4px;
}
```

- [ ] **Step 5: Run to verify pass + the AssetPanel suite**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx`
Expected: PASS (new tests + existing svg/audio tests — symbols no longer in the generic list, but existing tests only assert svg/audio rows).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/components/AssetPanel/AssetPanel.tsx src/ui/components/AssetPanel/AssetPanel.module.css src/ui/components/AssetPanel/AssetPanel.test.tsx
git commit -m "feat(47d): AssetPanel Symbols section (count + click-to-place + cycle-disabled rows)"
```

---

### Task 4: Inspector "Swap symbol" select

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `swapSymbol` (Task 2), `symbolContains` (Task 1), `selectActiveAssetId` (selectors), `isSymbolInstance`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('shows a Swap symbol select for an instance and swaps on change (slice 47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const symP = createSymbolAsset({ id: 'symP', name: 'P', objects: [createSceneObject('rect-asset', { id: 'p-leaf' })], width: 10, height: 10 });
  const symQ = createSymbolAsset({ id: 'symQ', name: 'Q', objects: [createSceneObject('rect-asset', { id: 'q-leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, symP, symQ];
  p.objects = [createSceneObject('symP', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  const select = screen.getByTestId('swap-symbol');
  await userEvent.selectOptions(select, 'symQ');
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.assetId).toBe('symQ');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/Inspector/Inspector.test.tsx -t "Swap symbol"`
Expected: FAIL — no `swap-symbol` testid.

- [ ] **Step 3: Implement the select**

In `src/ui/components/Inspector/Inspector.tsx`:
- Add `symbolContains` to the `'../../../engine'` import (or wherever engine helpers resolve in this file).
- Add `selectActiveAssetId` to the `'../../store/selectors'` import.
- Add `swapSymbol` to the destructured store actions.
- Read the active asset id near the other `useEditor` reads: `const activeAssetId = useEditor(selectActiveAssetId);`
- Inside the existing `{isSymbolInstance(obj, assets) && ( <> … </> )}` block (after the speed `</div>`, before `</>`), add the swap select:

```tsx
          {(() => {
            const targets = assets.filter(
              (a) =>
                a.kind === 'symbol' &&
                a.id !== obj.assetId &&
                !(activeAssetId && (a.id === activeAssetId || symbolContains(a.id, activeAssetId, assets))),
            );
            return targets.length > 0 ? (
              <div className={styles.row}>
                <label htmlFor="insp-swap-symbol">swap symbol</label>
                <select
                  id="insp-swap-symbol"
                  data-testid="swap-symbol"
                  value=""
                  onChange={(e) => { if (e.target.value) swapSymbol(obj.id, e.target.value); }}
                >
                  <option value="">Swap to…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            ) : null;
          })()}
```

- [ ] **Step 4: Run to verify pass + the Inspector suite**

Run: `npx vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(47d): Inspector Swap symbol select (cycle-filtered targets)"
```

---

### Task 5: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol, place a second instance from the library (count updates), and confirm.

```ts
test('place a second instance of a symbol from the library (slice 47d)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  // Draw a rect -> Create Symbol -> one instance.
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(1);

  // The Symbols library lists it with a place button; click to place a second instance.
  const symbolsSection = page.getByTestId('symbols-section');
  await expect(symbolsSection).toBeVisible();
  const placeBtn = symbolsSection.getByRole('button').first();
  await placeBtn.click();
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});
```
> Verify the library section is visible in the Assets panel area and the place button is reachable; if the Assets panel is collapsed/another tab, adjust to open it. The contract: the Symbols section exists and placing adds a second instance leaf.

- [ ] **Step 2: Run the e2e**

Run: `npm run e2e -- symbols.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full-suite verification**

```bash
npm test
npm run typecheck
npx eslint src e2e
npm run e2e
```
Expected: all green. Parity suites unchanged-and-green.

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(47d): e2e place a second symbol instance from the library"
```

---

## Self-Review

**1. Spec coverage** (spec §2–§7):
- §2 `symbolContains` (cycle guard #2) → Task 1. §3.1 `placeSymbolInstance` → Task 2. §3.2 `swapSymbol` → Task 2. §3.3 `countSymbolInstances` → Task 1. §4.1 AssetPanel Symbols section + count + place + cycle-disabled + broken-click fix → Task 3. §4.2 Inspector swap select → Task 4. §6 parity/undo (no engine-render change; `commitActiveScene` undoable) — Global Constraints + Task 2. §7 deferred respected (thumbnails / drag-to-place / anchor-recompute not implemented). §9 tests → engine (T1), store (T2), AssetPanel (T3), Inspector (T4), e2e (T5). ✅

**2. Placeholder scan:** No TBD/TODO; code/tests complete. Two calibration notes (the engine-helper import path in AssetPanel; the e2e panel-visibility) state the contract + "verify resolution against the real module/DOM" — not placeholders. ✅

**3. Type consistency:** `symbolContains(containerSymId, targetSymId, assets)`, `countSymbolInstances(symId, project)`, `placeSymbolInstance(symId)`, `swapSymbol(instanceId, newSymId)` used identically across tasks. The cycle-guard expression `containing && (X === containing || symbolContains(X, containing, assets))` is identical in store (place/swap) and the UI gates. ✅

**4. Parity:** no `flattenInstances`/`runtime`/`export` change; the engine helpers are pure reads. ✅
