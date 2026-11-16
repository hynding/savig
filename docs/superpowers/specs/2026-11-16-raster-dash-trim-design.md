# Dashed and trimmed strokes in raster exports — design

**Problem.** SaViG writes dashes, trim paths and text-on-path offsets in `pathLength`-normalized
units (0..1 of the path), with `pathLength="1"` on the element. Browsers honour that, so the editor
and the SVG/HTML/CSS exports are right. resvg (behind `renderFramePng`, `renderFrameRgba`, GIF,
thumbnails and the MCP `render_frame`) ignores `pathLength`, so a dash pattern of `0.25 0.25` is a
quarter-*pixel* pattern (a grey smear) and a trim never draws on.

**Fix.** `@savig/services/export/pathLength` → `resolvePathLengths(svgRoot)` rewrites a baked frame
to the absolute equivalent: for each element with `pathLength`, measure its real length in its own
user space (path `d` with every command incl. arcs, rect with rounded corners, ellipse, circle,
line, poly*), scale `stroke-dasharray`, `stroke-dashoffset` and any `<textPath startOffset>` that
references it by `length / pathLength`, then drop the attribute. That is the attribute's SVG meaning,
so the output renders identically in a browser.

- `core/node/render.ts` `renderFrameSvg` calls it after `applyProjectFrame` (PNG, GIF, thumbnails,
  contact sheets, MCP).
- The browser video exporter (`frameSource.ts`) calls it on a per-frame clone too, so video frames
  never depend on a browser's `pathLength` support for basic shapes.
- Percent dash values and `none` are left alone.

**Tests.** Unit tests for the length maths and the rewrite; raster tests (dash/gap pixels along a
line, a trim drawing on, rect/ellipse perimeters); the Lottie round-trip test now compares the
trim + dash case against SaViG's raster instead of only checking converted numbers; the video
frame source bakes absolute dashes.
