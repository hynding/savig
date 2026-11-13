# Shape Tween Between Frame Keys — Design

**Date:** 2026-11-13
**Status:** complete (slice 1 PR #17, slice 2 agent parity). Steve said "continue on all in order" (filters → shape tween → bone tool).

## Goal

Flash's **Create Shape Tween** on a frame-by-frame layer. You pick a key, and its drawing morphs
smoothly into the next key's drawing over the span between them. The morph covers outline, fill
and stroke colour, and opacity. Today a frame layer can only *hold* each drawing until the next
key (spec 2026-11-07 deferred this).

What a user can do when this ships:

1. Put the playhead on a key of a frame layer that has a following key. Run **Create Shape Tween**
   from the timeline, the palette, or the Inspector. The span between the two keys turns into a
   tween, and the timeline shows it as a tinted band with an arrow, as in Flash.
2. Scrub, play or export. The drawing morphs from key A's shape to key B's shape. Fill and stroke
   colours blend, and opacity blends. Extra drawings with no partner on the other side grow out of,
   or shrink into, their own centre.
3. Pick an easing for the whole tween.
4. Edit either key's drawing, then run **Update Shape Tween** (the same command) to re-derive it.
5. **Remove Shape Tween** to get key A's static drawing back.
6. Agents get the same thing through the DSL (`tween: 'shape'` on a key), MCP and describe
   (slice 2).

## Approach decision

| Option | Verdict |
|---|---|
| **A. Bake into existing primitives.** Key A's drawings become path objects whose `shapeTrack` / `colorTracks` / opacity track run from A's shape at A's time to B's shape at B's time. The key records `tween: { kind: 'shape', … }`. | ✅ Chosen. Every renderer (Stage, runtime, SMIL, raster, MCP render) already morphs a path inside a key and exposes it only for the key's span. So a tween needs **no new render code** and gets export parity for free. The result can also be edited with the shape-keyframe tools that already exist. |
| B. Render-time tween: the walker synthesizes interpolated drawings for a tweened span. | Rejected. Rect and ellipse drawings would need synthetic path assets that no renderer can resolve. It also adds per-frame derivation to the shared walker and doesn't reuse the morph editing UI. |
| C. A new "tween drawing" asset kind. | Rejected for the same reasons as B, plus a new asset kind that every exporter would need to understand. |

The trade-off of A is that it is **not live**. Editing B's drawing after creating the tween leaves
the tween stale until **Update Shape Tween** is run. Flash re-derives automatically. For v1, the
command is idempotent and re-bakes from the current drawings. Key *timing* edits re-bake
automatically; re-baking on edits to key B's drawing is deferred (see below).

## Model

```ts
interface FrameKey {
  // …
  /** Shape tween from this key's drawing to the NEXT key's drawing over [time, nextKey.time). */
  tween?: { kind: 'shape'; easing?: Easing; created?: string[] };
}
```

`created` lists the ids of objects the tween added to key A for B drawings that had no partner.
Remove deletes them. **No format bump is needed.** The baked tracks are ordinary v10 data, so an
older build plays the morph correctly and simply ignores the marker. The sanitizer drops a
malformed `tween`.

## Engine (`frameTween.ts`)

- `tweenableDrawing(obj, asset)`: a direct child leaf that is a vector rect, ellipse or
  single-ring path. It must not be a live boolean and must have no `compoundRings`. Text, svg,
  symbols, groups and compound paths are left alone and keep holding.
- `layerLocalPath(obj, asset, time)`: the drawing's outline as `PathData` in the **layer's local
  space**.
  - A rect gives 4 corners. An ellipse gives 4 kappa cubics. A path gives its sampled path.
  - The path is then mapped through the drawing's own transform (`worldTransformNode` with a
    one-link chain), so curves and handles survive.
- `bakeShapeTween(objects, assets, layerId, keyId, { easing })` returns `{ objects, assets, tween }`
  or `{ error }`.
  1. Find B, the key after A. If A is the last key, return an error.
  2. List the tweenable drawings in A and in B, sorted by `zOrder`. Pair them by index.
  3. Each A drawing in a pair becomes a **path** object with the same id (links such as
     `maskedBy` survive), a fresh path asset, an identity base transform and no transform tracks.
     - `shapeTrack`: A's path at `A.time` (easing = the tween's easing, `morph: 'resampled'`
       unless both paths have equal node counts and match closed/open), then B's path at
       `B.time`.
     - `colorTracks.fill` / `colorTracks.stroke`: only when both ends are solid colours, they
       differ, and neither is `none`. Gradients hold A.
     - Opacity track: only when the opacities differ.
     - `strokeWidth` holds A.
  4. An A drawing with no partner morphs into its own centroid (a point), so it shrinks away.
  5. A B drawing with no partner gets a new object in key A that grows from B's centroid into B's
     shape. Its id goes into `created`.
  6. Running it again on an already-tweened key first removes the old tween and then bakes from
     the A drawings' path at `A.time`.
- `removeShapeTween(objects, layerId, keyId)` deletes `created`, strips the morph, colour and
  opacity tracks, and leaves each A drawing as a static path at its `A.time` shape.

## Editor (slice 1)

- Store (`frameLayerSlice`):
  - `createShapeTween(easing?)` and `removeShapeTween()`, acting on the target frame layer's key
    at the playhead (the F5/F6/F7 targeting rules).
  - Each is one undo step. Each explains a refusal (last key, nothing tweenable) with a toast.
- Commands:
  - `anim.createShapeTween` and `anim.removeShapeTween` (palette, Animation category, next to the
    F5/F6/F7 commands).
  - The timeline strip's right-click frame menu: Create / Update / Remove Shape Tween.
- Key timing edits keep tweens in step: F5, Shift+F5, F7, Shift+F6 and dragging a key re-bake
  every tween on the layer (`rebakeLayerTweens`, last key first); a tween whose key became the
  last one is removed. F6 inside a tween splits it Flash-style: the new key's drawing is the
  in-between shape (`freezeTweenedDrawing`) and both halves stay tweened.
- Timeline: a key with `tween` paints its span as a tinted band with an arrow (`data-tween`).
- Inspector: when a frame layer is targeted, add a row with "Shape tween: on/off" and an easing
  select.
- e2e: draw a rect on key 1 and an ellipse on key 2, create the tween, and check that the path
  `d` at mid-span differs from both ends. Then undo and remove.

## Agent parity (slice 2)

- Core `shapeTween(project, layerId, key, { easing })` and `removeShapeTween(project, layerId, key)`,
  where `key` is a key id or a time inside its span. The frame builders (`insertFrames`,
  `removeFrames`, `addFrameKey`, `clearFrameKey`) re-bake like the editor does. Minted ids are
  reproducible (`<layer>-tw<n>`, via `bakeShapeTween`'s `newId` option), so templates stay
  byte-stable.
- DSL: a frames key can carry `tween: 'shape' | { easing }`. Compile bakes it after every key is
  built. Decompile writes key A's drawings at their `A.time` shape (from `shapeTrack[0]`), leaves
  out `created`, and writes `tween`. The round trip is exact as long as B is unchanged.
- describe marks tweened keys `→tween`. MCP adds `shape_tween` and `remove_shape_tween`. A
  template: "Shape tween morph" (a circle becomes a star becomes a square, on a frame layer).

## Testing

- Engine: pairing, unequal counts (shrink and grow), rect/ellipse to path, transforms baked
  (rotated or scaled drawing), colour, opacity and gradient rules, last-key error, re-bake
  idempotence, remove.
- Render: a mid-span frame is a morphed path in the runtime and in SMIL (`animate d`), and a
  resvg pixel shows the in-between colour.
- Store, VM and e2e in slice 1; DSL and MCP in slice 2.

## Deferred

- Automatic re-bake when key B's drawing changes.
- Shape hints (Flash's manual correspondence points). The existing correspondence editor works on
  the baked `shapeTrack` and can stand in for them.
- Tweening text, symbols and groups. Compound paths (holes).
- Motion/classic tweens between keys (those are already ordinary property tracks).
