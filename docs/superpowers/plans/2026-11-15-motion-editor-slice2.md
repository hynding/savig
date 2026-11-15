# Motion editor — slice 2 plan

Spec: `specs/2026-11-15-motion-editor-design.md`.

1. ui-core: `GraphPreview` (draw one property from a preview track), `trackWithKeyMoved`,
   `trackWithEasing`, `roundForSpan`; timeline intents `moveScalarKeyframe` /
   `setScalarSegmentEasing`.
2. `GraphEditor` drags with pointer capture and window listeners:
   - key: frame-snapped time + value (rounded to ~1/1000 of the visible span; opacity 0..1),
     Shift = dominant axis, a 2px slop so a click only selects, a live "value @ time" readout;
   - handle: `handleToEasing` from the frozen segment;
   - the value axis is frozen for the whole drag; Escape cancels; one commit on release;
     locked objects do not drag.
3. Tests: preview helpers; component drags (key move + one commit, Shift, Escape, click,
   handle easing, lock); e2e with real mouse drags checked through the Inspector's values.
