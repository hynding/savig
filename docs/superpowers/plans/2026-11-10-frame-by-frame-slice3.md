# Frame-by-Frame — Slice 3 (Timeline Frame Strip + Layers Scoping) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax; boxes are left unchecked in-file by convention.

**Goal:** A frame layer reads and edits like a Flash layer on the timeline, and the rest of the
editor treats its keys correctly. The frame strip shows keys, held spans, labels and the end,
and supports seek, drag and a right-click verb menu. The Layers panel lists only the current
frame's drawing. Paste, duplicate, import and symbol placement land in the current key.
Selection picks drawings rather than the whole layer. Drawing onion skin is slice 4.

**Spec:** `docs/superpowers/specs/2026-11-07-frame-by-frame-design.md`, §Timeline, §Layers
panel, §Selection & hit-testing.

## Global constraints
- The view-models stay pure (`EditorState → VM`). Pixel mapping stays in the React components
  (`Timeline/scale.ts`). Ephemeral expand state lives in the component.
- Scenes without frame layers render and behave exactly as before: same row order and the same
  selection rules.
- No `frameKeyId` may survive on an object that isn't a direct child of a frame layer, and every
  frame-layer child names one of its keys. These are the `validateFrameLayers` invariants.

### Task 1: Route placement into keys (`editor-state`)
- [ ] `placeInTargetFrameKey` reads the layer from the in-progress `project` (`sceneObjectsOf`),
      so several paste roots share one auto-created key. `{ local }` skips the space re-bake for
      a drawing copied from the same layer. With no unlocked target, it strips any stale
      `frameKeyId`.
- [ ] Hook it into `paste` (roots only), `addObject` (import), `placeSymbolInstance` and
      `placeSymbolInstanceAt`.
- [ ] `duplicateSelected`: a root whose parent is a frame layer keeps that parent and key. Any
      other root drops its key tag (`withoutFrameKey`, a new engine helper).
- [ ] `reparentObject` into a frame layer files the object under the key exposed at the playhead,
      creating a blank key if needed. Reparenting out drops the tag.
- [ ] `ungroupSelected` refuses frame layers (with a toast). A group drawn in a key hands its key
      to the children it frees.

### Task 2: Selection
- [ ] `resolveToEntity` stops climbing at a frame layer, so clicking a drawing selects the
      drawing, which still targets the layer for F5/F6/F7. Ordinary groups are unchanged.
- [ ] The marquee filters `isExposedAt(o, byId, t) !== false`, so another key's drawing is never
      grabbed.

### Task 3: Timeline VM (`ui-core/viewmodels/timeline.ts`)
- [ ] `TimelineRowVM.frameLayer?: { keys: { id, time, end, blank, label?, current }[]; end;
      targeted }`. The spec's `selected` is named `current`, meaning exposed at the playhead.
      `targeted` is the selection-driven F-key target.
- [ ] `frameOwnerIds` (frame-layer ancestors, nearest first) and `exposed` on every row. A frame
      layer's descendants are listed right after its row. Other rows keep `objects[]` order.
- [ ] Intents: `targetFrameCell(layerId, t)` selects the layer unless it is already targeted,
      then seeks with `pastEnd`. Also `moveFrameKeyTo`, `setFrameKeyLabel`, and the five verbs.
- [ ] `seek(time, { pastEnd })` lifts the duration clamp, so an empty cell past the end of an
      auto-length project can be picked and then extended with F5/F6/F7.

### Task 4: Timeline UI (`apps/react/.../Timeline/FrameStrip.tsx`)
- [ ] A frame-grid background, span bars (dashed when blank, brighter when current), an end
      marker, key dots (filled, or hollow when blank) centred in their cell, and label flags.
- [ ] Click a cell to seek to the floored cell and target the layer. Drag a dot for a
      frame-snapped preview, which commits `moveFrameKeyTo` on release.
- [ ] A right-click menu with Insert/Remove Frame, Insert Keyframe, Insert Blank Keyframe, Clear
      Keyframe (enabled only on a key), and a label field for the key starting at that cell.
- [ ] A ▸/▾ toggle on the layer row. Its exposed drawing's rows show only when expanded.

### Task 5: Layers panel
- [ ] Under a frame layer, list only children of the exposed key. Untagged or dangling children
      are always listed.
- [ ] `frameCaption` on the layer row: "Frame N", "Frame N · label", or "No frame".

### Task 6: Tests and docs
- [ ] `editor-state/store.frames3.test.ts`: paste, duplicate, import, symbols, selection,
      reparent and ungroup.
- [ ] `ui-core/viewmodels/frameLayers.test.ts`: strip VM, row grouping, intents, `pastEnd`,
      Layers scoping and marquee.
- [ ] `Timeline/FrameStrip.test.tsx`: dots, spans, collapse, drag, menu and label.
- [ ] `e2e/frame-by-frame-timeline.spec.ts`: the strip, the menu and Layers in the real editor.
- [ ] Update the FBF row in INDEX.

## Known limits (follow-ups)
- At the fixed 100 px/s timeline scale, a 30 fps cell is about 3 px, so dots in adjacent frames
  crowd. Timeline zoom is a separate feature.
- Tween keyframes inside a key aren't yet hinted when they fall outside the key's span (spec
  §Selection, Inspector hint).
