# Savig M4 — Author Inside a Symbol, Phase 7: In-Symbol Group / Boolean

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the seventh "author inside a symbol" follow-up to 47-edit. Phases 1 (delete),
2 (draw), 3 (node-edit), 4 (paint), 5 (layers-mutators), 6 (clipboard) are merged. This routes
`groupSelected` / `ungroupSelected` / `booleanOp` to the active scene.

---

## 1. Motivation

`groupSelected`, `ungroupSelected`, and `booleanOp` all resolve the ROOT `project.objects`. Inside a
symbol the selected ids live in the symbol's `objects[]`, so today these actions either no-op (find
nothing) or — for boolean — would world-bake against the wrong scene and write the result to the root.
The Inspector already reads `selectActiveObjects` and gates the Group/Union/… buttons on the active
scene (47-edit), and Cmd+G / Cmd+Shift+G already fire in edit mode, so this slice is purely store-side:
make the three actions operate on the active scene.

## 2. The seam, applied

### 2.1 `groupSelected` / `ungroupSelected` — pure `objects[]` restructures

Both build a new scene `objects[]` array (group: add a container + set members' `parentId`; ungroup:
bake the group transform into children + reparent to the first surviving ancestor + drop the
container). Routing = scope every scene read to `selectActiveObjects(s)` and write the array via
`commitActiveScene(objects)`:

| Action | Reads to re-scope (root `project.objects` → `selectActiveObjects(s)`) | Write |
|--------|----------------------------------------------------------------------|-------|
| `groupSelected` | the `targets` lookup; `groupAABB(o, objects, …)` child-walk; the `objects.map(set parentId)` | `commitActiveScene(objects)` |
| `ungroupSelected` | the `groups` lookup; the `objects.map(bake + reparent).filter(drop containers)` | `commitActiveScene(objects)` |

Asset lookups (`objectAABB`/`groupAABB`/`resolveObjectAnchor` reading `project.assets`) stay GLOBAL —
a group has no asset (`createGroupObject` sets `assetId: ''`), and children reference global assets.
`bakeGroupIntoChild` operates on the group + child directly (no scene lookup). The group's anchor =
the selection-bbox centre, computed from the active scene's boxes; at the root nothing changes.

### 2.2 `booleanOp` — world-bake + new asset + cross-scene prune

`booleanOp` selects ≥2 non-group vector operands, world-bakes each outline through its object+group
transform chain (`booleanOpEngine`), clips via `polygon-clipping`, and destructively replaces the
sources with one new `VectorAsset` (holes/disjoint pieces as `compoundRings`). Routing:

1. **Eligible read** → `selectActiveObjects(s)` (assets still global for the `kind === 'vector'` gate).
2. **World-bake scene** — pass a SCENE-SCOPED project `{ ...project, objects: selectActiveObjects(s) }`
   to `booleanOpEngine`. The engine's `toWorld` walks `parentGroupOf(project.objects, obj)`; scoping
   `project.objects` to the active scene makes an intra-symbol group's transform compose correctly. NO
   engine change. At the root `selectActiveObjects(s) === project.objects`, so the bake is byte-identical.
   (For the common case — operands top-level in a symbol with no intra-symbol group — there is no parent
   group, so even the unscoped engine would be correct; the scoping makes the grouped case correct too.)
3. **zOrder / removal** over the active scene (`nextZOrder(selectActiveObjects(s))`, the
   `filter(!removed)` over the active scene).
4. **New asset GLOBAL, new object ACTIVE scene** — the same asset/object split phases 2/6 use. Build
   the post-op project with a NEW pure helper `withSceneObjects(project, activeAssetId, objects)` (write
   the active scene's whole `objects[]`), then append the new `VectorAsset` to GLOBAL `project.assets`.
5. **Cross-scene, symbol-preserving prune** of the now-orphaned SOURCE vector assets — the SAME
   predicate phase-1 delete uses, NOT the current active-scene-only check (which would wrongly prune a
   vector asset shared with another scene):

```ts
const candidateAssetIds = new Set(eligible.map((o) => o.assetId)); // the boolean sources
const referenced = collectReferencedAssetIds(nextProject);          // root + ALL symbol scenes
const prunedAssets = nextProject.assets.filter((a) => {
  if (!candidateAssetIds.has(a.id)) return true;   // not a source -> keep
  if (a.kind === 'symbol' || a.kind === 'audio') return true; // never pruned by a boolean (sources are vector anyway)
  return referenced.has(a.id);                     // a source vector asset: keep only if still referenced somewhere
});
```

6. Single `commit(nextProject)` + select the new object.

### 2.3 The `withSceneObjects` helper (+ `commitActiveScene` refactor)

`commitActiveScene` already encodes "write the active scene's `objects[]` into a project". Extract its
body as a pure helper so `booleanOp` can build the post-op project without committing yet:

```ts
// Write the active scene's whole objects[] into a project (root project.objects, or the edited
// symbol's objects[]). The array-write dual of sceneObjectsOf. (phase 7)
function withSceneObjects(project: Project, activeAssetId: string | null, objects: SceneObject[]): Project {
  if (!activeAssetId) return { ...project, objects };
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects } : a,
    ),
  };
}
```

`commitActiveScene(nextObjects)` becomes `get().commit(withSceneObjects(s.history.present,
selectActiveAssetId(s), nextObjects))` — byte-identical behaviour.

## 3. Edit-propagation, parity, undo

- **Edit-propagation** is automatic: regrouping / boolean-replacing a symbol's `objects[]` is rendered
  by every instance via `flattenInstances`.
- **Parity (preview == export)** is untouched — `booleanOp`/group/ungroup are authoring ops, not the
  render path; `booleanOpEngine`/`flattenInstances`/`computeFrame`/`renderDocument` are unchanged.
- **Undo/persistence** unchanged: each action is one whole-project commit.
- **No UI/keyboard change:** the Inspector multi-select panel already reads `selectActiveObjects` and
  gates Group/Ungroup/Union/… on the active scene; Cmd+G / Cmd+Shift+G already fire in edit mode.

## 4. Scope (this slice) vs deferred

**In:** route `groupSelected`, `ungroupSelected`, `booleanOp` to the active scene; the `withSceneObjects`
helper + `commitActiveScene` refactor; the boolean cross-scene asset prune; tests (store + e2e).

**Deferred (remaining author-in-symbol phases):** motion paths inside (route motion-path attach/detach
+ add `motion` to `SYMBOL_EDIT_TOOLS`), advanced morph fine-tuning (per-node easing / correspondence —
currently root-resolved, guarded to a safe no-op in a symbol).

## 5. Risks / tradeoffs

- **Boolean cross-scene prune is a strict improvement, not byte-identical at the root:** the old prune
  dropped a source vector asset when it was unreferenced in the active scene's objects; the new prune
  keeps it if it is referenced in ANY scene (root + symbols). Since vector assets are 1:1 with objects
  in normal flows, the only behavioural change is the bug fix (a shared vector asset is no longer wrongly
  pruned) — mirroring phase-1's delete fix. Existing root boolean tests (no cross-scene sharing) are
  unaffected.
- **Engine bake scoping:** passing `{ ...project, objects: activeObjects }` is sufficient because the
  engine reads `project.objects` only for `parentGroupOf` and `project.assets` (kept global) for the
  outline; no other root coupling exists in `booleanOp`.
- **Root behaviour byte-unchanged** for group/ungroup (`commitActiveScene` at root ≡ `commit({…objects})`)
  and for the boolean bake/zOrder/removal; only the prune predicate is the documented improvement.

## 6. Testing strategy

- `store.test.ts` (objects inside a symbol, in edit mode):
  - `groupSelected` on two internal objects → the symbol's `objects[]` gains a group container and the
    two become its children (`parentId` set); root untouched; both instances reflect the group.
  - `ungroupSelected` on an internal group → the group is dissolved inside the symbol, children freed
    (baked transform), container removed.
  - `booleanOp('union')` on two overlapping internal vector objects → the symbol's `objects[]` replaces
    the two sources with one new path object referencing a NEW global vector asset; the two source
    objects are gone from the symbol; root untouched.
  - boolean cross-scene prune: a vector asset shared by a boolean SOURCE inside a symbol AND a root
    object is KEPT after the in-symbol boolean (referenced at root); a source asset used only by the
    sources is pruned.
  - root group/ungroup/boolean unchanged (regression: a root boolean still replaces + prunes its 1:1
    source assets).
- e2e: create a symbol with two overlapping parts and two instances, enter it, select both parts,
  Union → the symbol now renders one merged part, so each instance shows ONE leaf (2 total); exit.
