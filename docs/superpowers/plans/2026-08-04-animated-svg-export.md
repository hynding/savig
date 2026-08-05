# Animated SVG Export (SMIL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new export target that renders the project to a single self-contained `.svg` file animated with SMIL — it plays everywhere, including `<img>` tags and GitHub READMEs, with no JavaScript.

**Architecture:** Sample the existing `computeFrame(project, t)` (from `@savig/runtime/frame`) at project fps over the full duration; convert each animated `FrameItem` property into SMIL `<animate>`/`<animateTransform>` elements with `values` lists; inject them into the existing `renderProjectDocument` markup via DOM (DOMParser → insert → XMLSerializer), mirroring exactly where `applyFrameToNodes` writes each attribute. Spec: `docs/superpowers/specs/2026-08-04-animated-svg-export-design.md`.

**Tech Stack:** TypeScript strict, Vitest (jsdom env for `packages/services/**`), Playwright, jsdom (Node/MCP path), no new dependencies.

## Global Constraints

- Run tools via direct binaries, NOT `pnpm <script>` (subagent env constraint): `node_modules/.bin/vitest run <file>`, `node_modules/.bin/tsc -p tsconfig.json --noEmit`, `node_modules/.bin/playwright test <file>`.
- After any task: full typecheck `node_modules/.bin/tsc -p tsconfig.json --noEmit` must pass before commit.
- `packages/runtime/src` is NOT modified by this plan → `build:runtime` regeneration is NOT needed.
- Determinism: no `Date.now()`, no randomness; identical project in → byte-identical SVG out (within one environment).
- Number formatting: always `fmt()` from `@savig/engine` (4-decimal rounding, `-0` and non-finite coercion).
- All SMIL elements: `begin="0s"`, shared `dur`, `repeatCount="indefinite"` when `project.meta.loop`, else `fill="freeze"` (SMIL default `fill="remove"` snaps back to frame 0 — never omit `fill` for non-looping).
- Never use `CSS.escape` in `animatedSvg.ts` (absent in bare Node for the MCP path) — build an id→element Map by scanning `querySelectorAll('[id]')` instead.
- Existing exporters (`renderDocument.ts`, `buildBundle.ts`, static `exportSvg`) must remain byte-identical — this plan only ADDS files/commands (plus additive edits to `types.ts`/`registry.ts`/`tools.ts`/package.json exports/aliases).

---

### Task 1: Transform math — parse, multiply, decompose, unwrap

**Files:**
- Create: `packages/services/src/export/smilTransform.ts`
- Test: `packages/services/src/export/smilTransform.test.ts`

**Interfaces:**
- Consumes: nothing project-specific (pure math; `fmt` from `@savig/engine`).
- Produces (used by Tasks 2 and 5):
  - `type Mat = [number, number, number, number, number, number]` — SVG matrix `[a,b,c,d,e,f]` (column-major pair layout: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`)
  - `parseTransform(s: string): Mat` — parses an SVG transform list (`translate`/`rotate`/`scale`/`matrix`/`skewX`/`skewY`, comma- OR whitespace-separated args, 1-or-2-arg translate/scale, 1-or-3-arg rotate) into one composed matrix. `''` → identity.
  - `interface Decomposed { tx: number; ty: number; rotation: number; skewX: number; scaleX: number; scaleY: number }` (angles in degrees)
  - `decompose(m: Mat): Decomposed` — exact T·R·SkewX·S decomposition
  - `unwrapDegrees(values: number[]): number[]` — removes ±360° jumps between consecutive samples

Background you need: `buildTransform` (packages/engine/src/transform.ts:12) emits only `translate(x, y) rotate(r, cx, cy) translate(ax, ay) scale(sx, sy) translate(-ax, -ay)` chains (comma-separated); `cameraTransform` (packages/engine/src/camera.ts:27) emits `translate(a b) scale(z) rotate(r) translate(c d)` (space-separated). Composed prefix chains concatenate many of these. SMIL `animateTransform` has no `matrix` type, hence the decomposition into stackable single types.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/services/src/export/smilTransform.test.ts
import { describe, it, expect } from 'vitest';
import { decompose, parseTransform, unwrapDegrees, type Mat } from './smilTransform';

const apply = (m: Mat, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

describe('parseTransform', () => {
  it('parses empty string to identity', () => {
    expect(parseTransform('')).toEqual([1, 0, 0, 1, 0, 0]);
  });
  it('parses comma-separated buildTransform output', () => {
    const m = parseTransform('translate(10, 20) rotate(90, 0, 0) scale(2, 3)');
    // (1,0) -> scale -> (2,0) -> rotate90 -> (0,2) -> translate -> (10,22)
    const [x, y] = apply(m, 1, 0);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(22, 6);
  });
  it('parses space-separated camera output and 1-arg forms', () => {
    const m = parseTransform('translate(160 120) scale(2) rotate(0) translate(-160 -120)');
    const [x, y] = apply(m, 160, 120);
    expect(x).toBeCloseTo(160, 6);
    expect(y).toBeCloseTo(120, 6);
  });
  it('parses matrix() and 3-arg rotate(angle, cx, cy)', () => {
    expect(parseTransform('matrix(1, 0, 0, 1, 5, 6)')).toEqual([1, 0, 0, 1, 5, 6]);
    const m = parseTransform('rotate(180, 10, 0)'); // rotate about (10,0): (0,0) -> (20,0)
    const [x, y] = apply(m, 0, 0);
    expect(x).toBeCloseTo(20, 6);
    expect(y).toBeCloseTo(0, 6);
  });
});

describe('decompose', () => {
  // Recompose T·R·SkewX·S and check it reproduces the matrix (the invariant Task 2 relies on:
  // stacked additive animateTransforms translate -> rotate -> skewX -> scale reproduce the frame).
  const recompose = (d: ReturnType<typeof decompose>): Mat => {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const cos = Math.cos(rad(d.rotation)), sin = Math.sin(rad(d.rotation));
    const k = Math.tan(rad(d.skewX));
    // T · R · SkewX · S
    const a = cos * d.scaleX + 0, b = sin * d.scaleX;
    const c = (cos * k - sin) * d.scaleY, dd = (sin * k + cos) * d.scaleY;
    return [a, b, c, dd, d.tx, d.ty];
  };
  const roundTrip = (m: Mat) => {
    const r = recompose(decompose(m));
    m.forEach((v, i) => expect(r[i]).toBeCloseTo(v, 6));
  };
  it('round-trips a plain TRS chain', () => roundTrip(parseTransform('translate(10, 20) rotate(30, 0, 0) scale(2, 3)')));
  it('round-trips a sheared matrix (rotate·scale·rotate produces skew)', () =>
    roundTrip(parseTransform('rotate(30) scale(2, 0.5) rotate(20)')));
  it('round-trips a flip (negative determinant)', () => roundTrip(parseTransform('scale(-2, 3)')));
  it('handles a degenerate zero-scale matrix without NaN', () => {
    const d = decompose([0, 0, 0, 0, 5, 6]);
    for (const v of Object.values(d)) expect(Number.isFinite(v)).toBe(true);
    expect(d.tx).toBe(5);
  });
});

describe('unwrapDegrees', () => {
  it('removes the ±360 jump when a rotation crosses 180', () => {
    expect(unwrapDegrees([170, 179, -179, -170])).toEqual([170, 179, 181, 190]);
  });
  it('leaves already-continuous values unchanged', () => {
    expect(unwrapDegrees([0, 45, 90])).toEqual([0, 45, 90]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node_modules/.bin/vitest run packages/services/src/export/smilTransform.test.ts`
Expected: FAIL — module `./smilTransform` not found.

- [ ] **Step 3: Implement**

```ts
// packages/services/src/export/smilTransform.ts
// Pure 2D-affine helpers for the SMIL exporter: SMIL's <animateTransform> has no `matrix`
// type, so every sampled transform chain is collapsed to one matrix and decomposed into
// T·R·SkewX·S — reproducible as stacked additive animateTransforms.

/** SVG matrix [a,b,c,d,e,f]: x' = a·x + c·y + e; y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Parse an SVG transform list into one composed matrix. Accepts the two shapes the engine
 *  emits (buildTransform: comma-separated; cameraTransform: space-separated) plus matrix/skew
 *  for defense. Unknown functions throw (they cannot occur in engine output). */
export function parseTransform(s: string): Mat {
  let m = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  for (const match of s.matchAll(re)) {
    const fn = match[1];
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat;
    switch (fn) {
      case 'translate': t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]; break;
      case 'scale': t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const a = rad(args[0] ?? 0);
        const [cx, cy] = [args[1] ?? 0, args[2] ?? 0];
        const [cos, sin] = [Math.cos(a), Math.sin(a)];
        // translate(cx,cy) · rotate(a) · translate(-cx,-cy)
        t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(rad(args[0] ?? 0)), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(rad(args[0] ?? 0)), 0, 1, 0, 0]; break;
      case 'matrix': t = [args[0], args[1], args[2], args[3], args[4], args[5]]; break;
      default: throw new Error(`Unsupported transform function "${fn}"`);
    }
    m = multiply(m, t);
  }
  return m;
}

export interface Decomposed {
  tx: number; ty: number;
  /** degrees */ rotation: number;
  /** degrees */ skewX: number;
  scaleX: number; scaleY: number;
}

/** Exact T·R(θ)·SkewX(φ)·S decomposition of an affine matrix.
 *  Derivation (a=cosθ·sx, b=sinθ·sx, c=(cosθ·k−sinθ)·sy, d=(sinθ·k+cosθ)·sy, k=tanφ):
 *  sx=√(a²+b²), θ=atan2(b,a), sy=det/sx, k=(a·c+b·d)/det.
 *  Degenerate (sx≈0): rotation/skew are unobservable — return 0 angles and raw scales. */
export function decompose(m: Mat): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  if (sx < 1e-9) return { tx: e, ty: f, rotation: 0, skewX: 0, scaleX: 0, scaleY: Math.hypot(c, d) };
  const det = a * d - b * c;
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  const sy = det / sx;
  const skewX = sy === 0 ? 0 : (Math.atan((a * c + b * d) / det) * 180) / Math.PI;
  return { tx: e, ty: f, rotation, skewX, scaleX: sx, scaleY: sy };
}

/** Make an angle series continuous: SMIL interpolates values literally, so a sampled rotation
 *  crossing ±180 (atan2 wraps) must be unwrapped or the tween spins the wrong way. */
export function unwrapDegrees(values: number[]): number[] {
  const out = values.slice(0, 1);
  for (let i = 1; i < values.length; i++) {
    let v = values[i];
    const prev = out[i - 1];
    while (v - prev > 180) v -= 360;
    while (prev - v > 180) v += 360;
    out.push(v);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run packages/services/src/export/smilTransform.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck and commit**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
git add packages/services/src/export/smilTransform.ts packages/services/src/export/smilTransform.test.ts
git commit -m "feat(export): SMIL transform math — parse/decompose/unwrap for animateTransform stacks"
```

---

### Task 2: `renderAnimatedSvgDocument` core — sampling, DOM injection, wrapper transform/opacity, loop semantics

**Files:**
- Create: `packages/services/src/export/animatedSvg.ts`
- Test: `packages/services/src/export/animatedSvg.test.ts`
- Modify: `packages/services/package.json` (add `"./export/animatedSvg": "./src/export/animatedSvg.ts"` to `exports`)
- Modify: `vitest.config.ts`, `apps/react/vite.config.ts`, `apps/svelte/vite.config.ts`, `apps/svelte/tsconfig.json` (add the `@savig/services/export/animatedSvg` alias next to the existing `@savig/services/export/renderDocument` entry in each — copy that line and change both path segments)

**Interfaces:**
- Consumes: `parseTransform`, `decompose`, `unwrapDegrees` from `./smilTransform` (Task 1); `computeFrame`, `FrameItem` from `@savig/runtime/frame`; `renderProjectDocument` from `./renderDocument`; `computeProjectDuration`, `fmt` from `@savig/engine`.
- Produces (used by Tasks 3–8):
  - `interface DomEnv { DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer }`
  - `renderAnimatedSvgDocument(project: Project, env?: DomEnv): string` — THE public entry. `env` defaults to `globalThis` classes (browser / jsdom test env); the Node path (Task 7) injects jsdom's.
  - Internal helpers Tasks 3–5 extend IN THIS FILE: `sampleProject`, `timingAttrs`, `seriesFor`, `isConstant`, `appendAnim`, `appendTransformAnims` — exact signatures in Step 3.

Sampling model: `N = max(1, Math.round(duration * fps))` intervals, times `tᵢ = i * duration / N` for `i = 0..N` (uniform, so `keyTimes` is omitted — SMIL defaults to uniform pacing). Multi-scene `computeFrame` only returns items for ACTIVE scenes, so a per-object series holds the last seen value across gaps (the object's scene group is hidden then — the held value is invisible but keeps the list length uniform).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/services/src/export/animatedSvg.test.ts
import { describe, it, expect } from 'vitest';
import { createProject } from '@savig/engine';
import type { Project } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import { decompose, parseTransform } from './smilTransform';
import { renderAnimatedSvgDocument } from './animatedSvg';

/** A 1s project with one rect whose x animates 0 -> 100. */
function movingRectProject(): Project {
  const p = createProject('anim-test');
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'fixed';
  p.meta.loop = false;
  p.assets.push({
    id: 'a1', kind: 'vector', shapeType: 'rect',
    style: { fill: '#ff0000', stroke: 'none', strokeWidth: 1 },
  } as never);
  p.objects.push({
    id: 'o1', assetId: 'a1', zOrder: 0,
    base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    width: 20, height: 20,
    tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 100, easing: 'linear' }] },
  } as never);
  return p;
}

const parseDoc = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml');

describe('renderAnimatedSvgDocument core', () => {
  it('is deterministic (byte-identical on repeat calls)', () => {
    const p = movingRectProject();
    expect(renderAnimatedSvgDocument(p)).toBe(renderAnimatedSvgDocument(p));
  });

  it('emits stacked animateTransforms on the animated wrapper, shape stays firstElementChild', () => {
    const doc = parseDoc(renderAnimatedSvgDocument(movingRectProject()));
    const wrapper = doc.querySelector('[data-savig-object="o1"]')!;
    expect(wrapper.firstElementChild!.tagName).toBe('rect'); // runtime contract preserved
    const translates = wrapper.querySelectorAll('animateTransform[type="translate"]');
    expect(translates.length).toBe(1);
    const tr = translates[0];
    expect(tr.getAttribute('dur')).toBe('1s');
    expect(tr.getAttribute('begin')).toBe('0s');
    expect(tr.getAttribute('fill')).toBe('freeze'); // loop=false
    expect(tr.getAttribute('repeatCount')).toBeNull();
  });

  it('parity: emitted translate values match decomposed computeFrame transforms at sample times', () => {
    const p = movingRectProject();
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const tr = doc.querySelector('[data-savig-object="o1"] animateTransform[type="translate"]')!;
    const values = tr.getAttribute('values')!.split(';');
    expect(values.length).toBe(11); // N=10 intervals -> 11 samples
    values.forEach((v, i) => {
      const t = (i * 1) / 10;
      const item = computeFrame(p, t).find((it) => it.objectId === 'o1')!;
      const d = decompose(parseTransform(item.transform));
      const [x, y] = v.split(',').map(Number);
      expect(x).toBeCloseTo(d.tx, 3);
      expect(y).toBeCloseTo(d.ty, 3);
    });
  });

  it('loop=true emits repeatCount=indefinite and no fill', () => {
    const p = movingRectProject();
    p.meta.loop = true;
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const tr = doc.querySelector('animateTransform[type="translate"]')!;
    expect(tr.getAttribute('repeatCount')).toBe('indefinite');
    expect(tr.getAttribute('fill')).toBeNull();
  });

  it('a fully static project or zero duration emits NO animation elements', () => {
    const p = createProject('static');
    p.assets.push({ id: 'a1', kind: 'vector', shapeType: 'rect', style: { fill: '#00ff00', stroke: 'none', strokeWidth: 1 } } as never);
    p.objects.push({ id: 'o1', assetId: 'a1', zOrder: 0, base: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, width: 10, height: 10, tracks: {} } as never);
    const markup = renderAnimatedSvgDocument(p);
    expect(markup).not.toContain('<animate');
    expect(markup).toContain('data-savig-object');
  });

  it('animated opacity emits an opacity <animate> on the wrapper', () => {
    const p = movingRectProject();
    (p.objects[0] as { tracks: Record<string, unknown> }).tracks = {
      opacity: [{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 0, easing: 'linear' }],
    };
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const anim = doc.querySelector('[data-savig-object="o1"] animate[attributeName="opacity"]')!;
    const vals = anim.getAttribute('values')!.split(';');
    expect(Number(vals[0])).toBeCloseTo(1, 3);
    expect(Number(vals[vals.length - 1])).toBeCloseTo(0, 3);
  });
});
```

NOTE for the implementer: `createProject`'s exact asset/object factory shapes live in `packages/engine/src/project.ts` and `types.ts` — if the `as never` literals above miss required fields (e.g. `anchorX`/`anchorY`, `name`), copy the minimal-object pattern from an existing services test (`packages/services/src/export/renderDocument.test.ts` builds projects the same way); adjust the literals, not the assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts`
Expected: FAIL — module `./animatedSvg` not found.

- [ ] **Step 3: Implement the core**

```ts
// packages/services/src/export/animatedSvg.ts
// Standalone animated SVG (SMIL) exporter. Samples the SAME frame engine the runtime plays
// (computeFrame) at project fps and bakes each animated FrameItem property into SMIL
// <animate>/<animateTransform> children, injected at the exact node applyFrameToNodes
// writes at play time (wrapper <g> vs inner shape vs def). Export == preview by construction.
// Spec: docs/superpowers/specs/2026-08-04-animated-svg-export-design.md
import { computeProjectDuration, fmt } from '@savig/engine';
import type { Project } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import type { FrameItem } from '@savig/runtime/frame';
import { renderProjectDocument } from './renderDocument';
import { decompose, parseTransform, unwrapDegrees } from './smilTransform';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** DOM constructors, injectable for the Node/MCP path (jsdom). Defaults to globals. */
export interface DomEnv {
  DOMParser: typeof DOMParser;
  XMLSerializer: typeof XMLSerializer;
}

interface Sampled {
  /** Uniform sample times 0..duration (N+1 entries) — keyTimes is omittable. */
  times: number[];
  /** frames[i] = computeFrame(project, times[i]) */
  frames: FrameItem[][];
  duration: number;
  loop: boolean;
}

function sampleProject(project: Project): Sampled | null {
  const duration = computeProjectDuration(project);
  if (!(duration > 0)) return null;
  const n = Math.max(1, Math.round(duration * project.meta.fps));
  const times: number[] = [];
  const frames: FrameItem[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i * duration) / n;
    times.push(t);
    frames.push(computeFrame(project, t));
  }
  return { times, frames, duration, loop: project.meta.loop };
}

/** Shared SMIL timing attributes. fill="freeze" is mandatory for non-loop (default
 *  fill="remove" snaps back to frame 0 when the animation ends). */
function timingAttrs(s: Sampled): Record<string, string> {
  return {
    begin: '0s',
    dur: `${fmt(s.duration)}s`,
    ...(s.loop ? { repeatCount: 'indefinite' } : { fill: 'freeze' }),
  };
}

/** Per-object per-frame series. Multi-scene computeFrame omits inactive scenes' objects, so
 *  gaps hold the last seen value (leading gaps take the first seen) — the scene group is
 *  hidden during a gap, so held values are invisible but keep list lengths uniform. */
function seriesFor(
  frames: FrameItem[][],
  objectId: string,
  pick: (it: FrameItem) => string | undefined,
): (string | undefined)[] {
  const raw = frames.map((frame) => {
    const item = frame.find((it) => it.objectId === objectId);
    return item ? pick(item) : undefined;
  });
  let first: string | undefined;
  for (const v of raw) if (v !== undefined) { first = v; break; }
  let prev = first;
  return raw.map((v) => (v === undefined ? prev : ((prev = v), v)));
}

function isConstant(values: (string | undefined)[]): boolean {
  return values.every((v) => v === values[0]);
}

/** Append one animation element as the LAST child of `target` (the shape stays
 *  firstElementChild — the runtime/raster contract). */
function appendAnim(
  target: Element,
  tag: 'animate' | 'animateTransform',
  attrs: Record<string, string>,
): void {
  const el = target.ownerDocument!.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  target.appendChild(el);
}

/** Bake a transform-string series into stacked animateTransforms: translate (replaces the
 *  static transform attr) then rotate/skewX/scale with additive="sum" — exactly T·R·SkX·S,
 *  the Task-1 decomposition order. Components that stay at identity are omitted EXCEPT
 *  translate, which anchors the replace semantics whenever the set is emitted at all. */
function appendTransformAnims(target: Element, transforms: string[], timing: Record<string, string>): void {
  const dec = transforms.map((t) => decompose(parseTransform(t)));
  const rotation = unwrapDegrees(dec.map((d) => d.rotation));
  const skewX = unwrapDegrees(dec.map((d) => d.skewX));
  const join = (vals: string[]) => vals.join(';');
  appendAnim(target, 'animateTransform', {
    attributeName: 'transform', type: 'translate',
    values: join(dec.map((d) => `${fmt(d.tx)},${fmt(d.ty)}`)), ...timing,
  });
  if (rotation.some((r) => Math.abs(r) > 1e-4)) {
    appendAnim(target, 'animateTransform', {
      attributeName: 'transform', type: 'rotate', additive: 'sum',
      values: join(rotation.map((r) => fmt(r))), ...timing,
    });
  }
  if (skewX.some((k) => Math.abs(k) > 1e-4)) {
    appendAnim(target, 'animateTransform', {
      attributeName: 'transform', type: 'skewX', additive: 'sum',
      values: join(skewX.map((k) => fmt(k))), ...timing,
    });
  }
  if (dec.some((d) => Math.abs(d.scaleX - 1) > 1e-4 || Math.abs(d.scaleY - 1) > 1e-4)) {
    appendAnim(target, 'animateTransform', {
      attributeName: 'transform', type: 'scale', additive: 'sum',
      values: join(dec.map((d) => `${fmt(d.scaleX)},${fmt(d.scaleY)}`)), ...timing,
    });
  }
}

/** Render the project as ONE self-contained SMIL-animated SVG document string. */
export function renderAnimatedSvgDocument(project: Project, env?: DomEnv): string {
  const Parser = env?.DOMParser ?? globalThis.DOMParser;
  const Serializer = env?.XMLSerializer ?? globalThis.XMLSerializer;
  const markup = renderProjectDocument(project);
  const sampled = sampleProject(project);
  if (!sampled) return markup; // zero duration -> static document as-is

  const doc = new Parser().parseFromString(markup, 'image/svg+xml');
  const timing = timingAttrs(sampled);

  // Wrapper map — identical construction to the runtime player's create().
  const nodes = new Map<string, Element>();
  doc.querySelectorAll('[data-savig-object]').forEach((el) => {
    nodes.set(el.getAttribute('data-savig-object')!, el);
  });
  // Def map by id (gradients, textpath defs) — no CSS.escape (absent in bare Node).
  const defsById = new Map<string, Element>();
  doc.querySelectorAll('[id]').forEach((el) => defsById.set(el.getAttribute('id')!, el));

  const objectIds = new Set<string>();
  for (const frame of sampled.frames) for (const it of frame) objectIds.add(it.objectId);

  for (const objectId of objectIds) {
    const wrapper = nodes.get(objectId);
    if (!wrapper) continue;
    const transforms = seriesFor(sampled.frames, objectId, (it) => it.transform) as string[];
    if (!isConstant(transforms)) appendTransformAnims(wrapper, transforms, timing);
    const opacity = seriesFor(sampled.frames, objectId, (it) => it.opacity) as string[];
    if (!isConstant(opacity)) {
      appendAnim(wrapper, 'animate', { attributeName: 'opacity', values: opacity.join(';'), ...timing });
    }
    // Tasks 3–4 extend here: shape attributes, gradients, textPath (using `defsById`).
  }
  // Task 5 extends here: scenes / cameras / dip overlay.

  return new Serializer().serializeToString(doc.documentElement);
}
```

If TS flags unused `defsById`, keep it referenced via a `void defsById;` line that Task 3 removes (it is the seam Tasks 3–4 build on).

- [ ] **Step 4: Register the subpath export + aliases**

In `packages/services/package.json` line 5, extend `exports` to:
```json
"exports": { ".": "./src/index.ts", "./export/renderDocument": "./src/export/renderDocument.ts", "./export/animatedSvg": "./src/export/animatedSvg.ts" },
```
In `vitest.config.ts`, `apps/react/vite.config.ts`, `apps/svelte/vite.config.ts`, `apps/svelte/tsconfig.json`: duplicate each file's existing `@savig/services/export/renderDocument` alias line, changing both occurrences of `renderDocument` to `animatedSvg`. Aliases must be sorted longest-prefix-first if the file orders them that way (they are — keep the new line adjacent to the renderDocument one, ABOVE the bare `@savig/services` entry).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts`
Expected: PASS (all 6).

- [ ] **Step 6: Guard existing exports didn't change**

Run: `node_modules/.bin/vitest run packages/services/src/export`
Expected: ALL pass (renderDocument/buildBundle/exportProject/zipBundle untouched).

- [ ] **Step 7: Typecheck and commit**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
git add packages/services/src/export/animatedSvg.ts packages/services/src/export/animatedSvg.test.ts packages/services/package.json vitest.config.ts apps/react/vite.config.ts apps/svelte/vite.config.ts apps/svelte/tsconfig.json
git commit -m "feat(export): animated SVG core — computeFrame sampling to stacked SMIL transforms + opacity"
```

---

### Task 3: Shape-level attributes — geometry, path morphs, colors, dash/trim, textPath

**Files:**
- Modify: `packages/services/src/export/animatedSvg.ts` (the per-object loop from Task 2)
- Test: `packages/services/src/export/animatedSvg.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's `seriesFor`, `isConstant`, `appendAnim`, `timing`, `defsById`, `nodes`.
- Produces: no new exports — the per-object loop now covers every shape-level `FrameItem` field. Targets mirror `applyFrameToNodes` (packages/runtime/src/frame.ts:167): shape attrs go on `wrapper.firstElementChild`, textPath `d` on the `savig-textpath-<objectId>` def, `startOffset` on `wrapper.querySelector('textPath')`.

- [ ] **Step 1: Write the failing tests (append to animatedSvg.test.ts)**

```ts
describe('shape-level attributes', () => {
  it('animated geometry emits <animate> per attribute on the INNER shape', () => {
    const p = movingRectProject();
    (p.objects[0] as { tracks: Record<string, unknown> }).tracks = {
      width: [{ time: 0, value: 20, easing: 'linear' }, { time: 1, value: 80, easing: 'linear' }],
    };
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const shape = doc.querySelector('[data-savig-object="o1"]')!.firstElementChild!;
    const anim = shape.querySelector('animate[attributeName="width"]')!;
    const vals = anim.getAttribute('values')!.split(';');
    expect(Number(vals[0])).toBeCloseTo(20, 3);
    expect(Number(vals[vals.length - 1])).toBeCloseTo(80, 3);
  });

  it('a morphing path with STABLE structure animates d with default (linear) calcMode', () => {
    // Build a 2-node path whose shapeTrack moves one node — same command skeleton each frame.
    // Copy the shapeTrack project construction from packages/runtime/src/frame.test.ts (search
    // "shapeTrack") — reuse its minimal path asset/object literals verbatim, with 1s duration.
    const p = pathMorphProject(); // helper defined alongside, per frame.test.ts's pattern
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const anim = doc.querySelector('[data-savig-object="path1"] path animate[attributeName="d"]')!;
    expect(anim.getAttribute('calcMode')).toBeNull(); // default = linear
    expect(anim.getAttribute('values')!.split(';').length).toBeGreaterThan(1);
  });

  it('animated fill color emits <animate attributeName="fill"> on the shape', () => {
    const p = movingRectProject();
    (p.objects[0] as Record<string, unknown>).colorTracks = {
      fill: [{ time: 0, value: '#ff0000', easing: 'linear' }, { time: 1, value: '#0000ff', easing: 'linear' }],
    };
    (p.objects[0] as { tracks: Record<string, unknown> }).tracks = {};
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const anim = doc.querySelector('[data-savig-object="o1"] rect animate[attributeName="fill"]')!;
    const vals = anim.getAttribute('values')!.split(';');
    expect(vals[0]).toBe('#ff0000');
    expect(vals[vals.length - 1]).toBe('#0000ff');
  });

  it('trim emits dasharray+dashoffset animates and pins pathLength=1', () => {
    // Trim window start/end animated: copy the trim project literal from
    // packages/engine/src/trim.test.ts / runtime frame.test.ts trim cases (1s duration).
    const p = trimProject();
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const shape = doc.querySelector('[data-savig-object="pt"]')!.firstElementChild!;
    expect(shape.getAttribute('pathLength')).toBe('1');
    expect(shape.querySelector('animate[attributeName="stroke-dasharray"]')).not.toBeNull();
    expect(shape.querySelector('animate[attributeName="stroke-dashoffset"]')).not.toBeNull();
  });
});
```

(Implement `pathMorphProject()` / `trimProject()` helpers in the test file by copying the corresponding minimal project literals from `packages/runtime/src/frame.test.ts` — that file already builds shapeTrack and trim projects for its own parity cases; keep durations at 1s and fps 10.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts`
Expected: the 4 new tests FAIL (no shape-level animates emitted); Task-2 tests still PASS.

- [ ] **Step 3: Implement — extend the per-object loop**

Inside the `for (const objectId of objectIds)` loop after the opacity block, add (this mirrors `applyFrameToNodes` branch-for-branch):

```ts
    const shape = wrapper.firstElementChild;

    // Geometry attributes (rect/ellipse/polygon/etc.). Union of keys across frames; each key
    // becomes one <animate> on the inner shape.
    if (shape) {
      const geomKeys = new Set<string>();
      for (const frame of sampled.frames) {
        const item = frame.find((it) => it.objectId === objectId);
        if (item?.geometry) for (const k of Object.keys(item.geometry)) geomKeys.add(k);
      }
      for (const key of geomKeys) {
        const vals = seriesFor(sampled.frames, objectId, (it) => it.geometry?.[key]);
        if (!isConstant(vals) && vals[0] !== undefined) {
          appendAnim(shape, 'animate', { attributeName: key, values: (vals as string[]).join(';'), ...timing });
        }
      }

      // Path morphs / live booleans. Linear interpolation requires an identical command
      // skeleton in every sample; topology changes (booleans) fall back to discrete.
      const dVals = seriesFor(sampled.frames, objectId, (it) => it.pathD);
      if (dVals[0] !== undefined && !isConstant(dVals)) {
        const skeleton = (d: string) => d.replace(/[^A-Za-z]+/g, '');
        const stable = (dVals as string[]).every((d) => skeleton(d) === skeleton(dVals[0] as string));
        appendAnim(shape, 'animate', {
          attributeName: 'd', values: (dVals as string[]).join(';'),
          ...(stable ? {} : { calcMode: 'discrete' }), ...timing,
        });
      }

      // Color tracks (computeFrame already suppresses these when a gradient paint owns the attr).
      for (const attr of ['fill', 'stroke'] as const) {
        const vals = seriesFor(sampled.frames, objectId, (it) => it[attr]);
        if (vals[0] !== undefined && !isConstant(vals)) {
          appendAnim(shape, 'animate', { attributeName: attr, values: (vals as string[]).join(';'), ...timing });
        }
      }

      // Dash offset (dashOffsetTrack) and trim window (dasharray width animates too).
      const dashoffset = seriesFor(sampled.frames, objectId, (it) => it.strokeDashoffset);
      if (dashoffset[0] !== undefined && !isConstant(dashoffset)) {
        appendAnim(shape, 'animate', { attributeName: 'stroke-dashoffset', values: (dashoffset as string[]).join(';'), ...timing });
      }
      const dasharray = seriesFor(sampled.frames, objectId, (it) => it.strokeDasharray);
      if (dasharray[0] !== undefined && !isConstant(dasharray)) {
        const counts = (dasharray as string[]).map((v) => v.trim().split(/[\s,]+/).length);
        const uniform = counts.every((c) => c === counts[0]);
        appendAnim(shape, 'animate', {
          attributeName: 'stroke-dasharray', values: (dasharray as string[]).join(';'),
          ...(uniform ? {} : { calcMode: 'discrete' }), ...timing,
        });
        shape.setAttribute('pathLength', '1'); // idempotent; same pin as applyFrameToNodes
      }
    }

    // Text-on-path: d lives on the savig-textpath-<id> def; startOffset on the <textPath> child.
    const tpD = seriesFor(sampled.frames, objectId, (it) => it.textPathD);
    if (tpD[0] !== undefined && !isConstant(tpD)) {
      const def = defsById.get(`savig-textpath-${objectId}`);
      if (def) appendAnim(def, 'animate', { attributeName: 'd', values: (tpD as string[]).join(';'), ...timing });
    }
    const tpOff = seriesFor(sampled.frames, objectId, (it) => it.textPathStartOffset);
    if (tpOff[0] !== undefined && !isConstant(tpOff)) {
      const tp = wrapper.querySelector('textPath');
      if (tp) appendAnim(tp, 'animate', { attributeName: 'startOffset', values: (tpOff as string[]).join(';'), ...timing });
    }
```

Remove the Task-2 `void defsById;` placeholder if present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck and commit**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
git add packages/services/src/export/animatedSvg.ts packages/services/src/export/animatedSvg.test.ts
git commit -m "feat(export): animated SVG shape attrs — geometry, d morphs, colors, dash/trim, textPath"
```

---

### Task 4: Gradient animation — geometry attrs + per-stop animates

**Files:**
- Modify: `packages/services/src/export/animatedSvg.ts`
- Test: `packages/services/src/export/animatedSvg.test.ts` (append)

**Interfaces:**
- Consumes: `gradientAttrs`, `gradientStopAttrs` from `@savig/engine` (same emitters `applyGradientToElement` uses — runtime == export by construction); Task 2 helpers; `FrameItem.fillGradient/strokeGradient` (`Gradient` objects, not strings).
- Produces: gradient defs `savig-grad-<objectId>-fill/-stroke` gain `<animate>` children on the gradient element (x1/y1/x2/y2 or cx/cy/r/fx/fy) and on each `<stop>` (offset/stop-color/stop-opacity). Stop-count baseline is the FRAME-0 def's stops; frames with more stops clamp to the last index (documented approximation for the rare stop-count-varying gradient — the runtime rebuilds stops per frame, SMIL cannot add/remove elements).

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('gradient animation', () => {
  it('animated gradient emits per-stop stop-color animates inside the grad def', () => {
    // gradientTracks project literal: copy the animated-gradient case from
    // packages/runtime/src/frame.test.ts (search "gradientTracks") — a rect whose fill
    // gradient's stop colors animate over 1s; fps 10; object id 'o1'.
    const p = gradientProject();
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const def = doc.querySelector('#savig-grad-o1-fill, [id="savig-grad-o1-fill"]')!;
    const stops = def.querySelectorAll('stop');
    expect(stops.length).toBeGreaterThan(0);
    const anim = stops[0].querySelector('animate[attributeName="stop-color"]')!;
    const vals = anim.getAttribute('values')!.split(';');
    expect(vals.length).toBe(11);
    expect(vals[0]).not.toBe(vals[vals.length - 1]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts -t gradient`
Expected: FAIL (no animates inside the def).

- [ ] **Step 3: Implement**

Add `gradientAttrs, gradientStopAttrs` to the `@savig/engine` import and `import type { Gradient }`. In the per-object loop, after the textPath block:

```ts
    // Animated gradients: bake onto the existing savig-grad-<id> def — geometry attrs on the
    // gradient element, stop attrs per <stop> child. Baseline stops = the frame-0 def's
    // children; frames with a different stop count clamp by index (SMIL cannot add/remove
    // stops — known approximation, mirrored on both paints).
    for (const paint of ['fill', 'stroke'] as const) {
      const grads = sampled.frames.map((frame) => {
        const item = frame.find((it) => it.objectId === objectId);
        return item ? (paint === 'fill' ? item.fillGradient : item.strokeGradient) : undefined;
      });
      if (!grads.some((g) => g !== undefined)) continue;
      // Hold gaps like seriesFor (inactive scene frames).
      let prev: Gradient | undefined;
      const held = grads.map((g) => (g === undefined ? prev : ((prev = g), g)));
      const firstIdx = held.findIndex((g) => g !== undefined);
      if (firstIdx === -1) continue;
      const filled = held.map((g) => g ?? held[firstIdx]!) as Gradient[];
      const def = defsById.get(`savig-grad-${objectId}-${paint}`);
      if (!def) continue;

      // Gradient geometry attributes (x1/y1/x2/y2 | cx/cy/r/fx/fy).
      const attrKeys = new Set<string>();
      for (const g of filled) for (const k of Object.keys(gradientAttrs(g))) attrKeys.add(k);
      for (const key of attrKeys) {
        const vals = filled.map((g) => gradientAttrs(g)[key] ?? '0');
        if (!isConstant(vals)) appendAnim(def, 'animate', { attributeName: key, values: vals.join(';'), ...timing });
      }

      // Per-stop attributes, clamped by index against each frame's stop list.
      const stops = Array.from(def.children).filter((c) => c.tagName === 'stop');
      stops.forEach((stopEl, j) => {
        for (const key of ['offset', 'stop-color', 'stop-opacity']) {
          const vals = filled.map((g) => {
            const s = g.stops[Math.min(j, g.stops.length - 1)];
            return gradientStopAttrs(s)[key] ?? (key === 'stop-opacity' ? '1' : undefined);
          });
          if (vals.every((v) => v !== undefined) && !isConstant(vals)) {
            appendAnim(stopEl, 'animate', { attributeName: key, values: (vals as string[]).join(';'), ...timing });
          }
        }
      });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck and commit**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
git add packages/services/src/export/animatedSvg.ts packages/services/src/export/animatedSvg.test.ts
git commit -m "feat(export): animated SVG gradients — def geometry + per-stop SMIL animates"
```

---

### Task 5: Scenes, cameras, transitions (crossfade/dip)

**Files:**
- Modify: `packages/services/src/export/animatedSvg.ts`
- Test: `packages/services/src/export/animatedSvg.test.ts` (append)

**Interfaces:**
- Consumes: `sceneAtTime`, `projectScenes`, `computeCameraTransform`, `computeSceneCameraTransform`, `resolveTimeline` from `@savig/engine`; Task 1 `appendTransformAnims` path; Task 2 helpers. The per-frame visibility/opacity/dip logic replicates `applyProjectFrame` (packages/runtime/src/frame.ts:271) decision-for-decision.
- Produces: scene groups animate via the `display` ATTRIBUTE (the exporter strips the static `style="display:none"` and sets `display="none"` instead — SMIL animates presentation attributes, and inline style would win over the base value); crossfade = linear `opacity` animate on the incoming group; dip = an eagerly-emitted `<rect data-savig-dip>` last child of the root with discrete `display`/`fill` + linear `opacity` animates; cameras get the Task-1 stacked-transform treatment.

- [ ] **Step 1: Write the failing tests (append)**

```ts
describe('scenes, camera, transitions', () => {
  it('single-scene camera group gets stacked animateTransforms', () => {
    const p = movingRectProject();
    (p.objects[0] as { tracks: Record<string, unknown> }).tracks = {};
    (p as Record<string, unknown>).camera = {
      base: { x: 160, y: 120, zoom: 1, rotation: 0 },
      tracks: { zoom: [{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 2, easing: 'linear' }] },
    };
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const cam = doc.querySelector('[data-savig-camera]')!;
    expect(cam.querySelector('animateTransform[type="translate"]')).not.toBeNull();
  });

  it('multi-scene: groups use display ATTRIBUTE (no inline style) with discrete animates', () => {
    const p = promoteToMultiScene(movingRectProject());
    // Give it a second scene so scene switching exists: copy the two-scene construction
    // from e2e/multi-scene-export.spec.ts or packages/engine/src/scenes.test.ts (two scenes,
    // each duration 0.5s, kind 'cut'). fps 10.
    const p2 = withSecondScene(p);
    const doc = parseDoc(renderAnimatedSvgDocument(p2));
    const groups = doc.querySelectorAll('[data-savig-scene]');
    expect(groups.length).toBe(2);
    groups.forEach((g) => {
      expect(g.getAttribute('style')).toBeNull();
      const anim = g.querySelector(':scope > animate[attributeName="display"]')!;
      expect(anim.getAttribute('calcMode')).toBe('discrete');
      const vals = anim.getAttribute('values')!.split(';');
      expect(vals).toContain('none');
      expect(vals).toContain('inline');
    });
  });

  it('dip transition emits the overlay rect eagerly with an opacity ramp', () => {
    const p2 = withSecondScene(promoteToMultiScene(movingRectProject()));
    // set scenes[1].transitionIn = { kind: 'dip', duration: 0.2, color: '#000000' }
    setDipTransition(p2);
    const doc = parseDoc(renderAnimatedSvgDocument(p2));
    const rect = doc.querySelector('rect[data-savig-dip]')!;
    expect(rect.parentElement!.tagName).toBe('svg');
    expect(rect.nextElementSibling).toBeNull(); // last child = top z
    const op = rect.querySelector('animate[attributeName="opacity"]')!;
    const vals = op.getAttribute('values')!.split(';').map(Number);
    expect(Math.max(...vals)).toBeGreaterThan(0.5); // the triangle ramp peaks
  });
});
```

(`withSecondScene` / `setDipTransition` are small test helpers; build them on `promoteToMultiScene` + direct `scenes` array edits, matching the literals in `packages/engine/src/scenes.test.ts`.)

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts -t "scenes, camera"`
Expected: FAIL.

- [ ] **Step 3: Implement**

After the per-object loop in `renderAnimatedSvgDocument`, add:

```ts
  appendCameraAndSceneAnims(doc, project, sampled, timing);
```

and implement (top-level functions in the same file):

```ts
import {
  computeCameraTransform, computeProjectDuration, computeSceneCameraTransform, fmt,
  gradientAttrs, gradientStopAttrs, projectScenes, resolveTimeline, sceneAtTime,
} from '@savig/engine';

/** Per-frame scene/camera state, replicating applyProjectFrame's decisions exactly. */
function appendCameraAndSceneAnims(
  doc: Document,
  project: Project,
  sampled: Sampled,
  timing: Record<string, string>,
): void {
  if (!project.scenes) {
    // Single-scene root camera.
    const cam = doc.querySelector('[data-savig-camera]');
    if (cam) {
      const series = sampled.times.map((t) => computeCameraTransform(project, t) ?? '');
      if (!isConstant(series)) appendTransformAnims(cam, series, timing);
    }
    return;
  }

  const scenes = projectScenes(project);
  const perScene = new Map<string, { display: string[]; opacity: string[]; camera: string[] }>();
  for (const s of scenes) perScene.set(s.id, { display: [], opacity: [], camera: [] });
  const dip = { display: [] as string[], opacity: [] as string[], fill: [] as string[] };
  let anyDip = false;
  const lastCamera = new Map<string, string>();

  for (const t of sampled.times) {
    const { primary, outgoing } = sceneAtTime(project, t);
    const transition = outgoing ? primary.scene.transitionIn : undefined;
    const dipT = transition && transition.kind === 'dip' ? transition : null;
    const crossfade = !!(transition && transition.kind === 'crossfade');
    const second = outgoing ? outgoing.progress >= 0.5 : false;

    for (const s of scenes) {
      const st = perScene.get(s.id)!;
      let visible = false;
      let opacity = '1';
      let localTime: number | null = null;
      if (s.id === primary.scene.id) {
        visible = dipT ? second : true;
        if (outgoing && crossfade) opacity = fmt(outgoing.progress);
        localTime = primary.localTime;
      } else if (outgoing && s.id === outgoing.scene.id) {
        visible = dipT ? !second : true;
        localTime = outgoing.localTime;
      }
      st.display.push(visible ? 'inline' : 'none');
      st.opacity.push(opacity);
      const camT = localTime !== null
        ? computeSceneCameraTransform(s.camera, project.meta.width, project.meta.height, localTime)
        : null;
      const held = camT ?? lastCamera.get(s.id) ?? '';
      lastCamera.set(s.id, held);
      st.camera.push(held);
    }

    if (outgoing && dipT) {
      anyDip = true;
      const pgs = outgoing.progress;
      dip.display.push('inline');
      dip.opacity.push(fmt(pgs < 0.5 ? pgs / 0.5 : (1 - pgs) / 0.5));
      dip.fill.push(dipT.color);
    } else {
      dip.display.push('none');
      dip.opacity.push('0');
      dip.fill.push(dip.fill[dip.fill.length - 1] ?? '#000000');
    }
  }

  doc.querySelectorAll('[data-savig-scene]').forEach((g) => {
    const st = perScene.get(g.getAttribute('data-savig-scene')!);
    if (!st) return;
    // SMIL animates the display ATTRIBUTE; strip the renderer's inline style (which would
    // outrank the base attribute) and re-express frame-0 visibility as an attribute.
    g.removeAttribute('style');
    g.setAttribute('display', st.display[0]);
    if (!isConstant(st.display)) {
      appendAnim(g, 'animate', { attributeName: 'display', values: st.display.join(';'), calcMode: 'discrete', ...timing });
    }
    if (!isConstant(st.opacity)) {
      appendAnim(g, 'animate', { attributeName: 'opacity', values: st.opacity.join(';'), ...timing });
    }
    const camEl = g.querySelector('[data-savig-camera]');
    if (camEl && !isConstant(st.camera)) appendTransformAnims(camEl, st.camera, timing);
  });

  if (anyDip) {
    // Eager dip overlay — same geometry as the runtime's lazy ensureDipOverlay, last child = top z.
    const root = doc.documentElement;
    const rect = doc.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('data-savig-dip', '');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', fmt(project.meta.width));
    rect.setAttribute('height', fmt(project.meta.height));
    rect.setAttribute('opacity', '0');
    rect.setAttribute('display', 'none');
    rect.setAttribute('fill', dip.fill[0]);
    root.appendChild(rect);
    appendAnim(rect, 'animate', { attributeName: 'display', values: dip.display.join(';'), calcMode: 'discrete', ...timing });
    appendAnim(rect, 'animate', { attributeName: 'opacity', values: dip.opacity.join(';'), ...timing });
    if (!isConstant(dip.fill)) {
      appendAnim(rect, 'animate', { attributeName: 'fill', values: dip.fill.join(';'), calcMode: 'discrete', ...timing });
    }
  }
  void resolveTimeline; // remove if unused after implementation settles
}
```

(Drop the `void resolveTimeline;` line and its import if `sceneAtTime` alone suffices — it does unless the dip-existence pre-check is wanted; `anyDip` already handles it.)

- [ ] **Step 4: Run the full export test file**

Run: `node_modules/.bin/vitest run packages/services/src/export/animatedSvg.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck and commit**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
git add packages/services/src/export/animatedSvg.ts packages/services/src/export/animatedSvg.test.ts
git commit -m "feat(export): animated SVG scenes — display attrs, crossfade/dip, per-scene cameras"
```

---

### Task 6: Editor surface — command, host, fileOps

**Files:**
- Modify: `packages/ui-core/src/commands/types.ts:47-58` (add `exportAnimatedSvg(): void;` to `CommandHost`, after `exportSvg`)
- Modify: `packages/ui-core/src/commands/registry.ts:164` (insert after `file.exportSvg`)
- Modify: `apps/react/src/ui/commandHost.ts` (wire method)
- Modify: `apps/react/src/ui/fileOps.ts` (new `exportAnimatedSvg()`)
- Modify (mechanical): every fake/mock `CommandHost` — `packages/ui-core/src/commands/registry.test.ts`, `packages/ui-core/src/controllers/keymap.test.ts`, `apps/react/src/ui/components/CommandPalette/CommandPalette.test.tsx`, `apps/react/src/ui/hooks/useKeyboard.test.ts` (add `exportAnimatedSvg: vi.fn()` / no-op next to each fake's `exportSvg`)
- Test: `apps/react/src/ui/fileOps.test.ts` (append), `packages/ui-core/src/commands/registry.test.ts` (append)

**Interfaces:**
- Consumes: `renderAnimatedSvgDocument` from `@savig/services/export/animatedSvg` (Task 2).
- Produces: command id `file.exportAnimatedSvg`, title `Export animated SVG`; `CommandHost.exportAnimatedSvg(): void`; download `<project name>.svg`, mime `image/svg+xml`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/react/src/ui/fileOps.test.ts` (its `saveBytesToDisk` mock and `beforeEach` already exist — extend the `import { exportSvg } from './fileOps'` line to also import `exportAnimatedSvg`):

```ts
it('exportAnimatedSvg saves a .svg containing SMIL animation for an animated project', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const s = useEditor.getState();
  const objId = s.history.present.objects[0].id;
  s.setKeyframe(objId, 'x', 0, 0);
  s.setKeyframe(objId, 'x', 1, 100);
  await exportAnimatedSvg();
  expect(saveBytesToDisk).toHaveBeenCalledOnce();
  const [bytes, name, mime] = saveBytesToDisk.mock.calls[0];
  expect(name).toMatch(/\.svg$/);
  expect(mime).toBe('image/svg+xml');
  const markup = new TextDecoder().decode(bytes as Uint8Array);
  expect(markup).toContain('animateTransform');
});
```

(If `setKeyframe`'s store signature differs, copy the keyframe-setting call from any timeline store test — `grep -rn "setKeyframe(" apps/react/src/ui/store | head` — and adjust; assert on `animateTransform` regardless.)

Append to `packages/ui-core/src/commands/registry.test.ts`, following its existing `file.exportSvg` test's shape exactly (same fake-context builder):

```ts
it('file.exportAnimatedSvg calls host.exportAnimatedSvg', () => {
  const { ctx, host } = makeCtx(); // reuse the file's existing fake-context helper name
  run('file.exportAnimatedSvg', ctx);
  expect(host.exportAnimatedSvg).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run apps/react/src/ui/fileOps.test.ts packages/ui-core/src/commands/registry.test.ts`
Expected: FAIL (typecheck/no such export/command).

- [ ] **Step 3: Implement**

`packages/ui-core/src/commands/types.ts` — in `CommandHost` after `exportSvg(): void;`:
```ts
  exportAnimatedSvg(): void;
```

`packages/ui-core/src/commands/registry.ts` — after line 164:
```ts
  { id: 'file.exportAnimatedSvg', title: 'Export animated SVG', category: 'File', keywords: ['export', 'svg', 'animated', 'smil', 'animation'], run: (c) => c.host.exportAnimatedSvg() },
```

`apps/react/src/ui/fileOps.ts` — change the services import to also pull the new module and append:
```ts
import { renderAnimatedSvgDocument } from '@savig/services/export/animatedSvg';

/** Export a single-file SMIL-animated SVG — plays anywhere, including <img>/READMEs.
 *  Audio (bundle-only) and script interactivity are inherently absent from this artifact. */
export async function exportAnimatedSvg(): Promise<void> {
  const project = useEditor.getState().history.present;
  try {
    const markup = renderAnimatedSvgDocument(project);
    const bytes = new TextEncoder().encode(markup);
    await saveBytesToDisk(bytes, `${project.meta.name}.svg`, 'image/svg+xml');
  } catch (err) {
    useEditor.getState().pushToast('error', `Animated SVG export failed: ${(err as Error).message}`);
  }
}
```

`apps/react/src/ui/commandHost.ts` — after the `exportSvg` line:
```ts
    exportAnimatedSvg: () => void fileOps.exportAnimatedSvg(),
```

Then fix every fake `CommandHost` the compiler flags (the four test files listed above): add `exportAnimatedSvg: vi.fn(),` (or `() => {}` matching each fake's style) next to its `exportSvg` entry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run apps/react/src/ui/fileOps.test.ts packages/ui-core/src/commands/registry.test.ts packages/ui-core/src/controllers/keymap.test.ts apps/react/src/ui/components/CommandPalette/CommandPalette.test.tsx apps/react/src/ui/hooks/useKeyboard.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck and commit**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
git add packages/ui-core/src/commands/types.ts packages/ui-core/src/commands/registry.ts apps/react/src/ui/commandHost.ts apps/react/src/ui/fileOps.ts apps/react/src/ui/fileOps.test.ts packages/ui-core/src/commands/registry.test.ts packages/ui-core/src/controllers/keymap.test.ts apps/react/src/ui/components/CommandPalette/CommandPalette.test.tsx apps/react/src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(editor): Export animated SVG palette command"
```

---

### Task 7: Node path + MCP `export_svg animated`

**Files:**
- Create: `packages/core/src/node/animatedSvg.ts`
- Test: `packages/core/src/node/animatedSvg.test.ts`
- Modify: `packages/core/src/node/index.ts` (re-export, matching how `renderGif` is exported — check the file's pattern)
- Modify: `packages/mcp/src/tools.ts` (~line 348, the `export_svg` tool; `bool` helper next to `num`/`str` at lines 90-91)
- Test: `packages/mcp/src/tools.test.ts` (append)

**Interfaces:**
- Consumes: `renderAnimatedSvgDocument(project, env)` (Task 2); `JSDOM` (already a core dependency, see packages/core/src/node/render.ts:12).
- Produces: `renderAnimatedSvgNode(project: Project): string` — Node-safe wrapper injecting jsdom's DOM classes. MCP `export_svg` input gains `animated` (boolean, DEFAULT true → the tool description's "self-contained animated SVG document" finally holds); `animated: false` returns the static `renderProjectDocument` output.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/node/animatedSvg.test.ts
import { describe, it, expect } from 'vitest';
import { renderAnimatedSvgNode } from './animatedSvg';
// Build the same movingRectProject as packages/services/src/export/animatedSvg.test.ts
// (copy the helper — 1s, fps 10, x 0->100 rect).

describe('renderAnimatedSvgNode', () => {
  it('produces SMIL markup without any global DOM (bare Node env)', () => {
    const markup = renderAnimatedSvgNode(movingRectProject());
    expect(markup).toContain('<svg');
    expect(markup).toContain('animateTransform');
  });
  it('is deterministic', () => {
    const p = movingRectProject();
    expect(renderAnimatedSvgNode(p)).toBe(renderAnimatedSvgNode(p));
  });
});
```

Append to `packages/mcp/src/tools.test.ts` (follow its existing `export_svg` test's session-construction pattern):

```ts
it('export_svg returns SMIL-animated markup by default and static with animated:false', async () => {
  // session: create a project with one keyframed rect via the file's existing session helpers
  const animated = await callTool('export_svg', {});
  expect(textOf(animated)).toContain('animateTransform');
  const still = await callTool('export_svg', { animated: false });
  expect(textOf(still)).not.toContain('animateTransform');
});
```

(`callTool`/`textOf`: use the file's actual invocation helpers — read its existing `export_svg` test first and mirror it exactly.)

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run packages/core/src/node/animatedSvg.test.ts packages/mcp/src/tools.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/node/animatedSvg.ts
// Node-safe animated-SVG export: the shared emitter needs DOMParser/XMLSerializer, which bare
// Node lacks — inject jsdom's (same dependency renderFrameSvg already uses).
import { JSDOM } from 'jsdom';
import type { Project } from '@savig/engine';
import { renderAnimatedSvgDocument } from '@savig/services/export/animatedSvg';

export function renderAnimatedSvgNode(project: Project): string {
  const { window } = new JSDOM('');
  return renderAnimatedSvgDocument(project, {
    DOMParser: window.DOMParser as unknown as typeof DOMParser,
    XMLSerializer: window.XMLSerializer as unknown as typeof XMLSerializer,
  });
}
```

Re-export from `packages/core/src/node/index.ts` alongside the existing render exports.

`packages/mcp/src/tools.ts` — next to `const num`/`const str` (lines 90-91):
```ts
const bool = { type: 'boolean' };
```
Replace the `export_svg` tool body:
```ts
  {
    name: 'export_svg',
    description:
      'Return the self-contained SVG document for the current project (the deliverable). ' +
      'Default: SMIL-animated — plays anywhere, including <img>. Pass animated:false for a static frame-0 snapshot.',
    inputSchema: obj({ animated: bool }),
    run(session, a) {
      const animated = (a.animated as boolean | undefined) ?? true;
      const markup = animated
        ? renderAnimatedSvgNode(session.project)
        : renderProjectDocument(session.project);
      return { content: [text(markup)] };
    },
  },
```
Add `renderAnimatedSvgNode` to the existing `@savig/core/node` import (line 39).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run packages/core/src/node/animatedSvg.test.ts packages/mcp/src/tools.test.ts`
Expected: PASS (all, including the pre-existing MCP tests).

- [ ] **Step 5: Typecheck and commit**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
git add packages/core/src/node/animatedSvg.ts packages/core/src/node/animatedSvg.test.ts packages/core/src/node/index.ts packages/mcp/src/tools.ts packages/mcp/src/tools.test.ts
git commit -m "feat(mcp): export_svg emits SMIL-animated SVG by default (animated:false for snapshot)"
```

---

### Task 8: E2E — deterministic SMIL seek + `<img>` smoke + palette flow

**Files:**
- Create: `e2e/animated-svg-export.spec.ts`

**Interfaces:**
- Consumes: `renderAnimatedSvgNode` (Task 7) for the Node-built artifact (precedent: `e2e/multi-scene-export.spec.ts` calls `exportProject` directly from the spec's Node context); the `file.exportAnimatedSvg` palette command (Task 6); `SVGSVGElement.pauseAnimations()/setCurrentTime()` — SMIL's built-in deterministic seek.

- [ ] **Step 1: Write the spec**

```ts
// e2e/animated-svg-export.spec.ts
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderAnimatedSvgNode } from '@savig/core/node';
// Project construction: copy the keyframed-rect project builder used by
// e2e/multi-scene-export.spec.ts (createProject + one rect + x keyframes 0->100 over 1s, fps 30).

test('exported animated SVG really animates (deterministic SMIL seek)', async ({ page }) => {
  const markup = renderAnimatedSvgNode(buildAnimatedProject());
  const dir = mkdtempSync(join(tmpdir(), 'savig-anim-'));
  const file = join(dir, 'anim.svg');
  writeFileSync(file, markup);
  await page.goto(pathToFileURL(file).href);

  const ctmAt = (t: number) =>
    page.evaluate((time) => {
      const svg = document.documentElement as unknown as SVGSVGElement;
      svg.pauseAnimations();
      svg.setCurrentTime(time);
      const el = document.querySelector('[data-savig-object]') as SVGGraphicsElement;
      const m = el.getCTM()!;
      return [m.a, m.b, m.c, m.d, m.e, m.f].join(',');
    }, t);

  const at0 = await ctmAt(0);
  const atMid = await ctmAt(0.5);
  expect(atMid).not.toBe(at0);
});

test('exported animated SVG renders inside an <img> (script-free context)', async ({ page }) => {
  const markup = renderAnimatedSvgNode(buildAnimatedProject());
  const dir = mkdtempSync(join(tmpdir(), 'savig-anim-img-'));
  writeFileSync(join(dir, 'anim.svg'), markup);
  writeFileSync(join(dir, 'wrap.html'), '<!DOCTYPE html><img src="anim.svg" width="320">');
  await page.goto(pathToFileURL(join(dir, 'wrap.html')).href);
  const loaded = await page.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);
});

test('Export animated SVG from the command palette downloads a .svg', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await page.locator('section[aria-label="Stage"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('export animated svg');
  const downloadPromise = page.waitForEvent('download');
  await palette.getByLabel('Command search').press('Enter');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
});
```

Check how `e2e/multi-scene-export.spec.ts` imports workspace packages (its exact import specifier and any tsconfig path usage) and mirror it for the `@savig/core/node` import; if e2e resolves via relative paths, use `../packages/core/src/node` the same way that spec does.

- [ ] **Step 2: Kill stale dev servers, run the spec**

```bash
pkill -f vite || true
node_modules/.bin/playwright test e2e/animated-svg-export.spec.ts
```
Expected: 3 passed. (Debug rule from memory: a "not enabled"/timeout on a previously-working selector usually means a NEW DOM source of the same attribute, not the env.)

- [ ] **Step 3: Run the full verification suite**

```bash
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/vitest run
node_modules/.bin/playwright test
```
Expected: all green (baseline before this feature: 2590 unit + 142 e2e).

- [ ] **Step 4: Commit**

```bash
git add e2e/animated-svg-export.spec.ts
git commit -m "test(e2e): animated SVG export — SMIL seek determinism, <img> smoke, palette flow"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1-4 → Tasks 1-2 architecture; property-mapping table → Tasks 2 (transform/opacity), 3 (geometry/d/colors/dash/textPath), 4 (gradients), 5 (camera/scenes/dip); surface → Task 6 (palette/host/fileOps) + Task 7 (MCP `animated`); error handling → Task 2 (zero-duration static, determinism), Task 1 (degenerate decompose), `MissingAssetError` propagates untouched through `renderProjectDocument`; testing → parity test (Task 2 Step 1), decompose round-trip (Task 1), e2e `setCurrentTime` + `<img>` (Task 8).
- **Known approximation (per spec follow-ups):** stop-count-varying gradients clamp by index (Task 4); values-list compression beyond constant-elimination deferred.
- **Type consistency:** `renderAnimatedSvgDocument(project, env?)` used identically in Tasks 2/6/7; `Decomposed`/`parseTransform` names consistent Tasks 1/2/5; command id `file.exportAnimatedSvg` consistent Tasks 6/8.
