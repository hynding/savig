# Bitmap import — slice 1 plan (model + render + export)

Spec: `specs/2026-11-15-bitmap-import-design.md`.

- [x] types `ImageAsset`, `BoxAsset`, `SceneObject.guide`; engine `isBoxAsset`, `isGuideInTree`.
- [x] `flattenInstances(..., { guides })` skips guides by default; `computeFrame` includes them;
      `resolveMaskTarget` ignores a guide mask.
- [x] `defineSymbol` handles image assets (nested `<svg>` + `<image>`), re-checking the URL;
      renderDocument and Stage `buildDefs` treat image assets as box assets.
- [x] Stage: guide leaves drawn; rotate/scale handle boxes, snapping and `addObject` anchor cover
      images.
- [x] Format v12 + `sanitizeImages` (data URL allow-list, repair not drop, guide flag).
- [x] Runtime bundle regenerated.
- [x] Tests: export structure, unsafe URL, runtime, SMIL/CSS, guides absent from every export but
      kept in metadata, guide never masks, resvg raster, Stage, sanitizer + migration.
