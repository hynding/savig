# Lottie export — design

Roadmap 5, item 1 (Steve approved 2026-11-15). Export a project as Lottie (bodymovin 5.7) JSON,
the format web and mobile teams play with lottie-web, lottie-ios and lottie-android.

## Approach: sampled, not translated

Every frame is evaluated with the scene walker the SVG exports already use (`flattenInstances` +
`sampleObject`), so groups, symbol instances with time remaps, motion paths, springs, bones,
skins, live booleans and path morphs come out as they render, with no per-feature Lottie mapping.

- One **shape layer per drawn leaf** (`renderId`), layers ordered top first.
- The leaf's world transform (`transformPrefix` + its own `buildTransform`, parsed to a 2D affine)
  is decomposed per frame into Lottie position (split x/y), rotation, scale and skew with the
  anchor at the origin. Lottie's transform is P · R(r) · K(sk) · S(s) · (p − A) with
  K = [[1, −tan sk], [0, 1]] at skew axis 0 (lottie-web `skewFromAxis(−sk, sa)`); skew is only
  non-zero when a rotated child sits under a non-uniform scale.
- **Thinning:** each numeric channel is keyed per frame, then a frame is dropped whenever linear
  interpolation between kept frames reproduces every frame in between (1e-3). A linear tween stays
  two keyframes; a spring keeps what it needs. Rotation is unwrapped so it never spins the long way.
- **Paths** (rect/ellipse converted to cubic paths; compound rings; morphs; skins; booleans) are
  held per frame (`h: 1`), identical frames merged: Lottie interpolates paths only between equal
  vertex counts, and a hold is exact at every frame.
- Fill (`fl`, rule 1 nonzero / 2 even-odd) and stroke (`st`, cap/join/width), colours keyed like
  other channels; the stroke is listed before the fill so it draws above it, as in SVG.
- Opacity = own × ancestor-instance factor; an unexposed frame-by-frame drawing is opacity 0.
- Blend modes map one to one onto Lottie `bm` 1–15.

## Gradients, trim, dashes (slice 2)

- SaViG gradients are in objectBoundingBox units; they are mapped onto the shape's local bounding
  box (`pathBoundsRings` of the frame's rings) as Lottie `gf` (fill) / `gs` (stroke) start/end
  points, type 1 linear / 2 radial (end = centre + r along x). Stops are flattened
  `[offset, r, g, b, …]`, with `[offset, alpha, …]` appended when any stop is translucent; the stop
  count is the largest seen across frames (shorter frames repeat their last stop) so `g.p` is fixed.
  A radial gradient on a non-square box (an ellipse in SVG) or with a moved focal point is drawn
  circular / centred, with a warning.
- Each layer has a **stroke group above a fill group**. A trim (`tm`, s/e in %, o in degrees,
  m = 2) goes in the stroke group only, because SaViG's trim is a dash window that never cuts fills.
- A dash pattern (pathLength-normalized in SaViG) becomes absolute Lottie dashes (`d`/`g`/`o`)
  using the frame's flattened path length; dashes win over trim, as in the SVG render.

## Masks, images, scenes, camera (slice 3)

- **Masks → track mattes.** Every leaf under a mask (`maskChain`, innermost mask only; a warning
  when nested) gets its own matte layer directly above it: a `ty: 0` precomp layer (`td: 1`,
  identity transform, artboard size) whose asset `mask_N` holds the mask's content layers. The
  target's `tt` is 1 alpha, 2 alpha inverted, 3 luma, 4 luma inverted, from the mask's
  `maskType`/`maskInvert`. One precomp per mask is shared by all its targets.
- **Images → image layers.** An image object becomes a `ty: 2` layer with `refId: image_<assetId>`
  and an embedded asset `{ w, h, p: dataUrl, e: 1 }`, placed at its natural box like the SVG
  render (anchor resolved the same way).
- **Scenes.** The master timeline is sampled through `sceneAtTime`; layer keys are
  `<sceneId>:<renderId>` and draw order is scene index, then leaf index. A crossfade fades the
  incoming scene's layers in over the outgoing one. A dip shows one scene per half and adds a top
  "Scene transition" layer (artboard rect) whose colour and opacity follow the dip.
- **Camera.** The project or scene camera transform is baked into each layer's matrix per frame.
  Camera keys do not extend an auto duration (as in the editor).
- Each layer shows for `ip ≤ f < op`; `op` is the frame count, so a static project is one frame.

## Surfaces (slice 4)

- Editor: command `file.exportLottie` ("Export Lottie JSON", command palette, File category)
  through the host's `exportLottie()`; it downloads `<name>.json` and shows the first warning
  (with a count of the rest) as an info toast.
- `@savig/core` re-exports `exportLottie` (pure; no native deps).
- MCP `export_lottie`: the JSON as text, then a "Warnings:" list when anything was not carried.

## Slices

1. Core converter (`services/export/lottie.ts`): shapes, transforms, fills, strokes, morphs,
   skins, booleans, symbols, blend modes; warnings for what is not carried yet.
2. Gradients (`gf`/`gs`), trim paths (`tm`), dashes (`d`).
3. Masks as track mattes, images as image layers with embedded assets, multi-scene timelines,
   camera.
4. Export menu entry + download, core `exportLottie`/MCP `export_lottie`, docs.

Not carried (reported as warnings): filters (Lottie players do not render effects reliably),
text (Lottie text needs font data), SVG assets, symbol clip/tint, nested masks (outer masks).

## Verification

A reference Lottie interpreter in `core/src/node/lottie.test.ts`, written from the format
(not from the exporter), turns exported frames back into SVG; resvg rasters of that and of
SaViG's own frame must match. The interpreter also draws image layers, precomps and track
mattes (as SVG masks; inverted ones as 1 − coverage). Flipping the skew sign in the interpreter makes the skew fixture
fail, so the check is sensitive to the convention. lottie-web itself is not a dependency, so the
first real-player check is manual. resvg ignores `pathLength`, so normalized dashes and trims are
checked by value rather than by raster (this also means SaViG's own PNG/GIF/video rasters draw
dashed and trimmed strokes incorrectly today — a separate fix).
