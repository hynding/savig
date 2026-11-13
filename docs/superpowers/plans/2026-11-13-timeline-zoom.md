# Timeline Zoom Implementation Plan

> Steps use checkbox (`- [ ]`) syntax; boxes are left unchecked in-file by convention.

**Goal:** The timeline can zoom horizontally, so frame cells are wide enough to click and drag at
24–30 fps. At the old fixed 100 px/s scale, a 30 fps cell was about 3 px wide. This was the known
follow-up from the frame-by-frame work.

## Global constraints
- 100% zoom is exactly the old 100 px/s, so nothing moves for anyone who never zooms (and the
  unit/e2e pixel math stays valid).
- Every timeline surface (ruler, keyframe rows, frame strips, audio lanes, playhead) reads one
  shared scale, so they cannot drift apart.
- Zoom is a view preference: it never touches the document or undo history, and it survives
  New project (like grid and snapping).

### Task 1: State (`packages/editor-state`)
- [ ] `timelineZoom` (default 1) with `setTimelineZoom` (clamped 0.25–16, ignores non-finite) and
      `stepTimelineZoom(±1)` along the ladder 25 / 50 / 75 / 100 / 150 / 200 / 300 / 400 / 600 /
      800 / 1200 / 1600 %. A value between rungs (from the wheel) steps to the neighbouring rung.
- [ ] VM field `timelineZoom` and intents `setTimelineZoom`, `zoomTimelineIn`, `zoomTimelineOut`.
- [ ] Palette commands: Zoom timeline in / out, Reset timeline zoom (no default chord).

### Task 2: Scale (`apps/react/.../Timeline/scale.ts`)
- [ ] `makeTimelineScale(zoom)` → `{ pxPerSecond, timeToX, xToTime, frameTickBackground }`,
      provided through `TimelineScaleContext`; `FrameStrip` and `AudioLanes` read it with
      `useTimelineScale()`. The 100% helpers stay exported for tests.
- [ ] Frame ticks use the zoomed cell width, so 60 fps gets frame ticks once zoomed in.
- [ ] `rulerLabelStep`: second labels stay ≥ 40 px apart (every 2nd / 5th / 10th … second when
      zoomed out).
- [ ] Frame numbers (1-based, matching the strip's "Frame N" tooltips) appear on the ruler once a
      cell is ≥ 18 px wide; whole seconds keep their M:SS label.

### Task 3: Controls (`Timeline.tsx`)
- [ ] Header group: −, the zoom readout (click = reset to 100%), +, Fit (whole duration in view).
- [ ] Ctrl/⌘ + wheel over the timeline zooms around the pointer (native non-passive listener, so
      the browser's page zoom does not fire). A plain wheel still scrolls.
- [ ] Zoom keeps an instant fixed on screen: the pointer's time for the wheel, else the playhead
      when visible, else the left edge. Fit scrolls to the start.

### Task 4: Tests
- [ ] `scale.test.ts`: zoomed mapping, zoomed frame ticks, label step.
- [ ] `store.timelineZoom.test.ts`: clamp, ladder, between-rung steps, survives New project.
- [ ] `TimelineZoom.test.tsx`: buttons + readout, Ctrl/⌘+wheel vs plain wheel, Fit, playhead /
      ruler scrub / frame strip at 400%, frame numbers threshold, thinned second labels.
- [ ] `e2e/timeline-zoom.spec.ts`: real-browser zoom, scrub alignment at 200%, Ctrl+wheel.
