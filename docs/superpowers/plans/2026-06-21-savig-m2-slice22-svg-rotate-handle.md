# Slice 22 SVG Rotate Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give imported-SVG objects the same on-canvas drag-to-rotate handle vector objects already have.

**Architecture:** One memo change in `Stage.tsx` — `selectedRotatable` stops bailing out for non-vector assets and instead computes the bbox/anchor for an imported-SVG object (bbox = `(0,0,asset.width,asset.height)`, absolute centered anchor). The rotation overlay, the `rotateHandle.ts` math, the `onRotateHandlePointerDown/Move/Up` handlers, and the rotation-keyframe commit are all type-agnostic and unchanged. Editor-only: `Transform2D.rotation` already round-trips/animates/exports.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Only `selectedRotatable` changes. `selectedVector` (resize) and `selectedGradient` keep excluding non-vector assets, so an imported-SVG object shows **only** the rotation handle.
- SVG branch: `bbox = { x: 0, y: 0, width: asset.width, height: asset.height }`; anchor `= resolveAnchor(obj, state, undefined)` (imported-SVG objects use an absolute anchor — `addObject` seeds `anchorX/Y = width/2,height/2` with no `'fraction'` anchorMode). Audio/other assets → `return null`.
- Keep the existing `obj.hidden || obj.locked` exclusion (Slice 17/19 parity).
- Editor-only: NO engine/render/runtime/export/migration change. Stays v4.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: `selectedRotatable` accepts imported-SVG + Stage unit tests

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (the `selectedRotatable` memo, currently ~lines 131–144)
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Produces: the rotation overlay (`rotate-handle` / `rotate-handle-overlay` testids) now renders for a selected imported-SVG object, and dragging it commits to `tracks.rotation`.

- [ ] **Step 1: Flip the existing svg test + add a drag test**

In `src/ui/components/Stage/Stage.test.tsx`, REPLACE the existing test:

```ts
it('renders no rotate handle for a non-vector (imported svg) object', () => {
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('rotate-handle')).toBeNull();
});
```

with (note the flipped assertion + new name):

```ts
it('renders a rotate handle for a selected imported-svg object', () => {
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a'); // auto-selected
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('rotate-handle')).toBeInTheDocument();
  expect(screen.getByTestId('rotate-handle-overlay')).toBeInTheDocument();
});
```

Then ADD a drag-commit test immediately after the existing rect drag test
(`'dragging the rotate handle commits a rotation keyframe (autoKey on)'`):

```ts
it('dragging the rotate handle on an imported-svg object commits a rotation keyframe', () => {
  stubIdentityCTM(); // client coords == object-local coords; pivot maps to the anchor
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject(); // autoKey defaults on
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor = (50,50) absolute
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const handle = screen.getByTestId('rotate-handle');
  // Pivot = anchor (50,50). Start above the pivot (50,0) -> -90deg; drag right (100,50) -> 0deg => +90.
  fireEvent.pointerDown(handle, { clientX: 50, clientY: 0, button: 0 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: 50 });
  fireEvent.pointerUp(window, { clientX: 100, clientY: 50 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.rotation?.[0].value).toBeCloseTo(90);
});
```

> `stubIdentityCTM` and `fireEvent` are already imported/defined in this file (used by the rect rotate + gradient drag tests). The `addObject('a')` call auto-selects the new object (the store's `addObject` sets `selectedObjectId`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "imported-svg"`
Expected: FAIL — the flipped test fails (no handle rendered yet) and the new drag test fails (`tracks.rotation` undefined).

- [ ] **Step 3: Make `selectedRotatable` accept imported-SVG**

In `src/ui/components/Stage/Stage.tsx`, REPLACE the `selectedRotatable` memo body. It currently is:

```ts
  const selectedRotatable = useMemo(() => {
    if (activeTool !== 'select' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || obj.locked || !asset || asset.kind !== 'vector') return null;
    const state = sampleObject(obj, time);
    const sampledPath =
      asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
    const bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
    const pathBox = sampledPath ? pathBounds(sampledPath) : undefined;
    const anchor = resolveAnchor(obj, state, asset.shapeType, pathBox);
    const transform = buildTransform(state, anchor.anchorX, anchor.anchorY);
    return { obj, state, bbox, anchorX: anchor.anchorX, anchorY: anchor.anchorY, transform };
  }, [activeTool, selectedId, project.objects, assetsById, time]);
```

Replace it with:

```ts
  const selectedRotatable = useMemo(() => {
    if (activeTool !== 'select' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || obj.locked || !asset) return null;
    const state = sampleObject(obj, time);
    let bbox: LocalRect;
    let anchorX: number;
    let anchorY: number;
    if (asset.kind === 'vector') {
      const sampledPath =
        asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
      bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
      const pathBox = sampledPath ? pathBounds(sampledPath) : undefined;
      const anchor = resolveAnchor(obj, state, asset.shapeType, pathBox);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else if (asset.kind === 'svg') {
      // An imported-SVG object's local box is its intrinsic size; its anchor is absolute
      // (addObject seeds anchorX/Y = width/2,height/2 with no 'fraction' anchorMode), so
      // resolveAnchor returns (obj.anchorX, obj.anchorY) directly — shapeType is irrelevant.
      bbox = { x: 0, y: 0, width: asset.width, height: asset.height };
      const anchor = resolveAnchor(obj, state, undefined);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else {
      return null; // audio etc. — no rotate handle
    }
    const transform = buildTransform(state, anchorX, anchorY);
    return { obj, state, bbox, anchorX, anchorY, transform };
  }, [activeTool, selectedId, project.objects, assetsById, time]);
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (the flipped svg test, the new svg drag test, the existing rect/path rotate tests, and all other Stage tests).

- [ ] **Step 5: Typecheck/lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice22): rotate handle for imported-svg objects (selectedRotatable branches by kind)"
```

---

### Task 2: End-to-end — rotate an imported SVG

**Files:**
- Create: `e2e/svg-rotate.spec.ts`

**Interfaces:**
- Consumes: the whole feature (Task 1).

- [ ] **Step 1: Write the e2e**

Create `e2e/svg-rotate.spec.ts` (mirrors `rotate-handle.spec.ts`, importing the existing
`e2e/fixtures/box.svg` fixture and instancing it instead of drawing a rect):

```ts
import { test, expect } from '@playwright/test';

test('drag the rotate handle rotates an imported-svg object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Import the fixture SVG and instance it (auto-selected).
  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg' }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  const obj = page.locator('[data-savig-object]').first();
  const before = await obj.getAttribute('transform');

  // Drag the rotate handle in an arc around the object.
  const handle = page.getByTestId('rotate-handle');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 80, hb.y + 80); // sweep to the side
  await page.mouse.up();

  const after = await obj.getAttribute('transform');
  expect(after).not.toBe(before);
  expect(after).toMatch(/rotate\(/);
  expect(after).not.toMatch(/rotate\(0,/); // a non-zero angle
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/svg-rotate.spec.ts`
Expected: PASS.

> If `box.svg` instances at a size whose rotate handle sits off-screen or the auto-key
> is off (so the drag no-ops), verify auto-key is on by default (it is) and that the
> handle has a bounding box; the import→instance→select sequence mirrors the working
> `export.spec.ts` (import + click `box.svg`) and `rotate-handle.spec.ts` (handle drag).

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/svg-rotate.spec.ts
git commit -m "test(e2e): rotate handle rotates an imported-svg object"
```

---

## Self-Review (plan vs spec)

- **§2 `selectedRotatable` branches by kind (svg → bbox (0,0,w,h), absolute anchor; audio → null)** → Task 1 Step 3. ✅
- **§2 only `selectedRotatable` changes (resize/gradient still exclude svg)** → no other memo touched; the flipped test asserts only the rotate handle. ✅
- **§3 everything downstream unchanged (works by construction)** → Task 1 changes only the memo; the drag-commit test proves the handlers + commit work for svg. ✅
- **§4 editor-only (no engine/render/runtime/export/migration)** → only `Stage.tsx` + tests + one e2e. ✅
- **§6 testing (flip the svg test; add svg drag-commit; e2e)** → Task 1 (2 unit) + Task 2 (e2e). ✅
- **§9 verification (SvgAsset width/height; resolveAnchor absolute for svg)** → confirmed pre-plan (SvgAsset has width/height at types.ts; `addObject` already uses `asset.width/2`); the drag test pins `tracks.rotation ≈ 90`, which only holds if the anchor resolves to (50,50). ✅
- **Type/name consistency:** `LocalRect` (already imported in Stage); the memo's return shape `{ obj, state, bbox, anchorX, anchorY, transform }` is byte-identical to the original (consumers unchanged); testids `rotate-handle`/`rotate-handle-overlay` match the existing overlay. ✅
- **Placeholder scan:** every step has concrete code; the e2e fallback note references the proven `export.spec.ts`/`rotate-handle.spec.ts` patterns. ✅
