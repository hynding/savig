# Inverted and luminance masks — slice 1 plan

Spec: `specs/2026-11-14-mask-modes-design.md`.

- [x] types `maskType?: 'luminance'`, `maskInvert?: boolean`.
- [x] engine `maskStyleOf`, `maskDefParts`, `MASK_REGION`; `flattenInstances` sets `maskStyle` on
      mask-content leaves (inherited through symbol-instance masks).
- [x] export `buildMaskDefs` and Stage mask defs emit the same parts (inverted: `<id>-src` +
      white/black wrapper).
- [x] sanitizer keeps only `'luminance'` / `true`.
- [x] store `setMaskStyle`; `releaseMask` clears the style.
- [x] Inspector Mask type select + Invert checkbox ("hides N objects"); Layers badge label;
      commands `arrange.invertMask`, `arrange.lumaMask`.
- [x] Tests: export structure + parity + multi-scene + symbol mask, resvg raster (inverted,
      luminance black/white/grey, inverted luminance), sanitizer, store, VM, commands, e2e
      (Inspector invert swaps rendered pixels; luminance; undo).
