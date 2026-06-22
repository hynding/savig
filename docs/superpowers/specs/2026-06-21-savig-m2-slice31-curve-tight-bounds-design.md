# Savig M2 Slice 31 — Curve-tight `pathBounds`

**Date:** 2026-06-21
**Status:** Approved (autonomous slice cycle — true-M2-polish program 1/5)
**Depends on:** Slice 2 (PathData + `pathBounds`), Slice 3 (morph)

## 1. Goal

Make `pathBounds` return the **visual** bounding box of a `PathData` — including the
extent of cubic bezier segments — instead of the current **anchor-extent** box. A
curve that bulges past its anchor points currently reports a too-tight box, which
mis-places everything derived from it.

## 2. Why (call sites that benefit)

`pathBounds` is the single bbox oracle for paths. It feeds:

- `resolveAnchor` (the fractional-anchor **pivot**) — Stage preview AND
  `runtime/frame.ts` / `renderDocument.ts` export. (Parity oracle — see §6.)
- `shapeLocalBBox` → gradient `objectBoundingBox` handle placement
  (`engine/gradientHandles.ts`).
- The Stage **selection bbox** / scale-handle frame for path objects.
- `store.ts` path-normalization bbox.

For STRAIGHT-edged paths (polygons, stars, lines, primitives, pen paths with no
handles) curve-tight bounds are **identical** to anchor-extent bounds, so those are
byte-identical. Only paths with bezier handles (pen curves, brush strokes) change —
to the correct, tighter box.

## 3. The math

A path is a sequence of segments mirroring `pathToD`'s `segment()` rule: a segment
`prev → cur` is a **cubic** when `prev.out || cur.in`, else a straight `L`. For a
closed path with `last.out || first.in`, the closing `last → first` segment is also
cubic.

- Every **anchor** is always included (covers all straight segments + cubic endpoints).
- For each **cubic** segment with `P0=prev.anchor`, `C1=prev.anchor+prev.out`,
  `C2=cur.anchor+cur.in`, `P3=cur.anchor`, add the axis **extrema**:

  `B(t) = (1−t)³P0 + 3(1−t)²t·C1 + 3(1−t)t²·C2 + t³P3`. Solve `B'(t)=0` per axis.
  With `d0=C1−P0`, `d1=C2−C1`, `d2=P3−C2`, the per-axis quadratic is
  `a·t² + b·t + c = 0` where `a = d0 − 2d1 + d2`, `b = 2(d1 − d0)`, `c = d0`.
  Keep real roots with `0 < t < 1`, evaluate `B(t)` on that axis, fold into the box.
  Degenerate `a≈0` → linear root `t = −c/b` (guard `b≈0`). Endpoints handled by the
  anchor pass, so only interior roots matter.

Empty path → `{x:0,y:0,width:0,height:0}` (unchanged).

## 4. Scope (YAGNI)

**In:** rewrite `pathBounds` in `src/engine/path.ts` to be curve-tight; a pure
`cubicAxisExtrema(p0,c1,c2,p3)` helper (or inline). Regenerate the runtime bundle.

**Out:** stroke-width / miter expansion (geometric path only); arc/quadratic
segments (PathData has none — all cubic or line); caching/memoization.

No data-model, persistence, or migration change (v4). Pure-function semantics only.

## 5. Implementation surface

- `src/engine/path.ts` — replace the `pathBounds` body; add the cubic-extrema helper.
- `src/engine/path.test.ts` — extend (anchor-extent cases stay; add curved cases).
- Runtime bundle: `pnpm build:runtime` regenerates
  `src/runtime/runtimeSource.generated.ts` (pathBounds is reachable from the runtime).

No call site changes — every consumer transparently gets the tighter box.

## 6. Parity & risk

- **Preview == export preserved by construction:** the same `pathBounds` runs in the
  Stage and the runtime/export. The existing `computeFrame` parity test continues to
  guard it. Bundle regen is mechanical.
- **Pivot shift for curved paths:** a curved rotating/scaling path now pivots about
  its visual-box center rather than its anchor-box center — an improvement; there is
  no persisted pivot, so loading old projects just recomputes (no migration). Straight
  shapes unchanged.
- **Numerical:** clamp roots to the open interval; guard `a≈0`/`b≈0`; `EPS = 1e-9`.

## 7. Testing

Pure unit (`path.test.ts`):
- Anchor-extent cases UNCHANGED (no-handle path → same box as before; empty → zero box).
- A single cubic that bulges right/down past its anchors → box extends to the bezier
  extremum (known-answer: symmetric handles giving a computed max). Verify against the
  closed-form `B(t*)`.
- A handle pulling LEFT/UP past the start anchor → min extends correctly.
- Closed path whose curved closing segment bulges → included.
- A straight (`L`-only) polygon → identical to anchor extent (regression guard).

Engine parity: the existing `computeFrame === pathToD(samplePath)` / pivot parity
tests stay green (run the full suite + `pnpm build` + e2e).
