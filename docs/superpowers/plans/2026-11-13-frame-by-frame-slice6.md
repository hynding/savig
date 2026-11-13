# Frame-by-Frame — Slice 6 (DSL, MCP, flipbook) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax; boxes are left unchecked in-file by convention.

**Goal:** An agent can build cel animation without the editor. It can write a frame layer in the
ShortDoc DSL, edit one through MCP tools that mirror F5/F6/F7, and lay a set of drawings out as a
flipbook ("on twos" and so on). A "bouncing ball on twos" template shows the idiom.

**Spec:** `docs/superpowers/specs/2026-11-07-frame-by-frame-design.md`, §DSL / MCP / macros.
Validation already landed in slice 1 (`validateFrameLayers`).

## Global constraints
- Same contract as `build.ts`: pure, id-addressed, root-scene only (MCP wraps calls in
  `withScene`), fail loud on bad references.
- Key math goes through the engine's pure ops (`frameLayer.ts`), so an agent-built layer obeys
  exactly the editor's F5/F6/F7 rules.
- Drawings filed under a key are in the layer's local space. A layer made here has no
  rotation/scale, so that is just an offset by the layer's (x, y), default 0,0.
- Projects without frame layers compile, decompile and describe exactly as before.

### Task 1: Headless builders (`packages/core/src/frames.ts`)
- [ ] `addFrameLayer(project, { id?, name?, x?, y?, keys?, end? })`: keys snapped and sorted,
      duplicate times and an end at or before the last key are errors; `end` defaults to one
      frame past the last key.
- [ ] `putInFrameKey(project, objectId, layerId, keyId)` files a top-level object under a key.
- [ ] `frameKeyAtTime(project, layerId, time)`: the key that STARTS at `time`, created blank if
      none does. This is the agent's "draw on frame N" target; it is more predictable than "the
      key exposed at N", which would silently draw into a held key.
- [ ] `addFrameKey` (blank = F7, `copyPrevious` = F6 deep copy with fresh asset ids),
      `insertFrames` (F5), `removeFrames` (Shift+F5, deletes a collapsed key's drawing),
      `clearFrameKey` (Shift+F6).
- [ ] `flipbook(project, layerId, drawings: string[][], { start?, hold? })`: one key per drawing,
      each held `hold` frames, key ids `<layerId>-k<i>` so templates stay reproducible. The layer
      must have no drawings yet; its keys are replaced and its end set.

### Task 2: DSL (`packages/core/src/dsl.ts`)
- [ ] `ShortFrames { type: 'frames', id?, name?, x?, y?, end?, keys: [{ time, label?, id?,
      objects: ShortShape[] }] }`. `ShortShape` is the old leaf union; `ShortObject` now adds
      `ShortFrames`. Frames do not nest.
- [ ] Compile: `addFrameLayer`, then compile each key's objects and file the new top-level ones
      under that key.
- [ ] Decompile: a frame layer becomes one `frames` entry (key ids always, labels when set,
      x/y when non-zero); its drawings are not repeated at the top level.
      `compileShort(decompileProject(p))` round-trips.

### Task 3: describe (`packages/core/src/describe.ts`)
- [ ] A frame layer reads as `(frames)` with `frames end=… keys: <id> "<label>" start–end n objs`
      (or `blank`); a drawing shows `key=<id>`.

### Task 4: MCP (`packages/mcp/src/tools.ts`)
- [ ] New tools: `add_frame_layer`, `add_frame_key` (`copy_previous`), `insert_frames`,
      `remove_frames`, `clear_frame_key`, `flipbook`.
- [ ] `add_rect` / `add_ellipse` / `add_path` / `add_line` / `add_text` take an optional
      `layerId` + `time`, which draws into the key starting at `time` (created if missing).
- [ ] `load_dsl` describes the `frames` object.

### Task 5: Template (`packages/core/src/templates.ts`)
- [ ] `bouncing-ball-on-twos`: 24 fps, twelve ball drawings flipbooked on twos (one second),
      fall spacing ∝ τ², squash on the floor drawing.

### Task 6: Tests
- [ ] `core/frames.test.ts`: builders, flipbook, DSL compile/round-trip/errors, describe, template.
- [ ] `mcp/tools.test.ts`: each new tool, `layerId`/`time` targeting, `get_dsl` → `load_dsl`
      round-trip. The template gallery test covers validity, rendering and reproducibility.
