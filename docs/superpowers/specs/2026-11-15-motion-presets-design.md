# Motion presets — design

Roadmap 5, item 3. One-click animations (fade in, slide in, pop, shake, bounce…) applied to the
selected objects at the playhead, and saving your own.

## Model (engine `presets.ts`)

A preset is data: `{ id, name, category, duration, tracks }`, where each track animates one
transform property (x, y, scaleX, scaleY, rotation, opacity) with keys on normalized time
(`t` 0..1 of the duration) and values relative to the object's own value where the preset starts:

- `offset`: base + v (position, rotation); `factor`: base × v (scale, and opacity so an object
  at 80% fades back to 80%); `absolute`: v.

`applyMotionPreset(obj, preset, { start, duration?, fps })` returns the object's new tracks: each
animated property gets the preset's keys (frame-snapped), replacing that property's keys inside
the window and keeping those outside. Rotation keys are written `raw` so a 360° spin turns.

Entrances end on the object's pose, exits start from it, emphasis presets start and end on it
(the spin adds a turn). 19 built-ins: fade / slide ×4 / pop / zoom / drop (bounce) / spin in;
fade / slide ×2 / pop / zoom out; pulse, shake, wobble, bounce, flash, spin.

## Surfaces

- Timeline header **Presets** button: a popover grouped Entrance / Emphasis / Exit, with an
  optional duration override; a click applies to every selected, unlocked object from the
  playhead (one undo step) and says so in a toast. The popover stays open for another pick.
- Command palette: "Motion preset: <name>" for each built-in (needs a selection).
- `@savig/core` `motionPreset(project, objectId, presetId, { start, duration })`; MCP
  `list_motion_presets` and `apply_motion_preset`.

## Slices

1. Engine model + built-ins, store `applyMotionPreset`, Presets popover, palette, core, MCP.
2. Save your own: capture the selected object's transform keys as a custom preset (relative to
   its pose at its first key: offset for position/rotation, factor for scale/opacity unless that
   value is 0, then absolute), list them under "My presets", rename / delete. Stored with the
   project (`Project.motionPresets`, sanitized on load), so they travel with the file and agents
   see them; a personal cross-project library is a possible follow-up.
