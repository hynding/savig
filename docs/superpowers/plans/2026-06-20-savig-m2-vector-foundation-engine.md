# M2 Slice 1 — Plan A: Engine & Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable vector shapes (rect/ellipse) to the engine and export pipeline — a new `VectorAsset` kind, animatable geometry tracks, fractional-anchor resolution, a shared `renderShapeToSvg`, and runtime + export support — with preview==export parity, **no UI** (the UI is Plan B).

**Architecture:** Geometry is resolved per-frame as plain scalars reusing the existing `interpolate()` (no new tween math). A new pure `renderShape` engine module turns resolved geometry+style into SVG markup and is shared by the export document and the standalone runtime, exactly as `buildTransform` already is. Anchors for vector objects are stored as fractions and resolved to absolute coordinates against the per-frame geometry so the rotate/scale pivot stays stable while a shape's size animates.

**Tech Stack:** TypeScript (strict) · Vitest · esbuild (runtime bundling) · pnpm. Pure framework-agnostic engine (`src/engine/`), runtime (`src/runtime/`), and services (`src/services/`). No React/DOM in the engine.

## Global Constraints

- **Engine purity:** code under `src/engine/` has **zero React/DOM dependencies** — pure TypeScript only (the runtime bundles it verbatim).
- **Preview == export:** any "sampled state → SVG" mapping has **one** definition shared by the export document, the runtime, and (later) the Stage. Never duplicate the mapping.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. One logical change per commit.
- **Determinism:** all numeric SVG output goes through the existing `fmt()` helper (rounds to 1e-4, normalizes `-0`/non-finite).
- **TypeScript strict** — `pnpm typecheck` must stay clean. `pnpm lint` must stay clean.
- **Test/typecheck/lint commands:** `pnpm test` (all), `pnpm vitest run <path>` (one file), `pnpm typecheck`, `pnpm lint`.
- **Commit convention:** Conventional Commits (`feat(engine): …`, `feat(runtime): …`, `feat(services): …`, `test: …`). End every commit message with the footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Backward compatibility:** existing M1 projects (no vector assets) must load and render unchanged.
- **Branch:** this is feature work on `main` — create a branch (e.g. `m2-vector-engine`) before Task 1 if one does not already exist.

---

### Task 1: Vector types & factories

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/project.ts`
- Test: `src/engine/project.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type GeometryProperty = 'width' | 'height' | 'cornerRadius' | 'radiusX' | 'radiusY'`
  - `type AnimatableProperty` broadened to include `GeometryProperty`
  - `type ResolvedGeometry = Partial<Record<GeometryProperty, number>>`
  - `type VectorShapeType = 'rect' | 'ellipse'`
  - `interface VectorStyle { fill: string; stroke: string; strokeWidth: number }`
  - `interface VectorAsset { id: string; kind: 'vector'; name: string; shapeType: VectorShapeType; style: VectorStyle }`
  - `type Asset = SvgAsset | AudioAsset | VectorAsset`
  - `type AnchorMode = 'absolute' | 'fraction'`
  - `SceneObject` gains `shapeBase?: ResolvedGeometry` and `anchorMode?: AnchorMode`
  - `const GEOMETRY_PROPERTIES: readonly GeometryProperty[]`
  - `const DEFAULT_VECTOR_STYLE: VectorStyle`
  - `function createVectorAsset(shapeType: VectorShapeType, overrides?: Partial<VectorAsset>): VectorAsset`

> Note: `'none'` for fill/stroke is represented as the string value `'none'` (the type stays `string`).

- [ ] **Step 1: Write the failing test**

Add to `src/engine/project.test.ts`:

> This file imports `{ describe, expect, test }` from vitest — use `test(` (not `it(`) to match.

```ts
import { createVectorAsset, DEFAULT_VECTOR_STYLE } from './project';

describe('createVectorAsset', () => {
  test('creates a rect vector asset with defaults and a uuid id', () => {
    const asset = createVectorAsset('rect');
    expect(asset.kind).toBe('vector');
    expect(asset.shapeType).toBe('rect');
    expect(asset.name).toBe('Rectangle');
    expect(asset.style).toEqual(DEFAULT_VECTOR_STYLE);
    expect(asset.id).toMatch(/[0-9a-f-]{36}/);
  });

  test('names an ellipse and accepts overrides', () => {
    const asset = createVectorAsset('ellipse', { id: 'fixed', style: { fill: '#f00', stroke: 'none', strokeWidth: 0 } });
    expect(asset.name).toBe('Ellipse');
    expect(asset.id).toBe('fixed');
    expect(asset.style.fill).toBe('#f00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/project.test.ts`
Expected: FAIL — `createVectorAsset`/`DEFAULT_VECTOR_STYLE` not exported.

- [ ] **Step 3: Add types to `src/engine/types.ts`**

Replace the existing `AnimatableProperty` declaration with:

```ts
export type GeometryProperty =
  | 'width'
  | 'height'
  | 'cornerRadius'
  | 'radiusX'
  | 'radiusY';

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | GeometryProperty;

export type ResolvedGeometry = Partial<Record<GeometryProperty, number>>;
```

Add the vector asset types (after the existing `SvgAsset`/`AudioAsset` block, before `export type Asset`):

```ts
export type VectorShapeType = 'rect' | 'ellipse';

export interface VectorStyle {
  /** CSS color, or the literal 'none'. */
  fill: string;
  /** CSS color, or the literal 'none'. */
  stroke: string;
  strokeWidth: number;
}

export interface VectorAsset {
  id: string; // uuid — mutable content, NOT a content hash
  kind: 'vector';
  name: string;
  shapeType: VectorShapeType;
  style: VectorStyle;
}
```

Change the `Asset` union to:

```ts
export type Asset = SvgAsset | AudioAsset | VectorAsset;
```

Add `AnchorMode` and extend `SceneObject` (add the two optional fields and the doc comment):

```ts
export type AnchorMode = 'absolute' | 'fraction';
```

In `interface SceneObject`, after `tracks: Partial<Record<AnimatableProperty, Keyframe[]>>;` add:

```ts
  /** Static geometry values for vector objects when a geometry property has no keyframes. */
  shapeBase?: ResolvedGeometry;
  /**
   * How anchorX/anchorY are interpreted. 'absolute' (default) = user units, as for
   * imported SVGs. 'fraction' = 0..1 of the shape bbox, resolved per-frame so the
   * pivot stays centered while geometry animates. Vector objects use 'fraction'.
   */
  anchorMode?: AnchorMode;
```

- [ ] **Step 4: Add factories/constants to `src/engine/project.ts`**

Update the import to include the new types:

```ts
import type {
  AnimatableProperty,
  GeometryProperty,
  Keyframe,
  Project,
  ProjectMeta,
  SceneObject,
  Transform2D,
  VectorAsset,
  VectorShapeType,
  VectorStyle,
} from './types';
```

Retype `ANIMATABLE_PROPERTIES` so it stays the transform set (its entries must index `Transform2D`):

```ts
export const ANIMATABLE_PROPERTIES: readonly (keyof Transform2D)[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
] as const;
```

Add, after `DEFAULT_TRANSFORM`:

```ts
export const GEOMETRY_PROPERTIES: readonly GeometryProperty[] = [
  'width',
  'height',
  'cornerRadius',
  'radiusX',
  'radiusY',
] as const;

export const DEFAULT_VECTOR_STYLE: VectorStyle = {
  fill: '#cccccc',
  stroke: 'none',
  strokeWidth: 0,
};

export function createVectorAsset(
  shapeType: VectorShapeType,
  overrides: Partial<VectorAsset> = {},
): VectorAsset {
  return {
    id: newId(),
    kind: 'vector',
    name: shapeType === 'rect' ? 'Rectangle' : 'Ellipse',
    shapeType,
    style: { ...DEFAULT_VECTOR_STYLE },
    ...overrides,
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/engine/project.test.ts && pnpm typecheck`
Expected: PASS, clean typecheck. (The `Asset` union now has a third member; no exhaustive switch exists that breaks — verified.)

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/project.ts src/engine/project.test.ts
git commit -m "feat(engine): add VectorAsset, geometry properties, and factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Geometry sampling + anchor resolution

**Files:**
- Modify: `src/engine/sample.ts`
- Test: `src/engine/sample.test.ts`

**Interfaces:**
- Consumes: `GEOMETRY_PROPERTIES`, `ANIMATABLE_PROPERTIES` (Task 1 / existing); `interpolate`.
- Produces:
  - `interface RenderState` gains `geometry?: ResolvedGeometry`
  - `function resolveAnchor(obj: SceneObject, state: RenderState, shapeType?: VectorShapeType): { anchorX: number; anchorY: number }`

- [ ] **Step 1: Write the failing test**

Add to `src/engine/sample.test.ts` (and ensure `createVectorAsset` is not needed here — these test the object directly):

> This file imports `{ describe, expect, test }` from vitest — use `test(` (not `it(`) to match.

```ts
import { resolveAnchor } from './sample';

describe('sampleObject geometry', () => {
  test('resolves static geometry from shapeBase when there is no track', () => {
    const obj = createSceneObject('a', { shapeBase: { width: 40, height: 20 } });
    expect(sampleObject(obj, 1).geometry).toEqual({ width: 40, height: 20 });
  });

  test('interpolates geometry tracks like any scalar', () => {
    const obj = createSceneObject('a', { shapeBase: { width: 0 } });
    obj.tracks.width = [createKeyframe(0, 0), createKeyframe(2, 100)];
    expect(sampleObject(obj, 1).geometry).toEqual({ width: 50 });
  });

  test('omits geometry entirely for objects without any', () => {
    expect(sampleObject(createSceneObject('a'), 0).geometry).toBeUndefined();
  });
});

describe('resolveAnchor', () => {
  test('returns the absolute anchor by default', () => {
    const obj = createSceneObject('a', { anchorX: 7, anchorY: 9 });
    expect(resolveAnchor(obj, sampleObject(obj, 0))).toEqual({ anchorX: 7, anchorY: 9 });
  });

  test('resolves a fractional anchor against resolved rect geometry', () => {
    const obj = createSceneObject('a', {
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 100, height: 40 },
    });
    expect(resolveAnchor(obj, sampleObject(obj, 0), 'rect')).toEqual({ anchorX: 50, anchorY: 20 });
  });

  test('resolves a fractional anchor against ellipse bbox (2 * radius)', () => {
    const obj = createSceneObject('a', {
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { radiusX: 30, radiusY: 10 },
    });
    expect(resolveAnchor(obj, sampleObject(obj, 0), 'ellipse')).toEqual({ anchorX: 30, anchorY: 10 });
  });
});
```

(`createSceneObject`, `createKeyframe`, `sampleObject` are already imported in this file; add the `resolveAnchor` import shown above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/sample.test.ts`
Expected: FAIL — `resolveAnchor` not exported; `state.geometry` undefined for shapeBase case.

- [ ] **Step 3: Implement in `src/engine/sample.ts`**

Replace the whole file with:

```ts
import { interpolate } from './interpolate';
import { ANIMATABLE_PROPERTIES, GEOMETRY_PROPERTIES } from './project';
import type {
  AnimatableProperty,
  Project,
  ResolvedGeometry,
  SceneObject,
  Transform2D,
  VectorShapeType,
} from './types';

export interface RenderState extends Transform2D {
  objectId: string;
  /** Present only for vector objects that have geometry. */
  geometry?: ResolvedGeometry;
}

export function sampleObject(obj: SceneObject, time: number): RenderState {
  const resolve = (prop: AnimatableProperty, fallback: number): number => {
    const track = obj.tracks[prop];
    if (track && track.length > 0) {
      return interpolate(track, time, prop === 'rotation');
    }
    return fallback;
  };

  const state = { objectId: obj.id } as RenderState;
  for (const prop of ANIMATABLE_PROPERTIES) {
    state[prop] = resolve(prop, obj.base[prop]);
  }

  const geometry: ResolvedGeometry = {};
  for (const prop of GEOMETRY_PROPERTIES) {
    const hasTrack = (obj.tracks[prop]?.length ?? 0) > 0;
    const baseValue = obj.shapeBase?.[prop];
    if (hasTrack || baseValue !== undefined) {
      geometry[prop] = resolve(prop, baseValue ?? 0);
    }
  }
  if (Object.keys(geometry).length > 0) {
    state.geometry = geometry;
  }
  return state;
}

// Resolves the absolute rotate/scale pivot. Vector objects store the anchor as a
// fraction of the bbox and resolve it against the per-frame geometry so the pivot
// stays centered as the shape's size animates; imported SVGs keep absolute anchors.
export function resolveAnchor(
  obj: SceneObject,
  state: RenderState,
  shapeType?: VectorShapeType,
): { anchorX: number; anchorY: number } {
  if (obj.anchorMode !== 'fraction') {
    return { anchorX: obj.anchorX, anchorY: obj.anchorY };
  }
  const g = state.geometry ?? {};
  const width = shapeType === 'ellipse' ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
  const height = shapeType === 'ellipse' ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
  return { anchorX: obj.anchorX * width, anchorY: obj.anchorY * height };
}

export function sampleProject(project: Project, time: number): RenderState[] {
  return project.objects
    .map((obj, index) => ({ obj, index }))
    .sort((p, q) => p.obj.zOrder - q.obj.zOrder || p.index - q.index)
    .map(({ obj }) => sampleObject(obj, time));
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run src/engine/sample.test.ts && pnpm typecheck`
Expected: PASS, clean. (Existing `sampleObject`/`sampleProject` tests still pass — transform behavior is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/sample.ts src/engine/sample.test.ts
git commit -m "feat(engine): sample geometry tracks and resolve fractional anchors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Shared shape renderer (`renderShapeToSvg`)

**Files:**
- Create: `src/engine/renderShape.ts`
- Create: `src/engine/renderShape.test.ts`
- Modify: `src/engine/index.ts` (barrel export)

**Interfaces:**
- Consumes: `fmt` (from `./transform`); `ResolvedGeometry`, `VectorShapeType`, `VectorStyle`.
- Produces:
  - `function geometryToSvgAttrs(shapeType: VectorShapeType, geometry: ResolvedGeometry): Record<string, string>`
  - `function renderShapeToSvg(shapeType: VectorShapeType, geometry: ResolvedGeometry, style: VectorStyle): string`

- [ ] **Step 1: Write the failing test**

Create `src/engine/renderShape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { geometryToSvgAttrs, renderShapeToSvg } from './renderShape';

describe('geometryToSvgAttrs', () => {
  it('maps rect width/height with x/y pinned at 0', () => {
    expect(geometryToSvgAttrs('rect', { width: 120, height: 80 })).toEqual({
      x: '0', y: '0', width: '120', height: '80',
    });
  });

  it('maps rect cornerRadius to rx/ry', () => {
    expect(geometryToSvgAttrs('rect', { width: 10, height: 10, cornerRadius: 4 })).toEqual({
      x: '0', y: '0', width: '10', height: '10', rx: '4', ry: '4',
    });
  });

  it('maps ellipse radii to cx/cy/rx/ry so it sits in the local box', () => {
    expect(geometryToSvgAttrs('ellipse', { radiusX: 30, radiusY: 20 })).toEqual({
      cx: '30', cy: '20', rx: '30', ry: '20',
    });
  });

  it('clamps negative dimensions to 0', () => {
    expect(geometryToSvgAttrs('rect', { width: -5, height: 10 }).width).toBe('0');
  });
});

describe('renderShapeToSvg', () => {
  it('renders a styled rect deterministically (geometry then style)', () => {
    expect(
      renderShapeToSvg('rect', { width: 100, height: 50 }, { fill: '#f00', stroke: 'none', strokeWidth: 0 }),
    ).toBe('<rect x="0" y="0" width="100" height="50" fill="#f00" stroke="none" stroke-width="0"/>');
  });

  it('renders an ellipse', () => {
    expect(
      renderShapeToSvg('ellipse', { radiusX: 30, radiusY: 20 }, { fill: 'none', stroke: '#000', strokeWidth: 2 }),
    ).toBe('<ellipse cx="30" cy="20" rx="30" ry="20" fill="none" stroke="#000" stroke-width="2"/>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/renderShape.test.ts`
Expected: FAIL — module `./renderShape` does not exist.

- [ ] **Step 3: Implement `src/engine/renderShape.ts`**

```ts
import { fmt } from './transform';
import type { ResolvedGeometry, VectorShapeType, VectorStyle } from './types';

// Resolved geometry -> SVG attributes. The SINGLE definition shared by
// renderShapeToSvg (initial/static markup) and the per-frame runtime update,
// so animated geometry previews == exports. All numbers go through fmt().
export function geometryToSvgAttrs(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
): Record<string, string> {
  if (shapeType === 'rect') {
    const attrs: Record<string, string> = {
      x: '0',
      y: '0',
      width: fmt(Math.max(0, geometry.width ?? 0)),
      height: fmt(Math.max(0, geometry.height ?? 0)),
    };
    if (geometry.cornerRadius !== undefined) {
      const r = fmt(Math.max(0, geometry.cornerRadius));
      attrs.rx = r;
      attrs.ry = r;
    }
    return attrs;
  }
  const rx = Math.max(0, geometry.radiusX ?? 0);
  const ry = Math.max(0, geometry.radiusY ?? 0);
  return { cx: fmt(rx), cy: fmt(ry), rx: fmt(rx), ry: fmt(ry) };
}

function styleToSvgAttrs(style: VectorStyle): Record<string, string> {
  return {
    fill: style.fill,
    stroke: style.stroke,
    'stroke-width': fmt(style.strokeWidth),
  };
}

export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
): string {
  const tag = shapeType === 'rect' ? 'rect' : 'ellipse';
  const attrs = { ...geometryToSvgAttrs(shapeType, geometry), ...styleToSvgAttrs(style) };
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return `<${tag} ${attrStr}/>`;
}
```

- [ ] **Step 4: Add the barrel export**

In `src/engine/index.ts`, add after `export * from './transform';`:

```ts
export * from './renderShape';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/engine/renderShape.test.ts && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/engine/renderShape.ts src/engine/renderShape.test.ts src/engine/index.ts
git commit -m "feat(engine): add shared renderShapeToSvg + geometryToSvgAttrs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `computeFrame` geometry + parity test

**Files:**
- Modify: `src/runtime/frame.ts`
- Test: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `buildTransform`, `fmt`, `sampleProject`, `resolveAnchor`, `geometryToSvgAttrs` (engine barrel).
- Produces:
  - `interface FrameItem` gains `geometry?: Record<string, string>`
  - `computeFrame` resolves vector geometry attrs + fractional anchor.

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/frame.test.ts` (extend the imports to include `createVectorAsset`, `geometryToSvgAttrs`, `resolveAnchor`):

```ts
import { createVectorAsset, geometryToSvgAttrs, resolveAnchor } from '../engine';

function animatedVector(): Project {
  const project = createProject();
  project.assets.push(createVectorAsset('rect', { id: 'vrect1' }));
  const obj = createSceneObject('vrect1', {
    id: 'v1',
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    shapeBase: { width: 100, height: 50 },
  });
  obj.tracks.width = [createKeyframe(0, 100), createKeyframe(1, 200)];
  project.objects.push(obj);
  return project;
}

describe('computeFrame parity for vector geometry', () => {
  it('matches engine geometry attrs + resolved fractional anchor at multiple times', () => {
    const project = animatedVector();
    const obj = project.objects[0];
    for (const t of [0, 0.5, 1]) {
      const [state] = sampleProject(project, t);
      const { anchorX, anchorY } = resolveAnchor(obj, state, 'rect');
      const expected = [
        {
          objectId: 'v1',
          transform: buildTransform(state, anchorX, anchorY),
          opacity: fmt(state.opacity),
          geometry: geometryToSvgAttrs('rect', state.geometry!),
        },
      ];
      expect(computeFrame(project, t)).toEqual(expected);
    }
  });

  it('emits no geometry for imported SVG objects', () => {
    const project = animated(); // existing helper: an svg-backed object
    expect(computeFrame(project, 0)[0].geometry).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: FAIL — `computeFrame` output lacks `geometry`; anchor for the fractional object is wrong.

- [ ] **Step 3: Implement `src/runtime/frame.ts`**

Replace the whole file with:

```ts
import {
  buildTransform,
  fmt,
  geometryToSvgAttrs,
  resolveAnchor,
  sampleProject,
} from '../engine';
import type { Project } from '../engine';

export interface FrameItem {
  objectId: string;
  transform: string;
  opacity: string;
  /** Present only for vector objects: SVG attribute name -> value for the inner shape. */
  geometry?: Record<string, string>;
}

// Single definition of "sampled state -> SVG attributes", shared by the editor
// Stage and the export runtime. The parity test locks these consumers to identical
// output, guaranteeing preview == export — now including animated geometry.
export function computeFrame(project: Project, time: number): FrameItem[] {
  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));
  return sampleProject(project, time).map((state) => {
    const obj = objectsById.get(state.objectId)!;
    const asset = assetsById.get(obj.assetId);
    const shapeType = asset && asset.kind === 'vector' ? asset.shapeType : undefined;
    const { anchorX, anchorY } = resolveAnchor(obj, state, shapeType);
    const item: FrameItem = {
      objectId: state.objectId,
      transform: buildTransform(state, anchorX, anchorY),
      opacity: fmt(state.opacity),
    };
    if (shapeType && state.geometry) {
      item.geometry = geometryToSvgAttrs(shapeType, state.geometry);
    }
    return item;
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run src/runtime/frame.test.ts && pnpm typecheck`
Expected: PASS. The existing SVG parity test still passes (anchorMode is undefined → absolute anchor → identical transform).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts
git commit -m "feat(runtime): compute vector geometry attrs in frame with anchor parity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Runtime applies geometry to inner shape + regenerate bundle

**Files:**
- Modify: `src/runtime/index.ts`
- Create: `src/runtime/index.test.ts`
- Regenerate: `src/runtime/runtimeSource.generated.ts` (via `pnpm build:runtime`)

**Interfaces:**
- Consumes: `FrameItem` (Task 4).
- Produces: `function applyFrameToNodes(nodes: Map<string, Element>, items: FrameItem[]): void` (exported for testing; used by the player loop).

- [ ] **Step 1: Write the failing test**

Create `src/runtime/index.test.ts` (runs in the jsdom environment, like other UI/DOM tests):

```ts
import { describe, expect, it } from 'vitest';
import { applyFrameToNodes } from './index';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('applyFrameToNodes', () => {
  it('applies transform/opacity to the wrapper and geometry to the inner shape', () => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-savig-object', 'v1');
    const rect = document.createElementNS(SVG_NS, 'rect');
    g.appendChild(rect);
    const nodes = new Map<string, Element>([['v1', g]]);

    applyFrameToNodes(nodes, [
      {
        objectId: 'v1',
        transform: 'translate(1, 2)',
        opacity: '0.5',
        geometry: { x: '0', y: '0', width: '120', height: '80' },
      },
    ]);

    expect(g.getAttribute('transform')).toBe('translate(1, 2)');
    expect(g.getAttribute('opacity')).toBe('0.5');
    expect(rect.getAttribute('width')).toBe('120');
    expect(rect.getAttribute('height')).toBe('80');
  });

  it('leaves nodes without geometry untouched on the inner element', () => {
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('data-savig-object', 'o1');
    const nodes = new Map<string, Element>([['o1', use]]);
    applyFrameToNodes(nodes, [{ objectId: 'o1', transform: 't', opacity: '1' }]);
    expect(use.getAttribute('transform')).toBe('t');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/index.test.ts`
Expected: FAIL — `applyFrameToNodes` not exported.

- [ ] **Step 3: Refactor `src/runtime/index.ts` to extract + export `applyFrameToNodes`**

Add the import of `FrameItem` at the top (alongside the existing imports):

```ts
import { computeFrame, type FrameItem } from './frame';
```

(Replace the existing `import { computeFrame } from './frame';` line.)

Add this exported function near the top of the module (after the imports, before `create`):

```ts
// Applies a computed frame to the live SVG nodes. Wrapper nodes
// (`[data-savig-object]`) take transform/opacity; vector objects also update the
// inner shape element (the wrapper's only child) with the geometry attributes.
export function applyFrameToNodes(nodes: Map<string, Element>, items: FrameItem[]): void {
  for (const item of items) {
    const node = nodes.get(item.objectId);
    if (!node) continue;
    node.setAttribute('transform', item.transform);
    node.setAttribute('opacity', item.opacity);
    if (item.geometry) {
      const shape = node.firstElementChild;
      if (shape) {
        for (const [attr, value] of Object.entries(item.geometry)) {
          shape.setAttribute(attr, value);
        }
      }
    }
  }
}
```

Replace the inline `apply` closure inside `create` with a call to the shared function:

```ts
  const apply = (time: number): void => {
    applyFrameToNodes(nodes, computeFrame(project, time));
  };
```

- [ ] **Step 4: Run the test + typecheck**

Run: `pnpm vitest run src/runtime/index.test.ts && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Regenerate the committed runtime bundle**

Run: `pnpm build:runtime`
Then confirm the generated source now contains the geometry application:

Run: `grep -c "firstElementChild" src/runtime/runtimeSource.generated.ts`
Expected: `1` (or greater) — the regenerated bundle includes the new logic.

- [ ] **Step 6: Run the full suite (catch any bundle consumers)**

Run: `pnpm test`
Expected: PASS (existing export/buildBundle tests still pass — the generated string changed but they assert structure, not the exact bytes of the runtime).

> If a test asserts the exact runtime bytes and now fails, that is expected churn from regeneration — update that test's expectation to the regenerated value, not the logic.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/index.ts src/runtime/index.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "feat(runtime): apply animated geometry to inner shape nodes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Export inline vector shapes

**Files:**
- Modify: `src/services/export/renderDocument.ts`
- Test: `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `buildTransform`, `fmt`, `sampleProject`, `resolveAnchor`, `renderShapeToSvg` (engine barrel); `MissingAssetError`.
- Produces: `renderSvgDocument` emits `<defs>` for SVG assets only, inline `<g data-savig-object><shape/></g>` for vector objects, and unchanged `<use>` for SVG objects.

- [ ] **Step 1: Write the failing test**

Add to `src/services/export/renderDocument.test.ts` (extend imports with `createVectorAsset`):

```ts
import { createVectorAsset } from '../../engine';

describe('renderSvgDocument with vector shapes', () => {
  it('inlines a vector object as <g><rect/></g> with no def, preserving z-order', () => {
    const project = createProject();
    project.assets.push(createVectorAsset('rect', { id: 'vr', style: { fill: '#f00', stroke: 'none', strokeWidth: 0 } }));
    const obj = createSceneObject('vr', {
      id: 'o1', anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 100, height: 50 },
      base: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    project.objects.push(obj);

    const out = renderSvgDocument(project);
    expect(out).toContain('<defs></defs>');
    expect(out).toContain('<g data-savig-object="o1"');
    expect(out).toContain('<rect x="0" y="0" width="100" height="50" fill="#f00" stroke="none" stroke-width="0"/>');
    expect(out).not.toContain('<use');
  });
});
```

(Existing tests in this file already cover the SVG `<use>` path and the missing-asset throw; they must still pass.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts`
Expected: FAIL — current code throws `MissingAssetError` for the non-svg asset in `defs`.

- [ ] **Step 3: Implement `src/services/export/renderDocument.ts`**

Replace the imports and the `renderSvgDocument` function (keep `defineSymbol` and `innerMarkup` unchanged below them):

```ts
import {
  buildTransform,
  fmt,
  renderShapeToSvg,
  resolveAnchor,
  sampleProject,
} from '../../engine';
import type { Project, SvgAsset } from '../../engine';
import { MissingAssetError } from '../errors';
import { sanitizeSvgElement } from '../import/sanitizeSvg';

// SVG assets are defined once in <defs> and instanced via <use>. Vector shapes
// are inlined per object (their geometry animates per-frame, so a static def
// cannot capture them); the runtime updates the inner shape's attributes.
export function renderSvgDocument(project: Project): string {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));

  const usedSvgIds = Array.from(
    new Set(
      project.objects
        .map((o) => o.assetId)
        .filter((id) => assetsById.get(id)?.kind === 'svg'),
    ),
  ).sort();
  const defs = usedSvgIds
    .map((assetId) => defineSymbol(assetsById.get(assetId) as SvgAsset))
    .join('');

  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  const body = sampleProject(project, 0)
    .map((state) => {
      const obj = objectsById.get(state.objectId)!;
      const asset = assetsById.get(obj.assetId);
      if (!asset) {
        throw new MissingAssetError(`Missing asset "${obj.assetId}" referenced by object "${obj.id}".`);
      }
      if (asset.kind === 'vector') {
        const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType);
        const transform = buildTransform(state, anchorX, anchorY);
        const shape = renderShapeToSvg(asset.shapeType, state.geometry ?? {}, asset.style);
        return `<g data-savig-object="${obj.id}" transform="${transform}" opacity="${fmt(state.opacity)}">${shape}</g>`;
      }
      if (asset.kind !== 'svg') {
        throw new MissingAssetError(`Object "${obj.id}" references non-visual asset "${obj.assetId}".`);
      }
      const { anchorX, anchorY } = resolveAnchor(obj, state);
      const transform = buildTransform(state, anchorX, anchorY);
      return `<use data-savig-object="${obj.id}" href="#savig-asset-${obj.assetId}" transform="${transform}" opacity="${fmt(state.opacity)}"/>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}">` +
    `<defs>${defs}</defs>${body}</svg>`
  );
}
```

> The SVG `<use>` branch is byte-identical to the previous implementation (`resolveAnchor` returns the absolute anchor when `anchorMode` is undefined), so existing golden assertions hold.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts && pnpm typecheck`
Expected: PASS — new vector test green; all existing SVG/missing-asset tests green.

- [ ] **Step 5: Run the full export suite**

Run: `pnpm vitest run src/services/export`
Expected: PASS (`buildBundle`, `exportProject`, `zipBundle` unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(services): export inline vector shapes alongside <use> svg

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Persistence version bump + migration

**Files:**
- Modify: `src/services/persistence/migrate.ts`
- Modify: `src/engine/project.ts` (version literal)
- Test: `src/services/persistence/migrate.test.ts`
- Test: `src/engine/project.test.ts` (version assertion)

**Interfaces:**
- Consumes: `migrateProject`, `CURRENT_VERSION` (existing).
- Produces: `CURRENT_VERSION = 2`; `migrations[1]` upgrades v1 → v2; new projects are created at version 2.

> Do the version literal bump (engine) and `CURRENT_VERSION` bump (services) in **this single task** so no intermediate commit leaves `createProject()` producing a version that `migrateProject` rejects.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/persistence/migrate.test.ts`:

```ts
import { createProject } from '../../engine';

describe('v1 -> v2 migration', () => {
  it('upgrades a v1 project to the current version unchanged except version', () => {
    const v1 = createProject();
    v1.meta.version = 1; // simulate an M1-era file
    const migrated = migrateProject(v1);
    expect(migrated.meta.version).toBe(CURRENT_VERSION);
    expect(CURRENT_VERSION).toBe(2);
    expect(migrated.objects).toEqual(v1.objects);
    expect(migrated.assets).toEqual(v1.assets);
  });
});
```

Update the existing version assertion in `src/engine/project.test.ts`:

```ts
    expect(project.meta.version).toBe(2);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/services/persistence/migrate.test.ts src/engine/project.test.ts`
Expected: FAIL — `CURRENT_VERSION` is 1; `createProject` still stamps version 1.

- [ ] **Step 3: Bump the engine version literal**

In `src/engine/project.ts`, change the `meta` default in `createProject`:

```ts
    version: 2,
```

- [ ] **Step 4: Bump `CURRENT_VERSION` and register the migration**

In `src/services/persistence/migrate.ts`:

```ts
export const CURRENT_VERSION = 2;

// Keyed by the version being upgraded FROM. v1 -> v2 introduced vector assets and
// geometry tracks; old files have neither, so the upgrade only stamps the version.
export const migrations: Record<number, (doc: Project) => Project> = {
  1: (doc) => ({ ...doc, meta: { ...doc.meta, version: 2 } }),
};
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/services/persistence/migrate.test.ts src/engine/project.test.ts && pnpm typecheck`
Expected: PASS. (`migrate.test.ts`'s existing test — `createProject()` then `migrateProject` equals `CURRENT_VERSION` — still passes: a v2 project needs no migration.)

- [ ] **Step 6: Full suite + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/services/persistence/migrate.ts src/services/persistence/migrate.test.ts src/engine/project.ts src/engine/project.test.ts
git commit -m "feat(services): bump project version to 2 with v1->v2 migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Definition of done (Plan A)

- `pnpm test`, `pnpm typecheck`, `pnpm lint` all clean.
- A project containing a vector object with an animated geometry track:
  - samples geometry per-frame (`sampleObject`),
  - resolves a stable centered pivot via fractional anchor (`resolveAnchor`),
  - renders identical geometry attributes in `computeFrame` and `renderShapeToSvg` (parity test),
  - exports an inline `<g><rect/></g>` and animates correctly via the regenerated runtime bundle.
- M1-era (v1) projects load and render unchanged (migration test).
- **No UI** was added — drawing tools, handles, and the Inspector are Plan B.

## Self-review notes (spec coverage)

- Spec §2 data model (VectorAsset, VectorStyle, geometry on object, anchorMode) → Task 1.
- Spec §3.1 fractional anchor → Task 2 (`resolveAnchor`) + Task 4/6 consumers.
- Spec §3.2 geometry sampling (reuses `interpolate`) → Task 2.
- Spec §3.3 `renderShapeToSvg` shared fn → Task 3.
- Spec §4 rendering/export (inline vector, defs only for svg, runtime `applyGeometry`, parity) → Tasks 4, 5, 6.
- Spec §6 persistence migration → Task 7.
- Spec §9 testing: engine output/sampling/anchor (Tasks 1–3), runtime↔engine parity (Task 4), runtime application (Task 5), migration (Task 7). The Playwright export-parity e2e is in **Plan B** (it needs the UI to draw + keyframe).
- Spec §5 UI is intentionally **out of scope** for Plan A (Plan B).
