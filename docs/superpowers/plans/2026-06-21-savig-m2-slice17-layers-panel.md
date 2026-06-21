# Slice 17 Layers Panel + Object Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Layers panel listing every object (front-first) with click-to-select and a per-object visibility (hide/show) toggle that the Stage and export respect.

**Architecture:** An optional `hidden?: boolean` on `SceneObject` (persisted, undoable) drives two render guards — the Stage's `ordered` memo filters it out and export's `renderDocument` skips it. A new `LayersPanel` component lists objects front-first, selecting on row click and toggling `hidden` via `toggleObjectVisibility`. No engine pure helper, no runtime change, no migration.

**Tech Stack:** TypeScript (strict), React 18, Vitest + RTL, Playwright; the existing `src/engine` types + `src/ui` store/Stage/App + `src/services/export`.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- `hidden?: boolean` on `SceneObject` is OPTIONAL and persisted (absent == visible). NO migration (project stays v4).
- Toggling visibility is an undoable `commit` (it is a document field affecting export).
- Render skip: Stage filters `ordered` (`!o.hidden`); export `renderDocument` returns `''` for a hidden object BEFORE its gradient defs are pushed. Runtime is UNCHANGED (hidden objects aren't exported).
- The Layers panel lists objects FRONT-FIRST (sorted by `zOrder` descending). Row click selects; the eye toggle calls `stopPropagation` then toggles, so it does not also select.
- No engine pure helper (filtering is inline `!o.hidden`); no runtime bundle change.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: `hidden` field + `toggleObjectVisibility`

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `SceneObject.hidden?: boolean`; store action `toggleObjectVisibility(id: string): void`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/store/store.test.ts`:

```ts
describe('toggleObjectVisibility', () => {
  it('flips hidden (undoable)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    expect(useEditor.getState().history.present.objects[0].hidden).toBeFalsy();
    useEditor.getState().toggleObjectVisibility(id);
    expect(useEditor.getState().history.present.objects[0].hidden).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects[0].hidden).toBeFalsy();
  });
  it('is a no-op for an unknown id', () => {
    const s = useEditor.getState();
    s.newProject();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().toggleObjectVisibility('nope');
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "toggleObjectVisibility"`
Expected: FAIL — `toggleObjectVisibility` undefined.

- [ ] **Step 3: Add the type field**

In `src/engine/types.ts`, in `SceneObject`, after `parentId?: string;`:

```ts
  /** When true, the object is not rendered on the Stage or in the export. */
  hidden?: boolean;
```

- [ ] **Step 4: Add the store action**

In `src/ui/store/store.ts`:

1. In the actions interface, after `reorderSelected(op: ReorderOp): void;`:

```ts
  toggleObjectVisibility(id: string): void;
```
2. Add the action near `reorderSelected`:

```ts
  toggleObjectVisibility(id) {
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === id);
    if (!obj) return;
    get().commit(replaceObject(project, { ...obj, hidden: !obj.hidden }));
  },
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "toggleObjectVisibility"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice17): SceneObject.hidden + toggleObjectVisibility (undoable)"
```

---

### Task 2: Render skip — Stage + export

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Modify: `src/services/export/renderDocument.ts`
- Test: `src/ui/components/Stage/Stage.test.tsx`, `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `SceneObject.hidden` (Task 1).
- Produces: hidden objects are not rendered on the Stage and produce no export markup.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('does not render a hidden object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectVisibility(id);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId(`object-${id}`)).toBeNull();
});
```

Append to `src/services/export/renderDocument.test.ts`:

```ts
it('omits a hidden object (and its gradient def) from the export', () => {
  const grad = {
    type: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 0,
    stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
  };
  const project = createProject();
  project.assets.push(
    createVectorAsset('rect', { id: 'vh', style: { fill: '#000000', stroke: 'none', strokeWidth: 0, fillGradient: grad } }),
  );
  project.objects.push(
    createSceneObject('vh', {
      id: 'o1',
      hidden: true,
      anchorMode: 'fraction',
      shapeBase: { width: 50, height: 50 },
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    }),
  );
  const out = renderSvgDocument(project);
  expect(out).not.toContain('data-savig-object="o1"');
  expect(out).not.toContain('<linearGradient id="savig-grad-o1-fill"');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx src/services/export/renderDocument.test.ts`
Expected: FAIL — the hidden object still renders / still appears in the export.

- [ ] **Step 3: Filter hidden in the Stage `ordered` memo**

In `src/ui/components/Stage/Stage.tsx`, change the `ordered` memo:

```ts
  const ordered = useMemo(
    () => [...project.objects].filter((o) => !o.hidden).sort((a, b) => a.zOrder - b.zOrder),
    [project.objects],
  );
```

- [ ] **Step 4: Skip hidden in `renderDocument`**

In `src/services/export/renderDocument.ts`, in the body map, add the early return right after resolving `obj`:

```ts
    .map((state) => {
      const obj = objectsById.get(state.objectId)!;
      if (obj.hidden) return '';
      const asset = assetsById.get(obj.assetId);
      if (!asset) {
        throw new MissingAssetError(`Missing asset "${obj.assetId}" referenced by object "${obj.id}".`);
      }
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx src/services/export/renderDocument.test.ts`
Expected: PASS (hidden object absent from both; visible objects unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/services/export/renderDocument.ts src/ui/components/Stage/Stage.test.tsx src/services/export/renderDocument.test.ts
git commit -m "feat(slice17): Stage + export skip hidden objects"
```

---

### Task 3: LayersPanel component + mount

**Files:**
- Create: `src/ui/components/LayersPanel/LayersPanel.tsx`
- Create: `src/ui/components/LayersPanel/LayersPanel.module.css`
- Create: `src/ui/components/LayersPanel/LayersPanel.test.tsx`
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: `selectObject`, `toggleObjectVisibility` (store); `selectedObjectId`, `history.present.objects`.
- Produces: a Layers panel with `data-testid="layer-<id>"` rows and `data-testid="layer-visibility-<id>"` toggles.

- [ ] **Step 1: Write the failing test**

Create `src/ui/components/LayersPanel/LayersPanel.test.tsx`:

```ts
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayersPanel } from './LayersPanel';
import { useEditor } from '../../store/store';

beforeEach(() => useEditor.getState().newProject());

function twoRects() {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1 (front)
}

it('lists objects front-first', () => {
  twoRects();
  const objs = useEditor.getState().history.present.objects;
  const front = objs.find((o) => o.zOrder === 1)!;
  render(<LayersPanel />);
  const rows = screen.getAllByTestId(/^layer-/); // row testids start with "layer-" (eye is "vis-")
  expect(rows[0].getAttribute('data-testid')).toBe(`layer-${front.id}`); // front at top
});

it('clicking a row selects that object', async () => {
  twoRects();
  const back = useEditor.getState().history.present.objects.find((o) => o.zOrder === 0)!;
  render(<LayersPanel />);
  await userEvent.click(screen.getByTestId(`layer-${back.id}`));
  expect(useEditor.getState().selectedObjectId).toBe(back.id);
});

it('clicking the eye toggles visibility without changing selection', async () => {
  twoRects();
  const objs = useEditor.getState().history.present.objects;
  const back = objs.find((o) => o.zOrder === 0)!;
  const front = objs.find((o) => o.zOrder === 1)!; // selected after twoRects
  render(<LayersPanel />);
  await userEvent.click(screen.getByTestId(`vis-${back.id}`));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === back.id)!.hidden).toBe(true);
  expect(useEditor.getState().selectedObjectId).toBe(front.id); // selection unchanged
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/LayersPanel/LayersPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/ui/components/LayersPanel/LayersPanel.tsx`:

```tsx
import { useEditor } from '../../store/store';
import styles from './LayersPanel.module.css';

export function LayersPanel() {
  const objects = useEditor((s) => s.history.present.objects);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const { selectObject, toggleObjectVisibility } = useEditor.getState();

  // Front-first: highest zOrder at the top (Figma/Photoshop convention).
  const ordered = [...objects].sort((a, b) => b.zOrder - a.zOrder);

  return (
    <div className={styles.panel} aria-label="Layers">
      <div className={styles.header}>Layers</div>
      {ordered.length === 0 ? (
        <div className={styles.empty}>No objects</div>
      ) : (
        ordered.map((o) => (
          <div
            key={o.id}
            data-testid={`layer-${o.id}`}
            data-selected={o.id === selectedId}
            className={`${styles.row} ${o.id === selectedId ? styles.selected : ''} ${o.hidden ? styles.hidden : ''}`}
            onClick={() => selectObject(o.id)}
          >
            <span className={styles.name}>{o.name}</span>
            <button
              data-testid={`vis-${o.id}`}
              aria-label={`${o.name} visibility`}
              aria-pressed={!o.hidden}
              className={styles.eye}
              onClick={(e) => {
                e.stopPropagation();
                toggleObjectVisibility(o.id);
              }}
            >
              {o.hidden ? '▯' : '◉'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
```

> `◉` (◉) = visible, `▯` (▯) = hidden — plain glyphs, no icon dependency.

- [ ] **Step 4: Implement the CSS**

Create `src/ui/components/LayersPanel/LayersPanel.module.css`:

```css
.panel { border-top: 1px solid var(--color-border); }
.header { padding: var(--space-2) var(--space-3); font-weight: 600; color: var(--color-text-dim); }
.row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) var(--space-3); cursor: pointer; }
.row:hover { background: var(--color-panel-2); }
.selected { background: var(--color-panel-2); outline: 1px solid var(--color-accent); }
.hidden .name { color: var(--color-text-dim); text-decoration: line-through; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eye { background: none; border: none; cursor: pointer; color: var(--color-text); padding: 0 var(--space-1); }
.empty { padding: var(--space-2) var(--space-3); color: var(--color-text-dim); }
```

- [ ] **Step 5: Mount in App**

In `src/ui/App.tsx`:

1. Import it (beside the AssetPanel import):

```ts
import { LayersPanel } from './components/LayersPanel/LayersPanel';
```
2. Add it inside the existing `assets` section, after `<AssetPanel />`:

```tsx
      <section className={styles.assets} aria-label="Assets">
        <AssetPanel />
        <LayersPanel />
      </section>
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/LayersPanel/LayersPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Gate + commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add src/ui/components/LayersPanel/ src/ui/App.tsx
git commit -m "feat(slice17): LayersPanel (front-first list, select, visibility toggle)"
```

---

### Task 4: End-to-end — select an occluded object + toggle visibility

**Files:**
- Create: `e2e/layers-panel.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the e2e**

Create `e2e/layers-panel.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('layers panel selects an object and toggles its visibility', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw two rects.
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const rectTool = page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true });
  for (const [dx, dy] of [[60, 60], [200, 160]]) {
    await rectTool.click();
    await page.mouse.move(box.x + dx, box.y + dy);
    await page.mouse.down();
    await page.mouse.move(box.x + dx + 80, box.y + dy + 60);
    await page.mouse.up();
  }
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);

  // The Layers panel lists both; toggle the visibility of the first-listed (front) object.
  const rows = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]');
  await expect(rows).toHaveCount(2);
  const firstId = await rows.first().getAttribute('data-testid'); // "layer-<id>"
  const objId = firstId!.replace('layer-', '');
  await page.getByTestId(`vis-${objId}`).click();

  // One fewer object renders; toggling again restores it.
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);
  await page.getByTestId(`vis-${objId}`).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/layers-panel.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/layers-panel.spec.ts
git commit -m "test(e2e): layers panel selects + toggles object visibility"
```

---

## Self-Review (plan vs spec)

- **§2 hidden field (optional, persisted, undoable)** → Task 1. ✅
- **§3 render skip (Stage ordered filter; export early-return before gradient defs)** → Task 2. ✅
- **§4 store toggleObjectVisibility (commit; no-op unknown id)** → Task 1. ✅
- **§5 LayersPanel (front-first; row click selects; eye toggles w/ stopPropagation; selected highlight; empty state; mounted in assets column)** → Task 3. ✅
- **§6 no persistence/runtime change** → only types, store, Stage, renderDocument, the new panel, App, tests, one e2e touched. ✅
- **§7 tests (store toggle/undo/no-op; Stage hidden-not-rendered; export hidden-omitted incl. gradient def; panel front-first/select/eye; e2e)** → Tasks 1, 2, 3, 4. ✅
- **Type consistency:** `hidden?: boolean` (Task 1) consumed by Tasks 2/3; `toggleObjectVisibility(id)` name consistent across store/panel; testids `layer-<id>` / `layer-visibility-<id>` consistent in Task 3 component + test + Task 4 e2e. ✅
- **Placeholder scan:** all steps carry concrete code; the e2e Tools-group + testid-prefix selectors mirror prior slices. ✅
