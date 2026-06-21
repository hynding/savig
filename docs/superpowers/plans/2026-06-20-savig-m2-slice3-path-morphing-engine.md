# M2 Slice 3 — Path Morphing: Engine & Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a path's *shape* animate over time — add a per-object `shapeTrack` of `PathData` snapshots, a pure `samplePath` interpolator with index-pad node-count reconciliation, and wire the sampled path through the runtime/export pipeline so preview == export.

**Architecture:** `shapeTrack?: ShapeKeyframe[]` lives on `SceneObject` (the asset's `path` stays the static base, used only when no track exists). `sampleObject` resolves the track into `RenderState.path`; `computeFrame` emits `FrameItem.pathD` and `applyFrameToNodes` sets the `<path d>` each frame. The editor Stage and the export runtime share `samplePath` → `pathToD`, so the morph is byte-identical in both.

**Tech Stack:** TypeScript (strict), Vitest. Engine layer is pure (zero React/DOM) so it lifts verbatim into the export runtime bundle (esbuild via `scripts/build-runtime.mjs`).

**Spec:** `docs/superpowers/specs/2026-06-20-savig-m2-slice3-path-morphing-design.md`

## Global Constraints

- TypeScript strict; no `any`. Engine + runtime layers stay **pure** (no React/DOM imports).
- All emitted SVG numbers go through the existing `fmt()` (in `engine/transform.ts`) for byte-identical preview/export.
- Pure functions never mutate inputs; return fresh objects (except clamp fast-paths that return an input snapshot read-only, matching `interpolate`).
- `-0` vs `+0`: write `0 - x`, never `-x`, when negating coordinates (Vitest `toEqual` distinguishes them). [Gotcha hit in Slice 2.]
- TDD: write the failing test, watch it fail, minimal implementation, watch it pass, commit. One logical change per commit.
- Run `pnpm test` (Vitest) for unit tests; `pnpm typecheck` before each commit.
- This is Plan A of two. **No UI/store/Stage changes here** — that is Plan B. Do not touch `src/ui/**`.

---

### Task 1: `ShapeKeyframe` type + `shapeTrack` on `SceneObject` + `samplePath`

**Files:**
- Modify: `src/engine/types.ts` (add `ShapeKeyframe`, `SceneObject.shapeTrack`)
- Modify: `src/engine/path.ts` (add `samplePath` + private helpers)
- Test: `src/engine/path.test.ts`

**Interfaces:**
- Consumes: `PathData`, `PathNode`, `PathPoint` (types.ts), `Easing` (types.ts), `applyEasing` (engine/easing.ts).
- Produces:
  - `interface ShapeKeyframe { time: number; path: PathData; easing: Easing }`
  - `SceneObject.shapeTrack?: ShapeKeyframe[]`
  - `samplePath(track: ShapeKeyframe[], time: number): PathData`

- [ ] **Step 1: Add the types**

In `src/engine/types.ts`, after the `PathData` interface add:

```ts
/**
 * One shape keyframe: a full PathData snapshot at a time, with easing into the
 * NEXT keyframe. Adjacent keyframes MAY differ in node count (reconciled by
 * index-pad in samplePath). Easing is per-keyframe (not per-node) and defaults
 * to 'linear' at creation.
 */
export interface ShapeKeyframe {
  time: number;
  path: PathData;
  easing: Easing;
}
```

In the `SceneObject` interface, after the `shapeBase?` field add:

```ts
  /** Present iff this path object is being morphed. The asset's `path` is the
   *  static base, used only when this is absent/empty. */
  shapeTrack?: ShapeKeyframe[];
```

- [ ] **Step 2: Write the failing tests**

Append to `src/engine/path.test.ts` (it already imports from `./path` and `./types`):

```ts
import { samplePath } from './path';
import type { ShapeKeyframe } from './types';

describe('samplePath', () => {
  const square = (s: number): ShapeKeyframe => ({
    time: 0,
    easing: 'linear',
    path: { closed: true, nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: s, y: 0 } },
      { anchor: { x: s, y: s } },
      { anchor: { x: 0, y: s } },
    ] },
  });

  it('throws on an empty track', () => {
    expect(() => samplePath([], 0)).toThrow();
  });

  it('returns the lone snapshot for a single-keyframe track (static)', () => {
    const k = square(10);
    expect(samplePath([k], 5).nodes[1].anchor.x).toBe(10);
  });

  it('clamps before the first and after the last keyframe', () => {
    const a = { ...square(10), time: 1 };
    const b = { ...square(20), time: 3 };
    expect(samplePath([a, b], 0).nodes[1].anchor.x).toBe(10);
    expect(samplePath([a, b], 9).nodes[1].anchor.x).toBe(20);
  });

  it('linearly interpolates matched anchors at the midpoint', () => {
    const a = { ...square(10), time: 0 };
    const b = { ...square(20), time: 2 };
    expect(samplePath([a, b], 1).nodes[2].anchor).toEqual({ x: 15, y: 15 });
  });

  it('applies the FROM keyframe easing', () => {
    const a: ShapeKeyframe = { ...square(0), time: 0, easing: 'easeIn' };
    const b: ShapeKeyframe = { ...square(10), time: 1 };
    // easeIn at t=0.5 is < 0.5, so the value is pulled below the linear midpoint.
    expect(samplePath([a, b], 0.5).nodes[1].anchor.x).toBeLessThan(5);
  });

  it('holds `closed` from the FROM keyframe (no midpoint flip)', () => {
    const a: ShapeKeyframe = { ...square(10), time: 0, path: { ...square(10).path, closed: false } };
    const b: ShapeKeyframe = { ...square(10), time: 1, path: { ...square(10).path, closed: true } };
    expect(samplePath([a, b], 0.5).closed).toBe(false);
  });

  it('pads the shorter keyframe: extra nodes grow out of the last shared anchor', () => {
    const a: ShapeKeyframe = { time: 0, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
    ] } };
    const b: ShapeKeyframe = { time: 1, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
      { anchor: { x: 20, y: 0 } },
    ] } };
    // At t=0.5 the 3rd node interpolates from a's last anchor (10,0) toward (20,0).
    const out = samplePath([a, b], 0.5);
    expect(out.nodes).toHaveLength(3);
    expect(out.nodes[2].anchor).toEqual({ x: 15, y: 0 });
  });

  it('grows a handle from a corner (absent => zero offset)', () => {
    const a: ShapeKeyframe = { time: 0, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },                       // corner, no out handle
    ] } };
    const b: ShapeKeyframe = { time: 1, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 }, out: { x: 4, y: 0 } },   // smooth-ish
      { anchor: { x: 10, y: 0 } },
    ] } };
    expect(samplePath([a, b], 0.5).nodes[0].out).toEqual({ x: 2, y: 0 });
  });

  it('keeps a corner when both keyframes lack the handle', () => {
    const a: ShapeKeyframe = { time: 0, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } },
    ] } };
    const b: ShapeKeyframe = { time: 1, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } },
    ] } };
    expect(samplePath([a, b], 0.5).nodes[0].out).toBeUndefined();
    expect(samplePath([a, b], 0.5).nodes[0].in).toBeUndefined();
  });

  it('does not mutate its inputs', () => {
    const a = { ...square(10), time: 0 };
    const b = { ...square(20), time: 1 };
    const snapshot = JSON.stringify([a, b]);
    samplePath([a, b], 0.5);
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/engine/path.test.ts`
Expected: FAIL — `samplePath` is not exported.

- [ ] **Step 4: Implement `samplePath`**

In `src/engine/path.ts`, update the imports and append the implementation:

```ts
import { applyEasing } from './easing';
import type { PathData, PathNode, PathPoint, ShapeKeyframe } from './types';
```

(keep the existing `fmt` import; add `ShapeKeyframe` to the type import and the new `applyEasing` import.)

```ts
const ZERO: PathPoint = { x: 0, y: 0 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: PathPoint, b: PathPoint, t: number): PathPoint {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// Interpolate one node pair. An absent handle is treated as a zero offset; the
// interpolated handle is OMITTED (corner / straight segment) only when neither
// input had it, preserving pathToD's `L` shortcut.
function lerpNode(a: PathNode, b: PathNode, t: number): PathNode {
  const node: PathNode = { anchor: lerpPoint(a.anchor, b.anchor, t) };
  if (a.in || b.in) node.in = lerpPoint(a.in ?? ZERO, b.in ?? ZERO, t);
  if (a.out || b.out) node.out = lerpPoint(a.out ?? ZERO, b.out ?? ZERO, t);
  return node;
}

// Index-pad: lengthen `nodes` to `len` by repeating a degenerate corner node at
// the last anchor, so extra nodes morph as growing out of / retracting into a point.
function padNodes(nodes: PathNode[], len: number): PathNode[] {
  if (nodes.length >= len) return nodes;
  const last = nodes[nodes.length - 1];
  const padded = nodes.slice();
  while (padded.length < len) padded.push({ anchor: { x: last.anchor.x, y: last.anchor.y } });
  return padded;
}

// Pure morph oracle: interpolate a shape track to a PathData at `time`. Mirrors
// `interpolate`'s bracketing/clamp; the SINGLE definition shared by the Stage and
// the export runtime so a morph is byte-identical preview == export. `closed` is
// held from the FROM keyframe (no midpoint flip).
export function samplePath(track: ShapeKeyframe[], time: number): PathData {
  if (track.length === 0) {
    throw new Error('samplePath: track must contain at least one keyframe');
  }
  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first.time) return first.path;
  if (time >= last.time) return last.path;

  let a = first;
  let b = last;
  for (let i = 0; i < track.length - 1; i++) {
    if (time >= track[i].time && time < track[i + 1].time) {
      a = track[i];
      b = track[i + 1];
      break;
    }
  }

  const span = b.time - a.time;
  const rawProgress = span === 0 ? 0 : (time - a.time) / span;
  const t = applyEasing(a.easing, rawProgress);

  const len = Math.max(a.path.nodes.length, b.path.nodes.length);
  const an = padNodes(a.path.nodes, len);
  const bn = padNodes(b.path.nodes, len);
  const nodes: PathNode[] = [];
  for (let i = 0; i < len; i++) nodes.push(lerpNode(an[i], bn[i], t));
  return { nodes, closed: a.path.closed };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/engine/path.test.ts && pnpm typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/path.ts src/engine/path.test.ts
git commit -m "feat(engine): ShapeKeyframe + shapeTrack + pure samplePath morph oracle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `upsertShapeKeyframe` / `removeShapeKeyframeAt` pure helpers

**Files:**
- Modify: `src/engine/keyframes.ts`
- Test: `src/engine/keyframes.test.ts`

**Interfaces:**
- Consumes: `ShapeKeyframe` (types.ts), the existing `EPSILON` constant in `keyframes.ts`.
- Produces:
  - `upsertShapeKeyframe(track: ShapeKeyframe[], keyframe: ShapeKeyframe): ShapeKeyframe[]`
  - `removeShapeKeyframeAt(track: ShapeKeyframe[], time: number): ShapeKeyframe[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/keyframes.test.ts`:

```ts
import { upsertShapeKeyframe, removeShapeKeyframeAt } from './keyframes';
import type { ShapeKeyframe } from './types';

describe('shape keyframe track ops', () => {
  const kf = (time: number, x: number): ShapeKeyframe => ({
    time, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x, y: 0 } }] },
  });

  it('inserts in ascending time order without mutating the input', () => {
    const track = [kf(0, 0), kf(2, 2)];
    const next = upsertShapeKeyframe(track, kf(1, 1));
    expect(next.map((k) => k.time)).toEqual([0, 1, 2]);
    expect(track).toHaveLength(2); // unmutated
  });

  it('replaces a keyframe within EPSILON of the same time', () => {
    const next = upsertShapeKeyframe([kf(1, 1)], kf(1, 9));
    expect(next).toHaveLength(1);
    expect(next[0].path.nodes[0].anchor.x).toBe(9);
  });

  it('removes the keyframe at a time', () => {
    expect(removeShapeKeyframeAt([kf(0, 0), kf(1, 1)], 1).map((k) => k.time)).toEqual([0]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/engine/keyframes.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

In `src/engine/keyframes.ts`, add `ShapeKeyframe` to the type import and append:

```ts
import type { Keyframe, ShapeKeyframe } from './types';
```

```ts
export function upsertShapeKeyframe(
  track: ShapeKeyframe[],
  keyframe: ShapeKeyframe,
): ShapeKeyframe[] {
  return [
    ...track.filter((k) => Math.abs(k.time - keyframe.time) > EPSILON),
    keyframe,
  ].sort((a, b) => a.time - b.time);
}

export function removeShapeKeyframeAt(track: ShapeKeyframe[], time: number): ShapeKeyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > EPSILON);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/engine/keyframes.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/keyframes.ts src/engine/keyframes.test.ts
git commit -m "feat(engine): upsertShapeKeyframe + removeShapeKeyframeAt track ops

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `sampleObject` resolves `shapeTrack` into `RenderState.path`

**Files:**
- Modify: `src/engine/sample.ts`
- Test: `src/engine/sample.test.ts`

**Interfaces:**
- Consumes: `samplePath` (Task 1), `ShapeKeyframe`/`PathData` types.
- Produces: `RenderState.path?: PathData` (set only when `obj.shapeTrack?.length`).

- [ ] **Step 1: Write the failing test**

Append to `src/engine/sample.test.ts`:

```ts
import type { ShapeKeyframe } from './types';

describe('sampleObject path morphing', () => {
  const track: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] } },
    { time: 2, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] } },
  ];

  it('sets state.path from the shape track when present', () => {
    const obj = createSceneObject('asset-1', { anchorMode: 'fraction', shapeTrack: track });
    expect(sampleObject(obj, 1).path?.nodes[1].anchor.x).toBe(10);
  });

  it('omits state.path when there is no shape track', () => {
    const obj = createSceneObject('asset-1', { anchorMode: 'fraction' });
    expect(sampleObject(obj, 1).path).toBeUndefined();
  });
});
```

(If `createSceneObject` / `sampleObject` are not yet imported at the top of the test file, add them to the existing import from `./sample` and `./project`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/engine/sample.test.ts`
Expected: FAIL — `path` is always undefined.

- [ ] **Step 3: Implement**

In `src/engine/sample.ts`:

Add to the imports:
```ts
import { interpolate } from './interpolate';
import { samplePath } from './path';
import { ANIMATABLE_PROPERTIES, GEOMETRY_PROPERTIES } from './project';
import type {
  AnimatableProperty,
  PathData,
  Project,
  ResolvedGeometry,
  SceneObject,
  Transform2D,
  VectorShapeType,
} from './types';
```

Add `path?` to `RenderState`:
```ts
export interface RenderState extends Transform2D {
  objectId: string;
  /** Present only for vector objects that have geometry. */
  geometry?: ResolvedGeometry;
  /** Present only for path objects that have a shapeTrack (morphing). */
  path?: PathData;
}
```

In `sampleObject`, just before `return state;`, add:
```ts
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    state.path = samplePath(obj.shapeTrack, time);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/engine/sample.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/sample.ts src/engine/sample.test.ts
git commit -m "feat(engine): sampleObject resolves shapeTrack into RenderState.path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `computeProjectDuration` includes the shape track

**Files:**
- Modify: `src/engine/duration.ts`
- Test: `src/engine/duration.test.ts`

**Interfaces:**
- Consumes: `SceneObject.shapeTrack` (Task 1).
- Produces: auto-duration that is the max over scalar tracks, **shape track**, and audio clips.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/duration.test.ts`:

```ts
it('extends auto-duration to the last shape keyframe', () => {
  const obj = createSceneObject('a', {
    shapeTrack: [
      { time: 0, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }] } },
      { time: 4, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 1, y: 0 } }] } },
    ],
  });
  const project = { ...createProject(), objects: [obj] };
  expect(computeProjectDuration(project)).toBe(4);
});
```

(Ensure `createSceneObject` and `createProject` are imported in this test file.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/engine/duration.test.ts`
Expected: FAIL — returns `0` (shape track ignored).

- [ ] **Step 3: Implement**

In `src/engine/duration.ts`, after the existing `for (const track of Object.values(obj.tracks))` loop body (still inside the `for (const obj of project.objects)` loop), add:

```ts
    for (const keyframe of obj.shapeTrack ?? []) {
      if (keyframe.time > max) max = keyframe.time;
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/engine/duration.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/duration.ts src/engine/duration.test.ts
git commit -m "fix(engine): auto-duration includes path shape keyframes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `computeFrame` emits `pathD` + per-frame pivot from sampled bounds

**Files:**
- Modify: `src/runtime/frame.ts`
- Test: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `RenderState.path` (Task 3), `pathToD` + `pathBounds` (engine/path.ts), `resolveAnchor` (engine/sample.ts).
- Produces: `FrameItem.pathD?: string`; pivot resolved against `pathBounds(state.path ?? asset.path)`.

- [ ] **Step 1: Write the failing test**

Append to `src/runtime/frame.test.ts` (it already builds projects + calls `computeFrame`). Build a path asset + a morphed object:

```ts
import { samplePath, pathToD } from '../engine';
import type { ShapeKeyframe } from '../engine';

describe('computeFrame path morphing', () => {
  const k0 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
  const k2 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] };
  const shapeTrack: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: k0 },
    { time: 2, easing: 'linear', path: k2 },
  ];

  function morphProject() {
    const asset = createVectorAsset('path', { path: k0 });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack });
    return { ...createProject(), assets: [asset], objects: [obj] };
  }

  it('emits pathD equal to pathToD(sampled path) for morphed paths', () => {
    const project = morphProject();
    const item = computeFrame(project, 1)[0];
    expect(item.pathD).toBe(pathToD(samplePath(shapeTrack, 1)));
  });

  it('does NOT emit pathD for a static (no shapeTrack) path', () => {
    const asset = createVectorAsset('path', { path: k0 });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction' });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].pathD).toBeUndefined();
  });
});
```

(Add `createVectorAsset`, `createSceneObject`, `createProject` to this file's imports from `../engine` if not present.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/runtime/frame.test.ts`
Expected: FAIL — `pathD` undefined.

- [ ] **Step 3: Implement**

In `src/runtime/frame.ts`:

Add `pathToD` to the engine import:
```ts
import {
  buildTransform,
  fmt,
  geometryToSvgAttrs,
  pathBounds,
  pathToD,
  resolveAnchor,
  sampleProject,
} from '../engine';
```

Add `pathD` to `FrameItem`:
```ts
export interface FrameItem {
  objectId: string;
  transform: string;
  opacity: string;
  /** Present only for vector objects: SVG attribute name -> value for the inner shape. */
  geometry?: Record<string, string>;
  /** Present only for MORPHED path objects: the inner <path>'s `d` for this frame. */
  pathD?: string;
}
```

In `computeFrame`, change the `pathBox` computation to prefer the sampled path, and emit `pathD`:

```ts
    const pathBox =
      asset && asset.kind === 'vector' && asset.shapeType === 'path'
        ? pathBounds(state.path ?? asset.path ?? { nodes: [], closed: false })
        : undefined;
    const { anchorX, anchorY } = resolveAnchor(obj, state, shapeType, pathBox);
    const item: FrameItem = {
      objectId: state.objectId,
      transform: buildTransform(state, anchorX, anchorY),
      opacity: fmt(state.opacity),
    };
    if (shapeType && shapeType !== 'path' && state.geometry) {
      item.geometry = geometryToSvgAttrs(shapeType, state.geometry);
    }
    if (state.path) {
      item.pathD = pathToD(state.path);
    }
    return item;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/runtime/frame.test.ts && pnpm typecheck`
Expected: PASS. (Static-path and rect/ellipse existing tests still green — `state.path` is only set when morphing.)

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts
git commit -m "feat(runtime): computeFrame emits pathD + per-frame pivot from sampled bounds

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `applyFrameToNodes` sets the morphed `d` + regenerate the runtime bundle

**Files:**
- Modify: `src/runtime/frame.ts`
- Modify (generated): `src/runtime/runtimeSource.generated.ts`
- Test: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `FrameItem.pathD` (Task 5).
- Produces: `applyFrameToNodes` sets the inner `<path>`'s `d` attribute when `pathD` is present.

- [ ] **Step 1: Write the failing test**

Append to `src/runtime/frame.test.ts`:

```ts
describe('applyFrameToNodes path d', () => {
  it('sets the inner shape `d` when pathD is present', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-savig-object', 'obj-1');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    g.appendChild(path);
    const nodes = new Map<string, Element>([['obj-1', g]]);
    applyFrameToNodes(nodes, [
      { objectId: 'obj-1', transform: '', opacity: '1', pathD: 'M 0 0 L 5 0' },
    ]);
    expect(path.getAttribute('d')).toBe('M 0 0 L 5 0');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/runtime/frame.test.ts`
Expected: FAIL — `d` is null.

- [ ] **Step 3: Implement**

In `src/runtime/frame.ts`, inside `applyFrameToNodes`'s loop, after the `if (item.geometry) { … }` block add:

```ts
    if (item.pathD !== undefined) {
      const shape = node.firstElementChild;
      if (shape) shape.setAttribute('d', item.pathD);
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/runtime/frame.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Regenerate the committed runtime bundle**

The standalone export player is bundled from `frame.ts` via esbuild into a committed source file. Regenerate it so the exported bundle picks up the per-frame `d` update:

Run: `pnpm build:runtime`
Expected: `src/runtime/runtimeSource.generated.ts` is rewritten (its minified body now contains the `setAttribute("d", …)` logic). Sanity check:

Run: `git diff --stat src/runtime/runtimeSource.generated.ts`
Expected: the generated file shows as modified.

- [ ] **Step 6: Run the full engine + runtime suite**

Run: `pnpm test src/engine src/runtime && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "feat(runtime): applyFrameToNodes sets morphed path d; regenerate bundle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Export renders the sampled-at-0 path (initial DOM matches frame 0)

**Files:**
- Modify: `src/services/export/renderDocument.ts`
- Test: `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `RenderState.path` (Task 3), `pathBounds`/`renderShapeToSvg` (engine).
- Produces: the export's initial `<g><path d>` uses `state.path ?? asset.path`, so the static markup equals frame 0 of a morph (the runtime then animates `d`).

- [ ] **Step 1: Write the failing test**

Append to `src/services/export/renderDocument.test.ts` a morphed-path case whose first keyframe differs from the asset base:

```ts
import { samplePath, pathToD } from '../../engine';
import type { ShapeKeyframe } from '../../engine';

it('renders the sampled-at-0 path d for a morphed path', () => {
  const base = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 1, y: 0 } }] };
  const shapeTrack: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 9, y: 0 } }] } },
    { time: 1, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] } },
  ];
  const asset = createVectorAsset('path', { path: base });
  const obj = createSceneObject(asset.id, { anchorMode: 'fraction', shapeTrack });
  const project = { ...createProject(), assets: [asset], objects: [obj] };
  const svg = renderSvgDocument(project);
  // The emitted d must be frame 0 of the morph, NOT the asset base.
  expect(svg).toContain(`d="${pathToD(samplePath(shapeTrack, 0))}"`);
  expect(svg).not.toContain(`d="${pathToD(base)}"`);
});
```

(Reuse whatever import names the file already uses for `renderSvgDocument`, `createVectorAsset`, `createSceneObject`, `createProject`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/services/export/renderDocument.test.ts`
Expected: FAIL — export still emits the asset base `d`.

- [ ] **Step 3: Implement**

In `src/services/export/renderDocument.ts`, in the `asset.kind === 'vector'` branch, prefer the sampled path for both the bounds and the markup:

```ts
      if (asset.kind === 'vector') {
        const framePath = asset.shapeType === 'path' ? state.path ?? asset.path : undefined;
        const pathBox = framePath ? pathBounds(framePath) : undefined;
        const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
        const transform = buildTransform(state, anchorX, anchorY);
        const shape = renderShapeToSvg(asset.shapeType, state.geometry ?? {}, asset.style, framePath);
        return `<g data-savig-object="${obj.id}" transform="${transform}" opacity="${fmt(state.opacity)}">${shape}</g>`;
      }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/services/export/renderDocument.test.ts && pnpm typecheck`
Expected: PASS. (Static path + rect/ellipse export tests still green — `state.path` is undefined without a shapeTrack, so it falls back to `asset.path`.)

- [ ] **Step 5: Commit**

```bash
git add src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(export): morphed path initial DOM uses sampled-at-0 path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Persistence migration v3 → v4

**Files:**
- Modify: `src/engine/project.ts` (`createProject` version `3` → `4`)
- Modify: `src/services/persistence/migrate.ts` (`CURRENT_VERSION`, add `3:` upgrader)
- Test: `src/services/persistence/migrate.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CURRENT_VERSION = 4`; a no-op `3 → 4` upgrader (old files have no `shapeTrack`, which is optional).

- [ ] **Step 1: Write the failing test**

Append to `src/services/persistence/migrate.test.ts`:

```ts
it('migrates a v3 project (no shapeTrack) to v4 unchanged except version', () => {
  const v3 = { ...createProject(), meta: { ...createProject().meta, version: 3 } };
  const migrated = migrateProject(v3);
  expect(migrated.meta.version).toBe(4);
  expect(migrated.objects).toEqual(v3.objects);
});
```

(Reuse the file's existing imports for `createProject` and `migrateProject`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/services/persistence/migrate.test.ts`
Expected: FAIL — `CURRENT_VERSION` is 3, so a v3 doc is returned with version 3 (and `createProject()` now needs to be 4 for the test's baseline; expect a mismatch / no-migration error).

- [ ] **Step 3: Implement**

In `src/engine/project.ts`, bump the default version:
```ts
    version: 4,
```

In `src/services/persistence/migrate.ts`:
```ts
export const CURRENT_VERSION = 4;
```
and add the `3:` upgrader to the `migrations` map (and extend the comment):
```ts
// v3 -> v4 introduced animatable path shape (shapeTrack on objects, optional);
// old files have none, so the upgrade only stamps the version.
export const migrations: Record<number, (doc: Project) => Project> = {
  1: (doc) => ({ ...doc, meta: { ...doc.meta, version: 2 } }),
  2: (doc) => ({ ...doc, meta: { ...doc.meta, version: 3 } }),
  3: (doc) => ({ ...doc, meta: { ...doc.meta, version: 4 } }),
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/services/persistence/migrate.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Full suite + lint + build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green. (`pnpm build` also confirms the regenerated runtime bundle type-checks.)

- [ ] **Step 6: Commit**

```bash
git add src/engine/project.ts src/services/persistence/migrate.ts src/services/persistence/migrate.test.ts
git commit -m "feat(persistence): bump project version v3->v4 (no-op upgrader for shapeTrack)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (engine/pipeline portions of §3, §4, §6, §9):**
- §2 `ShapeKeyframe` + `shapeTrack` → Task 1. ✅
- §3.1 `samplePath` (clamp, easing, index-pad, handle growth, `closed` hold-from, immutability) → Task 1. ✅
- §3.2 per-frame pivot from sampled bounds → Task 5. ✅
- §3.3 `RenderState.path` from `sampleObject` → Task 3. ✅
- §3.4 `computeProjectDuration` includes `shapeTrack` → Task 4. ✅
- §4 runtime `pathD` (`computeFrame` + `applyFrameToNodes`) + bundle regen → Tasks 5–6. ✅
- §4 export sampled-at-0 initial DOM → Task 7. ✅
- §5.1 `upsertShapeKeyframe`/`removeShapeKeyframeAt` pure helpers (consumed by Plan B's store) → Task 2. ✅
- §6 v3→v4 migration → Task 8. ✅
- §9 parity: Task 5 asserts `computeFrame.pathD === pathToD(samplePath(...))`, Task 6 asserts `applyFrameToNodes` sets that same `d`, Task 7 asserts the export emits `pathToD(samplePath(...,0))` — together these lock Stage(future)/export/runtime to one `d` per `t`. ✅
- **Out of Plan A scope (Plan B):** node-edit routing, `addShapeKeyframe`/`removeShapeKeyframe` store actions, discriminated `KeyframeRef`, timeline lane, Inspector, context-aware Delete, Playwright morph e2e. The store will consume Task 2's pure helpers + Task 1's `samplePath`.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `ShapeKeyframe { time; path; easing }`, `SceneObject.shapeTrack?`, `RenderState.path?`, `FrameItem.pathD?`, `samplePath(track, time)`, `upsertShapeKeyframe(track, keyframe)`, `removeShapeKeyframeAt(track, time)` are used identically across Tasks 1–8. ✅

**Note on `pathBounds` empty guard (Task 5):** `pathBounds` already returns a zero box for empty nodes, but a path object with neither `state.path` nor `asset.path` would pass `undefined`; the `?? { nodes: [], closed: false }` fallback keeps it total. A path object should always have one of them, so this is defensive only.
