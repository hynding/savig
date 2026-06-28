# Compound-Ring Node Editing — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Area:** Savig M4 — boolean follow-ups
**Scope:** Node-tool editing of boolean results' compound rings (holes / disjoint pieces)

## Problem

A boolean result is stored as a `path`-shaped `VectorAsset` whose **primary** outline is
`asset.path` and whose holes / disjoint pieces are `asset.compoundRings: PathData[]`. The
Node tool addresses nodes by a single flat `selectedNodeIndex` into the **primary path
only** (`selectEditablePath` / `setPathData`). So today you can node-edit a boolean
result's outer ring, but its compound rings are not addressable and cannot be edited —
an inconsistent tool, made more visible now that boolean results carry **curved** nodes
(curve-preserving slice `f5d4477`).

## Goal

Full node-editing parity on compound rings: move anchor, drag bezier handles, insert
node, delete node, toggle smooth, join/break — on any ring of a boolean result, with the
same chrome and interactions as the primary path.

### Non-goals (v1)

- Deleting an entire ring, or adding/removing whole rings.
- Morphing compound rings (a `ShapeKeyframe` stores one `path`; compound rings have no
  morph track, easings, or correspondence). The primary ring keeps its morph behavior;
  compound rings are static even when the primary morphs. Documented, not a bug.
- Any non-boolean / non-`path` asset behavior change.

## Architecture

The change is **addressing**: extend node selection from a flat `selectedNodeIndex` into
the primary path to a `(selectedNodeRing, selectedNodeIndex)` pair across `path` +
`compoundRings`, and thread that ring through selection state, the store node actions, the
drag-preview model, and the Stage overlay. Ring `0` = the primary `path`; ring `k` =
`compoundRings[k-1]`.

The ring-agnostic pure helpers in `pathEdit.ts` (`deleteNodeAt`, `insertNodeAt`,
`toggleSmooth`, `joinHandle`) operate on any `PathData` and **do not change**.

### Selection state

- New field `selectedNodeRing: number` (default `0`). Reset to `0` everywhere
  `selectedNodeIndex` is reset (object (de)selection, tool changes, etc.).
- `selectNode(index: number | null, ring = 0)` sets both fields. `ring` defaults to `0`
  so all existing callers are byte-unchanged.

### Selectors

- `selectEditableRings(s): PathData[]` — `[primaryEditable, ...asset.compoundRings]`.
  Ring 0 is the existing `selectEditablePath` (morph-sampled at raw `time` when a
  shapeTrack exists, else `asset.path`). Rings ≥1 are the **static**
  `asset.compoundRings[k-1]` (never `samplePath`'d). Returns `[]` / `[primary]` when there
  are no compound rings, so non-boolean assets are unchanged.
- `selectActiveRingPath(s): PathData | null` — the ring addressed by `selectedNodeRing`.

### Write path

`setRingPathData(ring: number, path: PathData, structural?: { index; op })`:

- **ring 0** → delegate to the existing `setPathData(path, structural)` unchanged
  (morph-aware: routes to the shape keyframe at the playhead when morphing, else
  `asset.path`, and detaches any parametric primitive).
- **ring k ≥ 1** → commit `asset.compoundRings[k-1] = path` directly. No shapeTrack,
  `nodeEasings`, or `correspondence` splice — compound rings have none. (Boolean-result
  assets have no `primitive`, so no detach is needed.)

### Per-op routing

`deleteSelectedNode` / `insertNode` / `toggleSelectedNodeSmooth` / `joinSelectedNode`:
read the **active ring's** path (`selectActiveRingPath`), apply the existing `pathEdit`
helper, write via `setRingPathData(selectedNodeRing, …)`. For ring 0 these are
byte-identical to today. `deleteNodeAt`'s existing 2-node floor applies per ring
(deleting a whole ring is out of scope).

### Drag-preview model (the meatiest integration)

`usePathTools` previews an in-progress drag in a single `working: PathData` that the Stage
substitutes for the primary path (`pathTools.working ?? base`) and commits via
`setPathData(w)`. This becomes **ring-aware**:

- `working` carries its ring as `{ ring: number; path: PathData }` (preferred over a
  parallel `workingRing` field so the ring and its preview path can never desync).
- On node/handle press, capture `(ring, node)`; `onMove` rebuilds that ring's path into
  `working`; pointer-up commits `setRingPathData(working.ring, working.path)`.
- The Stage overlay substitutes `working.path` into ring `working.ring` only; every other
  ring renders its committed path.

### Stage overlay

The `selectedPath` memo gains a `rings: PathData[]` field — primary-or-working at index 0,
each compound-or-working at index k — for node rendering. Critically, `selectedPath.path`
and `selectedPath.transform` stay derived from the **primary** path's bounds
(`resolveAnchor(... pathBounds(primary))`), so dragging a hole node never shifts the
object frame. All rings render under the same `transform` (shared object-local frame).

The overlay maps over `rings`, tagging each anchor/handle with `(ring, i)`; click →
`selectNode(i, ring)`; a node highlights when `(ring, i) === (selectedNodeRing,
selectedNodeIndex)`. Bezier handle lines render per ring node. Segment-hit detection for
insert scans **all** rings, so a click on a hole's edge inserts on that ring.

**Morph-only overlays gate to ring 0:** the per-node easing markers (`editedNodeEasings`)
and the correspondence overlay are primary-path / morph constructs; they render only for
ring 0. Compound-ring nodes show plain anchor/handle chrome.

## Edge cases

- **Delete floor:** `deleteNodeAt`'s 2-node floor applies per ring; deleting a ring whole
  is out of scope.
- **Morph + holes:** editing the primary ring of a morphed object routes to its shape
  keyframe (today's behavior); compound rings stay static. Documented.
- **Non-boolean / no compound rings:** `selectEditableRings` = `[primary]`,
  `selectedNodeRing` stays 0 → byte-identical to today.
- **Node-vertex snap:** already treats compound-ring nodes as snap *targets*; a *dragged*
  compound node is in the same frame, so snapping should work unchanged — verify in a test.
- **Stale ring selection:** if an edit removes the addressed ring's targeted index (e.g.
  delete), clear `selectedNodeIndex` (existing behavior) and leave `selectedNodeRing` as
  is or reset to 0 — pick reset-index, keep-ring for predictability.

## Files touched

- `src/ui/store/store.ts` — `selectedNodeRing` state; `selectNode(index, ring)`;
  `setRingPathData`; ring-aware `deleteSelectedNode`/`insertNode`/`toggleSelectedNodeSmooth`/
  `joinSelectedNode`; reset sites.
- `src/ui/store/selectors.ts` — `selectEditableRings`, `selectActiveRingPath`.
- `src/ui/components/Stage/usePathTools.ts` — ring-aware `working` + commit.
- `src/ui/components/Stage/Stage.tsx` — `selectedPath.rings`; overlay iterates rings with
  `(ring, i)` tags; segment-hit across rings; gate easing/correspondence overlays to ring 0.
- `src/ui/components/Stage/pathEdit.ts` — **no change** (helpers are ring-agnostic).
- Tests: `store.test.ts`, a `selectors` test, `usePathTools`/Stage unit or RTL coverage,
  `e2e/` node-edit-a-hole.

## Testing

- **Store (unit):** editing a compound-ring node (move via `setRingPathData`, insert,
  delete, toggle smooth, join) writes `asset.compoundRings[k]` and leaves `asset.path`
  untouched; ring-0 edits remain byte-identical (existing tests stay green); `selectNode`
  ring tracking; non-boolean asset = `selectEditableRings` is `[primary]`.
- **Selectors (unit):** `selectEditableRings` returns primary + compound rings; rings ≥1
  are the static asset rings (not morph-sampled); `selectActiveRingPath` honors
  `selectedNodeRing`.
- **e2e:** create a boolean result with a hole (rect minus interior ellipse), switch to the
  Node tool, drag a hole node and assert the rendered compound path `d` changes; insert a
  node on the hole edge and delete a hole node. Scope stage queries to
  `section[aria-label="Stage"]` (project lesson `293ccf5`).

## Open risks (accepted for v1)

- Compound rings are static under morph (deferred).
- Whole-ring add/delete deferred.
- The ring-aware `working` model is the main complexity; the per-ring fallback is that
  ring 0 behavior is unchanged, bounding regression risk to the primary-path tool.
