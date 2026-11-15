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

## Slices

1. Core converter (`services/export/lottie.ts`): shapes, transforms, fills, strokes, morphs,
   skins, booleans, symbols, blend modes; warnings for what is not carried yet.
2. Gradients (`gf`/`gs`), trim paths (`tm`), dashes (`d`).
3. Masks as track mattes, images as image layers with embedded assets, multi-scene timelines,
   camera.
4. Export menu entry + download, core `exportLottie`/MCP `export_lottie`, docs.

Not carried (reported as warnings): filters (Lottie players do not render effects reliably),
text (Lottie text needs font data), SVG assets, symbol clip/tint (until slice 3 or later).

## Verification

A reference Lottie interpreter in `core/src/node/lottie.test.ts`, written from the format
(not from the exporter), turns exported frames back into SVG; resvg rasters of that and of
SaViG's own frame must match. Flipping the skew sign in the interpreter makes the skew fixture
fail, so the check is sensitive to the convention. lottie-web itself is not a dependency, so the
first real-player check is manual.
