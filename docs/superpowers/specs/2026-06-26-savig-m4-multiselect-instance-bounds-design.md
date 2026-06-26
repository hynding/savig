# Savig M4 — Multi-Select Bounds Span Groups & Instances (47b polish)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — a bounded 47b/grouping correctness fix.

---

## 1. Motivation

The multi-select scale-handle box (`groupBounds` in `Stage.tsx`) is the union of the selected
objects' stage AABBs. For a selection of **>1** objects it builds that union with:

```ts
const a = objectAABB(o, assetsById.get(o.assetId), time);
```

`objectAABB` resolves a bbox via `resolveObjectAnchor`, which returns `null` for any asset that is
not `vector`/`svg` — i.e. for a **symbol instance** (asset kind `symbol`) and for a **group
container** (no `assetId` at all). So when a marquee or shift-select includes an instance or a group,
that entity contributes **nothing** to the union and the scale-handle box is too small — it clips the
instance/group out of the selection rectangle.

The single-select branch already handles this correctly: it special-cases `groupAABB` (group) and
`instanceAABB` (instance). And the codebase already exposes the right dispatcher,
`entityAABB(obj, objects, assets, time)`, documented as "the single entry point Stage uses for
selection bbox so all three kinds compose." The multi-select branch was simply never migrated to it.

## 2. Approach

Extract the multi-select union into a small pure helper in `snapping.ts` that dispatches through
`entityAABB`, and call it from `Stage.tsx`. This both fixes the bug and makes the union
unit-testable without RTL.

### 2.1 New helper — `multiSelectionAABB`

```ts
// The union AABB of a MULTI-selection (slice 47b polish): each selected object contributes its
// entityAABB, so groups and symbol instances are included — not just plain vectors. Hidden/locked
// objects are skipped (they are not transformable). Null when nothing contributes.
export function multiSelectionAABB(
  ids: string[],
  objects: SceneObject[],
  assets: Asset[],
  time: number,
): AABB | null {
  const boxes: AABB[] = [];
  for (const id of ids) {
    const o = objects.find((x) => x.id === id);
    if (!o || o.hidden || o.locked) continue;
    const a = entityAABB(o, objects, assets, time);
    if (a) boxes.push(a);
  }
  return groupBBox(boxes);
}
```

This mirrors the existing inline loop exactly except `objectAABB(...)` → `entityAABB(...)`. Plain
vector/svg objects are unchanged (`entityAABB` falls through to `objectAABB` for them).

### 2.2 `Stage.tsx` — call the helper

Replace the inline `>1` loop in the `groupBounds` useMemo:

```ts
if (selectedIds.length <= 1) return null;
return multiSelectionAABB(selectedIds, project.objects, project.assets, time);
```

Add `multiSelectionAABB` to the existing `./snapping` import. The single-select branch (group /
instance / plain) is unchanged.

## 3. Scope

**In:** the `multiSelectionAABB` helper; the `Stage.tsx` call-site swap; unit tests.

**Out / unchanged:**
- Single-select bounds, snapping, scale/rotate/resize handles, drag — untouched.
- Engine/store/serialization — untouched.
- No render-pipeline change.

## 4. Regression-safety & parity

- **Parity (preview == export):** this is editor-chrome (selection handles) only — it never touches
  `flattenInstances`, `computeFrame`, or `renderSvgDocument`. Parity is untouched by construction.
- **Regression-safe for plain selections:** for a multi-selection of only vector/svg objects,
  `entityAABB` === `objectAABB`, so the union is byte-identical to before.
- `hidden`/`locked` skip and the `groupBBox([]) -> null` empty case are preserved.

## 5. Testing strategy

- **Unit (`snapping.test.ts`), `describe('multiSelectionAABB (47b polish)')`:**
  - A selection of a plain 10×10 vector at (0,0) **and** a symbol instance (10×10 content)
    translated to (100,50): the union spans `{minX:0, minY:0, maxX:110, maxY:60}` — proving the
    instance is no longer dropped (under the old `objectAABB` path `maxX` would be 10).
  - A selection including a **group container** (two children) contributes the group's mapped box to
    the union (asserts the union extends past a single plain sibling).
  - `hidden`/`locked` members are skipped; a selection of only hidden/locked members → `null`.
  - Plain-only selection unchanged (a vector pair unions to the same box as before).
- Full unit suite + typecheck + lint green; symbols e2e unaffected (no e2e change).
