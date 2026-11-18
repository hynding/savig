# 3D rotation — design

Roadmap 9, item 2. Animate's 3D Rotation tool turns a movie clip about its X and Y axes. SaViG had
no depth at all.

## Model (slice 1)
`Transform2D` gains optional `rotationX` / `rotationY` (degrees). Absent means 0, so old documents
and every flat transform string stay byte-identical (no format bump). Both are animatable
properties (`ANIMATABLE_PROPERTIES`), keyed like skew (no shortest-path wrap, so a 0→360 flip
turns all the way round) and take wiggle/loop modifiers (default wiggle 10°).

- The drawing is turned **orthographically**: the 2×2 linear part of CSS `rotateX(rx) rotateY(ry)`,
  `[cos ry, sin rx·sin ry, 0, cos rx]` (`tiltMatrix`). A Y turn narrows the drawing by cos ry, an X
  tip flattens it by cos rx, 180° shows the mirror image (the back of a card), and the combination
  shears the way a turned-then-tipped card does. Because it is affine, every renderer draws it
  exactly.
- `buildTransform` emits it innermost, after scale and before skew:
  `… skewX(kx) skewY(ky) matrix(a, b, c, d, 0, 0) scale(sx, sy) …` — only when non-zero, with six
  decimals (the coefficients multiply local coordinates).
- `sampleObject` adds the channels only when the object has a base value, a track or a modifier.
- `mapPoint` / `invMapPoint` (engine) and `linearMaps` (interaction) apply the tilt, so hit boxes,
  snapping, and scale/resize/skew handles follow a turned object. Edge-on (90°) has no inverse; the
  determinant is held off zero so the inverse stays finite.
- Load: `sanitizeSkew` also drops a non-finite or zero `rotationX` / `rotationY`.
- Exports need no special casing: SMIL, CSS and Lottie decompose each sampled matrix (a narrowed
  turn becomes a scale, a mirror a negative scale), and the runtime, raster and Stage render
  `buildTransform`. The runtime bundle is regenerated.

Editor (slice 1): Inspector `rotationX` / `rotationY` fields (auto-key, like the others), the graph
editor and "Add modifier" list them as 3D Rotation X / Y.

## Slice 2 — 3D Rotation tool and agent surfaces (next)
## Slice 3 — Bake perspective into a drawing (next)
True perspective is not affine, so it cannot ride on a transform. A static "bake perspective" will
project a drawing's path through a pinhole camera at the current 3D pose (a projective map through
the warp machinery of the distort tool) and reset the 3D rotation.
