# Symbol Content Clipping — Design Spec

**Date:** 2026-06-28  
**Slice:** 47e (Symbol clip)

---

## Problem

A `SymbolAsset` already has `width` and `height` fields (used for library thumbnails). The comment in `types.ts` explicitly notes these are "future clip". Currently a symbol instance's content can overflow those bounds freely. This slice adds an opt-in hard clip.

---

## Proposed Design

### Flag on SymbolAsset

Add `clip?: boolean` to `SymbolAsset` in `src/engine/types.ts`.

- Absent/`undefined`/`false` = no clip (current behavior, byte-identical parity).
- `true` = every instance of this symbol clips its content to `[0, width] × [0, height]`.

This is a **symbol-level** flag (not per-instance) — all instances share the same clip region by definition, since the clip is the symbol's intrinsic content box.

### Clip rect coordinate space

`flattenInstances` emits leaves with a `transformPrefix` that is the composed instance transform (all ancestor instance transforms + group prefix, interleaved). The leaf's own `buildTransform` is then concatenated.

The clip rect `[0, width] × [0, height]` lives in the **symbol's local coordinate space** (origin = symbol's own coordinate origin). To clip correctly in the SVG `userSpaceOnUse` coordinate system:

- The `<clipPath>` element uses `clipPathUnits="userSpaceOnUse"`.
- Inside the `<clipPath>` is a `<rect x="0" y="0" width="W" height="H"/>` with `transform` = the **instance transform** (the `instTransform` computed in `flattenInstances`'s walk, which is `fullPrefix + buildTransform(st, anchorX, anchorY)`).
- All leaves belonging to this instance share this clip rect (they already have `transformPrefix` = `instTransform`, which is the same transform applied to the `<rect>`).

This is correct because:
- The leaves' transforms are `transformPrefix + buildTransform(leaf's own state, ...)`.
- The `transformPrefix` = `instTransform` (the instance's world transform).
- The clip rect carries the same `instTransform`.
- So the clip rect's `[0,W]×[0,H]` is in the same space as a leaf at position `(0,0)` within the symbol — i.e., the symbol's content space.

### What flattenInstances exposes

`flattenInstances` needs to tell the render layers which leaves belong to a clipping instance, and what the instance's transform string is. Two new optional fields on `InstanceLeaf`:

```ts
clipId?: string;        // present iff this leaf is inside a clipping symbol instance
clipTransform?: string; // the instance transform (= the clip rect's transform)
```

All leaves that share the same `clipId` are wrapped under the same `<g clip-path="url(#clipId)">`.

A leaf has `clipId` only for **top-level** clipping instances (v1 scope — see Deferrals).

### InstanceLeaf additions (engine/symbol.ts)

```ts
export interface InstanceLeaf {
  // ... existing fields ...
  /** Present iff this leaf belongs to a clipping symbol instance.
   *  All leaves sharing this id should be wrapped under a clipPath with this id. */
  clipId?: string;
  /** The instance's composed world transform; the clip rect carries this transform.
   *  Present iff clipId is present. */
  clipTransform?: string;
}
```

`flattenInstances` sets these when `asset.clip === true`.

### Export (renderDocument.ts)

1. Build a list of unique `clipId` values from the leaves.
2. For each unique `clipId`, emit a `<clipPath id="clipId" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="W" height="H" transform="clipTransform"/></clipPath>` into `<defs>`.
3. Group the leaves by `clipId` and wrap each clip group under `<g clip-path="url(#clipId)">`.

### Editor Stage (Stage.tsx)

1. Same grouping logic: collect leaves by `clipId`.
2. For each clip group emit a React `<clipPath>` element into `<defs>` (the Stage has a `<defs>` via `buildDefs`).
3. Wrap the clip group's React elements inside a `<g clipPath="url(#clipId)">`.

### Store action

Add `setSymbolClip(symId: string, clip: boolean)` to the store. Mutates `asset.clip` and commits.

### UI

Add a "clip content" checkbox in the Inspector, visible when a symbol instance is selected. It reads from `asset.clip` and calls `setSymbolClip`. This is the most discoverable location since symbol properties already appear there (symbol duration, timing, swap symbol).

---

## v1 Scope / Deferrals

**v1 includes:**
- Top-level (root-scene) clipping instances only.
- Clip is rectangular (the symbol's `[0,W]×[0,H]` box).
- Both editor canvas and export.
- UI toggle in Inspector.

**Deferred:**
- **Nested clipping**: a clipping symbol-inside-a-clipping-symbol. The inner symbol's clip rect must be doubly transformed. V1 only clips at the first (outermost) clipping level; a nested clipping symbol's leaves still get the outer clip but not their own inner clip. A follow-up can add recursive clipId chaining.
- **Rotated clip**: the clip rect itself carries the full instance transform including rotation. SVG `clipPath` with a rotated rect clips correctly in `userSpaceOnUse`. This should work out of the box.
- **Animated clip rect**: the clip box is static (symbol `width`/`height` are static). Future: animating clip bounds.
- **Per-instance clip region**: v1 clips to the symbol's intrinsic box only (same for all instances). Future: per-instance clip overrides.

---

## Parity guarantees

- `clip` absent/false: `InstanceLeaf.clipId` is `undefined`, no `<clipPath>` emitted, behavior is byte-identical to pre-clip.
- Non-symbol scenes: unaffected (they never produce `clipId` leaves).

---

## Test strategy

1. **Unit — symbol.test.ts**: verify `flattenInstances` sets `clipId`/`clipTransform` on leaves of a clipping symbol, and does not set them on a non-clipping symbol.
2. **Unit — renderDocument.test.ts** (jsdom): verify the export emits the `<clipPath>` def and the wrapping `<g clip-path>` for a clipping symbol, and that non-clipping symbols are byte-identical.
3. **E2E — symbols.spec.ts** (Playwright): verify the Inspector "clip content" checkbox toggles, and confirm the Stage renders a `<clipPath>` element when enabled.
