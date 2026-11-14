# Shape hints — slice 1 plan (engine + agent)

Spec: `specs/2026-11-14-shape-hints-design.md`.

- [x] types: `ShapeHint`, `ShapeTween.hints`.
- [x] engine `morph/hints.ts`: `closestArcLength`, `distanceToOutline`, LIS-based consistent cuts,
      `hintedPair` (closed/cyclic + open), `MAX_SHAPE_HINTS`. Tests in `hints.test.ts`.
- [x] `bakeShapeTween` takes `hints`, routes each hint to the nearest start drawing, uses the
      hinted pair; `rebakeLayerTweens` and the store's re-tween keep prior hints.
- [x] core `shapeTween` hints option (validated, `[]` clears); DSL `tween.hints` round trip;
      describe ` hints×N`.
- [x] MCP `shape_tween` `hints` schema and description.
- [x] `sanitizeTweens` keeps well-formed hints, caps at 26.
- [x] Full unit + tsc + lint + Playwright.
