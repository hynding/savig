# Slice 40 — M4 Multi-object scale (group resize) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With >1 object selected, a group bbox + 8 handles scale the whole selection about the opposite corner/edge (one undo step); single-object overlays hide.

**Architecture:** Pure `groupBBox` union; a generic store `setObjectsTransforms` commit; the Stage owns the per-object scale-about-pivot math (`resolveObjectAnchor`) and the group-handle drag. Editor-only.

**Tech Stack:** Zustand, React + RTL, Playwright.

## Global Constraints

- Editor-only: NO engine/export/runtime/persistence change (v4).
- Single-object scale/resize/rotate behavior unchanged (gated to `selectedObjectIds.length === 1`).
- Group scale = ONE undo step; locked members excluded; per-object scale clamped ≥ `MIN_SCALE`.
- Window-listener drag reads store via `getState()` + per-object origins from the ref (slice 38 lesson).
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Pure `groupBBox` + store `setObjectsTransforms`

**Files:**
- Modify: `src/ui/components/Stage/snapping.ts` (+ test)
- Modify: `src/ui/store/store.ts` (+ test)

- [ ] **Step 1: Pure test** — append to `snapping.test.ts`:
```ts
import { groupBBox, type AABB } from './snapping'; // add groupBBox

describe('groupBBox', () => {
  it('unions several AABBs', () => {
    const boxes: AABB[] = [
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 20, minY: -5, maxX: 30, maxY: 5 },
    ];
    expect(groupBBox(boxes)).toEqual({ minX: 0, minY: -5, maxX: 30, maxY: 10 });
  });
  it('returns null for an empty list', () => {
    expect(groupBBox([])).toBeNull();
  });
});
```
Implement in `snapping.ts`:
```ts
export function groupBBox(boxes: AABB[]): AABB | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }));
}
```

- [ ] **Step 2: Store test** — append to the `multi-move (slice 37)` describe (or new):
```ts
it('setObjectsTransforms writes x/y/scaleX/scaleY for several objects in one commit', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  const past = useEditor.getState().history.past.length;
  useEditor.getState().setObjectsTransforms([
    { id: a, x: 5, y: 6, scaleX: 2, scaleY: 2 },
    { id: b, x: 80, y: 0, scaleX: 2, scaleY: 2 },
  ]);
  const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
  expect({ x: sa.x, y: sa.y, sx: sa.scaleX, sy: sa.scaleY }).toEqual({ x: 5, y: 6, sx: 2, sy: 2 });
  expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit
});

it('setObjectsTransforms skips a locked object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(a);
  useEditor.getState().setObjectsTransforms([{ id: a, x: 99, y: 99, scaleX: 3, scaleY: 3 }]);
  const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
  expect(sa.x).not.toBe(99); // locked -> unchanged
});
```
Add to the interface: `setObjectsTransforms(updates: { id: string; x: number; y: number; scaleX: number; scaleY: number }[]): void;` and implement (near `nudgeSelected`):
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
    tracks.x = upsertKeyframe(obj.tracks.x ?? [], createKeyframe(time, u.x));
    tracks.y = upsertKeyframe(obj.tracks.y ?? [], createKeyframe(time, u.y));
    tracks.scaleX = upsertKeyframe(obj.tracks.scaleX ?? [], createKeyframe(time, u.scaleX));
    tracks.scaleY = upsertKeyframe(obj.tracks.scaleY ?? [], createKeyframe(time, u.scaleY));
    objects = objects.map((o) => (o.id === u.id ? { ...obj, tracks } : o));
    changed = true;
  }
  if (changed) get().commit({ ...project, objects });
},
```

- [ ] **Step 3: Run + commit** — `pnpm vitest run src/ui/components/Stage/snapping.test.ts src/ui/store/store.test.ts` → PASS.
```bash
git add src/ui/components/Stage/snapping.ts src/ui/components/Stage/snapping.test.ts src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice40): pure groupBBox + store setObjectsTransforms (one-commit multi transform)"
```

---

### Task 2: Group bbox + handles render; gate single overlays

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (+ test)

- [ ] **Step 1: Gate the single-object overlays** — add `|| selectedIds.length !== 1` to the guard of EACH of `selectedVector`, `selectedGradient`, `selectedRotatable`, `selectedScalable` (so they render only for exactly one selection). `selectedIds` is already read at the top.

- [ ] **Step 2: `groupBounds` memo** — when `activeTool === 'select' && selectedIds.length > 1`, compute the union of each selected NON-locked, NON-hidden object's `objectAABB`:
```ts
const groupBounds = useMemo(() => {
  if (activeTool !== 'select' || selectedIds.length <= 1) return null;
  const boxes: AABB[] = [];
  for (const id of selectedIds) {
    const o = project.objects.find((x) => x.id === id);
    if (!o || o.hidden || o.locked) continue;
    const a = objectAABB(o, assetsById.get(o.assetId), time);
    if (a) boxes.push(a);
  }
  return groupBBox(boxes);
}, [activeTool, selectedIds, project.objects, assetsById, time]);
```
(import `groupBBox`.)

- [ ] **Step 3: Render the group handles** — in the pan/zoom content `<g>` (near the single-object handles), when `groupBounds`:
```tsx
{groupBounds && (
  <g data-testid="group-handles">
    <rect x={groupBounds.minX} y={groupBounds.minY} width={groupBounds.maxX - groupBounds.minX} height={groupBounds.maxY - groupBounds.minY} fill="none" stroke="var(--color-accent)" strokeWidth={1 / zoom} pointerEvents="none" />
    {HANDLE_IDS.map((hid) => {
      const p = handleLocalPositions(groupBounds.maxX - groupBounds.minX, groupBounds.maxY - groupBounds.minY)[hid];
      return (
        <rect key={hid} data-testid={`group-handle-${hid}`} x={groupBounds.minX + p.x - 4 / zoom} y={groupBounds.minY + p.y - 4 / zoom} width={8 / zoom} height={8 / zoom} fill="var(--color-accent)" onPointerDown={(e) => onGroupHandlePointerDown(hid, e)} />
      );
    })}
  </g>
)}
```
(`HANDLE_IDS`/`handleLocalPositions` are already imported from `./resizeHandles`.)

- [ ] **Step 4: Render test** — append to `Stage.test.tsx`:
```ts
it('renders group handles for a multi-selection and hides the single-object handles', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('group-handles')).toBeInTheDocument();
  expect(screen.getByTestId('group-handle-se')).toBeInTheDocument();
  expect(screen.queryByTestId('resize-handles')).toBeNull(); // single-object overlay hidden
  expect(screen.queryByTestId('scale-handles')).toBeNull();
});
```
Run it.

- [ ] **Step 5: Commit**
```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice40): group bbox + scale handles for a multi-selection; gate single overlays"
```

---

### Task 3: Group-scale drag

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (+ test)

- [ ] **Step 1: groupScaleRef + handler** — add `const groupScaleRef = useRef<{ pivot: {x,y}; corner: {x,y}; sxAxis: boolean; syAxis: boolean; items: { id, ox, oy, osx, osy, ax, ay }[]; sx: number; sy: number; moved: boolean } | null>(null);` and:
```ts
const onGroupHandlePointerDown = (hid: HandleId, e: ReactPointerEvent) => {
  e.stopPropagation();
  if (!groupBounds || !useEditor.getState().autoKey) return;
  const w = groupBounds.maxX - groupBounds.minX;
  const h = groupBounds.maxY - groupBounds.minY;
  const pos = handleLocalPositions(w, h);
  const opp = oppositeHandle(hid as ScaleHandleId);
  const corner = { x: groupBounds.minX + pos[hid].x, y: groupBounds.minY + pos[hid].y };
  const pivot = { x: groupBounds.minX + pos[opp].x, y: groupBounds.minY + pos[opp].y };
  const movesX = hid === 'e' || hid === 'w' || hid.length === 2; // corners + e/w
  const movesY = hid === 'n' || hid === 's' || hid.length === 2; // corners + n/s
  const proj = useEditor.getState().history.present;
  const t = useEditor.getState().time;
  const items = selectedIds
    .map((id) => proj.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o && !o.locked && !o.hidden)
    .map((o) => {
      const st = sampleObject(o, t);
      const r = resolveObjectAnchor(o, proj.assets.find((a) => a.id === o.assetId), st);
      return { id: o.id, ox: st.x, oy: st.y, osx: st.scaleX, osy: st.scaleY, ax: r ? r.anchorX : o.anchorX, ay: r ? r.anchorY : o.anchorY };
    });
  groupScaleRef.current = { pivot, corner, sxAxis: movesX, syAxis: movesY, items, sx: 1, sy: 1, moved: false };
};
```
(`oppositeHandle`/`ScaleHandleId` from `./scaleHandles`; `HandleId` from `./resizeHandles`.)

- [ ] **Step 2: onMove group-scale branch** — at the top of the `onMove` listener (before the marquee/object branches):
```ts
const gs = groupScaleRef.current;
if (gs) {
  const cur = clientToLocal(e.clientX, e.clientY);
  if (!cur) return;
  const denomX = gs.corner.x - gs.pivot.x;
  const denomY = gs.corner.y - gs.pivot.y;
  const sx = gs.sxAxis && Math.abs(denomX) > 1e-6 ? Math.max(MIN_SCALE, (cur.x - gs.pivot.x) / denomX) : 1;
  const sy = gs.syAxis && Math.abs(denomY) > 1e-6 ? Math.max(MIN_SCALE, (cur.y - gs.pivot.y) / denomY) : 1;
  gs.sx = sx; gs.sy = sy; gs.moved = true;
  const proj = useEditor.getState().history.present;
  const time = useEditor.getState().time;
  for (const it of gs.items) {
    const node = nodes.get(it.id);
    const obj = proj.objects.find((o) => o.id === it.id);
    if (!node || !obj) continue;
    const pvx = it.ax + it.ox, pvy = it.ay + it.oy; // anchor point in artboard
    const nx = gs.pivot.x + sx * (pvx - gs.pivot.x) - it.ax;
    const ny = gs.pivot.y + sy * (pvy - gs.pivot.y) - it.ay;
    const sampled = sampleObject(obj, time);
    node.setAttribute('transform', buildTransform({ ...sampled, x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy }, it.ax, it.ay));
  }
  return;
}
```
(`MIN_SCALE` from `./scaleHandles`.)

- [ ] **Step 3: onUp group-scale branch** — first in `onUp`:
```ts
const gsUp = groupScaleRef.current;
if (gsUp) {
  groupScaleRef.current = null;
  if (gsUp.moved) {
    const updates = gsUp.items.map((it) => {
      const pvx = it.ax + it.ox, pvy = it.ay + it.oy;
      return { id: it.id, x: gsUp.pivot.x + gsUp.sx * (pvx - gsUp.pivot.x) - it.ax, y: gsUp.pivot.y + gsUp.sy * (pvy - gsUp.pivot.y) - it.ay, scaleX: it.osx * gsUp.sx, scaleY: it.osy * gsUp.sy };
    });
    useEditor.getState().setObjectsTransforms(updates);
  }
  return;
}
```

- [ ] **Step 4: Stage drag test** — append to `Stage.test.tsx` (two unrotated rects; identity CTM):
```ts
it('dragging the group SE handle scales the whole selection about the NW pivot', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 }); // AABB 0..40
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 }); // AABB 100..140
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  render(<Stage nodes={nodes} />);
  // group bbox is x:0..140, y:0..40; SE handle at (140,40); NW pivot at (0,0).
  const se = screen.getByTestId('group-handle-se');
  fireEvent.pointerDown(se, { clientX: 140, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 280, clientY: 80 }); // double: sx=280/140=2, sy=80/40=2
  fireEvent.pointerUp(window, { clientX: 280, clientY: 80 });
  const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
  // a was anchored at centre (20,20); pivot (0,0); new anchor = 2*(20,20) => base = (40-20)=20; scale 2.
  expect(sa.scaleX).toBeCloseTo(2);
  expect(sa.x).toBeCloseTo(20); // 2*20 - 20
});
```
Run it (pin the expected to the math: anchor centre (20,20), base 0 → pivotObj (20,20) → ×2 = (40,40) → base = 40-20 = 20).

- [ ] **Step 5: Commit**
```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice40): group-scale drag scales the whole selection about the opposite corner/edge"
```

---

### Task 4: e2e + full gate

- [ ] **Step 1: e2e** — `e2e/multi-scale.spec.ts`: draw two rects, Shift-select both, drag the `group-handle-se` outward; assert both objects' bounding boxes grew (width after > before for each). Avoid starting the drag on an object.

- [ ] **Step 2: Run e2e + full gate + commit**
```bash
pnpm exec playwright test e2e/multi-scale.spec.ts
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add -A
git commit -m "test(slice40): multi-scale e2e (group handle grows both objects)"
```

---

## Self-Review (post-write)

- **Spec coverage:** §2 math → T1 store + T3 Stage; §3 group bbox/handles → T2; gating → T2; e2e → T4.
- **Type consistency:** `groupBBox`, `setObjectsTransforms(updates)`, `groupScaleRef`, `onGroupHandlePointerDown` consistent; reuse `HANDLE_IDS`/`handleLocalPositions`/`oppositeHandle`/`MIN_SCALE`/`resolveObjectAnchor`.
- **No placeholders:** T1 full code + vectors (union; setObjectsTransforms one commit); T3 hand-verified (centre (20,20), ×2 about (0,0) → base 20, scale 2).
- **Stale closures:** the drag reads store via `getState()` + per-object origins from `groupScaleRef`.
- **Single-object unchanged:** overlays gated to `length === 1`; the group path only runs for `>1`.
