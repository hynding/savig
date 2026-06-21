# M2 Slice 8 — Gradients: UI (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user assign and edit a linear/radial gradient on a vector object's fill/stroke from the Inspector, render it on the Stage (preview == export), and prove the export with an e2e.

**Architecture:** ONE store action `setVectorGradient(property, gradient | undefined)` (thin wrapper over the existing `setVectorStyle`, which already takes `Partial<VectorStyle>`). The Inspector constructs gradients with the pure engine helpers (`defaultGradient`, `angleToLinearCoords`, `linearCoordsToAngle`) and commits them. The Stage renders the gradient as a sibling **after** the shape inside the object `<g>` (shape stays `firstElementChild`), referencing it by the same id scheme as export.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright. Depends on Plan A (engine) being merged.

## Global Constraints

- Depends on Plan A: `Gradient`/`LinearGradient`/`RadialGradient`/`GradientStop` types, `defaultGradient`/`angleToLinearCoords`/`linearCoordsToAngle`/`paintRef` from `src/engine`, and the gradient-aware `renderShapeToSvg`/`renderDocument`/`computeFrame`.
- Per property a paint is **either** Solid (optionally an animated color track) **or** a gradient — mutually exclusive in the UI. Setting a gradient leaves any color track in the data but it is ignored (engine gradient-wins guard from Plan A Task 5).
- Id scheme (must match export): `savig-grad-<objectId>-fill` / `savig-grad-<objectId>-stroke`.
- Shape element stays the object `<g>`'s `firstElementChild` — gradient markup goes AFTER it.
- Single undo step per user gesture (commit via the store's `commit`, same as `setVectorStyle`).
- TDD: failing test → run (fail) → minimal impl → run (pass) → commit.

---

### Task 1: Store action `setVectorGradient`

**Files:**
- Modify: `src/ui/store/store.ts` (type in the store interface near `setVectorStyle`/`setVectorColor`, impl near line ~548)
- Modify: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `Gradient`, `ColorProperty` (engine), existing `setVectorStyle`.
- Produces: `setVectorGradient(property: ColorProperty, gradient: Gradient | undefined): void` — sets `${property}Gradient` on the selected vector object's asset style (a single undo step). `undefined` clears it.

- [ ] **Step 1: Write the failing test (append to `src/ui/store/store.test.ts`)**

```ts
it('setVectorGradient sets and clears a fill gradient on the selected vector asset', () => {
  // (use the file's existing helper to create+select a vector object; mirror the
  //  setVectorStyle test around line 249.)
  const s = useEditor.getState();
  // ... create a path/rect vector and ensure it is selected (selectedObjectId set) ...
  const grad = {
    type: 'linear' as const, x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  };
  useEditor.getState().setVectorGradient('fill', grad);
  let asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
  expect(asset && asset.kind === 'vector' && asset.style.fillGradient).toEqual(grad);

  useEditor.getState().setVectorGradient('fill', undefined);
  asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
  expect(asset && asset.kind === 'vector' && asset.style.fillGradient).toBeUndefined();
});
```

(Rename the `it(...)` title to plain ASCII `setVectorGradient ...`. Reuse this file's existing pattern for creating/selecting a vector object — see the `setVectorStyle({ fill: '#00ff00' })` test near line 249.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `setVectorGradient` not a function.

- [ ] **Step 3: Implement in `src/ui/store/store.ts`**

Add the import (extend the existing engine import) for the `Gradient` type. Add to the store interface (near `setVectorColor`):

```ts
  setVectorGradient(property: ColorProperty, gradient: Gradient | undefined): void;
```

Add the implementation right after `setVectorStyle`:

```ts
  setVectorGradient(property, gradient) {
    const key = property === 'fill' ? 'fillGradient' : 'strokeGradient';
    get().setVectorStyle({ [key]: gradient });
  },
```

(Note: `setVectorStyle` spreads `{ ...asset.style, ...updates }`; `{ fillGradient: undefined }` clears it, and the generic JSON persistence drops undefined keys on save.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(gradient): setVectorGradient store action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Inspector paint-type control (Solid / Linear / Radial)

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx` (the fill & stroke rows, ~278-310)
- Modify: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `setVectorGradient` (Task 1), `defaultGradient` (engine), `vector.style.fillGradient`/`strokeGradient`.
- Produces: a per-property `<select aria-label="fill paint">` / `"stroke paint"` with options `solid`/`linear`/`radial`. Switching to linear/radial commits `defaultGradient(type, seed)`; switching to solid clears the gradient. When a gradient is active, the solid color `<input>` is hidden.

- [ ] **Step 1: Write the failing test (append to `src/ui/components/Inspector/Inspector.test.tsx`)**

```ts
it('switching fill paint to linear assigns a default linear gradient', async () => {
  // ... render Inspector with a selected vector object (mirror the existing
  //     "editing a field" setup near line 32-55) ...
  await userEvent.selectOptions(screen.getByLabelText('fill paint'), 'linear');
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
  expect(asset && asset.kind === 'vector' && asset.style.fillGradient?.type).toBe('linear');
  // solid color input is hidden while a gradient is active
  expect(screen.queryByLabelText('fill')).not.toBeInTheDocument();
});

it('switching fill paint back to solid clears the gradient', async () => {
  // ... selected vector object with a fill gradient already set ...
  useEditor.getState().setVectorGradient('fill', { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] });
  await userEvent.selectOptions(screen.getByLabelText('fill paint'), 'solid');
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
  expect(asset && asset.kind === 'vector' && asset.style.fillGradient).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no `fill paint` control.

- [ ] **Step 3: Implement in `src/ui/components/Inspector/Inspector.tsx`**

Add to the destructured store actions (near `setVectorColor`): `setVectorGradient`. Add the engine import: `import { defaultGradient } from '../../../engine';` (extend an existing engine import line if present).

Define a small helper inside the component (above the returned JSX), parameterized by property so fill & stroke share it:

```tsx
const paintType = (prop: 'fill' | 'stroke'): 'solid' | 'linear' | 'radial' => {
  const g = prop === 'fill' ? vector.style.fillGradient : vector.style.strokeGradient;
  return g?.type ?? 'solid';
};
const onPaintTypeChange = (prop: 'fill' | 'stroke', next: 'solid' | 'linear' | 'radial') => {
  if (next === 'solid') {
    setVectorGradient(prop, undefined);
  } else {
    const seed = (prop === 'fill' ? vector.style.fill : vector.style.stroke);
    setVectorGradient(prop, defaultGradient(next, seed === 'none' ? '#cccccc' : seed));
  }
};
```

Replace the existing fill row (and analogously the stroke row) so the solid color input only shows when `paintType('fill') === 'solid'`, and add the paint-type select:

```tsx
<div className={styles.row}>
  <label htmlFor="insp-fill-paint">fill</label>
  <select
    id="insp-fill-paint"
    aria-label="fill paint"
    value={paintType('fill')}
    onChange={(e) => onPaintTypeChange('fill', e.target.value as 'solid' | 'linear' | 'radial')}
  >
    <option value="solid">solid</option>
    <option value="linear">linear</option>
    <option value="radial">radial</option>
  </select>
  {paintType('fill') === 'solid' && (
    <>
      <input
        type="checkbox"
        aria-label="fill enabled"
        checked={vector.style.fill !== 'none'}
        onChange={(e) => setVectorStyle({ fill: e.target.checked ? '#cccccc' : 'none' })}
      />
      <input
        id="insp-fill"
        aria-label="fill"
        type="color"
        disabled={vector.style.fill === 'none'}
        value={(sampled.fill ?? vector.style.fill) === 'none' ? '#cccccc' : (sampled.fill ?? vector.style.fill)}
        onChange={(e) => setVectorColor('fill', e.target.value)}
      />
    </>
  )}
</div>
```

Apply the identical change to the stroke row (`aria-label="stroke paint"`, `paintType('stroke')`, default `#000000`).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck`
Expected: PASS. (Existing "shows fill/stroke" tests still pass because default paint is `solid` → the `fill`/`stroke` inputs still render.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(gradient): Inspector paint-type select (solid/linear/radial)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Inspector gradient stop editor + linear angle

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Modify: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `setVectorGradient` (Task 1), `angleToLinearCoords`/`linearCoordsToAngle` (engine), the active `Gradient`.
- Produces: when a gradient is active for a property, a stop list (offset number + color picker + remove button per stop), an "add stop" button, and (linear only) an angle number field. Each edit commits a new `Gradient` via `setVectorGradient`. Stops sorted by offset on commit.

- [ ] **Step 1: Write the failing tests (append to `Inspector.test.tsx`)**

```ts
it('editing a fill gradient stop color commits a new gradient', async () => {
  // ... selected vector object ...
  useEditor.getState().setVectorGradient('fill', { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] });
  // re-render so the stop editor shows
  fireEvent.change(screen.getByLabelText('fill stop 0 color'), { target: { value: '#ff0000' } });
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
  expect(asset && asset.kind === 'vector' && asset.style.fillGradient?.stops[0].color).toBe('#ff0000');
});

it('adding a stop appends a midpoint stop', async () => {
  useEditor.getState().setVectorGradient('fill', { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] });
  await userEvent.click(screen.getByLabelText('add fill stop'));
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
  expect(asset && asset.kind === 'vector' && asset.style.fillGradient?.stops.length).toBe(3);
});

it('changing the linear angle updates the endpoints', async () => {
  useEditor.getState().setVectorGradient('fill', { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] });
  fireEvent.change(screen.getByLabelText('fill gradient angle'), { target: { value: '90' } });
  fireEvent.blur(screen.getByLabelText('fill gradient angle'));
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
  const g = asset && asset.kind === 'vector' ? asset.style.fillGradient : undefined;
  expect(g && g.type === 'linear' && Math.round(g.y2)).toBe(1); // ~top->bottom
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — stop controls absent.

- [ ] **Step 3: Implement a `GradientEditor` block in `Inspector.tsx`**

Add the engine imports `angleToLinearCoords, linearCoordsToAngle`. Add a helper that renders the editor for a property when a gradient is active, placed right under each property's paint-type row:

```tsx
const gradientFor = (prop: 'fill' | 'stroke') =>
  prop === 'fill' ? vector.style.fillGradient : vector.style.strokeGradient;

const renderGradientEditor = (prop: 'fill' | 'stroke') => {
  const g = gradientFor(prop);
  if (!g) return null;
  const setStops = (stops: typeof g.stops) => {
    const sorted = [...stops].sort((a, b) => a.offset - b.offset);
    setVectorGradient(prop, { ...g, stops: sorted });
  };
  return (
    <div className={styles.subgroup} data-testid={`${prop}-gradient-editor`}>
      {g.type === 'linear' && (
        <div className={styles.row}>
          <label htmlFor={`insp-${prop}-angle`}>angle</label>
          <NumberField
            label={`${prop} gradient angle`}
            value={Math.round(linearCoordsToAngle(g))}
            onCommit={(deg) => setVectorGradient(prop, { ...g, ...angleToLinearCoords(deg) })}
          />
        </div>
      )}
      {g.stops.map((stop, i) => (
        <div className={styles.row} key={i}>
          <input
            aria-label={`${prop} stop ${i} offset`}
            type="number" min={0} max={1} step={0.05}
            value={stop.offset}
            onChange={(e) => setStops(g.stops.map((s, j) => (j === i ? { ...s, offset: Math.max(0, Math.min(1, Number(e.target.value))) } : s)))}
          />
          <input
            aria-label={`${prop} stop ${i} color`}
            type="color"
            value={stop.color}
            onChange={(e) => setStops(g.stops.map((s, j) => (j === i ? { ...s, color: e.target.value } : s)))}
          />
          <button
            aria-label={`remove ${prop} stop ${i}`}
            disabled={g.stops.length <= 2}
            onClick={() => setStops(g.stops.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        aria-label={`add ${prop} stop`}
        onClick={() => setStops([...g.stops, { offset: 0.5, color: '#888888' }])}
      >
        + stop
      </button>
    </div>
  );
};
```

Call `{renderGradientEditor('fill')}` immediately after the fill paint row, and `{renderGradientEditor('stroke')}` after the stroke paint row. Reuse the existing `NumberField` component (commit-on-blur). If `styles.subgroup` does not exist, reuse `styles.group`/`styles.row` rather than inventing a class.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(gradient): Inspector stop editor + linear angle field

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Stage renders the gradient (preview == export)

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (the two vector branches, ~576-628)
- Modify: `src/ui/components/Stage/Stage.test.tsx` (or the Stage test file used in this repo)

**Interfaces:**
- Consumes: `paintRef` (engine), `asset.style.fillGradient`/`strokeGradient`.
- Produces: each vector `<g>` renders the shape first (unchanged `firstElementChild`), with `fill`/`stroke` set to `url(#savig-grad-<o.id>-fill|stroke)` when a gradient is present, followed by `<linearGradient>/<radialGradient>` sibling element(s) with the matching id(s).

- [ ] **Step 1: Write the failing test (append to the Stage test file)**

```ts
it('renders a fill gradient def + reference for a vector object', () => {
  // ... build a project with one rect vector object id 'o1' whose style has a
  //     fillGradient; render <Stage/> (mirror the existing Stage render setup) ...
  const shape = document.querySelector('[data-savig-object="o1"]')!.firstElementChild!;
  expect(shape.getAttribute('fill')).toBe('url(#savig-grad-o1-fill)');
  expect(document.querySelector('#savig-grad-o1-fill')!.tagName.toLowerCase()).toContain('gradient');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — fill is the solid color; no gradient element.

- [ ] **Step 3: Implement in `src/ui/components/Stage/Stage.tsx`**

Add a module-level helper component (top of the file, after imports):

```tsx
function GradientEl({ id, g }: { id: string; g: Gradient }) {
  const stops = g.stops.map((s, i) => (
    <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
  ));
  return g.type === 'linear' ? (
    <linearGradient id={id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>{stops}</linearGradient>
  ) : (
    <radialGradient id={id} cx={g.cx} cy={g.cy} r={g.r} fx={g.fx} fy={g.fy}>{stops}</radialGradient>
  );
}
```

(Add `Gradient` and `paintRef` to the engine import.)

In BOTH vector branches (path branch ~587 and rect/ellipse branch ~619), replace the `fill`/`stroke` props and append gradient siblings. For the rect/ellipse branch:

```tsx
<ShapeTag
  {...geomAttrs}
  fill={asset.style.fillGradient ? paintRef(`savig-grad-${o.id}-fill`) : asset.style.fill}
  stroke={asset.style.strokeGradient ? paintRef(`savig-grad-${o.id}-stroke`) : asset.style.stroke}
  strokeWidth={asset.style.strokeWidth}
  strokeLinecap={asset.style.strokeLinecap}
  strokeLinejoin={asset.style.strokeLinejoin}
/>
{asset.style.fillGradient && <GradientEl id={`savig-grad-${o.id}-fill`} g={asset.style.fillGradient} />}
{asset.style.strokeGradient && <GradientEl id={`savig-grad-${o.id}-stroke`} g={asset.style.strokeGradient} />}
```

Apply the same `fill`/`stroke` swap to the `<path>` in the path branch, and append the same two gradient siblings after the `<path>` inside its `<g>`. The shape stays the first child in both branches.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(gradient): Stage renders gradient defs + url() refs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: e2e — assign a gradient, export, assert the bundle

**Files:**
- Create: `e2e/gradient-export.spec.ts` (match the existing e2e directory/naming — see prior slices' specs, e.g. the brush/primitive morph specs)

**Interfaces:**
- Consumes: the full app + export. Drives the real UI in chromium.

- [ ] **Step 1: Write the e2e test**

```ts
import { expect, test } from '@playwright/test';

test('a gradient fill exports as a <linearGradient> def referenced by the shape', async ({ page }) => {
  await page.goto('/');
  // Draw a rectangle (mirror the existing draw flow used by other e2e specs:
  // select the rect tool via its palette button / 'R' shortcut, then drag on the Stage).
  await page.keyboard.press('r');
  const stage = page.getByTestId('stage'); // use the actual stage test id from prior specs
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage');
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160);
  await page.mouse.up();

  // Assign a linear gradient fill via the Inspector.
  await page.getByLabel('fill paint').selectOption('linear');

  // Export and read the produced SVG markup (mirror how prior e2e specs capture
  // the export — they assert against the exported bundle string / download).
  const svg = await exportedSvg(page); // reuse the existing export helper/pattern
  expect(svg).toContain('<linearGradient id="savig-grad-');
  expect(svg).toMatch(/fill="url\(#savig-grad-[^"]+-fill\)"/);
});
```

(Adapt selectors and the export-capture step to the concrete patterns in the existing e2e specs — the assertions on `<linearGradient>` + `url(#…)` are the point.)

- [ ] **Step 2: Run to verify it passes (after implementing nothing new — engine+UI already done)**

Run: `pnpm exec playwright test e2e/gradient-export.spec.ts`
Expected: PASS. If it fails, fix the selectors/export-capture to match the app, not the feature.

- [ ] **Step 3: Commit**

```bash
git add e2e/gradient-export.spec.ts
git commit -m "test(e2e): gradient fill exports as a referenced linearGradient

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Full gate

- [ ] **Step 1: Run the whole suite + typecheck + lint + build + e2e**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all green.

- [ ] **Step 2: Commit (only if incidental fixups were needed)**

```bash
git add -A && git commit -m "chore(gradient): UI gate green" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §6.3 Stage render (sibling-after-shape, url ref) → Task 4. ✓
- §7 Solid/gradient mutual exclusion → Task 2 (paint-type select hides solid input; clears/sets gradient). ✓
- §8 store actions → Task 1 (`setVectorGradient`); type/angle/stops via Inspector + engine helpers → Tasks 2-3 (the spec's separate `setGradientStops/Type/Angle` are folded into Inspector-builds-gradient + the single `setVectorGradient` commit — DRYer, same behavior). ✓
- §8 Inspector paint-type control + stop editor → Tasks 2-3. ✓
- §11 e2e → Task 5. ✓

**Placeholder scan:** Concrete code in every implementation step. The "adapt to existing patterns" notes (Tasks 1, 5) point at reusing this repo's established test factories / e2e export-capture rather than inventing them — the assertions are concrete. No TBD/TODO.

**Type consistency:** `setVectorGradient(property: ColorProperty, gradient: Gradient | undefined)` defined in Task 1, consumed identically in Tasks 2-3. `GradientEl` props `{ id: string; g: Gradient }` in Task 4. Id scheme `savig-grad-<id>-fill|stroke` matches Plan A (Tasks 3-4) and is asserted in Tasks 4-5. `defaultGradient`/`angleToLinearCoords`/`linearCoordsToAngle`/`paintRef` names match Plan A. ✓
