# Slice 9 Animated Gradients — Plan B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author animated gradients in the editor — auto-key gradient edits at the playhead, select/delete/ease gradient keyframes, see them on the Timeline and previewed on the Stage — proven end-to-end through export.

**Architecture:** Mirror the Slice-4 color-animation UI. The store's `setVectorGradient` becomes auto-key-aware (upsert a `GradientKeyframe` at the playhead when autoKey is on; static otherwise; clearing removes both static + track). A `selectedGradientKeyframe` ref + Timeline lane + Inspector keyframe section + Stage sampled-gradient render complete the loop. Depends on Plan A (engine resolves `sampleObject(...).fillGradient/strokeGradient` and the runtime mutates the def per frame).

**Tech Stack:** React 18 + TS strict, Zustand store, CSS Modules + design tokens, Vitest + RTL (unit), Playwright (e2e, real chromium).

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Plan A is a prerequisite: `sampleObject` populates `fillGradient`/`strokeGradient`; `FrameItem`/`applyFrameToNodes` animate the def. Do Plan A first.
- Paint precedence: a gradient (static OR animated) beats solid color for the same property.
- The shape stays the wrapper `<g>`'s `firstElementChild`; gradient `<GradientEl>` is rendered as a sibling AFTER the shape (unchanged Slice-8 invariant).
- No persistence version bump (project stays v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm test:e2e` (the e2e command is whatever the repo uses — check `package.json` scripts, e.g. `playwright test`).

---

### Task 1: Pure keyframe helpers — `upsertGradientKeyframe` / `removeGradientKeyframeAt`

**Files:**
- Modify: `src/engine/keyframes.ts`
- Test: `src/engine/keyframes.test.ts`

**Interfaces:**
- Consumes: `GradientKeyframe` (Plan A Task 1).
- Produces: `upsertGradientKeyframe(track: GradientKeyframe[], kf: GradientKeyframe): GradientKeyframe[]` (replaces at the same time within EPSILON, keeps sorted) and `removeGradientKeyframeAt(track: GradientKeyframe[], time: number): GradientKeyframe[]`.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/keyframes.test.ts`:

```ts
import { upsertGradientKeyframe, removeGradientKeyframeAt } from './keyframes';
import type { Gradient, GradientKeyframe } from './types';

const g = (x2: number): Gradient => ({ type: 'linear', x1: 0, y1: 0, x2, y2: 0, stops: [{ offset: 0, color: '#000000' }] });

describe('upsertGradientKeyframe', () => {
  it('inserts sorted by time', () => {
    const t: GradientKeyframe[] = [{ time: 2, gradient: g(1), easing: 'linear' }];
    const out = upsertGradientKeyframe(t, { time: 0, gradient: g(0), easing: 'linear' });
    expect(out.map((k) => k.time)).toEqual([0, 2]);
  });
  it('replaces a keyframe at the same time', () => {
    const t: GradientKeyframe[] = [{ time: 1, gradient: g(0), easing: 'linear' }];
    const out = upsertGradientKeyframe(t, { time: 1, gradient: g(0.5), easing: 'easeIn' });
    expect(out).toHaveLength(1);
    expect((out[0].gradient as Extract<Gradient, { type: 'linear' }>).x2).toBe(0.5);
    expect(out[0].easing).toBe('easeIn');
  });
});

describe('removeGradientKeyframeAt', () => {
  it('drops the keyframe at the given time', () => {
    const t: GradientKeyframe[] = [{ time: 0, gradient: g(0), easing: 'linear' }, { time: 1, gradient: g(1), easing: 'linear' }];
    expect(removeGradientKeyframeAt(t, 0).map((k) => k.time)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/keyframes.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the helpers**

In `src/engine/keyframes.ts`, add `GradientKeyframe` to the type import, then append (mirroring `upsertColorKeyframe`/`removeColorKeyframeAt`):

```ts
export function upsertGradientKeyframe(
  track: GradientKeyframe[],
  keyframe: GradientKeyframe,
): GradientKeyframe[] {
  return [
    ...track.filter((k) => Math.abs(k.time - keyframe.time) > EPSILON),
    keyframe,
  ].sort((a, b) => a.time - b.time);
}

export function removeGradientKeyframeAt(track: GradientKeyframe[], time: number): GradientKeyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > EPSILON);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/engine/keyframes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/keyframes.ts src/engine/keyframes.test.ts
git commit -m "feat(slice9): upsert/removeGradientKeyframe pure helpers"
```

---

### Task 2: Store — gradient keyframe ref, select/remove, auto-key `setVectorGradient`, easing routing

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `upsertGradientKeyframe`/`removeGradientKeyframeAt` (Task 1), `GradientKeyframe`/`Gradient`/`ColorProperty` (engine).
- Produces: `GradientKeyframeRef { objectId; property: ColorProperty; time }`; state `selectedGradientKeyframe: GradientKeyframeRef | null`; actions `selectGradientKeyframe(ref)`, `removeSelectedGradientKeyframe()`; rewritten `setVectorGradient(property, gradient | undefined)`; `setSelectedKeyframeEasing` routes to the gradient track.

> **Spec refinement:** the spec said `setVectorGradient` would "select the new keyframe, as `setVectorColor` does" — but `setVectorColor` does NOT auto-select. Match the actual code: no auto-select on upsert.

- [ ] **Step 1: Write the failing store tests**

Append to `src/ui/store/store.test.ts` (follow the file's existing setup for adding a vector object + selecting it; the `setVectorColor` describe block at ~line 781 is the template):

```ts
describe('setVectorGradient (animated)', () => {
  const lin = (x2: number): Gradient => ({ type: 'linear', x1: 0, y1: 0, x2, y2: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] });

  it('autoKey on: upserts a gradient keyframe at the snapped playhead', () => {
    const id = addSelectedVectorRect(); // helper used by the color tests
    useEditor.setState({ autoKey: true, time: 1 });
    useEditor.getState().setVectorGradient('fill', lin(1));
    const obj = currentObject(id);
    expect(obj.gradientTracks?.fill).toHaveLength(1);
    expect(obj.gradientTracks!.fill![0].time).toBe(1);
  });

  it('autoKey off: writes the static asset gradient', () => {
    const id = addSelectedVectorRect();
    useEditor.setState({ autoKey: false });
    useEditor.getState().setVectorGradient('fill', lin(1));
    expect(currentAsset(id).style.fillGradient).toEqual(lin(1));
    expect(currentObject(id).gradientTracks?.fill).toBeUndefined();
  });

  it('undefined clears BOTH the static gradient and the track', () => {
    const id = addSelectedVectorRect();
    useEditor.setState({ autoKey: false });
    useEditor.getState().setVectorGradient('fill', lin(1));      // static
    useEditor.setState({ autoKey: true, time: 0 });
    useEditor.getState().setVectorGradient('fill', lin(0.5));    // track
    useEditor.getState().setVectorGradient('fill', undefined);   // solid
    expect(currentAsset(id).style.fillGradient).toBeUndefined();
    expect(currentObject(id).gradientTracks?.fill).toBeUndefined();
  });

  it('removeSelectedGradientKeyframe deletes the selected keyframe', () => {
    const id = addSelectedVectorRect();
    useEditor.setState({ autoKey: true, time: 0 });
    useEditor.getState().setVectorGradient('fill', lin(0));
    useEditor.setState({ time: 1 });
    useEditor.getState().setVectorGradient('fill', lin(1));
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().removeSelectedGradientKeyframe();
    expect(currentObject(id).gradientTracks?.fill?.map((k) => k.time)).toEqual([1]);
    expect(useEditor.getState().selectedGradientKeyframe).toBeNull();
  });

  it('setSelectedKeyframeEasing routes to the gradient track', () => {
    const id = addSelectedVectorRect();
    useEditor.setState({ autoKey: true, time: 0 });
    useEditor.getState().setVectorGradient('fill', lin(0));
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(currentObject(id).gradientTracks!.fill![0].easing).toBe('easeIn');
  });
});
```

> Reuse/define the test helpers `addSelectedVectorRect()`, `currentObject(id)`, `currentAsset(id)` consistent with the existing color-track tests (the color block already creates + selects a vector object — copy that exact setup). `Gradient` is imported from the engine.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "setVectorGradient (animated)"`
Expected: FAIL — `selectGradientKeyframe`/`removeSelectedGradientKeyframe` undefined; `setVectorGradient` ignores autoKey.

- [ ] **Step 3: Add the ref type + state + interface methods**

In `src/ui/store/store.ts`:

1. After the `ColorKeyframeRef` interface (ends ~line 69), add:

```ts
export interface GradientKeyframeRef {
  objectId: string;
  property: ColorProperty;
  time: number;
}
```

2. In `EditorState`, after `selectedColorKeyframe: ColorKeyframeRef | null;`:

```ts
  selectedGradientKeyframe: GradientKeyframeRef | null;
```

3. In the actions interface, after `removeSelectedColorKeyframe(): void;`:

```ts
  selectGradientKeyframe(ref: GradientKeyframeRef | null): void;
  removeSelectedGradientKeyframe(): void;
```

4. Add the imports: `upsertGradientKeyframe, removeGradientKeyframeAt` to the engine keyframes import group, and `GradientKeyframeRef` is local. Ensure `Gradient` is imported (it already is — `setVectorGradient` uses it).

- [ ] **Step 4: Initialize state + implement the three actions + rewrite `setVectorGradient`**

1. In the initial-state object, after `selectedColorKeyframe: null as ColorKeyframeRef | null,`:

```ts
  selectedGradientKeyframe: null as GradientKeyframeRef | null,
```

2. Replace the current `setVectorGradient` (lines ~560–563) with:

```ts
  setVectorGradient(property, gradient) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const styleKey = property === 'fill' ? 'fillGradient' : 'strokeGradient';

    if (gradient === undefined) {
      // Switch to solid paint: clear BOTH the static gradient and any animated track.
      const nextStyle = { ...asset.style, [styleKey]: undefined };
      const nextAssets = project.assets.map((a) =>
        a.id === asset.id ? { ...asset, style: nextStyle } : a,
      );
      const gradientTracks = { ...obj.gradientTracks };
      delete gradientTracks[property];
      const nextObj = {
        ...obj,
        gradientTracks: Object.keys(gradientTracks).length > 0 ? gradientTracks : undefined,
      };
      get().commit({
        ...project,
        assets: nextAssets,
        objects: project.objects.map((o) => (o.id === obj.id ? nextObj : o)),
      });
      set({ selectedGradientKeyframe: null });
      return;
    }

    if (!s.autoKey) {
      get().setVectorStyle({ [styleKey]: gradient });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const next = upsertGradientKeyframe(obj.gradientTracks?.[property] ?? [], { time, gradient, easing: 'linear' });
    const gradientTracks = { ...obj.gradientTracks, [property]: next };
    get().commit(replaceObject(project, { ...obj, gradientTracks }));
  },
```

3. Add the two new actions (place them right after `removeSelectedColorKeyframe`, ~line 408):

```ts
  selectGradientKeyframe(ref) {
    set({
      selectedGradientKeyframe: ref,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedColorKeyframe: null,
      selectedProgressKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId } : {}),
    });
  },
  removeSelectedGradientKeyframe() {
    const s = get();
    const ref = s.selectedGradientKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    const track = obj?.gradientTracks?.[ref.property];
    if (!obj || !track) return;
    const next = removeGradientKeyframeAt(track, ref.time);
    const gradientTracks = { ...obj.gradientTracks, [ref.property]: next };
    get().commit(replaceObject(project, { ...obj, gradientTracks }));
    set({ selectedGradientKeyframe: null });
  },
```

- [ ] **Step 5: Route easing + reset selection everywhere color resets**

1. In `setSelectedKeyframeEasing`, after the `selectedColorKeyframe` branch (after its closing `}` ~line 632), insert:

```ts
    if (s.selectedGradientKeyframe) {
      const ref = s.selectedGradientKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      const track = obj?.gradientTracks?.[ref.property];
      if (!obj || !track) return;
      const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k));
      get().commit(replaceObject(project, { ...obj, gradientTracks: { ...obj.gradientTracks, [ref.property]: next } }));
      return;
    }
```

2. Add `selectedGradientKeyframe: null` to EVERY object that currently sets `selectedColorKeyframe: null` — namely `selectKeyframe`, `selectShapeKeyframe`, `selectColorKeyframe`, `selectProgressKeyframe`, and `selectObject` (line ~525), plus any `set({... selectedColorKeyframe: null ...})` in creation actions (search the file for `selectedColorKeyframe: null` and mirror each). This keeps the keyframe selections mutually exclusive.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: PASS (new gradient block + no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice9): store auto-key setVectorGradient + gradient keyframe ref/select/remove/easing"
```

---

### Task 3: Inspector — display the sampled gradient + gradient keyframe section

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `sampled.fillGradient`/`strokeGradient` (Plan A); `selectedGradientKeyframe`, `removeSelectedGradientKeyframe`, `selectGradientKeyframe` (Task 2).
- Produces: the paint-type select + gradient editor reflect the playhead-sampled gradient; a "Gradient" keyframe section (easing via `EasingEditor` + delete button).

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('shows the sampled gradient angle at the playhead and a delete button for the selected gradient keyframe', () => {
  // arrange: a selected vector rect with a fill gradient track of two angles
  const id = setupVectorWithFillGradientTrack(); // 0s: angle 0, 1s: angle 90 (see helper note)
  act(() => { useEditor.setState({ time: 1 }); });
  render(<Inspector />);
  // paint type reflects the animated linear gradient
  expect((screen.getByLabelText('fill paint') as HTMLSelectElement).value).toBe('linear');
  act(() => { useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 }); });
  expect(screen.getByRole('button', { name: /delete gradient keyframe/i })).toBeInTheDocument();
});
```

> `setupVectorWithFillGradientTrack` mirrors the existing color-track Inspector test helper: create + select a vector rect, set `autoKey`, then call `setVectorGradient('fill', linearGradient)` at two times. `linearGradient` uses `defaultGradient('linear')` (imported from engine) with `angleToLinearCoords` applied.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no delete-gradient-keyframe button; paint type reads the static gradient (undefined) not the sampled one.

- [ ] **Step 3: Read the sampled gradient + add the keyframe branch + button**

In `src/ui/components/Inspector/Inspector.tsx`:

1. Subscribe to the new selection and action (near the other `useEditor` selectors / destructured actions):

```ts
  const selectedGradientKeyframe = useEditor((s) => s.selectedGradientKeyframe);
```
and add `removeSelectedGradientKeyframe` to the destructured actions list (with `removeSelectedColorKeyframe`).

2. Change `gradientOf` to prefer the sampled gradient so the paint UI tracks the playhead:

```ts
  const gradientOf = (prop: 'fill' | 'stroke', v: VectorAsset) =>
    (prop === 'fill' ? sampled.fillGradient : sampled.strokeGradient) ??
    (prop === 'fill' ? v.style.fillGradient : v.style.strokeGradient);
```

3. In the keyframe-context `if/else if` chain (~line 152), add a branch after the `selectedColorKeyframe` branch:

```ts
  } else if (selectedGradientKeyframe && selectedGradientKeyframe.objectId === obj.id) {
    const track = obj.gradientTracks?.[selectedGradientKeyframe.property];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedGradientKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `${selectedGradientKeyframe.property} gradient @ ${round(track[idx].time)}s`;
      kfInert = idx === track.length - 1;
    }
```

4. In the Keyframe section render (~line 475, beside the color delete button), add:

```tsx
          {selectedGradientKeyframe && (
            <div className={styles.row}>
              <button onClick={() => removeSelectedGradientKeyframe()}>Delete gradient keyframe</button>
            </div>
          )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(slice9): Inspector shows sampled gradient + gradient keyframe easing/delete"
```

---

### Task 4: Timeline — gradient keyframe lane

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`
- Modify: `src/ui/components/Timeline/Timeline.module.css`
- Modify: `src/ui/theme/tokens.css`
- Test: `src/ui/components/Timeline/Timeline.test.tsx`

**Interfaces:**
- Consumes: `obj.gradientTracks`, `selectedGradientKeyframe`, `selectGradientKeyframe` (Task 2).
- Produces: a `.gradientDiamond` marker per gradient keyframe with testid `gradient-keyframe-<objId>-<property>-<time>`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Timeline/Timeline.test.tsx`:

```ts
it('renders a gradient keyframe diamond and selects it on click', () => {
  const id = setupVectorWithFillGradientTrack(); // two fill gradient keyframes at 0 and 1
  render(<Timeline />);
  const diamond = screen.getByTestId(`gradient-keyframe-${id}-fill-0`);
  fireEvent.pointerDown(diamond);
  expect(useEditor.getState().selectedGradientKeyframe).toEqual({ objectId: id, property: 'fill', time: 0 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx`
Expected: FAIL — no such testid.

- [ ] **Step 3: Add the token + CSS class**

In `src/ui/theme/tokens.css`, add a `--color-gradient` token in BOTH theme blocks (alongside `--color-progress` on lines 14 and 37):

```css
  --color-gradient: #2dd4bf;   /* light theme block (~line 14) */
```
```css
  --color-gradient: #14b8a6;   /* dark theme block (~line 37) */
```

In `src/ui/components/Timeline/Timeline.module.css`, after `.progressDiamond` (line 18):

```css
.gradientDiamond { background: var(--color-gradient); }
```

- [ ] **Step 4: Render the lane + subscribe to the store**

In `src/ui/components/Timeline/Timeline.tsx`:

1. Add to the selectors / destructured actions (beside `selectedColorKeyframe` and `selectColorKeyframe`):

```ts
  const selectedGradientKeyframe = useEditor((s) => s.selectedGradientKeyframe);
```
and add `selectGradientKeyframe` to the destructured action list.

2. After the color-track `flatMap` block (ends ~line 109), add:

```tsx
                {(['fill', 'stroke'] as const).flatMap((property) =>
                  (obj.gradientTracks?.[property] ?? []).map((kf) => {
                    const isSel =
                      selectedGradientKeyframe?.objectId === obj.id &&
                      selectedGradientKeyframe.property === property &&
                      selectedGradientKeyframe.time === kf.time;
                    return (
                      <div
                        key={`gradient-${property}-${kf.time}`}
                        className={`${styles.diamond} ${styles.gradientDiamond} ${isSel ? styles.diamondSelected : ''}`}
                        data-testid={`gradient-keyframe-${obj.id}-${property}-${kf.time}`}
                        style={{ left: `${timeToX(kf.time)}px` }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          selectGradientKeyframe({ objectId: obj.id, property, time: kf.time });
                        }}
                      />
                    );
                  }),
                )}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Timeline/Timeline.tsx src/ui/components/Timeline/Timeline.module.css src/ui/theme/tokens.css src/ui/components/Timeline/Timeline.test.tsx
git commit -m "feat(slice9): Timeline gradient keyframe lane"
```

---

### Task 5: Stage — render the sampled gradient in the editor preview

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `sampleObject(o, time).fillGradient/strokeGradient` (Plan A).
- Produces: when a gradient track exists, the Stage paints `url(#savig-grad-<id>-<prop>)` and renders a `<GradientEl>` from the **sampled** gradient (so the paused/scrubbed preview matches export; playback is driven imperatively by `applyFrameToNodes` from Plan A).

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Stage/Stage.test.tsx` (reuse the suite's render + store setup):

```ts
it('renders a linearGradient def for an object with a fill gradient track', () => {
  const id = setupVectorWithFillGradientTrack(); // fill gradient track
  act(() => { useEditor.setState({ time: 0 }); });
  render(<Stage />);
  expect(document.querySelector(`#savig-grad-${id}-fill`)).toBeTruthy();
  const rect = screen.getByTestId(`object-${id}`).querySelector('rect, path')!;
  expect(rect.getAttribute('fill')).toBe(`url(#savig-grad-${id}-fill)`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — Stage reads only `asset.style.fillGradient`, which is absent for a track-only object.

- [ ] **Step 3: Use the sampled gradient in BOTH shape branches**

In `src/ui/components/Stage/Stage.tsx`, for the path branch (lines ~607–622) AND the rect/ellipse branch (lines ~641–650), compute the effective gradients and use them. In the rect/ellipse branch `sampleObject(o, time)` is already called for `geometry` — hoist it to reuse. For the path branch add the call. Pattern (apply to both):

```tsx
                const sampledObj = sampleObject(o, time);
                const fillG = sampledObj.fillGradient ?? asset.style.fillGradient;
                const strokeG = sampledObj.strokeGradient ?? asset.style.strokeGradient;
```
then in the shape element:
```tsx
                  fill={fillG ? paintRef(`savig-grad-${o.id}-fill`) : asset.style.fill}
                  stroke={strokeG ? paintRef(`savig-grad-${o.id}-stroke`) : asset.style.stroke}
```
and the def siblings (after the shape):
```tsx
                  {fillG && <GradientEl id={`savig-grad-${o.id}-fill`} g={fillG} />}
                  {strokeG && <GradientEl id={`savig-grad-${o.id}-stroke`} g={strokeG} />}
```

> In the rect/ellipse branch, replace the existing `const geometry = sampleObject(o, time).geometry ?? {};` with `const sampledObj = sampleObject(o, time); const geometry = sampledObj.geometry ?? {};` so there is exactly one sample call per object.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS — including the unchanged static-gradient Stage tests (static path = `undefined ?? asset.style.fillGradient`).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice9): Stage previews the sampled gradient"
```

---

### Task 6: Keyboard — Delete chain includes gradient keyframes

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/hooks/useKeyboard.test.ts` (if present; else assert via the store in an existing keyboard test, or add a focused test)

**Interfaces:**
- Consumes: `selectedGradientKeyframe`, `removeSelectedGradientKeyframe` (Task 2).
- Produces: Delete/Backspace removes a selected gradient keyframe.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/hooks/useKeyboard.test.ts` (mirror the existing color-keyframe Delete test):

```ts
it('Delete removes a selected gradient keyframe', () => {
  const id = setupVectorWithFillGradientTrack();
  useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
  renderKeyboardHarness(); // whatever the suite uses to mount the hook
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.gradientTracks?.fill?.some((k) => k.time === 0)).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: FAIL — gradient keyframe not removed (falls through to `removeSelectedKeyframe`).

- [ ] **Step 3: Add the gradient branch to the Delete chain**

In `src/ui/hooks/useKeyboard.ts`, in the `Delete`/`Backspace` case (lines ~36–40), add the gradient branch (place it before the color branch so the most-specific paint selection wins; selections are mutually exclusive so order is not load-bearing, but keep it consistent with the store's reset order):

```ts
          if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
          else if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
          else if (s.selectedGradientKeyframe) s.removeSelectedGradientKeyframe();
          else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
          else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
          else s.removeSelectedKeyframe();
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(slice9): Delete chain removes gradient keyframes"
```

---

### Task 7: End-to-end — animate a gradient stop color and prove it exports + animates

**Files:**
- Create/modify: an e2e spec under the repo's Playwright dir (mirror the Slice-8 gradient e2e, e.g. `e2e/gradient-animation.spec.ts`)

**Interfaces:**
- Consumes: the whole feature (UI authoring + Plan A export/runtime).

- [ ] **Step 1: Write the e2e (failing until everything is wired)**

Mirror the Slice-8 gradient e2e (`grep -rln "linearGradient" e2e` to find it). Steps in the spec:

```ts
test('animated gradient: stop color differs across time in the exported bundle', async ({ page }) => {
  await page.goto('/');
  // 1. Draw a rect with the rect tool (reuse the Slice-8 gradient test's draw helper).
  // 2. In the Inspector, set fill paint = 'linear' (selectOption on [aria-label="fill paint"]).
  // 3. Enable autoKey (the autoKey toggle), seek to 0s, set fill stop 0 color = #ff0000.
  // 4. Seek to 1s, set fill stop 0 color = #0000ff  -> two gradient keyframes.
  // 5. Export and read the produced index.html (reuse the export-capture helper).
  const html = await exportAndReadIndexHtml(page);
  expect(html).toContain('<linearGradient id="savig-grad-');
  expect(html).toMatch(/fill="url\(#savig-grad-[^)]*-fill\)"/);
  // 6. Drive the exported runtime in a fresh page at two times; assert the first
  //    fill stop's stop-color differs (animation is live).
  const [c0, c1] = await sampleExportedStopColorAtTwoTimes(html); // helper: load bundle, seek, read <stop stop-color>
  expect(c0).not.toBe(c1);
});
```

> Implement the helper bodies by copying the Slice-8 gradient e2e's draw/export/load utilities; the only new piece is seeking the exported runtime to two times and reading the live `<stop>` `stop-color` (the runtime's `applyFrameToNodes` mutates it). If reading the runtime DOM at two times is awkward, instead assert the exported bundle's keyframe DATA contains both `#ff0000` and `#0000ff` for the fill gradient track AND that the runtime updates `#savig-grad-…-fill` (presence of the def + url ref already asserts wiring).

- [ ] **Step 2: Run to verify it fails / then passes**

Run: `pnpm test:e2e` (or `pnpm exec playwright test e2e/gradient-animation.spec.ts`)
Expected: PASS once Tasks 1–6 + Plan A are in.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm test:e2e`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/gradient-animation.spec.ts
git commit -m "test(e2e): animated gradient exports + animates a stop color"
```

---

## Self-Review (Plan B vs spec §7 + §9)

- **§7 store `setVectorGradient` auto-key / static / clear** → Task 2 (step 4). ✅ (Spec's "auto-select" claim corrected: `setVectorColor` doesn't select; matched.)
- **§7 `GradientKeyframeRef` + select + remove + easing routing + reset sites** → Task 2 (steps 3–5). ✅
- **§7 Inspector sampled display + gradient keyframe section** → Task 3. ✅
- **§7 Timeline gradient lane + token** → Task 4. ✅
- **§7 Stage sampled-gradient render** → Task 5. ✅
- **§7 Delete chain** → Task 6. ✅
- **§9 e2e** → Task 7. ✅
- **Type consistency:** `GradientKeyframeRef { objectId; property: ColorProperty; time }` defined in Task 2, consumed identically in Tasks 3/4/6; `setVectorGradient(property, gradient | undefined)` signature unchanged from the existing interface (line 148); `selectGradientKeyframe`/`removeSelectedGradientKeyframe` names consistent across store, Inspector, Timeline, keyboard. ✅
- **Placeholder scan:** test helpers (`addSelectedVectorRect`, `setupVectorWithFillGradientTrack`, `exportAndReadIndexHtml`, `sampleExportedStopColorAtTwoTimes`) are described as "copy the existing color/gradient test helper" with exact construction — not bare TODO. The e2e helper bodies are explicitly deferred to "copy the Slice-8 utilities," which exist. ✅
- **Dependency note:** Plan B assumes Plan A merged/available; Task 5 (Stage) and Task 7 (e2e) fail without `sampleObject().fillGradient`. Build order: Plan A → Plan B.
```
