# Shape Tween — Slice 1 (engine bake + editor)

Spec: `specs/2026-11-13-shape-tween-design.md`.

## Tasks

1. **Model.** `FrameKey.tween?: ShapeTween` (`{ kind: 'shape'; easing?; created? }`) in engine
   `types.ts`. `setFrameKeyLabel` keeps other key fields. No format bump; services
   `sanitizeTweens.ts` (chained last in `migrate.ts`) drops a malformed marker.
2. **Engine `frameTween.ts`.**
   - `tweenableDrawing` and `layerLocalPath` (rect with optional rounded corners, ellipse as
     kappa cubics, path; mapped through the drawing's own transform).
   - `bakeShapeTween`: pairs drawings by zOrder; unpartnered drawings shrink into, or grow out
     of, their centre; colour tracks only for differing solid colours; opacity track only when
     the opacities differ; re-bake is remove-then-bake.
   - `freezeTweenedDrawing`, `removeShapeTween`, `rebakeLayerTweens` (last key first).
3. **Store (`frameLayerSlice`).**
   - `createShapeTween(easing?)` and `removeShapeTween()` act on the key spanning the playhead.
     Each is one commit. Orphaned drawing assets are pruned. A refusal shows a toast.
   - F5, Shift+F5, F7, Shift+F6 and key moves call `withRebakedTweens`. F6 inside a tween
     freezes the copies at the playhead and marks the new key tweened.
4. **UI.**
   - Commands `anim.createShapeTween` and `anim.removeShapeTween` (predicate
     `hasShapeTweenAtPlayhead`).
   - Timeline VM `key.tween`. FrameStrip: `data-tween="shape"` band in `--color-tween` with an
     arrow, plus menu items Create/Update/Remove Shape Tween.
   - Inspector group VM `shapeTween`, shown as a row with Create, or easing, Update and Remove.
5. **Tests.**
   - engine `frameTween.test.ts`
   - services `sanitizeTweens.test.ts` and `export/shapeTween.test.ts` (runtime `d` and fill
     per frame, SMIL `d`)
   - editor-state `store.shapeTween.test.ts`
   - ui-core `viewmodels/shapeTween.test.ts`
   - e2e `shape-tween.spec.ts`

## Verification

Full `pnpm test` (3,577 passing), `tsc --noEmit`, `pnpm lint`, full Playwright (183 passing).
