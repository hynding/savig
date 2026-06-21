# M2 Slice 8 — Gradients: Engine & Pipeline (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure gradient data model + SVG emission, make the render seam paint fill/stroke with `url(#…)` when a gradient is present, emit gradient defs on export, and guarantee a gradient overrides any color track per-frame.

**Architecture:** A `Gradient` is an additive optional field on `VectorStyle` (`fillGradient`/`strokeGradient`), in `objectBoundingBox` units (0..1) so it auto-fits geometry/morph with zero per-frame work. A new pure `engine/gradient.ts` is the parity oracle for gradient markup. The shape element stays the wrapper `<g>`'s `firstElementChild` everywhere, so gradient defs are emitted separately (top-level `<defs>` on export). Static only — no `FrameItem` field, no runtime bundle regen, no persistence migration (stays v4).

**Tech Stack:** TypeScript (strict), Vitest. Pure functions; all numbers through `fmt`, all colors through `escapeAttr`.

## Global Constraints

- TypeScript strict; no `any`. Follow existing engine style (small pure modules, barrel re-export from `src/engine/index.ts`).
- All emitted numbers go through `fmt` (`src/engine/transform.ts`); all emitted color/string attribute values through `escapeAttr` (defense-in-depth).
- No persistence version bump — `CURRENT_VERSION` stays `4` (additive optional fields serialize generically via `JSON.stringify(sortKeys(...))`).
- No runtime bundle regeneration in this plan (gradients are static — baked into initial export markup, never updated per-frame).
- Gradient id scheme: `savig-grad-<objectId>-fill` / `savig-grad-<objectId>-stroke`.
- TDD: failing test → run (fail) → minimal impl → run (pass) → commit. One logical change per commit.

---

### Task 1: Gradient types + `engine/gradient.ts` (`paintRef`, `gradientToSvg`)

**Files:**
- Modify: `src/engine/types.ts` (add `GradientStop`, `LinearGradient`, `RadialGradient`, `Gradient`; add `fillGradient?`/`strokeGradient?` to `VectorStyle`)
- Create: `src/engine/svgAttr.ts` (move `escapeAttr` here to avoid a renderShape↔gradient import cycle)
- Modify: `src/engine/renderShape.ts` (import `escapeAttr` from `./svgAttr`; delete the local copy)
- Create: `src/engine/gradient.ts`
- Create: `src/engine/gradient.test.ts`
- Modify: `src/engine/index.ts` (barrel: `export * from './gradient';` and `export * from './svgAttr';`)

**Interfaces:**
- Produces:
  - `interface GradientStop { offset: number; color: string; opacity?: number }`
  - `interface LinearGradient { type:'linear'; x1:number; y1:number; x2:number; y2:number; stops: GradientStop[] }`
  - `interface RadialGradient { type:'radial'; cx:number; cy:number; r:number; fx?:number; fy?:number; stops: GradientStop[] }`
  - `type Gradient = LinearGradient | RadialGradient`
  - `VectorStyle.fillGradient?: Gradient`, `VectorStyle.strokeGradient?: Gradient`
  - `paintRef(id: string): string`
  - `gradientToSvg(id: string, g: Gradient): string`
  - `escapeAttr(value: string): string` (now from `./svgAttr`)

- [ ] **Step 1: Add types to `src/engine/types.ts`**

After the `VectorStyle` interface, and inside it, add (place the new interfaces just before `VectorStyle`):

```ts
export interface GradientStop {
  /** 0..1 position along the gradient. */
  offset: number;
  /** Hex color ('#rgb' / '#rrggbb'). */
  color: string;
  /** 0..1; omitted = 1 (fully opaque). */
  opacity?: number;
}

export interface LinearGradient {
  type: 'linear';
  /** Endpoints in objectBoundingBox units (0..1). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
}

export interface RadialGradient {
  type: 'radial';
  /** Center + radius in objectBoundingBox units (0..1). */
  cx: number;
  cy: number;
  r: number;
  /** Optional focal point (defaults to center). */
  fx?: number;
  fy?: number;
  stops: GradientStop[];
}

export type Gradient = LinearGradient | RadialGradient;
```

In `VectorStyle`, add the two optional fields after `strokeLinejoin?`:

```ts
  /** When present, fill is painted with this gradient (overrides `fill` + any fill color track). */
  fillGradient?: Gradient;
  /** When present, stroke is painted with this gradient (overrides `stroke` + any stroke color track). */
  strokeGradient?: Gradient;
```

- [ ] **Step 2: Extract `escapeAttr` to `src/engine/svgAttr.ts`**

Create `src/engine/svgAttr.ts`:

```ts
// Escape attribute values inlined into exported HTML/SVG. Values may originate
// from a loaded .savig (untrusted), so a crafted value must not break out of the
// attribute and inject markup. Shared by renderShape and gradient emission.
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

In `src/engine/renderShape.ts`: delete the local `escapeAttr` function (lines ~45-54) and add at the top with the other imports:

```ts
import { escapeAttr } from './svgAttr';
```

- [ ] **Step 3: Write the failing test `src/engine/gradient.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { gradientToSvg, paintRef } from './gradient';
import type { LinearGradient, RadialGradient } from './types';

describe('paintRef', () => {
  it('wraps an id as a url() reference', () => {
    expect(paintRef('savig-grad-abc-fill')).toBe('url(#savig-grad-abc-fill)');
  });
});

describe('gradientToSvg', () => {
  const linear: LinearGradient = {
    type: 'linear',
    x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ],
  };

  it('emits a linearGradient with no gradientUnits (objectBoundingBox default)', () => {
    const svg = gradientToSvg('g1', linear);
    expect(svg).toBe(
      '<linearGradient id="g1" x1="0" y1="0.5" x2="1" y2="0.5">' +
        '<stop offset="0" stop-color="#000000"/>' +
        '<stop offset="1" stop-color="#ffffff"/>' +
        '</linearGradient>',
    );
    expect(svg).not.toContain('gradientUnits');
  });

  it('emits a radialGradient with cx/cy/r and optional focal point', () => {
    const radial: RadialGradient = {
      type: 'radial',
      cx: 0.5, cy: 0.5, r: 0.5, fx: 0.25, fy: 0.75,
      stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
    };
    expect(gradientToSvg('g2', radial)).toBe(
      '<radialGradient id="g2" cx="0.5" cy="0.5" r="0.5" fx="0.25" fy="0.75">' +
        '<stop offset="0" stop-color="#ff0000"/>' +
        '<stop offset="1" stop-color="#0000ff"/>' +
        '</radialGradient>',
    );
  });

  it('omits fx/fy when absent', () => {
    const radial: RadialGradient = {
      type: 'radial', cx: 0.5, cy: 0.5, r: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    };
    expect(gradientToSvg('g3', radial)).not.toContain('fx=');
  });

  it('emits stop-opacity only when < 1, clamping offset and opacity to [0,1]', () => {
    const g: LinearGradient = {
      type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0,
      stops: [
        { offset: -0.5, color: '#000000', opacity: 1 },
        { offset: 1.5, color: '#ffffff', opacity: 0.3 },
      ],
    };
    const svg = gradientToSvg('g4', g);
    expect(svg).toContain('<stop offset="0" stop-color="#000000"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#ffffff" stop-opacity="0.3"/>');
  });

  it('escapes a malicious stop color (defense-in-depth)', () => {
    const g: LinearGradient = {
      type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0,
      stops: [{ offset: 0, color: '"><script>alert(1)</script>' }, { offset: 1, color: '#fff' }],
    };
    const svg = gradientToSvg('g5', g);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run src/engine/gradient.test.ts`
Expected: FAIL — `gradient.ts` does not exist / `gradientToSvg` not defined.

- [ ] **Step 5: Implement `src/engine/gradient.ts`**

```ts
import { fmt } from './transform';
import { escapeAttr } from './svgAttr';
import type { Gradient, GradientStop } from './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Reference string for a gradient by id, e.g. url(#savig-grad-abc-fill). */
export function paintRef(id: string): string {
  return `url(#${id})`;
}

function stopToSvg(s: GradientStop): string {
  let attr = `offset="${fmt(clamp01(s.offset))}" stop-color="${escapeAttr(s.color)}"`;
  if (s.opacity !== undefined && s.opacity < 1) {
    attr += ` stop-opacity="${fmt(clamp01(s.opacity))}"`;
  }
  return `<stop ${attr}/>`;
}

/**
 * Emit a <linearGradient>/<radialGradient> def with <stop> children. No
 * gradientUnits attribute (objectBoundingBox default). Pure: numbers via fmt,
 * colors via escapeAttr; offset/opacity clamped to [0,1].
 */
export function gradientToSvg(id: string, g: Gradient): string {
  const stops = g.stops.map(stopToSvg).join('');
  if (g.type === 'linear') {
    return (
      `<linearGradient id="${escapeAttr(id)}" x1="${fmt(g.x1)}" y1="${fmt(g.y1)}" ` +
      `x2="${fmt(g.x2)}" y2="${fmt(g.y2)}">${stops}</linearGradient>`
    );
  }
  let attrs = `id="${escapeAttr(id)}" cx="${fmt(g.cx)}" cy="${fmt(g.cy)}" r="${fmt(g.r)}"`;
  if (g.fx !== undefined) attrs += ` fx="${fmt(g.fx)}"`;
  if (g.fy !== undefined) attrs += ` fy="${fmt(g.fy)}"`;
  return `<radialGradient ${attrs}>${stops}</radialGradient>`;
}
```

- [ ] **Step 6: Add barrel exports in `src/engine/index.ts`**

Add after `export * from './renderShape';`:

```ts
export * from './svgAttr';
export * from './gradient';
```

- [ ] **Step 7: Run tests + typecheck to verify green**

Run: `pnpm vitest run src/engine/gradient.test.ts src/engine/renderShape.test.ts && pnpm typecheck`
Expected: PASS (gradient tests pass; renderShape tests still green after the `escapeAttr` move).

- [ ] **Step 8: Commit**

```bash
git add src/engine/types.ts src/engine/svgAttr.ts src/engine/renderShape.ts src/engine/gradient.ts src/engine/gradient.test.ts src/engine/index.ts
git commit -m "feat(gradient): Gradient types + gradientToSvg/paintRef pure emitter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Default-gradient + angle helpers (UI conveniences, pure)

**Files:**
- Modify: `src/engine/gradient.ts`
- Modify: `src/engine/gradient.test.ts`

**Interfaces:**
- Consumes: `Gradient`, `LinearGradient`, `GradientStop` from Task 1.
- Produces:
  - `defaultGradient(type: 'linear' | 'radial', seedColor?: string): Gradient` — a two-stop gradient (`seedColor ?? '#000000'` → `#ffffff`), horizontal linear / centered radial.
  - `angleToLinearCoords(deg: number): { x1:number; y1:number; x2:number; y2:number }` — angle (degrees, 0 = left→right, clockwise) → objectBoundingBox endpoints.
  - `linearCoordsToAngle(g: LinearGradient): number` — inverse (for displaying the current angle).

- [ ] **Step 1: Write the failing tests (append to `src/engine/gradient.test.ts`)**

```ts
import { angleToLinearCoords, defaultGradient, linearCoordsToAngle } from './gradient';

describe('defaultGradient', () => {
  it('builds a horizontal two-stop linear gradient seeded by a color', () => {
    expect(defaultGradient('linear', '#112233')).toEqual({
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#112233' }, { offset: 1, color: '#ffffff' }],
    });
  });
  it('builds a centered two-stop radial gradient, defaulting the seed to black', () => {
    expect(defaultGradient('radial')).toEqual({
      type: 'radial', cx: 0.5, cy: 0.5, r: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
  });
});

describe('angle <-> linear coords', () => {
  it('0deg is left->right across the bbox', () => {
    expect(angleToLinearCoords(0)).toEqual({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
  });
  it('90deg is top->bottom', () => {
    const c = angleToLinearCoords(90);
    expect(c.x1).toBeCloseTo(0.5); expect(c.y1).toBeCloseTo(0);
    expect(c.x2).toBeCloseTo(0.5); expect(c.y2).toBeCloseTo(1);
  });
  it('round-trips an angle', () => {
    expect(linearCoordsToAngle({ type: 'linear', ...angleToLinearCoords(135), stops: [] }))
      .toBeCloseTo(135);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/engine/gradient.test.ts`
Expected: FAIL — `defaultGradient`/`angleToLinearCoords`/`linearCoordsToAngle` not defined.

- [ ] **Step 3: Implement (append to `src/engine/gradient.ts`)**

```ts
import type { LinearGradient } from './types';

export function defaultGradient(type: 'linear' | 'radial', seedColor?: string): Gradient {
  const stops: GradientStop[] = [
    { offset: 0, color: seedColor ?? '#000000' },
    { offset: 1, color: '#ffffff' },
  ];
  return type === 'linear'
    ? { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops }
    : { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops };
}

// Angle in degrees, 0 = left->right, increasing clockwise (y grows downward).
// Endpoints are the unit-bbox diameter through the center along the angle,
// clamped into [0,1] by construction (center +/- 0.5 along a unit vector,
// projected so the line spans corner-to-corner is NOT needed — a centered
// half-extent of 0.5 keeps endpoints within the box for axis-aligned angles
// and is the conventional CSS-like behavior).
export function angleToLinearCoords(deg: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

export function linearCoordsToAngle(g: LinearGradient): number {
  const deg = (Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}
```

(Merge the `import type { LinearGradient }` into the existing type import at the top of the file rather than adding a duplicate import line.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/engine/gradient.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/gradient.ts src/engine/gradient.test.ts
git commit -m "feat(gradient): defaultGradient + angle<->linear-coords helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `renderShapeToSvg` gains `idScope` (paints `url(#…)` when a gradient is present)

**Files:**
- Modify: `src/engine/renderShape.ts`
- Modify: `src/engine/renderShape.test.ts`

**Interfaces:**
- Consumes: `paintRef` (Task 1), `VectorStyle.fillGradient`/`strokeGradient` (Task 1).
- Produces: `renderShapeToSvg(shapeType, geometry, style, path?, idScope?)` — when `style.fillGradient`/`strokeGradient` is present **and** `idScope` is given, the element's `fill`/`stroke` becomes `url(#savig-grad-<idScope>-fill|stroke)`; otherwise the solid `style.fill`/`stroke` is used. Returns only the shape element (still `firstElementChild`-safe). The `<g>` wrapping and gradient `<defs>` emission stay the caller's job.

- [ ] **Step 1: Write the failing test (append to `src/engine/renderShape.test.ts`)**

```ts
import type { LinearGradient } from './types';

it('paints fill/stroke with url(#scope) when a gradient + idScope are given', () => {
  const grad: LinearGradient = {
    type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  };
  const out = renderShapeToSvg(
    'rect',
    { width: 10, height: 10 },
    { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 2, fillGradient: grad },
    undefined,
    'obj1',
  );
  expect(out).toContain('fill="url(#savig-grad-obj1-fill)"');
  expect(out).toContain('stroke="#00ff00"'); // no strokeGradient -> solid
});

it('falls back to the solid color when a gradient is present but idScope is absent', () => {
  const grad: LinearGradient = {
    type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  };
  const out = renderShapeToSvg('rect', { width: 10, height: 10 }, { fill: '#ff0000', stroke: 'none', strokeWidth: 0, fillGradient: grad });
  expect(out).toContain('fill="#ff0000"');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/engine/renderShape.test.ts`
Expected: FAIL — `renderShapeToSvg` ignores the 5th arg; `fill` is `#ff0000` not `url(...)`.

- [ ] **Step 3: Implement in `src/engine/renderShape.ts`**

Add the import at the top:

```ts
import { paintRef } from './gradient';
```

Change `styleToSvgAttrs` to be gradient/id aware:

```ts
function styleToSvgAttrs(style: VectorStyle, idScope?: string): Record<string, string> {
  const fill =
    style.fillGradient && idScope ? paintRef(`savig-grad-${idScope}-fill`) : style.fill;
  const stroke =
    style.strokeGradient && idScope ? paintRef(`savig-grad-${idScope}-stroke`) : style.stroke;
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

Change `renderShapeToSvg`'s signature and both `styleToSvgAttrs` call sites to thread `idScope`:

```ts
export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
  path?: PathData,
  idScope?: string,
): string {
  if (shapeType === 'path') {
    if (!path || path.nodes.length === 0) return '';
    const attrs = { d: pathToD(path), ...styleToSvgAttrs(style, idScope) };
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(' ');
    return `<path ${attrStr}/>`;
  }
  const tag = shapeType === 'rect' ? 'rect' : 'ellipse';
  const attrs = { ...geometryToSvgAttrs(shapeType, geometry), ...styleToSvgAttrs(style, idScope) };
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<${tag} ${attrStr}/>`;
}
```

Note: `escapeAttr` over `url(#savig-grad-obj1-fill)` is a no-op for these safe chars, so the assertion `fill="url(#savig-grad-obj1-fill)"` holds.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/engine/renderShape.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/renderShape.ts src/engine/renderShape.test.ts
git commit -m "feat(gradient): renderShapeToSvg idScope -> url(#) paint refs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Export emits gradient defs (`renderDocument`)

**Files:**
- Modify: `src/services/export/renderDocument.ts`
- Modify: `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `gradientToSvg` (Task 1), `renderShapeToSvg(...idScope)` (Task 3).
- Produces: exported SVG `<defs>` contains a `<linearGradient>`/`<radialGradient>` (id `savig-grad-<obj.id>-fill|stroke`) for each vector object with a gradient, and the inner shape references it.

- [ ] **Step 1: Write the failing test (append to `src/services/export/renderDocument.test.ts`)**

```ts
it('emits gradient defs for a vector object and references them', () => {
  const grad = {
    type: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 0,
    stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
  };
  const project = makeProject({
    assets: [createVectorAsset('rect', { id: 'vg', style: { fill: '#000000', stroke: 'none', strokeWidth: 0, fillGradient: grad } })],
    objects: [makeObject({ id: 'o1', assetId: 'vg' })],
  });
  const svg = renderSvgDocument(project);
  expect(svg).toContain('<linearGradient id="savig-grad-o1-fill"');
  expect(svg).toContain('fill="url(#savig-grad-o1-fill)"');
});
```

(Use the file's existing project/object test factories — match the patterns already used in this test file, e.g. `makeProject`/`makeObject`/`createVectorAsset`. If the helpers have different names in this file, adapt the call to the existing ones; the assertions are what matter.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts`
Expected: FAIL — no `<linearGradient>` in output; fill is `#000000`.

- [ ] **Step 3: Implement in `src/services/export/renderDocument.ts`**

Add `gradientToSvg` to the engine import at the top. Build per-object gradient defs and fold them into the top-level `<defs>`, and pass `obj.id` as `idScope`.

In the `asset.kind === 'vector'` branch, change the `renderShapeToSvg` call to pass `obj.id`:

```ts
let shape = renderShapeToSvg(asset.shapeType, state.geometry ?? {}, asset.style, framePath, obj.id);
```

Collect gradient defs while mapping the body. Add a `gradientDefs` accumulator before the `body` map and append matching defs:

```ts
  const gradientDefs: string[] = [];
  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  const body = sampleProject(project, 0)
    .map((state) => {
      const obj = objectsById.get(state.objectId)!;
      const asset = assetsById.get(obj.assetId);
      // ... existing missing-asset guard ...
      if (asset.kind === 'vector') {
        if (asset.style.fillGradient) {
          gradientDefs.push(gradientToSvg(`savig-grad-${obj.id}-fill`, asset.style.fillGradient));
        }
        if (asset.style.strokeGradient) {
          gradientDefs.push(gradientToSvg(`savig-grad-${obj.id}-stroke`, asset.style.strokeGradient));
        }
        // ... existing framePath / transform / shape logic, with idScope=obj.id ...
      }
      // ... existing svg/use branch ...
    })
    .join('');
```

Then include `gradientDefs` in the final `<defs>`:

```ts
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}">` +
    `<defs>${defs}${gradientDefs.join('')}</defs>${body}</svg>`
  );
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(gradient): export gradient defs + reference them

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `computeFrame` — gradient overrides color track (the load-bearing guard)

**Files:**
- Modify: `src/runtime/frame.ts`
- Modify: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `VectorStyle.fillGradient`/`strokeGradient` (Task 1).
- Produces: `computeFrame` omits `item.fill` when the object's asset has `fillGradient` (and `item.stroke` when `strokeGradient`), so `applyFrameToNodes` never overwrites a `url(#…)` paint ref with a per-frame hex.

- [ ] **Step 1: Write the failing test (append to `src/runtime/frame.test.ts`)**

```ts
it('omits fill in the frame when the object has a fill gradient, even with a fill color track', () => {
  const grad = {
    type: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 0,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  };
  // Build a project: one rect vector object with a fillGradient AND a fill colorTrack.
  const project = makeProject({
    assets: [createVectorAsset('rect', { id: 'vg', style: { fill: '#abcdef', stroke: 'none', strokeWidth: 0, fillGradient: grad } })],
    objects: [makeObject({
      id: 'o1', assetId: 'vg',
      colorTracks: { fill: [{ time: 0, value: '#abcdef', easing: 'linear' }, { time: 1, value: '#123456', easing: 'linear' }] },
    })],
  });
  const items = computeFrame(project, 0.5);
  expect(items[0].fill).toBeUndefined();
});
```

(Use this test file's existing factories for project/object/asset, matching how other `frame.test.ts` cases build a project.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: FAIL — `item.fill` is the sampled hex (e.g. a mid color), not `undefined`.

- [ ] **Step 3: Implement in `src/runtime/frame.ts`**

In `computeFrame`, the `asset` is already looked up. Replace the fill/stroke assignment block:

```ts
    const hasFillGradient = asset?.kind === 'vector' && !!asset.style.fillGradient;
    const hasStrokeGradient = asset?.kind === 'vector' && !!asset.style.strokeGradient;
    if (state.fill !== undefined && !hasFillGradient) item.fill = state.fill;
    if (state.stroke !== undefined && !hasStrokeGradient) item.stroke = state.stroke;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/runtime/frame.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts
git commit -m "feat(gradient): computeFrame omits fill/stroke when a gradient wins

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Full engine gate

- [ ] **Step 1: Run the whole suite + typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build`
Expected: all green. (No runtime bundle regen needed — gradients are static; if the project has a `build:runtime` step, it is intentionally NOT run here.)

- [ ] **Step 2: Commit (only if any incidental fixups were needed)**

```bash
git add -A && git commit -m "chore(gradient): engine gate green" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §4 data model → Task 1. ✓
- §5 `engine/gradient.ts` (`paintRef`/`gradientToSvg`) → Task 1; helpers (`defaultGradient`/angle) → Task 2. ✓
- §6.1 `renderShapeToSvg` idScope → Task 3. ✓
- §6.2 export defs → Task 4. ✓
- §6.4 computeFrame guard → Task 5. ✓
- §9 no migration → Global Constraints (no version bump). ✓
- §10 security (escapeAttr, clamping) → Task 1 tests. ✓
- §6.3 Stage render, §7 Inspector exclusivity, §8 UI, §11 e2e → **Plan B (UI)**, by design.

**Placeholder scan:** No TBD/TODO; every code step has complete code. The only "adapt to existing factory names" notes (Tasks 4 & 5) are because those test files' local helpers must be reused, not invented — assertions are concrete.

**Type consistency:** `Gradient`/`LinearGradient`/`RadialGradient`/`GradientStop` defined in Task 1 and used identically in Tasks 2–5. `renderShapeToSvg(..., idScope?)` defined in Task 3, consumed in Task 4. `paintRef`/`gradientToSvg` names consistent across tasks. Id scheme `savig-grad-<id>-fill|stroke` consistent (Tasks 3, 4). ✓
