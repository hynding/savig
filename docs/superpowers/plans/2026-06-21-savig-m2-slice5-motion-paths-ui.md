# Motion Paths — Plan B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author motion paths in the editor — draw a guide for the selected object, pace it with a progress track, toggle orient-to-path, edit/delete progress keyframes (with easing), and see the guide + followed position on the Stage — all exported via the Plan A engine.

**Architecture:** New store actions manage `motionPath` (add/remove/orient) and the progress track (auto-key upsert + selection), mirroring the existing color-keyframe plumbing. A new `'motion'` tool reuses the pen draft (`usePathTools`) but commits to `addMotionPath`. The Inspector gains a "Motion Path" section and routes progress-keyframe easing through `setSelectedKeyframeEasing`. The Timeline gains progress diamonds. The Stage renders the guide as editor-only chrome plus a followed-position marker.

**Tech Stack:** React 18 + TS (strict), Zustand, Vitest + React Testing Library, Playwright. CSS Modules + tokens. Depends on Plan A (`MotionPath` type, `motionPath` field, `pointAtFraction`/`tangentAngleDeg`, `sampleObject` override) being merged.

## Global Constraints

- **Plan A is a prerequisite.** `SceneObject.motionPath?: MotionPath` and `MotionPath { path; orient; progress }` exist; `sampleObject` already follows the guide. Plan B is UI/store only — no engine change.
- **One undo step per user gesture** (add/remove guide, toggle orient, set a progress value, edit a progress easing, delete a progress keyframe).
- **Optional field only** — no migration; absent `motionPath` is unchanged.
- **Selections are mutually exclusive** — selecting any keyframe/object clears the others (extend the existing pattern to `selectedProgressKeyframe`).
- **Guide coordinates are stage-space** — the pen draft's points are absolute stage coords; `addMotionPath` stores them as-is (no bbox normalization, unlike `addVectorPath`).
- **TDD**: failing test → minimal impl → green → commit.
- Run unit/RTL with `pnpm vitest run <path>`; e2e with `pnpm exec playwright test <path>`; gates `pnpm typecheck && pnpm lint && pnpm build`.

---

## File Structure

- `src/ui/store/store.ts` — MODIFY: `ProgressKeyframeRef`, `selectedProgressKeyframe`, `'motion'` ToolMode, actions `addMotionPath`/`removeMotionPath`/`setMotionPathOrient`/`setMotionProgress`/`selectProgressKeyframe`/`removeSelectedProgressKeyframe`; clear the new selection in the other `select*` actions; route `setSelectedKeyframeEasing` to the progress track.
- `src/ui/components/Stage/usePathTools.ts` — MODIFY: `finishPen` routes to `addMotionPath` in `'motion'` mode.
- `src/ui/components/Toolbar/ToolPalette.tsx` — MODIFY: "Motion Path" tool button.
- `src/ui/hooks/useKeyboard.ts` — MODIFY: Delete chain includes the progress keyframe; `m` shortcut for the motion tool.
- `src/ui/components/Inspector/Inspector.tsx` — MODIFY: "Motion Path" section + progress-keyframe easing branch in the Keyframe section.
- `src/ui/components/Timeline/Timeline.tsx` — MODIFY: progress-keyframe diamonds + selection.
- `src/ui/components/Stage/Stage.tsx` — MODIFY: render the guide overlay + followed-position marker.
- `src/ui/components/Timeline/Timeline.module.css`, `Stage.module.css` — MODIFY: `progressDiamond` / guide styles.
- Tests: `src/ui/store/store.test.ts`, `src/ui/components/Stage/usePathTools.test.tsx`, `src/ui/components/Inspector/Inspector.test.tsx`, `src/ui/components/Timeline/Timeline.test.tsx`, `src/ui/components/Stage/Stage.test.tsx`, `e2e/motion-path.spec.ts`.

---

## Task B1: Store — motion-path actions + progress selection

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes (Plan A): `MotionPath`, `SceneObject.motionPath`, `sampleObject`; (existing) `upsertKeyframe`, `createKeyframe`, `snapToFrame`, `removeKeyframeAt`.
- Produces: `interface ProgressKeyframeRef { objectId: string; time: number }`
- Produces: `selectedProgressKeyframe: ProgressKeyframeRef | null`
- Produces: `addMotionPath(objectId: string, path: PathData): void`
- Produces: `removeMotionPath(objectId: string): void`
- Produces: `setMotionPathOrient(objectId: string, orient: boolean): void`
- Produces: `setMotionProgress(value: number): void`
- Produces: `selectProgressKeyframe(ref: ProgressKeyframeRef | null): void`
- Produces: `removeSelectedProgressKeyframe(): void`
- Adds `'motion'` to `ToolMode`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/store/store.test.ts` (mirror the file's existing setup — it drives `useEditor.getState()`; reset via `setProject`/`newProject` as the file already does):

```ts
import type { PathData } from '../../engine';

describe('motion paths', () => {
  const guide: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false };

  function selectedObjId(): string {
    const s = useEditor.getState();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    return useEditor.getState().selectedObjectId!;
  }

  it('addMotionPath stores the guide with a seeded 0->1 progress track (one undo)', () => {
    useEditor.getState().newProject();
    const id = selectedObjId();
    const before = useEditor.getState().history.present;
    useEditor.getState().addMotionPath(id, guide);
    const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.motionPath!.path).toEqual(guide);
    expect(obj.motionPath!.orient).toBe(false);
    expect(obj.motionPath!.progress.map((k) => k.value)).toEqual([0, 1]);
    useEditor.getState().undo();
    expect(useEditor.getState().history.present).toBe(before);
  });

  it('setMotionPathOrient toggles orient', () => {
    useEditor.getState().newProject();
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.getState().setMotionPathOrient(id, true);
    expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.orient).toBe(true);
  });

  it('removeMotionPath clears the field', () => {
    useEditor.getState().newProject();
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.getState().removeMotionPath(id);
    expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath).toBeUndefined();
  });

  it('setMotionProgress upserts a progress keyframe at the snapped playhead (autoKey on)', () => {
    useEditor.getState().newProject();
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.setState({ time: 1, autoKey: true });
    useEditor.getState().setMotionProgress(0.25);
    const prog = useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.progress;
    expect(prog.find((k) => Math.abs(k.time - 1) < 1e-6)!.value).toBe(0.25);
  });

  it('selectProgressKeyframe clears other selections; removeSelectedProgressKeyframe deletes it', () => {
    useEditor.getState().newProject();
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.getState().selectProgressKeyframe({ objectId: id, time: 0 });
    expect(useEditor.getState().selectedKeyframe).toBeNull();
    expect(useEditor.getState().selectedColorKeyframe).toBeNull();
    useEditor.getState().removeSelectedProgressKeyframe();
    const prog = useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.progress;
    expect(prog.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false);
    expect(useEditor.getState().selectedProgressKeyframe).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — actions / `selectedProgressKeyframe` / `'motion'` not defined.

- [ ] **Step 3: Add the type, ToolMode, selection field, and interface members**

In `src/ui/store/store.ts`:

Extend `ToolMode`:

```ts
export type ToolMode = 'select' | 'pen' | 'node' | 'rect' | 'ellipse' | 'motion';
```

Add the ref type (near `ColorKeyframeRef`):

```ts
export interface ProgressKeyframeRef {
  objectId: string;
  time: number;
}
```

Add to `interface EditorState` (near `selectedColorKeyframe`):

```ts
  selectedProgressKeyframe: ProgressKeyframeRef | null;
```

Add to the actions list in `interface EditorState`:

```ts
  addMotionPath(objectId: string, path: PathData): void;
  removeMotionPath(objectId: string): void;
  setMotionPathOrient(objectId: string, orient: boolean): void;
  setMotionProgress(value: number): void;
  selectProgressKeyframe(ref: ProgressKeyframeRef | null): void;
  removeSelectedProgressKeyframe(): void;
```

Add to `TRANSIENT_DEFAULTS`:

```ts
  selectedProgressKeyframe: null as ProgressKeyframeRef | null,
```

- [ ] **Step 4: Implement the actions**

In the store body (after `removeSelectedColorKeyframe`), add:

```ts
  addMotionPath(objectId, path) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj) return;
    const t0 = snapToFrame(s.time, project.meta.fps);
    const t1 = snapToFrame(s.time + 1, project.meta.fps);
    const progress = [createKeyframe(t0, 0), createKeyframe(t1, 1)];
    get().commit(replaceObject(project, { ...obj, motionPath: { path, orient: false, progress } }));
  },
  removeMotionPath(objectId) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObject(project, { ...obj, motionPath: undefined }));
  },
  setMotionPathOrient(objectId, orient) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, orient } }));
  },
  setMotionProgress(value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj?.motionPath || !s.autoKey) return;
    const time = snapToFrame(s.time, project.meta.fps);
    const progress = upsertKeyframe(obj.motionPath.progress, createKeyframe(time, value));
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress } }));
  },
  selectProgressKeyframe(ref) {
    set({
      selectedProgressKeyframe: ref,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedColorKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId } : {}),
    });
  },
  removeSelectedProgressKeyframe() {
    const s = get();
    const ref = s.selectedProgressKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.motionPath) return;
    const progress = removeKeyframeAt(obj.motionPath.progress, ref.time);
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress } }));
    set({ selectedProgressKeyframe: null });
  },
```

- [ ] **Step 5: Clear the new selection in the other `select*` actions**

In `selectObject`, `selectKeyframe`, `selectShapeKeyframe`, `selectColorKeyframe`, add `selectedProgressKeyframe: null` to each `set({ … })`. (Match the existing keys; e.g. in `selectObject` add it alongside `selectedColorKeyframe: null`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(motion): store actions for motion path + progress track + selection"
```

---

## Task B2: Draw-guide tool (pen draft routes to `addMotionPath`)

**Files:**
- Modify: `src/ui/components/Stage/usePathTools.ts`
- Modify: `src/ui/components/Toolbar/ToolPalette.tsx`
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/components/Stage/usePathTools.test.tsx`

**Interfaces:**
- Consumes: `addMotionPath` (B1), `activeTool === 'motion'`, `selectedObjectId`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Stage/usePathTools.test.tsx` (mirror its existing render/harness; it already exercises `finishPen` → `addVectorPath`):

```ts
it('finishPen in motion mode commits the draft to the selected object as a motion path', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().setActiveTool('motion');
  // drive the hook's pen draft (use the same harness the other finishPen test uses)
  const tools = renderUsePathTools(); // existing helper in this test file
  tools.onPenPointerDown({ x: 0, y: 0 }, false);
  tools.onPenPointerDown({ x: 50, y: 0 }, false);
  tools.finishPen(false);
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.motionPath!.path.nodes.map((n) => n.anchor)).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
});
```

(If the test file uses a different harness name than `renderUsePathTools`, reuse whatever the existing `finishPen → addVectorPath` test uses — only the `setActiveTool('motion')` and `motionPath` assertion are new.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/usePathTools.test.tsx`
Expected: FAIL — `finishPen` always calls `addVectorPath`, so `motionPath` is undefined.

- [ ] **Step 3: Route `finishPen` by active tool**

In `src/ui/components/Stage/usePathTools.ts`, replace the body of `finishPen`'s commit:

```ts
  const finishPen = useCallback(
    (close: boolean) => {
      const d = draftRef.current;
      if (d && d.nodes.length >= 2) {
        const s = useEditor.getState();
        const path = { nodes: d.nodes, closed: close };
        if (s.activeTool === 'motion' && s.selectedObjectId) {
          s.addMotionPath(s.selectedObjectId, path);
        } else {
          s.addVectorPath(path);
        }
      }
      setDraft(null);
      setDragging(false);
      setDrafting(false);
    },
    [setDraft, setDrafting],
  );
```

- [ ] **Step 4: Add the tool button**

In `src/ui/components/Toolbar/ToolPalette.tsx`, add to `TOOLS`:

```ts
  { id: 'motion', label: 'Motion Path' },
```

- [ ] **Step 5: Add the keyboard shortcut**

In `src/ui/hooks/useKeyboard.ts`, in the `switch (e.key)`, after the `'e'` case:

```ts
        case 'm': case 'M': s.setActiveTool('motion'); break;
```

- [ ] **Step 6: Verify the Stage drives the motion tool like the pen**

Confirm the Stage's pointer routing treats `'motion'` the same as `'pen'` (so a draft is drawn). In `src/ui/components/Stage/Stage.tsx`, find where `activeTool === 'pen'` gates pen pointer handlers and broaden it to include `'motion'` (e.g. `const penLike = activeTool === 'pen' || activeTool === 'motion';` and use `penLike` for the pen pointer-down/move/up/finish wiring and the `pen-draft` preview render). Run the existing Stage tests to ensure no regression:

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (pen behavior unchanged; motion now drafts too).

- [ ] **Step 7: Run the hook test + gates**

Run: `pnpm vitest run src/ui/components/Stage/usePathTools.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Stage/usePathTools.ts src/ui/components/Toolbar/ToolPalette.tsx src/ui/hooks/useKeyboard.ts src/ui/components/Stage/usePathTools.test.tsx src/ui/components/Stage/Stage.tsx
git commit -m "feat(motion): Motion Path tool draws a guide for the selected object"
```

---

## Task B3: Inspector — "Motion Path" section

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `obj.motionPath`, `addMotionPath`/`removeMotionPath`/`setMotionPathOrient`/`setMotionProgress` (B1), `sampleObject` (for the followed-progress readout via `interpolate`).

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Inspector/Inspector.test.tsx` (mirror its setup — it renders `<Inspector />` after selecting an object):

```ts
it('shows the Motion Path section and toggles orient / removes the guide', async () => {
  const user = userEvent.setup();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });
  render(<Inspector />);

  const orient = screen.getByLabelText('orient to path');
  expect((orient as HTMLInputElement).checked).toBe(false);
  await user.click(orient);
  expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.orient).toBe(true);

  await user.click(screen.getByRole('button', { name: 'Remove motion path' }));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath).toBeUndefined();
});

it('offers "Draw motion path" when the selected object has no guide', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  render(<Inspector />);
  expect(screen.getByRole('button', { name: 'Draw motion path' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no Motion Path section.

- [ ] **Step 3: Add the section**

In `src/ui/components/Inspector/Inspector.tsx`, destructure the new actions from `useEditor.getState()`:

```ts
    addMotionPath,
    removeMotionPath,
    setMotionPathOrient,
    setMotionProgress,
    setActiveTool,
```

Add `import { interpolate } from '../../../engine';` (alongside the other engine imports). Then, after the Style block `</>` and before the `{kfEasing !== null && (` block, add:

```tsx
      <div className={styles.group}>Motion Path</div>
      {obj.motionPath ? (
        <>
          <div className={styles.row}>
            <label htmlFor="insp-orient">orient to path</label>
            <input
              id="insp-orient"
              aria-label="orient to path"
              type="checkbox"
              checked={obj.motionPath.orient}
              onChange={(e) => setMotionPathOrient(obj.id, e.target.checked)}
            />
          </div>
          <div className={styles.row}>
            progress: {round(obj.motionPath.progress.length ? interpolate(obj.motionPath.progress, time) : 0)}
          </div>
          <div className={styles.row}>
            <NumberField
              label="progress"
              value={round(obj.motionPath.progress.length ? interpolate(obj.motionPath.progress, snapToFrame(time, fps)) : 0)}
              step={0.05}
              disabled={!autoKey}
              onCommit={(n) => setMotionProgress(n)}
            />
            <button onClick={() => removeMotionPath(obj.id)}>Remove motion path</button>
          </div>
        </>
      ) : (
        <div className={styles.row}>
          <button onClick={() => setActiveTool('motion')}>Draw motion path</button>
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(motion): Inspector Motion Path section (orient, progress, draw/remove)"
```

---

## Task B4: Timeline — progress-keyframe lane

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`
- Modify: `src/ui/components/Timeline/Timeline.module.css`
- Test: `src/ui/components/Timeline/Timeline.test.tsx`

**Interfaces:**
- Consumes: `obj.motionPath.progress`, `selectedProgressKeyframe`, `selectProgressKeyframe` (B1).

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Timeline/Timeline.test.tsx` (mirror its setup):

```ts
it('renders progress keyframes and selects one on click', async () => {
  const user = userEvent.setup();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });
  render(<Timeline />);
  const diamond = screen.getByTestId(`progress-keyframe-${id}-0`);
  await user.pointer({ keys: '[MouseLeft>]', target: diamond });
  expect(useEditor.getState().selectedProgressKeyframe).toEqual({ objectId: id, time: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx`
Expected: FAIL — no progress diamonds.

- [ ] **Step 3: Render progress diamonds**

In `src/ui/components/Timeline/Timeline.tsx`, add `selectedProgressKeyframe` to the subscriptions and `selectProgressKeyframe` to the destructured actions:

```ts
  const selectedProgressKeyframe = useEditor((s) => s.selectedProgressKeyframe);
```
```ts
  const { seek, selectObject, selectKeyframe, selectShapeKeyframe, selectColorKeyframe, selectProgressKeyframe, toggleAutoKey } =
    useEditor.getState();
```

Inside the object's `<div className={styles.lane}>`, after the color-keyframe block, add:

```tsx
                {(obj.motionPath?.progress ?? []).map((kf) => {
                  const isSel =
                    selectedProgressKeyframe?.objectId === obj.id && selectedProgressKeyframe.time === kf.time;
                  return (
                    <div
                      key={`progress-${kf.time}`}
                      className={`${styles.diamond} ${styles.progressDiamond} ${isSel ? styles.diamondSelected : ''}`}
                      data-testid={`progress-keyframe-${obj.id}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        selectProgressKeyframe({ objectId: obj.id, time: kf.time });
                      }}
                    />
                  );
                })}
```

- [ ] **Step 4: Add a distinct style**

In `src/ui/components/Timeline/Timeline.module.css`, mirroring `.colorDiamond` (a distinct color so progress diamonds read differently — e.g. a token accent):

```css
.progressDiamond {
  background: var(--color-accent-2, #6cf);
}
```

(If `--color-accent-2` is not defined in `tokens.css`, use an existing token distinct from the shape/color diamonds — check `Timeline.module.css` for what `.colorDiamond`/`.shapeDiamond` use and pick a different one.)

- [ ] **Step 5: Run test to verify it passes + gates**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Timeline/Timeline.tsx src/ui/components/Timeline/Timeline.module.css src/ui/components/Timeline/Timeline.test.tsx
git commit -m "feat(motion): timeline progress-keyframe lane + selection"
```

---

## Task B5: Progress-keyframe easing + context-aware Delete

**Files:**
- Modify: `src/ui/store/store.ts` (`setSelectedKeyframeEasing` routes to the progress track)
- Modify: `src/ui/hooks/useKeyboard.ts` (Delete chain)
- Modify: `src/ui/components/Inspector/Inspector.tsx` (Keyframe section resolves the progress keyframe)
- Test: `src/ui/store/store.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `selectedProgressKeyframe`, `motionPath.progress` (B1).

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/store/store.test.ts`:

```ts
it('setSelectedKeyframeEasing routes to the selected progress keyframe', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });
  useEditor.getState().selectProgressKeyframe({ objectId: id, time: 0 });
  useEditor.getState().setSelectedKeyframeEasing('easeIn');
  const prog = useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.progress;
  expect(prog.find((k) => Math.abs(k.time - 0) < 1e-6)!.easing).toBe('easeIn');
});
```

Add to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('shows the easing editor for a selected progress keyframe', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });
  useEditor.getState().selectProgressKeyframe({ objectId: id, time: 0 });
  render(<Inspector />);
  expect(screen.getByText(/progress @ 0s/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — easing routing/section not present.

- [ ] **Step 3: Route easing to the progress track**

In `src/ui/store/store.ts`, at the top of `setSelectedKeyframeEasing` (before the `selectedColorKeyframe` branch):

```ts
    if (s.selectedProgressKeyframe) {
      const ref = s.selectedProgressKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      if (!obj?.motionPath) return;
      const progress = obj.motionPath.progress.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress } }));
      return;
    }
```

- [ ] **Step 4: Add the progress branch to the Inspector Keyframe section**

In `src/ui/components/Inspector/Inspector.tsx`, subscribe to the selection:

```ts
  const selectedProgressKeyframe = useEditor((s) => s.selectedProgressKeyframe);
```

In the keyframe-resolution `if/else` chain (before the `selectedColorKeyframe` branch), add:

```ts
  if (selectedProgressKeyframe && selectedProgressKeyframe.objectId === obj.id && obj.motionPath) {
    const track = obj.motionPath.progress;
    const idx = track.findIndex((k) => Math.abs(k.time - selectedProgressKeyframe.time) < KF_EPS);
    if (idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `progress @ ${round(track[idx].time)}s`;
      kfInert = idx === track.length - 1;
    }
  } else if (selectedColorKeyframe && /* …existing… */) {
```

(Convert the existing leading `if (selectedColorKeyframe …)` to `else if` so the chain stays mutually exclusive.)

- [ ] **Step 5: Add the progress keyframe to the Delete chain**

In `src/ui/hooks/useKeyboard.ts`, in the Delete/Backspace case, add a branch (before `removeSelectedKeyframe`):

```ts
          if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
          else if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
          else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
          else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
          else s.removeSelectedKeyframe();
```

- [ ] **Step 6: Run tests to verify they pass + gates**

Run: `pnpm vitest run src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/hooks/useKeyboard.ts src/ui/components/Inspector/Inspector.tsx src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(motion): progress-keyframe easing routing + context-aware Delete"
```

---

## Task B6: Stage — guide overlay + followed marker

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Modify: `src/ui/components/Stage/Stage.module.css`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `selectSelectedObject` (existing selector), `obj.motionPath`, `pathToD` + `sampleObject` (engine), `time`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Stage/Stage.test.tsx` (mirror its render harness):

```ts
it('renders the motion guide overlay and a followed-position marker for the selected object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });
  render(<Stage />);
  expect(screen.getByTestId('motion-guide')).toBeInTheDocument();
  expect(screen.getByTestId('motion-marker')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — no `motion-guide`.

- [ ] **Step 3: Render the overlay**

In `src/ui/components/Stage/Stage.tsx`, import `pathToD` and `sampleObject` from `../../../engine` (if not already imported), select the object and time, and render the overlay as a top-level group in stage coordinates (NO per-object transform — the guide is stored in stage space). Place it near the other overlays (e.g. after the `node-overlay` group), guarded on the selected object having a `motionPath`:

```tsx
{(() => {
  const sel = useEditor.getState().history.present.objects.find((o) => o.id === selectedObjectId);
  if (!sel?.motionPath) return null;
  const mp = sel.motionPath;
  const followed = sampleObject(sel, time); // x/y already on the guide via Plan A
  return (
    <g data-testid="motion-guide" pointerEvents="none">
      <path
        d={pathToD(mp.path)}
        fill="none"
        stroke="var(--color-accent)"
        strokeDasharray="4 3"
      />
      <circle data-testid="motion-marker" cx={followed.x} cy={followed.y} r={4} fill="var(--color-accent)" />
    </g>
  );
})()}
```

(Use the same `time` and `selectedObjectId` subscriptions already present in `Stage.tsx`; if `time` is not yet subscribed, add `const time = useEditor((s) => s.time);` near the other subscriptions.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.module.css src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(motion): Stage guide overlay + followed-position marker"
```

---

## Task B7: e2e — author a motion path and verify export animates

**Files:**
- Create: `e2e/motion-path.spec.ts`
- Test: itself

**Interfaces:**
- Consumes: the full feature; mirrors `e2e/color-animation.spec.ts` and `e2e/draw-path.spec.ts` structure (open app → draw → export → assert on the exported bundle).

- [ ] **Step 1: Write the e2e test**

Create `e2e/motion-path.spec.ts`, mirroring `e2e/color-animation.spec.ts` (reuse its app-bootstrap, draw, and export-bundle-loading helpers — same import/setup):

```ts
import { test, expect } from '@playwright/test';
// mirror color-animation.spec.ts's setup helpers (page goto, draw a rect, export, load bundle)

test('a vector object follows an exported motion path', async ({ page }) => {
  await page.goto('/');
  // 1. draw a rectangle (reuse the rect-tool helper as in draw-vector.spec.ts)
  // 2. select it; activate the Motion Path tool (button "Motion Path")
  await page.getByRole('button', { name: 'Motion Path' }).click();
  // 3. draw a 2-point guide on the stage (pointer down at two stage points, then commit
  //    the pen draft the same way draw-path.spec.ts commits — e.g. Enter/double-click)
  // 4. export (reuse the export helper) and load the bundle headless
  // 5. assert the object's wrapper transform translate changes between t≈0 and t≈end,
  //    i.e. the object moves along the guide (read the <g data-savig-object> transform
  //    at two times by driving the runtime clock, as color-animation.spec.ts reads fill).
  // Concrete assertions follow color-animation.spec.ts's pattern of sampling the
  // exported runtime at two times and comparing the animated attribute.
});
```

Fill the steps in concretely against the actual helpers in `e2e/color-animation.spec.ts` / `e2e/draw-path.spec.ts` (those files define the reusable draw/export/bundle-sampling utilities this spec should call — do not invent new ones).

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/motion-path.spec.ts`
Expected: PASS — the exported bundle moves the object along the guide over time.

- [ ] **Step 3: Full gate**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build && pnpm exec playwright test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/motion-path.spec.ts
git commit -m "test(e2e): motion path authored in editor animates in the exported bundle"
```

---

## Plan B — Self-review checklist

- Add/remove guide, toggle orient, set progress, edit easing, delete progress kf — each one undo step? ✓ B1/B3/B5 (all single `commit`).
- Selections mutually exclusive (progress clears others & vice-versa)? ✓ B1 Step 5 + `selectProgressKeyframe`.
- Draw-guide reuses the pen draft, commits stage-space coords to the selected object? ✓ B2 (`addMotionPath`, no bbox normalize).
- Progress easing routes correctly; Delete chain prioritizes the progress kf? ✓ B5.
- Guide overlay is editor-only (never exported)? ✓ B6 renders in Stage chrome, not in `renderDocument`/export.
- e2e proves export parity (object moves in the bundle)? ✓ B7.
- No engine change in Plan B? ✓ all changes under `src/ui/` + `e2e/`.
```
