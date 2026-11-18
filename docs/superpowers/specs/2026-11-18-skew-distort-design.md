# Skew and Free Transform distort — design

Roadmap 8, item 1. Flash's Free Transform tool skews (drag an edge midpoint along the edge) and,
on a drawing, distorts (drag a corner on its own) or bends with an envelope mesh. SaViG had no skew
anywhere in the engine.

## Model (slice 1)
`Transform2D` gains optional `skewX` / `skewY` (degrees). Absent means 0, so old documents and
every unskewed transform string stay byte-identical (no format bump: an older build drops the
shear but still opens the file). Both are animatable properties (`ANIMATABLE_PROPERTIES`), keyed
like rotation, and take wiggle/loop modifiers (default wiggle 5°).

- `buildTransform` writes `T · R · SkewX · SkewY · S` about the anchor:
  `translate(x,y) rotate(r,ax,ay) translate(ax,ay) skewX(kx) skewY(ky) scale(sx,sy) translate(-ax,-ay)`,
  with the skew terms emitted only when non-zero.
- `sampleObject` adds skew to the render state only when the object has a base skew, a skew track
  or a skew modifier (parity for everything else) and clamps it to ±85° (`MAX_SKEW`), so a sheared
  drawing stays finite and pickable.
- `mapPoint` / `invMapPoint` (engine) are skew-aware; the editor copies (group inverse, bone
  world-to-local, snapping/instance/group bounds) now call them instead of their own rotate-scale
  math. Scale and resize handles use `linearMaps(rotation, skewX, skewY)` (interaction) so the
  opposite corner/edge stays put on a sheared object.
- Load: `sanitizeSkew` drops a non-numeric, non-finite or zero base skew.

Exports need no special casing: SMIL and CSS already decompose each sampled transform into
`T·R·SkewX·S`, Lottie's decomposition already writes `sk`, and the runtime, raster and Stage all
render `buildTransform`.

Editor (slice 1): Inspector `skewX` / `skewY` fields beside rotation (auto-key, like the others)
and Skew X / Skew Y in "Add modifier".

## Slice 2 — Stage skew handles and agent surfaces
- Select tool: a thin skew bar sits 12 px outside each edge midpoint of the selected object (in
  the rotate overlay, so rects/ellipses/paths/text/images all get them). Top/bottom shear along X,
  left/right along Y; the opposite edge stays fixed (Alt: shear about the anchor; Shift: 15°
  steps). Interaction `applySkewHandleDrag` (pure), ui-core `makeSkewDragController`, Stage
  `useSkewDrag`. Live preview with a "skew X 12°" readout; one undo step; auto-key gated like the
  other handles; x/y keyed only when the fixed point moved the base.
- Core `setSkew(project, id, { skewX?, skewY?, time?, easing? })` (static base, 0 removes; with
  `time` keys the tracks; refuses |angle| > 85). DSL `base: { skewX, skewY }` and
  `animate: { skewX: [...] }` compile and decompile. describe prints `skx=`/`sky=`. validate warns
  `skew-clamped` for a base or keyed skew past ±85°. MCP `set_skew`; `set_keyframe` lists skew.

## Slice 3 — Distort and envelope
On a vector drawing: Distort (corner pin, a bilinear map of the drawing's bbox) and Envelope (a
3×3 handle mesh, bicubic) bake into the path's nodes as one undoable edit, with the result usable
as a shape-tween key. Rect/ellipse/primitive shapes convert to paths first, as bone binding does.

## Not doing
3D rotation (SVG has no perspective on paths); live (non-baked) envelopes.
