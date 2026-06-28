# Animated Boolean — Slice 3a: Standalone Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone `.savig` export emits a boolean-aware initial `<path fill-rule="evenodd" d="<time-0 clip>">` for a live boolean node (operands flatten-skipped), so the embedded runtime animates its `d` per frame — matching the editor.

**Architecture:** Mirror the existing morph empty-path export handling: `renderSvgDocument` computes the boolean's time-0 rings via the existing `resolveBooleanRings` and feeds them to `renderShapeToSvg`, which gains a `forceEvenOdd` flag so a boolean's `<path>` always carries evenodd (the runtime sets `d` per frame, never fill-rule). No runtime-bundle change.

**Tech Stack:** TypeScript (strict), Vitest. Export-time string rendering.

## Global Constraints

- Non-boolean objects export byte-identically to today (`obj.boolean` absent → existing branch; `forceEvenOdd` defaults falsy).
- No runtime-bundle change (the runtime already computes the boolean per frame — Slice 1).
- A boolean's `<path>` ALWAYS carries `fill-rule="evenodd"` (even if time-0 has no hole).
- A degenerate/empty boolean still emits a `<path fill-rule="evenodd" d="">` placeholder so the runtime can animate it.
- Operands are flatten-skipped (Slice 1) → absent from the export markup.
- Root-scene only.
- `renderSvgDocument` flattens at time 0 (`flattenInstances(project, 0)`), so use `resolveBooleanRings(project, obj, 0)`.

---

### Task 1: `renderShapeToSvg` — `forceEvenOdd` param

**Files:**
- Modify: `src/engine/renderShape.ts` (`renderShapeToSvg`, the `shapeType === 'path'` branch ~73-84)
- Test: `src/engine/renderShape.test.ts`

**Interfaces:**
- Produces: `renderShapeToSvg(shapeType, geometry, style, path?, idScope?, gradientPaint?, dashOffset?, compoundRings?, forceEvenOdd?: boolean): string`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/renderShape.test.ts
describe('renderShapeToSvg forceEvenOdd', () => {
  const tri = { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }] };
  const style = { fill: '#f00', stroke: 'none', strokeWidth: 0 };

  it('emits fill-rule="evenodd" when forced, even without compound rings', () => {
    const out = renderShapeToSvg('path', {}, style, tri, undefined, undefined, undefined, undefined, true);
    expect(out).toContain('fill-rule="evenodd"');
    expect(out).toContain('<path');
  });

  it('does NOT emit fill-rule without force and without compound rings (parity)', () => {
    const out = renderShapeToSvg('path', {}, style, tri, undefined, undefined, undefined, undefined, false);
    expect(out).not.toContain('fill-rule');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/renderShape.test.ts -t forceEvenOdd`
Expected: FAIL — the 9th arg is ignored (no fill-rule emitted when forced); or a type error (9-arg call vs 8-param signature).

- [ ] **Step 3: Implement**

In `src/engine/renderShape.ts`, add the param and force the fill-rule:

```ts
export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
  path?: PathData,
  idScope?: string,
  gradientPaint?: { fill?: boolean; stroke?: boolean },
  dashOffset?: number,
  compoundRings?: PathData[],
  forceEvenOdd?: boolean,
): string {
  if (shapeType === 'path') {
    if (!path || path.nodes.length === 0) return '';
    const hasRings = !!compoundRings && compoundRings.length > 0;
    const attrs: Record<string, string> = {
      d: hasRings ? pathToDRings(path, compoundRings) : pathToD(path),
      ...((forceEvenOdd || hasRings) ? { 'fill-rule': 'evenodd' } : {}),
      ...styleToSvgAttrs(style, idScope, gradientPaint, dashOffset),
    };
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(' ');
    return `<path ${attrStr}/>`;
  }
  // …rect/ellipse branch unchanged…
```

> Implementer: only the signature (new last param) and the fill-rule line (`(forceEvenOdd || hasRings)`) change; the `d` logic and the rect/ellipse branch are untouched.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run src/engine/renderShape.test.ts` then `pnpm typecheck`
Expected: pass (incl. existing renderShape tests — the new param is optional so existing 8-arg calls are unaffected); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/engine/renderShape.ts src/engine/renderShape.test.ts
git commit -m "feat(export): renderShapeToSvg forceEvenOdd param (always-evenodd for live booleans)"
```

---

### Task 2: `renderSvgDocument` — boolean-aware initial markup

**Files:**
- Modify: `src/services/export/renderDocument.ts` (path branch ~63-84)
- Test: `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `renderShapeToSvg(..., forceEvenOdd)` (Task 1), existing `resolveBooleanRings(project, booleanObj, time)`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/services/export/renderDocument.test.ts (reuse its createProject/createSceneObject/
// createVectorAsset imports)
describe('renderSvgDocument — live boolean', () => {
  function liveBoolProject(op: 'union' | 'subtract', smallInterior = false) {
    const aAsset = createVectorAsset('rect', { id: 'a-asset' });
    const bAsset = createVectorAsset('rect', { id: 'b-asset' });
    const boolAsset = createVectorAsset('path', { id: 'bool-asset', path: { nodes: [], closed: false } });
    const a = createSceneObject('a-asset', { id: 'opA', zOrder: 0, shapeBase: { width: 40, height: 40 } });
    const b = createSceneObject('b-asset', {
      id: 'opB', zOrder: 1, shapeBase: smallInterior ? { width: 10, height: 10 } : { width: 40, height: 40 },
      base: { x: smallInterior ? 15 : 20, y: smallInterior ? 15 : 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const boolObj = createSceneObject('bool-asset', { id: 'boolobj', zOrder: 2, boolean: { op, operandIds: ['opA', 'opB'] } });
    const project = createProject();
    project.assets = [aAsset, bAsset, boolAsset];
    project.objects = [a, b, boolObj];
    return project;
  }

  it('emits a boolean <path> with evenodd + non-empty d; operands are not in the markup', () => {
    const out = renderSvgDocument(liveBoolProject('union'));
    expect(out).toContain('data-savig-object="boolobj"');
    expect(out).toMatch(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*fill-rule="evenodd"/);
    expect(out).toMatch(/<path[^>]*\bd="M[^"]+"/); // the boolean path has a non-empty d
    expect(out).not.toContain('data-savig-object="opA"'); // operands flatten-skipped
    expect(out).not.toContain('data-savig-object="opB"');
  });

  it('a subtract with an interior operand emits a compound d (>=2 subpaths)', () => {
    const out = renderSvgDocument(liveBoolProject('subtract', true));
    const m = out.match(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*\bd="([^"]*)"/);
    expect(m).toBeTruthy();
    expect((m![1].match(/M/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('a degenerate boolean (non-overlapping intersect) emits an empty-d evenodd placeholder', () => {
    const aAsset = createVectorAsset('rect', { id: 'a2' });
    const bAsset = createVectorAsset('rect', { id: 'b2' });
    const boolAsset = createVectorAsset('path', { id: 'bool2', path: { nodes: [], closed: false } });
    const a = createSceneObject('a2', { id: 'opA', zOrder: 0, shapeBase: { width: 20, height: 20 } });
    const b = createSceneObject('b2', { id: 'opB', zOrder: 1, shapeBase: { width: 20, height: 20 }, base: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const boolObj = createSceneObject('bool2', { id: 'boolobj', zOrder: 2, boolean: { op: 'intersect', operandIds: ['opA', 'opB'] } });
    const project = createProject();
    project.assets = [aAsset, bAsset, boolAsset];
    project.objects = [a, b, boolObj];
    const out = renderSvgDocument(project);
    expect(out).toMatch(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*fill-rule="evenodd"[^>]*d=""/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts -t "live boolean"`
Expected: FAIL — the boolean object emits an empty `<g>` with no `<path>` (renderShapeToSvg returns `''` for the empty fallback path).

- [ ] **Step 3: Implement the boolean-aware path branch**

In `src/services/export/renderDocument.ts`, add `resolveBooleanRings` to the `../../engine` import, then rewrite the path branch (renderDocument.ts ~63-84):

```ts
        const boolRings = obj.boolean ? resolveBooleanRings(project, obj, 0) : null;
        const framePath = obj.boolean
          ? boolRings![0]
          : asset.shapeType === 'path' ? (state.path ?? asset.path) : undefined;
        const pathBox = framePath ? pathBounds(framePath) : undefined;
        const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
        const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
        let shape = renderShapeToSvg(
          asset.shapeType,
          state.geometry ?? {},
          asset.style,
          framePath,
          leaf.renderId,
          { fill: !!fillGrad, stroke: !!strokeGrad },
          state.strokeDashoffset,
          obj.boolean ? boolRings!.slice(1) : (asset.shapeType === 'path' ? asset.compoundRings : undefined),
          !!obj.boolean,
        );
        // A boolean (or morphed) path whose initial shape is empty still needs a <path> child so
        // the runtime can animate `d` once the clip is non-empty.
        if (!shape && asset.shapeType === 'path' && (obj.boolean || (obj.shapeTrack && obj.shapeTrack.length > 0))) {
          shape = obj.boolean ? '<path fill-rule="evenodd" d=""/>' : '<path d=""/>';
        }
        return `<g data-savig-object="${leaf.renderId}" transform="${transform}" opacity="${opacity}">${shape}</g>`;
```

> Implementer: this replaces the existing `framePath`/`shape`/fallback block. The only behavioral change for non-boolean objects is the added `!!obj.boolean` (false) and `boolRings` (null) — the `framePath`, `compoundRings`, and fallback all evaluate to their prior values, so non-boolean export is byte-identical.

- [ ] **Step 4: Run the test + full export suite**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts` then `pnpm vitest run src/services/export/ src/engine/renderShape.test.ts` then `pnpm typecheck`
Expected: the live-boolean tests pass; existing renderDocument / exportProject / buildBundle tests pass (non-boolean parity); typecheck clean.

- [ ] **Step 5: Full unit suite + lint**

Run: `pnpm test` then `pnpm exec eslint src/engine/renderShape.ts src/services/export/renderDocument.ts`
Expected: full suite green; lint clean on changed files.

- [ ] **Step 6: Commit**

```bash
git add src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(export): boolean-aware initial markup — exported live booleans render + animate"
```

---

## Self-Review

**Spec coverage:**
- `renderShapeToSvg` `forceEvenOdd` (always-evenodd for booleans) → Task 1. ✓
- `renderSvgDocument` boolean-aware path branch (time-0 rings → `<path>`) → Task 2. ✓
- Empty/degenerate boolean → `<path fill-rule="evenodd" d="">` placeholder → Task 2 (fallback + test). ✓
- Operands absent from export (flatten-skip) → Task 2 test. ✓
- Subtract-with-hole → compound d (≥2 subpaths) → Task 2 test. ✓
- Non-boolean parity (both functions) → Task 1 + Task 2 (additive args default to prior behavior) + existing suites. ✓
- No runtime-bundle change → neither task regenerates the bundle. ✓

**Placeholder scan:** No TBD/TODO. Test fixtures are complete inline; the renderDocument branch shows the full replacement block.

**Type consistency:** `renderShapeToSvg(..., forceEvenOdd?: boolean)` is defined in Task 1 and called with `!!obj.boolean` as the 9th arg in Task 2. `resolveBooleanRings(project, obj, 0): PathData[]` matches its Slice-1 signature. `boolRings![0]` / `boolRings!.slice(1)` rely on `boolRings` being non-null exactly when `obj.boolean` (the `?` guard).

## Notes / Risks
- `boolRings![0]` is `undefined` when the clip is degenerate → `framePath` undefined → `renderShapeToSvg` returns `''` → the fallback emits the evenodd placeholder. The `!` is safe because `boolRings` is non-null whenever `obj.boolean` is set.
- The boolean node renders under its identity transform with world-space geometry (Slice 1), so `pathBox`/anchor derive from the world-space `boolRings[0]` — consistent with the editor.
