# Color Animation — Plan B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author animated fill/stroke colors — auto-key on color change, see the resolved color at the playhead, select color keyframes on a timeline lane, edit their easing, and delete them.

**Architecture:** A `setVectorColor` store action auto-keys a `ColorKeyframe` (or edits the static style when autoKey is off). The Inspector color inputs route through it and display the sampled color. A timeline color-keyframe lane + `selectedColorKeyframe` selection feed the Inspector's Keyframe section (easing) and the context-aware Delete.

**Tech Stack:** React 18 + TS (strict), Zustand, Vitest + RTL + `@testing-library/user-event`, Playwright.

**Prerequisite:** Plan A (engine) merged — `colorTracks` field, `sampleColor`, `sampleObject` fill/stroke, `FrameItem` fill/stroke.

## Global Constraints

- **One undo step per gesture** (auto-key a color, edit easing, delete a keyframe).
- **autoKey on** → color edits write a `ColorKeyframe`; **autoKey off** → edit the static `VectorStyle` (today's behavior).
- **Color inputs show the resolved color** at the playhead (`sampleObject` fill/stroke when a track exists, else the static style).
- **Vector objects only** (the style controls already render only for vectors).
- **No new color interpolation logic in the UI** — reuse Plan A's engine.
- Tests: `pnpm vitest run <path>`; typecheck `pnpm typecheck`; lint `pnpm lint`; e2e `pnpm exec playwright test <spec>`.

---

## File Structure

- `src/engine/keyframes.ts` — `upsertColorKeyframe`, `removeColorKeyframeAt` (MODIFY).
- `src/ui/store/store.ts` — `setVectorColor`; `selectedColorKeyframe` + `selectColorKeyframe`; color routing in `setSelectedKeyframeEasing`; `removeSelectedColorKeyframe` (MODIFY).
- `src/ui/store/store.test.ts` — store tests (MODIFY).
- `src/ui/components/Inspector/Inspector.tsx` — color inputs route through `setVectorColor`, show sampled color; Keyframe section shows a color keyframe's easing; Delete (MODIFY).
- `src/ui/components/Inspector/Inspector.test.tsx` — RTL (MODIFY).
- `src/ui/components/Timeline/Timeline.tsx` — color-keyframe lane (MODIFY).
- `src/ui/components/Timeline/Timeline.test.tsx` — RTL (MODIFY).
- `e2e/color-animation.spec.ts` — e2e (CREATE).

---

## Task B1: `setVectorColor` (auto-key) + Inspector color inputs

**Files:**
- Modify: `src/engine/keyframes.ts` (`upsertColorKeyframe`, `removeColorKeyframeAt`)
- Modify: `src/ui/store/store.ts` (`setVectorColor`)
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/store/store.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Produces: `upsertColorKeyframe(track: ColorKeyframe[], keyframe: ColorKeyframe): ColorKeyframe[]`
- Produces: `removeColorKeyframeAt(track: ColorKeyframe[], time: number): ColorKeyframe[]`
- Produces: `setVectorColor(property: ColorProperty, value: string): void`

- [ ] **Step 1: Write the failing store test**

Add to `src/ui/store/store.test.ts`:

```ts
describe('setVectorColor', () => {
  function seedRect() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 }); // draws + selects a rect object (autoKey defaults true)
  }
  it('autoKey ON: writes a color keyframe at the playhead (one undo step)', () => {
    seedRect();
    useEditor.getState().seek(1);
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setVectorColor('fill', '#ff0000');
    const obj = useEditor.getState().history.present.objects[0];
    expect(obj.colorTracks?.fill).toEqual([{ time: 1, value: '#ff0000', easing: 'linear' }]);
    expect(useEditor.getState().history.past.length).toBe(before + 1);
  });
  it('autoKey OFF: edits the static asset style, no color track', () => {
    seedRect();
    useEditor.getState().toggleAutoKey(); // -> off
    useEditor.getState().setVectorColor('fill', '#00ff00');
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    const asset = proj.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind === 'vector' && asset.style.fill).toBe('#00ff00');
    expect(obj.colorTracks?.fill).toBeUndefined();
  });
});
```

(If `addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 })` needs args/position, mirror the existing rect-creation test in this file; the point is a selected vector object with `autoKey` true.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `setVectorColor` not a function.

- [ ] **Step 3: Add the keyframe helpers**

In `src/engine/keyframes.ts`, after `removeShapeKeyframeAt` (reuse the file's existing `EPSILON`):

```ts
export function upsertColorKeyframe(track: ColorKeyframe[], keyframe: ColorKeyframe): ColorKeyframe[] {
  return [
    ...track.filter((k) => Math.abs(k.time - keyframe.time) > EPSILON),
    keyframe,
  ].sort((a, b) => a.time - b.time);
}

export function removeColorKeyframeAt(track: ColorKeyframe[], time: number): ColorKeyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > EPSILON);
}
```

Add `ColorKeyframe` to the file's `import type { … } from './types';` line.

- [ ] **Step 4: Add the store action**

In `src/ui/store/store.ts`: add `ColorProperty` to the engine type import and `upsertColorKeyframe` to the keyframes import. Add the interface line (near `setVectorStyle`):

```ts
  setVectorColor(property: ColorProperty, value: string): void;
```

Implementation (near `setVectorStyle`):

```ts
  setVectorColor(property, value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    if (!s.autoKey) {
      get().setVectorStyle({ [property]: value });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const next = upsertColorKeyframe(obj.colorTracks?.[property] ?? [], { time, value, easing: 'linear' });
    const colorTracks = { ...obj.colorTracks, [property]: next };
    get().commit(replaceObject(project, { ...obj, colorTracks }));
  },
```

- [ ] **Step 5: Route the Inspector color inputs**

In `src/ui/components/Inspector/Inspector.tsx`: destructure `setVectorColor` from the store; the `sampled` value (`sampleObject(obj, time)`) is already computed. Change the fill color `<input type="color">` (keep the enable checkbox on `setVectorStyle`):

```tsx
            <input
              id="insp-fill"
              aria-label="fill"
              type="color"
              disabled={vector.style.fill === 'none'}
              value={(sampled.fill ?? vector.style.fill) === 'none' ? '#cccccc' : (sampled.fill ?? vector.style.fill)}
              onChange={(e) => setVectorColor('fill', e.target.value)}
            />
```

Do the same for the stroke color input (`sampled.stroke ?? vector.style.stroke`, fallback `'#000000'`, `setVectorColor('stroke', …)`).

- [ ] **Step 6: Write the failing Inspector test**

Add to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
import { fireEvent } from '@testing-library/react';

it('changing the fill color with autoKey on writes a color keyframe', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  s.seek(1);
  render(<Inspector />);
  fireEvent.change(screen.getByLabelText('fill'), { target: { value: '#ff0000' } });
  expect(useEditor.getState().history.present.objects[0].colorTracks?.fill).toEqual([
    { time: 1, value: '#ff0000', easing: 'linear' },
  ]);
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/engine/keyframes.ts src/ui/store/store.ts src/ui/components/Inspector/Inspector.tsx src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(color): setVectorColor auto-keys fill/stroke; Inspector inputs show sampled color"
```

---

## Task B2: `selectedColorKeyframe` + timeline color lane

**Files:**
- Modify: `src/ui/store/store.ts` (`selectedColorKeyframe`, `selectColorKeyframe`)
- Modify: `src/ui/components/Timeline/Timeline.tsx`
- Test: `src/ui/store/store.test.ts`, `src/ui/components/Timeline/Timeline.test.tsx`

**Interfaces:**
- Produces: `selectedColorKeyframe: { objectId: string; property: ColorProperty; time: number } | null`
- Produces: `selectColorKeyframe(ref: { objectId: string; property: ColorProperty; time: number } | null): void`

- [ ] **Step 1: Write the failing store test**

Add to `src/ui/store/store.test.ts`:

```ts
it('selectColorKeyframe sets the selection and clears node/shape/scalar selections', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 0 });
  const st = useEditor.getState();
  expect(st.selectedColorKeyframe).toEqual({ objectId: id, property: 'fill', time: 0 });
  expect(st.selectedKeyframe).toBeNull();
  expect(st.selectedShapeKeyframe).toBeNull();
  expect(st.selectedNodeIndex).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `selectColorKeyframe` not a function.

- [ ] **Step 3: Add the selection state + action**

In `src/ui/store/store.ts`: add the interface field + action and the initial state, and clear `selectedColorKeyframe` wherever other keyframe selections are cleared (`selectObject`, `selectKeyframe`, `selectShapeKeyframe` — set it to `null` alongside the existing clears). Add:

```ts
  // interface
  selectedColorKeyframe: { objectId: string; property: ColorProperty; time: number } | null;
  selectColorKeyframe(ref: { objectId: string; property: ColorProperty; time: number } | null): void;
```

```ts
  // initial state
  selectedColorKeyframe: null as { objectId: string; property: ColorProperty; time: number } | null,
```

```ts
  // action
  selectColorKeyframe(ref) {
    set({
      selectedColorKeyframe: ref,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId } : {}),
    });
  },
```

In `selectKeyframe` / `selectShapeKeyframe` / `selectObject`, add `selectedColorKeyframe: null` to their `set({ … })` so selecting one kind clears a color selection.

- [ ] **Step 4: Write the failing Timeline test**

Add to `src/ui/components/Timeline/Timeline.test.tsx` (mirror its existing shape-keyframe-lane test setup):

```ts
it('renders a color-keyframe diamond and selects it on click', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  s.seek(1);
  s.setVectorColor('fill', '#ff0000'); // creates colorTracks.fill @ t=1
  const id = useEditor.getState().selectedObjectId!;
  render(<Timeline />);
  const diamond = screen.getByTestId(`color-keyframe-${id}-fill-1`);
  fireEvent.click(diamond);
  expect(useEditor.getState().selectedColorKeyframe).toEqual({ objectId: id, property: 'fill', time: 1 });
});
```

- [ ] **Step 5: Render the color lane**

In `src/ui/components/Timeline/Timeline.tsx`: destructure `selectColorKeyframe` and read `selectedColorKeyframe`. After the `shapeTrack` diamonds block (inside the per-object lane), add a block that iterates `obj.colorTracks` entries and renders a diamond per keyframe:

```tsx
                {(['fill', 'stroke'] as const).flatMap((property) =>
                  (obj.colorTracks?.[property] ?? []).map((kf) => {
                    const isSel =
                      selectedColorKeyframe?.objectId === obj.id &&
                      selectedColorKeyframe?.property === property &&
                      selectedColorKeyframe?.time === kf.time;
                    return (
                      <div
                        key={`${property}-${kf.time}`}
                        className={`${styles.diamond} ${isSel ? styles.diamondSelected : ''}`}
                        data-testid={`color-keyframe-${obj.id}-${property}-${kf.time}`}
                        style={{ left: `${timeToX(kf.time)}px` }}
                        onClick={() => selectColorKeyframe({ objectId: obj.id, property, time: kf.time })}
                      />
                    );
                  }),
                )}
```

(Use the same `timeToX` / `styles.diamond` the shape-keyframe lane uses; check the exact local names in this file and match them.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts src/ui/components/Timeline/Timeline.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/components/Timeline/Timeline.tsx src/ui/store/store.test.ts src/ui/components/Timeline/Timeline.test.tsx
git commit -m "feat(color): selectedColorKeyframe + timeline color-keyframe lane"
```

---

## Task B3: Color-keyframe easing + context-aware Delete

**Files:**
- Modify: `src/ui/store/store.ts` (`setSelectedKeyframeEasing` color routing; `removeSelectedColorKeyframe`)
- Modify: `src/ui/components/Inspector/Inspector.tsx` (Keyframe section shows the color keyframe's easing; Delete)
- Test: `src/ui/store/store.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `selectedColorKeyframe` (B2), `removeColorKeyframeAt` (B1), `setSelectedKeyframeEasing` (exists).
- Produces: `removeSelectedColorKeyframe(): void`

- [ ] **Step 1: Write the failing store tests**

Add to `src/ui/store/store.test.ts`:

```ts
describe('color keyframe easing + delete', () => {
  function seedColorKf() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    s.seek(1);
    s.setVectorColor('fill', '#ff0000');
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 1 });
    return id;
  }
  it('setSelectedKeyframeEasing routes to the selected color keyframe', () => {
    seedColorKf();
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(useEditor.getState().history.present.objects[0].colorTracks!.fill![0].easing).toBe('easeIn');
  });
  it('removeSelectedColorKeyframe deletes it and clears the selection', () => {
    seedColorKf();
    useEditor.getState().removeSelectedColorKeyframe();
    expect(useEditor.getState().history.present.objects[0].colorTracks?.fill ?? []).toHaveLength(0);
    expect(useEditor.getState().selectedColorKeyframe).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — easing not routed; `removeSelectedColorKeyframe` missing.

- [ ] **Step 3: Route easing + add delete**

In `setSelectedKeyframeEasing` (`store.ts`), add a color branch **first** (before the shape/scalar branches), mirroring their shape:

```ts
    if (s.selectedColorKeyframe) {
      const ref = s.selectedColorKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      const track = obj?.colorTracks?.[ref.property];
      if (!obj || !track) return;
      const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k));
      get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [ref.property]: next } }));
      return;
    }
```

Add the action + interface line (`removeSelectedColorKeyframe(): void;`):

```ts
  removeSelectedColorKeyframe() {
    const s = get();
    const ref = s.selectedColorKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    const track = obj?.colorTracks?.[ref.property];
    if (!obj || !track) return;
    const next = removeColorKeyframeAt(track, ref.time);
    get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [ref.property]: next } }));
    set({ selectedColorKeyframe: null });
  },
```

Add `removeColorKeyframeAt` to the keyframes import.

- [ ] **Step 4: Wire the Inspector Keyframe section + Delete**

In `src/ui/components/Inspector/Inspector.tsx`: in the `kf*` resolution, add a branch so a selected color keyframe drives `kfEasing` (its easing) and `kfHeader` (`${property} @ {t}s`). Place it as the first branch (before the shape/scalar branches):

```ts
  const selectedColorKeyframe = useEditor((s) => s.selectedColorKeyframe);
  // … inside the resolution chain, first:
  if (selectedColorKeyframe && selectedColorKeyframe.objectId === obj.id) {
    const track = obj.colorTracks?.[selectedColorKeyframe.property];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedColorKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `${selectedColorKeyframe.property} @ ${round(track[idx].time)}s`;
      kfInert = idx === track.length - 1;
    }
  } else if (selectedShapeKeyframe && …) { /* existing */ }
```

For Delete: the Inspector's context-aware Delete (or a Delete button in the Keyframe section) calls `removeSelectedColorKeyframe()` when a color keyframe is selected. Wire it into the existing Delete priority chain (color kf → node → shape kf → scalar kf), matching how the existing Delete dispatches.

- [ ] **Step 5: Write the failing Inspector RTL test**

Add to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('shows the selected color keyframe easing and edits it', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  s.seek(1);
  s.setVectorColor('fill', '#ff0000');
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 1 });
  render(<Inspector />);
  expect(screen.getByText(/fill @ 1s/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'easeIn' }));
  expect(useEditor.getState().history.present.objects[0].colorTracks!.fill![0].easing).toBe('easeIn');
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/components/Inspector/Inspector.tsx src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(color): color-keyframe easing routing + context-aware delete"
```

---

## Task B4: e2e — animate fill and export

**Files:**
- Create: `e2e/color-animation.spec.ts`

- [ ] **Step 1: Write the failing e2e**

Create `e2e/color-animation.spec.ts`, modeled on `e2e/draw-vector.spec.ts` (copy its app-boot, draw-rect, and export-bundle helpers verbatim; only the color steps below are new):

```ts
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('keyframe fill color -> export -> bundle animates the fill', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (reuse the draw-vector spec's tool + drag steps).
  await page.getByRole('button', { name: 'Rect', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 140);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Keyframe fill at t=0 (#ff0000) and a later time (#0000ff).
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByLabelText('fill').fill('#ff0000');
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await page.getByLabelText('fill').fill('#0000ff');

  // Export and read the bundle.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
  const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  for (const [p, data] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const shape = exported.locator('[data-savig-object] rect').first();
  await expect(shape).toHaveCount(1);
  const f0 = await shape.getAttribute('fill');
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    if ((await shape.getAttribute('fill')) !== f0) changed = true;
  }
  expect(changed).toBe(true); // the exported fill animates
});
```

(If the rect tool button label or the `fill` input interaction differs, mirror `e2e/draw-vector.spec.ts` exactly; the assertion that matters is the exported `rect`'s `fill` attribute changes over playback.)

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/color-animation.spec.ts`
Expected: PASS (real chromium).

- [ ] **Step 3: Final full gate**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build && pnpm exec playwright test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/color-animation.spec.ts
git commit -m "test(e2e): keyframe fill color, export bundle animates the fill"
```

---

## Plan B — Self-review checklist

- One undo step per gesture? ✓ each store action = one `commit`; B1 asserts.
- autoKey on/off split correct? ✓ B1 both branches.
- Color inputs show the sampled color? ✓ B1 (Step 5).
- Selection clears other selections? ✓ B2.
- Easing routes to the color track + Delete removes it? ✓ B3.
- e2e proves preview==export for animated color? ✓ B4.
- Engine touched only for pure helpers (keyframes CRUD)? ✓.
