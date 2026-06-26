# Non-Symbol Asset Rename & Delete (47d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename and delete imported svg/audio library assets from the AssetPanel, matching the symbol rows.

**Architecture:** Reuse the generic `renameAsset`; add an undoable `deleteAsset(assetId)` with an in-use guard (object references via `collectReferencedAssetIds` OR audio-clip references). The AssetPanel non-symbol rows gain inline rename + delete controls for svg/audio (reusing the `editingId` state + the symbol-row CSS). No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest + RTL, Playwright. No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No engine/render change; the actions edit asset metadata / the asset array.
- **No new dependencies.**
- **Undoable:** each action is one whole-project commit.
- **In-use safety:** `deleteAsset` is blocked while any object OR audio clip references the asset.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: `deleteAsset` store action

**Files:**
- Modify: `src/ui/store/store.ts` (declaration after `deleteSymbol(symId: string): void;`; impl after the `deleteSymbol` implementation)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `deleteAsset(assetId: string): void`.
- Consumes: `collectReferencedAssetIds` (engine, already imported), `pushToast` (store).

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/ui/store/store.test.ts`:

```ts
describe('deleteAsset — non-symbol asset delete (47d)', () => {
  const svgAsset = (id: string) => ({ id, kind: 'svg' as const, name: `${id}.svg`, normalizedContent: '<svg/>', viewBox: '0 0 10 10', width: 10, height: 10 });
  const audioAsset = (id: string) => ({ id, kind: 'audio' as const, name: `${id}.mp3`, mimeType: 'audio/mpeg' });

  it('removes an svg asset that no object references', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addAsset(svgAsset('a'));
    s.deleteAsset('a');
    expect(useEditor.getState().history.present.assets.some((x) => x.id === 'a')).toBe(false);
  });

  it('blocks deleting an svg asset referenced by an object (toast)', () => {
    const s = useEditor.getState();
    s.newProject();
    const p = createProject();
    p.assets = [svgAsset('a')];
    p.objects = [createSceneObject('a', { id: 'o' })];
    s.commit(p);
    const before = useEditor.getState().toasts.length;
    s.deleteAsset('a');
    expect(useEditor.getState().history.present.assets.some((x) => x.id === 'a')).toBe(true); // kept
    expect(useEditor.getState().toasts.length).toBe(before + 1);
  });

  it('blocks deleting an audio asset referenced by an audio clip', () => {
    const s = useEditor.getState();
    s.newProject();
    const p = createProject();
    p.assets = [audioAsset('au')];
    p.audioClips = [{ id: 'c', assetId: 'au', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 }];
    s.commit(p);
    s.deleteAsset('au');
    expect(useEditor.getState().history.present.assets.some((x) => x.id === 'au')).toBe(true); // kept (clip uses it)
  });

  it('removes an audio asset that no clip references', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addAsset(audioAsset('au'));
    s.deleteAsset('au');
    expect(useEditor.getState().history.present.assets.some((x) => x.id === 'au')).toBe(false);
  });

  it('is a no-op on a symbol (symbols use deleteSymbol)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addAsset(createSymbolAsset({ id: 'sym', name: 'Sym', objects: [], width: 0, height: 0 }));
    s.deleteAsset('sym');
    expect(useEditor.getState().history.present.assets.some((x) => x.id === 'sym')).toBe(true); // untouched
  });

  it('is undoable', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addAsset(svgAsset('a'));
    s.deleteAsset('a');
    s.undo();
    expect(useEditor.getState().history.present.assets.some((x) => x.id === 'a')).toBe(true);
  });

  it('renameAsset renames an svg asset (generic, regression)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addAsset(svgAsset('a'));
    s.renameAsset('a', 'Logo');
    expect(useEditor.getState().history.present.assets.find((x) => x.id === 'a')!.name).toBe('Logo');
  });
});
```

> Verify the `AudioAsset` shape: grep `interface AudioAsset` in `src/engine/types.ts` and adjust the `audioAsset` fixture fields (e.g. `durationSec`) to match exactly. The `AudioClip` fixture matches `{ id, assetId, startTime, inPoint, outPoint, volume }` (from `addAudioClip`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "deleteAsset"`
Expected: FAIL — `deleteAsset` is not defined.

- [ ] **Step 3: Add the declaration**

After `deleteSymbol(symId: string): void;`, add:

```ts
  /** Delete a non-symbol asset (svg/audio) — blocked (toast) while any object or audio clip
   *  references it. Symbols use deleteSymbol. (47d) */
  deleteAsset(assetId: string): void;
```

- [ ] **Step 4: Implement the action**

After the `deleteSymbol` implementation's closing `},`, add:

```ts
  deleteAsset(assetId) {
    const s = get();
    const project = s.history.present;
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset || asset.kind === 'symbol') return; // symbols use deleteSymbol
    const inUse =
      collectReferencedAssetIds(project).has(assetId) ||
      project.audioClips.some((c) => c.assetId === assetId);
    if (inUse) {
      get().pushToast('error', `Can't delete "${asset.name}" — it's in use.`);
      return;
    }
    get().commit({ ...project, assets: project.assets.filter((a) => a.id !== assetId) });
  },
```

- [ ] **Step 5: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "deleteAsset"`
Expected: PASS (all seven). Then the whole store suite:
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(asset-rename-delete): deleteAsset store action (in-use guarded)"
```

---

### Task 2: AssetPanel non-symbol row rename/delete UI

**Files:**
- Modify: `src/ui/components/AssetPanel/AssetPanel.tsx`
- Test: `src/ui/components/AssetPanel/AssetPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/AssetPanel/AssetPanel.test.tsx`:

```ts
it('renames + deletes an svg library asset (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addAsset({ id: 'a', kind: 'svg', name: 'box.svg', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  render(<AssetPanel />);
  // Rename.
  await userEvent.click(screen.getByLabelText('Rename box.svg'));
  const input = screen.getByTestId('asset-rename-a');
  await userEvent.clear(input);
  await userEvent.type(input, 'Logo{Enter}');
  expect(useEditor.getState().history.present.assets.find((x) => x.id === 'a')!.name).toBe('Logo');
  // Delete (unused) -> the row disappears.
  await userEvent.click(screen.getByLabelText('Delete Logo'));
  expect(screen.queryByTestId('asset-a')).not.toBeInTheDocument();
});

it('a per-shape vector asset row has no rename/delete controls (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addAsset(createVectorAsset('rect', { id: 'v', name: 'Rectangle', shapeType: 'rect' }));
  render(<AssetPanel />);
  expect(screen.getByTestId('asset-v')).toBeInTheDocument();
  expect(screen.queryByLabelText('Delete Rectangle')).not.toBeInTheDocument(); // not manageable
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx -t "47d"`
Expected: the new svg rename/delete test FAILS (no rename/delete controls).

- [ ] **Step 3: Pull `deleteAsset` into the component + restructure the non-symbol rows**

In `src/ui/components/AssetPanel/AssetPanel.tsx`, add `deleteAsset` to the store destructure:

```tsx
  const { addAsset, addObject, addAudioClip, placeSymbolInstance, pushToast, renameAsset, deleteSymbol } = useEditor.getState();
```
→
```tsx
  const { addAsset, addObject, addAudioClip, placeSymbolInstance, pushToast, renameAsset, deleteSymbol, deleteAsset } = useEditor.getState();
```

Replace the non-symbol `.map(...)` (the bare `<button key={a.id} …>{name}</button>`):

```tsx
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
```

with the row from spec §2.2:

```tsx
        {nonSymbols.map((a) => {
          const manageable = a.kind === 'svg' || a.kind === 'audio';
          return (
            <div className={styles.symbolRow} key={a.id}>
              {editingId === a.id ? (
                <input
                  className={styles.renameInput}
                  data-testid={`asset-rename-${a.id}`}
                  defaultValue={a.name}
                  autoFocus
                  onBlur={(e) => { renameAsset(a.id, e.currentTarget.value); setEditingId(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingId(null); }}
                />
              ) : (
                <button
                  className={styles.item}
                  data-testid={`asset-${a.id}`}
                  onClick={() => (a.kind === 'svg' ? addObject(a.id) : addAudioClip(a.id))}
                >
                  {a.kind === 'audio' ? '♪ ' : ''}{a.name}
                </button>
              )}
              {manageable && (
                <>
                  <button className={styles.rowBtn} aria-label={`Rename ${a.name}`} onClick={() => setEditingId(a.id)}>✎</button>
                  <button className={styles.rowBtn} aria-label={`Delete ${a.name}`} onClick={() => deleteAsset(a.id)}>×</button>
                </>
              )}
            </div>
          );
        })}
```

(No new CSS — `.symbolRow`/`.renameInput`/`.rowBtn`/`.item` already exist from the symbol-rename slice.)

- [ ] **Step 4: Run to verify pass + the AssetPanel suite**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx`
Expected: PASS (the new svg + vector tests + the existing svg-import / symbol tests — the svg action button keeps its click-to-add behaviour).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npm run typecheck
npx eslint src
git add src/ui/components/AssetPanel/AssetPanel.tsx src/ui/components/AssetPanel/AssetPanel.test.tsx
git commit -m "feat(asset-rename-delete): AssetPanel svg/audio row inline rename + delete"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Import an svg via the file input, then rename it via its row.

```ts
test('rename an imported svg asset in the library (47d)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByLabel(/import svg/i).setInputFiles({
    name: 'box.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'),
  });
  await expect(page.getByText('box.svg')).toBeVisible();

  // Rename it via its row (no Layers objects exist, so this "Rename" is unambiguous).
  await page.getByRole('button', { name: 'Rename box.svg' }).click();
  const input = page.locator('[data-testid^="asset-rename-"]').first();
  await input.fill('Logo');
  await input.press('Enter');
  await expect(page.getByText('Logo')).toBeVisible();
});
```

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
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(asset-rename-delete): e2e rename an imported svg asset"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6): §2.1 deleteAsset (reuse renameAsset) → Task 1. §2.2 svg/audio row UI → Task 2. §3 parity/undo/in-use → Global Constraints + tests. §4 scope (svg/audio; vector-list-cleanup/swap-anchor deferred) → not implemented. §6 tests → store (Task 1), RTL (Task 2), e2e (Task 3). ✅

**2. Placeholder scan:** No TBD/TODO; full action body, the full row JSX, and the test code. The AudioAsset-shape note flags a fixture field to verify. ✅

**3. Type consistency:** `deleteAsset(assetId: string): void`; the in-use guard `collectReferencedAssetIds(project): Set<string>` + `project.audioClips.some(c => c.assetId === id)`; `renameAsset` unchanged. ✅

**4. Parity:** no engine/render change; asset metadata/array edits; the guard prevents dangling references. ✅
