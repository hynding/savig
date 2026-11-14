# Shape hints — slice 2 plan (editor)

Spec: `specs/2026-11-14-shape-hints-design.md`.

- [x] engine: `keptHints`, `snapToOutline` (morph/hints), `shapeTweenOutlines`, `shapeHintStatus`
      (frameTween, sharing the bake's hint routing), `groupToWorld` (skin).
- [x] store: `setShapeHints(keyId, hints)` (re-bake, one undo step, `[]` clears), `addShapeHint`
      (golden-ratio spread round the first pair's outlines), `removeShapeHints`.
- [x] ui-core: `anim.addShapeHint` (Ctrl+Shift+H), `anim.removeShapeHints`; Inspector shape tween
      row gains a hint count, "+ Hint" and "Clear hints".
- [x] Stage `ShapeHintOverlay`: lettered markers on the tween's start key (a side, yellow) and on
      the next key's first frame (b side, green); red when the morph drops the hint. Drag →
      snap to the nearest outline on release → re-bake. Right-click deletes.
- [x] Re-bake stability: the hinted resample keeps each outline's vertices (sharpest first) by
      moving the nearest uniform slot onto them, so dragging hints never erodes corners.
- [x] Tests: engine, store, ui-core, e2e `shape-hints.spec.ts`; full unit + tsc + lint + Playwright.
