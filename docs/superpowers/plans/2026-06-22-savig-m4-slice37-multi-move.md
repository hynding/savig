# Slice 37 — M4 Multi-object move — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dragging a member of a multi-selection moves all selected together (one commit); arrows nudge all selected; selection outlines follow the drag.

**Architecture:** `nudgeSelected` becomes a bulk relative move (one commit over `selectedObjectIds`). The Stage move-drag gains a multi mode that previews all selected and commits via `nudgeSelected(dx, dy)` on release; a shared `dragOffset` shifts the selection outlines during any move-drag. Single-object drag (with snapping) is untouched.

**Tech Stack:** Zustand, React + RTL, Playwright.

## Global Constraints

- Editor-only: NO engine/export/runtime/persistence change (v4).
- Single-object behavior (drag + snap, arrow-nudge of one object) stays byte-identical.
- Multi-drag = ONE undo step. No snapping while >1 is being dragged.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Bulk `nudgeSelected`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

- [ ] **Step 1: Write the failing tests** — append to the `multi-select (slice 36)` describe (or a new `multi-move` describe) in `store.test.ts`:

```ts
describe('multi-move (slice 37)', () => {
  function twoRects() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 40, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    return { a, b };
  }
  const xy = (id: string) => {
    const o = useEditor.getState().history.present.objects.find((p) => p.id === id)!;
    const s = sampleObject(o, 0);
    return { x: s.x, y: s.y };
  };

  it('nudgeSelected moves ALL selected by the delta in one commit', () => {
    const { a, b } = twoRects();
    const a0 = xy(a);
    const b0 = xy(b);
    useEditor.getState().selectObjects([a, b]);
    const pastBefore = useEditor.getState().history.past.length;
    useEditor.getState().nudgeSelected(5, -3);
    expect(xy(a)).toEqual({ x: a0.x + 5, y: a0.y - 3 });
    expect(xy(b)).toEqual({ x: b0.x + 5, y: b0.y - 3 });
    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1); // one undo step
    useEditor.getState().undo();
    expect(xy(a)).toEqual(a0);
    expect(xy(b)).toEqual(b0);
  });

  it('nudgeSelected skips a locked member', () => {
    const { a, b } = twoRects();
    const b0 = xy(b);
    useEditor.getState().toggleObjectLock(b); // also drops b from selection -> re-select both
    useEditor.getState().selectObjects([a, b]);
    const a0 = xy(a);
    useEditor.getState().nudgeSelected(7, 0);
    expect(xy(a)).toEqual({ x: a0.x + 7, y: a0.y });
    expect(xy(b)).toEqual(b0); // locked b did not move
  });

  it('single selection nudge is unchanged (one object, one undo step)', () => {
    const { a } = twoRects();
    const a0 = xy(a);
    useEditor.getState().selectObject(a);
    useEditor.getState().nudgeSelected(2, 2);
    expect(xy(a)).toEqual({ x: a0.x + 2, y: a0.y + 2 });
  });
});
```

(Ensure `sampleObject` is imported in `store.test.ts` — it already is.)

- [ ] **Step 2: Run to verify fail** — `pnpm vitest run src/ui/store/store.test.ts` → the bulk + locked-skip tests FAIL (old nudge moves only the primary).

- [ ] **Step 3: Implement** — replace `nudgeSelected`:

```ts
nudgeSelected(dx, dy) {
  if (!dx && !dy) return;
  const s = get();
  if (!s.autoKey) return;
  const project = s.history.present;
  const time = snapToFrame(s.time, project.meta.fps);
  let objects = project.objects;
  let changed = false;
  for (const id of s.selectedObjectIds) {
    const obj = objects.find((o) => o.id === id);
    if (!obj || obj.locked) continue;
    const state = sampleObject(obj, time);
    const tracks = { ...obj.tracks };
    if (dx) tracks.x = upsertKeyframe(obj.tracks.x ?? [], createKeyframe(time, state.x + dx));
    if (dy) tracks.y = upsertKeyframe(obj.tracks.y ?? [], createKeyframe(time, state.y + dy));
    objects = objects.map((o) => (o.id === id ? { ...obj, tracks } : o));
    changed = true;
  }
  if (changed) get().commit({ ...project, objects });
},
```

(`upsertKeyframe`/`createKeyframe`/`sampleObject`/`snapToFrame` are already imported/used by `setProperties`.)

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/ui/store/store.test.ts` → PASS (incl. the pre-existing single-nudge "diagonal nudge is one undo step" test).

- [ ] **Step 5: Commit**
```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice37): nudgeSelected moves the whole selection in one commit"
```

---

### Task 2: Stage multi-drag + outline-follow

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

- [ ] **Step 1: DragState + dragOffset** — extend the `DragState` interface with `multi?: { items: { id: string; ox: number; oy: number }[]; dx: number; dy: number }`. Add `const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);` near `snapGuides`.

- [ ] **Step 2: onObjectPointerDown multi branch** — after the Shift/Cmd toggle branch:
```ts
const ids = useEditor.getState().selectedObjectIds;
const multi = ids.includes(id) && ids.length > 1;
if (!multi) selectObject(id); // collapse to single (existing path)
if (!useEditor.getState().autoKey) return;
const proj = useEditor.getState().history.present;
const t = useEditor.getState().time;
if (multi) {
  const items = ids
    .map((sid) => proj.objects.find((o) => o.id === sid))
    .filter((o): o is SceneObject => !!o && !o.locked)
    .map((o) => { const s = sampleObject(o, t); return { id: o.id, ox: s.x, oy: s.y }; });
  dragRef.current = { id, startX: e.clientX, startY: e.clientY, originX: 0, originY: 0, curX: 0, curY: 0, moved: false, baseAABB: null, targets: [], multi: { items, dx: 0, dy: 0 } };
  return;
}
// ... existing single-object dragRef setup (origin, targets, baseAABB) ...
```

- [ ] **Step 3: onMove multi branch** — at the top of the `const d = dragRef.current` move handling:
```ts
if (d.multi) {
  const z = useEditor.getState().zoom ?? 1;
  const dx = (e.clientX - d.startX) / z;
  const dy = (e.clientY - d.startY) / z;
  d.multi.dx = dx; d.multi.dy = dy; d.moved = true;
  const proj = useEditor.getState().history.present;
  const time = useEditor.getState().time;
  for (const it of d.multi.items) {
    const obj = proj.objects.find((o) => o.id === it.id);
    const node = nodes.get(it.id);
    if (!obj || !node) continue;
    const sampled = sampleObject(obj, time);
    const resolved = resolveObjectAnchor(obj, proj.assets.find((a) => a.id === obj.assetId), sampled);
    const ax = resolved ? resolved.anchorX : obj.anchorX;
    const ay = resolved ? resolved.anchorY : obj.anchorY;
    node.setAttribute('transform', buildTransform({ ...sampled, x: it.ox + dx, y: it.oy + dy }, ax, ay));
  }
  setDragOffset({ dx, dy });
  setSnapGuides({ x: null, y: null });
  return;
}
```
And in the SINGLE move branch, after computing `d.curX/d.curY`, add `setDragOffset({ dx: d.curX - d.originX, dy: d.curY - d.originY });`.

- [ ] **Step 4: onUp multi branch + clear** — in the move-drag onUp section:
```ts
const d = dragRef.current;
if (d?.multi) {
  if (d.moved) useEditor.getState().nudgeSelected(d.multi.dx, d.multi.dy);
} else if (d && d.moved) {
  useEditor.getState().selectObject(d.id);
  useEditor.getState().setProperties({ x: d.curX, y: d.curY });
}
if (d) { setSnapGuides({ x: null, y: null }); setDragOffset(null); }
dragRef.current = null;
panRef.current = null;
```

- [ ] **Step 5: Outline render uses dragOffset** — the selection-outline `<rect>` x/y become `a.minX + (dragOffset?.dx ?? 0)` and `a.minY + (dragOffset?.dy ?? 0)`.

- [ ] **Step 6: Stage test** — append to `Stage.test.tsx`:
```ts
it('dragging one object of a multi-selection moves them all (one undo step)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const xy = (id: string) => { const o = useEditor.getState().history.present.objects.find((p) => p.id === id)!; const s = sampleObject(o, 0); return { x: s.x, y: s.y }; };
  const a0 = xy(a); const b0 = xy(b);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  const { container } = render(<Stage nodes={nodes} />);
  const elA = container.querySelector(`[data-savig-object="${a}"]`)!;
  fireEvent.pointerDown(elA, { clientX: 10, clientY: 10, button: 0 }); // plain click on a SELECTED member -> multi-drag
  fireEvent.pointerMove(window, { clientX: 40, clientY: 30 }); // delta (30, 20)
  const past = useEditor.getState().history.past.length;
  fireEvent.pointerUp(window, { clientX: 40, clientY: 30 });
  expect(xy(a)).toEqual({ x: a0.x + 30, y: a0.y + 20 });
  expect(xy(b)).toEqual({ x: b0.x + 30, y: b0.y + 20 });
  expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit for the whole move
});
```
Run it.

- [ ] **Step 7: Commit**
```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice37): Stage multi-drag moves the selection together + outline-follow"
```

---

### Task 3: e2e + full gate

- [ ] **Step 1: e2e** — `e2e/multi-move.spec.ts`: draw two rects, Shift-click both selected, drag one by a known screen delta, assert BOTH objects' `[data-savig-object]` bounding boxes shifted by ~the same amount. (Measure the screen→content ratio with a probe move like the snapping e2e, OR simply assert both moved in the same direction by a similar amount.)

- [ ] **Step 2: Run e2e** — `pnpm exec playwright test e2e/multi-move.spec.ts` → PASS.

- [ ] **Step 3: Full gate + commit**
```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add -A
git commit -m "test(slice37): multi-move e2e (drag one of two selected, both move)"
```

---

## Self-Review (post-write)

- **Spec coverage:** §2 nudge → T1; §2 drag + §5 Stage → T2; e2e → T3.
- **Type consistency:** `DragState.multi`, `dragOffset`, `nudgeSelected(dx, dy)` consistent.
- **No placeholders:** T1 full store code + hand-verified (two objects advance by delta, one undo step, locked skipped); T2 references the existing drag machine; e2e asserts both-move.
- **Single-object preserved:** the single drag path + snap is untouched (multi is a separate `d.multi` branch); single arrow-nudge = bulk-of-one.
- **One undo step:** multi-drag commits once via `nudgeSelected`; the Stage test asserts `past + 1`.
