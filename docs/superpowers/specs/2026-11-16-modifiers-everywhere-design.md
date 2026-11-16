# Modifiers everywhere — design

Roadmap 7, item 1. Extends property modifiers (spec 2026-11-16-property-modifiers) from the
transform and geometry to every animatable channel, and to the camera.

## Model
`SceneObject.modifiers` is keyed by `ModifierTarget`:

| Target | Wiggle | Loop | Read by |
|---|---|---|---|
| x, y, scaleX, scaleY, rotation, opacity, width, height, radiusX, radiusY, cornerRadius | yes | yes | `sampleObject` (unchanged) |
| sides, starPoints, innerRatio, primitiveRotation | yes | yes | `sampleObject` primitive regeneration; a keyless wiggle rides on the spec's own value |
| textPathOffset | yes | yes | `resolveTextPath` |
| trimStart, trimEnd, trimOffset | yes | yes | `sampleObject` trim window |
| motionProgress | yes | yes | `sampleObject` motion path |
| `filter:<filterId>.<param>` | yes | yes | `sampleFilters` (wiggle added before the param clamp) |
| fill, stroke, fillGradient, strokeGradient, shape | no | yes | `sampleObject` (time remap only) |

`Camera.modifiers?: Partial<Record<CameraAxis, PropertyModifier>>` adds camera shake (wiggle) and
looping per axis, read by `sampleCamera`. The noise is salted `camera:<axis>`, so a camera x
wiggle differs from an object x wiggle with the same seed.

Absent = none, byte-identical output. All samplers go through `applyModifier` / `modifierTime`.

## Lifecycle
- Removing a filter (core `removeFilter`, store `removeFilter`) drops its modifiers.
- `setCamera` keeps modifiers.
- Load sanitizer keeps valid targets, drops a wiggle on a loop-only target, and cleans camera
  modifiers (root and per scene).
- `validateProject`: `modifier-invalid` (bad key, malformed, wiggle on loop-only),
  `modifier-target-missing` (filter / trim / motion path gone), `modifier-loop-no-keys` (object and
  camera).

## Surfaces
- Slice 1: engine, sanitizer, validate, describe (`Camera modifiers:` line), DSL (object keys and
  `camera.modifiers` round-trip; object modifiers compile after filters), core `setModifier` (wider
  keys) + `setCameraModifier`, MCP `set_modifier` (wider keys) + `set_camera_modifier`, export
  tests (camera shake and filter wiggle in raster + SMIL).
- Slice 2: Inspector "Add modifier" offers the new targets for the selection (trim, filters,
  primitive params, motion path, colors / gradients / shape as loop-only), timeline badge labels, e2e.
  The editor has no camera panel, so camera modifiers stay agent/DSL-authored.
