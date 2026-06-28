# Animated Boolean — Slice 3c: Operand Discoverability on Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a live boolean (or one of its operands) is selected, draw each operand as a faint clickable "ghost" outline on the canvas so operands can be seen and selected there (then edited with the existing handles, re-clipping the boolean live).

**Architecture:** A live boolean draws its result path from `resolveBooleanRings` world coordinates inside the Stage content group (no per-object transform). A new engine helper `operandWorldRings` returns one operand's world outline as `PathData[]` (uniform for leaf/group/nested, mirroring `resolveBooleanRings`); the Stage draws a ghost `<path>` per operand of the active boolean in that same world space and selects the operand on click.

**Tech Stack:** TypeScript (strict), React + Zustand, `polygon-clipping`, Vitest + RTL, Playwright.

## Global Constraints

- **No new edit machinery:** once a ghost selects an operand, all existing selection/handle/nudge paths already work and re-clip the boolean live. 3c only adds discoverability (ghost render + click-select).
- **Ghosts appear ONLY in a boolean editing context:** the selected object is a live boolean OR one of its operands. Every other selection leaves the canvas unchanged (parity).
- **Root-scene only:** ghosts gated on `activeAssetId === null` (live booleans are root-only).
- **Alt-aware button-disabled state is OUT OF SCOPE** — already satisfied by 3b (live eligibility == `canBool`; buttons title "Alt: animated (live) boolean").
- A degenerate operand (empty group / empty nested boolean) yields no ghost (`operandWorldRings` → `[]`).

---

### Task 1: Engine — `operandWorldRings`

**Files:**
- Modify: `src/engine/geom/boolean.ts` (add an exported helper near `operandWorldGeom`/`resolveBooleanRings`)
- Test: `src/engine/geom/boolean.test.ts` (new `describe('operandWorldRings', …)`)

**Interfaces:**
- Consumes: `operandWorldGeom(project, obj, time, visited?)`, module-private `ringToPathData(ring)`, and the module-private types `PcRing`/`PcPolygon`/`PcMultiPolygon` (all already in this file).
- Produces: `operandWorldRings(project: Project, obj: SceneObject, time: number): PathData[]` — a single operand's world-space outline rings (leaf shape / group union / nested boolean result), `[]` when no geometry.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/geom/boolean.test.ts`. Update the import on line 2 to add `operandWorldRings`:

```ts
import { booleanOp, objectToWorldPolygon, ringArea, operandCubicsWorld, resolveBooleanRings, operandWorldRings } from './boolean';
```

Then append a new describe block at the end of the file:

```ts
describe('operandWorldRings', () => {
  it('returns a leaf operand outline (one ring spanning the rect)', () => {
    const r = rectObj('r', 0, 20, 10, 5, 5); // world x 5..25, y 5..15
    const rings = operandWorldRings({ ...createProject(), objects: [r[0]], assets: [r[1]] }, r[0], 0);
    expect(rings.length).toBe(1);
    const xs = rings[0].nodes.map((n) => n.anchor.x);
    expect(Math.min(...xs)).toBeCloseTo(5, 3);
    expect(Math.max(...xs)).toBeCloseTo(25, 3);
  });

  it('returns a GROUP operand outline as the union of its leaves (spans both rects)', () => {
    const g1 = rectObj('g1', 0, 20, 40, 0, 0); // x 0..20
    const g2 = rectObj('g2', 1, 20, 40, 20, 0); // x 20..40 (abuts g1 -> one merged ring)
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 2 });
    g1[0].parentId = 'grp';
    g2[0].parentId = 'grp';
    const project = { ...createProject(), objects: [g1[0], g2[0], group], assets: [g1[1], g2[1]] };
    const rings = operandWorldRings(project, group, 0);
    expect(rings.length).toBeGreaterThan(0);
    const xs = rings.flatMap((r) => r.nodes.map((n) => n.anchor.x));
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(40, 3);
  });

  it('returns a NESTED boolean operand outline with its hole (>=2 rings)', () => {
    const big = rectObj('ib', 0, 40, 40, 0, 0);
    const small = rectObj('is', 1, 10, 10, 15, 15);
    const innerAsset = createVectorAsset('path', { id: 'innera', path: { nodes: [], closed: false } });
    const inner = createSceneObject('innera', { id: 'inner', zOrder: 2, boolean: { op: 'subtract', operandIds: ['ib', 'is'] } });
    const project = { ...createProject(), objects: [big[0], small[0], inner], assets: [big[1], small[1], innerAsset] };
    const rings = operandWorldRings(project, inner, 0);
    expect(rings.length).toBe(2); // outer boundary + the hole
  });

  it('returns [] for a degenerate operand (empty group)', () => {
    const group = createGroupObject({ id: 'empty', anchorX: 0.5, anchorY: 0.5, zOrder: 0 });
    const rings = operandWorldRings({ ...createProject(), objects: [group], assets: [] }, group, 0);
    expect(rings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t "operandWorldRings"`
Expected: FAIL — `operandWorldRings` is not exported / not defined.

- [ ] **Step 3: Implement `operandWorldRings`**

In `src/engine/geom/boolean.ts`, add directly AFTER the `operandWorldGeom` function (so `ringToPathData` and the Pc types are in scope):

```ts
/** The world-space outline rings of a single boolean OPERAND (a leaf shape, a GROUP's leaf-union, or
 *  a nested boolean's result) at `time`, as a flat PathData[] (compound, even-odd like the boolean's
 *  own rings). [] when the operand contributes no geometry. Used by the editor to ghost a selected
 *  boolean's operands on canvas so they can be seen + clicked. Normalizes operandWorldGeom's
 *  PcPolygon (Ring[]) | PcMultiPolygon (Polygon[]). */
export function operandWorldRings(project: Project, obj: SceneObject, time: number): PathData[] {
  const geom = operandWorldGeom(project, obj, time, new Set());
  if (geom.length === 0) return [];
  // PcPolygon -> geom[0][0] is a Pair (number,number); PcMultiPolygon -> geom[0][0] is a Ring (Pair[]).
  // Distinguish by whether the innermost element is an array (a Pair) vs a number.
  const isMulti = Array.isArray((geom as PcMultiPolygon)[0]?.[0]?.[0]);
  const rings: PcRing[] = isMulti ? (geom as PcMultiPolygon).flat() : (geom as PcPolygon);
  return rings.map((r) => ringToPathData(r)).filter((p) => p.nodes.length >= 3);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts`
Expected: PASS — the 4 new tests + all pre-existing boolean tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts
git commit -m "feat(boolean): operandWorldRings — a single operand's world outline (leaf/group/nested)"
```

---

### Task 2: Stage — operand ghost overlay + click-to-select

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (imports; a memo near the other selectors ~line 84-91; the ghost overlay JSX inserted between the `renderLeaves.map` block end (~line 1957 `})}`) and `{selectedVector && (` (~1958))
- Test: `src/ui/components/Stage/Stage.test.tsx` (new tests at end of file)

**Interfaces:**
- Consumes: `operandWorldRings` (Task 1); `pathToDRings` (already imported in Stage line 3); `selectActiveAssetId` (from `../../store/selectors`); store fields `project`, `time`, `selectedId`, `zoom` (already in scope); `useEditor.getState().selectObject(id)`.
- Produces: per-operand `<path data-testid="operand-ghost-<operandId>" data-operand-of="<boolId>">` ghosts.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Stage/Stage.test.tsx`. These build a root project with a live boolean over two overlapping rects, commit it, select the boolean, render `<Stage>`, and assert ghosts. Match the file's harness (`render(<Stage nodes={nodes} />)`, `useEditor.getState()`):

```ts
describe('live boolean operand ghosts (slice 3c)', () => {
  function liveBoolProject() {
    const aAsset = createVectorAsset('rect', { id: 'a-asset' });
    const bAsset = createVectorAsset('rect', { id: 'b-asset' });
    const boolAsset = createVectorAsset('path', { id: 'bool-asset', path: { nodes: [], closed: false } });
    const a = createSceneObject('a-asset', { id: 'opA', zOrder: 0, shapeBase: { width: 40, height: 40 } });
    const b = createSceneObject('b-asset', {
      id: 'opB', zOrder: 1, shapeBase: { width: 40, height: 40 },
      base: { x: 20, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const boolObj = createSceneObject('bool-asset', { id: 'boolobj', zOrder: 2, boolean: { op: 'union', operandIds: ['opA', 'opB'] } });
    const project = createProject();
    project.assets = [aAsset, bAsset, boolAsset];
    project.objects = [a, b, boolObj];
    return project;
  }

  it('renders a ghost per operand when the boolean is selected, each with a non-empty d', () => {
    act(() => {
      useEditor.getState().commit(liveBoolProject());
      useEditor.getState().selectObject('boolobj');
    });
    render(<Stage nodes={new Map()} />);
    const ga = screen.getByTestId('operand-ghost-opA');
    const gb = screen.getByTestId('operand-ghost-opB');
    expect(ga.getAttribute('d')).toMatch(/^M/);
    expect(gb.getAttribute('d')).toMatch(/^M/);
    expect(ga.getAttribute('data-operand-of')).toBe('boolobj');
  });

  it('clicking a ghost selects that operand', () => {
    act(() => {
      useEditor.getState().commit(liveBoolProject());
      useEditor.getState().selectObject('boolobj');
    });
    render(<Stage nodes={new Map()} />);
    fireEvent.pointerDown(screen.getByTestId('operand-ghost-opA'));
    expect(useEditor.getState().selectedObjectId).toBe('opA');
  });

  it('keeps sibling ghosts visible when an operand itself is selected', () => {
    act(() => {
      useEditor.getState().commit(liveBoolProject());
      useEditor.getState().selectObject('opA');
    });
    render(<Stage nodes={new Map()} />);
    expect(screen.queryByTestId('operand-ghost-opB')).not.toBeNull();
  });

  it('renders no ghosts when an unrelated object is selected', () => {
    act(() => {
      const p = liveBoolProject();
      p.objects.push(createSceneObject('a-asset', { id: 'lone', zOrder: 3, shapeBase: { width: 10, height: 10 } }));
      useEditor.getState().commit(p);
      useEditor.getState().selectObject('lone');
    });
    render(<Stage nodes={new Map()} />);
    expect(screen.queryByTestId('operand-ghost-opA')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "operand ghosts"`
Expected: FAIL — `operand-ghost-opA` not found (no ghost overlay yet).

- [ ] **Step 3: Add the imports**

In `src/ui/components/Stage/Stage.tsx`:
- Add `operandWorldRings` to the engine import on line 3 (the long `from '../../../engine'` import).
- Add a new import line after the store import (line 11):

```ts
import { selectActiveAssetId } from '../../store/selectors';
```

- [ ] **Step 4: Add the `operandGhosts` memo**

In `Stage.tsx`, after the existing selectors (after `const zoom = useEditor((s) => s.zoom);`, ~line 91), add:

```ts
  const activeAssetId = useEditor(selectActiveAssetId);
  // Live-boolean operand ghosts (slice 3c): when a live boolean — or one of its operands — is
  // selected at the root scene, surface each operand's world outline on canvas so it can be seen and
  // clicked (operands are otherwise render-hidden via flattenInstances `consumed`). Re-derives per
  // frame so ghosts track animated operands.
  const operandGhosts = useMemo(() => {
    if (activeAssetId !== null || !selectedId) return [];
    const byId = new Map(project.objects.map((o) => [o.id, o] as const));
    const sel = byId.get(selectedId);
    if (!sel) return [];
    const activeBool = sel.boolean
      ? sel
      : project.objects.find((o) => o.boolean?.operandIds.includes(selectedId));
    if (!activeBool?.boolean) return [];
    return activeBool.boolean.operandIds.flatMap((id) => {
      const op = byId.get(id);
      if (!op) return [];
      const rings = operandWorldRings(project, op, time);
      if (rings.length === 0) return [];
      return [{ id, boolId: activeBool.id, d: pathToDRings(rings[0], rings.slice(1)) }];
    });
  }, [project, time, selectedId, activeAssetId]);
```

- [ ] **Step 5: Add the ghost overlay JSX**

In `Stage.tsx`, insert this block immediately after the `renderLeaves.map(...)` closing `})}` (~line 1957) and before `{selectedVector && (` (~line 1958), so ghosts draw above the boolean fill and below the selection handles, inside the content `<g>`:

```tsx
          {/* Live-boolean operand ghosts (slice 3c): faint, clickable outlines of the active
              boolean's operands. fill="transparent" + pointerEvents:'all' makes the whole area
              select; stopPropagation prevents the canvas-background deselect. */}
          {operandGhosts.map((g) => (
            <path
              key={`operand-ghost-${g.id}`}
              data-testid={`operand-ghost-${g.id}`}
              data-operand-of={g.boolId}
              d={g.d}
              fillRule="evenodd"
              fill="transparent"
              stroke="var(--color-accent)"
              strokeOpacity={0.5}
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                useEditor.getState().selectObject(g.id);
              }}
            />
          ))}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS — the 4 new tests + all pre-existing Stage tests (parity).

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm tsc --noEmit && pnpm eslint src/ui/components/Stage/Stage.tsx`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(boolean): canvas operand ghosts — see + click a live boolean's operands (slice 3c)"
```

---

### Task 3: E2E — the operand editing loop

**Files:**
- Create: `e2e/boolean-live-operands.spec.ts`

**Interfaces:**
- Consumes: the Stage ghost overlay (Task 2). Drives the real app via Playwright.

- [ ] **Step 1: Write the e2e**

Create `e2e/boolean-live-operands.spec.ts` (mirror `e2e/boolean-ops.spec.ts`'s harness: delete file-picker shims, `goto('/')`, draw rects via the Tools group, Stage-scoped locators):

```ts
import { test, expect } from '@playwright/test';

test('live boolean operands ghost on canvas and re-clip when nudged', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  // Two overlapping rects.
  await drawRect(120, 120, 280, 280);
  await drawRect(220, 120, 380, 280);

  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Select both, then Alt+Union -> a LIVE boolean (operands kept but render-hidden -> 1 drawn).
  await objects.nth(0).click({ position: { x: 8, y: 8 } });
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Union', exact: true }).click({ modifiers: ['Alt'] });
  await expect(objects).toHaveCount(1); // operands consumed; the live result draws

  // The live boolean is selected on create -> its operand ghosts are on canvas.
  const ghosts = stage.locator('[data-testid^="operand-ghost-"]');
  await expect(ghosts).toHaveCount(2);

  // Record the live result's bbox, then select an operand via its ghost and nudge it.
  const before = (await objects.first().boundingBox())!;
  await ghosts.first().click();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');

  // The boolean re-clipped: its rendered result moved/grew with the operand.
  const after = (await objects.first().boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.width - before.width)).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/boolean-live-operands.spec.ts`
Expected: PASS (1 test). If a stale dev server interferes, stop it first.

- [ ] **Step 3: Commit**

```bash
git add e2e/boolean-live-operands.spec.ts
git commit -m "test(e2e): live boolean operand ghosts visible + re-clip on nudge (slice 3c)"
```

---

## Notes for the executor

- **`operandWorldRings` mirrors `resolveBooleanRings`** (both return `PathData[]`), so the Stage renders a ghost with the exact `pathToDRings(rings[0], rings.slice(1))` call it uses for the boolean itself.
- **Do not add edit machinery** — selecting an operand via a ghost reuses the existing handles/nudge; moving it re-clips the boolean because the editor calls `resolveBooleanRings` every frame.
- The `isMulti` detection in `operandWorldRings` distinguishes `PcPolygon` (innermost is a number) from `PcMultiPolygon` (innermost is a `Pair`); both are normalized to a flat ring list.
- If a Stage test can't find a ghost, confirm the project was committed at the ROOT scene (`activeAssetId === null`) and the boolean/operand was selected BEFORE `render(<Stage>)`.
