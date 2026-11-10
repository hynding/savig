# Frame-by-Frame — Slice 4 (Onion Skin for Drawings) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax; boxes are left unchecked in-file by convention.

**Goal:** With a frame layer targeted and Onion on, the Stage ghosts the **whole drawings** of the
neighbouring keys, so an animator can trace the next pose over the last one. The single-object
onion skin is unchanged for every other selection.

**Spec:** `docs/superpowers/specs/2026-11-07-frame-by-frame-design.md`, §Onion skin (upgrade).

## Global constraints
- Ghosts are editor-only chrome (`pointerEvents="none"`) and never reach export or the runtime.
- Each ghost is drawn at its own key's start time, using the same `computeFrame` transforms as the
  live render. That means a drawing inside a moved, rotated or grouped layer ghosts exactly
  where it rendered.
- The ghost colours reuse the existing theme tokens: `--onion-before` (blue) and `--onion-after`
  (red). This deviates from the spec's red/green, so the two onion modes read the same. Opacity
  falls with distance, using the existing `ONION_OPACITY`.

### Task 1: Engine (`packages/engine/src/frameLayer.ts`)
- [ ] `frameOnionKeys(layer, time, count, hasDrawing?)`: up to `count` key spans either side,
      nearest first. The reference is the exposed key's start, so the current drawing is never
      its own ghost. Before the first key or past the end, the reference is the playhead. Blank
      keys are skipped via `hasDrawing`, so the skin reaches the nearest real drawing.
- [ ] `isInFrameKey(obj, byId, layerId, keyId)`: whether an object (or its ancestor below the
      layer) is filed under that key.

### Task 2: Ghost geometry (`apps/react/.../Stage/frameOnion.ts`)
- [ ] `frameOnionGhosts(project, layer, time, count)` returns `{ keyId, time, side, rank,
      shapes[] }`. Shapes come from `flattenInstances` leaves under the key, each with its
      `computeFrame` world transform. Paths use `pathD`, or the asset path (`evenodd` for
      compound and boolean paths). Rect and ellipse use the sampled geometry.
- [ ] Vector drawings only. An svg or text leaf has no cheap outline, so it isn't ghosted.

### Task 3: Stage
- [ ] Add `frameGhosts` memo. It applies when Onion is on and the target layer is neither hidden
      nor locked. Rendering is the same tinted fill/stroke as the single-object ghosts.
- [ ] Turn off the single-object `onionGhosts` while a frame layer is targeted.

### Task 4: Tests and docs
- [ ] Engine tests: `frameOnionKeys` neighbours, blank-skipping, and the before-first/past-end
      reference; `isInFrameKey`.
- [ ] `Stage/frameOnion.test.ts`: sides and ranks, nested group paths, svg skipped, ordinary
      group.
- [ ] `e2e/frame-by-frame-onion.spec.ts`: before and after ghosts in the real editor, and that
      Onion off removes them.
- [ ] Update the FBF row in INDEX.
