# Symbol Library Thumbnails (47d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a rendered SVG thumbnail of each symbol's content in the AssetPanel "Symbols" library section.

**Architecture:** Reuse `renderSvgDocument` (the canonical project→SVG renderer) so a thumbnail matches preview/export. Add an optional `viewBox` override to it (export byte-unchanged when absent). A small UI helper builds the thumbnail SVG for a symbol (synthetic project of its `objects[]`, viewBox = content AABB); a `<SymbolThumbnail>` component renders it into each library row.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest + RTL, Playwright. No new dependencies.

## Global Constraints

- **Export parity (preview == export) is sacred.** `renderSvgDocument(project)` with no opts must be BYTE-IDENTICAL to today; the optional `viewBox` is a new, defaulted argument used only by the thumbnail (a separate consumer).
- **No new dependencies.**
- **No store/engine-render change** beyond the optional `viewBox` arg on `renderSvgDocument`.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: `renderSvgDocument` viewBox override + `symbolThumbnailSvg` helper

**Files:**
- Modify: `src/services/export/renderDocument.ts` (signature ~19; return ~96–99)
- Create: `src/ui/components/AssetPanel/symbolThumbnail.ts`
- Test: `src/services/export/renderDocument.test.ts`, `src/ui/components/AssetPanel/symbolThumbnail.test.ts`

**Interfaces:**
- Produces: `renderSvgDocument(project: Project, opts?: { viewBox?: string }): string`; `symbolThumbnailSvg(symbol: SymbolAsset, assets: Asset[], meta: ProjectMeta): string | null`.
- Consumes: `sceneContentAABB` (Stage/snapping), `renderSvgDocument` (services).

- [ ] **Step 1: Write the failing tests**

Append to `src/services/export/renderDocument.test.ts` (`renderSvgDocument` and `createProject` are already imported at the top — do NOT re-import):

```ts
describe('renderSvgDocument viewBox override (thumbnails, 47d)', () => {
  it('honors an explicit viewBox', () => {
    const p = createProject();
    const svg = renderSvgDocument(p, { viewBox: '5 6 7 8' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 6 7 8">')).toBe(true);
  });

  it('defaults to "0 0 W H" when no opts (export unchanged)', () => {
    const p = createProject();
    const svg = renderSvgDocument(p);
    expect(svg).toContain(`viewBox="0 0 ${p.meta.width} ${p.meta.height}"`);
  });
});
```

Create `src/ui/components/AssetPanel/symbolThumbnail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { symbolThumbnailSvg } from './symbolThumbnail';
import { createProject, createSymbolAsset, createSceneObject, createVectorAsset } from '../../../engine';
import type { PathData } from '../../../engine';

const square = (off: number): PathData => ({
  closed: true,
  nodes: [
    { anchor: { x: off, y: off } },
    { anchor: { x: off + 10, y: off } },
    { anchor: { x: off + 10, y: off + 10 } },
    { anchor: { x: off, y: off + 10 } },
  ],
});

describe('symbolThumbnailSvg (47d)', () => {
  it('frames the symbol content with a content-AABB viewBox', () => {
    const meta = createProject().meta;
    const pathAsset = createVectorAsset('path', { id: 'pa-asset', path: square(100) }); // 100..110
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('pa-asset', { id: 'pa' })], width: 10, height: 10 });
    const svg = symbolThumbnailSvg(sym, [pathAsset, sym], meta)!;
    expect(svg).toContain('viewBox="100 100 10 10"');
    expect(svg).toContain('<svg'); // a real svg fragment
  });

  it('returns null for an empty symbol (placeholder)', () => {
    const meta = createProject().meta;
    const sym = createSymbolAsset({ id: 'sym', objects: [], width: 0, height: 0 });
    expect(symbolThumbnailSvg(sym, [sym], meta)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/export/renderDocument.test.ts -t "viewBox override" src/ui/components/AssetPanel/symbolThumbnail.test.ts`
Expected: FAIL — `renderSvgDocument` rejects a 2nd arg / ignores it; `symbolThumbnail.ts` does not exist.

- [ ] **Step 3: Add the `viewBox` override to `renderSvgDocument`**

In `src/services/export/renderDocument.ts`, change the signature:

```ts
export function renderSvgDocument(project: Project): string {
```
→
```ts
export function renderSvgDocument(project: Project, opts?: { viewBox?: string }): string {
```

and the return's viewBox:

```ts
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}">` +
    `<defs>${defs}${gradientDefs.join('')}</defs>${body}</svg>`
  );
```
→
```ts
  const viewBox = opts?.viewBox ?? `0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    `<defs>${defs}${gradientDefs.join('')}</defs>${body}</svg>`
  );
```

- [ ] **Step 4: Create `symbolThumbnail.ts`**

```ts
import type { Asset, Project, ProjectMeta, SymbolAsset } from '../../../engine';
import { renderSvgDocument } from '../../../services';
import { sceneContentAABB } from '../Stage/snapping';

// The SVG string for a symbol's content thumbnail, framed to its content bounds at t=0, or null when
// the symbol has no drawable content (the caller renders a placeholder). Reuses renderSvgDocument so
// the thumbnail matches preview/export; a NEW consumer that never affects the export bundle. (47d)
export function symbolThumbnailSvg(symbol: SymbolAsset, assets: Asset[], meta: ProjectMeta): string | null {
  const box = sceneContentAABB(symbol.objects, assets, 0);
  if (!box) return null;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  if (w <= 0 || h <= 0) return null;
  const project: Project = { meta, assets, objects: symbol.objects, audioClips: [] };
  return renderSvgDocument(project, { viewBox: `${box.minX} ${box.minY} ${w} ${h}` });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/services/export/renderDocument.test.ts src/ui/components/AssetPanel/symbolThumbnail.test.ts`
Expected: PASS. Then the whole export suite (regression — existing render tests must be byte-unchanged):
Run: `npx vitest run src/services/export/renderDocument.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/services/export/renderDocument.ts src/ui/components/AssetPanel/symbolThumbnail.ts src/services/export/renderDocument.test.ts src/ui/components/AssetPanel/symbolThumbnail.test.ts
git commit -m "feat(symbol-thumbnails): renderSvgDocument viewBox override + symbolThumbnailSvg helper"
```

---

### Task 2: `<SymbolThumbnail>` component + AssetPanel wiring + CSS

**Files:**
- Create: `src/ui/components/AssetPanel/SymbolThumbnail.tsx`
- Modify: `src/ui/components/AssetPanel/AssetPanel.tsx`, `src/ui/components/AssetPanel/AssetPanel.module.css`
- Test: `src/ui/components/AssetPanel/AssetPanel.test.tsx`

**Interfaces:** Consumes `symbolThumbnailSvg` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/AssetPanel/AssetPanel.test.tsx`:

```ts
it('renders a thumbnail for a symbol with drawable content (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  const pathAsset = createVectorAsset('path', {
    id: 'pa-asset',
    path: { closed: true, nodes: [{ anchor: { x: 100, y: 100 } }, { anchor: { x: 110, y: 100 } }, { anchor: { x: 110, y: 110 } }, { anchor: { x: 100, y: 110 } }] },
  });
  const sym = createSymbolAsset({ id: 'sym', name: 'Star', objects: [createSceneObject('pa-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [pathAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  expect(screen.getByTestId('symbol-thumb')).toBeInTheDocument(); // the rendered thumbnail
  expect(screen.getByTestId('symbol-sym')).toHaveTextContent('Star (1)'); // label still present
});

it('renders a placeholder thumbnail for an empty symbol (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  const sym = createSymbolAsset({ id: 'sym', name: 'Empty', objects: [], width: 0, height: 0 });
  const p = createProject();
  p.assets = [sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  expect(screen.getByTestId('symbol-thumb-empty')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx -t "thumbnail"`
Expected: FAIL — no `symbol-thumb` element rendered.

- [ ] **Step 3: Create `SymbolThumbnail.tsx`**

```tsx
import { useMemo } from 'react';
import type { Asset, ProjectMeta, SymbolAsset } from '../../../engine';
import { symbolThumbnailSvg } from './symbolThumbnail';
import styles from './AssetPanel.module.css';

export function SymbolThumbnail({ symbol, assets, meta }: { symbol: SymbolAsset; assets: Asset[]; meta: ProjectMeta }) {
  const svg = useMemo(() => symbolThumbnailSvg(symbol, assets, meta), [symbol, assets, meta]);
  // A <span> (not <div>) keeps the markup valid inside the row's <button>.
  if (!svg) return <span className={styles.thumbEmpty} data-testid="symbol-thumb-empty" aria-hidden />;
  return <span className={styles.thumb} data-testid="symbol-thumb" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

- [ ] **Step 4: Wire it into AssetPanel**

In `src/ui/components/AssetPanel/AssetPanel.tsx`, add the import and a `meta` subscription, and render the thumbnail inside each symbol button. Add near the other imports:

```tsx
import { SymbolThumbnail } from './SymbolThumbnail';
```

Add a `meta` subscription next to the existing `objects`/`assets`:

```tsx
  const meta = useEditor((s) => s.history.present.meta);
```

In the symbol `<button>` (the one with `data-testid={`symbol-${sym.id}`}`), render the thumbnail above the label. Change the button's children from:

```tsx
                {sym.name} ({countSymbolInstances(sym.id, { objects, assets })})
```
to:

```tsx
                <SymbolThumbnail symbol={sym} assets={assets} meta={meta} />
                <span>{sym.name} ({countSymbolInstances(sym.id, { objects, assets })})</span>
```

(`Asset` is a discriminated union on `kind`, so `assets.filter((a) => a.kind === 'symbol')` narrows `sym` to `SymbolAsset` — no cast needed. The `.thumb`/`.thumbEmpty` span uses `display: block` via CSS so it stacks above the label inside the button.)

- [ ] **Step 5: Add CSS**

Append to `src/ui/components/AssetPanel/AssetPanel.module.css`:

```css
.thumb,
.thumbEmpty {
  display: block;
  width: 100%;
  height: 40px;
  border-radius: 3px;
  background: var(--color-panel-2, rgba(0, 0, 0, 0.15));
  overflow: hidden;
}
.thumb :global(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
```

- [ ] **Step 6: Run to verify pass + the AssetPanel suite**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx`
Expected: PASS (the new thumbnail tests + the existing symbol-list/cycle tests — the thumbnail div is `aria-hidden` and doesn't change the button's text or click behaviour).

- [ ] **Step 7: Typecheck + lint + commit**

```bash
npm run typecheck
npx eslint src
git add src/ui/components/AssetPanel/
git commit -m "feat(symbol-thumbnails): SymbolThumbnail component + AssetPanel library wiring"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Draw a rect, Create Symbol → the library row shows a thumbnail svg.

```ts
test('a symbol shows a rendered thumbnail in the library (47d)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // The new symbol's library row renders a thumbnail (an inline <svg>).
  const thumb = page.getByTestId('symbol-thumb').first();
  await expect(thumb).toBeVisible();
  await expect(thumb.locator('svg')).toHaveCount(1);
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
Expected: all green. Export/parity suites unchanged-and-green (`renderSvgDocument` no-opts output byte-unchanged).

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(symbol-thumbnails): e2e a symbol shows a thumbnail in the library"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6): §2.1 viewBox override → Task 1. §2.2 helper → Task 1. §2.3 component + wiring → Task 2. §3 parity/perf/empty-fallback → Global Constraints + the empty/regression tests. §4 scope (thumbnails only; drag-to-place/rename deferred) → not implemented. §6 tests → export + helper (Task 1), RTL (Task 2), e2e (Task 3). ✅

**2. Placeholder scan:** No TBD/TODO; full code for the helper, component, CSS, and the exact `renderSvgDocument` before/after. ✅

**3. Type consistency:** `renderSvgDocument(project: Project, opts?: { viewBox?: string }): string`; `symbolThumbnailSvg(symbol: SymbolAsset, assets: Asset[], meta: ProjectMeta): string | null`; the synthetic `Project = { meta, assets, objects, audioClips }`; `sceneContentAABB(objects, assets, 0): AABB | null`. The component memo deps `[symbol, assets, meta]` are the only inputs. ✅

**4. Parity:** `renderSvgDocument` no-opts byte-unchanged (regression test); thumbnail is a separate consumer; no engine/runtime change. ✅
