# Art Tools Program — Roadmap

**Date:** 2026-07-10 · **Status:** Approved program; each feature gets its own spec → plan → implementation cycle
**Context:** follow-on to trim path (`568b7c1`). Nine tools from the approved recommendation set,
ordered by leverage, size, and shared machinery. One feature branch per tool; merge to main between
tools so every feature lands independently green.

## Order & rationale

| # | Feature | Size | Why here |
|---|---------|------|----------|
| 1 | Eyedropper + copy/paste style | S | Quick win; pure style-model + commands; no render changes |
| 2 | Animatable polygon/star parameters | M | Exercises the primitive→path regeneration seam the later geometry tools also touch |
| 3 | Repeater | L | Highest expressive payoff (Tier-1); builds on symbol/instance + flatten seams proven by 47c/trim |
| 4 | Scissors (cut path at point) | M | Node-tool depth; pure engine path op + one stage interaction |
| 5 | Outline stroke / offset path | M | Produces the offset/outline machinery feature 6 needs; leverages geom/boolean + boolean-curves |
| 6 | Tapered / variable-width brush | M | Centerline + width profile → filled outline, on feature 5's machinery + PointerEvent.pressure |
| 7 | Shape builder mode | M-L | Interactive click-regions-to-merge UI over the existing boolean engine |
| 8 | Text-on-path | M | Native `<textPath>`; TextAsset exists; placement mode + animatable startOffset |
| 9 | Blend tool | M | N intermediate shapes between two paths; reuses morph/resample interpolation |

**Excluded (per the approved recommendation):** wiggle/noise modifier — deferred past M6 because it
cannot export to CSS; building it now would ship an effect the next milestone can't carry.

## Per-feature scope sketches (refined in each feature's own spec)

1. **Eyedropper + copy/paste style** — "Copy style" captures the selected vector's `VectorStyle`
   (+gradients) into a module-level style clipboard; "Paste style" applies to selection via the
   existing `setVectorStyle` seam (autoKey-aware where fields are animatable). Stage eyedropper
   mode: click any object to adopt its fill/stroke; native `EyeDropper` API (Chromium) for
   arbitrary-pixel picking where available, feature-detected. Commands + shortcuts via the
   ui-core registry.
2. **Animatable polygon/star params** — `PrimitiveSpec` (sides/points/innerRatio/rotation/radius)
   is authoring-static today (baked path; node-editing detaches it). Add per-object
   `primitiveTracks` on the ONE remap-safe seam: sample params per frame → regenerate the path via
   the existing generators (`primitives.ts`) inside sample/computeFrame, mirroring how `shapeTrack`
   supplies a per-frame path. Absent = parity. `roundCorners` reuse for rounded animated stars.
3. **Repeater** — `repeat?: { count, offset: Transform2D-delta, stagger }` on SceneObject;
   expansion inside the shared `flattenInstances` walker (the proven parity seam) so preview,
   export, raster, and both apps inherit it; per-copy time offset = stagger (reuses the
   remapLocalTime idea). Inspector section + timeline-able count.
4. **Scissors** — engine `cutPathAt(path, segIndex, t)` (splits a node list into two open paths /
   opens a closed one); node-tool click-on-segment interaction; store op creating the second
   object; compound rings out of scope v1.
5. **Outline stroke** — engine `outlineStroke(path, width, cap, join)` producing filled PathData
   (flattened, boolean-machinery quality bar, same as booleanOp results); store action replacing
   the object's path + clearing stroke; non-destructive variant deferred.
6. **Tapered brush** — brush tool gains a width profile (taper in/out %, pressure when
   `PointerEvent.pressure` present); `strokeToPath` centerline → outline via feature 5's machinery;
   stored as a filled path (v1 bakes on commit).
7. **Shape builder** — new stage mode over `resolveBooleanRings`/`operandWorldGeom`: hover
   highlights planar regions of the selection's arrangement; click merges, alt-click subtracts.
   v1 limits to ≤6 operands, vector leaves only (matches boolean eligibility).
8. **Text-on-path** — `TextAsset.pathObjectId?` or per-object binding rendering `<textPath>` with
   a `startOffsetTrack` (pathLength-normalized like trim); editor picker "attach text to path".
9. **Blend** — `blend(pathA, pathB, n, easing)` core builder + editor command producing n new
   objects; reuses `morph/resample` correspondence; static generation v1 (no live-linked blend).

## Program conventions

- Each feature: brainstorm decisions documented in its spec (user pre-approved proceeding without
  interactive gates), spec self-review, plan via writing-plans, subagent-driven execution with
  per-task review, final whole-branch review + fix wave, merge to local main. Push only on request.
- Parity invariant everywhere: absent field = byte-identical render; identity normalizes to absent.
- Every new render behavior routes through the shared seams (`flattenInstances`, `sampleObject`,
  `computeFrame`) — never app-local forks.
- Any change under `packages/runtime/src` regenerates `runtimeSource.generated.ts` in the SAME
  commit (trim-path lesson).
- Agent parity (DSL/MCP/macros) ships with each feature whose model changes (2, 3, 8, 9); pure
  editor ergonomics (1, 4, 7) skip the DSL layer unless a core builder falls out naturally.
