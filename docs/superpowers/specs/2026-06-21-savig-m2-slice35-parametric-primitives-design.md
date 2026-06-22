# Savig M2 Slice 35 — Parametric primitive re-editing

**Date:** 2026-06-21
**Status:** Approved (autonomous slice cycle — true-M2-polish program 5/5, LAST)
**Depends on:** Slice 6 (primitives), Slice 32 (rounded corners), Slice 2 (paths/node edit)

## 1. Goal

Make a stamped **polygon/star** re-editable after creation: change its sides /
points / inner ratio / corner radius from the Inspector and the path regenerates in
place (centre stays put). Completes the "primitives are baked paths" tradeoff from
Slice 6 — now they carry an optional parametric spec until you node-edit them.

## 2. Approach

Primitives are still **paths** (Slice 6), so they keep node-edit / morph / color /
export / persistence for free. We additionally store an optional `primitive` spec on
the vector ASSET capturing the local-frame generation parameters. When present, the
Inspector exposes the params and editing one **regenerates** the asset's `path` from
the spec; **node-editing detaches** the spec (it becomes a free path).

The runtime/export are unaffected — they render the baked `path`; the spec is editor
metadata that is serialized into `.savig` (generic) and ignored by the runtime.

### Local-frame trick (centre stays put)

`addVectorPath` normalizes a stamped path so its bbox-min is at local origin and puts
the offset in the object's `x/y`. The spec stores the centre/radius/rotation **in that
normalized local frame**: `cx = stageCx − box.x`, `cy = stageCy − box.y`, `radius`,
`rotation`. Regenerating with new params at the SAME `(cx, cy, radius, rotation)` keeps
the shape centred on the same point (`base + (cx,cy) = stageCx`); only the silhouette
changes. The bbox-derived pivot recomputes to the new visual centre (as today).

## 3. Data

```ts
export interface PrimitiveSpec {
  kind: 'polygon' | 'star';
  cx: number; cy: number; radius: number; rotation: number; // LOCAL frame
  sides?: number;       // polygon (>=3)
  points?: number;      // star (>=2)
  innerRatio?: number;  // star (0..1)
  cornerRadius: number; // >=0 (slice 32)
}
// VectorAsset gains:  primitive?: PrimitiveSpec;
```

`primitivePathFromSpec(spec)` (pure, engine): polygon → `polygonPath(cx,cy,radius,
sides,rotation,cornerRadius)`; star → `starPath(cx,cy,radius,radius*innerRatio,points,
rotation,cornerRadius)`.

## 4. Scope (YAGNI)

**In:** `PrimitiveSpec` on VectorAsset; `primitivePathFromSpec`; store `addPrimitive`
(stamp polygon/star WITH a spec) + `setPrimitiveParam(param, value)` (re-edit +
regenerate) + detach-on-node-edit; Stage routes polygon/star stamps to `addPrimitive`;
Inspector "Primitive" param section; persistence round-trip.

**Out (deferred, tracked):** parametric LINE/rect/ellipse (rect already has geometry
tracks; line is trivial); animating the params; re-attaching after a node edit;
dragging an on-canvas radius/rotation handle for the spec; star tip-rounding distinct
from corner-rounding.

**Editor + persistence only:** NO runtime/export change, NO bundle regen. Additive
optional field → generic serialize, NO migration/version bump (stays v4).

## 5. Implementation surface

- `src/engine/types.ts`: `PrimitiveSpec`; `VectorAsset.primitive?`.
- `src/engine/primitives.ts`: `primitivePathFromSpec(spec)`.
- `src/ui/store/store.ts`:
  - `addPrimitive(stageSpec)` — generate the stage path, normalize like `addVectorPath`,
    store `asset.primitive` with the LOCAL-frame centre, select + node tool.
  - `setPrimitiveParam(param, value)` — selected object's asset; if `asset.primitive`,
    clamp + update the param, `asset.path = primitivePathFromSpec(next)`, commit.
  - `setPathData` (node edit on a static path) clears `asset.primitive` (detach).
- `src/ui/components/Stage/drawGeometry.ts`: `primitiveSpecFromDrag(tool, start, end,
  opts, minSize)` → stage-frame `PrimitiveSpec`-ish (kind/cx/cy/radius/rotation/params)
  or null (mirrors `primitivePathFromDrag`).
- `src/ui/components/Stage/Stage.tsx`: the onUp commit for `polygon`/`star` calls
  `addPrimitive` (line still uses `addVectorPath`). The drag PREVIEW is unchanged
  (`primitivePathFromDrag`).
- `src/ui/components/Inspector/Inspector.tsx`: when the selected object's asset has
  `primitive`, render a "Primitive" section with sides/points/innerRatio/cornerRadius
  fields bound to `setPrimitiveParam`.

## 6. Testing

**Pure (`primitives.test.ts`):** `primitivePathFromSpec` for a polygon spec == direct
`polygonPath(...)`; for a star == `starPath(...)`; rounded variant carries handles.

**Store (`store.test.ts`):**
- `addPrimitive` creates a path object whose asset has a `primitive` spec; the path
  equals the normalized generated path; object positioned at the bbox.
- `setPrimitiveParam('sides', 7)` on a parametric polygon regenerates the path (node
  count reflects 7) and keeps the centre (the sampled centre is ~unchanged).
- `setPrimitiveParam('cornerRadius', >0)` adds handles.
- node-edit (`setPathData`) on a parametric primitive clears `asset.primitive` (detach);
  a subsequent `setPrimitiveParam` is a no-op.
- a non-parametric path object (`addVectorPath`) has no `primitive`; `setPrimitiveParam`
  is a no-op.

**Persistence (`persist`/`migrate` test or store round-trip):** save → load a project
with a parametric primitive preserves `asset.primitive` (no version bump).

**UI (`Inspector.test.tsx`):** the Primitive section renders for a parametric object and
editing "Points" calls `setPrimitiveParam`.

**e2e (`parametric-primitive.spec.ts`):** stamp a star, change Points in the Inspector,
assert the on-canvas path `d` changes (more vertices) and the object stays put; (and
the rounded corner field still works).

## 7. Risks

- **Detach correctness:** only structural node edits should detach. `setPathData` is the
  single node-edit entry — clearing `primitive` there covers move/insert/delete/corner.
  A param edit must NOT route through `setPathData` (it sets `asset.path` directly).
- **Odd-sided bbox vs circumcentre:** the spec centre is the circumcentre; the pivot is
  the bbox centre — a small, pre-existing offset (unchanged behavior).
- **Persistence:** confirm the loader doesn't reject the new optional field (generic
  JSON); add the round-trip test.
