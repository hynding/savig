# Animated Boolean — Slice 2: Authoring — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Area:** Savig M4 — boolean follow-ups (animated boolean milestone, slice 2 of 3)
**Scope:** Author a LIVE boolean from the selection (store action + UI + undo); coexists with the destructive boolean

## Milestone context

Slice 1 shipped the live-boolean GEOMETRY (`SceneObject.boolean = { op, operandIds }` rendered +
animated in the editor) but provided NO way to create one through the UI (constructed
programmatically). Slice 2 adds authoring: an Alt-modifier on the existing boolean
buttons/shortcuts creates a live boolean instead of the destructive (baked) one. Slice 3 =
standalone-export markup + editing/nesting/perf.

## Goal

With ≥2 vector leaves selected, **Alt+**(boolean button or `Cmd/Ctrl+Shift+U/S/I/E`) creates a
live boolean node: a new path object carrying `boolean: { op, operandIds }`, keeping the operands
in the scene (they animate + stay selectable, hidden from direct render by Slice 1's
`flattenInstances` skip), and selecting the result. Undoable. Plain (non-Alt) boolean stays
destructive, byte-identical.

### Non-goals (Slice 2)

- No new buttons or persistent "mode" — the Alt modifier reuses the existing surface.
- GROUP operands for a LIVE boolean (a group operand needs the consumed-skip to cover its whole
  subtree, which Slice 1's leaf-id skip does not) — live operands are non-group leaves only.
- NESTED live booleans (an operand that is itself a live boolean) — excluded from live operands.
- The live boolean's own movable transform/anchor (Slice 1: identity transform + world-space path).
- Standalone-export markup (Slice 3); root-scene only (Slice 1 boundary).

## Architecture

The destructive `booleanOp(op)` action already computes eligibility and the style-source leaf.
The live path reuses those and diverges at result creation: it does NOT clip/bake (Slice 1's
render computes the geometry per frame) and does NOT remove the operands.

### Store action: `booleanOp(op, opts?: { live?: boolean })`

Extend the existing action signature with an optional `opts`. After `eligible` is computed
(store.ts:1808), branch on `opts?.live` BEFORE the destructive bake:

```ts
if (opts?.live) {
  // Live operands = selected NON-GROUP vector leaves that are not themselves live booleans.
  // (Groups + nested live booleans are deferred; see non-goals.)
  const liveOperands = s.selectedObjectIds
    .map((id) => activeObjects.find((o) => o.id === id))
    .filter((o): o is SceneObject => {
      if (!o || o.isGroup || o.boolean) return false;
      const a = project.assets.find((x) => x.id === o.assetId);
      return a?.kind === 'vector';
    });
  if (liveOperands.length < 2) return; // self-gate: never a silent partial op

  const topLeaf = liveOperands.slice().sort((a, b) => b.zOrder - a.zOrder)[0];
  const topAsset = project.assets.find((x) => x.id === topLeaf.assetId) as VectorAsset;
  const asset = createVectorAsset('path', { path: { nodes: [], closed: false }, style: { ...topAsset.style } });
  const label = `${op[0].toUpperCase()}${op.slice(1)}`;
  const obj = createSceneObject(asset.id, {
    name: `Animated ${label} ${nextZOrder(activeObjects) + 1}`,
    zOrder: nextZOrder(activeObjects),
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM }, // identity → world-space path renders at artboard coords (slice 1)
    boolean: { op, operandIds: liveOperands.map((o) => o.id) },
  });
  // KEEP the operands (no removal, no asset prune): just append the result.
  const nextObjects = [...activeObjects, obj];
  let nextProject = withSceneObjects(project, activeAssetId, nextObjects);
  nextProject = { ...nextProject, assets: [...nextProject.assets, asset] };
  get().commit(nextProject);
  set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null });
  return;
}
// ... existing destructive path unchanged (the `if (eligible.length < 2) return` gate, bake, remove) ...
```

The live boolean's `VectorAsset` is path-typed with an EMPTY fallback `path` (Slice 1's Stage
render uses `resolveBooleanRings`, not `asset.path`) and supplies only paint via `style`. The
result is created GLOBAL-asset + active-scene-object exactly like the destructive path, minus the
operand removal and asset prune.

### UI — Alt modifier

- **Inspector** (Inspector.tsx:230-233): each boolean button passes `{ live: e.altKey }`:
  `onClick={(e) => booleanOp('union', { live: e.altKey })}` (and subtract/intersect/exclude).
  Add a `title` to the buttons noting "Alt: animated (live) boolean". `canBool` gating unchanged
  (the live path self-gates internally).
- **Keyboard** (useKeyboard.ts:39-42): each shortcut passes `{ live: e.altKey }`:
  `s.booleanOp('union', { live: e.altKey })` (etc.). The existing `mod && e.shiftKey` guard is
  unchanged; Alt is read additively.

## Edge cases

- **Alt with <2 eligible leaf operands** (e.g. a group + one leaf, or all operands are live
  booleans) → `liveOperands.length < 2` → no-op. No partial/empty result.
- **Non-Alt** → the destructive path runs unchanged (byte-identical; the `opts` default is undefined).
- **An operand is a live boolean** → excluded from `liveOperands` (nested deferred).
- **A group is selected** → excluded from `liveOperands` (group operands deferred); if that leaves
  <2 leaves, no-op.
- **Undo** → the single `commit` snapshots the whole project; undo restores the pre-create state
  (operands were never removed, so nothing to "un-remove").

## Files touched

- `src/ui/store/store.ts` — `booleanOp(op, opts?)` signature + the live branch.
- `src/ui/store/store.test.ts` — live-boolean authoring tests.
- `src/ui/components/Inspector/Inspector.tsx` — 4 buttons pass `{ live: e.altKey }` + titles.
- `src/ui/hooks/useKeyboard.ts` — 4 shortcuts pass `{ live: e.altKey }`.
- `src/ui/components/Inspector/Inspector.test.tsx` (or the existing Inspector test) — Alt routes to live.
- `e2e/boolean-ops.spec.ts` — Alt+boolean creates a result that animates as an operand moves.

## Testing

- **Store (unit):**
  - `booleanOp('union', { live: true })` on two selected rects → a new object with
    `boolean = { op: 'union', operandIds: [a, b] }`, the operands STILL present, the result
    selected; the asset is path-typed with the topmost leaf's style.
  - Undoable: after the live op, `undo()` removes the result and restores selection; the operands
    are unchanged throughout.
  - Self-gates: `{ live: true }` with one leaf + one group selected → no-op (only 1 leaf operand).
  - Excludes nested: `{ live: true }` with a live-boolean object among the selection → it's not in
    `operandIds`; if <2 leaves remain, no-op.
  - Non-live parity: `booleanOp('union')` (no opts) removes operands + bakes, byte-identical to today.
- **Inspector (RTL):** Alt+click a boolean button calls `booleanOp(op, { live: true })`; plain click
  passes `{ live: false }` (or routes to destructive).
- **e2e:** select two overlapping rects, Alt+Union → one result object remains selected and BOTH
  operands persist in the scene; seek the playhead over an animated operand and assert the result's
  rendered `d` changes (reuses Slice 1's live render).

## Open / deferred (later slices)

- Standalone-export initial markup (Slice 3).
- GROUP operands + NESTED live booleans (consumed-skip subtree coverage + recursive resolve).
- The live boolean node's movable transform/anchor.
- "Flatten/bake to static" command; live-as-default model.
- Editing-operand ergonomics, per-frame clip caching (perf).
