# Savig M2 Slice 32 — Rounded polygon / star corners

**Date:** 2026-06-21
**Status:** Approved (autonomous slice cycle — true-M2-polish program 2/5)
**Depends on:** Slice 6 (primitives), Slice 31 (curve-tight bounds — so a rounded path's bbox is correct)

## 1. Goal

Add a **corner radius** tool option for the polygon and star tools so a stamped
primitive can have rounded corners. The radius fillets each corner with a true
circular-arc cubic. This completes the "rounded corners" theme (rect `cornerRadius`
already ships as an animatable geometry property; this adds the polygon/star half).

## 2. Approach (consistent with the primitive architecture)

Primitives are **path-emitting stamp tools** (Slice 6): `polygonPath`/`starPath`
generate corner-node `PathData`, baked into a `shapeType:'path'` object. Rounding is
a creation-time **tool option** (like `starInnerRatio`) baked into the path — NOT a
stored parametric property. A rounded star therefore inherits node-edit / morph /
color / export for free, with **zero** data-model, persistence, render, runtime, or
migration change (v4). (Making the radius re-editable after creation is Slice 35,
parametric re-editing.)

## 3. The fillet math (`roundCorners`)

`roundCorners(path, radius)`: rounds every vertex of a CLOSED corner-node path (no
pre-existing handles). For vertex `V` with previous `P` and next `N`:

- `u = unit(P − V)`, `w = unit(N − V)`; `lenP=|P−V|`, `lenN=|N−V|`.
- interior angle `θ = acos(clamp(u·w, −1, 1))`.
- tangent inset `t = min(radius / tan(θ/2), 0.5·lenP, 0.5·lenN)` — the half-edge clamp
  stops adjacent fillets overlapping.
- effective radius `R_eff = t · tan(θ/2)`; turn angle `α = π − θ`.
- cubic handle length `h = (4/3) · R_eff · tan(α/4)` (the exact circular-arc kappa;
  for a 90° corner this is the classic `h ≈ 0.5523·R`).
- tangent points `A = V + u·t`, `B = V + w·t`; handles point back toward `V`:
  `A.out = −u·h`, `B.in = −w·h`. The corner becomes the cubic `A → B`; the segment
  from the previous corner's `B` to this `A` is the straight edge.

Replace each `V` with `[A, B]` (traversal order preserved) → a closed path with `2n`
nodes. Guards: `radius ≤ 0` or `nodes < 3` → return path unchanged; per-vertex, if
`t < EPS` (collinear/degenerate) keep the single sharp node (no coincident dupes).

The construction is angle-agnostic, so a star's reflex (inner) vertices round
*concavely* — the natural rounded-star look.

## 4. Scope (YAGNI)

**In:** `roundCorners` pure helper; optional `cornerRadius` param on
`polygonPath`/`starPath`; a `primitiveCornerRadius` tool-option (store + clamped
setter); thread it through `primitivePathFromDrag`; a corner-radius field in
`PrimitiveOptions` (polygon + star); preview + e2e.

**Out:** rounding the LINE tool (open 2-node); per-corner independent radii; making
the radius re-editable post-stamp (Slice 35); rounding arbitrary hand-drawn paths
(the helper assumes corner nodes — only polygon/star call it this slice).

**Editor/authoring-only:** no runtime bundle regen (the runtime renders the baked
path; `roundCorners` runs only at stamp time). No persistence/migration (v4).

## 5. Implementation surface

- `src/engine/primitives.ts` — add `roundCorners(path, radius)`; `polygonPath`/`starPath`
  gain `cornerRadius = 0` and apply it when `> 0`. Barrel re-export `roundCorners`.
- `src/ui/store/store.ts` — `primitiveCornerRadius: number` (default 0) +
  `setPrimitiveCornerRadius(n)` clamped `≥ 0`; in `TRANSIENT`? No — it's a tool option
  like `starInnerRatio` (lives alongside, survives newProject the same way they do).
- `src/ui/components/Stage/drawGeometry.ts` — `PrimitiveDrawOpts.cornerRadius`; pass to
  the polygon/star generators.
- `src/ui/components/Stage/Stage.tsx` — both `primitivePathFromDrag` calls pass
  `cornerRadius: s.primitiveCornerRadius`.
- `src/ui/components/Toolbar/PrimitiveOptions.tsx` — a "Corner radius" NumberField shown
  for the polygon and star tools.

## 6. Testing

**Pure (`primitives.test.ts`):**
- `roundCorners` of an axis-aligned 100×100 square, `radius=20`: corner `(0,0)` →
  `A=(0,20)` with `out=(0,−h)`, `B=(20,0)` with `in=(−h,0)`, `h=(4/3)·20·tan(π/8)`;
  result has 8 nodes, closed.
- `radius=0` (or `≤0`) → identical to the sharp path (regression).
- Over-large radius clamps `t` to the half-edge (no overlap; `t=50` for the square).
- A star path rounds its inner (reflex) vertices too (node count `= 2·2·points`).
- `polygonPath(..., cornerRadius>0)` emits a curved path (some node has a handle);
  `cornerRadius=0` is byte-identical to today.

**Stage draw (`drawGeometry.test.ts`):** `primitivePathFromDrag('polygon', …, {cornerRadius})`
returns a path whose `pathToD` contains a `C` command.

**UI (`PrimitiveOptions.test.tsx`):** the corner-radius field renders for polygon/star
and calls `setPrimitiveCornerRadius`.

**e2e (`rounded-polygon.spec.ts`):** set corner radius > 0, stamp a polygon, export →
the exported path `d` contains `C` (rounded), discriminating from a sharp stamp.

## 7. Risks

- **bbox correctness:** a rounded corner bulges slightly past its tangent points;
  Slice 31's curve-tight `pathBounds` already accounts for the cubic extent, so
  selection/pivot stay correct.
- **degenerate corners:** collinear/zero-length edges guarded (`t<EPS` keeps sharp);
  `tan(θ/2)` guarded by the half-edge clamp (θ→0 ⇒ clamp dominates).
