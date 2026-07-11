# Blend — Design

**Date:** 2026-07-11 · **Status:** Approved (program roadmap #9, LAST; decisions documented per
pre-approved autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

Illustrator-style blend: with exactly two vector paths selected, generate `n` intermediate objects
whose geometry, paint, stroke width, and opacity interpolate from A to B, with optional easing.
Static generation v1 — the command CREATES n plain objects at the current playhead; no live link.

## Decisions (with rationale)

1. **No model changes.** Blend emits plain vector `path` assets + objects (shape-builder Decision 7
   precedent). No new SceneObject/Asset fields; nothing for the runtime or exporters to learn.
2. **Pure engine core, dual consumers** (computeOutlineStrokeEffect precedent):
   `computeBlendSteps(project, objA, objB, opts): BlendStep[] | null` in a NEW
   `packages/engine/src/blend.ts`, where `opts = { count: number; easing?: Easing; time?: number }`
   and `BlendStep = { path: PathData; style: VectorStyle; opacity: number }` (path in SCOPE-WORLD
   coordinates; the callers normalize/plumb). Called by the store action AND the `core/build.ts`
   DSL builder — geometry logic never duplicated. Returns null when either object is ineligible
   (callers toast/throw).
3. **World-space interpolation** (the critical frame decision): A and B's `PathData.nodes` live in
   different local spaces with different transforms. Blending raw local nodes is silently wrong
   whenever transforms differ. So: sample each object at the playhead (`sampleObject`), map each
   path's nodes through its FULL composed chain into active-scope world space (anchors via
   `mapPoint`; in/out handles are offsets → `world(anchor+offset) − world(anchor)`, the proven
   resolveTextPath affine identity), interpolate the world paths, and bake. Intermediates carry
   identity rotation/scale — appearance interpolates exactly; transform animation on A/B is baked
   at the playhead (destructive-boolean time semantics).
4. **Correspondence** (reuse, don't invent): equal node counts →
   `reconcile(aW, bW, 'corresponded', suggestCorrespondence(aW, bW))` (rotation/winding-minimizing
   pairing, handle-preserving `lerpNode`); unequal counts → `reconcile(aW, bW, 'resampled')`
   (64-point arc-length resample + `align`, the established cross-shape morph quality bar; loses
   bezier handles — documented). `closed` is held from A (reconcile precedent). Step t for
   intermediate i of n = `applyEasing(easing ?? 'linear', i/(n+1))` — endpoints excluded (A and B
   already exist). `lerpNode`/`lerpPoint` in path.ts are private → EXPORT them (file already in the
   runtime bundle via samplePath; regen-and-diff same commit).
5. **Style interpolation:** per paint slot (fill, stroke): solid↔solid → `interpolateColor`;
   gradient↔gradient → `interpolateGradient`; ANY kind mismatch (solid↔gradient, none↔paint,
   linear↔radial handled inside interpolateGradient) → STEP holding A until t ≥ 1 (the
   interpolateGradient type-mismatch precedent — one rule, no novel midpoint behavior).
   `strokeWidth` numeric lerp. Sampled `opacity` lerps into each intermediate's `base.opacity`.
   Dash/trim/textPath/effects are NOT copied — intermediates are fresh plain assets,
   `primitive: undefined` (primitive-detach precedent).
6. **Eligibility `canBlend`:** EXACTLY 2 selected, each passing a new `isBlendEligible`
   (store-internals, beside isShapeBuilderEligible): vector asset with `shapeType === 'path'` and
   non-empty `asset.path`; no `compoundRings` (morph machinery is single-ring; cutPath/outline
   "release compound shapes" precedent); no `shapeTrack` (structural-op precedent); no `repeat`;
   not `obj.boolean` result or operand; not group/instance/svg/text; **not `isLockedInTree`
   (checked FIRST — mutating-action rule)**. Grouped leaves ARE allowed (world mapping is
   parent-chain-aware); intermediates land at the scope ROOT.
7. **Ordering & placement:** A = the lower-zOrder operand, B = the higher (deterministic,
   selection-click-order independent; booleanOp's z-based convention). Intermediates append via
   `nextZOrder` in A→B order, named `Blend 1..n`; paths normalized to a local-origin bbox with
   `anchorMode: 'fraction'` (applyBooleanResult/addVectorOutline normalization precedent). ONE
   commit (duplicateSelected loop-accumulate template + the cutSelectedPathAt two-step
   scope-then-assets composition); created objects selected after. A and B are left untouched.
8. **Store + command + UI:** `blendSelected(count: number, easing?: Easing)` store action
   (active-scene routed via withSceneObjects; gates toast). Command `path.blend` ("Blend",
   category Path, `when: canBlend`, hint "Select 2 vector paths") runs with
   DEFAULTS (count 3, linear — palette commands carry no args; the Inspector button is the
   parameterized surface). Inspector multi-select panel (exactly-2 case): count NumberField
   (aria-label `blend steps`, min 1, default 3, local state — distribute-spacing precedent),
   easing `<select>` (aria-label `blend easing`; linear/easeIn/easeOut/easeInOut), "Blend" button
   (aria-label exact `Blend`); `canBlend` computed in inspectorViewModel via the SAME predicate as
   the registry (no drift).
9. **DSL + MCP:** `blendPaths(project, aId, bId, count, opts?: { easing?: EasingName }):
   { project, ids: string[] }` in core/build.ts (fails loud per file contract; deterministic ids
   when… ids are generated — return them). MCP tool `blend`
   (`inputSchema: obj({ aId: str, bId: str, count: num, easing: str? }, ['aId','bId','count'])`,
   withScene + edited wrapper — outline_stroke registration precedent).
10. **Runtime bundle:** blend.ts is editor-only — imported ONLY by editor-state/store.ts and
    core/build.ts, NEVER by runtime/src (tree-shaken out of the IIFE; verified pattern:
    duplicateObject/decomposeRegions). It reuses already-bundled reconcile/resample/align, so the
    only bundle-affecting change is the path.ts export keyword → regen-and-diff verdict required.
11. **Out of scope:** live-linked blend (re-generate on source edit); blend along a spine path;
    compound-ring interpolation; solid↔gradient geometric morph; per-node easing; replace/insert
    zOrder weaving; rect/ellipse sources (path only); count editing after the fact (undo + re-blend).

## Testing

- Engine unit (blend.test.ts): equal-count blend — hand-computed midpoint nodes incl. handle lerp
  and the world-transform bake (A translated/rotated vs B); unequal counts → resampled 64-node
  intermediates, arc-length spacing spot-checked; easing shifts t (easeIn midpoint ≠ linear
  midpoint); style lerp (solid hex midpoint, gradient stop lerp, mismatch steps holding A,
  strokeWidth/opacity lerp); count 1 and count 5 lengths; null on each ineligibility; closed held
  from A; transform-animated source baked at `time`.
- Store unit: gates (lock FIRST, each exclusion, wrong selection count); one commit/undo restores;
  n objects appended at scope root with fraction anchors + names + zOrder; selection = created
  ids; in-symbol scope routing; A/B by zOrder not selection order.
- Predicates/registry: canBlend exactly-2 + eligibility; command availability + run.
- VM/component: inspectorViewModel canBlend; Inspector exactly-2 panel renders count/easing/button;
  button dispatches with the field values; disabled when ineligible.
- DSL: blendPaths round-trip (project in → project + n ids out; throws on dangling/ineligible).
  MCP: blend tool creates n objects in the session scene.
- E2E (`e2e/blend.spec.ts`): draw two separated rects-as-paths (pen or line tool per house style),
  select both, set steps=3, Blend → object count +3, middle intermediate visually between (assert
  its `d`/position differs from both sources); undo → count restored. Full gates + @portable.
