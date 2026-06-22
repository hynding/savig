# Slice 41 — M4 Multi-object rotate (group rotate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rotate handle above the group bbox rotates the whole multi-selection about the group center (one undo step).

**Architecture:** Generalize `setObjectsTransforms` to optional fields (+ rotation); a `groupRotateRef` drag in the Stage applies the artboard-space rotate-about-center math (reusing slice-40's `groupBounds`, gating, commit trick). Editor-only.

**Tech Stack:** Zustand, React + RTL, Playwright.

## Global Constraints

- Editor-only: NO engine/export/runtime/persistence change (v4).
- Slice-40 group SCALE behavior unchanged (the generalized `setObjectsTransforms` still upserts all 4 when provided).
- Group rotate = ONE undo step; locked/hidden members excluded.
- Drag reads store via `getState()` + origins from the ref; `setPointerCapture` on down (slice 38/40 lessons).
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Generalize `setObjectsTransforms` (+ rotation)

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

- [ ] **Step 1: Test** — append to the `multi-move (slice 37)` describe (next to the slice-40 test):
```ts
it('setObjectsTransforms upserts x/y/rotation only (scale untouched) in one commit (slice 41)', () => {
  const { a } = twoRects();
  const past = useEditor.getState().history.past.length;
  useEditor.getState().setObjectsTransforms([{ id: a, x: 7, y: 8, rotation: 90 }]);
  const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
  expect({ x: sa.x, y: sa.y, rot: sa.rotation }).toEqual({ x: 7, y: 8, rot: 90 });
  expect(sa.scaleX).toBe(1); // scale not written
  expect(useEditor.getState().history.past.length).toBe(past + 1);
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm vitest run src/ui/store/store.test.ts` → FAIL (rotation not in the type / not upserted).

- [ ] **Step 3: Implement** — change the interface signature to optional fields:
```ts
setObjectsTransforms(updates: { id: string; x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number }[]): void;
```
and the body to upsert only the present keys:
```ts
setObjectsTransforms(updates) {
  const s = get();
  if (!s.autoKey || updates.length === 0) return;
  const project = s.history.present;
  const time = snapToFrame(s.time, project.meta.fps);
  let objects = project.objects;
  let changed = false;
  for (const u of updates) {
    const obj = objects.find((o) => o.id === u.id);
    if (!obj || obj.locked) continue;
    const tracks = { ...obj.tracks };
    if (u.x !== undefined) tracks.x = upsertKeyframe(obj.tracks.x ?? [], createKeyframe(time, u.x));
    if (u.y !== undefined) tracks.y = upsertKeyframe(obj.tracks.y ?? [], createKeyframe(time, u.y));
    if (u.scaleX !== undefined) tracks.scaleX = upsertKeyframe(obj.tracks.scaleX ?? [], createKeyframe(time, u.scaleX));
    if (u.scaleY !== undefined) tracks.scaleY = upsertKeyframe(obj.tracks.scaleY ?? [], createKeyframe(time, u.scaleY));
    if (u.rotation !== undefined) tracks.rotation = upsertKeyframe(obj.tracks.rotation ?? [], createKeyframe(time, u.rotation));
    objects = objects.map((o) => (o.id === u.id ? { ...obj, tracks } : o));
    changed = true;
  }
  if (changed) get().commit({ ...project, objects });
},
```

- [ ] **Step 4: Run** — `pnpm vitest run src/ui/store/store.test.ts` → PASS (new test + the slice-40 scale test still green).

- [ ] **Step 5: Commit**
```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice41): generalize setObjectsTransforms to optional fields (+ rotation)"
```

---

### Task 2: Stage group rotate handle + drag

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

- [ ] **Step 1: groupRotateRef + handler** — add:
```ts
const groupRotateRef = useRef<{ center: { x: number; y: number }; start: { x: number; y: number }; items: { id: string; ox: number; oy: number; orot: number; ax: number; ay: number }[]; theta: number; moved: boolean } | null>(null);
```
and (near `onGroupHandlePointerDown`):
```ts
const onGroupRotatePointerDown = (e: ReactPointerEvent) => {
  e.stopPropagation();
  (e.target as Element).setPointerCapture?.(e.pointerId);
  if (!groupBounds || !useEditor.getState().autoKey) return;
  const start = clientToLocal(e.clientX, e.clientY);
  if (!start) return;
  const center = { x: (groupBounds.minX + groupBounds.maxX) / 2, y: (groupBounds.minY + groupBounds.maxY) / 2 };
  const proj = useEditor.getState().history.present;
  const t = useEditor.getState().time;
  const items = selectedIds
    .map((id) => proj.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o && !o.locked && !o.hidden)
    .map((o) => {
      const st = sampleObject(o, t);
      const r = resolveObjectAnchor(o, proj.assets.find((a) => a.id === o.assetId), st);
      return { id: o.id, ox: st.x, oy: st.y, orot: st.rotation, ax: r ? r.anchorX : o.anchorX, ay: r ? r.anchorY : o.anchorY };
    });
  groupRotateRef.current = { center, start, items, theta: 0, moved: false };
};
```

- [ ] **Step 2: onMove group-rotate branch** — after the group-SCALE branch (both early-return):
```ts
const gr = groupRotateRef.current;
if (gr) {
  const cur = clientToLocal(e.clientX, e.clientY);
  if (!cur) return;
  const theta = rotationFromDrag(gr.center, gr.start, cur, 0); // degrees
  gr.theta = theta; gr.moved = true;
  const rad = (theta * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const proj = useEditor.getState().history.present;
  const time = useEditor.getState().time;
  for (const it of gr.items) {
    const node = nodes.get(it.id);
    const obj = proj.objects.find((o) => o.id === it.id);
    if (!node || !obj) continue;
    const dx = it.ax + it.ox - gr.center.x, dy = it.ay + it.oy - gr.center.y; // anchor point - centre
    const nx = gr.center.x + (c * dx - s * dy) - it.ax;
    const ny = gr.center.y + (s * dx + c * dy) - it.ay;
    const sampled = sampleObject(obj, time);
    node.setAttribute('transform', buildTransform({ ...sampled, x: nx, y: ny, rotation: it.orot + theta }, it.ax, it.ay));
  }
  return;
}
```
(import `rotationFromDrag` — already imported.)

- [ ] **Step 3: onUp group-rotate branch** — after the group-SCALE branch:
```ts
const grUp = groupRotateRef.current;
if (grUp) {
  groupRotateRef.current = null;
  if (grUp.moved) {
    const rad = (grUp.theta * Math.PI) / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    const updates = grUp.items.map((it) => {
      const dx = it.ax + it.ox - grUp.center.x, dy = it.ay + it.oy - grUp.center.y;
      return { id: it.id, x: grUp.center.x + (c * dx - s * dy) - it.ax, y: grUp.center.y + (s * dx + c * dy) - it.ay, rotation: it.orot + grUp.theta };
    });
    useEditor.getState().setObjectsTransforms(updates);
  }
  return;
}
```

- [ ] **Step 4: Render the rotate handle** — inside the `group-handles` `<g>` (slice 40), add a connector + circle above the bbox top-center:
```tsx
{(() => {
  const cx = (groupBounds.minX + groupBounds.maxX) / 2;
  const hy = groupBounds.minY - ROTATE_STALK / zoom;
  return (
    <g>
      <line x1={cx} y1={groupBounds.minY} x2={cx} y2={hy} stroke="var(--color-accent)" strokeWidth={1 / zoom} pointerEvents="none" />
      <circle data-testid="group-rotate-handle" cx={cx} cy={hy} r={5 / zoom} fill="var(--color-accent)" onPointerDown={onGroupRotatePointerDown} />
    </g>
  );
})()}
```

- [ ] **Step 5: Stage test** — append to `Stage.test.tsx`:
```ts
it('dragging the group rotate handle rotates the whole selection about the group centre', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 }); // a, AABB 0..40
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 }); // b, AABB 100..140
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  render(<Stage nodes={nodes} />);
  // group centre (70,20); handle straight up from centre. start angle -90deg, drag to the right -> theta=90.
  const h = screen.getByTestId('group-rotate-handle');
  fireEvent.pointerDown(h, { clientX: 70, clientY: 20 - 24, button: 0 }); // start above centre
  fireEvent.pointerMove(window, { clientX: 170, clientY: 20 }); // to the right of centre -> +90deg
  fireEvent.pointerUp(window, { clientX: 170, clientY: 20 });
  const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
  const sb = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === b)!, 0);
  // R(90) about (70,20): a anchor (20,20) -> (70,-30) -> base (50,-50); b (120,20) -> (70,70) -> base (50,50).
  expect(sa.rotation).toBeCloseTo(90);
  expect({ x: sa.x, y: sa.y }).toEqual({ x: expect.closeTo(50), y: expect.closeTo(-50) });
  expect(sb.rotation).toBeCloseTo(90);
  expect({ x: sb.x, y: sb.y }).toEqual({ x: expect.closeTo(50), y: expect.closeTo(50) });
});
```
(If `expect.closeTo` in an object isn't available, assert each with `toBeCloseTo` separately.) Run it.

- [ ] **Step 6: Commit**
```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice41): group rotate handle rotates the whole selection about its centre"
```

---

### Task 3: e2e + full gate

- [ ] **Step 1: e2e** — `e2e/group-rotate.spec.ts`: draw two rects, Shift-select both, drag the `group-rotate-handle` sideways; assert each `[data-savig-object]` transform now contains `rotate(` (or that the bounding boxes changed). Avoid starting on an object.

- [ ] **Step 2: Run e2e + full gate + commit**
```bash
pnpm exec playwright test e2e/group-rotate.spec.ts
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add -A
git commit -m "test(slice41): group-rotate e2e (both objects gain rotation)"
```

---

## Self-Review (post-write)

- **Spec coverage:** §2 math → T1 store + T2 Stage; §3 handle/drag → T2; e2e → T3.
- **Type consistency:** optional `setObjectsTransforms` fields; `groupRotateRef`/`onGroupRotatePointerDown` consistent; reuse `rotationFromDrag`/`ROTATE_STALK`/`resolveObjectAnchor`/`buildTransform`.
- **No placeholders:** T1 full code; T2 hand-verified vectors (R(90) about (70,20) → a base (50,−50), b base (50,50), rot 90).
- **Units:** `rotationFromDrag` deg → `R(θ)` uses rad; `rotation += θ` deg.
- **Slice-40 unchanged:** the scale caller passes all 4 → still upserted; the gating + groupBounds reused.
- **Stale closures / capture:** drag reads `getState()` + ref origins; `setPointerCapture` on down.
