# Slice 10 Stroke Dash — Plan A (Engine & Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a vector object a dashed stroke and animate `stroke-dashoffset` over the timeline (the self-drawing-path effect) through the engine, runtime, and export, with preview == export.

**Architecture:** Add `strokeDasharray`/`strokeDashoffset` to `VectorStyle` (static) and an optional `dashOffsetTrack?: Keyframe[]` on `SceneObject` (the 5th animate-a-thing seam after shapeTrack/colorTracks/motionPath/gradientTracks). Dash units are pathLength-normalized (`pathLength="1"`). A plain scalar `Keyframe[]` track reuses `interpolate`/`applyEasing`; `sampleObject` resolves it, `computeFrame` carries it, `applyFrameToNodes` sets the attr per frame; export bakes the t=0 sample. No persistence migration (stays v4).

**Tech Stack:** TypeScript (strict), Vitest, the existing `src/engine` pure core + `src/runtime` DOM applier + `src/services/export` document renderer.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- All emitted SVG numbers go through `fmt()`; all colors/attr values through `escapeAttr()` (in the string emitter).
- Dash units are pathLength-normalized: whenever `strokeDasharray` is present and non-empty, the shape carries `pathLength="1"`. A solid object (no dasharray) emits no `stroke-dasharray`, `pathLength`, or `stroke-dashoffset`.
- `dashOffsetTrack` is a plain `Keyframe[]` (reuses `interpolate`); NOT a new `AnimatableProperty`.
- The object's shape stays the wrapper `<g>`'s `firstElementChild` (unchanged invariant).
- No persistence version bump (project stays v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build`.

---

### Task 1: Data model — dash style fields + `dashOffsetTrack`

**Files:**
- Modify: `src/engine/types.ts`

**Interfaces:**
- Produces: `VectorStyle.strokeDasharray?: number[]`; `VectorStyle.strokeDashoffset?: number`; `SceneObject.dashOffsetTrack?: Keyframe[]`.

- [ ] **Step 1: Add the VectorStyle fields**

In `src/engine/types.ts`, inside `VectorStyle`, after `strokeLinejoin?: ...;`:

```ts
  /** Dash pattern in pathLength-normalized units (0..1). Absent = solid stroke. */
  strokeDasharray?: number[];
  /** Static dash phase in pathLength-normalized units. Absent = 0. */
  strokeDashoffset?: number;
```

- [ ] **Step 2: Add the track field to `SceneObject`**

In `SceneObject`, immediately after the `gradientTracks` field:

```ts
  /** Animated stroke-dashoffset (pathLength-normalized). A non-empty track
   *  overrides the static VectorStyle.strokeDashoffset (self-drawing effect). */
  dashOffsetTrack?: Keyframe[];
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (type-only addition, no usages yet).

- [ ] **Step 4: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(slice10): stroke dash style fields + dashOffsetTrack on SceneObject"
```

---

### Task 2: Static markup — emit dash attrs + `pathLength`, with a `dashOffset` override

**Files:**
- Modify: `src/engine/renderShape.ts`
- Test: `src/engine/renderShape.test.ts`

**Interfaces:**
- Produces: `renderShapeToSvg(shapeType, geometry, style, path?, idScope?, gradientPaint?, dashOffset?: number)` — when `style.strokeDasharray` is present and non-empty, emits `stroke-dasharray`, `pathLength="1"`, and `stroke-dashoffset="<fmt(dashOffset ?? style.strokeDashoffset ?? 0)>"`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/renderShape.test.ts`:

```ts
it('emits dash attrs + pathLength=1 when a dasharray is present', () => {
  const out = renderShapeToSvg('rect', { width: 10, height: 10 }, {
    fill: 'none', stroke: '#000000', strokeWidth: 2, strokeDasharray: [1, 1], strokeDashoffset: 0.25,
  });
  expect(out).toContain('stroke-dasharray="1 1"');
  expect(out).toContain('pathLength="1"');
  expect(out).toContain('stroke-dashoffset="0.25"');
});

it('emits no dash attrs for a solid stroke', () => {
  const out = renderShapeToSvg('rect', { width: 10, height: 10 }, {
    fill: 'none', stroke: '#000000', strokeWidth: 2,
  });
  expect(out).not.toContain('stroke-dasharray');
  expect(out).not.toContain('pathLength');
  expect(out).not.toContain('stroke-dashoffset');
});

it('applies the dashOffset override over the static strokeDashoffset', () => {
  const out = renderShapeToSvg('rect', { width: 10, height: 10 }, {
    fill: 'none', stroke: '#000000', strokeWidth: 2, strokeDasharray: [1, 1], strokeDashoffset: 0.25,
  }, undefined, undefined, undefined, 0.75);
  expect(out).toContain('stroke-dashoffset="0.75"');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/renderShape.test.ts`
Expected: FAIL — no dash attrs emitted; `dashOffset` param does not exist.

- [ ] **Step 3: Thread `dashOffset` + emit the dash attrs**

In `src/engine/renderShape.ts`:

1. Extend `styleToSvgAttrs`:

```ts
function styleToSvgAttrs(
  style: VectorStyle,
  idScope?: string,
  gradientPaint?: { fill?: boolean; stroke?: boolean },
  dashOffset?: number,
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
  if (style.strokeDasharray && style.strokeDasharray.length > 0) {
    attrs['stroke-dasharray'] = style.strokeDasharray.map(fmt).join(' ');
    attrs.pathLength = '1';
    attrs['stroke-dashoffset'] = fmt(dashOffset ?? style.strokeDashoffset ?? 0);
  }
  return attrs;
}
```

2. Add the param to `renderShapeToSvg` and pass it through BOTH `styleToSvgAttrs` calls:

```ts
export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
  path?: PathData,
  idScope?: string,
  gradientPaint?: { fill?: boolean; stroke?: boolean },
  dashOffset?: number,
): string {
  if (shapeType === 'path') {
    if (!path || path.nodes.length === 0) return '';
    const attrs = { d: pathToD(path), ...styleToSvgAttrs(style, idScope, gradientPaint, dashOffset) };
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(' ');
    return `<path ${attrStr}/>`;
  }
  const tag = shapeType === 'rect' ? 'rect' : 'ellipse';
  const attrs = { ...geometryToSvgAttrs(shapeType, geometry), ...styleToSvgAttrs(style, idScope, gradientPaint, dashOffset) };
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<${tag} ${attrStr}/>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/engine/renderShape.test.ts`
Expected: PASS (new dash tests + unchanged existing tests — solid objects still emit no dash attrs).

- [ ] **Step 5: Commit**

```bash
git add src/engine/renderShape.ts src/engine/renderShape.test.ts
git commit -m "feat(slice10): renderShapeToSvg emits dash attrs + pathLength with dashOffset override"
```

---

### Task 3: Resolve the dash offset in `sampleObject`

**Files:**
- Modify: `src/engine/sample.ts`
- Test: `src/engine/sample.test.ts`

**Interfaces:**
- Consumes: `obj.dashOffsetTrack` (Task 1), `interpolate` (already imported in sample.ts).
- Produces: `RenderState.strokeDashoffset?: number`, populated when `dashOffsetTrack` is non-empty.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/sample.test.ts`:

```ts
describe('sampleObject dash offset track', () => {
  it('resolves strokeDashoffset from a non-empty track', () => {
    const obj = createSceneObject('asset-1', {
      dashOffsetTrack: [
        { time: 0, value: 1, easing: 'linear' },
        { time: 2, value: 0, easing: 'linear' },
      ],
    });
    expect(sampleObject(obj, 1).strokeDashoffset).toBeCloseTo(0.5);
  });

  it('leaves strokeDashoffset undefined when no track exists', () => {
    expect(sampleObject(createSceneObject('asset-1', {}), 0).strokeDashoffset).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/sample.test.ts`
Expected: FAIL — `strokeDashoffset` undefined / not on type.

- [ ] **Step 3: Add the field + resolution**

In `src/engine/sample.ts`:

1. Extend `RenderState`, after `strokeGradient?: Gradient;`:

```ts
  /** Present only for vector objects with an animated stroke-dashoffset track. */
  strokeDashoffset?: number;
```

2. In `sampleObject`, immediately after the `gradientTracks` block:

```ts
  if (obj.dashOffsetTrack && obj.dashOffsetTrack.length > 0) {
    state.strokeDashoffset = interpolate(obj.dashOffsetTrack, time);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/engine/sample.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/sample.ts src/engine/sample.test.ts
git commit -m "feat(slice10): sampleObject resolves animated stroke-dashoffset"
```

---

### Task 4: `FrameItem` + `computeFrame` + `applyFrameToNodes`

**Files:**
- Modify: `src/runtime/frame.ts`
- Test: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `state.strokeDashoffset` (Task 3), `fmt` (already imported).
- Produces: `FrameItem.strokeDashoffset?: string` (the formatted attr value); `applyFrameToNodes` sets `stroke-dashoffset` on the inner shape.

- [ ] **Step 1: Write the failing tests**

Append to `src/runtime/frame.test.ts`:

```ts
describe('computeFrame dash offset', () => {
  it('emits strokeDashoffset = fmt(interpolate(track, t))', () => {
    const track = [
      { time: 0, value: 1, easing: 'linear' as const },
      { time: 2, value: 0, easing: 'linear' as const },
    ];
    const asset = createVectorAsset('rect', {});
    const obj = createSceneObject(asset.id, { shapeBase: { width: 10, height: 10 }, dashOffsetTrack: track });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].strokeDashoffset).toBe(fmt(0.5));
  });

  it('does NOT emit strokeDashoffset without a track', () => {
    const asset = createVectorAsset('rect', {});
    const obj = createSceneObject(asset.id, { shapeBase: { width: 10, height: 10 } });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].strokeDashoffset).toBeUndefined();
  });
});

describe('applyFrameToNodes dash offset', () => {
  it('sets stroke-dashoffset on the inner shape', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-savig-object', 'obj-1');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    g.appendChild(rect);
    const nodes = new Map<string, Element>([['obj-1', g]]);
    applyFrameToNodes(nodes, [{ objectId: 'obj-1', transform: '', opacity: '1', strokeDashoffset: '0.5' }]);
    expect(rect.getAttribute('stroke-dashoffset')).toBe('0.5');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: FAIL — `strokeDashoffset` not on `FrameItem` / not applied.

- [ ] **Step 3: Extend `FrameItem`, `computeFrame`, `applyFrameToNodes`**

In `src/runtime/frame.ts`:

1. Extend `FrameItem`, after `strokeGradient?: Gradient;`:

```ts
  /** Present only for vector objects with an animated stroke-dashoffset track. */
  strokeDashoffset?: string;
```

2. In `computeFrame`, after the gradient assignments (`if (state.strokeGradient !== undefined) ...`):

```ts
    if (state.strokeDashoffset !== undefined) item.strokeDashoffset = fmt(state.strokeDashoffset);
```

3. In `applyFrameToNodes`, after the gradient-def block (the two `applyGradientToElement` calls):

```ts
    if (item.strokeDashoffset !== undefined) {
      const shape = node.firstElementChild;
      if (shape) shape.setAttribute('stroke-dashoffset', item.strokeDashoffset);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts
git commit -m "feat(slice10): FrameItem strokeDashoffset + applyFrameToNodes sets it"
```

---

### Task 5: Export bakes the t=0 dash offset

**Files:**
- Modify: `src/services/export/renderDocument.ts`
- Test: `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `state.strokeDashoffset` (Task 3), `renderShapeToSvg(..., dashOffset?)` (Task 2).
- Produces: exported vector shapes carry `pathLength="1"` + `stroke-dasharray` + the t=0-sampled `stroke-dashoffset`.

- [ ] **Step 1: Write the failing test**

Append to `src/services/export/renderDocument.test.ts`:

```ts
it('bakes the t=0 dash offset + pathLength for an animated dashoffset object', () => {
  const project = createProject();
  project.assets.push(
    createVectorAsset('rect', {
      id: 'vd',
      style: { fill: 'none', stroke: '#000000', strokeWidth: 2, strokeDasharray: [1, 1] },
    }),
  );
  project.objects.push(
    createSceneObject('vd', {
      id: 'o1',
      anchorMode: 'fraction',
      shapeBase: { width: 100, height: 50 },
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      dashOffsetTrack: [
        { time: 0, value: 1, easing: 'linear' },
        { time: 2, value: 0, easing: 'linear' },
      ],
    }),
  );
  const out = renderSvgDocument(project);
  expect(out).toContain('pathLength="1"');
  expect(out).toContain('stroke-dasharray="1 1"');
  expect(out).toContain('stroke-dashoffset="1"'); // sampled at t=0
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts`
Expected: FAIL — `stroke-dashoffset` baked from static (`0`), not the t=0 sample (`1`).

- [ ] **Step 3: Pass the t=0 sample into `renderShapeToSvg`**

In `src/services/export/renderDocument.ts`, the vector branch's `renderShapeToSvg` call currently ends with `{ fill: !!fillGrad, stroke: !!strokeGrad }`. Add the `dashOffset` argument:

```ts
        let shape = renderShapeToSvg(
          asset.shapeType,
          state.geometry ?? {},
          asset.style,
          framePath,
          obj.id,
          { fill: !!fillGrad, stroke: !!strokeGrad },
          state.strokeDashoffset,
        );
```

(`state` is `sampleProject(project, 0)[i]`, so `state.strokeDashoffset` IS the t=0 sample; `undefined` when no track → `styleToSvgAttrs` falls back to `style.strokeDashoffset ?? 0`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts`
Expected: PASS (including unchanged tests — solid/static objects pass `undefined` → same output as before).

- [ ] **Step 5: Commit**

```bash
git add src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(slice10): export bakes t=0 stroke-dashoffset"
```

---

### Task 6: Duration folds `dashOffsetTrack`

**Files:**
- Modify: `src/engine/duration.ts`
- Test: `src/engine/duration.test.ts`

**Interfaces:**
- Consumes: `obj.dashOffsetTrack`.
- Produces: `computeProjectDuration` extends to a dash keyframe's time.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/duration.test.ts`:

```ts
describe('computeProjectDuration dash offset track', () => {
  test('extends the duration to a dash keyframe past the prior end', () => {
    const obj = createSceneObject('a', {
      dashOffsetTrack: [createKeyframe(0, 1), createKeyframe(9, 0)],
    });
    const project = { ...createProject(), objects: [obj] };
    expect(computeProjectDuration(project)).toBe(9);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/duration.test.ts`
Expected: FAIL — duration is `0` (dashOffsetTrack not folded).

- [ ] **Step 3: Fold the track**

In `src/engine/duration.ts`, after the `gradientTracks` loop (or after the `colorTracks` loop if gradient is not adjacent), add:

```ts
    for (const keyframe of obj.dashOffsetTrack ?? []) {
      if (keyframe.time > max) max = keyframe.time;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/engine/duration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/duration.ts src/engine/duration.test.ts
git commit -m "feat(slice10): computeProjectDuration folds dashOffsetTrack"
```

---

### Task 7: Regenerate the runtime bundle + parity test

**Files:**
- Modify: `src/runtime/runtimeSource.generated.ts` (generated — regenerate, do not hand-edit)
- Test: `src/runtime/frame.test.ts` (parity case)

**Interfaces:**
- Consumes: everything above.
- Produces: a regenerated runtime bundle whose `applyFrameToNodes` sets `stroke-dashoffset`.

- [ ] **Step 1: Write the failing parity test**

Append to `src/runtime/frame.test.ts`:

```ts
describe('dash offset parity', () => {
  it('runtime applies stroke-dashoffset == fmt(interpolate(track, t))', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const track = [
      { time: 0, value: 1, easing: 'linear' as const },
      { time: 2, value: 0, easing: 'linear' as const },
    ];
    const asset = createVectorAsset('rect', { style: { fill: 'none', stroke: '#000', strokeWidth: 1, strokeDasharray: [1, 1] } });
    const obj = createSceneObject(asset.id, { id: 'o1', shapeBase: { width: 10, height: 10 }, dashOffsetTrack: track });
    const project: Project = { ...createProject(), assets: [asset], objects: [obj] };
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-savig-object', 'o1');
    g.appendChild(document.createElementNS(SVG_NS, 'rect'));
    const t = 1;
    applyFrameToNodes(new Map<string, Element>([['o1', g]]), computeFrame(project, t));
    expect(g.firstElementChild!.getAttribute('stroke-dashoffset')).toBe(fmt(interpolate(track, t)));
  });
});
```

> Add `interpolate` to the `from '../engine'` import in `frame.test.ts` if not already imported.

- [ ] **Step 2: Run to verify it fails (stale bundle is unrelated; this tests frame.ts directly and should PASS once Task 4 is in — so this step verifies the engine path)**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: PASS for this case (frame.ts already updated in Task 4). The bundle regen below ships the same code to the exported runtime.

- [ ] **Step 3: Regenerate the runtime bundle**

Run: `pnpm build:runtime`
Expected: `src/runtime/runtimeSource.generated.ts` rewritten to include the `stroke-dashoffset` apply branch.

- [ ] **Step 4: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/runtimeSource.generated.ts src/runtime/frame.test.ts
git commit -m "feat(slice10): regenerate runtime bundle + dash-offset parity test"
```

---

## Self-Review (Plan A vs spec)

- **§3 data model** → Task 1. ✅
- **§4 + §5.1 static markup + pathLength + dashOffset override** → Task 2. ✅
- **§5.2 RenderState resolution** → Task 3. ✅
- **§5.3 FrameItem + computeFrame, §5.4 applyFrameToNodes** → Task 4. ✅
- **§5.5 export bakes t=0 sample** → Task 5. ✅
- **§5.6 duration fold** → Task 6. ✅
- **§6 parity + bundle regen** → Task 7. ✅
- **§8 no migration** → no version bump anywhere. ✅
- **Type consistency:** `dashOffset?: number` param shape identical in Task 2 def + Task 5 call; `FrameItem.strokeDashoffset?: string` (formatted) set in Task 4, consumed by parity in Task 7; `RenderState.strokeDashoffset?: number` (Task 3) → `fmt`'d in Task 4. ✅
- **Placeholder scan:** all steps carry concrete code/commands. ✅

UI authoring (store/Inspector/Timeline/Stage/keyboard/e2e) is **Plan B**.
