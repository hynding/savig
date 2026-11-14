# CSS-only export — slice 1 plan (exporter + agent)

Spec: `specs/2026-11-14-css-export-design.md`.

- [x] services `export/sampling.ts`: sampling, per-object series, frame-layer visibility, scene /
      camera / dip series, document parse, metadata embed and dip overlay moved out of
      `animatedSvg.ts` (SMIL output byte-identical; its tests unchanged).
- [x] services `export/cssSvg.ts` `renderCssSvgDocument`: one `@keyframes` per animated property
      (held values pruned; `step-end` for discrete; instant switches inside linear tracks as a
      0.001% keyframe pair), per-element `savig-a<n>` class rule; transform / opacity /
      visibility / geometry / `d` / fill / stroke / dash / stop colour / text-path `d`; scenes as
      opacity, dip overlay as opacity + fill.
- [x] package export + vite/vitest aliases `@savig/services/export/cssSvg`.
- [x] core/node `renderCssSvgNode`; MCP `export_svg` `format: smil | css | static`.
- [x] Tests: `cssSvg.test.ts` (shared fixtures in `exportFixtures.testutil.ts`), MCP, e2e
      `css-svg-export.spec.ts` (CSS file seeked with Web Animations matches the SMIL file's CTM /
      opacity / bbox at 5 times; scene cut; `<img>`).
