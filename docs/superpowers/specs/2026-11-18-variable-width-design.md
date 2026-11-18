# Variable-width strokes (Width tool) — design

Roadmap 8, item 2. Flash's Width tool lets a stroke swell and taper along its length by dragging
width points on it. SaViG strokes were uniform everywhere (the brush already drew tapered ink,
but as a filled outline with no stroke left to edit).

## Model (slice 1)
`VectorStyle.widthProfile?: WidthStop[]` with `WidthStop = { t, w }`: `t` is the arc-length
fraction 0..1 along the path, `w` multiplies `strokeWidth` there (0..20, `MAX_WIDTH_SCALE`).
Stations are sorted by t; the multiplier holds flat before the first and after the last, and
eases between neighbours with smoothstep (`widthScaleAt`), so the outline swells smoothly.
Absent (or every station 1) = a uniform stroke, byte-identical to before. Paths only.

The profile is static: it does not keyframe. The outline still follows a morphing, skinned or
node-edited path every frame, and an animated stroke colour or gradient still paints it.

## Rendering
A profiled stroke draws as a FILLED outline: `widthStrokeRings(path, style)` densifies the
centreline (at most 128 evenly spaced samples, arc fractions unchanged) and runs the existing
`outlineStroke` (feature-6 variable-width hook) with `w(t) * strokeWidth`, honouring cap and join.
outlineStroke winds holes against outer rings, so the default nonzero rule paints it, overlapping
rings of a compound path included. Hairline slivers a width change leaves at a corner are dropped.

- `renderShapeToSvg`: the shape keeps its fill with `stroke="none"` (and stays the wrapper's first
  child, so the runtime's `d`/fill updates still land on it), followed by
  `<path data-savig-width d=… fill=strokePaint/>`. Dash and trim do not apply to a profiled stroke.
- Runtime `computeFrame`: `widthD` (outline `d`) whenever it emits `pathD`; `widthFill` in place
  of `stroke` when the stroke colour animates; no dash/trim attrs. `applyFrameToNodes` writes them
  to `[data-savig-width]`. The editor Stage draws the same outline (its painter shares the runtime).
- SMIL and CSS exports animate the outline's `d` (stepped per frame when the vertex skeleton
  changes) and fill. Lottie draws a "Stroke" group of outline rings with a fill (`fl`/`gf`) of the
  stroke paint in place of a Lottie stroke. Raster/video use the runtime.
- Live booleans never draw a profile.
- Outline stroke, the eraser and the paint bucket outline a profiled stroke to its profiled ink
  (`strokeInkRings`), so they match what is drawn. Paste Style drops the profile on a rect/ellipse.
- Load: `sanitizeWidthProfile` normalizes the stations (finite, clamped, sorted, one per t, at
  most 32) and drops an unusable, uniform or non-path profile.

## Slice 2 — Width tool and agent surfaces
- Width tool (W, toolbar "Width"): pressing a drawing selects it; a selected stroked drawing
  shows its stations as dots and a wide invisible hit band along the stroke. Press anywhere on
  the stroke and drag sideways: the stroke's edge follows the pointer at that spot
  (`widthAtPoint`; a station within 0.02 of t moves, else one is added; a uniform stroke first
  gets stations of 1 at both ends so the swell stays local). Dots drag the same way; Alt-click
  removes one. A preview outline shows while dragging; letting go commits (one undo step).
  Rects and ellipses become paths on commit (`applyWidthProfile`, shared with core: pivot
  pinned, a shared asset copied; refused when the size animates, on live booleans, locked
  objects, or with no stroke). Skinned drawings show no Width overlay.
- Inspector Style: a "width profile" select (uniform, taper end/start/both, bulge, pinch; shows
  "custom" after Width-tool edits).
- Core `setWidthProfile(project, id, preset | stations | null)`, describe `width taper-end` (or
  `width 0.5:3 …`), DSL round-trips `style.widthProfile` (it already carries the whole style),
  MCP `set_width_profile`.
- `MAX_WIDTH_SCALE` is 20 so a hairline can still swell visibly.
