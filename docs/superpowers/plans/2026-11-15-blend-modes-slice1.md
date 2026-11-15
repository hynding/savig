# Blend modes — slice 1 plan

Spec: `specs/2026-11-15-blend-modes-design.md`.

1. Engine: `BlendMode` type, `SceneObject.blendMode`, `BLEND_MODES`, `isBlendMode`, `blendWrapId`,
   `WrapRef` blend kind emitted by `ownWrapChain` (outermost per node); `flattenInstances` keeps the
   chain when a filter or blend is present.
2. Services: `WrapperStack` writes `<g style="mix-blend-mode:…">`; `sanitizeBlend` in the load chain.
3. Stage: blend runs render as `<g style={{mixBlendMode}}>` (`data-testid blend-group-<id>`).
4. Editor: `setBlendMode` store verb; Inspector VM `BLEND_MODE_OPTIONS`, group `blendMode`,
   `setBlendMode` intent; Blend dropdown on objects and groups.
5. Tests: leaf model, export (groups, symbols, animated SVG), sanitizer, resvg raster, store,
   Inspector VM, e2e `blend-modes.spec.ts`.
