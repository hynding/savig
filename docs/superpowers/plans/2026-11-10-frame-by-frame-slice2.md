# Frame-by-Frame — Slice 2 (Store Verbs + Draw-into-Key + Commands) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax; boxes are left unchecked in-file by convention.

**Goal:** Animators can author frame-by-frame layers from the keyboard and the command palette:
create or convert a layer, then use F6/F7/F5/Shift+F5/Shift+F6, and draw straight into the key
under the playhead. The timeline frame strip (slice 3) and drawing onion skin (slice 4) come
later.

**Spec:** `docs/superpowers/specs/2026-11-07-frame-by-frame-design.md`, §Editor → Store actions,
Drawing into keys, Commands & keymap.

## Global constraints
- **Target layer:** the selected frame layer, or the nearest frame layer above the primary
  selection (`selectTargetFrameLayer`). Verbs no-op with a toast when there's no target, or when
  the target (or an ancestor) is locked.
- Every verb frame-snaps the playhead, commits exactly one undoable step, and is active-scene
  aware (root, a multi-scene scene, or an edited symbol).
- Key math lives in pure engine ops, with no store logic in the engine. Every time they write is
  re-snapped to the frame grid, so repeated F5 never drifts.
- F-key commands `preventDefault` even when unavailable, so F5 never reloads the page.

### Task 1: Pure engine ops (`packages/engine/src/frameLayer.ts`)
- [ ] `frameKeyAt`, `frameKeyForCopy` (past `end` it copies the last key), `insertFrameKey`
      (extends `end` past the new key).
- [ ] `insertFramesAt` (F5: shifts later keys and `end`; past `end` it extends to the playhead
      plus 1f).
- [ ] `removeFramesAt` (Shift+F5: shifts back and collapses a one-frame key. It returns null past
      `end`, when there are too few empty lead frames, or when only one key is left).
- [ ] `removeFrameKey`, `moveFrameKey` (snapped, clamped between neighbours and before `end`),
      `setFrameKeyLabel`.

### Task 2: Store slice (`packages/editor-state/src/slices/frameLayerSlice.ts`)
- [ ] `newFrameLayer` creates one key at the playhead, with `end = max(duration, playhead + 1f)`,
      and selects the layer.
- [ ] `convertToFrameLayer` uses groupSelected's eligibility (top-level, unlocked) and puts the
      selection in key 1.
- [ ] `insertFrameKeyframe` (F6): deep-copies the source key's drawing. `duplicateObject` clones
      the assets, `parentId` is relinked, direct children are re-tagged with the new key, and
      `zOrder` is kept. The copies are selected. It's a no-op on an existing key, and acts like F7
      before the first key.
- [ ] `insertBlankFrameKeyframe` (F7): keeps the layer selected.
- [ ] `insertFrames` / `removeFrames`: a collapsed key's drawing is deleted and its assets pruned.
- [ ] `clearFrameKeyframe` (Shift+F6): needs a key exactly at the playhead. If that's the only
      key, it's emptied but kept.
- [ ] `moveFrameKeyTo`, `setFrameKeyLabel`, `stepFrameKey(±1)`.
- [ ] `selectTargetFrameLayer` selector.

### Task 3: Draw into keys
- [ ] `placeInTargetFrameKey` hook on every `appendObjectToScene` call site (shape, text, path,
      brush and primitive adders). It puts the new object into the exposed key, auto-creating a
      blank key when none covers the playhead. The object is unbaked into the layer chain's local
      space (the same as `reparentObject`). The id is unchanged, so selection keeps targeting the
      layer.

### Task 4: Commands (`packages/ui-core/src/commands`)
- [ ] `hasFrameLayerTarget` predicate.
- [ ] `anim.newFrameLayer`, `anim.convertToFrameLayer`, `anim.insertKeyframe` (F6),
      `anim.insertBlankKeyframe` (F7), `anim.insertFrame` (F5), `anim.removeFrame` (Shift+F5),
      `anim.clearKeyframe` (Shift+F6), `anim.prevFrameKey` / `anim.nextFrameKey`.

### Task 5: Tests
- [ ] Engine op unit tests, store verb tests (including symbol scope, lock, undo, and the render
      swap through `flattenInstances`), and registry/keymap tests (F5 is owned and blocked even
      when unavailable).
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` green.

## Known limits (deferred)
- Paste, duplicate, SVG import and place-symbol still insert at the scene root rather than into
  the targeted key. The spec's audit of those paths moves to slice 3, where the timeline makes
  targeting visible.
- The playhead is clamped to the timeline duration (existing `seek` behaviour). With auto
  duration, a layer's `end` defines how far F5/F6 can reach. F5 past the end extends it.
