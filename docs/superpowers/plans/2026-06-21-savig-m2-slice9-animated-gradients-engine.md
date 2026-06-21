# Slice 9 Animated Gradients — Plan A (Engine & Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a vector object's fill/stroke gradient animate over the timeline — stops (color/offset/opacity) and geometry — through the engine, runtime, and export, with preview == export.

**Architecture:** Add an optional `gradientTracks` field on `SceneObject` (the fourth "animate-a-thing" seam after shapeTrack/colorTracks/motionPath). A pure `interpolateGradient`/`sampleGradient` (reusing `interpolateColor`) resolves a per-frame `Gradient` in `sampleObject`; `computeFrame` carries it on `FrameItem`; `applyFrameToNodes` mutates the gradient `<defs>` element by id; export emits the def sampled at t=0. No persistence migration (stays v4).

**Tech Stack:** TypeScript (strict), Vitest, the existing `src/engine` pure core + `src/runtime` DOM applier + `src/services/export` document renderer.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- All emitted SVG numbers go through `fmt()`; all colors/attr values through `escapeAttr()`.
- Pure engine modules (`src/engine/*`) stay framework- and DOM-free EXCEPT the runtime applier (`src/runtime/frame.ts`), which may touch the DOM.
- Gradient element id scheme (unchanged): `savig-grad-<objectId>-<fill|stroke>`.
- Paint precedence invariant: a gradient (static OR animated) always beats a solid color (static OR color-track) for the same property.
- The object's shape stays the wrapper `<g>`'s `firstElementChild`; gradient defs live in the top-level `<defs>` (export) / as a sibling after the shape (Stage) — never before the shape.
- No persistence version bump (project stays v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build`.

---

### Task 1: Data model — `GradientKeyframe` + `gradientTracks`

**Files:**
- Modify: `src/engine/types.ts` (add `GradientKeyframe`; add `gradientTracks` to `SceneObject`)
- Test: `src/engine/types.test.ts` does not exist — assert via a compile-only usage in `src/engine/gradientAnim.test.ts` (Task 3). This task is types only; verify with `pnpm typecheck`.

**Interfaces:**
- Produces: `GradientKeyframe { time: number; gradient: Gradient; easing: Easing }`; `SceneObject.gradientTracks?: Partial<Record<ColorProperty, GradientKeyframe[]>>`.

- [ ] **Step 1: Add the `GradientKeyframe` interface**

In `src/engine/types.ts`, immediately after the `Gradient` type (after line `export type Gradient = LinearGradient | RadialGradient;`):

```ts
export interface GradientKeyframe {
  /** Seconds from the start of the timeline. */
  time: number;
  /** A full gradient snapshot (linear or radial) at this keyframe. */
  gradient: Gradient;
  /** Governs the outbound transition from this keyframe (like ColorKeyframe). */
  easing: Easing;
}
```

- [ ] **Step 2: Add the field to `SceneObject`**

In `SceneObject`, immediately after the `colorTracks` field:

```ts
  /** Per-property animated gradients for vector objects. Absent property -> the
   *  asset's static VectorStyle gradient (or solid paint) stands. A non-empty
   *  track governs that property's paint over time. */
  gradientTracks?: Partial<Record<ColorProperty, GradientKeyframe[]>>;
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (no usages yet; type-only addition).

- [ ] **Step 4: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(slice9): GradientKeyframe type + gradientTracks on SceneObject"
```

---

### Task 2: Refactor `gradient.ts` into reusable pieces (no output change)

**Files:**
- Modify: `src/engine/gradient.ts`
- Test: `src/engine/gradient.test.ts`

**Interfaces:**
- Produces: `gradientStopAttrs(s: GradientStop): Record<string, string>` (a stop's RAW attributes — `offset`, `stop-color`, and `stop-opacity` only when `< 1`; the single source of truth for a stop, used by both the string emitter and the DOM builder); `gradientAttrs(g: Gradient): Record<string, string>` (the gradient element's coordinate attributes, NOT including `id`); `gradientStopsMarkup(g: Gradient): string` (the `<stop>` children markup). `gradientToSvg` is recomposed from these with identical output.

- [ ] **Step 1: Write failing tests for the new helpers**

Append to `src/engine/gradient.test.ts`:

```ts
import { gradientAttrs, gradientStopsMarkup, gradientStopAttrs } from './gradient';

describe('gradientStopAttrs', () => {
  it('returns raw offset + color, omitting stop-opacity when >= 1', () => {
    expect(gradientStopAttrs({ offset: 0.25, color: '#ff0000' })).toEqual({ offset: '0.25', 'stop-color': '#ff0000' });
    expect(gradientStopAttrs({ offset: 0.25, color: '#ff0000', opacity: 1 })).toEqual({ offset: '0.25', 'stop-color': '#ff0000' });
  });
  it('includes stop-opacity when < 1', () => {
    expect(gradientStopAttrs({ offset: 1, color: '#0000ff', opacity: 0.5 })).toEqual({ offset: '1', 'stop-color': '#0000ff', 'stop-opacity': '0.5' });
  });
});

describe('gradientAttrs', () => {
  it('returns linear coordinate attrs (no id)', () => {
    expect(
      gradientAttrs({ type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [] }),
    ).toEqual({ x1: '0', y1: '0.5', x2: '1', y2: '0.5' });
  });

  it('returns radial attrs, omitting absent focal point', () => {
    expect(
      gradientAttrs({ type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [] }),
    ).toEqual({ cx: '0.5', cy: '0.5', r: '0.5' });
  });

  it('includes focal point when present', () => {
    expect(
      gradientAttrs({ type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, fx: 0.2, fy: 0.3, stops: [] }),
    ).toEqual({ cx: '0.5', cy: '0.5', r: '0.5', fx: '0.2', fy: '0.3' });
  });
});

describe('gradientStopsMarkup', () => {
  it('renders stops, emitting stop-opacity only when < 1', () => {
    expect(
      gradientStopsMarkup({
        type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff', opacity: 0.5 },
        ],
      }),
    ).toBe('<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/>');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/gradient.test.ts`
Expected: FAIL — `gradientAttrs`/`gradientStopsMarkup` are not exported.

- [ ] **Step 3: Refactor `gradient.ts` to expose the pieces**

Replace the body of `src/engine/gradient.ts` from `function stopToSvg` through the end of `gradientToSvg` with:

```ts
/** A stop's RAW attributes (offset/stop-color, stop-opacity only when < 1). The
 *  single source of truth for a stop, shared by the string emitter (with
 *  escapeAttr) and the runtime DOM builder (setAttribute, which auto-escapes). */
export function gradientStopAttrs(s: GradientStop): Record<string, string> {
  const attrs: Record<string, string> = {
    offset: fmt(clamp01(s.offset)),
    'stop-color': s.color,
  };
  if (s.opacity !== undefined && s.opacity < 1) attrs['stop-opacity'] = fmt(clamp01(s.opacity));
  return attrs;
}

function stopToSvg(s: GradientStop): string {
  const attrStr = Object.entries(gradientStopAttrs(s))
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<stop ${attrStr}/>`;
}

/** The gradient element's coordinate attributes (no id, no stops). */
export function gradientAttrs(g: Gradient): Record<string, string> {
  if (g.type === 'linear') {
    return { x1: fmt(g.x1), y1: fmt(g.y1), x2: fmt(g.x2), y2: fmt(g.y2) };
  }
  const attrs: Record<string, string> = { cx: fmt(g.cx), cy: fmt(g.cy), r: fmt(g.r) };
  if (g.fx !== undefined) attrs.fx = fmt(g.fx);
  if (g.fy !== undefined) attrs.fy = fmt(g.fy);
  return attrs;
}

/** The `<stop>` children markup for a gradient. */
export function gradientStopsMarkup(g: Gradient): string {
  return g.stops.map(stopToSvg).join('');
}

/**
 * Emit a <linearGradient>/<radialGradient> def with <stop> children. No
 * gradientUnits attribute (objectBoundingBox default). Pure: numbers via fmt,
 * colors via escapeAttr; offset/opacity clamped to [0,1].
 */
export function gradientToSvg(id: string, g: Gradient): string {
  const stops = gradientStopsMarkup(g);
  const attrs = Object.entries(gradientAttrs(g))
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  const tag = g.type === 'linear' ? 'linearGradient' : 'radialGradient';
  return `<${tag} id="${escapeAttr(id)}" ${attrs}>${stops}</${tag}>`;
}
```

- [ ] **Step 4: Run all gradient tests (new + unchanged output)**

Run: `pnpm vitest run src/engine/gradient.test.ts`
Expected: PASS — new helper tests pass AND the pre-existing `gradientToSvg` tests still pass (byte-identical output).

- [ ] **Step 5: Commit**

```bash
git add src/engine/gradient.ts src/engine/gradient.test.ts
git commit -m "refactor(slice9): extract gradientAttrs/gradientStopsMarkup from gradientToSvg"
```

---

### Task 3: Pure interpolation — `engine/gradientAnim.ts`

**Files:**
- Create: `src/engine/gradientAnim.ts`
- Create: `src/engine/gradientAnim.test.ts`
- Modify: `src/engine/index.ts` (barrel export)

**Interfaces:**
- Consumes: `interpolateColor` (from `./color`), `applyEasing` (from `./easing`), `GradientKeyframe`/`Gradient` (from `./types`).
- Produces: `interpolateGradient(a: Gradient, b: Gradient, t: number): Gradient`; `sampleGradient(track: GradientKeyframe[], time: number): Gradient`.

- [ ] **Step 1: Write the failing tests**

Create `src/engine/gradientAnim.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpolateGradient, sampleGradient } from './gradientAnim';
import type { Gradient, GradientKeyframe } from './types';

const lin = (x2: number, stops: Gradient['stops']): Gradient => ({
  type: 'linear', x1: 0, y1: 0, x2, y2: 0, stops,
});

describe('interpolateGradient', () => {
  it('lerps coords, offsets, opacity and stop colors at t=0.5', () => {
    const a = lin(0, [{ offset: 0, color: '#000000' }, { offset: 0.5, color: '#000000', opacity: 0 }]);
    const b = lin(1, [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#ffffff', opacity: 1 }]);
    const r = interpolateGradient(a, b, 0.5);
    expect(r.type).toBe('linear');
    expect((r as Extract<Gradient, { type: 'linear' }>).x2).toBeCloseTo(0.5);
    expect(r.stops[0].color).toBe('#808080');
    expect(r.stops[1].offset).toBeCloseTo(0.75);
    expect(r.stops[1].opacity).toBeCloseTo(0.5);
  });

  it('STEPS-holds when types differ (a until t>=1)', () => {
    const a = lin(1, [{ offset: 0, color: '#000000' }]);
    const b: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#fff' }] };
    expect(interpolateGradient(a, b, 0.4)).toEqual(a);
    expect(interpolateGradient(a, b, 1)).toEqual(b);
  });

  it('STEPS-holds when stop counts differ', () => {
    const a = lin(0, [{ offset: 0, color: '#000000' }]);
    const b = lin(1, [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }]);
    expect(interpolateGradient(a, b, 0.4)).toEqual(a);
    expect(interpolateGradient(a, b, 1)).toEqual(b);
  });

  it('holds radial focal point when only one endpoint defines it', () => {
    const a: Gradient = { type: 'radial', cx: 0, cy: 0, r: 1, stops: [{ offset: 0, color: '#000000' }] };
    const b: Gradient = { type: 'radial', cx: 0, cy: 0, r: 1, fx: 0.4, fy: 0.4, stops: [{ offset: 0, color: '#000000' }] };
    const r = interpolateGradient(a, b, 0.5) as Extract<Gradient, { type: 'radial' }>;
    expect(r.fx).toBeUndefined();
  });
});

describe('sampleGradient', () => {
  const track: GradientKeyframe[] = [
    { time: 0, gradient: lin(0, [{ offset: 0, color: '#000000' }, { offset: 1, color: '#000000' }]), easing: 'linear' },
    { time: 2, gradient: lin(1, [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#ffffff' }]), easing: 'linear' },
  ];

  it('clamps before first and after last', () => {
    expect(sampleGradient(track, -1)).toEqual(track[0].gradient);
    expect(sampleGradient(track, 5)).toEqual(track[1].gradient);
  });

  it('brackets and applies easing at the midpoint', () => {
    const r = sampleGradient(track, 1);
    expect(r.stops[0].color).toBe('#808080');
  });

  it('throws on an empty track', () => {
    expect(() => sampleGradient([], 0)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/gradientAnim.test.ts`
Expected: FAIL — module `./gradientAnim` not found.

- [ ] **Step 3: Implement `gradientAnim.ts`**

Create `src/engine/gradientAnim.ts`:

```ts
import { applyEasing } from './easing';
import { interpolateColor } from './color';
import type { Gradient, GradientKeyframe, GradientStop } from './types';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function lerpStops(a: GradientStop[], b: GradientStop[], t: number): GradientStop[] {
  return a.map((sa, i) => {
    const sb = b[i];
    const stop: GradientStop = {
      offset: lerp(sa.offset, sb.offset, t),
      color: interpolateColor(sa.color, sb.color, t),
    };
    const oa = sa.opacity ?? 1;
    const ob = sb.opacity ?? 1;
    if (oa !== 1 || ob !== 1) stop.opacity = lerp(oa, ob, t);
    return stop;
  });
}

/**
 * Interpolate two gradients. STEPS-holds (returns `a` until t>=1, then `b`) when
 * the gradients are not smoothly interpolable: different type, or different stop
 * count. Otherwise lerps geometry, per-stop offset/opacity, and colors (via
 * interpolateColor, inheriting its hold-on-unparseable behavior).
 */
export function interpolateGradient(a: Gradient, b: Gradient, t: number): Gradient {
  if (a.type !== b.type || a.stops.length !== b.stops.length) {
    return t >= 1 ? b : a;
  }
  const stops = lerpStops(a.stops, b.stops, t);
  if (a.type === 'linear' && b.type === 'linear') {
    return {
      type: 'linear',
      x1: lerp(a.x1, b.x1, t), y1: lerp(a.y1, b.y1, t),
      x2: lerp(a.x2, b.x2, t), y2: lerp(a.y2, b.y2, t),
      stops,
    };
  }
  if (a.type === 'radial' && b.type === 'radial') {
    const out: Gradient = {
      type: 'radial',
      cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), r: lerp(a.r, b.r, t),
      stops,
    };
    // Focal point lerps only when BOTH endpoints define it; otherwise held absent.
    if (a.fx !== undefined && b.fx !== undefined) out.fx = lerp(a.fx, b.fx, t);
    if (a.fy !== undefined && b.fy !== undefined) out.fy = lerp(a.fy, b.fy, t);
    return out;
  }
  return t >= 1 ? b : a; // unreachable given the type guard above
}

/**
 * Resolve a gradient track to a Gradient at `time`. Mirrors sampleColor's
 * bracket/clamp/per-keyframe-easing.
 */
export function sampleGradient(track: GradientKeyframe[], time: number): Gradient {
  if (track.length === 0) {
    throw new Error('sampleGradient: track must contain at least one keyframe');
  }
  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first.time) return first.gradient;
  if (time >= last.time) return last.gradient;
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
  const raw = span === 0 ? 0 : (time - a.time) / span;
  return interpolateGradient(a.gradient, b.gradient, applyEasing(a.easing, raw));
}
```

- [ ] **Step 4: Add the barrel export**

In `src/engine/index.ts`, after `export * from './gradient';`:

```ts
export * from './gradientAnim';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/engine/gradientAnim.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/engine/gradientAnim.ts src/engine/gradientAnim.test.ts src/engine/index.ts
git commit -m "feat(slice9): interpolateGradient + sampleGradient (reuses interpolateColor)"
```

---

### Task 4: Resolve the gradient in `sampleObject`

**Files:**
- Modify: `src/engine/sample.ts`
- Test: `src/engine/sample.test.ts`

**Interfaces:**
- Consumes: `sampleGradient` (Task 3), `obj.gradientTracks` (Task 1).
- Produces: `RenderState.fillGradient?: Gradient`, `RenderState.strokeGradient?: Gradient`, populated when a non-empty track exists.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/sample.test.ts` (adapt the object factory to the file's existing helper; a minimal object with `gradientTracks` is shown inline):

```ts
import { sampleGradient } from './gradientAnim';

describe('sampleObject gradientTracks', () => {
  it('resolves fillGradient from a non-empty track', () => {
    const g0: Gradient = { type: 'linear', x1: 0, y1: 0, x2: 0, y2: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#000000' }] };
    const g1: Gradient = { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#ffffff' }] };
    const obj = makeObject({
      gradientTracks: { fill: [
        { time: 0, gradient: g0, easing: 'linear' },
        { time: 2, gradient: g1, easing: 'linear' },
      ] },
    });
    const state = sampleObject(obj, 1);
    expect(state.fillGradient).toEqual(sampleGradient(obj.gradientTracks!.fill!, 1));
    expect(state.strokeGradient).toBeUndefined();
  });

  it('leaves both gradients undefined when no track exists', () => {
    const state = sampleObject(makeObject({}), 0);
    expect(state.fillGradient).toBeUndefined();
    expect(state.strokeGradient).toBeUndefined();
  });
});
```

> If `sample.test.ts` lacks a `makeObject` helper, reuse the existing factory the colorTracks tests use (search the file for `colorTracks` and copy that object shape, swapping in `gradientTracks`). `Gradient` is imported from `./types`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/sample.test.ts`
Expected: FAIL — `state.fillGradient` is `undefined` (property not set / not on type).

- [ ] **Step 3: Add the fields to `RenderState` and resolution to `sampleObject`**

In `src/engine/sample.ts`:

1. Add the import near the other sample imports:

```ts
import { sampleGradient } from './gradientAnim';
import type { Gradient } from './types';
```

(Add `Gradient` to the existing `import type { … } from './types'` list if cleaner; either compiles.)

2. Extend `RenderState`, after the `fill?`/`stroke?` fields:

```ts
  /** Present only for vector objects with an animated fill/stroke gradient track. */
  fillGradient?: Gradient;
  strokeGradient?: Gradient;
```

3. In `sampleObject`, immediately after the `colorTracks` block (after its closing `}`), add:

```ts
  if (obj.gradientTracks) {
    const fillTrack = obj.gradientTracks.fill;
    if (fillTrack && fillTrack.length > 0) state.fillGradient = sampleGradient(fillTrack, time);
    const strokeTrack = obj.gradientTracks.stroke;
    if (strokeTrack && strokeTrack.length > 0) state.strokeGradient = sampleGradient(strokeTrack, time);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/engine/sample.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/sample.ts src/engine/sample.test.ts
git commit -m "feat(slice9): sampleObject resolves animated fill/stroke gradients"
```

---

### Task 5: `FrameItem` + `computeFrame` guard + `applyFrameToNodes` def mutation

**Files:**
- Modify: `src/runtime/frame.ts`
- Test: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `state.fillGradient`/`state.strokeGradient` (Task 4); `gradientAttrs`/`gradientStopAttrs` (Task 2).
- Produces: `FrameItem.fillGradient?: Gradient`, `FrameItem.strokeGradient?: Gradient`; `applyFrameToNodes` updates the gradient `<defs>` element by id.

- [ ] **Step 1: Write the failing tests**

Append to `src/runtime/frame.test.ts` (the file already builds projects + a jsdom SVG tree for `applyFrameToNodes` — reuse its helpers):

```ts
describe('computeFrame animated gradients', () => {
  it('carries the sampled gradient on the FrameItem and suppresses a color track', () => {
    const project = makeProjectWithGradientTrack(); // fill gradient track + a fill color track
    const item = computeFrame(project, 1).find((i) => i.objectId === 'o1')!;
    expect(item.fillGradient).toBeDefined();
    expect(item.fill).toBeUndefined(); // gradient beats the color track
  });
});

describe('applyFrameToNodes gradient def', () => {
  it('updates the gradient element coords + stops by id', () => {
    // <svg><defs><linearGradient id="savig-grad-o1-fill"><stop/></linearGradient></defs>
    //   <g data-savig-object="o1"><rect/></g></svg>
    const { svg, nodes } = buildSvgWithGradientDef('savig-grad-o1-fill');
    const g: Gradient = { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, color: '#112233' }, { offset: 1, color: '#445566' }] };
    applyFrameToNodes(nodes, [{ objectId: 'o1', transform: 'translate(0,0)', opacity: '1', fillGradient: g }]);
    const def = svg.querySelector('#savig-grad-o1-fill')!;
    expect(def.getAttribute('x2')).toBe('1');
    expect(def.querySelectorAll('stop').length).toBe(2);
    expect(def.querySelector('stop')!.getAttribute('stop-color')).toBe('#112233');
  });
});
```

> Add small local helpers `makeProjectWithGradientTrack` and `buildSvgWithGradientDef(id)` near the top of the test file. `buildSvgWithGradientDef` parses an SVG string with `DOMParser` (already used elsewhere in the suite) and returns `{ svg, nodes }` where `nodes = new Map([['o1', svg.querySelector('[data-savig-object="o1"]')!]])`. `Gradient` is imported from `../engine`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: FAIL — `item.fillGradient` undefined / `applyFrameToNodes` does not touch the def.

- [ ] **Step 3: Extend `FrameItem`, `computeFrame`, and `applyFrameToNodes`**

In `src/runtime/frame.ts`:

1. Imports — add `gradientAttrs`, `gradientStopAttrs` to the `from '../engine'` import, and `Gradient` to the type import:

```ts
import {
  buildTransform,
  fmt,
  geometryToSvgAttrs,
  gradientAttrs,
  gradientStopAttrs,
  pathBounds,
  pathToD,
  resolveAnchor,
  sampleProject,
} from '../engine';
import type { Gradient, Project } from '../engine';
```

> Confirm `gradientStopAttrs` is exported from the engine barrel (`src/engine/index.ts` already re-exports `./gradient`, so it is).

2. Extend `FrameItem`, after the `fill?`/`stroke?` fields:

```ts
  /** Present only for vector objects with an animated fill/stroke gradient track. */
  fillGradient?: Gradient;
  strokeGradient?: Gradient;
```

3. In `computeFrame`, extend the gradient-suppress guard and carry the gradient. Replace the existing block:

```ts
    const hasFillGradient = asset?.kind === 'vector' && !!asset.style.fillGradient;
    const hasStrokeGradient = asset?.kind === 'vector' && !!asset.style.strokeGradient;
    if (state.fill !== undefined && !hasFillGradient) item.fill = state.fill;
    if (state.stroke !== undefined && !hasStrokeGradient) item.stroke = state.stroke;
```

with:

```ts
    const hasFillGradient =
      (asset?.kind === 'vector' && !!asset.style.fillGradient) || state.fillGradient !== undefined;
    const hasStrokeGradient =
      (asset?.kind === 'vector' && !!asset.style.strokeGradient) || state.strokeGradient !== undefined;
    if (state.fill !== undefined && !hasFillGradient) item.fill = state.fill;
    if (state.stroke !== undefined && !hasStrokeGradient) item.stroke = state.stroke;
    if (state.fillGradient !== undefined) item.fillGradient = state.fillGradient;
    if (state.strokeGradient !== undefined) item.strokeGradient = state.strokeGradient;
```

4. Add a DOM helper above `applyFrameToNodes`:

```ts
const SVG_NS = 'http://www.w3.org/2000/svg';

// Mutate a gradient <defs> element in place: imperative coordinate attrs + fully
// rebuilt <stop> children (robust to stop-count changes across keyframes). Stops
// are built via createElementNS (NOT innerHTML — SVG-namespaced innerHTML is
// unreliable in jsdom) and share gradientStopAttrs with the string emitter, so
// runtime == export == Stage by construction.
function applyGradientToElement(node: Element, id: string, g: Gradient): void {
  const root = node.ownerSVGElement ?? (node.getRootNode() as Document | null);
  const def = root && 'querySelector' in root ? root.querySelector(`#${CSS.escape(id)}`) : null;
  if (!def) return; // defensive: never throw mid-frame if the def is missing
  for (const [attr, value] of Object.entries(gradientAttrs(g))) {
    def.setAttribute(attr, value);
  }
  while (def.firstChild) def.removeChild(def.firstChild);
  const doc = def.ownerDocument;
  for (const s of g.stops) {
    const stop = doc.createElementNS(SVG_NS, 'stop');
    for (const [attr, value] of Object.entries(gradientStopAttrs(s))) {
      stop.setAttribute(attr, value);
    }
    def.appendChild(stop);
  }
}
```

5. Inside `applyFrameToNodes`'s loop, after the `item.fill`/`item.stroke` block, add:

```ts
    if (item.fillGradient) applyGradientToElement(node, `savig-grad-${item.objectId}-fill`, item.fillGradient);
    if (item.strokeGradient) applyGradientToElement(node, `savig-grad-${item.objectId}-stroke`, item.strokeGradient);
```

> Note on `CSS.escape`: available in jsdom and all runtime browsers. The ids are alphanumeric+hyphen, so escaping is a no-op in practice but keeps the selector safe.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts
git commit -m "feat(slice9): FrameItem gradients + applyFrameToNodes updates gradient defs"
```

---

### Task 6: Export emits the gradient def sampled at t=0 (track-only objects too)

**Files:**
- Modify: `src/engine/renderShape.ts` (force gradient paint when flagged)
- Modify: `src/services/export/renderDocument.ts`
- Test: `src/services/export/renderDocument.test.ts`, `src/engine/renderShape.test.ts`

**Interfaces:**
- Consumes: `state.fillGradient`/`state.strokeGradient` (Task 4), `gradientToSvg` (Task 2).
- Produces: `renderShapeToSvg(..., idScope?, gradientPaint?: { fill?: boolean; stroke?: boolean })` — when `gradientPaint.fill`/`.stroke` is true (or the style has a static gradient) AND `idScope` is set, that paint becomes `url(#savig-grad-<idScope>-<prop>)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/renderShape.test.ts`:

```ts
it('forces a url() fill ref when gradientPaint.fill is set even without a static gradient', () => {
  const out = renderShapeToSvg('rect', { width: 10, height: 10 },
    { fill: '#ff0000', stroke: 'none', strokeWidth: 1 }, undefined, 'o1', { fill: true });
  expect(out).toContain('fill="url(#savig-grad-o1-fill)"');
});
```

Append to `src/services/export/renderDocument.test.ts`:

```ts
it('emits a gradient def sampled at t=0 and a url() ref for an animated-only gradient', () => {
  const project = makeProjectWithGradientTrackNoStatic(); // fill gradient TRACK, no asset.style.fillGradient
  const html = renderSvgDocument(project);
  expect(html).toContain('<linearGradient id="savig-grad-o1-fill"');
  expect(html).toContain('fill="url(#savig-grad-o1-fill)"');
});
```

> `makeProjectWithGradientTrackNoStatic` builds a vector rect object whose `gradientTracks.fill` has ≥1 keyframe and whose asset `VectorStyle` has NO `fillGradient`. Mirror the existing static-gradient test's project factory in this file, moving the gradient onto the object's `gradientTracks` instead of the asset style.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/renderShape.test.ts src/services/export/renderDocument.test.ts`
Expected: FAIL — no `gradientPaint` param; export emits no def/ref for a track-only object.

- [ ] **Step 3: Thread `gradientPaint` through `renderShapeToSvg`**

In `src/engine/renderShape.ts`:

1. Change `styleToSvgAttrs` to accept explicit paint flags:

```ts
function styleToSvgAttrs(
  style: VectorStyle,
  idScope?: string,
  gradientPaint?: { fill?: boolean; stroke?: boolean },
): Record<string, string> {
  const fillGrad = !!style.fillGradient || !!gradientPaint?.fill;
  const strokeGrad = !!style.strokeGradient || !!gradientPaint?.stroke;
  const fill = fillGrad && idScope ? paintRef(`savig-grad-${idScope}-fill`) : style.fill;
  const stroke = strokeGrad && idScope ? paintRef(`savig-grad-${idScope}-stroke`) : style.stroke;
  const attrs: Record<string, string> = {
    fill,
    stroke,
    'stroke-width': fmt(style.strokeWidth),
  };
  if (style.strokeLinecap !== undefined) attrs['stroke-linecap'] = style.strokeLinecap;
  if (style.strokeLinejoin !== undefined) attrs['stroke-linejoin'] = style.strokeLinejoin;
  return attrs;
}
```

2. Add the param to `renderShapeToSvg` and pass it through both `styleToSvgAttrs` calls:

```ts
export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
  path?: PathData,
  idScope?: string,
  gradientPaint?: { fill?: boolean; stroke?: boolean },
): string {
  if (shapeType === 'path') {
    if (!path || path.nodes.length === 0) return '';
    const attrs = { d: pathToD(path), ...styleToSvgAttrs(style, idScope, gradientPaint) };
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(' ');
    return `<path ${attrStr}/>`;
  }
  const tag = shapeType === 'rect' ? 'rect' : 'ellipse';
  const attrs = { ...geometryToSvgAttrs(shapeType, geometry), ...styleToSvgAttrs(style, idScope, gradientPaint) };
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<${tag} ${attrStr}/>`;
}
```

- [ ] **Step 4: Emit the sampled def + ref in `renderDocument.ts`**

In `src/services/export/renderDocument.ts`, replace the vector branch's gradient-def block + the `renderShapeToSvg` call:

```ts
      if (asset.kind === 'vector') {
        // Resolve effective gradients at t=0: an animated track's first sample
        // wins over the static asset gradient (export-at-0, like shapeTrack/color).
        const fillGrad = state.fillGradient ?? asset.style.fillGradient;
        const strokeGrad = state.strokeGradient ?? asset.style.strokeGradient;
        if (fillGrad) gradientDefs.push(gradientToSvg(`savig-grad-${obj.id}-fill`, fillGrad));
        if (strokeGrad) gradientDefs.push(gradientToSvg(`savig-grad-${obj.id}-stroke`, strokeGrad));

        const framePath = asset.shapeType === 'path' ? state.path ?? asset.path : undefined;
        const pathBox = framePath ? pathBounds(framePath) : undefined;
        const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
        const transform = buildTransform(state, anchorX, anchorY);
        let shape = renderShapeToSvg(
          asset.shapeType,
          state.geometry ?? {},
          asset.style,
          framePath,
          obj.id,
          { fill: !!fillGrad, stroke: !!strokeGrad },
        );
        if (!shape && asset.shapeType === 'path' && obj.shapeTrack && obj.shapeTrack.length > 0) {
          shape = '<path d=""/>';
        }
        return `<g data-savig-object="${obj.id}" transform="${transform}" opacity="${fmt(state.opacity)}">${shape}</g>`;
      }
```

> `state` here is already `sampleProject(project, 0)[i]`, so `state.fillGradient` IS the t=0 sample. This removes the old `asset.style.fillGradient`-only block.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/engine/renderShape.test.ts src/services/export/renderDocument.test.ts`
Expected: PASS — including the unchanged static-gradient export tests (now routed through `state.*Gradient ?? asset.style.*Gradient`, byte-identical for static-only).

- [ ] **Step 6: Commit**

```bash
git add src/engine/renderShape.ts src/engine/renderShape.test.ts src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(slice9): export emits animated gradient def sampled at t=0"
```

---

### Task 7: Regenerate the runtime bundle + parity test

**Files:**
- Modify: `src/runtime/runtimeSource.generated.ts` (generated — do not hand-edit; regenerate)
- Test: `src/runtime/frame.test.ts` (parity case) or the existing runtime↔engine parity test file (search for `parity`)

**Interfaces:**
- Consumes: everything above.
- Produces: a regenerated runtime bundle whose `applyFrameToNodes` includes the gradient-def update.

- [ ] **Step 1: Write the failing parity test**

Locate the existing runtime↔engine parity test (`grep -rln "parity" src/runtime src/services`). Add a case asserting the animated-gradient def the runtime produces equals the engine oracle:

```ts
it('runtime gradient def matches gradientToSvg(sampleGradient(track, t))', () => {
  const project = makeProjectWithGradientTrack();
  const t = 1;
  const { svg, nodes } = buildSvgFromExport(project); // parse renderSvgDocument(project) output
  applyFrameToNodes(nodes, computeFrame(project, t));
  const liveDef = svg.querySelector('#savig-grad-o1-fill')!;
  const track = project.objects[0].gradientTracks!.fill!;
  // Oracle: parse the canonical string into a DOM and compare structurally, since
  // createElementNS serialization (e.g. <stop></stop>) won't byte-match the
  // self-closing string emitter — but attrs + stop order/values must be identical.
  const oracleDef = new DOMParser()
    .parseFromString(`<svg xmlns="http://www.w3.org/2000/svg"><defs>${gradientToSvg('savig-grad-o1-fill', sampleGradient(track, t))}</defs></svg>`, 'image/svg+xml')
    .querySelector('#savig-grad-o1-fill')!;
  const attrsOf = (el: Element) => Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value]));
  const stopsOf = (el: Element) => Array.from(el.querySelectorAll('stop')).map(attrsOf);
  expect(liveDef.tagName.toLowerCase()).toBe(oracleDef.tagName.toLowerCase());
  expect(attrsOf(liveDef)).toEqual(attrsOf(oracleDef));   // includes id + coord attrs
  expect(stopsOf(liveDef)).toEqual(stopsOf(oracleDef));   // offset/stop-color/opacity, in order
});
```

> If the existing parity test uses a different harness shape, follow it; the assertion that matters is **live runtime def == structural(`gradientToSvg(id, sampleGradient(track, t))`)** — same tag, same coord/id attributes, same ordered stop attributes.

- [ ] **Step 2: Run to verify it fails (stale bundle)**

Run: `pnpm vitest run <parity-test-path>`
Expected: FAIL — the committed runtime bundle predates the gradient-def update.

- [ ] **Step 3: Regenerate the runtime bundle**

Run: `pnpm build:runtime`
Expected: `src/runtime/runtimeSource.generated.ts` is rewritten to include `applyGradientToElement` / the gradient branch.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run <parity-test-path>`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build`
Expected: all PASS, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/runtimeSource.generated.ts src/runtime/frame.test.ts
git commit -m "feat(slice9): regenerate runtime bundle + animated-gradient parity test"
```

---

## Self-Review (Plan A vs spec)

- **§3 data model** → Task 1. ✅
- **§4 interpolation** → Task 3 (`interpolateGradient`/`sampleGradient`, STEPS-hold, reuse `interpolateColor`). ✅
- **§5.1 RenderState resolution** → Task 4. ✅
- **§5.2 FrameItem + computeFrame guard** → Task 5 (steps 3.2–3.3). ✅
- **§5.3 applyFrameToNodes def mutation (always-rebuild stops, defensive)** → Task 5 (step 3.4). ✅
- **§5.4 export sampled-at-0 + url ref for track-only** → Task 6. ✅
- **§6 parity** → Task 7. ✅
- **§8 no migration** → no version bump appears anywhere. ✅
- **Type consistency:** `gradientStopAttrs` (Task 2) consumed by the runtime DOM builder in Task 5; `gradientStopsMarkup`/`gradientToSvg` (Task 2) consumed by export in Task 6 + the parity oracle in Task 7; `gradientAttrs` (Task 2) consumed in Tasks 5 & 7; `sampleGradient` (Task 3) consumed in Tasks 4 & 7; `gradientPaint` param shape `{ fill?: boolean; stroke?: boolean }` identical in Task 6 def + call. ✅
- **Placeholder scan:** test-helper factories (`makeProjectWithGradientTrack`, `buildSvgWithGradientDef`, etc.) are described with exact construction notes, not left as bare TODO. Acceptable for a test fixture local to one file. ✅

UI authoring (store/Inspector/Timeline/Stage/e2e) is **Plan B**.
