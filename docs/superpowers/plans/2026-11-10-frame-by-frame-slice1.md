# Frame-by-Frame — Slice 1 (Model + Engine + Render Seam) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking; boxes are left
> unchecked in-file by convention (see INDEX).

**Goal:** Frame layers exist in the model and render correctly everywhere that goes through the
shared frame seam (Stage, bundle runtime, raster/GIF/video, MCP `render_frame`). There's no new
editor UI in this slice. Layers are authored with the engine helper `createFrameLayer` (and by
hand-written JSON), then validated and rendered headlessly.

**Spec:** `docs/superpowers/specs/2026-11-07-frame-by-frame-design.md`, §Model, §Engine,
§Render & export, §Persistence. SMIL visibility is slice 5.

## Global constraints

- **Parity:** a project with no `frames` anywhere must render byte-identical output. `exposed`
  and `visibility` are emitted only for leaves whose ancestor chain passes through a frame layer.
- **Visibility, not display:** exposure uses the SVG `visibility` attribute so it stays
  orthogonal to M9's `display` overrides.
- **Time-invariant skeleton:** unexposed leaves are still emitted by `flattenInstances`. Only
  their `exposed` flag changes.
- The generated runtime bundle (`packages/runtime/src/runtimeSource.generated.ts`) must be
  rebuilt with `pnpm build:runtime` after `frame.ts` changes.
- Commands: `pnpm vitest run <path>`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.

---

### Task 1: Model types + exposure helpers

**Files:** `packages/engine/src/types.ts`, new `packages/engine/src/frameLayer.ts` + test,
`packages/engine/src/index.ts`, `packages/engine/src/project.ts` (helper).

- [ ] Add `FrameLayer { keys: FrameKey[]; end: number }`, `FrameKey { id; time; label? }`,
      `SceneObject.frames?`, `SceneObject.frameKeyId?`.
- [ ] `frameKeySpans(layer) → { id, start, end }[]`, sorted by time. Key *i* ends at key *i+1*'s
      start, and the last key ends at `layer.end`.
- [ ] `exposedFrameKeyId(layer, time) → string | null`, half-open and epsilon-tolerant (1e-6).
- [ ] `isExposedAt(obj, objectsById, time) → boolean | undefined`. It walks the ancestor chain
      (cycle-guarded). At every node whose parent is a group with `frames` and whose own
      `frameKeyId` names a real key, it tests that key's span. It returns `undefined` when no
      ancestor link is frame-controlled (parity), `false` if any link is unexposed, and `true`
      otherwise. A missing or dangling `frameKeyId` counts as always exposed.
- [ ] `createFrameLayer({ id, name?, zOrder, keys, end })` → an `isGroup` container with
      `frames`.
- [ ] Unit tests: boundaries (start inclusive, next start exclusive, `end` exclusive), before the
      first key, unsorted input keys, nested frame layers, dangling ids, non-layer parents, and
      cycles.

### Task 2: Duration + keyframe times

**Files:** `packages/engine/src/duration.ts`, `packages/engine/src/onionSkin.ts` + tests.

- [ ] `objectsMaxKeyframeTime` counts `frames.end`, which flows into
      `symbolEffectiveDuration`, `isStaticSymbol` (a symbol with a frame layer is no longer
      static, so the `<use>` optimization is skipped) and `computeProjectDuration`.
- [ ] `objectKeyframeTimes` includes frame key times.

### Task 3: `flattenInstances` exposed flag

**Files:** `packages/engine/src/symbol.ts` + test.

- [ ] `InstanceLeaf.exposed?: boolean`. Each walk level computes
      `isExposedAt(o, objectsById, localTime)` and ANDs it with the inherited context from an
      enclosing instance. The flag is set only when some link is frame-controlled.
- [ ] Symbol instances: the instance's own exposure (sampled on the parent clock) propagates to
      every leaf, and the symbol's internal frame layers use the remapped `childTime`.
- [ ] Tests: leaf flags at several times, an instance inside a key, a frame layer inside a symbol
      with `symbolTime` loop, and a no-frames project with no `exposed` key at all.

### Task 4: Runtime frame seam

**Files:** `packages/runtime/src/frame.ts` + test, regenerate the runtime bundle.

- [ ] `FrameItem.visibility?: 'visible' | 'hidden'`, set from `leaf.exposed` when defined.
- [ ] `applyFrameToNodes` sets the `visibility` attribute when it's present.
- [ ] Tests: items toggle across a key boundary, and a project without frames has no
      `visibility` key.

### Task 5: Static export initial state

**Files:** `packages/services/src/export/renderDocument.ts` + test.

- [ ] `renderLeaf` adds `visibility="hidden"` on the wrapper when `leaf.exposed === false` at
      t=0 (vector, text, text-on-path and svg `<use>` branches).
- [ ] Tests: a hidden key is marked at t=0 and the t=0 key is unmarked. Existing snapshot tests
      stay unchanged (parity).

### Task 6: Validation

**Files:** `packages/core/src/validate.ts` + test.

Checks run on every scene and on every symbol's objects:

- [ ] `frames-on-non-group` (error).
- [ ] `frame-keys-empty` (error).
- [ ] `frame-keys-unsorted` / `frame-key-duplicate-time` / `frame-key-duplicate-id` (error).
- [ ] `frame-end-before-last-key` (error).
- [ ] `frame-key-negative-time` (error).
- [ ] `frame-key-orphan`: a `frameKeyId` on an object whose parent isn't a frame layer (warn).
- [ ] `frame-key-dangling`: an id that's not in the parent's keys (warn).
- [ ] `frame-layer-child-unkeyed`: a direct child with no `frameKeyId` (warn).
- [ ] `boolean-frame-operand`: a live boolean operand that's a frame layer or one of its
      descendants (error).

### Task 7: Persistence

**Files:** `packages/services/src/persistence/migrate.ts` + test, and the version in
`packages/engine/src/project.ts`.

- [ ] `CURRENT_VERSION = 8`, plus a `7 → 8` stamp-only migration. `createProject` stamps 8, so
      older builds refuse a newer file instead of silently showing every drawing.

### Task 8: Parity / integration

- [ ] Stage == export parity: computeFrame items and renderDocument markup agree on visibility
      for a frame-layer fixture at t=0.
- [ ] Full `pnpm test`, `pnpm typecheck` and `pnpm lint` green.
