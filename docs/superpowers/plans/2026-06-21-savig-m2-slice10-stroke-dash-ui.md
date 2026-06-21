# Slice 10 Stroke Dash — Plan B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author dashed strokes and the self-drawing-path animation in the editor — a "dashed" toggle, a one-click **Draw on**, an auto-keying dash-offset field, a Timeline dash lane, and Delete/easing support — proven end-to-end through export.

**Architecture:** Mirror the existing scalar-track authoring seams (`setMotionProgress`/`setVectorColor`). The store gains `setStrokeDasharray`, an auto-key `setStrokeDashoffset`, and a `drawOn()` convenience, plus a `DashKeyframeRef` selection with Timeline lane, Inspector section, and Delete-chain wiring. Depends on Plan A (engine resolves `sampleObject(...).strokeDashoffset` and the runtime applies it per frame).

**Tech Stack:** React 18 + TS strict, Zustand store, CSS Modules + design tokens, Vitest + RTL, Playwright (e2e).

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Plan A is a prerequisite: `sampleObject` populates `strokeDashoffset`; `FrameItem`/`applyFrameToNodes` animate it; export bakes the t=0 sample. Do Plan A first.
- Dash units are pathLength-normalized (0..1). The Draw-on effect uses `strokeDasharray=[1,1]` + dashoffset keyframes `1 → 0`.
- The shape stays the wrapper `<g>`'s `firstElementChild` (unchanged).
- No persistence version bump (project stays v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Store — dash style/offset actions, Draw-on, keyframe ref, easing/delete

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `upsertKeyframe`/`removeKeyframeAt` (engine, already imported), `createKeyframe`, `snapToFrame`, `replaceObject`.
- Produces: `setStrokeDasharray(dasharray: number[] | undefined)`; `setStrokeDashoffset(value: number)`; `drawOn()`; `DashKeyframeRef = { objectId; time }`; state `selectedDashKeyframe: DashKeyframeRef | null`; `selectDashKeyframe(ref)`; `removeSelectedDashKeyframe()`; `setSelectedKeyframeEasing` routes to `dashOffsetTrack`.

- [ ] **Step 1: Write the failing store tests**

Append to `src/ui/store/store.test.ts` (reuse the `seedRect` pattern from the `setVectorGradient (animated)` block):

```ts
describe('stroke dash', () => {
  function seedRect(): string {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    return useEditor.getState().selectedObjectId!;
  }
  const obj = (id: string) => useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const asset = (id: string) => {
    const a = useEditor.getState().history.present.assets.find((x) => x.id === obj(id).assetId)!;
    if (a.kind !== 'vector') throw new Error('not vector');
    return a;
  };

  it('setStrokeDasharray sets the pattern; clearing it also clears the offset track', () => {
    const id = seedRect();
    useEditor.getState().setStrokeDasharray([1, 1]);
    expect(asset(id).style.strokeDasharray).toEqual([1, 1]);
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1); // an orphan-able offset track
    useEditor.getState().setStrokeDasharray(undefined);
    expect(asset(id).style.strokeDasharray).toBeUndefined();
    expect(obj(id).dashOffsetTrack).toBeUndefined(); // not left inflating duration
  });

  it('setStrokeDashoffset autoKey ON upserts a dash keyframe at the playhead', () => {
    const id = seedRect();
    useEditor.getState().seek(1);
    useEditor.getState().setStrokeDashoffset(0.5);
    expect(obj(id).dashOffsetTrack).toEqual([{ time: 1, value: 0.5, easing: 'linear' }]);
  });

  it('setStrokeDashoffset autoKey OFF writes the static offset', () => {
    const id = seedRect();
    useEditor.getState().toggleAutoKey();
    useEditor.getState().setStrokeDashoffset(0.25);
    expect(asset(id).style.strokeDashoffset).toBe(0.25);
    expect(obj(id).dashOffsetTrack).toBeUndefined();
  });

  it('drawOn seeds dasharray [1,1] + two keyframes 1->0 over [playhead, +1s]', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().drawOn();
    expect(asset(id).style.strokeDasharray).toEqual([1, 1]);
    const track = obj(id).dashOffsetTrack!;
    expect(track.map((k) => [k.time, k.value])).toEqual([[0, 1], [1, 0]]);
  });

  it('removeSelectedDashKeyframe deletes it and collapses an emptied track', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1);
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    useEditor.getState().removeSelectedDashKeyframe();
    expect(obj(id).dashOffsetTrack).toBeUndefined();
    expect(useEditor.getState().selectedDashKeyframe).toBeNull();
  });

  it('setSelectedKeyframeEasing routes to the dash track', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1);
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(obj(id).dashOffsetTrack![0].easing).toBe('easeIn');
  });

  it('re-keying an existing dash keyframe preserves its easing', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1);
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    useEditor.getState().setStrokeDashoffset(0.5); // edit offset at same time
    expect(obj(id).dashOffsetTrack![0].easing).toBe('easeIn');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "stroke dash"`
Expected: FAIL — actions undefined.

- [ ] **Step 3: Add the ref type, state, and interface methods**

In `src/ui/store/store.ts`:

1. After the `GradientKeyframeRef` interface, add:

```ts
export interface DashKeyframeRef {
  objectId: string;
  time: number;
}
```

2. In `EditorState`, after `selectedGradientKeyframe: GradientKeyframeRef | null;`:

```ts
  selectedDashKeyframe: DashKeyframeRef | null;
```

3. In the actions interface, after `removeSelectedGradientKeyframe(): void;`:

```ts
  setStrokeDasharray(dasharray: number[] | undefined): void;
  setStrokeDashoffset(value: number): void;
  drawOn(): void;
  selectDashKeyframe(ref: DashKeyframeRef | null): void;
  removeSelectedDashKeyframe(): void;
```

4. In the initial-state object, after `selectedGradientKeyframe: null as GradientKeyframeRef | null,`:

```ts
  selectedDashKeyframe: null as DashKeyframeRef | null,
```

- [ ] **Step 4: Implement the actions**

Place these alongside the other vector-style/keyframe actions (e.g. after `removeSelectedGradientKeyframe`):

```ts
  setStrokeDasharray(dasharray) {
    if (dasharray !== undefined) {
      get().setVectorStyle({ strokeDasharray: dasharray });
      return;
    }
    // Clearing the dash also clears the (now-meaningless) offset animation, so an
    // orphan dashOffsetTrack can't keep inflating computeProjectDuration.
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const nextAssets = project.assets.map((a) =>
      a.id === asset.id ? { ...asset, style: { ...asset.style, strokeDasharray: undefined } } : a,
    );
    get().commit({
      ...project,
      assets: nextAssets,
      objects: project.objects.map((o) => (o.id === obj.id ? { ...o, dashOffsetTrack: undefined } : o)),
    });
    set({ selectedDashKeyframe: null });
  },
  setStrokeDashoffset(value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    if (!s.autoKey) {
      get().setVectorStyle({ strokeDashoffset: value });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const existing = obj.dashOffsetTrack ?? [];
    // Preserve an existing keyframe's easing so editing the offset doesn't reset it.
    const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
    const next = upsertKeyframe(existing, createKeyframe(time, value, { easing: priorEasing }));
    get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
  },
  drawOn() {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const t0 = snapToFrame(s.time, project.meta.fps);
    const t1 = snapToFrame(s.time + 1, project.meta.fps);
    // Atomic: dasharray on the asset + the 1->0 offset track on the object.
    const nextAssets = project.assets.map((a) =>
      a.id === asset.id ? { ...asset, style: { ...asset.style, strokeDasharray: [1, 1] } } : a,
    );
    const dashOffsetTrack = [createKeyframe(t0, 1), createKeyframe(t1, 0)];
    get().commit({
      ...project,
      assets: nextAssets,
      objects: project.objects.map((o) => (o.id === obj.id ? { ...o, dashOffsetTrack } : o)),
    });
  },
  selectDashKeyframe(ref) {
    set({
      selectedDashKeyframe: ref,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedColorKeyframe: null,
      selectedGradientKeyframe: null,
      selectedProgressKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId } : {}),
    });
  },
  removeSelectedDashKeyframe() {
    const s = get();
    const ref = s.selectedDashKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.dashOffsetTrack) return;
    const next = removeKeyframeAt(obj.dashOffsetTrack, ref.time);
    get().commit(
      replaceObject(project, { ...obj, dashOffsetTrack: next.length > 0 ? next : undefined }),
    );
    set({ selectedDashKeyframe: null });
  },
```

> `upsertKeyframe`, `removeKeyframeAt`, `createKeyframe`, `snapToFrame`, `replaceObject` are all already imported/defined in store.ts.

- [ ] **Step 5: Route easing + reset selection everywhere a sibling selection resets**

1. In `setSelectedKeyframeEasing`, after the `selectedGradientKeyframe` branch, insert:

```ts
    if (s.selectedDashKeyframe) {
      const ref = s.selectedDashKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      if (!obj?.dashOffsetTrack) return;
      const next = obj.dashOffsetTrack.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
      return;
    }
```

2. Add `selectedDashKeyframe: null` to EVERY object that sets `selectedGradientKeyframe: null` — `selectKeyframe`, `selectShapeKeyframe`, `selectColorKeyframe`, `selectGradientKeyframe`, `selectProgressKeyframe`, and `selectObject` (search the file for `selectedGradientKeyframe: null` and mirror each).

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: PASS (new dash block + no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice10): store dash actions (setStrokeDasharray/Dashoffset/drawOn) + dash keyframe ref"
```

---

### Task 2: Inspector — dashed toggle, Draw-on, auto-keying offset field, dash keyframe section

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `sampled.strokeDashoffset` (Plan A); `setStrokeDasharray`, `setStrokeDashoffset`, `drawOn`, `selectedDashKeyframe`, `removeSelectedDashKeyframe` (Task 1).
- Produces: a "dashed" checkbox, a "Draw on" button, a `strokeDashoffset` NumberField (shows sampled, auto-keys), and a Dash keyframe section (easing + delete).

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
describe('stroke dash UI', () => {
  function seedRect(): string {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 60, height: 40 });
    return useEditor.getState().selectedObjectId!;
  }

  it('toggling "dashed" sets a dash pattern on the asset', async () => {
    seedRect();
    render(<Inspector />);
    await userEvent.click(screen.getByLabelText('dashed'));
    const a = useEditor.getState().history.present.assets.find((x) => x.kind === 'vector')!;
    expect(a.kind === 'vector' && a.style.strokeDasharray).toEqual([1, 1]);
  });

  it('Draw on seeds keyframes and shows a Dash keyframe section when one is selected', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().drawOn();
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    render(<Inspector />);
    expect(screen.getByRole('button', { name: /delete dash keyframe/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no "dashed" control / no dash keyframe section.

- [ ] **Step 3: Wire the Inspector**

In `src/ui/components/Inspector/Inspector.tsx`:

1. Subscribe + destructure (near the other selectors/actions):

```ts
  const selectedDashKeyframe = useEditor((s) => s.selectedDashKeyframe);
```
and add `setStrokeDasharray, setStrokeDashoffset, drawOn, removeSelectedDashKeyframe` to the destructured actions list.

2. Add a dash keyframe-context branch in the `if/else if` keyframe chain (after the gradient branch):

```ts
  } else if (selectedDashKeyframe && selectedDashKeyframe.objectId === obj.id) {
    const track = obj.dashOffsetTrack;
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedDashKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `dash @ ${round(track[idx].time)}s`;
      kfInert = idx === track.length - 1;
    }
```

3. In the Style group (after the strokeLinejoin row, near line 414+), add the dash controls:

```tsx
          <div className={styles.row}>
            <label htmlFor="insp-dashed">dashed</label>
            <input
              id="insp-dashed"
              type="checkbox"
              aria-label="dashed"
              checked={!!vector.style.strokeDasharray && vector.style.strokeDasharray.length > 0}
              onChange={(e) => setStrokeDasharray(e.target.checked ? [1, 1] : undefined)}
            />
            <button onClick={() => drawOn()}>Draw on</button>
          </div>
          {vector.style.strokeDasharray && vector.style.strokeDasharray.length > 0 && (
            <div className={styles.row}>
              <label htmlFor="insp-dashoffset">dashOffset</label>
              <NumberField
                label="dashOffset"
                value={round((sampled.strokeDashoffset ?? vector.style.strokeDashoffset ?? 0))}
                onCommit={(n) => setStrokeDashoffset(n)}
              />
            </div>
          )}
```

4. In the Keyframe section render (beside the gradient delete button), add:

```tsx
          {selectedDashKeyframe && (
            <div className={styles.row}>
              <button onClick={() => removeSelectedDashKeyframe()}>Delete dash keyframe</button>
            </div>
          )}
```

> `NumberField`, `round`, `styles`, `KF_EPS`, `sampled` are all already in scope in Inspector.tsx.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(slice10): Inspector dashed toggle + Draw on + dashOffset field + dash keyframe section"
```

---

### Task 3: Timeline — dash keyframe lane

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`
- Modify: `src/ui/components/Timeline/Timeline.module.css`
- Modify: `src/ui/theme/tokens.css`
- Test: `src/ui/components/Timeline/Timeline.test.tsx`

**Interfaces:**
- Consumes: `obj.dashOffsetTrack`, `selectedDashKeyframe`, `selectDashKeyframe` (Task 1).
- Produces: a `.dashDiamond` marker per dash keyframe with testid `dash-keyframe-<objId>-<time>`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Timeline/Timeline.test.tsx`:

```ts
it('renders a dash keyframe diamond and selects it on click', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().seek(0);
  useEditor.getState().setStrokeDashoffset(1);
  render(<Timeline />);
  const diamond = screen.getByTestId(`dash-keyframe-${id}-0`);
  fireEvent.pointerDown(diamond);
  expect(useEditor.getState().selectedDashKeyframe).toEqual({ objectId: id, time: 0 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx`
Expected: FAIL — no such testid.

- [ ] **Step 3: Add the token + CSS class**

In `src/ui/theme/tokens.css`, add a `--color-dash` token in BOTH theme blocks (alongside `--color-gradient`):

```css
  --color-dash: #c084fc;   /* dark/default block (near --color-gradient) */
```
```css
  --color-dash: #9333ea;   /* light theme block */
```

In `src/ui/components/Timeline/Timeline.module.css`, after `.gradientDiamond`:

```css
.dashDiamond { background: var(--color-dash); }
```

- [ ] **Step 4: Render the lane + subscribe**

In `src/ui/components/Timeline/Timeline.tsx`:

1. Add the selector + action (beside the gradient ones):

```ts
  const selectedDashKeyframe = useEditor((s) => s.selectedDashKeyframe);
```
and add `selectDashKeyframe` to the destructured actions.

2. After the gradient-track `flatMap` block, add:

```tsx
                {(obj.dashOffsetTrack ?? []).map((kf) => {
                  const isSel =
                    selectedDashKeyframe?.objectId === obj.id && selectedDashKeyframe.time === kf.time;
                  return (
                    <div
                      key={`dash-${kf.time}`}
                      className={`${styles.diamond} ${styles.dashDiamond} ${isSel ? styles.diamondSelected : ''}`}
                      data-testid={`dash-keyframe-${obj.id}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        selectDashKeyframe({ objectId: obj.id, time: kf.time });
                      }}
                    />
                  );
                })}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Timeline/Timeline.tsx src/ui/components/Timeline/Timeline.module.css src/ui/theme/tokens.css src/ui/components/Timeline/Timeline.test.tsx
git commit -m "feat(slice10): Timeline dash keyframe lane"
```

---

### Task 4: Stage — render dash attrs from the sampled offset

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `sampleObject(o, time).strokeDashoffset` (Plan A) — already computed as `sampledObj` in both shape branches (added in Slice 9).
- Produces: when `asset.style.strokeDasharray` is present, the shape carries `strokeDasharray`, `pathLength="1"`, and `strokeDashoffset` = sampled ?? static.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('renders dash attrs + pathLength on a dashed object with an animated offset', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().seek(0);
  useEditor.getState().drawOn(); // dasharray [1,1] + offset track 1->0
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const shape = screen.getByTestId(`object-${id}`).firstElementChild!;
  expect(shape.getAttribute('pathLength')).toBe('1');
  expect(shape.getAttribute('stroke-dasharray')).toBe('1 1');
  expect(shape.getAttribute('stroke-dashoffset')).toBe('1'); // sampled at t=0
});
```

> Note RTL renders attributes in JSX-camelCase as the corresponding DOM attribute: `strokeDasharray` → `stroke-dasharray`, `pathLength` → `pathLength`, `strokeDashoffset` → `stroke-dashoffset`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — Stage shape has no dash attrs.

- [ ] **Step 3: Emit dash attrs in BOTH shape branches**

In `src/ui/components/Stage/Stage.tsx`, in the path branch AND the rect/ellipse branch (both already compute `const sampledObj = sampleObject(o, time);`), add dash props to the shape element. For the rect/ellipse `<ShapeTag>` and the path `<path>`, add (a dashed object only):

```tsx
                    strokeDasharray={
                      asset.style.strokeDasharray && asset.style.strokeDasharray.length > 0
                        ? asset.style.strokeDasharray.join(' ')
                        : undefined
                    }
                    pathLength={
                      asset.style.strokeDasharray && asset.style.strokeDasharray.length > 0 ? 1 : undefined
                    }
                    strokeDashoffset={
                      asset.style.strokeDasharray && asset.style.strokeDasharray.length > 0
                        ? (sampledObj.strokeDashoffset ?? asset.style.strokeDashoffset ?? 0)
                        : undefined
                    }
```

> Add these alongside the existing `strokeWidth`/`strokeLinecap`/`strokeLinejoin` props on each shape element. `undefined` props are omitted by React, so solid objects are unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice10): Stage renders dash attrs from the sampled offset"
```

---

### Task 5: Keyboard — Delete chain includes dash keyframes

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Consumes: `selectedDashKeyframe`, `removeSelectedDashKeyframe` (Task 1).
- Produces: Delete/Backspace removes a selected dash keyframe.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('Delete removes a selected dash keyframe', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  s.seek(1);
  s.setStrokeDashoffset(0.5);
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().setActiveTool('select');
  useEditor.getState().selectDashKeyframe({ objectId: id, time: 1 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects[0].dashOffsetTrack ?? []).toHaveLength(0);
  expect(useEditor.getState().selectedDashKeyframe).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: FAIL — dash keyframe not removed.

- [ ] **Step 3: Add the dash branch to the Delete chain**

In `src/ui/hooks/useKeyboard.ts`, in the `Delete`/`Backspace` case, add the dash branch (after gradient, before shape — selections are mutually exclusive, keep deterministic):

```ts
          if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
          else if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
          else if (s.selectedGradientKeyframe) s.removeSelectedGradientKeyframe();
          else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
          else if (s.selectedDashKeyframe) s.removeSelectedDashKeyframe();
          else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
          else s.removeSelectedKeyframe();
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(slice10): Delete chain removes dash keyframes"
```

---

### Task 6: End-to-end — draw-on a dashed path and prove it exports + animates

**Files:**
- Create: `e2e/stroke-dash.spec.ts`

**Interfaces:**
- Consumes: the whole feature (UI authoring + Plan A export/runtime).

- [ ] **Step 1: Write the e2e**

Model on `e2e/gradient-animation.spec.ts` (copy its draw/export/load boilerplate). Create `e2e/stroke-dash.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw-on a dashed rect -> export -> bundle animates stroke-dashoffset', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 170);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Give it a stroke, then Draw on (seeds dasharray + offset keyframes 1->0).
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByRole('button', { name: 'Draw on' }).click();

  // Export + unpack.
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
  const indexHtml = Buffer.from(files['index.html']).toString('utf8');
  expect(indexHtml).toContain('pathLength="1"');
  expect(indexHtml).toMatch(/stroke-dasharray="1 1"/);

  // Drive the standalone runtime: stroke-dashoffset must change over time.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const shape = exported.locator('[data-savig-object] rect').first();
  await expect(shape).toHaveCount(1);
  const d0 = await shape.getAttribute('stroke-dashoffset');
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    if ((await shape.getAttribute('stroke-dashoffset')) !== d0) changed = true;
  }
  expect(changed).toBe(true); // the exported stroke-dashoffset animates
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/stroke-dash.spec.ts`
Expected: PASS (once Tasks 1–5 + Plan A are in).

> If `drawOn` on a rect with the default stroke produces no visible stroke, the dash still animates (the attribute changes regardless of stroke visibility); the assertion is on the attribute, not pixels. The default vector style has a stroke (`addVectorShape` seeds `PATH_DEFAULT_STYLE`/rect style) — if the rect's default stroke is 'none', set a stroke first via the Inspector `stroke` checkbox before Draw on. Confirm the default during implementation and adjust the e2e accordingly.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/stroke-dash.spec.ts
git commit -m "test(e2e): draw-on dashed path exports + animates stroke-dashoffset"
```

---

## Self-Review (Plan B vs spec §7 + §9)

- **§7 store `setStrokeDasharray`/`setStrokeDashoffset`(auto-key)/`drawOn`** → Task 1. ✅
- **§7 `DashKeyframeRef` + select + remove (collapse emptied) + easing routing + resets** → Task 1. ✅
- **§7 Inspector dashed toggle + Draw on + sampled dashOffset field + dash keyframe section** → Task 2. ✅
- **§7 Timeline dash lane + token** → Task 3. ✅
- **§7 Stage dash attrs (sampled)** → Task 4. ✅
- **Delete chain** → Task 5. ✅
- **§9 e2e** → Task 6. ✅
- **Type consistency:** `DashKeyframeRef { objectId; time }` defined in Task 1, consumed in Tasks 3/5; action names (`setStrokeDasharray`/`setStrokeDashoffset`/`drawOn`/`selectDashKeyframe`/`removeSelectedDashKeyframe`) consistent across store, Inspector, Timeline, keyboard. ✅
- **Placeholder scan:** test helpers described with exact construction; e2e boilerplate copied from the existing gradient-animation spec. The one conditional ("if default stroke is 'none', set a stroke first") is a verify-during-impl note with a concrete fallback, not an unresolved TODO. ✅
- **Dependency note:** Plan B assumes Plan A merged/available (Stage Task 4 + e2e Task 6 need `sampleObject().strokeDashoffset` + the runtime apply). Build order: Plan A → Plan B.
```
