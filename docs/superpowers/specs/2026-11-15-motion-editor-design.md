# Motion editor (graph view) — design

Roadmap 5, item 2. The Timeline shows *when* keyframes happen; the motion editor shows *how* a
value moves between them: a value-over-time graph of one property of the selected object, with
draggable keyframes and Bézier handles.

## What the user sees

- A **Graph** toggle in the Timeline header. On, the track rows give way to a graph panel that
  shares the Timeline's time axis (ruler, zoom, playhead), so time lines up exactly.
- The panel draws the selected object's scalar tracks (x, y, scale, rotation, opacity, geometry,
  primitive params, text-path offset). Property chips pick which curve is in focus; the focused
  curve is drawn bold with its keyframes and handles, the others faintly behind it, each
  normalized to the panel height. The chip of the selected keyframe's property is focused
  by default.
- The value axis fits the focused curve (min..max of keyframes and samples, with padding) and
  labels a few round values.
- Keyframe dots: click selects (same selection as the Timeline diamonds); drag moves time
  (frame-snapped) and value together; Shift locks to the dominant axis.
- Each segment between two keys has two handles: the out-handle of its first key and the
  in-handle of its second. Dragging one rewrites that segment's easing as a `cubicBezier`.
  A named easing shows its Bézier equivalent (linear (⅓,⅓,⅔,⅔), easeIn (⅓,0,⅔,⅓) and easeOut
  (⅓,⅔,⅔,1) exactly; easeInOut, a piecewise quadratic, as (0.45,0,0.55,1)).
- Handle x is clamped to its segment (0..1), so time never runs backwards. Handle y may overshoot
  (bounce), clamped to −1..2 of the segment's value span.

## Model

Easing is per segment, normalized to the segment's box: handle 1 sits at
`(t_a + p1·Δt, v_a + p2·Δv)`, handle 2 at `(t_a + p3·Δt, v_a + p4·Δv)`. On a flat segment
(Δv = 0) the box has no height, so handles move only in time (the y of the easing is kept).
Rotation segments use the shortest-path target unless the key says `raw`, as `interpolate` does.

## Code

- `ui-core/viewmodels/graphEditor.ts`: pure. `graphViewModel(state, focus?)` → curves, focus,
  value range; `easingAsBezier`, `segmentHandles`, `handleToEasing`, `valueTicks`.
- `editor-state`: `moveScalarKeyframe(ref, time, value)` (one commit, keeps easing, selects the
  moved key) and `setScalarSegmentEasing(ref, easing)`.
- React `Timeline/GraphEditor.tsx`, an SVG over the lane area.

## Slices

1. Model + store verbs + read-only graph (toggle, chips, curves, keyframes, handles, axis).
2. Interaction: select and drag keys (time + value, Shift axis lock), drag handles; e2e.
3. Polish: double-click the plot to add a key (the segment's easing is split with de Casteljau so
   the motion does not change), segment presets in the panel, arrow-key nudge of the selected
   key (←/→ a frame, ↑/↓ a round 1/100 of the axis, Shift ×10), and the Timeline → Graph
   handoff when a diamond is double-clicked.

Not in scope: multi-key selection and box-select in the graph, colour/gradient/filter tracks
(non-scalar or separately keyed), and a speed graph.
