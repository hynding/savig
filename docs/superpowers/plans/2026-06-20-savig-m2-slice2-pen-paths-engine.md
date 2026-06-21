# M2 Slice 2 — Pen/Bezier Paths: Engine & Pipeline (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static bezier `path` shape type end-to-end through the pure engine and the export/runtime pipeline (no UI), so a path `VectorAsset` renders and exports byte-identically with the editor, with backward-compatible persistence.

**Architecture:** A new pure engine module serializes `PathData` (anchors + bezier control handles) to an SVG `d` string (`pathToD`) and computes its bbox (`pathBounds`). `renderShapeToSvg` gains a `path` branch; `resolveAnchor` gains a `path` case (and its `shapeType` becomes required — closing a Slice-1 footgun). Path shape is **static**: it produces no per-frame geometry, so the export emits the `<path d>` once and the runtime only animates the wrapping `<g transform>`. Persistence bumps v2→v3 with a no-op upgrader.

**Tech Stack:** TypeScript (strict), Vitest. Engine layer is pure — zero React/DOM imports.

## Global Constraints

- Engine layer (`src/engine/**`) MUST remain pure TypeScript — no React/DOM imports.
- All numeric SVG output MUST go through `fmt()` (from `src/engine/transform.ts`) so editor and export are byte-identical.
- TDD: write the failing test first, watch it fail, then implement. Commit per task.
- `VectorAsset.id` is a uuid (mutable content), never a content hash.
- Preview == export parity is the defining guarantee: a single shared function (`pathToD`) is the only definition of path markup.
- Run the full test suite with `pnpm test` (Vitest). Type-check with `pnpm typecheck`. Lint with `pnpm lint`.

---

### Task 1: Path data model + style fields + factory name

**Files:**
- Modify: `src/engine/types.ts` (add `'path'` to `VectorShapeType`; add `PathPoint`/`PathNode`/`PathData`; add `path?` to `VectorAsset`; add `strokeLinecap`/`strokeLinejoin` to `VectorStyle`)
- Modify: `src/engine/project.ts:81-93` (`createVectorAsset` name for `'path'`)
- Test: `src/engine/project.test.ts`

**Interfaces:**
- Produces:
  - `type VectorShapeType = 'rect' | 'ellipse' | 'path'`
  - `interface PathPoint { x: number; y: number }`
  - `interface PathNode { anchor: PathPoint; in?: PathPoint; out?: PathPoint }`
  - `interface PathData { nodes: PathNode[]; closed: boolean }`
  - `VectorAsset.path?: PathData`
  - `VectorStyle.strokeLinecap?: 'butt' | 'round' | 'square'`
  - `VectorStyle.strokeLinejoin?: 'miter' | 'round' | 'bevel'`
  - `createVectorAsset('path')` → asset with `name: 'Path'`, `shapeType: 'path'`

- [ ] **Step 1: Write the failing test**

In `src/engine/project.test.ts`, add:

```ts
import { createVectorAsset } from './project';

describe('createVectorAsset path', () => {
  it('names a path asset "Path" and sets shapeType', () => {
    const asset = createVectorAsset('path');
    expect(asset.shapeType).toBe('path');
    expect(asset.name).toBe('Path');
    expect(asset.kind).toBe('vector');
  });

  it('accepts a PathData override', () => {
    const path = { nodes: [{ anchor: { x: 0, y: 0 } }], closed: false };
    const asset = createVectorAsset('path', { path });
    expect(asset.path).toEqual(path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/engine/project.test.ts`
Expected: FAIL — `createVectorAsset('path')` name is not `'Path'` (current ternary yields `'Ellipse'`), and `'path'` is not assignable to `VectorShapeType`.

- [ ] **Step 3: Implement the types and factory**

In `src/engine/types.ts`, replace the `VectorShapeType`/`VectorStyle`/`VectorAsset` block:

```ts
export type VectorShapeType = 'rect' | 'ellipse' | 'path';

export interface PathPoint {
  x: number;
  y: number;
}

/** A path node: an anchor plus optional bezier control handles, each stored as an
 * OFFSET relative to the anchor. Absent in/out = a corner (no handle on that side).
 * A node is "smooth" when in and out are mirrored (in == -out). */
export interface PathNode {
  anchor: PathPoint;
  in?: PathPoint;
  out?: PathPoint;
}

export interface PathData {
  nodes: PathNode[];
  closed: boolean;
}

export interface VectorStyle {
  /** CSS color, or the literal 'none'. */
  fill: string;
  /** CSS color, or the literal 'none'. */
  stroke: string;
  strokeWidth: number;
  /** Optional; render default 'butt'. */
  strokeLinecap?: 'butt' | 'round' | 'square';
  /** Optional; render default 'miter'. */
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
}

export interface VectorAsset {
  id: string; // uuid — mutable content, NOT a content hash
  kind: 'vector';
  name: string;
  shapeType: VectorShapeType;
  style: VectorStyle;
  /** Present iff shapeType === 'path'. Static this slice (node positions do not keyframe). */
  path?: PathData;
}
```

In `src/engine/project.ts`, update the name in `createVectorAsset`:

```ts
  return {
    id: newId(),
    kind: 'vector',
    name: shapeType === 'rect' ? 'Rectangle' : shapeType === 'ellipse' ? 'Ellipse' : 'Path',
    shapeType,
    style: { ...DEFAULT_VECTOR_STYLE },
    ...overrides,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/engine/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/project.ts src/engine/project.test.ts
git commit -m "feat(engine): add path shape type, PathData model, and stroke cap/join style fields"
```

---

### Task 2: `pathToD` serializer

**Files:**
- Create: `src/engine/path.ts`
- Create: `src/engine/path.test.ts`
- Modify: `src/engine/index.ts` (export the new module)

**Interfaces:**
- Consumes: `fmt` from `./transform`; `PathData` from `./types`.
- Produces: `pathToD(path: PathData): string`

- [ ] **Step 1: Write the failing test**

Create `src/engine/path.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pathToD } from './path';
import type { PathData } from './types';

describe('pathToD', () => {
  it('serializes a straight open path (corners) as M/L', () => {
    const p: PathData = {
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    };
    expect(pathToD(p)).toBe('M 0 0 L 10 0');
  });

  it('closes a path with Z', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 } },
        { anchor: { x: 10, y: 0 } },
        { anchor: { x: 10, y: 10 } },
      ],
      closed: true,
    };
    expect(pathToD(p)).toBe('M 0 0 L 10 0 L 10 10 Z');
  });

  it('emits a cubic C using out of the previous node and in of the current node', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, out: { x: 5, y: 0 } },
        { anchor: { x: 10, y: 10 }, in: { x: 0, y: -5 } },
      ],
      closed: false,
    };
    // c1 = prev.anchor + prev.out = (5,0); c2 = cur.anchor + cur.in = (10,5)
    expect(pathToD(p)).toBe('M 0 0 C 5 0 10 5 10 10');
  });

  it('emits a closing cubic segment back to the first node when closed', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, in: { x: -2, y: 0 }, out: { x: 2, y: 0 } },
        { anchor: { x: 10, y: 0 }, in: { x: -2, y: 0 }, out: { x: 2, y: 0 } },
      ],
      closed: true,
    };
    // segment 0->1: C (2 0) (8 0) (10 0); closing 1->0: C (12 0) (-2 0) (0 0) Z
    expect(pathToD(p)).toBe('M 0 0 C 2 0 8 0 10 0 C 12 0 -2 0 0 0 Z');
  });

  it('returns empty string for an empty path', () => {
    expect(pathToD({ nodes: [], closed: false })).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/engine/path.test.ts`
Expected: FAIL — `Cannot find module './path'`.

- [ ] **Step 3: Implement `pathToD`**

Create `src/engine/path.ts`:

```ts
import { fmt } from './transform';
import type { PathData, PathNode, PathPoint } from './types';

function add(anchor: PathPoint, offset: PathPoint | undefined): PathPoint {
  return offset ? { x: anchor.x + offset.x, y: anchor.y + offset.y } : anchor;
}

// Emits one segment from `prev` to `cur`. A cubic C is used when EITHER endpoint
// has a handle on the relevant side; otherwise the segment is a straight L.
function segment(prev: PathNode, cur: PathNode): string {
  if (prev.out || cur.in) {
    const c1 = add(prev.anchor, prev.out);
    const c2 = add(cur.anchor, cur.in);
    return `C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(cur.anchor.x)} ${fmt(cur.anchor.y)}`;
  }
  return `L ${fmt(cur.anchor.x)} ${fmt(cur.anchor.y)}`;
}

// Pure serializer: PathData -> SVG path `d`. The SINGLE definition of path markup,
// shared by the editor Stage and the export runtime so preview == export.
export function pathToD(path: PathData): string {
  const { nodes, closed } = path;
  if (nodes.length === 0) return '';
  const parts: string[] = [`M ${fmt(nodes[0].anchor.x)} ${fmt(nodes[0].anchor.y)}`];
  for (let i = 1; i < nodes.length; i++) {
    parts.push(segment(nodes[i - 1], nodes[i]));
  }
  if (closed && nodes.length > 1) {
    parts.push(segment(nodes[nodes.length - 1], nodes[0]));
    parts.push('Z');
  }
  return parts.join(' ');
}
```

In `src/engine/index.ts`, add after the `renderShape` export:

```ts
export * from './path';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/engine/path.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/engine/path.ts src/engine/path.test.ts src/engine/index.ts
git commit -m "feat(engine): add pure pathToD serializer (PathData -> SVG d)"
```

---

### Task 3: `pathBounds`

**Files:**
- Modify: `src/engine/path.ts`
- Modify: `src/engine/path.test.ts`

**Interfaces:**
- Produces: `pathBounds(path: PathData): { x: number; y: number; width: number; height: number }`
  (anchor-point extents; empty path → `{ x: 0, y: 0, width: 0, height: 0 }`)

- [ ] **Step 1: Write the failing test**

Append to `src/engine/path.test.ts`:

```ts
import { pathBounds } from './path';

describe('pathBounds', () => {
  it('returns the anchor-point bounding box including a non-zero min', () => {
    const p = {
      nodes: [{ anchor: { x: 4, y: 6 } }, { anchor: { x: 14, y: 26 } }],
      closed: false,
    };
    expect(pathBounds(p)).toEqual({ x: 4, y: 6, width: 10, height: 20 });
  });

  it('returns a zero box for an empty path', () => {
    expect(pathBounds({ nodes: [], closed: false })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/engine/path.test.ts`
Expected: FAIL — `pathBounds` is not exported.

- [ ] **Step 3: Implement `pathBounds`**

Append to `src/engine/path.ts`:

```ts
// Anchor-extent bounding box. Sufficient for the fractional-anchor pivot and the
// selection bbox this slice; curve-tight bounds are a cheap later refinement.
export function pathBounds(path: PathData): { x: number; y: number; width: number; height: number } {
  if (path.nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of path.nodes) {
    if (n.anchor.x < minX) minX = n.anchor.x;
    if (n.anchor.y < minY) minY = n.anchor.y;
    if (n.anchor.x > maxX) maxX = n.anchor.x;
    if (n.anchor.y > maxY) maxY = n.anchor.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/engine/path.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/path.ts src/engine/path.test.ts
git commit -m "feat(engine): add pathBounds (anchor-extent bbox)"
```

---

### Task 4: `renderShapeToSvg` path branch + cap/join attributes

**Files:**
- Modify: `src/engine/renderShape.ts`
- Modify: `src/engine/renderShape.test.ts`

**Interfaces:**
- Consumes: `pathToD` from `./path`; `PathData` from `./types`.
- Produces: `renderShapeToSvg(shapeType, geometry, style, path?: PathData): string`
  - For `shapeType === 'path'`: `<path d="…" fill stroke stroke-width [stroke-linecap] [stroke-linejoin]/>`
  - Missing/empty `path` → returns `''`.
  - `styleToSvgAttrs` now emits `stroke-linecap`/`stroke-linejoin` when present.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/renderShape.test.ts`:

```ts
import { pathToD } from './path';

describe('renderShapeToSvg path', () => {
  const path = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false };
  const style = { fill: 'none', stroke: '#000000', strokeWidth: 2 };

  it('renders a <path> with d from pathToD', () => {
    const out = renderShapeToSvg('path', {}, style, path);
    expect(out).toBe(`<path d="${pathToD(path)}" fill="none" stroke="#000000" stroke-width="2"/>`);
  });

  it('emits stroke-linecap and stroke-linejoin when present', () => {
    const out = renderShapeToSvg('path', {}, { ...style, strokeLinecap: 'round', strokeLinejoin: 'bevel' }, path);
    expect(out).toContain('stroke-linecap="round"');
    expect(out).toContain('stroke-linejoin="bevel"');
  });

  it('returns empty string for a path shape with no path data', () => {
    expect(renderShapeToSvg('path', {}, style, undefined)).toBe('');
    expect(renderShapeToSvg('path', {}, style, { nodes: [], closed: false })).toBe('');
  });
});

describe('renderShapeToSvg cap/join on rect', () => {
  it('emits cap/join for rect when present', () => {
    const out = renderShapeToSvg(
      'rect',
      { width: 4, height: 4 },
      { fill: '#fff', stroke: '#000', strokeWidth: 1, strokeLinejoin: 'round' },
    );
    expect(out).toContain('stroke-linejoin="round"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/engine/renderShape.test.ts`
Expected: FAIL — path branch not implemented; cap/join not emitted.

- [ ] **Step 3: Implement the path branch + cap/join**

In `src/engine/renderShape.ts`, update imports and the two functions:

```ts
import { fmt } from './transform';
import { pathToD } from './path';
import type { PathData, ResolvedGeometry, VectorShapeType, VectorStyle } from './types';
```

Replace `styleToSvgAttrs`:

```ts
function styleToSvgAttrs(style: VectorStyle): Record<string, string> {
  const attrs: Record<string, string> = {
    fill: style.fill,
    stroke: style.stroke,
    'stroke-width': fmt(style.strokeWidth),
  };
  if (style.strokeLinecap !== undefined) attrs['stroke-linecap'] = style.strokeLinecap;
  if (style.strokeLinejoin !== undefined) attrs['stroke-linejoin'] = style.strokeLinejoin;
  return attrs;
}
```

Replace `renderShapeToSvg`:

```ts
export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
  path?: PathData,
): string {
  if (shapeType === 'path') {
    if (!path || path.nodes.length === 0) return '';
    const attrs = { d: pathToD(path), ...styleToSvgAttrs(style) };
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(' ');
    return `<path ${attrStr}/>`;
  }
  const tag = shapeType === 'rect' ? 'rect' : 'ellipse';
  const attrs = { ...geometryToSvgAttrs(shapeType, geometry), ...styleToSvgAttrs(style) };
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<${tag} ${attrStr}/>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/engine/renderShape.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/renderShape.ts src/engine/renderShape.test.ts
git commit -m "feat(engine): renderShapeToSvg path branch + stroke cap/join attrs"
```

---

### Task 5: `resolveAnchor` path case + make `shapeType` required

**Files:**
- Modify: `src/engine/sample.ts:49-61` (`resolveAnchor`)
- Modify: `src/engine/sample.test.ts`
- Modify: `src/services/export/renderDocument.ts:43` (pass explicit `undefined` for svg)
- Modify: `src/runtime/frame.ts` (already passes `shapeType` — verify no change needed)

**Interfaces:**
- Consumes: `pathBounds` from `./path`.
- Produces: `resolveAnchor(obj: SceneObject, state: RenderState, shapeType: VectorShapeType | undefined): { anchorX: number; anchorY: number }`
  — `shapeType` is now a **required** parameter (callers must pass it, `undefined` for non-vector/svg). For `'path'`, the anchor resolves against `pathBounds` including its min; but since `RenderState` has no path data, the path bbox is supplied via the object's asset at the call site — see implementation note.

> **Implementation note:** `resolveAnchor` does not have the `PathData` (it only sees `obj`/`state`). For the `'path'` case it needs the path bbox. The cleanest contract that keeps `resolveAnchor` pure and signature-stable is to resolve the path anchor against a bbox carried on `state.geometry` is **not** available for paths. Instead, pass the path bbox in through a new optional 4th argument `pathBox?: { x; y; width; height }`. Callers that have a path asset compute `pathBounds(asset.path)` and pass it. This keeps `resolveAnchor` pure.

Revised Produces:
- `resolveAnchor(obj, state, shapeType: VectorShapeType | undefined, pathBox?: { x: number; y: number; width: number; height: number }): { anchorX: number; anchorY: number }`

- [ ] **Step 1: Write the failing test**

Append to `src/engine/sample.test.ts`:

```ts
import { resolveAnchor } from './sample';

describe('resolveAnchor path', () => {
  const baseObj = {
    id: 'o1', name: 'p', assetId: 'a1', zOrder: 0,
    anchorX: 0.5, anchorY: 0.5, anchorMode: 'fraction' as const,
    base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    tracks: {},
  };

  it('resolves a fractional anchor against the path bbox including its min', () => {
    const state = { objectId: 'o1', x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
    const pathBox = { x: 4, y: 6, width: 10, height: 20 };
    const a = resolveAnchor(baseObj, state, 'path', pathBox);
    // x: 4 + 0.5*10 = 9 ; y: 6 + 0.5*20 = 16
    expect(a).toEqual({ anchorX: 9, anchorY: 16 });
  });

  it('absolute-mode objects ignore shapeType/pathBox', () => {
    const obj = { ...baseObj, anchorMode: 'absolute' as const, anchorX: 3, anchorY: 7 };
    const state = { objectId: 'o1', x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
    expect(resolveAnchor(obj, state, undefined)).toEqual({ anchorX: 3, anchorY: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/engine/sample.test.ts`
Expected: FAIL — path case not handled (returns `0.5 * 0`).

- [ ] **Step 3: Implement the path case + required shapeType**

In `src/engine/sample.ts`, replace `resolveAnchor`:

```ts
export function resolveAnchor(
  obj: SceneObject,
  state: RenderState,
  shapeType: VectorShapeType | undefined,
  pathBox?: { x: number; y: number; width: number; height: number },
): { anchorX: number; anchorY: number } {
  if (obj.anchorMode !== 'fraction') {
    return { anchorX: obj.anchorX, anchorY: obj.anchorY };
  }
  if (shapeType === 'path') {
    const box = pathBox ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      anchorX: box.x + obj.anchorX * box.width,
      anchorY: box.y + obj.anchorY * box.height,
    };
  }
  const g = state.geometry ?? {};
  const width = shapeType === 'ellipse' ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
  const height = shapeType === 'ellipse' ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
  return { anchorX: obj.anchorX * width, anchorY: obj.anchorY * height };
}
```

In `src/services/export/renderDocument.ts`, the svg branch call (currently `resolveAnchor(obj, state)`) becomes explicit:

```ts
      const { anchorX, anchorY } = resolveAnchor(obj, state, undefined);
```

Verify `src/runtime/frame.ts` `computeFrame` already passes `shapeType` (it does: `resolveAnchor(obj, state, shapeType)`); no change needed there yet (the path bbox is added in Task 6's export path and the Stage in Plan B).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/engine/sample.test.ts && pnpm typecheck`
Expected: PASS, and typecheck clean (all `resolveAnchor` callers pass `shapeType`).

- [ ] **Step 5: Commit**

```bash
git add src/engine/sample.ts src/engine/sample.test.ts src/services/export/renderDocument.ts
git commit -m "feat(engine): resolveAnchor path case; make shapeType required (close Slice-1 footgun)"
```

---

### Task 6: Export inline `<path>` branch

**Files:**
- Modify: `src/services/export/renderDocument.ts:34-39` (vector branch)
- Modify: `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `renderShapeToSvg(shapeType, geometry, style, path)`, `pathBounds`, `resolveAnchor(obj, state, shapeType, pathBox)`.
- Produces: a path object exports as `<g data-savig-object="…" transform="…" opacity="…"><path d="…"/></g>`.

- [ ] **Step 1: Write the failing test**

Append to `src/services/export/renderDocument.test.ts` (follow the file's existing project-construction helpers; the test below shows the assertion shape — adapt the setup to the file's existing `makeProject`/factory usage):

```ts
import { pathToD } from '../../engine';

it('exports a path object as an inline <g><path/></g>', () => {
  const path = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: false };
  const asset = createVectorAsset('path', { path, style: { fill: 'none', stroke: '#000000', strokeWidth: 2 } });
  const obj = createSceneObject(asset.id, {
    anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM, x: 5, y: 5 },
  });
  const project = { ...createProject(), assets: [asset], objects: [obj] };

  const svg = renderSvgDocument(project);
  expect(svg).toContain(`<path d="${pathToD(path)}" fill="none" stroke="#000000" stroke-width="2"/>`);
  expect(svg).toContain(`data-savig-object="${obj.id}"`);
  // path assets are inlined, NOT placed in <defs>
  expect(svg).toContain('<defs></defs>');
});
```

(Import `createVectorAsset`, `createSceneObject`, `createProject`, `DEFAULT_TRANSFORM` from `../../engine` as the other tests in the file do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/export/renderDocument.test.ts`
Expected: FAIL — the vector branch passes only `(shapeType, geometry, style)`, so `renderShapeToSvg('path', …)` returns `''`.

- [ ] **Step 3: Implement the export path branch**

In `src/services/export/renderDocument.ts`, update imports:

```ts
import {
  buildTransform,
  fmt,
  pathBounds,
  renderShapeToSvg,
  resolveAnchor,
  sampleProject,
} from '../../engine';
```

Replace the `asset.kind === 'vector'` branch:

```ts
      if (asset.kind === 'vector') {
        const pathBox = asset.shapeType === 'path' && asset.path ? pathBounds(asset.path) : undefined;
        const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
        const transform = buildTransform(state, anchorX, anchorY);
        const shape = renderShapeToSvg(asset.shapeType, state.geometry ?? {}, asset.style, asset.path);
        return `<g data-savig-object="${obj.id}" transform="${transform}" opacity="${fmt(state.opacity)}">${shape}</g>`;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/export/renderDocument.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(export): inline <path> branch for path vector objects"
```

---

### Task 7: Runtime parity — paths emit no per-frame geometry

**Files:**
- Modify: `src/runtime/frame.ts:21-39` (`computeFrame` — pass path bbox to `resolveAnchor`)
- Modify: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `pathBounds`.
- Produces: `computeFrame` returns a `FrameItem` for path objects with `transform`/`opacity` but **no `geometry`** (paths have no scalar geometry). The path bbox is used only for the anchor pivot.

> **Note:** `computeFrame` currently calls `resolveAnchor(obj, state, shapeType)` without a path bbox, so a rotated path would pivot off its bbox min. Add the bbox for parity with the export.

- [ ] **Step 1: Write the failing test**

Append to `src/runtime/frame.test.ts`:

```ts
import { pathBounds } from '../engine';

it('computeFrame produces no geometry for a path object and pivots on its bbox', () => {
  const path = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }], closed: false };
  const asset = createVectorAsset('path', { path });
  const obj = createSceneObject(asset.id, {
    anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM, rotation: 90 },
  });
  const project = { ...createProject(), assets: [asset], objects: [obj] };

  const items = computeFrame(project, 0);
  const item = items.find((i) => i.objectId === obj.id)!;
  expect(item.geometry).toBeUndefined();
  // transform must rotate about the bbox center (10,0), matching the export's resolveAnchor
  expect(item.transform).toContain('rotate(90');
});
```

(Import the factories from `../engine` as other tests in the file do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/runtime/frame.test.ts`
Expected: FAIL — the pivot is resolved without the path bbox (anchor resolves to 0,0), so the transform differs from the export.

- [ ] **Step 3: Implement the path bbox in `computeFrame`**

In `src/runtime/frame.ts`, update imports and the anchor resolution:

```ts
import {
  buildTransform,
  fmt,
  geometryToSvgAttrs,
  pathBounds,
  resolveAnchor,
  sampleProject,
} from '../engine';
```

Inside `computeFrame`'s map, replace the `resolveAnchor` call:

```ts
    const shapeType = asset && asset.kind === 'vector' ? asset.shapeType : undefined;
    const pathBox =
      asset && asset.kind === 'vector' && asset.shapeType === 'path' && asset.path
        ? pathBounds(asset.path)
        : undefined;
    const { anchorX, anchorY } = resolveAnchor(obj, state, shapeType, pathBox);
```

(The `if (shapeType && state.geometry)` geometry block is unchanged — paths have no `state.geometry`, so no `item.geometry` is produced.)

- [ ] **Step 4: Run test + full parity suite**

Run: `pnpm test -- src/runtime/frame.test.ts`
Expected: PASS. Then run the whole suite: `pnpm test`
Expected: all green (confirms the existing runtime↔engine parity test still holds with the new `resolveAnchor` signature).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts
git commit -m "feat(runtime): pivot path objects on their bbox; no per-frame geometry for paths"
```

---

### Task 8: Persistence migration v2 → v3

**Files:**
- Modify: `src/engine/project.ts:49-62` (`createProject` version `3`)
- Modify: `src/services/persistence/migrate.ts` (`CURRENT_VERSION = 3`; add `2:` upgrader)
- Modify: `src/services/persistence/migrate.test.ts`

**Interfaces:**
- Produces: `CURRENT_VERSION = 3`; a no-op `2 -> 3` upgrader; `createProject().meta.version === 3`.

- [ ] **Step 1: Write the failing test**

Append to `src/services/persistence/migrate.test.ts`:

```ts
it('migrates a v2 project (no paths) to v3 unchanged except the version stamp', () => {
  const v2 = { ...createProject(), meta: { ...createProject().meta, version: 2 } };
  const out = migrateProject(v2);
  expect(out.meta.version).toBe(3);
  expect(out.assets).toEqual(v2.assets);
  expect(out.objects).toEqual(v2.objects);
});

it('still migrates a v1 project all the way to v3', () => {
  const v1 = { ...createProject(), meta: { ...createProject().meta, version: 1 } };
  expect(migrateProject(v1).meta.version).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/persistence/migrate.test.ts`
Expected: FAIL — `CURRENT_VERSION` is 2, so a v2 doc is returned with version 2 and a v1 doc only reaches 2.

- [ ] **Step 3: Implement the migration bump**

In `src/services/persistence/migrate.ts`:

```ts
export const CURRENT_VERSION = 3;

// Keyed by the version being upgraded FROM.
// v1 -> v2 introduced vector assets + geometry tracks.
// v2 -> v3 introduced path vector assets + stroke cap/join (both optional);
// old files have neither, so the upgrade only stamps the version.
export const migrations: Record<number, (doc: Project) => Project> = {
  1: (doc) => ({ ...doc, meta: { ...doc.meta, version: 2 } }),
  2: (doc) => ({ ...doc, meta: { ...doc.meta, version: 3 } }),
};
```

In `src/engine/project.ts`, change the default `version` in `createProject` from `2` to `3`.

- [ ] **Step 4: Run test + full suite**

Run: `pnpm test -- src/services/persistence/migrate.test.ts`
Expected: PASS. Then `pnpm test` — fix any test that hard-codes `version: 2` for a freshly-created project (update to 3).

- [ ] **Step 5: Commit**

```bash
git add src/engine/project.ts src/services/persistence/migrate.ts src/services/persistence/migrate.test.ts
git commit -m "feat(persistence): bump project version v2->v3 with no-op upgrader for paths"
```

---

### Task 9: Regenerate runtime bundle + final verification

**Files:**
- Modify: `src/runtime/runtimeSource.generated.ts` (regenerated, if the build step regenerates it)
- Verify: whole suite, typecheck, lint, build

> Slice 1 compiled the shared render core into the standalone runtime via a build
> step that writes `runtimeSource.generated.ts`. Since paths add no per-frame
> runtime geometry logic (the runtime already applies transform/opacity via
> `applyFrameToNodes`), confirm whether the generated bundle needs regenerating.
> The render core it embeds (`computeFrame`/`applyFrameToNodes`) is unchanged in
> behavior for non-path objects; for paths there is simply no geometry item.

- [ ] **Step 1: Check for a generate script**

Run: `cat scripts/*.* package.json` and look for a runtime-generation script (e.g. `pnpm generate:runtime` or similar used in Slice 1).
Expected: identify the command that produces `src/runtime/runtimeSource.generated.ts`.

- [ ] **Step 2: Regenerate the runtime bundle**

Run the identified generate command (example): `pnpm generate:runtime`
Expected: `src/runtime/runtimeSource.generated.ts` updated (or unchanged if the embedded core didn't change).

- [ ] **Step 3: Run the full verification gate**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 4: Commit (if anything regenerated)**

```bash
git add src/runtime/runtimeSource.generated.ts
git commit -m "chore(runtime): regenerate runtime bundle for path support"
```

(If nothing changed, skip the commit.)

---

## Self-Review

**Spec coverage (Plan A scope):**
- §2 data model (`PathData`, `'path'`, cap/join) → Task 1.
- §3.1 `pathToD` → Task 2. §3.2 `pathBounds` → Task 3. §3.3 `renderShapeToSvg` path + cap/join → Task 4. §3.4 `resolveAnchor` path case + required `shapeType` → Task 5. §3.5 no per-frame path work → Task 7.
- §4 export inline `<path>` → Task 6. Parity (Stage d === export d) — export side covered by Task 6 (`pathToD`); Stage side lands in Plan B; runtime no-geometry parity → Task 7.
- §6 migration v2→v3 → Task 8.
- Runtime bundle regen → Task 9.

**Placeholder scan:** No "TBD/TODO/handle edge cases" — all steps carry concrete code and commands. Task 9 is intentionally a verification/regeneration task (its "check for script" step is a real lookup, not a placeholder).

**Type consistency:** `resolveAnchor(obj, state, shapeType, pathBox?)` signature is used identically in Tasks 5, 6, 7. `renderShapeToSvg(shapeType, geometry, style, path?)` consistent in Tasks 4, 6. `pathToD`/`pathBounds` names consistent across Tasks 2–8. `PathData`/`PathNode`/`PathPoint` consistent from Task 1 onward.

**Known cross-plan dependency:** the Stage-side `d`-parity assertion and all UI live in Plan B.
