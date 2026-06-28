# Boolean — Live Boolean Nested Inside a Group Operand — Design

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Area:** Savig M4 — boolean follow-ups
**Scope:** Resolve a live boolean that sits INSIDE a group when that group is used as a boolean operand

## Context

Slice 3b made a GROUP a valid boolean operand (the group = the union of its vector-leaf descendants)
and a live BOOLEAN a valid operand (resolved via `resolveBooleanGeom` to its raw multipolygon). The
3b whole-branch review found, and we documented, one gap: **a live boolean that is itself a child of
a group operand resolves to empty.** Concretely, `operandWorldGeom`'s group branch collects leaf
descendants via `collectVectorLeaves` and maps each through `objectToWorldPolygon`. A boolean child is
collected as a "leaf" (its `assetId` points to a path `VectorAsset`, so `assetOf` is truthy), but
`objectToWorldPolygon` reads that asset's EMPTY fallback path → `null` → `[]`, silently dropping the
nested boolean's geometry from the group union.

This is benign today (it fails to empty, never wrong geometry or recursion), but it is a correctness
hole: `group{ liveBoolean, rectA }` used as an operand contributes only `rectA`.

## Goal

When `operandWorldGeom` unions a group's leaf descendants, a descendant that is itself a live boolean
contributes its resolved clip geometry (via `resolveBooleanGeom`), not an empty polygon — so a group
containing a boolean acts as the union of `{that boolean's result} ∪ {the group's other leaves}`.

### Non-goals

- Curve preservation for the group/nested result (separate task; stays faceted here).
- SVG-asset descendants of a group (separate task).
- Changing the group-as-union semantics or the cycle guard model.

## Architecture

`operandWorldGeom` already dispatches `obj.boolean → resolveBooleanGeom` for a TOP-LEVEL boolean
operand and threads a `visited` cycle-guard set. The group branch is the one place that bypasses that
dispatch — it calls `objectToWorldPolygon` directly per leaf. The fix routes each collected leaf
through `operandWorldGeom` itself (recursively), so a boolean leaf is resolved, a plain vector leaf
still goes to `objectToWorldPolygon` (identical result), and the `visited` set threads the cycle guard
into the nested resolution.

### The change

`src/engine/geom/boolean.ts`, `operandWorldGeom` group branch (currently ~lines 235-240):

```ts
  // group: UNION of leaf descendants. Route each through operandWorldGeom (not objectToWorldPolygon)
  // so a leaf that is itself a live boolean resolves via resolveBooleanGeom instead of reading its
  // empty fallback path; a plain vector leaf still returns objectToWorldPolygon. `visited` threads the
  // boolean cycle guard into any nested-boolean descendant.
  const leaves: SceneObject[] = [];
  collectVectorLeaves(project, obj.id, leaves, new Set());
  const polys = leaves
    .map((l) => operandWorldGeom(project, l, time, visited))
    .filter((g) => g.length > 0);
  if (polys.length === 0) return [];
  if (polys.length === 1) return polys[0];
  return pc.union(polys[0], ...polys.slice(1));
```

`pc.union` and `.filter(g => g.length > 0)` already accept `PcPolygon | PcMultiPolygon`, so a boolean
leaf returning a multipolygon (holes) unions correctly. `collectVectorLeaves` is unchanged — it still
collects the boolean object as a leaf (now resolved, not dropped) and recurses through nested groups.

## Edge cases

- **Plain vector leaf:** `operandWorldGeom(leaf)` → `!obj.boolean && !obj.isGroup` → `objectToWorldPolygon`
  — byte-identical to the old `objectToWorldPolygon(leaf)` call. PARITY for every group with no boolean
  descendant.
- **Cycle:** a boolean descendant whose operand chain (transitively) reaches an ancestor boolean →
  `resolveBooleanGeom` sees the id in `visited` → `[]` → that descendant contributes nothing. No
  infinite recursion. (Creation can't form such a cycle; this is defense-in-depth.)
- **Nested group inside the group:** `collectVectorLeaves` already recurses; its leaves (incl. nested
  booleans) all route through `operandWorldGeom`.
- **A boolean descendant's operands ALSO being children of the same group** (user placed both the
  boolean and its operand under the group): the operand is counted once inside the boolean's resolved
  result and once as its own collected leaf → double-counted in the union. Harmless for a union (union
  is idempotent over overlapping regions); documented as a benign limitation, not fixed in v1.
- **Empty/degenerate boolean descendant:** `resolveBooleanGeom` → `[]` → filtered out, contributes
  nothing (same as today, but now correctly because it's genuinely empty, not because it was dropped).

## Files touched

- `src/engine/geom/boolean.ts` — the one-line map change in `operandWorldGeom`'s group branch (+ the
  comment).
- `src/engine/geom/boolean.test.ts` — a boolean-inside-a-group operand resolves; parity for a group
  with no boolean descendant.

## Testing

- **Engine (unit):**
  - `group{ booleanB, rectA }` as an operand of an outer boolean: the group's contributed geometry
    spans both `booleanB`'s result region AND `rectA` (was: only `rectA`). Assert the union bounds
    include the boolean's region.
  - **Parity:** a group of plain rects as an operand yields the identical rings to before (the change
    is a no-op when no descendant is a boolean) — pin via an existing-style group-operand fixture.
  - **Cycle safety:** a group containing a boolean whose operand (transitively) references the outer
    boolean → resolves to `[]`/finite, no hang.
- The `operandWorldRings` (3c ghost) and export paths follow for free (both call `operandWorldGeom`).

## Open / deferred

- The double-count edge (boolean + its operand both group children) — benign for union, unaddressed.
- Curve preservation + SVG descendants — separate tasks.
