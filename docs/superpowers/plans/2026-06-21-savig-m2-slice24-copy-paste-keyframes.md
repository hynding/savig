# Slice 24 Copy/Paste Keyframes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy the selected keyframe (any of the 6 types) and paste it at the playhead — value + easing preserved — on the same track, via Cmd/Ctrl+C/V (routed by keyframe-priority).

**Architecture:** A transient `keyframeClipboard` tagged union (mutually exclusive with the Slice-21 object `clipboard`). `copyKeyframe` snapshots whichever selected keyframe is set; `pasteKeyframe` clones it to the snapped playhead, upserts into the same track of the same object, and selects it. `useKeyboard` routes Cmd/Ctrl+C/V to the keyframe path when a keyframe is selected (mirrors the Delete chain). Editor-only.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- `keyframeClipboard: KeyframeClip | null` is transient (NOT in `history`, NOT in `TRANSIENT_DEFAULTS`), initial `null`, survives `newProject`. **Mutually exclusive** with the object `clipboard`: `copyKeyframe` sets it + clears `clipboard`; `copySelected` clears it.
- `pasteKeyframe` clones the keyframe to `time = snapToFrame(get().time, project.meta.fps)`, upserts into the SAME object's SAME track (re-creating an absent track via `?? []`; `progress` no-ops if `obj.motionPath` is gone), ONE `commit`, then selects the pasted keyframe. No `autoKey` gate. No-op on empty clipboard / missing object.
- Keyboard: Cmd/Ctrl+C → `kfSelected ? copyKeyframe() : copySelected()`; Cmd/Ctrl+V → `keyframeClipboard ? pasteKeyframe() : paste()`; Cmd/Ctrl+X → `kfSelected ? (no-op) : cut()`. Under the existing `isEditable` guard.
- Paste targets the COPIED keyframe's own object (cross-object paste deferred).
- Editor-only: NO persistence/render/runtime/migration change. Stays v4.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Store — `keyframeClipboard` + `copyKeyframe` / `pasteKeyframe`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `upsertKeyframe`, `upsertShapeKeyframe`, `upsertColorKeyframe`, `upsertGradientKeyframe`, `replaceObject`, `snapToFrame`, `KF_EPS`, the `selectXKeyframe` actions (all already in `store.ts`).
- Produces: state `keyframeClipboard: KeyframeClip | null`; actions `copyKeyframe(): void`, `pasteKeyframe(): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('copy/paste keyframes', () => {
  beforeEach(() => useEditor.setState({ keyframeClipboard: null, clipboard: null }));

  it('round-trips a scalar rotation keyframe (value + easing) to the playhead', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 45); // a rotation keyframe at t=0
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn'); // give it a non-linear easing
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().keyframeClipboard?.kind).toBe('scalar');
    const past = useEditor.getState().history.past.length;
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    const track = useEditor.getState().history.present.objects[0].tracks.rotation!;
    expect(track).toHaveLength(2);
    const pasted = track.find((k) => Math.abs(k.time - 1) < 1e-6)!;
    expect(pasted.value).toBe(45);
    expect(pasted.easing).toBe('easeIn');
    expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit
    expect(useEditor.getState().selectedKeyframe).toEqual({ objectId: id, property: 'rotation', time: 1 });
  });

  it('round-trips a color keyframe (hex value preserved)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setVectorColor('fill', '#abcdef');
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().keyframeClipboard?.kind).toBe('color');
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    const track = useEditor.getState().history.present.objects[0].colorTracks!.fill!;
    expect(track.find((k) => Math.abs(k.time - 1) < 1e-6)!.value).toBe('#abcdef');
  });

  it('round-trips a shape keyframe (path preserved)', () => {
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().addShapeKeyframe(); // a shape keyframe at the playhead
    useEditor.getState().seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().keyframeClipboard?.kind).toBe('shape');
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    const track = useEditor.getState().history.present.objects[0].shapeTrack!;
    expect(track.some((k) => Math.abs(k.time - 1) < 1e-6)).toBe(true);
  });

  it('copyKeyframe clears the object clipboard and vice versa (mutual exclusion)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().copySelected(); // object clipboard set
    expect(useEditor.getState().clipboard).not.toBeNull();
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 5);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().clipboard).toBeNull(); // object clipboard cleared
    expect(useEditor.getState().keyframeClipboard).not.toBeNull();
    useEditor.getState().copySelected();
    expect(useEditor.getState().keyframeClipboard).toBeNull(); // keyframe clipboard cleared
  });

  it('pasteKeyframe is a no-op with an empty clipboard', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().pasteKeyframe();
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "copy/paste keyframes"`
Expected: FAIL — `keyframeClipboard` / `copyKeyframe` / `pasteKeyframe` undefined.

- [ ] **Step 3: Add the `KeyframeClip` type + state field**

FIRST, add the three keyframe data types to the engine-types import block (only
`ShapeKeyframe` is currently imported; `AnimatableProperty`/`ColorProperty` already are).
Next to the existing `ShapeKeyframe,` import line, add:

```ts
  Keyframe,
  ColorKeyframe,
  GradientKeyframe,
```

Then, just ABOVE the `EditorState` actions+state interface (near the ref interfaces around
line 62–90), add the union:

```ts
export type KeyframeClip =
  | { kind: 'scalar'; objectId: string; property: AnimatableProperty; keyframe: Keyframe }
  | { kind: 'dash'; objectId: string; keyframe: Keyframe }
  | { kind: 'progress'; objectId: string; keyframe: Keyframe }
  | { kind: 'color'; objectId: string; property: ColorProperty; keyframe: ColorKeyframe }
  | { kind: 'gradient'; objectId: string; property: ColorProperty; keyframe: GradientKeyframe }
  | { kind: 'shape'; objectId: string; keyframe: ShapeKeyframe };
```

In the state interface, after `clipboard: { object: SceneObject; asset?: Asset } | null;`:

```ts
  keyframeClipboard: KeyframeClip | null;
```

In the initial state, after `clipboard: null as { object: SceneObject; asset?: Asset } | null,`:

```ts
  keyframeClipboard: null as KeyframeClip | null,
```

> `Keyframe`, `ColorKeyframe`, `GradientKeyframe`, `ShapeKeyframe` must be imported types
> in `store.ts`. `Keyframe` and the others are used by the existing actions; if any is not
> yet imported, add it to the engine-types import block.

- [ ] **Step 4: Add the `copyKeyframe`/`pasteKeyframe` interface entries + actions**

In the actions interface, after `paste(): void;`:

```ts
  copyKeyframe(): void;
  pasteKeyframe(): void;
```

Add `keyframeClipboard: null` to `copySelected`'s `set` (mutual exclusion):

```ts
    set({ clipboard: { object: obj, asset }, keyframeClipboard: null });
```

Add the two actions immediately after `paste()` in the store body:

```ts
  copyKeyframe() {
    const s = get();
    const p = s.history.present;
    const find = <K extends { time: number }>(track: K[] | undefined, time: number) =>
      track?.find((k) => Math.abs(k.time - time) < KF_EPS);
    if (s.selectedKeyframe) {
      const r = s.selectedKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.tracks[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'scalar', objectId: r.objectId, property: r.property, keyframe: kf }, clipboard: null });
      return;
    }
    if (s.selectedShapeKeyframe) {
      const r = s.selectedShapeKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.shapeTrack, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'shape', objectId: r.objectId, keyframe: kf }, clipboard: null });
      return;
    }
    if (s.selectedColorKeyframe) {
      const r = s.selectedColorKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.colorTracks?.[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'color', objectId: r.objectId, property: r.property, keyframe: kf }, clipboard: null });
      return;
    }
    if (s.selectedGradientKeyframe) {
      const r = s.selectedGradientKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.gradientTracks?.[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'gradient', objectId: r.objectId, property: r.property, keyframe: kf }, clipboard: null });
      return;
    }
    if (s.selectedDashKeyframe) {
      const r = s.selectedDashKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.dashOffsetTrack, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'dash', objectId: r.objectId, keyframe: kf }, clipboard: null });
      return;
    }
    if (s.selectedProgressKeyframe) {
      const r = s.selectedProgressKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.motionPath?.progress, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'progress', objectId: r.objectId, keyframe: kf }, clipboard: null });
      return;
    }
  },
  pasteKeyframe() {
    const clip = get().keyframeClipboard;
    if (!clip) return;
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === clip.objectId);
    if (!obj) return;
    const time = snapToFrame(get().time, project.meta.fps);
    switch (clip.kind) {
      case 'scalar': {
        const next = upsertKeyframe(obj.tracks[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [clip.property]: next } }));
        get().selectKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'dash': {
        const next = upsertKeyframe(obj.dashOffsetTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
        get().selectDashKeyframe({ objectId: obj.id, time });
        return;
      }
      case 'progress': {
        if (!obj.motionPath) return;
        const next = upsertKeyframe(obj.motionPath.progress, { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress: next } }));
        get().selectProgressKeyframe({ objectId: obj.id, time });
        return;
      }
      case 'color': {
        const next = upsertColorKeyframe(obj.colorTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [clip.property]: next } }));
        get().selectColorKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'gradient': {
        const next = upsertGradientKeyframe(obj.gradientTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, gradientTracks: { ...obj.gradientTracks, [clip.property]: next } }));
        get().selectGradientKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'shape': {
        const next = upsertShapeKeyframe(obj.shapeTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, shapeTrack: next }));
        get().selectShapeKeyframe({ objectId: obj.id, time });
        return;
      }
    }
  },
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "copy/paste keyframes"`
Expected: PASS (all 5).

- [ ] **Step 6: Full unit gate + commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green (the `keyframeClipboard`-survives-newProject behavior is reset per-test by the local `beforeEach`).

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice24): keyframeClipboard + copyKeyframe/pasteKeyframe (all 6 types)"
```

---

### Task 2: Keyboard routing + e2e

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/hooks/useKeyboard.test.ts`
- Create: `e2e/keyframe-clipboard.spec.ts`

**Interfaces:**
- Consumes: store `copyKeyframe`/`pasteKeyframe`/`keyframeClipboard` (Task 1); existing `copySelected`/`cut`/`paste`.

- [ ] **Step 1: Write the failing keyboard tests**

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('Cmd/Ctrl+C copies the SELECTED KEYFRAME (not the object) and Cmd/Ctrl+V pastes it', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null, keyframeClipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const id = useEditor.getState().selectedObjectId!;
  s.seek(0);
  s.setProperty('rotation', 30);
  s.selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
  fireEvent.keyDown(window, { key: 'c', metaKey: true });
  expect(useEditor.getState().keyframeClipboard?.kind).toBe('scalar');
  expect(useEditor.getState().clipboard).toBeNull(); // object NOT copied
  useEditor.getState().seek(1);
  fireEvent.keyDown(window, { key: 'v', metaKey: true });
  expect(useEditor.getState().history.present.objects[0].tracks.rotation).toHaveLength(2);
});

it('Cmd/Ctrl+C copies the OBJECT when no keyframe is selected', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null, keyframeClipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  fireEvent.keyDown(window, { key: 'c', metaKey: true });
  expect(useEditor.getState().clipboard).not.toBeNull(); // object copied
  expect(useEditor.getState().keyframeClipboard).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts -t "KEYFRAME\|OBJECT when no"`
Expected: FAIL — Cmd+C currently always copies the object (and bare nothing routes to the keyframe).

- [ ] **Step 3: Route the shortcuts by keyframe-priority**

In `src/ui/hooks/useKeyboard.ts`, REPLACE the three existing clipboard blocks (the
`mod && c`, `mod && x`, `mod && v` blocks added in Slice 21):

```ts
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        s.copySelected();
        return;
      }
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        s.cut();
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        s.paste();
        return;
      }
```

with (a keyframe-priority router):

```ts
      const kfSelected = !!(
        s.selectedKeyframe ||
        s.selectedShapeKeyframe ||
        s.selectedColorKeyframe ||
        s.selectedGradientKeyframe ||
        s.selectedDashKeyframe ||
        s.selectedProgressKeyframe
      );
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        if (kfSelected) s.copyKeyframe();
        else s.copySelected();
        return;
      }
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        if (!kfSelected) s.cut(); // cut-keyframe deferred: X is a no-op while a keyframe is selected
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        if (s.keyframeClipboard) s.pasteKeyframe();
        else s.paste();
        return;
      }
```

> `s` is the `useEditor.getState()` snapshot already captured at the top of the handler;
> reading the `selected*Keyframe` fields and `keyframeClipboard` off it is fine (a fresh
> snapshot is taken on each keydown).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: PASS (2 new + all existing keyboard tests, incl. the Slice-21 object copy/cut/paste).

- [ ] **Step 5: Write the e2e**

Create `e2e/keyframe-clipboard.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('copy a keyframe and paste it at a new time', async ({ page }) => {
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

  const rot = page.getByLabel('rotation', { exact: true });
  await rot.fill('40');
  await rot.blur();

  // Select the rotation keyframe diamond at t=0, copy it.
  const firstDiamond = page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first();
  await firstDiamond.click();
  await page.keyboard.press('ControlOrMeta+KeyC');

  // Move the playhead to t=1 (PX_PER_SECOND=100) and paste.
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await page.keyboard.press('ControlOrMeta+KeyV');

  // A second rotation keyframe now exists at t=1.
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(1);
});
```

- [ ] **Step 6: Run the e2e**

Run: `pnpm exec playwright test e2e/keyframe-clipboard.spec.ts`
Expected: PASS.

> If clicking the diamond doesn't land (it is small), use its exact testid:
> read the rect's object id is not needed — the `^="keyframe-"][data-testid$="-rotation-0"`
> attribute selector matches `keyframe-<id>-rotation-0` regardless of id. If the
> `ControlOrMeta+KeyC` doesn't fire because focus is on the diamond, that is fine — the
> keydown listener is on `window` and the diamond is an SVG element (not `isEditable`).

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts e2e/keyframe-clipboard.spec.ts
git commit -m "feat(slice24): Cmd/Ctrl+C/V keyframe-priority routing + e2e"
```

---

## Self-Review (plan vs spec)

- **§2 `keyframeClipboard` tagged union, transient, mutually exclusive** → Task 1 Step 3 + the mutual-exclusion test. ✅
- **§3 `copyKeyframe` (6-branch read) / `pasteKeyframe` (6-branch upsert + select; no autoKey gate; re-create absent track; progress needs motionPath)** → Task 1 Step 4 + scalar/color/shape round-trip tests + the no-op test. ✅
- **§4 keyboard routing (C/V by priority; X no-op on keyframe)** → Task 2 Step 3 + the 2 keyboard tests. ✅
- **§5 editor-only** → only store + useKeyboard + one e2e touched. ✅
- **§6 edges (paste replaces coincident; empty/missing no-op; mutual exclusion)** → the no-op + mutual-exclusion store tests; `upsert*` replace-by-time is inherent. ✅
- **§9 testing (store ×5 incl. 3 structural types; keyboard ×2; e2e)** → Tasks 1–2. ✅
- **Type/name consistency:** `KeyframeClip` kinds (scalar/dash/progress/color/gradient/shape) map 1:1 to the copy reads, the paste switch, and the select actions; `copyKeyframe`/`pasteKeyframe` names match interface + store + keyboard; `keyframeClipboard` field name consistent. The select actions (`selectKeyframe`/`selectDashKeyframe`/`selectProgressKeyframe`/`selectColorKeyframe`/`selectGradientKeyframe`/`selectShapeKeyframe`) all exist. ✅
- **Placeholder scan:** every step carries concrete code; the scalar test's duplicate `setSelectedKeyframeEasing` line is called out and corrected in Step 1's note; the e2e mirrors the proven export.spec ruler-click + Inspector-fill patterns. ✅
