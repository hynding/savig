# Arc-Length Morph — Plan B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user turn on arc-length cross-shape morphing per shape keyframe via a morph-mode toggle in the Inspector "Keyframe" section, backed by a store action, and prove it end-to-end with a Playwright export test.

**Architecture:** Pure UI on top of Plan A's engine. One store action `setSelectedShapeKeyframeMorph(mode)` (mirrors `setSelectedKeyframeEasing`) writes the optional `morph` field on the selected shape keyframe; the Inspector Keyframe section (built in the easing-UI feature) gains a `Grow / Resample` select shown only for shape keyframes. No engine change.

**Tech Stack:** React 18 + TS (strict) · Zustand · Vitest + RTL · Playwright · CSS Modules.

## Global Constraints

- Pure UI — no `src/engine/` or `src/services/` change; engine already supports `morph`.
- One undo step per user gesture (single `commit`).
- Keyframe time matching uses `KF_EPS` (1e-6), the existing module const in store.ts and Inspector.tsx.
- `morph` mode lives on the from-keyframe; values are the canonical `'corresponded' | 'resampled'` (`MorphMode` from the engine barrel). The UI may show friendlier labels (`Grow` / `Resample`).
- The toggle is shown only when a **shape** keyframe is selected (not for scalar keyframes).
- Strict TS: no `any`; the select's `onChange` casts `e.target.value as MorphMode`.

---

### Task 1: `setSelectedShapeKeyframeMorph` store action

**Files:**
- Modify: `src/ui/store/store.ts` (import `MorphMode`; add to `EditorState` after `setSelectedKeyframeRotationMode` at store.ts:113; add the action after `setSelectedKeyframeRotationMode`'s body, before `addAudioClip`)
- Test: `src/ui/store/store.test.ts` (append to the `keyframe easing editing` describe block)

**Interfaces:**
- Consumes: `replaceObject` (store.ts:145), `KF_EPS` (module const), `MorphMode` from `../../engine`, `selectedShapeKeyframe`.
- Produces: `setSelectedShapeKeyframeMorph(mode: MorphMode): void` — writes `morph` on the selected shape keyframe; no-op when no shape keyframe is selected; one undo step.

- [ ] **Step 1: Write the failing test**

```ts
// append inside describe('keyframe easing editing', ...) in src/ui/store/store.test.ts
it('setSelectedShapeKeyframeMorph writes morph on the selected shape keyframe (one undo)', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  useEditor.getState().addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  const t = selectSelectedObject(useEditor.getState())!.shapeTrack![0].time;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: t });
  const before = useEditor.getState().history.past.length;
  useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
  expect(selectSelectedObject(useEditor.getState())!.shapeTrack![0].morph).toBe('resampled');
  expect(useEditor.getState().history.past.length).toBe(before + 1);
  useEditor.getState().undo();
  expect(selectSelectedObject(useEditor.getState())!.shapeTrack![0].morph).toBeUndefined();
});

it('setSelectedShapeKeyframeMorph is a no-op when no shape keyframe is selected', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  const before = useEditor.getState().history.past.length;
  useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
  expect(useEditor.getState().history.past.length).toBe(before);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "setSelectedShapeKeyframeMorph"`
Expected: FAIL — `setSelectedShapeKeyframeMorph is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/store/store.ts`, add `MorphMode` to the `from '../../engine'` type import block (alongside `Easing`, `RotationMode`).

Add to the `EditorState` interface after `setSelectedKeyframeRotationMode(mode: RotationMode): void;`:
```ts
  setSelectedShapeKeyframeMorph(mode: MorphMode): void;
```

Add the action immediately after the `setSelectedKeyframeRotationMode` body (before `addAudioClip`):
```ts
  setSelectedShapeKeyframeMorph(mode) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, morph: mode } : k,
    );
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "setSelectedShapeKeyframeMorph"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(store): setSelectedShapeKeyframeMorph (per-keyframe morph mode)"
```

---

### Task 2: Inspector morph-mode toggle

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx` (import `MorphMode`; destructure the action; resolve `kfMorph`; render the toggle in the Keyframe section)
- Test: `src/ui/components/Inspector/Inspector.test.tsx` (append to the `keyframe easing section` describe block)

**Interfaces:**
- Consumes: `setSelectedShapeKeyframeMorph` (Task 1); `MorphMode` from `../../../engine`; the existing `kfEasing`/`selectedShapeKeyframe` resolution.
- Produces: a `morph mode` select (`aria-label="morph mode"`, options `Grow`=corresponded / `Resample`=resampled) shown when a shape keyframe is selected.

- [ ] **Step 1: Write the failing test**

```tsx
// append inside describe('keyframe easing section', ...) in src/ui/components/Inspector/Inspector.test.tsx
it('shows the morph toggle for a shape keyframe and sets the mode', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  useEditor.getState().addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  const t = useEditor.getState().history.present.objects[0].shapeTrack![0].time;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: t });
  render(<Inspector />);
  const sel = screen.getByLabelText('morph mode');
  expect(sel).toBeInTheDocument();
  await userEvent.selectOptions(sel, 'resampled');
  expect(useEditor.getState().history.present.objects[0].shapeTrack![0].morph).toBe('resampled');
});

it('does not show the morph toggle for a scalar keyframe', () => {
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
  useEditor.getState().seek(0);
  useEditor.getState().setProperty('x', 10);
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
  render(<Inspector />);
  expect(screen.queryByLabelText('morph mode')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx -t "morph toggle"`
Expected: FAIL — `morph mode` control not found.

- [ ] **Step 3: Write minimal implementation**

In `Inspector.tsx`:

Add `MorphMode` to the engine type import:
```tsx
import type { Easing, MorphMode, RotationMode } from '../../../engine';
```

Add `setSelectedShapeKeyframeMorph` to the destructured `useEditor.getState()` actions (next to `setSelectedKeyframeRotationMode`).

In the keyframe-resolution block, add a `kfMorph` accumulator. Declare it with the other `kf*` locals:
```tsx
  let kfMorph: MorphMode | null = null;
```
and inside the shape-keyframe branch (`if (selectedShapeKeyframe && ... && obj.shapeTrack)`, where `idx >= 0`), after `kfInert = idx === track.length - 1;`, add:
```tsx
      kfMorph = track[idx].morph ?? 'corresponded';
```

Render the toggle inside the `{kfEasing !== null && ( ... )}` block, right after the closing `)}` of the `kfIsRotation` block:
```tsx
          {kfMorph !== null && (
            <div className={styles.row}>
              <label htmlFor="insp-morph">morph</label>
              <select
                id="insp-morph"
                aria-label="morph mode"
                value={kfMorph}
                onChange={(e) => setSelectedShapeKeyframeMorph(e.target.value as MorphMode)}
              >
                <option value="corresponded">Grow</option>
                <option value="resampled">Resample</option>
              </select>
            </div>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS (new + existing cases).

- [ ] **Step 5: Full unit suite + typecheck**

Run: `pnpm vitest run && pnpm typecheck`
Expected: all green; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(inspector): per-keyframe morph-mode toggle (Grow/Resample)"
```

---

### Task 3: E2E — resampled morph exports and animates

**Files:**
- Create: `e2e/morph-resampled.spec.ts`

**Interfaces:**
- Consumes: the running app at `/`; the shape-keyframe diamond testid `shape-keyframe-{objId}-{time}`; the `morph mode` select (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// e2e/morph-resampled.spec.ts
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('toggle resampled morph -> export -> exported path animates with a dense point set', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Author a path (pen) and create two shape keyframes (same flow as the morph e2e).
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 180, box.y + 120);
  await page.mouse.dblclick(box.x + 240, box.y + 80);
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  await page.getByRole('button', { name: /add shape keyframe/i }).click();
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  const node = page.getByTestId('node-1');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 60, nb.y + 60);
  await page.mouse.up();
  await expect(page.getByText(/morph: 2 keyframe/i)).toBeVisible();

  // Select the FIRST shape keyframe (the from-keyframe at t=0) and set it to Resample.
  await page.locator('[data-testid^="shape-keyframe-"]').first().click();
  await page.getByLabel('morph mode').selectOption('resampled');

  // Export and capture the bundle.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const zipBytes = new Uint8Array(Buffer.concat(chunks));

  const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
  const files = unzipSync(zipBytes);
  for (const [path, data] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  expect(Object.keys(files)).toContain('index.html');

  // Open the bundle; sample the inner <path> `d` across playback. A resampled morph
  // renders a dense ~64-point polygon mid-morph (many `L` commands), unlike index-pad.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const pathLoc = exported.locator('[data-savig-object] path').first();
  await expect(pathLoc).toHaveCount(1);
  const d0 = await pathLoc.getAttribute('d');
  let maxL = 0;
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    const d = (await pathLoc.getAttribute('d')) ?? '';
    maxL = Math.max(maxL, (d.match(/L/g) ?? []).length);
    if (d !== d0) changed = true;
  }
  expect(changed).toBe(true); // the morph animates
  expect(maxL).toBeGreaterThanOrEqual(40); // dense resampled point set, not index-pad
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm playwright test e2e/morph-resampled.spec.ts`
Expected: PASS with Tasks 1-2 merged. If `node-1` is not draggable or the diamond testid differs, confirm the selectors against `e2e/morph-path.spec.ts` (this test mirrors its setup) and the Timeline shape-diamond testid `shape-keyframe-{objId}-{time}`. If `maxL` is low, the morph is still index-pad — verify the `morph mode` select actually committed `resampled` (the select's value must be `resampled` after `selectOption`).

- [ ] **Step 3: Run the full e2e suite (no regressions)**

Run: `pnpm playwright test`
Expected: all specs PASS (the corresponded morph-path e2e is unaffected).

- [ ] **Step 4: Commit**

```bash
git add e2e/morph-resampled.spec.ts
git commit -m "test(e2e): toggle resampled morph -> export animates with dense point set"
```

---

## Self-Review

**Spec coverage (design §5 UI / Plan B):**
- §5.1 Inspector morph-mode toggle in the Keyframe section, shown for shape keyframes, friendly labels → Task 2. ✓
- §5.2 `setSelectedShapeKeyframeMorph` store action (selected shape keyframe, one undo, no-op otherwise) → Task 1. ✓
- §5.3 no Stage change (renders through existing path branch) → nothing to do; e2e exercises the real render/export. ✓
- §9 e2e (circle/shape → set resampled → export → animates without grow-from-point collapse) → Task 3 (asserts animation + dense ~64-point set, the resampled signature). ✓
- Deferred per spec §Scope/§11 (selectEditablePath refinement, animate-from-current) → intentionally NOT in this plan. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. Task 3 Step 2's conditional guidance names the exact fallback checks (selector parity with morph-path.spec.ts; verify `selectOption` committed), not a vague "fix if broken."

**Type consistency:** `setSelectedShapeKeyframeMorph(mode: MorphMode)` is declared in Task 1's interface block and consumed by Task 2's Inspector with the same name/type; `MorphMode` comes from the engine barrel in both. The select stores canonical `corresponded`/`resampled` values (matching the engine field) while displaying `Grow`/`Resample`. `kfMorph` is resolved only in the shape-keyframe branch, so the toggle is hidden for scalar keyframes (Task 2 negative test).
