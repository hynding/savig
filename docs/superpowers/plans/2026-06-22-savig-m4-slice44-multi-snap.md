# Savig M4 Slice 44 — Multi-object move snapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking.

**Goal:** Snap a multi-selection's group bbox to other objects' edges/centers and the artboard during a move-drag.

**Architecture:** Populate the already-present `DragState.baseAABB` + `targets` at multi-drag start (group bbox + non-selected AABBs + artboard); run the existing `computeSnap` in the multi `onMove`; store the corrected delta in `d.multi.dx/dy` (which `onUp` already commits via `nudgeSelected`). Two edits in `Stage.tsx`; no store/engine change.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. Editor-only — no store/engine/export/persistence change.
- Window `onMove`/`onUp` listeners read `baseAABB`/`targets` from `dragRef.current` and live state via `useEditor.getState()` — never a render-closure memo (stale-closure discipline). Pointer-down is a React handler (reading `assetsById` there is fine, matching single-drag).
- The snap bbox is built from the SAME member set the preview moves (the non-locked `items`).
- Respect the `snapEnabled` store flag; `SNAP_PX = 6`, threshold `SNAP_PX / zoom`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Snap the multi-selection group bbox during move-drag

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (multi branch of `onObjectPointerDown`; multi branch of the window `onMove`)
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes (all already imported in `Stage.tsx`): `computeSnap`, `groupBBox`, `objectAABB`, `SNAP_PX`, `type AABB` from `./snapping`; `nudgeSelected` (store); the `snapGuides` state; `snapEnabled` (store).

- [ ] **Step 1: Write the failing test** in `Stage.test.tsx` (the `beforeEach` already adds one svg object `a`; add the rects fresh). A 2-object group snaps its left edge to an unselected target's left edge:

```ts
it('a multi-selection move-drag snaps the group bbox to another object (slice 44)', () => {
  const s = useEditor.getState();
  s.newProject();
  // Target T (NOT selected): a 10-wide rect with left edge at x=50.
  s.addVectorShape('rect', { x: 50, y: 200, width: 10, height: 10 });
  const tg = useEditor.getState().selectedObjectId!;
  // Group A,B with the group's left edge at x=0.
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  // Drag the group by +47 (group left edge -> 47): within SNAP_PX(6) of T's left edge (50) -> snaps to 50.
  fireEvent.pointerDown(screen.getByTestId(`object-${a}`), { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 47, clientY: 0 });
  fireEvent.pointerUp(window);
  const ax = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, useEditor.getState().time).x;
  const bx = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === b)!, useEditor.getState().time).x;
  expect(ax).toBe(50); // snapped (+50), not the raw +47
  expect(bx).toBe(70); // B moved by the same snapped delta
  expect(tg).not.toBe(a);
});

it('multi-drag uses the raw delta when snapping is disabled (slice 44)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 50, y: 200, width: 10, height: 10 }); // target (unselected)
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().setSnapEnabled(false); // confirm the real setter name (grep: setSnapEnabled / toggleSnap)
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  fireEvent.pointerDown(screen.getByTestId(`object-${a}`), { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 47, clientY: 0 });
  fireEvent.pointerUp(window);
  const ax = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, useEditor.getState().time).x;
  expect(ax).toBe(47); // raw, no snap
});
```
(Confirm the snap-disable setter: `grep -n "setSnapEnabled\|toggleSnap\|snapEnabled" src/ui/store/store.ts` — there is a boolean setter `setSnapEnabled(b)` at ~line 1525 and a `toggleSnap` at ~1523; use the real exported action name.)

- [ ] **Step 2: Run** `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "multi-selection move-drag snaps"` → FAIL (a lands at 47, not 50 — multi branch doesn't snap yet).

- [ ] **Step 3: Populate `baseAABB` + `targets` at multi-drag start.** In the multi branch of `onObjectPointerDown` (currently ~lines 619–632), replace the `dragRef.current = {…}` assignment so the snap fields are filled:

```ts
    const dragIds = alreadyMulti ? ids : useEditor.getState().selectedObjectIds;
    if (dragIds.length > 1) {
      const proj = useEditor.getState().history.present;
      const t = useEditor.getState().time;
      const items = dragIds
        .map((sid) => proj.objects.find((o) => o.id === sid))
        .filter((o): o is SceneObject => !!o && !o.locked)
        .map((o) => {
          const sm = sampleObject(o, t);
          return { id: o.id, ox: sm.x, oy: sm.y };
        });
      // Snap (slice 44): the group's bbox of the MOVING members, and targets = every other
      // object's stage AABB + the artboard (mirrors the single-drag targets).
      const sel = new Set(dragIds);
      const memberBoxes: AABB[] = [];
      const targets: AABB[] = [];
      for (const o of proj.objects) {
        const box = objectAABB(o, proj.assets.find((as) => as.id === o.assetId), t);
        if (!box) continue;
        if (sel.has(o.id)) {
          if (!o.locked) memberBoxes.push(box);
        } else {
          targets.push(box);
        }
      }
      targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
      dragRef.current = {
        id, startX: e.clientX, startY: e.clientY, originX: 0, originY: 0, curX: 0, curY: 0, moved: false,
        baseAABB: groupBBox(memberBoxes), targets, multi: { items, dx: 0, dy: 0 },
      };
      return;
    }
```

- [ ] **Step 4: Snap in the multi `onMove`.** Replace the multi branch of the window `onMove` (currently ~lines 948–970) so it applies the snap correction:

```ts
      if (d.multi) {
        // Move-drag the whole selection; snap the GROUP bbox to other objects + artboard
        // (slice 44). Preview each member at its origin + the (snapped) delta; one commit on up.
        const rawdx = (e.clientX - d.startX) / z;
        const rawdy = (e.clientY - d.startY) / z;
        let dx = rawdx;
        let dy = rawdy;
        if (useEditor.getState().snapEnabled && d.baseAABB) {
          const moving: AABB = {
            minX: d.baseAABB.minX + rawdx,
            maxX: d.baseAABB.maxX + rawdx,
            minY: d.baseAABB.minY + rawdy,
            maxY: d.baseAABB.maxY + rawdy,
          };
          const snap = computeSnap(moving, d.targets, SNAP_PX / z);
          dx = rawdx + snap.dx;
          dy = rawdy + snap.dy;
          setSnapGuides({ x: snap.guideX, y: snap.guideY });
        } else {
          setSnapGuides({ x: null, y: null });
        }
        d.multi.dx = dx;
        d.multi.dy = dy;
        d.moved = true;
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
        return;
      }
```

- [ ] **Step 5: Run** `pnpm vitest run src/ui/components/Stage/Stage.test.tsx` → both new tests PASS, plus the existing Stage suite green (esp. the slice-37 multi-move + slice-42 group-drag tests, which now go through the snap path — they don't place a target within 6px, so they land on the raw delta).

- [ ] **Step 6: Run** `pnpm typecheck` → clean.

- [ ] **Step 7: Commit** `feat(slice44): snap the multi-selection group bbox during move-drag`.

---

### Task 2: e2e + full gate

**Files:**
- Create: `e2e/multi-snap.spec.ts`

- [ ] **Step 1: Write** `e2e/multi-snap.spec.ts` modeled on `e2e/multi-move.spec.ts`: draw 3 rects; Shift-select two of them; drag the pair so the group's edge approaches the third rect's edge (move to a few px short of alignment); on release assert the dragged group's relevant edge aligns with the third rect within ~1.5px (snapped). Keep tolerances forgiving (rendering/rounding); if pixel-snapping proves flaky in e2e, assert the weaker property that the dragged objects moved toward and stopped at the target edge (|edge difference| < 1.5) rather than overshooting to the raw cursor position.

- [ ] **Step 2: Run** `pnpm exec playwright test e2e/multi-snap.spec.ts` → PASS. If flaky, fall back to the weaker edge-alignment assertion above.

- [ ] **Step 3: Full gate** — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test` → all green.

- [ ] **Step 4: Commit** `test(e2e): multi-selection drag snaps the group edge to another object`.

---

## Self-Review (post-write)

- **Spec coverage:** populate baseAABB+targets (T1 step 3) ✓; snap in multi onMove (T1 step 4) ✓; snapEnabled respected (T1 step 4 + the disabled test) ✓; guides reuse (T1 step 4) ✓; e2e (T2) ✓. `onUp` already commits the corrected `d.multi.dx/dy` and clears guides (no change needed — verified at Stage.tsx ~1180–1187).
- **Type consistency:** `AABB`, `computeSnap`, `groupBBox`, `objectAABB`, `SNAP_PX` all already imported in `Stage.tsx`; member-set used for `groupBBox` matches the previewed `items` (non-locked).
- **No placeholders:** both edits are concrete full blocks; the only "confirm name" note is the snap-disable setter (a real action; grep gives the exact name).
- **Stale closure:** the new `onMove` code reads `d.baseAABB`/`d.targets` from the ref and `snapEnabled`/project/time via `useEditor.getState()` — no render-closure memo.
