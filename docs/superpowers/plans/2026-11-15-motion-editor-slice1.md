# Motion editor — slice 1 plan

Spec: `specs/2026-11-15-motion-editor-design.md`.

1. `ui-core/viewmodels/graphEditor.ts`: `graphViewModel`, `easingAsBezier`, `segmentTarget`,
   `segmentHandles`, `handleToEasing`, `valueTicks`, `paddedRange`, `propertyLabel`.
2. editor-state: `moveScalarKeyframe`, `setScalarSegmentEasing` (one commit each; locked objects
   untouched); view pref `graphEditorOpen` + `toggleGraphEditor`; command `view.graphEditor`.
3. React: `Timeline/GraphEditor.tsx` replaces the track rows while Graph is on (chips, value axis,
   focused curve + faint others, key diamonds, segment handles; click a key to select it). The
   timeline row grows to min(400px, 50vh) while the graph is open; the graph fills it.
4. Tests: model (Bézier equivalence of named easings, handle round trip, clamps, flat segments,
   samples = `interpolate`, rotation shortest path, focus rules, range), store verbs, component,
   command, e2e (open graph, keys on the shared time axis, click selects).
