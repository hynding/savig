# Slice 25 Drag-to-Retime Keyframes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag a keyframe diamond horizontally in the timeline to change its time (frame-snapped, value/easing preserved), for all 6 keyframe types.

**Architecture:** A `retimeSelectedKeyframe(newTime)` store action retimes whichever keyframe is selected (6-branch, mirroring `copyKeyframe`): remove it from its track by reference and `upsert*` a clone at the snapped/clamped time, one commit, re-select. The Timeline's existing diamond `onPointerDown` (which already selects) also starts a 1-DOF horizontal drag; window `pointermove`/`pointerup` listeners preview imperatively and commit the retime on a moved pointer-up. Editor-only.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- `retimeSelectedKeyframe(newTime)`: `t = Math.max(0, snapToFrame(newTime, project.meta.fps))`; no-op if the selected keyframe is unresolvable or `t` equals its current time; else remove-by-reference + `upsert*` clone at `t`, ONE `commit`, then re-select the keyframe at `t`. 6 branches (scalar/shape/color/gradient/dash/progress), each the same shape as the scalar branch; progress no-ops if `obj.motionPath` is gone.
- Timeline drag: each diamond's `onPointerDown` keeps its `e.stopPropagation()` + select, and additionally captures `{ startTime: kf.time, startX: e.clientX, el: e.currentTarget }` + `setPointerCapture`. A window `pointermove` previews `d.el.style.left = timeToX(max(0, snapToFrame(d.startTime + xToTime(clientX - d.startX), fps)))`; a window `pointerup` calls `retimeSelectedKeyframe(t)` only when `t !== d.startTime`. A pure click still just selects.
- Editor-only: keyframe `time` already persists/animates/exports. NO engine/render/runtime/export/migration change. Stays v4.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Store — `retimeSelectedKeyframe(newTime)`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `snapToFrame`, `KF_EPS`, `replaceObject`, `upsertKeyframe`, `upsertShapeKeyframe`, `upsertColorKeyframe`, `upsertGradientKeyframe`, the `selectXKeyframe` actions (all already in `store.ts`).
- Produces: action `retimeSelectedKeyframe(newTime: number): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('retimeSelectedKeyframe', () => {
  it('moves a scalar keyframe to a new time (value + easing preserved, re-selected)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 45);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    useEditor.getState().retimeSelectedKeyframe(1);
    const track = useEditor.getState().history.present.objects[0].tracks.rotation!;
    expect(track.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false); // old time gone
    const moved = track.find((k) => Math.abs(k.time - 1) < 1e-6)!;
    expect(moved.value).toBe(45);
    expect(moved.easing).toBe('easeIn');
    expect(useEditor.getState().selectedKeyframe).toEqual({ objectId: id, property: 'rotation', time: 1 });
  });

  it('moves a color keyframe (hex preserved)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setVectorColor('fill', '#abcdef');
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().retimeSelectedKeyframe(2);
    const track = useEditor.getState().history.present.objects[0].colorTracks!.fill!;
    expect(track.find((k) => Math.abs(k.time - 2) < 1e-6)!.value).toBe('#abcdef');
    expect(track.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false);
  });

  it('moves a shape keyframe (path preserved)', () => {
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    const src = useEditor.getState().history.present.objects[0].shapeTrack!.find((k) => Math.abs(k.time) < 1e-6)!;
    useEditor.getState().retimeSelectedKeyframe(1);
    const track = useEditor.getState().history.present.objects[0].shapeTrack!;
    expect(track.find((k) => Math.abs(k.time - 1) < 1e-6)!.path).toEqual(src.path);
    expect(track.some((k) => Math.abs(k.time) < 1e-6)).toBe(false);
  });

  it('clamps a negative target to 0', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(1);
    useEditor.getState().setProperty('x', 5);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 1 });
    useEditor.getState().retimeSelectedKeyframe(-3);
    const track = useEditor.getState().history.present.objects[0].tracks.x!;
    expect(track.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(true);
  });

  it('is a no-op (no history entry) when the target equals the current time', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(1);
    useEditor.getState().setProperty('x', 5);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 1 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().retimeSelectedKeyframe(1);
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "retimeSelectedKeyframe"`
Expected: FAIL — `retimeSelectedKeyframe` undefined.

- [ ] **Step 3: Add the interface entry + action**

In `src/ui/store/store.ts`, add to the actions interface (next to `pasteKeyframe(): void;`):

```ts
  retimeSelectedKeyframe(newTime: number): void;
```

Add the action immediately after `pasteKeyframe`:

```ts
  retimeSelectedKeyframe(newTime) {
    const s = get();
    const project = s.history.present;
    const t = Math.max(0, snapToFrame(newTime, project.meta.fps));
    const find = <K extends { time: number }>(track: K[] | undefined, time: number) =>
      track?.find((k) => Math.abs(k.time - time) < KF_EPS);
    if (s.selectedKeyframe) {
      const r = s.selectedKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const track = obj && obj.tracks[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [r.property]: next } }));
      get().selectKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedShapeKeyframe) {
      const r = s.selectedShapeKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const kf = find(obj?.shapeTrack, r.time);
      if (!obj || !obj.shapeTrack || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertShapeKeyframe(obj.shapeTrack.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, shapeTrack: next }));
      get().selectShapeKeyframe({ objectId: obj.id, time: t });
      return;
    }
    if (s.selectedColorKeyframe) {
      const r = s.selectedColorKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const track = obj?.colorTracks?.[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertColorKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [r.property]: next } }));
      get().selectColorKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedGradientKeyframe) {
      const r = s.selectedGradientKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const track = obj?.gradientTracks?.[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertGradientKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, gradientTracks: { ...obj.gradientTracks, [r.property]: next } }));
      get().selectGradientKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedDashKeyframe) {
      const r = s.selectedDashKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const kf = find(obj?.dashOffsetTrack, r.time);
      if (!obj || !obj.dashOffsetTrack || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(obj.dashOffsetTrack.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
      get().selectDashKeyframe({ objectId: obj.id, time: t });
      return;
    }
    if (s.selectedProgressKeyframe) {
      const r = s.selectedProgressKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const kf = find(obj?.motionPath?.progress, r.time);
      if (!obj || !obj.motionPath || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(obj.motionPath.progress.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress: next } }));
      get().selectProgressKeyframe({ objectId: obj.id, time: t });
      return;
    }
  },
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "retimeSelectedKeyframe"`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice25): retimeSelectedKeyframe (all 6 types, frame-snapped, clamped)"
```

---

### Task 2: Timeline drag + e2e

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`
- Test: `src/ui/components/Timeline/Timeline.test.tsx`
- Create: `e2e/keyframe-retime.spec.ts`

**Interfaces:**
- Consumes: store `retimeSelectedKeyframe` (Task 1); existing `timeToX`/`xToTime`/`snapToFrame`/`fps` in `Timeline.tsx`.

- [ ] **Step 1: Write the failing Timeline test**

Append to `src/ui/components/Timeline/Timeline.test.tsx`:

```ts
describe('drag-to-retime', () => {
  it('dragging a keyframe diamond changes its time', () => {
    const id = withKeyedObject(); // a scalar x keyframe at t=1
    render(<Timeline />);
    const diamond = screen.getByTestId(`keyframe-${id}-x-1`);
    fireEvent.pointerDown(diamond, { clientX: 1 * PX_PER_SECOND }); // grab at t=1
    fireEvent.pointerMove(window, { clientX: 2 * PX_PER_SECOND }); // drag +1s
    fireEvent.pointerUp(window, { clientX: 2 * PX_PER_SECOND });
    const track = useEditor.getState().history.present.objects[0].tracks.x!;
    expect(track.some((k) => Math.abs(k.time - 2) < 1e-6)).toBe(true); // now at t=2
    expect(track.some((k) => Math.abs(k.time - 1) < 1e-6)).toBe(false); // gone from t=1
  });

  it('a click (no movement) selects without retiming', () => {
    const id = withKeyedObject();
    render(<Timeline />);
    const diamond = screen.getByTestId(`keyframe-${id}-x-1`);
    fireEvent.pointerDown(diamond, { clientX: 1 * PX_PER_SECOND });
    fireEvent.pointerUp(window, { clientX: 1 * PX_PER_SECOND }); // same x -> no move
    expect(useEditor.getState().selectedKeyframe).toEqual({ objectId: id, property: 'x', time: 1 });
    expect(useEditor.getState().history.present.objects[0].tracks.x).toHaveLength(1); // still one, at t=1
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx -t "drag-to-retime"`
Expected: FAIL — the diamond pointer-down only selects; no retime on drag.

- [ ] **Step 3: Add the drag machine**

In `src/ui/components/Timeline/Timeline.tsx`:

1. Add the React hook imports at the top:

```ts
import { useEffect, useRef } from 'react';
```

2. Pull `retimeSelectedKeyframe` from the store actions (the destructure on the
`useEditor.getState()` line that already lists `seek, selectObject, selectKeyframe, …`):

```ts
  const { seek, selectObject, selectKeyframe, selectShapeKeyframe, selectColorKeyframe, selectGradientKeyframe, selectDashKeyframe, selectProgressKeyframe, toggleAutoKey, toggleOnionSkin, retimeSelectedKeyframe } =
    useEditor.getState();
```

3. Inside the component body (after the destructure, before the `return`), add the drag
ref + a `startKeyframeDrag` helper + the window listeners:

```ts
  const dragRef = useRef<{ startTime: number; startX: number; el: HTMLElement } | null>(null);
  const startKeyframeDrag = (e: React.PointerEvent, startTime: number) => {
    dragRef.current = { startTime, startX: e.clientX, el: e.currentTarget as HTMLElement };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  useEffect(() => {
    const timeFor = (clientX: number, d: { startTime: number; startX: number }) =>
      Math.max(0, snapToFrame(d.startTime + xToTime(clientX - d.startX), fps));
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.el.style.left = `${timeToX(timeFor(e.clientX, d))}px`; // imperative frame-snapped preview
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      const t = timeFor(e.clientX, d);
      if (t !== d.startTime) retimeSelectedKeyframe(t);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [fps, retimeSelectedKeyframe]);
```

4. In EACH of the 6 diamond `onPointerDown` handlers, add `startKeyframeDrag(e, kf.time)`
after the existing `selectX(...)` call. For example, the scalar diamond becomes:

```tsx
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            selectKeyframe({ objectId: obj.id, property: prop, time: kf.time });
                            startKeyframeDrag(e, kf.time);
                          }}
```

Do the same for the shape, color, gradient, dash, and progress diamonds (each keeps its
own `selectX(...)` line and appends `startKeyframeDrag(e, kf.time);`).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx`
Expected: PASS (the 2 new drag tests + all existing Timeline tests).

- [ ] **Step 5: Typecheck/lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

```bash
git add src/ui/components/Timeline/Timeline.tsx src/ui/components/Timeline/Timeline.test.tsx
git commit -m "feat(slice25): drag a timeline keyframe diamond to retime it"
```

- [ ] **Step 6: Write the e2e**

Create `e2e/keyframe-retime.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('drag a keyframe diamond to retime it', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (auto-selected); key rotation at t=0 via the Inspector.
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  const rotField = page.getByLabel('rotation', { exact: true });
  await rotField.fill('40');
  await rotField.blur();

  // Drag the rotation diamond at t=0 right by 100px (PX_PER_SECOND) -> t=1.
  const diamond = page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first();
  const db = (await diamond.boundingBox())!;
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + db.width / 2 + 100, db.y + db.height / 2);
  await page.mouse.up();

  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]')).toHaveCount(0);
});
```

- [ ] **Step 7: Run the e2e**

Run: `pnpm exec playwright test e2e/keyframe-retime.spec.ts`
Expected: PASS.

> If the diamond is hard to grab (it is 10px), the `boundingBox()` centre is reliable;
> the mouse down/move/up sequence mirrors the proven rotate-handle / scale-handle e2es.

- [ ] **Step 8: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add e2e/keyframe-retime.spec.ts
git commit -m "test(e2e): drag a keyframe diamond to retime it"
```

---

## Self-Review (plan vs spec)

- **§2 `retimeSelectedKeyframe` (6-branch; snap+clamp; remove-by-ref + upsert; re-select; no-op unchanged/unresolvable)** → Task 1 Step 3 + 5 store tests (scalar/color/shape + clamp + no-op). ✅
- **§3 Timeline drag (diamond onPointerDown also starts a drag; window move preview; up commits if moved; click selects)** → Task 2 Step 3 + the drag + click Timeline tests. ✅
- **§4 editor-only (no engine/render/runtime/export/migration)** → only store + Timeline + one e2e touched. ✅
- **§5 edges (no-move=select; clamp ≥0; retime-onto-existing replaces via upsert)** → the click + clamp store/Timeline tests; `upsert*` replace is inherent. ✅
- **§8 testing (store ×5, Timeline ×2, e2e)** → Tasks 1–2. ✅
- **Type/name consistency:** `retimeSelectedKeyframe(newTime: number)` identical in interface, store, Timeline destructure, and tests; the 6 branches use the right track + `upsert*` + `selectXKeyframe` (matching `copyKeyframe`/`pasteKeyframe` from S24); diamond testids `keyframe-<id>-<prop>-<time>` reused. ✅
- **Placeholder scan:** every step carries concrete code (all 6 store branches spelled out; all 6 diamond handlers described with the scalar example shown); the e2e mirrors proven specs. ✅
