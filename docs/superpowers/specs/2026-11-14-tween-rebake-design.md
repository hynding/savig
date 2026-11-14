# Automatic shape tween re-bake — design

Status: approved direction (Steve, 2026-11-14 evening: "work on each in order"). Closes the first
item of the shape tween spec's Deferred list (`2026-11-13-shape-tween-design.md`).

## Problem

A shape tween is baked: the start drawing carries a two-key `shapeTrack` toward the end
drawing's look at bake time. Editing either drawing afterwards (move, resize, recolour, node edit,
add or delete a drawing on either key) left the morph aimed at the old shapes until the user
pressed Update.

## Behaviour

Every store `commit` compares the project before and after the edit, for each object list (root,
each scene, each symbol). A tween on key K (with next key K′) is **stale** when:

- the frame layer's key list is unchanged (key timing edits already re-bake themselves), and
- a drawing on K or K′ was added, removed or replaced, or its asset was replaced.

Stale tweens are re-baked inside the same commit (last key first, so chained tweens read fresh
neighbours), keeping easing and hints; one that can no longer bake is removed, as key edits do.
Orphaned assets are pruned. The user's edit and the re-bake are ONE undo step.

**Left alone:** a start drawing whose morph has more than two keys (hand-tuned in-between
shapes), so auto re-bake never wipes manual work; Update still re-bakes it on request.

## Code

- engine `staleShapeTweens(prev, next, prevAssets, nextAssets)` and
  `rebakeShapeTweens(objects, assets, stale)` (frameTween.ts), pure.
- editor-state `autoRebake.ts` `autoRebakeTweens(prev, next)` + `pruneOrphanedAssets` (moved from
  the frame layer slice), called from `commit`.
- Agents (core builders) already bake through `shapeTween`; their drawing edits are out of scope
  for this slice (the editor is where drawings are hand-edited).

## Tests

Engine detection/re-bake rules; store (end/start drawing edits, undo is one step, unrelated edits
keep objects reference-equal); e2e drag of the end drawing updates the mid-tween shape, undo restores.
