# Savig M4 — Recompute Instance Anchor on Swap-Symbol (47d follow-up)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the remaining small 47d library follow-up.

---

## 1. Motivation

`swapSymbol(instanceId, newSymId)` currently repoints only `assetId`, preserving the instance's
transform AND its `anchorX/anchorY`. The anchor is an absolute coordinate in the OLD symbol's content
space (a placed instance gets `anchor = old symbol's content-AABB centre`). When the new symbol has a
different content box, the kept anchor is no longer the new content's centre, so:

- the new content renders OFF-CENTRE relative to the instance's position, and
- rotation/scale pivot about the wrong point (the anchor is the R·S pivot).

The instance visibly JUMPS on swap. Fix: recompute the anchor to the new symbol's content-AABB centre,
and compensate the translation so the pivot's world position is unchanged (no jump).

## 2. Transform math

The instance maps a content point `p` to the stage (from `instanceAABB`'s corner map):

```
world(p) = T + a + R·S·(p − a)        where T = sampled (x, y), a = anchor
```

The anchor `a` is the pivot: `world(a) = T + a` (the `R·S·(a−a)` term vanishes). To keep the pivot's
world position fixed when the anchor changes `a → a'`:

```
T' + a' = T + a   ⟹   T' = T + (a − a')
```

So with `Δ = a − a'` (old anchor minus new content-centre), shift the translation by `Δ`. Since the
old anchor of a placed instance IS the old content-centre, this keeps the **content centre** pinned to
the same world point across the swap.

### Track caveat (absolute x/y)

`sampleObject` resolves `x`/`y` from the **track** when one exists (absolute values), ignoring
`base.x/base.y`; it falls back to `base` only when there is no track. So the `Δ` shift must apply to
BOTH `base.x/base.y` AND every keyframe value in `tracks.x` / `tracks.y` — otherwise an
position-animated instance would jump (base ignored) or its animation would desync.

## 3. Approach (store `swapSymbol`)

```ts
swapSymbol(instanceId, newSymId) {
  // …existing guards: instance exists & is an instance; newSym exists & is a symbol;
  //   assetId !== newSymId; cycle guard (symbolContains) + toast…
  const time = snapToFrame(s.time, project.meta.fps);
  const box = sceneContentAABB(newSym.objects, project.assets, time);
  const repoint = (o: SceneObject): SceneObject => {
    if (!box) return { ...o, assetId: newSymId };          // empty new symbol: nothing to centre on — keep anchor
    const ax2 = (box.minX + box.maxX) / 2;
    const ay2 = (box.minY + box.maxY) / 2;
    const dx = o.anchorX - ax2;
    const dy = o.anchorY - ay2;
    const shift = (kfs: Keyframe[] | undefined, d: number) =>
      kfs ? kfs.map((k) => ({ ...k, value: k.value + d })) : undefined;
    const tracks = { ...o.tracks };
    const tx = shift(tracks.x, dx); if (tx) tracks.x = tx;
    const ty = shift(tracks.y, dy); if (ty) tracks.y = ty;
    return {
      ...o,
      assetId: newSymId,
      anchorX: ax2,
      anchorY: ay2,
      base: { ...o.base, x: o.base.x + dx, y: o.base.y + dy },
      tracks,
    };
  };
  get().commitActiveScene(objects.map((o) => (o.id === instanceId ? repoint(o) : o)));
}
```

`sceneContentAABB` is already imported in the store (used by `placeSymbolInstance`). The function is
unchanged when the new symbol is empty (`box` null → bare `assetId` repoint, preserving today's
behaviour for that edge). `symbolTime` and every other field are preserved (spread).

## 4. Scope

**In:** anchor recompute + base/track-keyframe Δ-compensation in `swapSymbol`; unit tests.

**Out / unchanged:**
- `placeSymbolInstance`/`placeSymbolInstanceAt` (already centre the anchor at create-time).
- The cycle guard, toast, active-scene routing — unchanged.
- Engine/render — untouched (store-only transform edit).

## 5. Parity, regression-safety, undo

- **Parity:** store-only data edit; no `flattenInstances`/render change → preview==export intact.
- **Regression-safe:** swap to an EMPTY symbol keeps the old behaviour (bare repoint). Swap between
  same-content-box symbols → `Δ = 0` → byte-identical to a bare repoint.
- **Undo:** one `commitActiveScene` — undoable as before.

## 6. Risk / tradeoff

- **Custom anchors are re-centred.** If a user manually moved the anchor off the content centre, swap
  re-centres it (and keeps that OLD anchor's world position fixed). This is the sensible default for a
  "use a different symbol here" action; documented. (A "preserve custom anchor on swap" option is out
  of scope.)

## 7. Testing strategy

`store.test.ts`, `describe('swapSymbol anchor recompute (47d)')`:
- Two symbols whose content boxes have DIFFERENT centres (e.g. symA centre (5,5), symB centre
  (20,20)); an instance of A at a known `base`, `anchor = (5,5)`. After `swapSymbol(inst, 'B')`:
  - `anchorX/anchorY === (20,20)` (new content centre).
  - the pivot world position `base + anchor` is INVARIANT: `base'.x + anchorX' === base.x + 5`, etc.
    (i.e. `base'` shifted by `Δ = (5−20, 5−20) = (−15,−15)`).
- An instance of A WITH an `x`/`y` track: after swap, every `tracks.x`/`tracks.y` keyframe value is
  shifted by the same `Δ` (and base too).
- Swap to an EMPTY symbol (no objects): anchor unchanged, only `assetId` repointed.
- Undo restores the pre-swap instance exactly.
