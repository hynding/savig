# CSS-only export — design

Status: approved direction (Steve, 2026-11-14: "work on each in order"). Master spec §10 M5
("CSS-only export mode"). Companion to the SMIL exporter (`2026-08-04-animated-svg-export-design.md`),
which chose SMIL as the default substrate; this adds CSS `@keyframes` as a second target.

## Goal

A single self-contained `.svg` whose animation is plain CSS (`<style>` with `@keyframes`), with
no SMIL elements and no script. Why a second animated target:

- **Sanitizers and CMSes.** Many HTML/SVG sanitizers strip `<animate>`/`<animateTransform>`
  (SMIL can rewrite `href`), while `<style>` survives far more pipelines (and the CSS can be
  lifted into the host page when inlining the SVG).
- **Host control.** The embedding page can pause, slow or skip it with ordinary CSS
  (`animation-play-state`, `prefers-reduced-motion`, `animation-duration` overrides), and Web
  Animations (`document.getAnimations()`) can seek it.
- **Compositor-friendly.** Transform and opacity animations run on the compositor.

## Approach

Same as SMIL: sample `computeFrame` at project fps (export == preview by construction) and
reuse the SMIL exporter's sampling, per-object series, scene/camera/dip series and metadata
embedding (shared module). Each animated element gets a class `savig-a<n>`; each animated
property gets one `@keyframes` block (keyframes pruned where a value holds), and the element's
rule lists its animations: `<dur>s linear 0s infinite` (loop) or `1 forwards` (no loop).

| Feature | CSS property | Notes |
| --- | --- | --- |
| Transform (objects, camera) | `transform` | decomposed `translate(px) rotate(deg) skewX(deg) scale()` with unwrapped rotation, `transform-box: view-box; transform-origin: 0 0` |
| Opacity | `opacity` | |
| Frame-by-frame exposure | `visibility` | `step-end` |
| Rect/ellipse geometry | `x y width height rx ry cx cy` (px) | SVG 2 geometry properties |
| Path morph / boolean | `d: path("…")` | linear when every sample has the same command skeleton, else `step-end` |
| Fill/stroke colour | `fill`, `stroke` | |
| Dash offset / trim | `stroke-dashoffset`, `stroke-dasharray` | dasharray `step-end` when list lengths differ |
| Gradient stops | `stop-color`, `stop-opacity` | |
| Text-on-path outline | `d` on the def path | |
| Scenes / transitions | scene group `opacity` (0 when hidden) | discrete switches as near-instant keyframe pairs |
| Dip overlay | `opacity` + `fill` (`step-end`) | |

**Not expressible in CSS (hold their frame-0 value):** gradient geometry and stop `offset`,
filter primitive attributes, text-on-path `startOffset`. A browser without CSS `d` support
(Safari at time of writing) shows morphs at their first frame. The SMIL export remains the
full-fidelity declarative target; audio and interactivity are absent, as in SMIL.

## Surfaces

- services `renderCssSvgDocument(project, env?, binaries?)`; core/node `renderCssSvgNode`.
- MCP `export_svg` gains `format: 'smil' | 'css' | 'static'` (`animated:false` still = static).
- Editor command **Export CSS-animated SVG** (`file.exportCssSvg`).

## Slices

1. Exporter + shared sampling module + core/node + MCP, unit tests (jsdom) and a browser
   parity e2e (seek the CSS file with Web Animations, compare to the SMIL file at the same times).
2. Editor command + fileOps + palette e2e; INDEX.
