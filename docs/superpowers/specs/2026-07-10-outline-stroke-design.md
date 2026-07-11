# Outline Stroke — Design

**Date:** 2026-07-10 · **Status:** Approved (program roadmap #5; decisions documented per pre-approved
autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

One-shot destructive command: convert a stroked vector shape's stroke INK into the shape — the
object's path becomes the filled outline region (open path → ribbon; closed path → annulus with a
hole ring), fill = the old stroke paint, stroke cleared. Unblocks curve-preserving-boolean-over-
strokes work and is the geometry engine feature 6 (tapered brush) reuses with a width profile.

## Decisions (with rationale)

1. **Engine module `packages/engine/src/geom/strokeOutline.ts`:**
   `outlineStroke(path: PathData, width: number | ((t: number) => number), cap: 'butt'|'round'|'square', join: 'miter'|'round'|'bevel'): PathData[]`
   — width accepts a function of normalized arc-length t∈[0,1] NOW (feature 6's taper hook; the
   command passes a constant). Returns flat rings (booleanOp's convention): `[outer, ...holes]`,
   caller assembles `{path: rings[0], compoundRings: rings.slice(1)}`.
2. **Algorithm (v1, flatten-based):** `flattenPath` the centerline (FLATTEN_STEPS density);
   per-point normals offset left/right by width(t)/2; ribbon polygon = left polyline + end cap +
   reversed right polyline + start cap; resolve self-overlaps (folds, tight corners) with ONE
   `pc.union` call on the single ribbon polygon — polygon-clipping (Martinez) natively resolves
   self-crossing rings via the NONZERO rule (documented lib behavior; the SceneObject-oriented
   `booleanOp()` wrapper requires ≥2 objects and is NOT used — mirror boolean.ts's low-level `pc`
   binding). Closed source paths: offset both sides into two independent rings (outer + inner),
   union delivers the annulus. Results are FACETED (corner nodes) like non-provenance boolean
   results today — documented quality bar; curve reconstruction (reconstructRing) over outline
   output is deferred.
3. **Caps: all three** (butt = straight chord; square = extend w/2 then chord; round = semicircle
   arc sampled at the flatten density). **Joins: round and bevel; `'miter'` FALLS BACK to bevel**
   with a code comment (SVG's own miter-limit fallback precedent; miter spike math with
   near-180° degeneracy is the highest-risk piece and adds no expressive power at v1). Dense
   flattening makes curved-segment joins moot — the join parameter matters only at hard corner
   nodes; 'round' inserts arc wedges there, 'bevel'/(fallback 'miter') take the natural
   offset-chord bevel the union produces.
4. **Store op `outlineStroke(): void`** — one-shot destructive on the selected object, one commit.
   Gates (toast + no commit, scissors conventions): non-vector target (rect/ellipse ARE allowed —
   their geometry converts via their path form... NO: rect/ellipse assets have no PathData; v1
   targets `shapeType === 'path'` ONLY, toast "Select a path to outline" for rect/ellipse — a
   follow-up can synthesize their outlines); no visible stroke (`stroke === 'none'` or
   `strokeWidth <= 0`); `shapeTrack` present (morph); existing `compoundRings` (pre-holed shapes —
   same ambiguity as scissors); `obj.boolean` (derived path); boolean OPERAND (scissors
   precedent); `isLockedInTree`. GROUPED paths are ALLOWED (identity preserved — no new object, no
   parentId issue).
   Effects (single commit):
   - Asset: `path = rings[0]`, `compoundRings = rings.slice(1)` (absent when none), style:
     `fill = old stroke`, `fillGradient = old strokeGradient` (carried — gradients are
     object-space, still meaningful; flag in tests), `stroke = 'none'`, `strokeWidth = 0`,
     linecap/linejoin/dasharray/dashoffset removed (byte-clean).
   - Object: DROP `trim`, `dashOffsetTrack`, `colorTracks` (both fill and stroke — old fill anim
     would repaint the new ink with the discarded fill; old stroke anim can't drive a fill track
     mapping in v1), `gradientTracks` — with the info toast
     `"Stroke/fill animation removed — converted to a filled shape."` fired only when any were
     present (cutPath precedent). Transform `tracks`/`motionPath`/`repeat` kept. Primitive-detach
     fires (path replaced — established rule).
   - **Anchor pinned absolute** at the pre-op resolved point (bbox grows by ~w/2 every direction;
     fraction re-derivation would shift the rotate/scale pivot — scissors reasoning verbatim).
   - Geometry lands in the SAME local space (offsets computed around the existing nodes — no
     re-normalization; base untouched) so the shape doesn't move.
5. **Command surface:** registry command `path.outlineStroke` ("Outline stroke", category Path or
   whatever boolean ops use, NO chord v1 — palette + Inspector button), predicate
   `canOutlineStroke` (single selected vector PATH leaf, visible stroke, none of the gate
   conditions); Inspector button beside the boolean row, `disabled={!canOutlineStroke}`,
   aria-label "Outline stroke".
6. **Agent surface:** core builder `outlineStrokePath(project, objectId)` mirroring the store
   effects (build.ts style) + MCP `outline_stroke` tool — cheap, one function reuse; DSL field NOT
   added (it's an operation, not a property).
7. **Out of scope:** rect/ellipse synthesis; dash-aware outlining (gaps as geometry); trimmed-
   stroke partial ribbons; live/non-destructive variant; curve reconstruction of outline results;
   miter spikes; retargeting stroke animation onto fill tracks.

## Testing

- Engine unit (`strokeOutline.test.ts`): straight 2-node line, width 10, butt → exact 4-corner
  rectangle (±1e-6 on bounds and area); square cap extends length by width; round cap adds arc
  points with correct extremal bound (length + w/2, |y|max = w/2); closed square → 2 rings
  (annulus: outer area > source, inner < source, opposite orientation per pc convention); folded
  hairpin centerline → union output has no self-intersections (validate ring simplicity via
  non-negative pc output + area sanity) and ONE outer ring; width FUNCTION (linear taper 10→2) →
  monotonically shrinking ribbon width sampled at 3 stations; join='round' at a hard 90° corner
  inserts arc points vs 'bevel' chord (point-count/bound difference); 'miter' === 'bevel' output.
- Store unit (`store.outline.test.ts`): every gate toasts + no commit; effects block (style
  swap incl. gradient carry, byte-clean removals, drops + info toast only-when-present, anchor
  pinning both anchorMode branches, primitive-detach, compoundRings assembly, same-local-space —
  bounds grow by w/2 around the ORIGINAL bounds); grouped path allowed; ONE commit/undo; in-symbol
  scope.
- MCP/builder tests per house style.
- E2E (`e2e/outline-stroke.spec.ts`): draw a line (stroked), Inspector "Outline stroke" button →
  the stage shape's `fill` equals the old stroke color, `stroke` none/absent, `d` present and
  closed (contains `Z`); undo restores. Full gates + @portable.
