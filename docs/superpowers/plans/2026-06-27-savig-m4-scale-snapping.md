# Scale Position-Snapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make resize/scale drags snap the moving edge/corner to other objects' edges & centers + the artboard (with alignment guides), including uniform (Shift) and from-center (Alt), for all three scale drag machines.

**Architecture:** A pure `Stage/scaleSnap.ts` returns an ADJUSTED pointer that lies on the mode's constraint (the uniform diagonal / from-center ray) AND on a nearby target line; passing it to the existing `applyScaleHandleDrag`/`applyHandleResize` (whose own projection is then a no-op) lands the edge on the guide without changing those helpers. Group scale (always axis-aligned, no modifiers) uses the simple per-axis point snap. Reuses `computeSnap` + the existing guide overlay.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest, Playwright, Vite, pnpm.

## Global Constraints

- TypeScript strict; no `any`. `scaleSnap.ts` is pure (imports only `computeSnap`/`AABB` from `./snapping`).
- **Editor-chrome only:** no change to `flattenInstances`/`computeFrame`/`renderSvgDocument`/runtime. Snap-disabled and no-target-in-threshold paths must be BYTE-IDENTICAL to today.
- Snapping engages only when `snapEnabled` AND the dragged object's rotation ≈ 0 (`|rotation| < 1e-6`) for the single-object handlers; group scale (axis-aligned bbox) always eligible. Threshold = `SNAP_PX / zoom`.
- Targets = every OTHER object's `entityAABB(o, project.objects, project.assets, time)` + the artboard rect `{minX:0,minY:0,maxX:meta.width,maxY:meta.height}` — the same set the move drag builds.
- Verify each slice: `pnpm typecheck`, `pnpm exec eslint src e2e`, `pnpm test`, targeted `pnpm e2e <spec>` (run `pkill -f vite` before a definitive e2e). Each slice = own branch off `main`, `feature-dev:code-reviewer` loop to 0 Critical/0 Important, `--no-ff` merge, record hash, update INDEX.md. Commit messages end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File map

- Create `src/ui/components/Stage/scaleSnap.ts` — `snapScalePoint`, `snapScaleAlongSegment`.
- Create `src/ui/components/Stage/scaleSnap.test.ts` — unit suite.
- Modify `src/ui/components/Stage/Stage.tsx` — group-scale, single-scale, resize drag handlers (build `targets` on pointer-down; snap on move; set guides).
- Modify `e2e/snapping.spec.ts` — resize-snap e2e.

---

## SLICE 1 — scaleSnap helpers + group scale + single scale (stage-space)

### Task 1.1: `scaleSnap.ts` helpers + unit tests

**Files:** Create `src/ui/components/Stage/scaleSnap.ts`, `src/ui/components/Stage/scaleSnap.test.ts`.

**Interfaces — Produces:**
- `snapScalePoint(p: {x:number;y:number}, sxAxis: boolean, syAxis: boolean, targets: AABB[], threshold: number): ScaleSnapResult`
- `snapScaleAlongSegment(p: {x:number;y:number}, segStart: {x:number;y:number}, segEnd: {x:number;y:number}, targets: AABB[], threshold: number): ScaleSnapResult`
- `interface ScaleSnapResult { x: number; y: number; guideX: number | null; guideY: number | null }`

- [ ] **Step 1: Write failing tests** in `scaleSnap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { snapScalePoint, snapScaleAlongSegment } from './scaleSnap';
import type { AABB } from './snapping';

const box = (minX: number, minY: number, maxX: number, maxY: number): AABB => ({ minX, minY, maxX, maxY });

describe('snapScalePoint (free per-axis)', () => {
  const targets = [box(100, 0, 200, 50)]; // x-lines 100/150/200, y-lines 0/25/50
  it('snaps x to a near vertical line when within threshold (both axes dragged)', () => {
    const r = snapScalePoint({ x: 98, y: 10 }, true, true, targets, 6);
    expect(r.x).toBe(100); // snapped to minX=100
    expect(r.guideX).toBe(100);
  });
  it('does NOT move an axis that is not being dragged', () => {
    const r = snapScalePoint({ x: 98, y: 2 }, true, false, targets, 6); // syAxis off
    expect(r.x).toBe(100);
    expect(r.y).toBe(2); // y untouched
    expect(r.guideY).toBeNull();
  });
  it('leaves the point unchanged when no line is within threshold', () => {
    const r = snapScalePoint({ x: 130, y: 80 }, true, true, targets, 6);
    expect(r).toEqual({ x: 130, y: 80, guideX: null, guideY: null });
  });
});

describe('snapScaleAlongSegment (uniform/from-center constraint)', () => {
  const targets = [box(100, 100, 200, 200)];
  it('slides the point ALONG the segment so its x lands on a vertical line', () => {
    // segment from (0,0) to (120,120) (45°). A vertical line at x=100 -> point (100,100) on the seg.
    const r = snapScaleAlongSegment({ x: 96, y: 104 }, { x: 0, y: 0 }, { x: 120, y: 120 }, targets, 6);
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(100, 6); // stays on the 45° segment
    expect(r.guideX).toBe(100);
  });
  it('returns the projection (no guide) when no line is near', () => {
    const r = snapScaleAlongSegment({ x: 10, y: 12 }, { x: 0, y: 0 }, { x: 120, y: 120 }, targets, 6);
    // projection of (10,12) onto the 45° line = (11,11); no target near -> guides null
    expect(r.guideX).toBeNull();
    expect(r.guideY).toBeNull();
    expect(r.x).toBeCloseTo(11, 6);
    expect(r.y).toBeCloseTo(11, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- src/ui/components/Stage/scaleSnap.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `scaleSnap.ts`:

```ts
// Position-snapping for scale/resize drags (slice scale-snap). Pure; reuses computeSnap so the
// dragged corner/edge lands on the same target lines + guides as move-snap. snapScalePoint = free
// per-axis; snapScaleAlongSegment = constrained to the uniform diagonal / from-centre ray.
import { computeSnap, type AABB } from './snapping';

export interface ScaleSnapResult {
  x: number;
  y: number;
  guideX: number | null;
  guideY: number | null;
}

const pointAABB = (x: number, y: number): AABB => ({ minX: x, maxX: x, minY: y, maxY: y });

/** Free per-axis snap of a dragged corner/edge POINT to nearby target lines. Only the dragged
 *  axes (sxAxis/syAxis) move; the matched guide is reported per dragged axis. */
export function snapScalePoint(
  p: { x: number; y: number },
  sxAxis: boolean,
  syAxis: boolean,
  targets: AABB[],
  threshold: number,
): ScaleSnapResult {
  const r = computeSnap(pointAABB(p.x, p.y), targets, threshold);
  return {
    x: p.x + (sxAxis ? r.dx : 0),
    y: p.y + (syAxis ? r.dy : 0),
    guideX: sxAxis ? r.guideX : null,
    guideY: syAxis ? r.guideY : null,
  };
}

/** Keep the point on the segment segStart->segEnd (uniform diagonal / from-centre ray) but slide it
 *  ALONG the segment so the grabbed edge lands on a nearby target line. Returns the segment
 *  projection (no guide) when nothing is near — identity through applyScaleHandleDrag's own
 *  projection. */
export function snapScaleAlongSegment(
  p: { x: number; y: number },
  segStart: { x: number; y: number },
  segEnd: { x: number; y: number },
  targets: AABB[],
  threshold: number,
): ScaleSnapResult {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : ((p.x - segStart.x) * dx + (p.y - segStart.y) * dy) / len2;
  const proj = { x: segStart.x + t * dx, y: segStart.y + t * dy };
  const r = computeSnap(pointAABB(proj.x, proj.y), targets, threshold);
  const candidates: { x: number; y: number; d: number; gx: number | null; gy: number | null }[] = [];
  if (r.guideX !== null && Math.abs(dx) > 1e-6) {
    const tx = (r.guideX - segStart.x) / dx;
    const c = { x: r.guideX, y: segStart.y + tx * dy };
    candidates.push({ ...c, d: Math.hypot(c.x - proj.x, c.y - proj.y), gx: r.guideX, gy: null });
  }
  if (r.guideY !== null && Math.abs(dy) > 1e-6) {
    const ty = (r.guideY - segStart.y) / dy;
    const c = { x: segStart.x + ty * dx, y: r.guideY };
    candidates.push({ ...c, d: Math.hypot(c.x - proj.x, c.y - proj.y), gx: null, gy: r.guideY });
  }
  if (candidates.length === 0) return { x: proj.x, y: proj.y, guideX: null, guideY: null };
  candidates.sort((a, b) => a.d - b.d);
  const best = candidates[0];
  return { x: best.x, y: best.y, guideX: best.gx, guideY: best.gy };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm test -- src/ui/components/Stage/scaleSnap.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(stage): scaleSnap helpers (free + constrained position snap)"`

### Task 1.2: Build snap targets on the scale pointer-downs + a guides setter

**Files:** Modify `src/ui/components/Stage/Stage.tsx`.

**Interfaces:**
- Consumes: existing `entityAABB`, `selectEditProject`, the `guides` state setter (find how the move drag sets guides — likely `setSnapGuides({ x, y })`), and the drag refs `groupScaleRef`/`scaleRef`.
- Produces: each scale drag ref carries a `targets: AABB[]` field; the helper output drives `setSnapGuides`.

- [ ] **Step 1: Add `targets` to the group-scale ref type and build it on pointer-down.** In `onGroupHandlePointerDown` (where `groupScaleRef.current = {...}` is set, ~line 808), build targets exactly like the move drag (every other top-level object's `entityAABB` + artboard) and include `targets` in the ref object. Extend the `groupScaleRef` type (~line 376) with `targets: AABB[]`.

```ts
// before `groupScaleRef.current = {...}`:
const time2 = useEditor.getState().time;
const targets: AABB[] = [];
for (const o of proj.objects) {
  if (o.isGroup || selectedIds.includes(o.id)) continue; // skip the things being scaled
  const a = entityAABB(o, proj.objects, proj.assets, time2);
  if (a) targets.push(a);
}
targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
// add `targets` to the ref literal.
```

Do the analogous build in the single-scale pointer-down (`scaleRef.current = {...}`, find it near line 476) — there the "self" to exclude is `selectedId`. Add `targets: AABB[]` to the `scaleRef` type.

- [ ] **Step 2: Confirm the guides setter.** Grep `setSnapGuides` / the `guides` state in Stage; the move drag calls it on snap. The scale snap will call the same setter with `{ x: guideX, y: guideY }` and clear it (`{x:null,y:null}`) on pointer-up. (No test step — wiring verified by Tasks 1.3/1.4 e2e.)
- [ ] **Step 3: Commit** — `git commit -am "feat(stage): build snap targets for scale drags"`

### Task 1.3: Snap the group/multi-select scale drag

**Files:** Modify `src/ui/components/Stage/Stage.tsx` (group-scale move handler ~line 836–845).

- [ ] **Step 1: Implement.** After `const cur = clientToLocal(...)` and before computing `sx`/`sy`, snap the corner (gated on `snapEnabled`):

```ts
let corner = cur;
if (useEditor.getState().snapEnabled) {
  const snap = snapScalePoint(cur, gs.sxAxis, gs.syAxis, gs.targets, SNAP_PX / zoom);
  corner = { x: snap.x, y: snap.y };
  setSnapGuides({ x: snap.guideX, y: snap.guideY });
}
const sx = gs.sxAxis && Math.abs(denomX) > 1e-6 ? Math.max(MIN_SCALE, (corner.x - gs.pivot.x) / denomX) : 1;
const sy = gs.syAxis && Math.abs(denomY) > 1e-6 ? Math.max(MIN_SCALE, (corner.y - gs.pivot.y) / denomY) : 1;
```

Clear guides on group-scale pointer-up (where `groupScaleRef.current = null`): `setSnapGuides({ x: null, y: null })`.

- [ ] **Step 2: Manual-logic check via existing tests** — `pnpm test` stays green (no unit covers this imperative path; the e2e in Task 1.5 covers it). `pnpm typecheck`.
- [ ] **Step 3: Commit** — `git commit -am "feat(stage): snap the group/multi-select scale drag"`

### Task 1.4: Snap the single-object scale drag (free + uniform + from-center)

**Files:** Modify `src/ui/components/Stage/Stage.tsx` (single-scale move handler ~line 895–914).

**Background:** `applyScaleHandleDrag` takes `pointerX/pointerY` and internally projects (rotation, and under uniform onto the `oC→cC` diagonal; under from-center about the anchor). We compute an ADJUSTED pointer and pass it; rotation≈0 only.

- [ ] **Step 1: Implement.** Replace `pointerX: local.x, pointerY: local.y` with a snapped point computed BEFORE the `applyScaleHandleDrag` call:

```ts
const snap = sc.snapshot;
let px = local.x, py = local.y;
const rotated = Math.abs(snap.rotationDeg) > 1e-6;
if (useEditor.getState().snapEnabled && !rotated) {
  // Content positions of the anchor, opposite corner and dragged corner at the START scale.
  const aC = { x: snap.anchorX + snap.baseX, y: snap.anchorY + snap.baseY };
  const cC = { x: snap.anchorX + snap.startScaleX * (snap.corner.x - snap.anchorX) + snap.baseX,
               y: snap.anchorY + snap.startScaleY * (snap.corner.y - snap.anchorY) + snap.baseY };
  const oC = { x: snap.anchorX + snap.startScaleX * (snap.opposite.x - snap.anchorX) + snap.baseX,
               y: snap.anchorY + snap.startScaleY * (snap.opposite.y - snap.anchorY) + snap.baseY };
  const isCorner = snap.corner.x !== snap.opposite.x && snap.corner.y !== snap.opposite.y;
  const sxAxis = snap.corner.x !== snap.opposite.x;
  const syAxis = snap.corner.y !== snap.opposite.y;
  let res;
  if (e.shiftKey && isCorner) res = snapScaleAlongSegment({ x: px, y: py }, oC, cC, sc.targets, SNAP_PX / zoom);
  else if (e.altKey && isCorner) res = snapScaleAlongSegment({ x: px, y: py }, aC, cC, sc.targets, SNAP_PX / zoom);
  else res = snapScalePoint({ x: px, y: py }, sxAxis, syAxis, sc.targets, SNAP_PX / zoom);
  px = res.x; py = res.y;
  setSnapGuides({ x: res.guideX, y: res.guideY });
}
const r = applyScaleHandleDrag({ corner: snap.corner, opposite: snap.opposite, anchorX: snap.anchorX,
  anchorY: snap.anchorY, startScaleX: snap.startScaleX, startScaleY: snap.startScaleY, baseX: snap.baseX,
  baseY: snap.baseY, rotationDeg: snap.rotationDeg, pointerX: px, pointerY: py, uniform: e.shiftKey, fromCenter: e.altKey });
```

> NOTE: verify the `scaleRef` snapshot fields (`corner`, `opposite`, `anchorX/Y`, `startScaleX/Y`, `baseX/Y`, `rotationDeg`) against `snapshotForScale` (near line 451–490) — match the exact names; the `contentOf` math above mirrors `applyScaleHandleDrag`'s `contentOf`. Clear guides on the single-scale pointer-up.

- [ ] **Step 2: Run** `pnpm typecheck && pnpm test` (green).
- [ ] **Step 3: Commit** — `git commit -am "feat(stage): snap the single-object scale drag (free/uniform/from-center)"`

### Task 1.5: e2e + Slice-1 verify + review loop + merge

- [ ] **Step 1: e2e** in `e2e/snapping.spec.ts`: draw rect A, draw rect B to its right, select B, drag B's left/right scale handle toward A's edge → assert B's edge aligns to A's (within ~2px) and an alignment guide appears. Use Stage-scoped selectors; `pkill -f vite` first.
- [ ] **Step 2:** `pnpm typecheck && pnpm exec eslint src e2e && pnpm test && pnpm e2e snapping` green; record counts.
- [ ] **Step 3:** `feature-dev:code-reviewer` (focus: snap-disabled/no-target byte-identity; the adjusted-pointer-is-no-op-through-projection claim for uniform/center; rotation≈0 gate; per-axis edge handling; guides cleared on pointer-up; parity). Re-review until 0 Crit/0 Important.
- [ ] **Step 4:** `--no-ff` merge; record hash + counts; update INDEX.md.

---

## SLICE 2 — Resize (rect/ellipse geometry) snap with stage↔local conversion

The resize handler maps the pointer to the OBJECT-LOCAL frame via `handleGroupRef`'s CTM (rotation/scale-aware), whereas targets are stage-space. So snap in STAGE space, then convert the adjusted point back to local for `applyHandleResize`.

### Task 2.1: Build resize targets + stage↔local conversion + snap

**Files:** Modify `src/ui/components/Stage/Stage.tsx` (resize pointer-down ~line 519 and move handler ~line 1017–1045).

- [ ] **Step 1:** On resize pointer-down (`resizeRef.current = {...}`), build `targets` (other objects' `entityAABB` + artboard) and store on the ref; extend the `resizeRef` type with `targets: AABB[]`.
- [ ] **Step 2:** In the move handler, the raw pointer is mapped to local via `handleGroupRef` CTM. Also map it to STAGE coords via `clientToLocal(e.clientX, e.clientY)`. Gate on `snapEnabled && |rotationDeg| < 1e-6`. Snap the STAGE point (`snapScalePoint` for free; `snapScaleAlongSegment` for uniform/from-center — segment endpoints computed in stage space from the snapshot, mirroring Task 1.4), then convert the snapped STAGE point back to a client point and through the `handleGroupRef` CTM inverse to local, and pass those as `localX/localY` to `applyHandleResize`. Set guides.

```ts
// stage point of the raw pointer:
const stage = clientToLocal(e.clientX, e.clientY);
if (useEditor.getState().snapEnabled && Math.abs(snap.rotationDeg) < 1e-6 && stage) {
  // ... compute aC/oC/cC in STAGE space from the resize snapshot (anchor abs + base; width/height),
  //     choose snapScalePoint / snapScaleAlongSegment by e.shiftKey/e.altKey as in Task 1.4,
  //     setSnapGuides(res). Convert the snapped stage point -> local:
  const back = stageToLocal(res.x, res.y); // contentRef stage->screen, then handleGroup screen->local
  local.x = back.x; local.y = back.y;
}
```

> NOTE: implement `stageToLocal(sx, sy)` as: map stage->screen via `contentRef.current.getScreenCTM()` (a stage point through the content CTM), then screen->local via `handleGroupRef.current.getScreenCTM().inverse()` — the inverse of how `local` was obtained. Verify the resize `snapshot` field names (`width`, `height`, `anchorFracX/Y`, `baseX/Y`, `scaleX/Y`, `rotationDeg`, `isEllipse`) against `snapshotForResize` (~line 492–519). For rect/ellipse the start scale is typically 1 but read it from the snapshot; the stage-space content positions use `anchorAbs = base + anchorFrac*size` etc.

- [ ] **Step 3:** `pnpm typecheck && pnpm test` green.
- [ ] **Step 4: Commit** — `git commit -am "feat(stage): snap rect/ellipse resize (stage<->local conversion)"`

### Task 2.2: e2e + Slice-2 verify + review loop + merge

- [ ] **Step 1: e2e** in `e2e/snapping.spec.ts`: draw two rects; resize one (drag a corner/edge handle) so its edge meets the other's edge → assert alignment within ~2px + guide visible.
- [ ] **Step 2:** full verify (`typecheck`/`lint`/`test`/`e2e snapping`); record counts.
- [ ] **Step 3:** `feature-dev:code-reviewer` (focus: the stage↔local conversion correctness, snap-disabled byte-identity, rotation gate, uniform/center segments in stage space, parity). Re-review until 0 Crit/0 Important.
- [ ] **Step 4:** `--no-ff` merge; record hash; update INDEX.md (move both slices into the merged table; mark "snapping group scale/rotate handles" → scale done, rotate-angle-snap still deferred).

---

## Self-Review

**Spec coverage:** `snapScalePoint`/`snapScaleAlongSegment` (1.1) ✓; group scale (1.3) ✓; single scale free/uniform/center (1.4) ✓; resize w/ conversion (2.1) ✓; targets = other entityAABB + artboard (1.2/2.1) ✓; rotation≈0 gate (1.4/2.1) ✓; guides reuse (1.3/1.4/2.1) ✓; snap-disabled byte-identity (gates) ✓; parity (editor-only) ✓; tests: helper unit suite (1.1) + scale e2e (1.5) + resize e2e (2.2) ✓.

**Placeholder scan:** The wiring tasks (1.3/1.4/2.1) carry exact snippets but flag two `> NOTE`s to verify snapshot field names against `snapshotForScale`/`snapshotForResize` and the `stageToLocal` CTM composition before relying on them — these are verify-against-existing-code directives (the field names already exist in the snapshots), not placeholders. The helper (1.1) and its tests are fully literal.

**Type consistency:** `ScaleSnapResult { x, y, guideX, guideY }` and both helper signatures used identically in 1.3/1.4/2.1. `AABB` from `./snapping`. `SNAP_PX`, `MIN_SCALE`, `entityAABB`, `clientToLocal`, `computeSnap` all existing. `setSnapGuides` is the existing move-snap guide setter (Task 1.2 Step 2 confirms its exact name before use).
