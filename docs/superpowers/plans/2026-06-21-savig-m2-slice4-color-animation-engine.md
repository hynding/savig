# Color Animation — Plan A (Engine & Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve a vector object's animated `fill`/`stroke` color per-frame through the existing sampled-value pipeline, with preview == export parity, while leaving non-animated objects byte-identical.

**Architecture:** A new pure `engine/color.ts` parses/interpolates hex colors and a `sampleColor` mirrors `interpolate`. `sampleObject` resolves `fill`/`stroke` onto `RenderState`; `computeFrame` carries them onto `FrameItem`; `applyFrameToNodes` sets them on the inner shape element. An optional `colorTracks` field on `SceneObject` drives it; absent ⇒ static style, no migration.

**Tech Stack:** TypeScript (strict), Vitest. Pure engine under `src/engine/`. Runtime bundle via `node scripts/build-runtime.mjs` (`pnpm build:runtime`).

## Global Constraints

- **Engine stays pure** — no React/DOM under `src/engine/`. The render core lifts verbatim into the export runtime.
- **Optional field only** → **no migration, no `CURRENT_VERSION` bump**. Absent `colorTracks` renders the static `VectorStyle` exactly as today.
- **Color animation is vector-objects-only** (`rect`/`ellipse`/`path`); imported SVG objects are out of scope.
- **Interpolation in RGB**; hex colors `#rgb`/`#rrggbb` only. `'none'`/unparseable endpoints **step** (hold `a` until `t === 1`).
- **Preview == export parity** through the shared pure `sampleColor`/`sampleObject` → `applyFrameToNodes`. Regenerate the runtime bundle when engine code changes.
- **TDD**: failing test → minimal impl → green → commit.
- Run unit tests with `pnpm vitest run <path>`; typecheck `pnpm typecheck`; lint `pnpm lint`.

---

## File Structure

- `src/engine/types.ts` — `ColorProperty`, `ColorKeyframe`, `SceneObject.colorTracks?` (MODIFY).
- `src/engine/color.ts` — NEW: `parseHex`, `formatHex`, `interpolateColor`, `sampleColor`.
- `src/engine/sample.ts` — `sampleObject` resolves `fill`/`stroke`; `RenderState` gains them (MODIFY).
- `src/engine/duration.ts` — `computeProjectDuration` folds in `colorTracks` (MODIFY).
- `src/runtime/frame.ts` — `FrameItem` `fill`/`stroke`; `computeFrame`; `applyFrameToNodes` (MODIFY).
- `src/engine/index.ts` — re-export `color.ts` (MODIFY).
- Tests: `src/engine/color.test.ts`, `src/engine/sample.test.ts`, `src/engine/duration.test.ts`, `src/runtime/frame.test.ts`.

---

## Task A1: `engine/color.ts` + color types

**Files:**
- Modify: `src/engine/types.ts`
- Create: `src/engine/color.ts`
- Modify: `src/engine/index.ts`
- Test: `src/engine/color.test.ts`

**Interfaces:**
- Produces: `type ColorProperty = 'fill' | 'stroke'`
- Produces: `interface ColorKeyframe { time: number; value: string; easing: Easing }`
- Produces: `parseHex(c: string): { r: number; g: number; b: number } | null`
- Produces: `formatHex(rgb: { r: number; g: number; b: number }): string`
- Produces: `interpolateColor(a: string, b: string, t: number): string`
- Produces: `sampleColor(track: ColorKeyframe[], time: number): string`

- [ ] **Step 1: Write the failing tests**

Create `src/engine/color.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseHex, formatHex, interpolateColor, sampleColor } from './color';
import type { ColorKeyframe } from './types';

describe('parseHex', () => {
  it('parses #rrggbb and #rgb (case-insensitive)', () => {
    expect(parseHex('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('#0F0')).toEqual({ r: 0, g: 255, b: 0 });
  });
  it('returns null for none / named / malformed', () => {
    expect(parseHex('none')).toBeNull();
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#12')).toBeNull();
  });
});

describe('formatHex', () => {
  it('clamps, rounds, and zero-pads to #rrggbb', () => {
    expect(formatHex({ r: 255, g: 0, b: 16 })).toBe('#ff0010');
    expect(formatHex({ r: 300, g: -5, b: 7.6 })).toBe('#ff0008');
  });
});

describe('interpolateColor', () => {
  it('lerps in RGB', () => {
    expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('steps when an endpoint is unparseable (none): holds a until t===1', () => {
    expect(interpolateColor('#000000', 'none', 0.5)).toBe('#000000');
    expect(interpolateColor('none', '#ffffff', 1)).toBe('#ffffff');
  });
});

describe('sampleColor', () => {
  const track: ColorKeyframe[] = [
    { time: 0, value: '#000000', easing: 'linear' },
    { time: 2, value: '#ffffff', easing: 'linear' },
  ];
  it('clamps before first / after last; single keyframe holds', () => {
    expect(sampleColor(track, -1)).toBe('#000000');
    expect(sampleColor(track, 5)).toBe('#ffffff');
    expect(sampleColor([{ time: 0, value: '#abcdef', easing: 'linear' }], 9)).toBe('#abcdef');
  });
  it('interpolates the bracketing pair with easing', () => {
    expect(sampleColor(track, 1)).toBe('#808080'); // linear midpoint
  });
  it('throws on an empty track', () => {
    expect(() => sampleColor([], 0)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/color.test.ts`
Expected: FAIL — `./color` does not exist.

- [ ] **Step 3: Add the types**

In `src/engine/types.ts`, after the `Easing` type is defined (near the top, after `CubicBezierEasing`/`Easing`):

```ts
export type ColorProperty = 'fill' | 'stroke';

export interface ColorKeyframe {
  /** Seconds from the start of the timeline. */
  time: number;
  /** Hex color ('#rgb' / '#rrggbb'), or 'none'. */
  value: string;
  easing: Easing;
}
```

- [ ] **Step 4: Create `color.ts`**

Create `src/engine/color.ts`:

```ts
import { applyEasing } from './easing';
import type { ColorKeyframe } from './types';

interface RGB {
  r: number;
  g: number;
  b: number;
}

// Parse '#rgb' / '#rrggbb' (case-insensitive). Null for 'none', named colors, malformed.
export function parseHex(c: string): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function formatHex({ r, g, b }: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// RGB lerp. Steps (holds `a` until t===1) when either endpoint is unparseable, so a
// color<->none boundary holds cleanly rather than producing garbage.
export function interpolateColor(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return t >= 1 ? b : a;
  return formatHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

// Resolve a color track to a hex string at `time`. Mirrors `interpolate`'s bracket/clamp/
// per-keyframe-easing.
export function sampleColor(track: ColorKeyframe[], time: number): string {
  if (track.length === 0) {
    throw new Error('sampleColor: track must contain at least one keyframe');
  }
  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;
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
  return interpolateColor(a.value, b.value, applyEasing(a.easing, rawProgress));
}
```

- [ ] **Step 5: Re-export from the barrel**

In `src/engine/index.ts`, add (near the other engine re-exports, e.g. after `export * from './easing';`):

```ts
export * from './color';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/engine/color.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/types.ts src/engine/color.ts src/engine/color.test.ts src/engine/index.ts
git commit -m "feat(color): hex color parse/format/interpolate + sampleColor (RGB, step on none)"
```

---

## Task A2: `colorTracks` field + `sampleObject` resolution

**Files:**
- Modify: `src/engine/types.ts` (`SceneObject.colorTracks?`)
- Modify: `src/engine/sample.ts` (`RenderState` + `sampleObject`)
- Test: `src/engine/sample.test.ts`

**Interfaces:**
- Consumes: `sampleColor` (A1), `ColorProperty`/`ColorKeyframe` (A1).
- Produces: `SceneObject.colorTracks?: Partial<Record<ColorProperty, ColorKeyframe[]>>`
- Produces: `RenderState.fill?: string`, `RenderState.stroke?: string`

- [ ] **Step 1: Write the failing test**

Add to `src/engine/sample.test.ts` (it already imports `sampleObject`; add a `createSceneObject` from `./project` if not present — check the file's existing imports/helpers and reuse them):

```ts
import { sampleColor } from './color';

describe('sampleObject color tracks', () => {
  it('resolves fill/stroke only when a color track exists', () => {
    const base = createSceneObject('asset-1', {
      colorTracks: {
        fill: [
          { time: 0, value: '#000000', easing: 'linear' },
          { time: 2, value: '#ffffff', easing: 'linear' },
        ],
      },
    });
    const mid = sampleObject(base, 1);
    expect(mid.fill).toBe('#808080');
    expect(mid.fill).toBe(sampleColor(base.colorTracks!.fill!, 1));
    expect(mid.stroke).toBeUndefined(); // no stroke track

    const plain = createSceneObject('asset-1', {});
    expect(sampleObject(plain, 1).fill).toBeUndefined();
  });
});
```

(If `sample.test.ts` builds objects a different way — e.g. a local factory — mirror that file's existing construction; only the `colorTracks` field and the `fill`/`stroke` assertions are new.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/sample.test.ts`
Expected: FAIL — `colorTracks` is not a field / `state.fill` is undefined.

- [ ] **Step 3: Add the field**

In `src/engine/types.ts`, inside `interface SceneObject` (after `shapeTrack?`):

```ts
  /** Per-property animated colors for vector objects. Absent property -> the asset's
   *  static VectorStyle color stands. */
  colorTracks?: Partial<Record<ColorProperty, ColorKeyframe[]>>;
```

- [ ] **Step 4: Add `fill`/`stroke` to `RenderState` and resolve them**

In `src/engine/sample.ts`, extend `RenderState`:

```ts
export interface RenderState extends Transform2D {
  objectId: string;
  geometry?: ResolvedGeometry;
  path?: PathData;
  fill?: string;
  stroke?: string;
}
```

Add the import and the resolution (before `return state;` in `sampleObject`):

```ts
import { sampleColor } from './color';
```

```ts
  if (obj.colorTracks) {
    for (const prop of ['fill', 'stroke'] as const) {
      const track = obj.colorTracks[prop];
      if (track && track.length > 0) state[prop] = sampleColor(track, time);
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/engine/sample.test.ts && pnpm typecheck`
Expected: PASS — existing `sampleObject` tests unchanged (no `colorTracks` ⇒ no `fill`/`stroke`).

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/sample.ts src/engine/sample.test.ts
git commit -m "feat(color): colorTracks field + sampleObject resolves fill/stroke per frame"
```

---

## Task A3: `computeProjectDuration` includes color tracks

**Files:**
- Modify: `src/engine/duration.ts`
- Test: `src/engine/duration.test.ts`

**Interfaces:**
- Consumes: `SceneObject.colorTracks` (A2).

- [ ] **Step 1: Write the failing test**

Add to `src/engine/duration.test.ts` (mirror the file's existing project/object construction):

```ts
it('extends the duration to a color keyframe past the prior end', () => {
  const obj = createSceneObject('a', {
    colorTracks: { stroke: [
      { time: 0, value: '#000000', easing: 'linear' },
      { time: 7, value: '#ffffff', easing: 'linear' },
    ] },
  });
  const project = { ...createProject(), objects: [obj] };
  expect(computeProjectDuration(project)).toBe(7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/duration.test.ts`
Expected: FAIL — duration ignores `colorTracks` (returns 0 or a smaller max).

- [ ] **Step 3: Fold color tracks into the max**

In `src/engine/duration.ts`, inside the `for (const obj of project.objects)` loop, after the `shapeTrack` loop:

```ts
    for (const track of Object.values(obj.colorTracks ?? {})) {
      for (const keyframe of track ?? []) {
        if (keyframe.time > max) max = keyframe.time;
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/duration.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/duration.ts src/engine/duration.test.ts
git commit -m "feat(color): computeProjectDuration folds in colorTracks keyframe times"
```

---

## Task A4: `FrameItem` fill/stroke + parity + runtime bundle

**Files:**
- Modify: `src/runtime/frame.ts` (`FrameItem`, `computeFrame`, `applyFrameToNodes`)
- Test: `src/runtime/frame.test.ts`
- Modify (generated): `src/runtime/runtimeSource.generated.ts` (via build script)

**Interfaces:**
- Consumes: `RenderState.fill`/`stroke` (A2).
- Produces: `FrameItem.fill?: string`, `FrameItem.stroke?: string`.

- [ ] **Step 1: Write the failing parity test**

Add to `src/runtime/frame.test.ts` (reuse its `createVectorAsset` / `createSceneObject` / `createProject` imports):

```ts
import { sampleColor } from '../engine/color';

describe('computeFrame color animation', () => {
  it('emits fill/stroke equal to sampleColor at several t', () => {
    const fill = [
      { time: 0, value: '#000000', easing: 'linear' as const },
      { time: 2, value: '#ffffff', easing: 'linear' as const },
    ];
    const asset = createVectorAsset('rect', {});
    const obj = createSceneObject(asset.id, { shapeBase: { width: 10, height: 10 }, colorTracks: { fill } });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    for (const t of [0, 0.5, 1, 1.5, 2]) {
      expect(computeFrame(project, t)[0].fill).toBe(sampleColor(fill, t));
    }
  });

  it('does NOT emit fill/stroke for an object with no color track', () => {
    const asset = createVectorAsset('rect', {});
    const obj = createSceneObject(asset.id, { shapeBase: { width: 10, height: 10 } });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].fill).toBeUndefined();
  });

  it('applyFrameToNodes sets fill/stroke on the inner shape element', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-savig-object', 'obj-1');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    g.appendChild(rect);
    const nodes = new Map<string, Element>([['obj-1', g]]);
    applyFrameToNodes(nodes, [{ objectId: 'obj-1', transform: '', opacity: '1', fill: '#808080' }]);
    expect(rect.getAttribute('fill')).toBe('#808080');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: FAIL — `FrameItem` has no `fill`; `computeFrame`/`applyFrameToNodes` ignore color.

- [ ] **Step 3: Carry fill/stroke through the frame**

In `src/runtime/frame.ts`, extend `FrameItem`:

```ts
export interface FrameItem {
  objectId: string;
  transform: string;
  opacity: string;
  geometry?: Record<string, string>;
  pathD?: string;
  fill?: string;
  stroke?: string;
}
```

In `computeFrame`, after the `pathD` block (before `return item;`):

```ts
    if (state.fill !== undefined) item.fill = state.fill;
    if (state.stroke !== undefined) item.stroke = state.stroke;
```

In `applyFrameToNodes`, after the `pathD` block (inside the per-item loop):

```ts
    if (item.fill !== undefined || item.stroke !== undefined) {
      const shape = node.firstElementChild;
      if (shape) {
        if (item.fill !== undefined) shape.setAttribute('fill', item.fill);
        if (item.stroke !== undefined) shape.setAttribute('stroke', item.stroke);
      }
    }
```

- [ ] **Step 4: Run test to verify it passes (live engine)**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: PASS — `computeFrame`/`applyFrameToNodes` use the live engine, so the parity test passes here; the bundle regeneration in Step 5 is what makes the *exported* runtime honor animated color (verified by the Plan B e2e).

- [ ] **Step 5: Regenerate the runtime bundle (so EXPORT honors animated color)**

Run: `pnpm build:runtime`
Expected: `src/runtime/runtimeSource.generated.ts` updated (git shows a diff); it now contains `sampleColor` / color resolution.

Verify: `grep -c "sampleColor" src/runtime/runtimeSource.generated.ts` returns ≥ 1.

- [ ] **Step 6: Full suite + build gates**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "feat(color): FrameItem fill/stroke + applyFrameToNodes; parity; regenerate runtime bundle"
```

---

## Plan A — Self-review checklist

- Engine pure (no React/DOM under `src/engine/`)? ✓
- No `CURRENT_VERSION` bump? ✓ additive optional field.
- Absent `colorTracks` byte-identical (static style)? ✓ A2/A4 negative tests.
- `none`/unparseable steps, RGB lerp? ✓ A1 tests.
- Duration extends to a color keyframe? ✓ A3.
- Runtime bundle regenerated + parity asserted? ✓ A4.
