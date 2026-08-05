# Standalone Animated SVG Export (SMIL) — Design

**Date:** 2026-08-04
**Status:** Approved
**Milestone:** M6 (the "CSS export" roadmap item, realized as SMIL after design analysis)

## Goal

A new export target producing a **single self-contained `.svg` file that animates
anywhere** — browser tabs, `<object>`/`<iframe>`, and crucially `<img>` elements,
GitHub READMEs, and CSS backgrounds, where scripts never execute. The file contains
no JavaScript and no embedded project JSON: pure SVG markup plus SMIL animation
elements (`<animate>`, `<animateTransform>`).

This joins — does not replace — the existing export targets:

| Target | Artifact | Animated? | Plays in `<img>`? |
| --- | --- | --- | --- |
| Bundle (`file.export`) | `.zip` (HTML + runtime JS) | yes (JS) | n/a |
| SVG snapshot (`file.exportSvg`) | `.svg` frame-0 | no | static |
| **Animated SVG (new)** | **`.svg` with SMIL** | **yes (declarative)** | **yes** |

## Decisions (with rationale)

1. **Play context: anywhere, including `<img>`.** Scripts are disabled when an SVG
   is rendered as an image, so the animation must be declarative. This rules out
   inlining the existing JS runtime.
2. **Fidelity: bake everything.** Every animated feature is exported — including
   path morphs, animated booleans, animated gradients, camera, scenes/transitions,
   and time-remap — by sampling per frame rather than skipping or approximating.
3. **Substrate: SMIL** (not CSS `@keyframes`). SMIL animates *any* SVG attribute —
   including path `d` and gradient stops — in all major browsers and in `<img>`
   contexts. CSS cannot animate `d` in Safari and is unreliable for gradient stops,
   so CSS would have needed SMIL anyway for full coverage. One substrate, one
   emitter. (Chrome's old SMIL deprecation was reversed.)
4. **Animation source: sample `computeFrame`.** The emitter samples the existing
   runtime frame engine (`@savig/runtime/frame`) at project fps rather than
   translating tracks natively. ONE code path covers every feature (symbols,
   repeaters, motion paths, stagger, time-remap, scenes, camera, booleans) and
   **export == preview is guaranteed by construction** — the same parity invariant
   the codebase already builds on (shared `flattenInstances`, shared
   `applyProjectFrame`). Cost: fps-resolution interpolation (visually identical at
   30–60 fps) and larger `values` lists; a native smooth-mapping optimization for
   simple tracks can be a later slice.

## Architecture

New browser-safe module `packages/services/src/export/animatedSvg.ts`
(string-based like `renderDocument.ts`; no DOM/jsdom dependency, so it works in
the browser editor and in the Node MCP server alike):

```ts
renderAnimatedSvgDocument(project: Project): string
```

Pipeline:

1. **Sample.** Call `computeFrame(project, t)` at `t = i / fps` for
   `i in [0 .. ceil(duration * fps)]`, where `fps = project.meta.fps` and
   `duration` comes from the shared duration computation
   (`computeProjectDuration` / multi-scene variant). Also sample
   `computeCameraTransform` and the scene visibility / transition seams that
   `applyProjectFrame` drives (crossfade opacity, dip overlay, per-scene
   `display`).
2. **Emit SMIL.** Each `FrameItem` property becomes a `values` + `keyTimes` list.
   All animation elements share `begin="0s"` and the same `dur="<duration>s"` so
   they stay mutually synchronized. Looping: `repeatCount="indefinite"` when
   `project.meta.loop`, else `repeatCount="1" fill="freeze"`.
   Properties whose sampled values never change across all frames emit **nothing**
   (the frame-0 base markup already renders them correctly).
3. **Inject.** Render the base document via the existing `renderProjectDocument`
   (frame-0 markup with `data-savig-object` / `data-savig-scene` /
   `data-savig-camera` ids), extended with a new optional `injections` parameter:
   markup fragments appended inside each object wrapper `<g>`, scene group, camera
   group, and `<defs>`. The renderer stays the **single writer** of document
   structure — no post-hoc string parsing — and injected SMIL never routes through
   `sanitizeSvgElement` (which strips SMIL by design; it only sanitizes imported
   asset markup).

## Property mapping (full `FrameItem` coverage)

| FrameItem field | SMIL emission |
| --- | --- |
| `transform` | Sampled composite transform strings (arbitrary-length prefix chains) are parsed and multiplied into one affine matrix per frame, then decomposed into translate · rotate · skewX · scale and emitted as **4 stacked `additive="sum"` `<animateTransform>`s**. SMIL has no `matrix` type; this decomposition is exact for invertible affines. Epsilon guards for degenerate (zero-scale) matrices. |
| `opacity` | `<animate attributeName="opacity">` on the wrapper `<g>`. |
| `geometry` (width, height, rx/ry, cx/cy/r, points, …) | One `<animate>` per attribute on the inner shape element. |
| `pathD` (morphs) | `<animate attributeName="d">`. `calcMode` linear when every sample shares the same command structure; `calcMode="discrete"` fallback when topology changes per frame (animated booleans). |
| `fill` / `stroke` (color tracks) | `<animate>` — SMIL interpolates colors natively. |
| `fillGradient` / `strokeGradient` | `<animate>` on `stop-color` / `stop-opacity` / `offset` of the `<stop>` children inside the existing `savig-grad-<renderId>-fill/-stroke` defs (plus gradient geometry attributes when animated). |
| `strokeDashoffset` / `strokeDasharray` (dash + trim) | `<animate>` per attribute; dasharray interpolates linearly when list lengths match across samples, else discrete. |
| `textPathD` / `textPathStartOffset` | `<animate attributeName="d">` on the `savig-textpath-<id>` def; `<animate attributeName="startOffset">` on the `<textPath>`. |
| Camera | Same matrix-decomposition treatment applied to `<g data-savig-camera>` (root and per-scene groups). |
| Scenes / transitions | Discrete `display` toggles on `<g data-savig-scene>` groups; crossfade = opacity ramp on the incoming scene group; dip = the full-frame overlay rect (created lazily by the runtime today) is emitted **eagerly** by the exporter whenever any dip transition exists, with an opacity triangle-ramp animation. |

## Surface

- **Command registry** (`packages/ui-core/src/commands/registry.ts`):
  `file.exportAnimatedSvg` — label "Export animated SVG", palette-only (matches
  the existing decision to not add toolbar buttons; a unified Export menu remains
  a separate follow-up).
- **`CommandHost`** (`packages/ui-core/src/commands/types.ts`): new
  `exportAnimatedSvg` method; implemented in
  `apps/react/src/ui/commandHost.ts` → `apps/react/src/ui/fileOps.ts`, which calls
  `renderAnimatedSvgDocument(project)` and downloads `<name>.svg`
  (`image/svg+xml`), same save path as the snapshot exporter.
- **MCP** (`packages/mcp/src/tools.ts`): `export_svg` gains
  `animated?: boolean` **defaulting to `true`** — finally making its existing
  "self-contained animated SVG document" description truthful. `animated: false`
  returns today's static snapshot.
- Zip bundle and static snapshot exporters: untouched.

## Exclusions & known limitations

- **Audio** is dropped — an image cannot play sound. Documented; the zip bundle
  remains the audio-capable artifact.
- **Round-trip:** re-importing an exported animated SVG yields static artwork,
  because the import sanitizer strips SMIL by design (unchanged behavior for any
  animated SVG import). Known and acceptable.
- **Interpolation resolution** is project fps; a smooth native-keyframe emitter
  for simple transform/opacity tracks is a possible later file-size/smoothness
  optimization, not in scope.
- `values`-list compression beyond constant-elimination (e.g. piecewise-constant
  run compression via `keyTimes`) is a follow-up.

## Error handling & edge cases

- `MissingAssetError` propagates exactly as in the existing exporters.
- Zero/absent duration → plain static markup, no SMIL elements.
- Degenerate transforms (zero scale) → decomposition epsilon guards; emit the
  nearest representable decomposition.
- Determinism: no timestamps or randomness — identical project bytes in,
  byte-identical SVG out (same invariant the bundle exporter tests enforce).

## Testing

**Unit** (`packages/services/src/export/animatedSvg.test.ts`, plus a small
matrix-decomposition unit in the module that owns it):

- Byte-determinism: same project → byte-identical output.
- **Parity test:** parse emitted `values` / `keyTimes` back out and compare
  against direct `computeFrame(project, t)` output at the sample times — the
  animated analogue of the existing `renderDocument.test.ts` parity test.
- Matrix decompose→recompose round-trip (property-style over representative
  transforms, including flips and near-degenerate scales).
- Per-feature structure tests: morph linear vs discrete, gradient stop animation,
  scene display/crossfade/dip, loop flag, constant-track omission,
  zero-duration static output.
- `fileOps` test: filename + mime passed to `saveBytesToDisk` (existing mock
  pattern). MCP: `export_svg` animated/static branch test.

**E2E** (`e2e/animated-svg-export.spec.ts`):

- Palette-driven export → `waitForEvent('download')` → load the downloaded `.svg`
  as a document via `file://` → call `svg.setCurrentTime(t)` (SMIL's built-in
  deterministic seek — the declarative analogue of `savigSeek`) → assert a
  `[data-savig-object]` transform differs between `t = 0` and `t = mid`.
- `<img>`-embed smoke test: wrap the exported file in an `<img>` on a scratch
  HTML page and assert it loads and renders.
