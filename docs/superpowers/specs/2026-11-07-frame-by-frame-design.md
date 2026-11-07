# Frame-by-Frame Animation — Design

**Date:** 2026-11-07 · **Status:** Draft design, awaiting review (pre-plan)

## Goal

Flash/Animate-style **frame-by-frame (cel) animation**: a layer whose timeline is a strip of
**keyframes**, each holding its *own drawing*, held on screen until the next keyframe. The core
Flash verbs ship together:

| Verb | Flash key | Meaning |
|------|-----------|---------|
| Insert Keyframe | F6 | New keyframe at the playhead, pre-filled with a copy of the drawing currently shown |
| Insert Blank Keyframe | F7 | New, empty keyframe at the playhead |
| Insert Frame | F5 | Hold the current drawing one frame longer (pushes later keys right) |
| Remove Frame | Shift+F5 | Hold one frame shorter (pulls later keys left) |
| Clear Keyframe | Shift+F6 | Delete the keyframe at the playhead; the previous drawing holds over its span |

Drawing tools draw *into the keyframe under the playhead*, and onion skinning shows the
neighbouring **drawings** (not just one object's interpolated poses).

**Why now.** Every object in SaViG lives for the whole timeline. Transform, color, path morph,
trim and time-remap can all be tweened, but nothing can make a drawing appear on frame 12 and
disappear on frame 15. That's the defining Flash workflow (character animation, effects, walk
cycles, hand-drawn titles), and the pieces around it are already built: onion skin
(`engine/src/onionSkin.ts`), brush/pen/shape tools, frame stepping (`anim.stepBack/stepFwd`),
`snapToFrame`, groups and symbols. A frame-by-frame layer inside a symbol plus the existing 47c
`symbolTime` loop is a reusable walk cycle with no further work.

## Approach decision

- **Chosen — A: frame layer = a group container with keyed children.** A frame layer is an
  ordinary `isGroup` object carrying a `frames` spec (its keyframes). Each direct child is tagged
  with the `frameKeyId` it belongs to. A key's exposure is *derived* from the sorted key list,
  so gaps and overlaps can't exist. Everything a drawing is made of stays an ordinary
  `SceneObject` + `VectorAsset`, so selection, node editing, paint, booleans-within-a-key,
  tweens *within* a key, clipboard, persistence and undo all work unchanged. Only one new
  question gets asked during render: "is this leaf exposed at t?"
- **Rejected — B: per-object in/out points** (`exposure: {in, out}` on every object, with no
  container). It's simpler in the model but pushes the invariants (adjacent, non-overlapping,
  frame-aligned spans) onto every edit, and F5/F6/F7 would have to rediscover "the layer" by
  scanning. It also gives the timeline no single row to draw the frame strip on. B's per-object
  lifetime could still come later for "this prop enters at 3s" use cases, and A doesn't block it.
- **Rejected — C: a new `FlipbookAsset` (drawings array) instanced like a symbol.** It's clean
  in isolation, but drawings would live in an asset's private scene and need their own
  edit-in-place mode. Drawing on the main stage, which is the whole point, would turn into a
  mode switch every time.

## Model (engine `types.ts`)

```ts
/** A frame-by-frame layer's keyframes (on an isGroup container). */
export interface FrameLayer {
  /** Sorted by time, unique, frame-snapped at authoring. Never empty. */
  keys: FrameKey[];
  /** Exclusive end (seconds) of the LAST key's exposure. > last key time. */
  end: number;
}

export interface FrameKey {
  id: string;
  /** Seconds, scene/symbol-local (same clock as every other track). */
  time: number;
  /** Optional frame label (Flash "frame label"); shown on the timeline, targetable by seek later. */
  label?: string;
}

// SceneObject additions
frames?: FrameLayer;     // only meaningful on an isGroup container → makes it a frame layer
frameKeyId?: string;     // only meaningful on a DIRECT child of a frame layer
```

**Exposure rule.** Key *i* is exposed on `[keys[i].time, keys[i+1].time)`, and the last key on
`[keys[n-1].time, end)`. Before the first key and from `end` on, the layer shows nothing. A
**blank keyframe** is just a key that no child references. A child of a frame layer with no
`frameKeyId`, or a dangling one, is **always exposed**. That makes corrupt or hand-edited files
degrade gracefully. The editor never creates such a child, and `validate` warns about it.

**Nesting falls out.** Exposure is an ancestor-chain test, just like `isRenderHidden`. A
child *group* tagged with a key hides its whole subtree, and a frame layer nested inside
another layer's key works. Inside a symbol, the layer runs on the instance's remapped internal
clock (`flattenInstances` already passes `childTime`).

**Absent = parity.** No `frames` anywhere means the output is byte-identical to today. That's
the same discipline as `symbolTime`, `trim` and `repeat`.

## Engine

1. `isExposedAt(obj, objectsById, time): boolean` in `groupTransform.ts`, next to
   `isRenderHidden`. It walks the ancestors, and wherever `parent.frames && node.frameKeyId`
   exist, tests that key's span (epsilon-tolerant, half-open). There's a pure helper
   `frameKeySpans(layer): {id, start, end}[]` for the timeline and onion skin.
2. `flattenInstances`: a leaf gets **`exposed: boolean`** on `InstanceLeaf` and is still
   emitted when unexposed. The DOM skeleton must be time-invariant: the runtime never creates
   nodes per frame (see `RepeatSpec`'s note). A symbol instance that isn't exposed propagates
   `exposed: false` to all of its leaves.
3. `objectsMaxKeyframeTime` counts `frames.end` (and key times), so auto duration, symbol
   effective duration and `computeProjectDuration` all include frame layers.
4. `objectKeyframeTimes` (onion skin, keyframe navigation) includes key times for a layer.
5. A live boolean may not take a frame layer, or any frame-layer child, as an operand in v1.
   `validate` rejects it and the UI gates it. Booleans whose operands all sit *inside one key*
   are fine.

## Render & export (one seam, every target)

- **Visibility attribute, not `display`.** `FrameItem` gains `visibility?: 'hidden' | 'visible'`
  (emitted only for frame-layer leaves, so parity holds) and `applyFrameToNodes` sets it. That
  keeps exposure **orthogonal to M9's `display`-based show/hide overrides**: an override pass
  that writes `display=""` can't accidentally reveal a drawing that isn't exposed, and
  `visibility:hidden` also removes the node from pointer hit-testing, so unexposed drawings
  can't be clicked in preview or in the runtime.
- **Static/bundle export** (`renderDocument`): the initial markup gets `visibility="hidden"` on
  leaves that aren't exposed at t=0, so the first paint and no-JS views are correct.
- **Animated SVG (SMIL)**: one discrete `<animate attributeName="visibility">` per frame-layer
  leaf, using the existing `discreteAttrs`/`discreteKeyTimes` machinery (multi-scene already
  does the same thing for scene groups).
- **Raster, GIF, video, MCP `render_frame`**: these all go through
  `computeFrame`/`applyProjectFrame`, so they come for free.
- **Editor Stage**: uses the same `computeFrame`/`applyFrameToNodes` painter, so preview ==
  export by construction. The parity test gets a frame-layer fixture.

## Editor

### Store actions (`editor-state`, all undoable, all frame-snapped, all scene/symbol-scope aware)

The **target layer** is the selected frame layer, or the frame layer containing the current
selection. Every action is a no-op (with a toast where a user would expect something) when
there's no target layer, or when the target or its ancestors are locked.

| Action | Behaviour |
|--------|-----------|
| `newFrameLayer()` | Empty group with `frames: { keys: [{ time: snap(playhead) }], end: max(duration, playhead + 1f) }`, placed above the current selection |
| `convertToFrameLayer()` | Wraps the selection in a new layer. The selection becomes key 1 at `snap(playhead)` (reuses group-creation world-position preservation) |
| `insertKeyframe()` (F6) | If a key already starts at the playhead, select it. Otherwise insert a key there whose children are **deep duplicates** of the exposed key's children (`duplicateObject` already clones vector/text assets, so editing the new drawing never touches the old). Before the first key it acts like F7 |
| `insertBlankKeyframe()` (F7) | Insert an empty key at the playhead |
| `insertFrames(n = 1)` (F5) | Shift every key with `time > playhead` and `end` right by n frames. Past `end`, it extends `end` to `playhead + 1f` |
| `removeFrames(n = 1)` (Shift+F5) | The inverse. A key whose span collapses to zero is cleared (as below), and `end` never drops below the last key + 1 frame |
| `clearKeyframe()` (Shift+F6) | Delete the key at the playhead and its children. The previous key now holds across the span. Clearing the only key deletes the layer's content but keeps one blank key (`keys` is never empty) |
| `moveFrameKey(id, time)` | Timeline drag. Snaps to frames and is clamped between its neighbours (can't reorder in v1) |
| `setFrameLabel(id, label?)` | |

**Drawing into keys.** `appendObjectToScene` (the shape, path/outline and text
adders already go through it) gets one hook, and the plan audits the remaining insertion
paths (brush commit, paste, duplicate, SVG import, place-symbol) to route through the same hook. When a target layer exists and the playhead is inside
the layer's range, the new object gets `parentId = layer.id` and
`frameKeyId = exposed key at playhead`. If no key covers the playhead (before the first key or
past `end`), a blank key is auto-created there first, which is friendlier than Flash's "can't
draw on an empty frame". With no target layer, behaviour is unchanged.

**Selection & hit-testing.** Unexposed drawings can't be picked on the Stage (visibility does
that) or by marquee (filter by `exposed`). Tweens *inside* a key keep working because a key's
children are ordinary objects. Their keyframes should lie within the key's span, and the
Inspector hints when one doesn't.

### Timeline

A frame layer renders as **one frame-strip row** instead of property lanes:

- frame-grid cells at the current zoom (cell = 1/fps);
- **filled dot** = keyframe with a drawing, **hollow dot** = blank keyframe;
- a held-span bar from each key to the next, an end marker at `end`, and labels as flags;
- click a cell → seek and target the layer; drag a key → `moveFrameKey`; context menu → the
  verbs above.

The layer's children stay collapsed by default. Expanding the row shows the *exposed* key's
children as ordinary rows, so any in-key tweens can be edited. New `TimelineRowVM` fields:
`frameLayer?: { keys: {id, time, end, blank, label?, selected}[]; end: number }`. That's pure VM
data, with the pixel mapping kept in `Timeline.tsx` as today.

### Layers panel

The layer shows as a group with a frame-strip icon. Its children list shows only the **exposed
key's** drawing, titled "Frame N". Visibility and lock cascade unchanged.

### Onion skin (upgrade)

When the target is a frame layer, the ghosts become the **whole drawings** of the previous/next
`ONION_COUNT` keys (`onionSkinTimes(keyTimes, …)`), each rendered at its key's start time:
before = red-tinted, after = green-tinted, opacity falling with distance. The existing
single-object mode is unchanged for non-layer selections. Ghosts stay editor-only chrome and
never reach export.

### Commands & keymap

New `Animation` category commands: `anim.newFrameLayer`, `anim.convertToFrameLayer`,
`anim.insertKeyframe` (F6), `anim.insertBlankKeyframe` (F7), `anim.insertFrame` (F5),
`anim.removeFrame` (Shift+F5), `anim.clearKeyframe` (Shift+F6), `anim.prevKey` / `anim.nextKey`
(jump between the target layer's keys). Visibility comes from command capabilities (enabled
only with a target layer). Browsers reserve F5 for reload, so the keymap must
`preventDefault` it while the editor has focus. The palette entries make sure every verb is
reachable even when it doesn't.

## DSL / MCP / macros (agent parity)

- **DSL**: a new object kind
  `{ type: 'frames', id, x?, y?, end?, keys: [{ time, label?, objects: DslObject[] }] }`.
  `get_dsl` round-trips it.
- **MCP**: `add_frame_layer`, `add_frame_key` (with an optional `copy_previous`),
  `insert_frames`, `remove_frames`, `clear_frame_key`, plus a `layerId` + `time` on the
  existing `add_*` drawing tools to target a key. `describe` lists the keys with their spans and
  object counts.
- **Macro**: `flipbook(project, layerId, drawings[], { fps?, hold = 1 })` builds a layer with
  one key per drawing held `hold` frames each ("on twos" = `hold: 2`), which is the
  agent-friendly path to frame animation.
- `validate`: key ordering and uniqueness, `end > last key`, a `frameKeyId` on a non-child or
  dangling, a non-group with `frames`, and boolean operands inside frame layers.

## Persistence

These are additive optional fields, so no migration is needed: old files lack them, and a
newer file opened in an older build degrades to "every drawing always visible", which is
detectable but not destructive. Bump `meta.version` so older builds can warn. Cloud (M10) stores
the project JSON as-is.

## Testing

- **Engine unit**: `frameKeySpans`, `isExposedAt` (boundaries, half-open end, nested layers,
  inside symbols with remapped time, dangling key ids), `flattenInstances` `exposed` flags, and
  duration with `end`.
- **Store unit**: every verb, including edge cases (F6 before the first key, F5 past `end`,
  Shift+F5 collapsing a key, clearing the only key, locked layer, inside a symbol), and undo/redo
  round-trips. Drawing at the playhead lands in the right key, and a blank key is auto-created.
- **Parity**: Stage == export for a frame-layer fixture at several times, and a no-`frames`
  project stays byte-identical.
- **Export**: the bundle's initial `visibility`, SMIL discrete visibility timing (frame-exact
  keyTimes), and the GIF/video frame where a key swaps.
- **Interactivity**: an M9 `show` override doesn't reveal an unexposed drawing, and an unexposed
  drawing gets no click.
- **e2e**: create a layer, draw frame 1, F6, edit, F7, draw, F5 ×2, scrub and assert which
  drawing shows, onion ghosts visible, export and play.

## Slices (each independently green)

1. **Model + engine + render seam**: types, `isExposedAt`/`frameKeySpans`, the `exposed` leaf,
   FrameItem `visibility`, `renderDocument` initial state, duration, validate. Built and tested
   headlessly through core builders.
2. **Store verbs + draw-into-key + commands/keymap** (no new timeline visuals yet, just palette
   and keys).
3. **Timeline frame strip + Layers panel scoping**.
4. **Onion skin for drawings** + prev/next-key navigation.
5. **Exports**: SMIL visibility, plus a GIF/video e2e.
6. **Agent parity**: DSL kind, MCP tools, `flipbook` macro, a template ("bouncing ball on twos").

## Deferred (explicitly out of scope)

- **Frame-span selection & editing** (select a range of frames across layers, then copy/paste,
  reverse or move them as a block), and multi-layer F5.
- **Shape tween between two keys' drawings** (Flash "Create Shape Tween"). The morph engine
  exists, but key-to-key auto-correspondence across arbitrary multi-object drawings is its own
  spec. Today you can still morph a single path *within* a key.
- **"Convert tween to frame-by-frame"** (bake a tweened object into per-frame keys).
- **Timeline layers for everything** (a Flash-style layer stack where every row is a frame
  strip). Here only frame layers get strips, and other objects keep property lanes.
- **Per-object in/out points** (approach B), lip-sync auto-keying, and frame labels as
  `gotoAndPlay` targets in M9 behaviors (this would be a small follow-up: a `seek` arg that
  takes a label).
- **Pressure-sensitive brush** and a dedicated eraser. These are listed in the M2 polish
  backlog and matter more once frame-by-frame exists, but they're separate slices.
