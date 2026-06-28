# Animated Boolean — Slice 1: Live-Boolean Geometry — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Area:** Savig M4 — boolean follow-ups (animated boolean milestone, slice 1 of N)
**Scope:** Live-boolean geometry rendered + animated in the EDITOR (scrub + RAF playback), root-scene only, NO authoring UI, NO standalone-export markup

## Milestone context

Today a boolean is **destructive**: `booleanOp` samples its operands at the current time,
clips, bakes a static `VectorAsset` (path + compoundRings), creates a result object, and
removes the operands (slice 46). An **animated boolean** is non-destructive: the result keeps
live references to its operands, and its geometry is **recomputed every frame** by re-clipping
them, so animating an operand animates the boolean.

Decomposed into independent spec→plan→build slices:

- **Slice 1 (this doc):** live-boolean data model + per-frame geometry, rendered and animated
  in the **editor** (scrub via React render + RAF playback via `computeFrame`). Proven
  programmatically. No authoring UI; no standalone-export initial markup.
- **Slice 2:** authoring — a "create animated boolean" store action + UI; operands kept and
  selectable; undo.
- **Slice 3:** standalone export + polish — make `renderSvgDocument` (the exported initial
  markup) boolean-aware (emit the boolean `<path fill-rule="evenodd">` so the runtime's
  `computeFrame` can drive its `d`); verify exported animation + measure the bundle; plus
  editing-operand ergonomics, nested booleans, boolean-inside-symbol, performance.

### The forced architectural decision (resolved here, not deferred)

Editor playback paints frames imperatively via `applyFrameToNodes(nodes, computeFrame(project,
time))` (`src/ui/playback/applyFrame.ts`), driven by `usePlayback`'s RAF loop. So a live
boolean MUST be computed inside `computeFrame` or it would freeze during playback (animating
only on scrub). `computeFrame` is the shared runtime function, so **the runtime bundle gains
`polygon-clipping`** (currently zero). This also rules out the "bake the boolean into shape
keyframes at export, keep the runtime clipper-free" alternative — baking cannot drive live
editor playback. There is therefore one viable architecture: **`computeFrame` computes the
boolean live; the runtime ships the clipper.** The bundle delta is an accepted cost (measured
in Slice 3).

**Ordering constraint:** Slice 1's operand-skip lands in the shared `flattenInstances` and the
boolean compute lands in the shared `computeFrame`, but the standalone-export INITIAL markup
(`renderSvgDocument`) is NOT yet boolean-aware (Slice 3). So a standalone `.savig` export
containing a live boolean would render operands-skipped + the boolean's initial `<path>`
missing/un-evenodd until Slice 3. Invisible in Slice 1 (no authoring UI to create one), but
**Slice 3 must ship before Slice 2's authoring is exposed to users.**

## Goal (Slice 1)

A `SceneObject` carrying a `boolean` field renders, in the editor canvas, as the live boolean
of its operand objects at the current playhead — updating as the playhead scrubs, as the RAF
playback advances, and as an operand animates. Constructed programmatically; no UI yet.

### Non-goals (Slice 1)

- No authoring UI / store action (Slice 2).
- No standalone-export initial markup (`renderSvgDocument`) change (Slice 3). (The runtime's
  `computeFrame` IS changed — that is required for editor playback — but the exported initial
  document markup is not, so a full standalone export isn't complete until Slice 3.)
- No boolean-inside-a-symbol (root scene only).
- The boolean node renders **world-space geometry under an identity transform**; giving it a
  movable transform/anchor is deferred.

## Architecture

The live boolean reuses morph's pattern exactly. Morph makes a path dynamic via a field on the
object (`shapeTrack`), and its per-frame `d` is computed in **two** places that already
coexist: the Stage's React render (static + scrub, Stage.tsx:1888) AND `computeFrame` (RAF
playback + export, frame.ts:63). A live boolean adds a field (`boolean`) and the same dual
computation, both routed through one shared resolver so they never drift.

### Data model

`src/engine/types.ts` — add to `SceneObject`:

```ts
/** When present, this object is a LIVE boolean node: its rendered path is computed every
 *  frame by clipping `operandIds` (root-scene object ids) with `op`. The object's VectorAsset
 *  supplies paint only; its `path` is an unused fallback. (Animated-boolean slice 1.) */
boolean?: { op: BoolOp; operandIds: string[] };
```

`BoolOp` is the existing `'union' | 'subtract' | 'intersect' | 'exclude'` from
`engine/geom/boolean.ts` (re-exported via the engine index).

### Shared geometry resolver

`src/engine/geom/boolean.ts` — a thin helper over the existing `booleanOp`:

```ts
/** The live boolean's result rings for `booleanObj` at `time`: resolve its operand objects
 *  from `project.objects` (root scene) by id, then clip via `booleanOp`. [] when fewer than
 *  two operands resolve (degenerate → caller renders nothing). */
export function resolveBooleanRings(project: Project, booleanObj: SceneObject, time: number): PathData[] {
  const spec = booleanObj.boolean;
  if (!spec) return [];
  const operands = spec.operandIds
    .map((id) => project.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o);
  if (operands.length < 2) return [];
  return booleanOp(project, operands, spec.op, time);
}
```

`booleanOp` returns world-space `PathData[]` rings (primary + holes/disjoint) at `time`,
parent-chain-aware. Operand semantics (which is subtracted, etc.) are governed by **zOrder**,
exactly as the destructive op — `operandIds` order is irrelevant. One compound `d` is built
from the rings via `pathToDRings(rings[0], rings.slice(1))` with `fill-rule="evenodd"`.

### Operand non-render (shared `flattenInstances`)

`src/engine/symbol.ts` `flattenInstances` — precompute the consumed-operand set and skip those
objects with one gate beside the existing `isRenderHidden` check (symbol.ts:107-109):

```ts
// once, at function top:
const consumed = new Set(project.objects.flatMap((o) => o.boolean?.operandIds ?? []));
// in the walk loop, beside the isRenderHidden gate:
if (consumed.has(o.id)) continue; // a live boolean's operand: sampled for the clip, not drawn directly
```

Operands remain in the scene (animate, selectable); just not emitted as their own leaves. Pure
set-membership — no clipping here, no extra bundle weight from this gate. (Computed from root
`project.objects`; symbol-internal booleans are out of scope.)

### `computeFrame` boolean branch (RAF playback + export-render)

`src/runtime/frame.ts` `computeFrame` — for a leaf whose object has `.boolean`, set
`item.pathD` from the boolean rings at `leaf.localTime` instead of the morph/static `pathD`:

```ts
if (obj.boolean) {
  const rings = resolveBooleanRings(project, obj, leaf.localTime);
  item.pathD = rings.length > 0 ? pathToDRings(rings[0], rings.slice(1)) : '';
} else if (state.path) {
  item.pathD = pathToD(state.path);
}
```

`applyFrameToNodes` (frame.ts:126-128) writes `item.pathD` to the leaf's `<path>` `d`. This is
what makes the boolean animate during RAF playback and what the runtime uses. (`frame.ts` must
add `pathToDRings` and `resolveBooleanRings` to its imports — it currently imports only
`pathToD`.) The boolean node's `<path>` must carry `fill-rule="evenodd"` — set by the editor's
React render (below) for Slice 1; the standalone-export markup gains it in Slice 3.
`computeFrame`'s anchor/bounds for a boolean object derive from its fallback `asset.path` (the
boolean rings bypass that path) — harmless under the identity transform of a Slice-1 boolean node.

**Generated runtime bundle.** Because `frame.ts` now imports `resolveBooleanRings` →
`booleanOp` → `polygon-clipping`, the generated runtime bundle (`src/runtime/runtimeSource.generated.ts`,
embedded into standalone `.savig` exports by `exportProject.ts`) must be **regenerated** via
`pnpm build:runtime` and committed — this realizes the "runtime ships the clipper" decision and
keeps source/generated in sync. Existing non-boolean exports are unaffected (the clipper is dead
code for them); the bundle simply grows. (Editor playback imports `computeFrame` from the
`frame.ts` source directly, so it does not depend on the regenerated bundle — but regenerating
keeps the two from diverging.)

### Stage React-render boolean branch (static + scrub)

`src/ui/components/Stage/Stage.tsx` — the path-object branch (Stage.tsx:1885-1900) computes
`<path d>` from morph or static asset. Add a live-boolean branch first, using the same scene
`project` (Stage.tsx:127 `flattenInstances(project, time)`) and the shared resolver:

```tsx
const boolRings = o.boolean ? resolveBooleanRings(project, o, time) : null;
// ...
<path
  d={
    boolRings
      ? (boolRings.length > 0 ? pathToDRings(boolRings[0], boolRings.slice(1)) : '')
      : o.shapeTrack && o.shapeTrack.length > 0
        ? pathToD(samplePath(o.shapeTrack, time))
        : asset.path
          ? pathToDRings(asset.path, asset.compoundRings)
          : ''
  }
  fillRule={
    boolRings ? 'evenodd' : asset.compoundRings && asset.compoundRings.length > 0 ? 'evenodd' : undefined
  }
  // fill/stroke/etc. unchanged (from asset.style)
/>
```

The boolean object needs a path-typed `VectorAsset` for `asset.style` and to enter the
`asset.shapeType === 'path'` branch (Slice 1 fixtures provide one). Because the rings are
world-space and the boolean node's transform is identity (Slice 1 fixture), the path renders at
artboard coords; the leaf `<g>` carries the object's transform (identity → no offset).

## Edge cases

- **< 2 operands resolve** (missing/deleted id) → `resolveBooleanRings` → `[]` → empty `d`; no throw.
- **Empty/degenerate clip** (e.g. non-overlapping intersect) → `[]` → empty `d`.
- **Hidden operand** → skipped as a leaf anyway; still contributes to the clip (operands are
  inputs). Acceptable for Slice 1.
- **Operand shared by two booleans** → both clip it; in `consumed` once; not drawn. Fine.
- **Non-boolean objects** → `o.boolean` absent → today's render path, byte-identical (parity).

## Files touched

- `src/engine/types.ts` — `SceneObject.boolean?` field.
- `src/engine/geom/boolean.ts` — `resolveBooleanRings(project, booleanObj, time)`.
- `src/engine/geom/boolean.test.ts` — unit tests for `resolveBooleanRings`.
- `src/engine/symbol.ts` — operand-skip gate in `flattenInstances`.
- `src/engine/symbol.test.ts` — operands not emitted as leaves.
- `src/runtime/frame.ts` — `computeFrame` boolean `pathD` branch (add `pathToDRings` +
  `resolveBooleanRings` imports).
- `src/runtime/frame.test.ts` — `computeFrame` boolean `pathD` per-frame test.
- `src/runtime/runtimeSource.generated.ts` — **regenerated** by `pnpm build:runtime` (now
  includes `polygon-clipping`); committed.
- `src/ui/components/Stage/Stage.tsx` — Stage React live-boolean path branch.
- `src/ui/components/Stage/Stage.test.tsx` — RTL: scrub changes the boolean `d`; operands
  render no node of their own.

## Testing

- **Unit (`resolveBooleanRings`):** root-scene project with two overlapping rects + a boolean
  object (`{ op: 'union', operandIds: [a, b] }`); animate operand `b`'s `x` across two
  keyframes; assert the result rings differ between `time=0` and `time=1`. And `< 2` operands → `[]`.
- **Unit (`flattenInstances`):** boolean + its two operands → flattened leaves include the
  boolean's leaf but NOT the operands'; a non-operand sibling still appears.
- **Unit (`computeFrame`):** the boolean leaf's `item.pathD` is the boolean compound `d` at the
  frame's time, and differs across two times as an operand animates (mirrors the morph `pathD`
  test in `frame.test.ts`).
- **RTL (Stage):** render a Stage with a live boolean over an animated operand; read the boolean
  object's `<path>` `d` at `time=0`, seek to a later time, assert `d` changed; assert no
  `[data-savig-object]` node exists for the operand ids.
- **Build/parity:** run `pnpm build:runtime` to regenerate the bundle, then `pnpm vitest run
  src/services/export/exportProject.test.ts` to confirm non-boolean export is unaffected by the
  larger runtime. (A standalone export that actually renders a boolean is a Slice-3 deliverable —
  the regenerated runtime can compute the boolean `d`, but the exported initial markup is not yet
  boolean-aware.)

## Open / deferred (later slices)

- Authoring UI + store action + undo (Slice 2).
- Standalone-export initial markup (`renderSvgDocument`) boolean-awareness + bundle measurement
  (Slice 3) — must precede authoring exposure (ordering constraint above).
- The boolean node's own movable transform/anchor (currently identity + world-space path).
- Boolean-inside-a-symbol (nested scene + remapped time).
- Editing-operand ergonomics, nested booleans, per-frame clip caching (performance).
