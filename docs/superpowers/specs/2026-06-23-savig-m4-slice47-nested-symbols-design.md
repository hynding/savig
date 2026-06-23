# Savig M4 — Nested Symbols (Flash-style reusable animated clips)

**Date:** 2026-06-23
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — decomposed into sub-slices; **47a (foundation) is the slice to build now**

---

## 1. Motivation

A *symbol* (Flash "MovieClip") is a reusable, self-contained animated scene that can be
**instanced** many times on the stage. Each instance has its own transform on the parent
timeline; editing the symbol *definition* propagates to every instance. Symbols may contain
other symbol instances (nesting). This is the last remaining M4 headline feature and the
largest single data-model design in the project so far.

The grouping work (45a–45f) already built the two pieces this stands on:

- a **parent/child object tree** (`parentId`) with delete-cascade, Layers nesting, reparenting;
- a **compose-at-compute-time engine** (`groupTransformPrefix`) that prepends a transform
  string onto descendants with **no DOM nesting**, shared by `computeFrame`, `renderDocument`,
  and the editor Stage so that **preview == export**.

Symbols add what groups deliberately are *not*: **reusability** (one definition, many
instances, edit-propagation) and, later, an **independent internal timeline** per instance.

## 2. The core data-model decision

A symbol **definition** is a new `Asset` kind that carries its own self-contained scene:

```ts
export interface SymbolAsset {
  id: string;            // uuid
  kind: 'symbol';
  name: string;
  /** The symbol's own scene graph. Reuses SceneObject + the timeline machinery wholesale;
   *  parentId references resolve WITHIN this list (groups inside a symbol work unchanged). */
  objects: SceneObject[];
  /** Intrinsic size of the symbol's content frame (for the library thumbnail / future
   *  clipping). Not a hard clip in 47a — symbols render un-clipped, like groups. */
  width: number;
  height: number;
  /** The symbol's own timeline length in seconds. Authoritative once independent timelines
   *  land (47c); in 47a it is informational (the internal scene samples at GLOBAL time). */
  duration: number;
}
export type Asset = SvgAsset | AudioAsset | VectorAsset | SymbolAsset;
```

A symbol **instance** introduces **no new object field**: it is an ordinary `SceneObject`
whose `assetId` points at a `SymbolAsset` — exactly parallel to how an SVG-asset object
points at an `SvgAsset` today (`asset.kind === 'svg'` → `<use>`). This is the pivotal choice
and it is what makes the rest fall out cheaply:

- **Instancing** is already "many objects, one assetId" (see `duplicate.ts`, which clones an
  object keeping `assetId` so the asset is shared/instanced).
- **Edit-propagation is free**: all instances read the same `SymbolAsset.objects`, so editing
  the definition is seen by every instance with zero extra machinery.
- **Export already instances assets** through `<defs>`; symbols extend that pathway.
- The instance's own transform **tracks** (x/y/scale/rotation/opacity) animate the instance as
  a whole on the parent timeline, just like any object — no special-casing.

**Rejected alternative — "symbol = a special group."** A group is a one-off container whose
transform composes onto *specific* children by `parentId`; it is not reusable and has no
definition/instance split. Forcing reuse onto groups would mean a group whose children are
"shared" — re-introducing the very `groupId`-style aliasing that 45b removed. An asset
reference is the clean, already-supported instancing primitive. **Chosen: asset reference.**

## 3. The two stacked compositional layers

There are now **two** independent transform-composition layers that *stack*:

1. **Groups** compose transforms *within a single scene* (`groupTransformPrefix` walks
   `parentId` within one `objects[]` list). Unchanged.
2. **Symbol instances** compose a transform **+ a whole sub-scene** (the symbol's `objects[]`)
   **+ (later, 47c) a time remap** on top of layer 1.

For a leaf shape rendered three levels deep — top-level instance A containing instance B
containing a grouped shape S — the full transform is:

```
A.transform ∘ (groupPrefix of A's scene, if A is grouped at top level)
            ∘ B.transform ∘ (groupPrefix within A's symbol scene)
            ∘ (groupPrefix within B's symbol scene) ∘ S.transform
```

i.e. instance transforms and in-scene group prefixes interleave outermost-first, identical in
spirit to how nested-group prefixes already concatenate left→right in SVG.

## 4. Engine architecture — one shared expansion (47a)

The non-negotiable invariant of this codebase is **preview == export**, enforced by a parity
test that pins `computeFrame` (editor Stage painter) and `renderDocument` (export) to identical
output. Symbol expansion MUST therefore live in **one shared function** that all three consumers
call. Introduce it in the engine:

```ts
// engine/symbol.ts  (new)
export interface InstanceLeaf {
  /** Composite render id: the instance-path joined, e.g. "instA/instB/shapeS".
   *  Used as data-savig-object, the runtime nodes-map key, and the React skeleton key.
   *  For a non-instanced object this is exactly the object id (parity). */
  renderId: string;
  /** The leaf SceneObject to draw. Its asset resolves against the GLOBAL assets[]; its
   *  geometry/color/etc. are sampled with the existing per-object `sampleObject`. */
  object: SceneObject;
  /** Fully-composed transform PREFIX to prepend to the leaf's own buildTransform(...): all
   *  ancestor instance transforms AND each scene's in-scene group prefix, already interleaved
   *  outermost-first. Empty for a top-level, ungrouped object. The leaf carries no `scene`
   *  because its parentId group walk is already baked into this prefix. */
  transformPrefix: string;
  /** Product of ancestor-instance opacities (0..1), multiplied into the leaf's own opacity. */
  opacityFactor: number;
  /** The LOCAL time at which to sample this leaf. In 47a this is always the global time
   *  (no remap); 47c makes it remap(globalTime, instanceChain). */
  localTime: number;
}

/** THE single scene-walker (one source of truth for all three consumers). Sorts each scene's
 *  objects by (zOrder, original index); skips render-hidden objects and group containers
 *  (their transform is folded into descendant prefixes via the in-scene groupTransformPrefix);
 *  for an object whose asset is a SymbolAsset, composes the instance transform+opacity and
 *  recurses into that asset's objects; otherwise emits a drawable leaf. Cycle-guarded by a
 *  visited-asset set down each path (a symbol may not contain itself, directly or transitively).
 *  A project with no symbols yields exactly today's flat, ordered, group-composed scene
 *  (parity). To support the in-scene group walk, `groupTransformPrefix`/`parentGroupOf` are
 *  refactored to take a scene `objects: SceneObject[]` instead of the whole `Project`. */
export function flattenInstances(project: Project, time: number): InstanceLeaf[];
```

Consumers:

- **`computeFrame`** maps each `InstanceLeaf` to a `FrameItem` (today's per-object logic, but
  keyed by `renderId`, resolving the asset/anchor from `leaf.object`/`leaf.scene`, prepending
  `leaf.transformPrefix` and multiplying `leaf.opacityFactor`, sampling at `leaf.localTime`).
  A non-instanced object collapses to exactly today's output.
- **`renderDocument`** emits one `<g data-savig-object="renderId">…</g>` (or `<use>`) per leaf,
  using the same prefixes — so two consumers, one expansion, parity by construction.
- **Editor Stage** builds its React skeleton from the same `flattenInstances` leaves, so each
  leaf has a DOM node with `data-savig-object={renderId}` that `applyFrameToNodes` animates.

### 4.1 Sampling at compute time

`flattenInstances` samples ancestor instance transforms with `sampleObject(instance, localTime)`
(the instance animates on the parent timeline) and folds their `buildTransform` strings plus each
scene's `groupTransformPrefix` into `leaf.transformPrefix`. Each consumer then samples the leaf
itself with the existing per-object `sampleObject(leaf.object, leaf.localTime)` — no rewrite of
`sampleProject`/`sampleObject` — applies today's geometry/color/gradient resolution, prepends
`leaf.transformPrefix`, and multiplies `leaf.opacityFactor`. Because the walker is the only
place that skips groups and composes group/instance prefixes, the consumers stop calling
`groupTransformPrefix` and `sampleProject` directly and simply iterate leaves; a symbol-free
project produces byte-identical output (the parity invariant).

### 4.2 Cycle safety

A `SymbolAsset` must never (transitively) contain an instance of itself. Two guards:

1. **Render-time:** `flattenInstances` carries a visited-asset `Set` down each recursion path;
   re-entering an asset already on the path is skipped (renders nothing for that branch) — never
   an infinite loop, even on a corrupted file.
2. **Authoring-time:** the `createSymbol` action and any future "place instance" / swap action
   reject creating an instance whose target symbol already contains (transitively) the symbol
   being authored. (47a only needs guard #1 to be safe; guard #2's authoring checks beyond
   create-from-selection arrive with the library/swap UI in 47d.)

## 5. Export (47a): flatten, don't `<use>`

Static SVG assets export as a `<symbol>`/`<use>` def because they don't animate. A symbol's
internals **do** animate, and — once 47c lands — two instances show **different frames at the
same wall-clock moment**, which a single animated `<use>` def cannot represent. To avoid a
rewrite at 47c, **symbol instances are flattened/inlined from 47a**: `renderDocument` emits each
`InstanceLeaf` as its own node (composite `data-savig-object` id), exactly as vector shapes are
already inlined per-object today, and the runtime animates each leaf at its (eventually
remapped) local time. Cost: export size grows with (instances × internal objects); acceptable
for v1 and documented. A future optimization may collapse *static* symbols back to `<use>`.

## 6. Authoring surface (47a)

- **`createSymbol` store action** (mirrors `groupSelected`): take the selected top-level,
  non-locked objects (≥1; groups allowed as members, same as grouping), **move them out of
  `project.objects` into a new `SymbolAsset.objects`**, and **replace them with a single
  instance** `SceneObject` (assetId = the new symbol) positioned so the result is visually
  identical (the symbol's internal coordinates are kept as-authored; the instance base
  transform is identity, anchor = selection-bbox centre). Undoable via `commit`. Selects the
  new instance.
- **Inspector "Create Symbol" button**, gated like the group button (≥1 eligible object;
  reuses the eligibility pattern). Keyboard shortcut deferred (buttons-only, as boolean ops
  shipped).
- The instance **renders** (flattened), is **selectable** (clicking any flattened sub-node
  selects the owning top-level instance — internals are atomic), shows a **selection highlight**
  (the existing per-node `data-selected` styling lights its leaves), and **moves** as a unit
  (drag-translate + arrow-nudge write the instance's own `base.x/base.y`). Stage hit-testing on
  any flattened sub-node resolves to the owning top-level instance.
- **Deferred to 47b (instance transform UI):** scale/rotate **handles** + a computed bbox
  **outline overlay** (needs a new `instanceAABB`, analogous to `groupAABB`), **move-snapping**
  for instances (a symbol-asset object has no `objectAABB`, so snapping simply no-ops in 47a),
  and **live drag-preview of internals** (an instance has no DOM node of its own, so its leaves
  re-render to the new position on commit rather than tracking mid-drag — the same cosmetic lag
  groups solved with `previewGroupChildren`). These are intentionally bundled with edit mode
  because they share the composed-space handle math; keeping them out of 47a holds the
  foundation slice to the data model + render recursion (the genuinely hard part).

## 7. Scope of 47a (this slice) vs deferred

**In 47a:**

- `SymbolAsset` type + `createSymbolAsset` factory.
- `engine/symbol.ts`: `flattenInstances` (recursive, cycle-guarded, id-namespaced, transform+
  opacity composed, **global-time** sampling) + unit tests.
- `computeFrame`, `renderDocument`, and the Stage skeleton all consume `flattenInstances`.
- `createSymbol` store action + Inspector "Create Symbol" button.
- **Parity**: a symbol made from objects renders byte-identical (modulo composite ids) to those
  objects before symboling, across the timeline; the parity test is extended to cover an
  instance. Edit-propagation provable in a store test (mutate the asset's objects → both
  instances change). Duplicate of an instance shares the assetId (already true via
  `duplicate.ts`).

**Deferred to later sub-slices:**

| Slice | Scope |
|-------|-------|
| **47b — Edit mode + instance transform UI** | Double-click an instance to enter/edit the symbol's internal scene (timeline + Stage scoped to `SymbolAsset.objects`); breadcrumb to exit; individual-internal selection. **Also** the instance-as-a-unit transform UI deferred from 47a: a new `instanceAABB` (union of flattened-leaf boxes through the instance matrix, like `groupAABB`) feeding the selection-outline overlay + scale/rotate handles, instance move-snapping, and live drag-preview of internals (`previewInstanceChildren`, mirroring `previewGroupChildren`). |
| **47c — Independent timelines** | Per-instance time remap: `startOffset` + `loop` vs one-shot (+ optional speed); `localTime = remap(globalTime, instanceChain)`; the engine field is already threaded (`InstanceLeaf.localTime`). This is where two instances diverge in frame. |
| **47d — Symbols library panel** | List symbol defs, drag-to-instance, instance count, swap-symbol, authoring-time cycle guard #2, place-without-selection. |
| later polish | static-symbol `<use>` optimization; symbol content clipping to width/height; per-instance overrides (tint/first-frame); symbol duplicate = new def vs shared. |

## 8. Risks / tradeoffs

- **Stage integration cost.** `Stage.tsx` is ~1934 lines and renders a React skeleton per
  top-level object that the imperative painter animates. Feeding `flattenInstances` leaves into
  that skeleton is the bulk of 47a's UI work; it must not regress non-symbol rendering (parity
  test + existing Stage tests guard this).
- **Composite ids everywhere.** `FrameItem.objectId`, the runtime nodes-map key, export
  `data-savig-object`, and the Stage skeleton key all move from "object id" to "renderId"
  (object id for non-instanced objects, slash-joined path inside instances). `applyFrameToNodes`
  already keys on `item.objectId`, so it works unchanged once ids match on both sides.
- **Selection model.** In 47a an instance is atomic (like a group) and gets selection
  highlight + move, but NOT bbox handles/outline/snapping/live-preview (those need a new
  `instanceAABB` and the composed-space handle math, deferred to 47b). A deliberate limitation
  to keep the foundation slice small; basic move still commits correctly.
- **Global-time internals in 47a** mean all instances of a symbol show the *same* internal frame.
  This is correct-but-limited; 47c lifts it. Nothing in 47a hard-codes global time except the
  one `localTime = time` line, isolated behind `InstanceLeaf.localTime`.

## 9. Testing strategy (47a)

- `engine/symbol.test.ts`: flatten of a non-instanced project == identity; one instance expands
  to its leaves with composed transform/opacity; nested instance composes two levels; a
  self-referential asset is cycle-guarded (finite, renders the safe branches); composite ids are
  unique and stable.
- Extend the **computeFrame/renderDocument parity** test with an instance present.
- `store.test.ts`: `createSymbol` moves objects into a new SymbolAsset + leaves one instance;
  undo restores; duplicate-instance shares assetId; editing the asset's objects propagates to
  all instances.
- Existing Stage / render / engine suites stay green (non-symbol parity).
- An e2e: draw shapes → Create Symbol → instance renders identically; duplicate → second
  instance present.
