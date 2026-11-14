# Inverted and luminance masks — slice 2 plan (agent surfaces)

Spec: `specs/2026-11-14-mask-modes-design.md`.

- [x] core `MaskStyleOpts`; `createMask(..., style)`, `setMaskStyle`, `releaseMask` clears,
      `reveal({ invert })`.
- [x] DSL `maskType` / `maskInvert` (shapes and frames layers), decompile, fail loud on a bad type.
- [x] describe `MASK (not drawn, luminance, inverted) hides: …`.
- [x] validate `mask-style-not-mask`.
- [x] MCP `create_mask` / `reveal` options, `set_mask_style`.
- [x] Template `soft-spotlight`.
- [x] Tests: core masks (raster, DSL round trip, describe, validate, template), MCP.
