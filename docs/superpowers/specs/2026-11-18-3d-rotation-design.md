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

## Slice 2 — 3D Rotation tool and agent surfaces
- Tool `rotate3d` (key U, toolbar "3D Rotation"): press a shape to select it; dragging turns it.
  Horizontal drag turns about the vertical axis (rotationY), vertical drag tips about the
  horizontal axis (rotationX), 0.5° per screen pixel. Shift locks to the dominant axis and snaps
  to 15°. The overlay shows the object's bbox plus its X (red) and Y (green) axes through the
  anchor. Release commits only the changed axes in one undo step (auto-key must be on, as with
  the other drag tools). Controller: ui-core `controllers/rotate3dDrag.ts`.
- Core `setRotation3D(project, id, { rotationX?, rotationY?, time?, easing? })`: base value, or a
  keyframe with `time`; 0 clears the base value. DSL emits `rotationX`/`rotationY`, describe
  prints `rx=`/`ry=`. MCP tool `set_rotation_3d`.
- Tool buttons narrowed to 26px so the toolbar keeps a single row with the cloud account button.

## Slice 3 — Bake perspective into a drawing
True perspective is not affine, so it cannot ride on a transform. "Bake perspective" (Inspector
button shown when a drawing has a 3D turn, command `transform.bakePerspective`, core
`bakePerspective`, MCP `bake_perspective`) projects the drawing's outline through a pinhole
`distance` stage pixels in front of its pivot (default 1000) at the current pose, writes the result
into the path, and clears rotationX / rotationY (base and tracks). Engine:
`perspectiveOffset` + `applyPerspective` in `geom/warp.ts`, sharing the distort/envelope bake
(rect / ellipse / polygon / star become paths, pivot pinned absolute, shared assets copied).
- The tilt acts after scale, so the scaled offset is projected then unscaled.
- A projective map keeps lines straight: straight segments stay single lines, curves are recut.
- Refuses: no 3D turn ("flat"); a turn that changes over time (keys with different angles, or a
  modifier). Keys that all hold one angle (the editor keys every edit) are a still pose and are
  cleared. Also refuses a corner within 10% of the eye and zero scale, plus the warp refusals.
