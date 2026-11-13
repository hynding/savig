# Shape Tween — Slice 2 (agent parity)

Spec: `specs/2026-11-13-shape-tween-design.md` §Agent parity. Builds on slice 1 (PR #17).

## Tasks

1. **Engine.** `bakeShapeTween` and `rebakeLayerTweens` take an optional id minter, so headless
   builds stay reproducible.
2. **Core (`frames.ts`).**
   - `shapeTween(project, layerId, key, { easing })` and `removeShapeTween`. `key` is a key id
     or a time inside the key's span. Both fail loudly on bad input.
   - Minted ids follow `<layer>-tw<n>`. Orphaned drawing assets are pruned.
   - `insertFrames`, `removeFrames`, `clearFrameKey` and `addFrameKey` re-bake. `addFrameKey`
     with `copyPrevious` inside a tween splits it.
3. **DSL.**
   - A frames key can carry `tween: 'shape' | { easing }`. Compile bakes the tweens last to
     first, once every key's drawing exists.
   - Decompile first un-bakes each tween. It writes the start drawing (a static path) plus
     `tween`, and leaves out any grown drawings. Recompiling gives the same DSL back.
4. **describe:** tweened keys end with `→tween` or `→tween(<easing>)`.
5. **MCP:**
   - `shape_tween` and `remove_shape_tween` take `layerId` plus `keyId` or `time`, and
     `easing` is validated.
   - The `load_dsl` help mentions `tween`.
6. **Template:** `shape-tween-morph` (circle → star → square, colours blending).
7. **Tests:** core `shapeTween.test.ts` and an MCP `tools.test.ts` block.
