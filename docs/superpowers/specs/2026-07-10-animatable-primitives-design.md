# Animatable Polygon/Star Parameters — Design

**Date:** 2026-07-10 · **Status:** Approved (program roadmap #2; decisions documented per pre-approved
autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

Make a stamped polygon/star's parameters keyframable — `sides` (polygon), `starPoints` +
`innerRatio` (star), `primitiveRotation` (both), and corner rounding via the existing
`cornerRadius` property — so a star can grow points or spin its geometry over time, regenerating
its path per frame.

## Decisions (with rationale)

1. **Param keyframes live in the generic `obj.tracks`** under new `AnimatableProperty` members
   `'sides' | 'starPoints' | 'innerRatio' | 'primitiveRotation'`, plus REUSING the existing
   `'cornerRadius'` member for corner rounding (same semantic as rect corner rounding; a path
   object never consumes it via `geometryToSvgAttrs`, so there is no collision). Rationale: the
   scalar-track machinery is already fully generic (store `setProperty`/`applyObjectTransform`,
   timeline `scalarTracks` rows, duration's `obj.tracks` loop, DSL `ShortAnimate`, MCP
   `set_keyframe`, `validate.ts`) — a dedicated field would force re-mirroring every keyframe op
   for zero benefit. New members are additive-safe for old projects.
2. **A new `PRIMITIVE_PROPERTIES` list** in `packages/engine/src/project.ts` (the four new
   members). `ANIMATABLE_PROPERTIES`/`GEOMETRY_PROPERTIES` are untouched; `sample.ts` gains a
   third, primitive-specific resolution step. `primitiveRotation` is a distinct name from the
   transform `rotation` track (different concept: vertex placement vs object transform); its
   track value is in DEGREES (UI consistency) and converts to radians onto `spec.rotation`.
3. **Regeneration happens inside `sampleObject`, which gains an optional third parameter**:
   `sampleObject(obj, time, primitive?: PrimitiveSpec)`. When `primitive` is provided AND at
   least one primitive-param track is non-empty AND there is no `shapeTrack` (morph wins —
   matching the existing else-if priority; boolean continues to win above both at the consumer
   layer), the sampled params override the spec's base values and
   `state.path = primitivePathFromSpec(overriddenSpec)`. Absent tracks → parameter falls back to
   the spec base → and with NO primitive track at all the path is NOT regenerated (byte-identical
   parity; `state.path` stays unset).
   - Sampled-value hygiene at regeneration: `sides` round-to-int ≥3, `starPoints` round-to-int
     ≥2, `innerRatio` clamp [0.01, 0.99], `cornerRadius` ≥0 — same clamps `setPrimitiveParam`
     applies at write time (interpolation can still produce out-of-range intermediates).
   - Callers updated to pass the spec: `computeFrame` (runtime/frame.ts — has `assetsById`),
     `renderDocument.renderLeaf` (has `asset`), Stage's `sampledObj` call, and
     `resolveObjectAnchor` (packages/interaction/src/snapping.ts:132 — has the project). Plus the
     one NON-generic path consumer: `Stage.tsx renderOneleaf`'s `d` computation must read the
     regenerated path (extend its existing shapeTrack branch to use `sampledObj.path` — the
     explorer confirmed it currently bypasses `state.path`; unify it rather than adding a third
     fork, so morph and primitives share the branch).
4. **Runtime-bundle consequence accepted:** regeneration pulls `primitives.ts`
   (`polygonPath`/`starPath`/`roundCorners`/`primitivePathFromSpec`, ~150 dependency-free lines)
   into the runtime bundle. The `roundCorners` docstring's "runtime never calls this" claim is
   AMENDED in the same commit, and `runtimeSource.generated.ts` is regenerated in the SAME commit
   as the `sample.ts` change (trim-path lesson).
5. **Inspector**: the existing Primitive section's inputs become autoKey-aware: autoKey ON →
   upsert a keyframe in `obj.tracks[<mapped prop>]` (mapping: sides→`sides`, points→`starPoints`,
   innerRatio→`innerRatio`, cornerRadius→`cornerRadius`) at the frame-snapped playhead, preserving
   an existing keyframe's easing (the dash/trim precedent); autoKey OFF → today's direct
   asset-spec overwrite (`setPrimitiveParam` behavior unchanged). A new `rotation` row is added to
   the Primitive section (`primitiveRotation`, degrees), same autoKey duality (OFF → writes
   `spec.rotation`, which today has NO edit surface at all). Kind-mismatch guards and clamps stay.
6. **Detach also strips primitive tracks:** `setPathData`'s primitive-detach
   (`primitive: undefined`) now also removes the five primitive-param keys from `obj.tracks`
   (orphaned tracks would be inert for rendering but would keep inflating
   `computeProjectDuration` — the dash-clearing precedent).
7. **Timeline/DSL/MCP/duration: no code changes needed** (all generic over `obj.tracks`), but each
   gets a test pinning the new members flowing through (timeline row appears; DSL round-trip;
   `set_keyframe` with `property: 'starPoints'`; duration extends).
8. **Out of scope:** animating `cx/cy/radius` (covered by transform x/y/scale tracks); stamping
   defaults (PrimitiveOptions.tsx untouched); morphing INTO/out of primitives; per-vertex easing.

## Model summary

No new model fields. New `AnimatableProperty` members (additive), new `PRIMITIVE_PROPERTIES`
const, `sampleObject` optional `primitive` param, and behavior changes in `setPrimitiveParam`
(autoKey duality) + `setPathData` (track strip).

## Testing

- Engine unit: regeneration parity (no primitive tracks → `state.path` unset, byte-identical);
  sampled overrides per param incl. clamps/rounding on interpolated values; shapeTrack-wins
  priority; `primitiveRotation` degree→radian; duration via tracks (generic loop) pins a
  primitive track extending it.
- Store unit: autoKey ON keyframes (easing preserved) vs OFF spec-overwrite for each param incl.
  the new rotation row's mapping; kind-mismatch no-ops; detach strips the five track keys;
  in-symbol scope.
- Runtime unit: `computeFrame` emits regenerated `pathD` at t (star points 5→7 case) and nothing
  without tracks.
- VM/component: Inspector primitive inputs commit through the autoKey path; timeline shows a
  `starPoints` row automatically.
- E2E (`e2e/animatable-primitives.spec.ts`): stamp a star, autoKey ON, keyframe `points` 5 at t0
  and 8 at t1, scrub → the stage path `d` changes between t0/t1 (assert `d` at t0 ≠ d at t1 and
  node-count grows); export bundle animates (reuse the stroke-dash runtime-drive pattern if cheap,
  else rely on the runtime unit test).
- `@portable` parity spec must stay green (Svelte renders via shared runtime).
