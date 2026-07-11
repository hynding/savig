# Shape Builder — Design

**Date:** 2026-07-11 · **Status:** Approved (program roadmap #7; decisions documented per pre-approved
autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

A Shape Builder mode: with 2–6 overlapping vector shapes selected, the planar arrangement's atomic
REGIONS highlight on hover; **click a region → union just that region's contributing shapes**;
**alt-click a region → punch it out of every contributor** (per-operand difference). Incremental —
multiple gestures per session; Escape exits.

## Decisions (with rationale)

1. **Mode, not tool:** transient store flag `shapeBuilder: { ids: string[] } | null` (frozen
   operand snapshot at entry — the `correspondenceEditing` precedent, not `editPath`; no nesting/
   breadcrumb needed). Enter via command `path.shapeBuilder` ("Shape Builder", gated by
   `canShapeBuilder`) + Inspector button beside the boolean row (multi-select panel). Exit: Escape
   (new branch in keymap.ts's special-cased Escape block — the established multi-effect-exit
   pattern), the command again (toggle), or automatically when fewer than 2 frozen operands remain
   after a merge. Selection is left alone during the mode; gestures target the frozen ids.
2. **Eligibility `canShapeBuilder`:** 2..6 selected PLAIN VECTOR LEAVES — new predicate, NOT
   `eligibleForBool` (which admits groups/SVG as blob operands, hiding per-shape provenance).
   Excluded (each silently ineligible): groups, instances, svg/text, `obj.boolean` results,
   boolean OPERANDS, `shapeTrack` (morph), `repeat` (copies would visually overlap regions that
   the base-geometry decomposition ignores — confusing), `isLockedInTree`.
3. **Region decomposition (engine `geom/regions.ts`):**
   `decomposeRegions(polys: PcPolygon[]): Region[]` where
   `Region = { rings: PathData[]; contributors: number[]; bbox: Box }`. For each non-empty subset
   signature S of the N operands (≤63 at N=6): region_S = intersection(polys in S) −
   union(polys not in S), via the low-level `pc` binding; empty results dropped. Input polygons
   from `objectToWorldPolygon(project, obj, time)` (flattened — hover chrome doesn't need curve
   fidelity; COMMITS run the real provenance-aware engine `booleanOp`, keeping result quality).
   Cached in a Stage `useMemo` keyed on `[project, shapeBuilder.ids, time]` — never per
   pointermove (live-boolean per-frame precedent makes ≤63 one-time clips comfortably cheap).
4. **Hover hit-test:** new pure `pointInRings(rings: PathData[], p: PathPoint): boolean` (even-odd
   ray cast) in `packages/interaction` (pathHitTest's functional-utility pattern); Stage
   pointermove sets `hoveredRegion: number | null` React state (onion-skin precedent — pointermove
   rate, not raf rate). Regions render as translucent fills (operand-ghost styling precedent:
   evenodd, stopPropagation onPointerDown), hovered region emphasized.
5. **Gestures & commits (one undo step each):**
   - Click region_S: new store action `shapeBuilderMerge(contributorIds)` — engine
     `booleanOp(project, objs, 'union', time)` on JUST the contributors (the engine fn takes
     explicit objects — the selection-hardwired groupSymbolSlice action is bypassed), then the
     destructive post-processing (style-from-topmost, bbox shift, remove contributors, append) —
     FACTOR the shared post-processing out of groupSymbolSlice's booleanOp into a helper both use
     (keep its tests green unmodified). The merged object's id replaces its contributors in the
     frozen `shapeBuilder.ids`; single-contributor regions (S of size 1) are inert on click (no-op
     — nothing to merge).
   - Alt-click region_S: `shapeBuilderPunch(regionRings, contributorIds)` — for EACH contributor:
     `pc.difference(contributorPoly, regionPoly)` → write back as the contributor's new
     path/compoundRings (multi-object single commit; a contributor left empty is REMOVED).
     Punching drops each affected contributor's `shapeTrack`-adjacent fields? — none exist
     (morph excluded at entry); primitive-detach applies (path replaced); trim/dashOffsetTrack
     dropped with the scissors info toast (re-parameterization).
   - Both actions bake at the CURRENT playhead time (mirror the destructive boolean's time
     semantics — verify at implementation).
6. **Overlay chrome:** while active, the frozen operands render normally; regions overlay above
   them (`pointerEvents: 'all'` paths, translucent hover fill, stroke on the hovered region);
   other stage interactions suppressed (the mode's pointer handlers run before tool branches —
   an early-exit in both Stage press handlers, scissors precedent). A small floating hint
   ("click = merge, alt-click = punch, Esc = done") mirrors whatever passive hint UI exists
   (check GettingStarted/status affordances; else a simple corner text element in the Stage).
7. **No DSL/MCP** (interactive mode; agents compose the same results from existing boolean
   builders). No model changes beyond nothing — punch/merge emit plain vector assets.
8. **Out of scope:** drag-across-regions multi-merge; curve-fidelity region OUTLINES for hover
   (flattened is fine); groups/SVG operands; N>6; punch semantics on stroke-only shapes'
   painted strokes (regions are FILL geometry — stroke-only shapes contribute their fill outline
   region only if closed; open stroked paths are ineligible: add "closed fillable path" to the
   eligibility — a shape must have a closed primary ring to participate).

## Testing

- Engine unit (`regions.test.ts`): two overlapping squares → 3 regions with correct contributor
  sets and areas; three-circle-ish (use offset squares) → 7 regions; disjoint shapes → N regions,
  no intersections; subset math pinned by area sums (union area = Σ region areas within epsilon).
- Interaction unit: `pointInRings` even-odd incl. hole (point in hole → false), boundary epsilon.
- Store unit: canShapeBuilder gates (each exclusion); enter/exit lifecycle (toggle, Escape via
  keymap — unit where testable, auto-exit under 2 ids); merge action (subset union, ids list
  update, style-from-topmost, one commit/undo, groupSymbolSlice booleanOp tests UNMODIFIED green
  after the post-processing factor-out); punch action (per-contributor difference write-back,
  empty-contributor removal, trim/dash drop + toast, primitive-detach, single commit).
- Stage/component: decomposition memo keying; hover state on synthetic pointermove; click routes
  to merge with the hovered region's contributors; alt-click routes to punch; Escape exits.
- E2E (`e2e/shape-builder.spec.ts`): draw two overlapping rects → enter Shape Builder (Inspector
  button) → click the overlap region → ONE object remains (union of the two — count 1), undo →
  back to two + mode still active or cleanly exited (pin actual); re-enter, alt-click overlap →
  both rects remain but their `d`s changed (punch), undo restores. Full gates + @portable.
