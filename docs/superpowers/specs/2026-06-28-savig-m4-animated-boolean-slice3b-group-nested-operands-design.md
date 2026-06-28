# Animated Boolean — Slice 3b: Group + Nested-Boolean Operands — Design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)
**Area:** Savig M4 — boolean follow-ups (animated boolean milestone, slice 3b)
**Scope:** Let a live boolean take a GROUP or another LIVE BOOLEAN as an operand (render, animate, author, export)

## Milestone context

Slice 1 shipped live-boolean geometry (recomputed per frame, editor render + playback). Slice 2
shipped Alt-authoring. Slice 3a shipped standalone export. All three restricted operands to plain
**vector leaves**: the slice-2 author filter is `!isGroup && !o.boolean`, and the engine resolved
only leaf/group geometry (groups via the destructive `0fc9da0` path) — a live boolean as an operand
resolved to its empty fallback path (zero geometry), and a group operand's leaf children would
double-render. Slice 3b lifts both restrictions. (Later sub-slices: 3c editing-operand UX +
Alt-aware button-disabled state; 3d per-frame clip caching.)

## The gaps

1. **Nested boolean contributes nothing.** `operandWorldGeom` / `operandCubicsWorld` (boolean.ts)
   don't recurse into `obj.boolean`. A live boolean used as an operand has a path-typed asset whose
   `path` is the empty fallback, so it resolves to `[]` — the nested boolean's live geometry is lost.

2. **Group operand double-renders.** `booleanOp` already clips a group operand correctly (the
   `0fc9da0` destructive group-boolean: `operandWorldGeom` unions the group's vector leaves). But
   `flattenInstances`'s `consumed` set holds only the literal `operandIds`; a group operand's id is
   consumed (and groups never draw as leaves anyway), yet the group's **leaf children** are not in
   `consumed`, so they draw directly *and* feed the union — drawn twice.

3. **Authoring excludes both.** The slice-2 live branch filter `!isGroup && !o.boolean` rejects
   groups and live booleans as operands; `Inspector.canBool` mirrors destructive eligibility.

## Goal

A live boolean may take, as any of its operands, a **group** (treated as the union of its vector-leaf
descendants — matching the destructive group-boolean) or **another live boolean** (treated as that
boolean's own live result). Such a boolean renders, animates, authors via Alt, and exports exactly
like a leaf-operand boolean. Operand objects (a group's whole subtree, a nested boolean's subtree)
are render-hidden but still sampled for the clip.

### Non-goals (3b)

- **Curve preservation** for group / nested-boolean operands. These stay **faceted** (no cubic
  provenance), exactly as the destructive group-boolean already does (`0fc9da0`: "group pre-union
  loses provenance"). Leaf operands keep their slice-5 curve provenance.
- SVG-asset operands (still excluded).
- Editing-operand UX + render-time Alt-aware button-disabled state (3c).
- Per-frame clip caching (3d).
- Root-scene only (the slice 1/2/3a boundary).

## Architecture

The whole feature funnels through the single seam `resolveBooleanRings(project, booleanObj, time)`,
which `computeFrame` (frame.ts), `renderSvgDocument` (3a), and the Stage live branch/overlay all
call. Make that seam resolve group + nested operands and render/export/playback follow for free.

### The even-odd subtlety (why nested booleans resolve to a MultiPolygon, not rings)

A boolean's result is a flat `PathData[]` ring list whose holes are encoded by the **even-odd
fill-rule** at render time — NOT by polygon-with-holes nesting. Feeding those rings back into
polygon-clipping as separate positive polygons would FILL the holes (polygon-clipping unions them).
So a nested boolean operand must contribute its raw `PcMultiPolygon` (proper outer/hole structure),
captured **before** the flatten-to-rings step. This is the core engine change.

### Component 1: engine — `booleanResultGeom` extraction + nested resolution + cycle guard

`src/engine/geom/boolean.ts`.

**1a. Extract the multipolygon computation.** Today `booleanOp` builds `geoms`/`operands` in a loop,
runs `pc.union/intersection/xor/difference`, then reconstructs provenance ring-by-ring into
`PathData[]`. Split the pre-reconstruct half into a helper:

```ts
interface BooleanGeom { result: PcMultiPolygon; operands: OperandCubics[]; tol: number; }

// The raw clip result + provenance data, before flattening to PathData rings. null when fewer
// than two operands contribute geometry (degenerate).
function booleanResultGeom(
  project: Project,
  objs: SceneObject[],
  op: BoolOp,
  time: number,
  visited: Set<string>,
): BooleanGeom | null {
  // ... existing loop building `operands` + `geoms` (calls operandCubicsWorld / operandWorldGeom,
  //     the latter now threaded `visited`) ...
  if (geoms.length < 2) return null;
  // ... existing head/rest + pc.union|intersection|xor|difference -> `result` ...
  // ... existing tol computation ...
  return { result, operands, tol };
}
```

`booleanOp` becomes the helper call + the existing reconstruct tail (unchanged output, byte-identical
`PathData[]` for leaf/group cases):

```ts
export function booleanOp(
  project: Project, objs: SceneObject[], op: BoolOp, time: number, visited: Set<string> = new Set(),
): PathData[] {
  const g = booleanResultGeom(project, objs, op, time, visited);
  if (!g) return [];
  const { result, operands, tol } = g;
  const rings: PathData[] = [];
  for (const poly of result) {
    for (const ring of poly) {
      let pd: PathData | null = null;
      if (operands.length > 0) {
        try { pd = reconstructRing(ring, operands, tol); } catch { pd = null; }
      }
      const final = pd ?? ringToPathData(ring);
      if (final.nodes.length >= 3) rings.push(final);
    }
  }
  return rings;
}
```

**1b. Nested-boolean operand geometry.** New internal resolver returning the raw multipolygon:

```ts
// A live boolean operand's raw clip geometry (holes preserved as polygon nesting). [] when the
// boolean is degenerate or forms a cycle.
function resolveBooleanGeom(
  project: Project, booleanObj: SceneObject, time: number, visited: Set<string>,
): PcMultiPolygon {
  const spec = booleanObj.boolean;
  if (!spec) return [];
  if (visited.has(booleanObj.id)) return []; // cycle guard (A operand B, B operand A)
  const next = new Set(visited); next.add(booleanObj.id);
  const operands = spec.operandIds
    .map((id) => project.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o);
  if (operands.length < 2) return [];
  return booleanResultGeom(project, operands, spec.op, time, next)?.result ?? [];
}
```

`operandWorldGeom` gains a leading boolean branch; `operandCubicsWorld` gains an explicit guard:

```ts
export function operandCubicsWorld(project, obj, time): Cubic[] {
  if (obj.boolean) return []; // a nested boolean has no leaf cubics; resolve via operandWorldGeom
  if (obj.isGroup) return [];
  // ... unchanged ...
}

export function operandWorldGeom(project, obj, time, visited: Set<string> = new Set()): PcPolygon | PcMultiPolygon {
  if (obj.boolean) return resolveBooleanGeom(project, obj, time, visited); // nested live boolean
  if (!obj.isGroup) return objectToWorldPolygon(project, obj, time);       // leaf
  // ... unchanged group-union branch ...
}
```

**1c. Cycle guard on the public entry.** `resolveBooleanRings` threads `visited` and self-guards:

```ts
export function resolveBooleanRings(
  project: Project, booleanObj: SceneObject, time: number, visited: Set<string> = new Set(),
): PathData[] {
  const spec = booleanObj.boolean;
  if (!spec) return [];
  if (visited.has(booleanObj.id)) return [];        // cycle guard
  const next = new Set(visited); next.add(booleanObj.id);
  const operands = spec.operandIds
    .map((id) => project.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o);
  if (operands.length < 2) return [];
  return booleanOp(project, operands, spec.op, time, next);
}
```

The default-`new Set()` last param keeps every existing caller (computeFrame, renderSvgDocument,
Stage) byte-identical. Group operands resolve through the **unchanged** `operandWorldGeom` group
branch — Component 1 adds no new group code; groups already work in `booleanOp`.

### Component 2: scene walk — no double-render

`src/engine/symbol.ts`, `flattenInstances`. Expand `consumed` so a group operand's whole subtree is
render-hidden:

```ts
import { groupDescendantIds } from './groupTransform';
// ...
const consumed = new Set<string>();
for (const o of project.objects) {
  for (const id of o.boolean?.operandIds ?? []) {
    consumed.add(id);
    const operand = project.objects.find((x) => x.id === id);
    if (operand?.isGroup) {
      for (const d of groupDescendantIds(project.objects, id)) consumed.add(d);
    }
  }
}
```

A nested-boolean operand needs no special case: its id is an operandId of the parent (already added),
and its own operandIds are collected by the same loop across all boolean objects (with their group
subtrees expanded in turn).

### Component 3: authoring — relax the live-operand filter

`src/ui/store/store.ts`, the `booleanOp` live branch (slice 2). Replace the leaf-only filter so an
operand may be a vector leaf, a group with ≥1 vector-leaf descendant, or a live boolean — counting
only **geometry-contributing** operands toward the `≥2` gate:

- Helper `liveOperandHasGeom(o)`: `o.boolean` → true (a live boolean); `o.isGroup` → true iff it has
  a vector-leaf descendant (reuse the engine's `collectVectorLeaves` via a small exported
  `hasVectorLeafDescendant`, or `Inspector`'s existing `hasVectorLeaf`); else vector-leaf check.
- Live operands = selected top-level objects passing `liveOperandHasGeom`; require `≥2`; else the
  branch falls through (no-op for the live path, as today).
- **Style-from-topmost** becomes the topmost-zOrder **vector leaf reachable from the selection**
  (descend groups; for a boolean operand, descend its operands' leaves) — so a group/boolean operand
  still yields a concrete leaf style. Empty fallback path + identity transform + `Animated <Op> N`
  name + selection-order `operandIds` are unchanged.
- Creation is **cycle-safe by construction**: the new boolean object does not exist yet, so no
  existing operand chain can reference it. The engine cycle guard (Component 1c) is defense-in-depth
  against corrupt/edited data.

### Component 4: eligibility mirror — NO CHANGE NEEDED (verified)

`src/ui/components/Inspector/Inspector.tsx`, `canBool` / `hasVectorLeaf` (lines 181-189). Verified
against the code: `hasVectorLeaf(o)` returns true for a **group with a vector-leaf descendant**
(recursive) AND for a **live boolean** (a boolean's asset is a path-typed `VectorAsset`, so the
non-group branch `assets.find(assetId)?.kind === 'vector'` is already true). So `canBool` already
enables the buttons for `{group, leaf}`, `{boolean, leaf}`, `{group, boolean}`, etc. — it needs no
edit. The slice-2 quirk (the live path was *narrower* than `canBool` → an Alt+click could no-op)
**closes** in 3b: the relaxed live filter (Component 3) now makes the live path admit exactly the
same operands `canBool` already counts, so an enabled button always forms a live boolean.

### Component 5: export / computeFrame / Stage — free, confirmed by tests

`renderSvgDocument` (3a), `computeFrame` (frame.ts), and the Stage live branch/overlay all call
`resolveBooleanRings`. Once Component 1 resolves group/nested operands, all three produce correct
geometry with no code change. The spec adds confirming tests, not new code.

## Edge cases

- **Cycle (A operand B, B operand A):** `resolveBooleanGeom`/`resolveBooleanRings` return `[]` on a
  revisited boolean id → degenerate → empty render (3a placeholder on export). No infinite recursion.
- **Empty group operand** (group with no vector leaf): `operandWorldGeom` returns `[]` → contributes
  no geometry → if fewer than two operands contribute, `booleanResultGeom` returns `null` → `[]`.
  Authoring excludes it from the operand count via `liveOperandHasGeom`.
- **Nested boolean with a hole** fed as an operand: resolved as a `PcMultiPolygon` (outer + hole
  rings), so a further subtract/intersect sees the hole correctly (not filled).
- **Group containing a nested group:** `collectVectorLeaves` already recurses; `groupDescendantIds`
  already returns the full subtree.
- **Non-boolean / leaf-operand booleans:** unchanged — `operandWorldGeom`'s new branches don't fire,
  `consumed` expansion is a no-op when no operand is a group, default `visited` keeps signatures
  byte-compatible. Full parity.

## Files touched

- `src/engine/geom/boolean.ts` — extract `booleanResultGeom`; add `resolveBooleanGeom`;
  `operandWorldGeom` boolean branch + `visited`; `operandCubicsWorld` boolean guard;
  `resolveBooleanRings`/`booleanOp` thread `visited`. Maybe export `hasVectorLeafDescendant`.
- `src/engine/geom/boolean.test.ts` — nested-boolean + group operand resolution; cycle guard.
- `src/engine/symbol.ts` — `consumed` group-subtree expansion.
- `src/engine/symbol.test.ts` (or flatten test) — group operand leaves not drawn (no double-render).
- `src/ui/store/store.ts` — relaxed live-operand filter + style-leaf selection.
- `src/ui/store/*.test.ts` — author a live boolean from a group + from a nested boolean.
- `src/services/export/renderDocument.test.ts` — export a group-operand + nested-operand boolean.
- (Inspector.tsx — NO change; `canBool`/`hasVectorLeaf` already count groups + booleans, verified.)

## Testing

- **Engine (unit):**
  - A boolean whose operands are a leaf + a **group** (two-rect group) → result equals the leaf
    clipped against the union of the group's two rects (matches the destructive group-boolean).
  - A boolean whose operand is a **nested boolean** with a hole → the nested operand contributes a
    multipolygon-with-hole; a subtract using it leaves the hole open (≥2 `M` subpaths where expected).
  - **Cycle:** two booleans referencing each other → `resolveBooleanRings` returns `[]` (no hang).
  - `resolveBooleanRings` with a default (omitted) `visited` is unchanged for leaf operands (parity).
- **Scene walk (unit):** `flattenInstances` over a project with a group operand → none of the group's
  leaves appear as leaves (drawn once, via the boolean); a leaf-operand boolean is unchanged.
- **Authoring (unit):** the live branch creates a `SceneObject.boolean` from {group, leaf} and from
  {boolean, leaf}; `operandIds` in selection order; an empty group is excluded from the count.
- **Export (unit):** `renderSvgDocument` emits a non-empty evenodd `<path>` for a group-operand and a
  nested-operand boolean; the group's leaf children + the nested boolean's subtree are absent from
  the markup.
- **Parity:** existing boolean / export / flatten tests stay green (leaf operands unchanged).

## Open / deferred (later sub-slices)

- 3c: editing-operand UX (see/select the render-hidden operand subtree on canvas) + render-time
  Alt-aware button-disabled state (so an Alt+click that can't form a live boolean is visibly disabled).
- 3d: per-frame clip caching (only if profiling warrants).
- Curve preservation for group / nested operands (provenance through pre-union / nested results).
- SVG-asset operands.
