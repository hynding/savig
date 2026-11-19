# Timeline multi-keyframe selection — design

Roadmap 10, item 2. Flash/Animate let you select a block of frames across layers and move,
stretch, reverse, copy or paste it. SaViG could only select and edit one keyframe at a time.

## Model
- A key selection is a time range across objects: `KeySelection { objectIds, start, end }` in the
  store (transient, not undoable, cleared with the other keyframe selections).
- It covers every time-keyed channel of each object: property tracks, shape, fill/stroke colour,
  gradients, dash offset, trim, motion-path progress, time remap and filter params
  (`keyChannels` in engine `keyRange.ts`, with `withKeyChannel` to write one back).
- `selectKeyRange` keeps only rows that have keys in the range and tightens the range to the first
  and last selected key, so the band hugs the keys and stretching scales from the first to the last.

## Engine rules (`keyRange.ts`)
- `shiftKeys(obj, range, dt)`: moves in-range keys, clamped at 0.
- `scaleKeys(obj, range, newEnd, snap)`: the start stays fixed; keys that collapse onto one instant
  keep the later one.
- `reverseKeys(obj, range)`: times mirror about the middle of the range. Each segment's easing
  (plus `rotationMode` and `morph`) moves to the segment's new start key, reversed (ease-in and
  ease-out swap, bezier curves mirror). The last key keeps the easing that led out of the range.
  Shape correspondence maps and per-node easings can't be reversed and are dropped.
- `deleteKeys`, `copyKeys` (a `KeyBlock` with times relative to the range start) and
  `pasteKeys(obj, block, at)`. A paste skips channels the target can't hold (trim without a trim,
  progress without a motion path, a filter it doesn't have).
- A moved or pasted key replaces any key already at its instant, as in Flash.

## Store verbs (`slices/keySelectionSlice.ts`)
- `moveKeySelection(dt)`, `stretchKeySelection(newEnd)`, `reverseKeySelection()`,
  `deleteKeySelection()`, `copyKeySelection()`, `cutKeySelection()` and `pasteKeys()`. Each is one
  undo step; locked objects are left alone; times snap to the frame grid.
- Paste lands at the playhead. Keys copied from one object paste onto the one selected object;
  otherwise each block goes back to the object it came from. The pasted range becomes selected.
- The keys clipboard is separate from the object and single-keyframe clipboards; copying into one
  clears the others so Ctrl+V does what the last copy implies.

## Timeline UI
- Drag on empty lane space to draw a box (`key-marquee`); the range snaps to whole frames.
  Shift-click a key to extend the range. A plain click on empty lane space clears it.
- Selected keys highlight and each selected row shows a band (`key-band-<row>`). Dragging any
  selected key moves the whole block; the handle at the band's right edge stretches it.
- Commands: Ctrl+C / Ctrl+X / Ctrl+V / Delete act on the key selection when one exists (or a keys
  clipboard for paste), and "Reverse Keyframes" is in the command palette.

## Not in v1
- Headless core / MCP verbs for key ranges (agents can already edit tracks directly).
- Selecting keys of a single channel only (a selection always spans every channel of the row).
