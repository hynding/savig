# Motion editor — slice 3 plan

Spec: `specs/2026-11-15-motion-editor-design.md`.

1. engine: `easingAsBezier` moves here (ui-core re-exports it) and `splitEasing(e, u)` splits a
   segment easing at progress u by de Casteljau, renormalizing each half to its own box (exact for
   Béziers and the quadratic named easings; linear stays linear; null when a half has no span).
2. editor-state `insertScalarKeyframe(ref)`: frame-snapped key at the curve's current value,
   splitting the segment easing so the motion is unchanged; a held key outside the keys; an
   existing key is only selected.
3. Graph: double-click the plot to add a key; segment presets (Linear / Ease in / Ease out /
   Ease in-out) for the segment the selected key starts; the plot is focusable and arrow keys
   nudge the selected key (←/→ one frame, ↑/↓ a round 1/100 of the axis span, Shift ×10) without
   reaching the Stage's nudge. A Timeline diamond's double-click opens the graph on that key.
4. Tests: split exactness incl. overshoot; insert keeps `interpolate` values; component tests for
   double-click, presets, arrows, diamond handoff; e2e for the whole flow.
