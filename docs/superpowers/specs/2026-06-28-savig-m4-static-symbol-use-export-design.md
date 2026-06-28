# Design: Static-symbol `<use>` export optimization

**Date:** 2026-06-28  
**Author:** Claude  
**Slice:** 47g (export optimization)  
**Status:** APPROVED — implement per the plan

---

## Problem

Today `renderSvgDocument` flattens every symbol instance into inlined per-leaf elements via
`flattenInstances`. N instances of one symbol inline the symbol's content N times, bloating the
exported `.svg`/`.html` file. A project with 50 badge instances of a 20-element symbol produces
1,000 leaf elements where 20 in `<defs>` + 50 `<use>` would suffice.

---

## Solution

When a symbol instance is fully **STATIC** (nothing in it or about it animates), emit the symbol's
content once into `<defs>` as a `<g id="savig-sym-<assetId>">`, and render each static instance as
a single `<use href="#savig-sym-<assetId>" transform="…" opacity="…">`.

The editor Stage is **untouched** (it needs live leaves for selection/editing). The runtime bundle
is **untouched** (static symbols carry no animation; the runtime only touches animated leaves).

---

## Static predicate: `isStaticSymbol(asset, assets)` + `isStaticInstance(instance, assets)`

A `SymbolAsset` is **static** (content-static) iff:
1. `symbolEffectiveDuration(asset) === 0` — no object keyframe tracks set a non-zero time.
2. Every nested symbol instance inside the symbol (objects whose assetId points at a `SymbolAsset`)
   is itself content-static AND instance-static (no per-instance timing fields that differ from
   parity). This is checked recursively with a visited-set cycle guard (mirrors `symbolContains`).

A `SceneObject` (instance) is **instance-static** iff:
- `freezeFirstFrame` is absent/false — parity, but a statically-true freeze on an already-static
  symbol is actually fine; however it adds complexity to reason about so we conservatively exclude it
  (the symbol has no animation to freeze anyway, but detecting this safely requires more reasoning).
- No `symbolTimeTrack` (no keyframed time remap).
- No `symbolTime` with a non-identity remap. A non-identity `symbolTime` on a static symbol has no
  visual effect, but detecting "is this remap a visual no-op" requires additional reasoning; v1
  conservatively excludes any instance that carries a `symbolTime` field.
- No `tint` override — see Clip/Tint scope below.

A symbol instance is optimizable iff `isStaticSymbol(asset) && isStaticInstance(instance)`.

**Rationale for conservative exclusions:**
- `freezeFirstFrame=true` on a static symbol: no-op visually, but the instance might not have been
  the author's intent to optimize; exclude for clarity.
- `symbolTime` on a static symbol: remaps a zero-duration timeline — always returns 0 regardless,
  so visually identical. But checking this correctly requires `symbolEffectiveDuration(asset)===0`
  again, and the compound logic is fragile. Conservative exclusion is safer for v1.
- `symbolTimeTrack` any non-empty track: the engine would animate the time-remap cursor even on a
  static symbol (the cursor does nothing but the track is still "animation present"). Exclude.

---

## Def shape

For each used static symbol, emit into `<defs>`:

```xml
<g id="savig-sym-<assetId>">
  <!-- flattenInstances of symbol's OWN scene at t=0, with basePrefix="" idPrefix="" opacity=1 -->
  <!-- each leaf rendered as its renderLeaf() output -->
</g>
```

The `<g>` coordinate system is the symbol's own local space (origin at the symbol origin, no
instance transform applied). The instance transform is applied on the `<use>` element instead.

Each static instance in the body:
```xml
<use data-savig-object="<instanceId>" href="#savig-sym-<assetId>" transform="<instanceWorldTransform>" opacity="<instanceOpacity>"/>
```

Where `instanceWorldTransform` = the composed transform of the instance itself (including any
ancestor group prefix) — identical to what `flattenInstances` sets as `instTransform` for that
instance's leaves.

**Dedup:** Collect `usedStaticSymIds` (Set) — emit each def once, ordered for determinism.

---

## Coordinate space correctness

`flattenInstances` for a leaf inside a symbol instance computes:
```
leaf.transformPrefix = instTransform (= groupPrefix + instance buildTransform)
leaf full transform  = leaf.transformPrefix + " " + buildTransform(leafState, anchorX, anchorY)
```

The `<use>` replaces all leaf elements. The `<use>` needs to place the symbol's local-space `<g>`
content exactly where the leaves would have been. This is accomplished by setting:
```
use.transform = instTransform (the instance's world transform, without any leaf-internal offset)
```

The symbol's `<g>` def is in local space (origin at the symbol's (0,0)). Each leaf inside it
is rendered with its own `buildTransform(leafState, anchorX, anchorY)` relative to the symbol
origin — which is already what `renderLeaf` produces when `transformPrefix=""`.

This means: to produce the static symbol def, we call a helper that walks the symbol's `asset.objects`
at t=0 with empty prefix/idPrefix/opacity=1, collecting leaf HTML strings via `renderLeaf`-style
rendering, and wraps them in `<g id="savig-sym-<assetId>">`. These are STABLE (no per-instance
info needed).

---

## Clip/Tint scope (v1)

**v1 restriction:** Only optimize instances that are:
- NOT clipped (`asset.clip` absent/false, or check via leaves — but the simpler check is on the asset)
- NOT tinted (`instance.tint` absent)

**Rationale:** Composing `<use>` with clip/tint wrappers is feasible but adds complexity:
- A clipped static instance would need: the `<use>` inside a `<g clip-path="url(#clip-<id>)">`.
  The clipPath def is per-instance (it carries the instance transform). This is doable but requires
  restructuring the body-build loop to emit `<use>` inside the same clip wrapper.
- A tinted static instance would need: the `<use>` inside a `<g filter="url(#savig-tint-<id>)">`.
  Same complexity.

**Deferral:** "Clipped or tinted static symbol instances fall back to full inlining." This is the
safe v1 scope. The body loop already handles clip/tint runs; static-but-clipped/tinted instances
simply aren't marked as optimizable and continue through the existing code path.

The v1 predicate therefore adds:
- `!asset.clip` (symbol is not clipping) — checked per asset once
- `!instance.tint` (no per-instance tint)

The body-build loop: when an instance is static-optimizable, emit `<use>` at that point.
When it's not, fall through to the existing inlining path (clip/tint wrapping still works).

---

## Static def rendering

To build the `<g>` content, we need a "render symbol leaves" helper that:
1. Walks `asset.objects` at t=0 with no prefix (basePrefix="", idPrefix="", opacity=1).
2. Renders each leaf via the existing `renderLeaf` logic.
3. Collects gradient defs as a side-effect (gradient defs for static symbols go into the
   shared `gradientDefs[]` array).
4. Returns the concatenated leaf HTML string.

The leaf's `renderId` inside the def is just the object's own id (no instance prefix, since
the def is shared). The `data-savig-object` attribute inside the def gets these bare ids
(e.g. `data-savig-object="inner"`). The `<use>` element gets `data-savig-object="<instanceId>"`
(the instance's composite renderId in the scene).

**Important:** Gradient def ids inside the static symbol def use the asset-object id, not a
per-instance renderId. Multiple instances share the same def, so the gradient ids must be
stable and asset-relative. Since gradient ids are `savig-grad-<renderId>-fill`, using the
bare object id (not instance-prefixed) is both correct and stable across instances.

---

## Body loop changes

The existing body loop is:
```
while (i < leaves.length) {
  if (runClipId || runTintId) { collect run → wrap → emit }
  else { renderLeaf → emit }
  i++
}
```

New logic: before entering the loop, detect which leaves belong to static-optimizable instances.
Actually, the cleanest approach is to detect at the flattenInstances phase... but we cannot
change flattenInstances (export-only constraint).

Alternative: detect per-leaf. A leaf from a static instance will have a `transformPrefix` equal
to the instance's `instTransform`. But we don't have a direct "which instance does this leaf belong
to" pointer in InstanceLeaf.

**Chosen approach:** Pre-scan project.objects to identify static-optimizable instances, keyed by
instance id. Then in the body loop, when we encounter a leaf whose `renderId` starts with
`"<instanceId>/"` (or equals instanceId for a direct non-nested leaf), we know it belongs to an
optimizable instance.

Better: during the body loop, we can check if the current leaf's renderId belongs to a known
static instance. Since `flattenInstances` emits contiguous runs per instance, we can:

1. Pre-compute a `Set<string> staticInstIds` — the set of instance ids that are optimizable.
2. In the body loop, check if the leaf is from a static instance:
   - A leaf from instance `"inst"` has `renderId = "inst/<leafId>"` (always slash-separated).
   - Parse the first segment of renderId as the instance id.
   - But nested instances complicate this: `"outer/inner/leaf"` — which instance level to optimize?

**v1 simplification:** Only optimize **top-level** symbol instances (direct children of
`project.objects`). Nested symbol instances inside another symbol will still be inlined (the
whole outer symbol must be static anyway for the outer instance to be optimizable, but the inner
content is already inside the outer `<g>` def). This is correct because:
- The `<g>` def for a static outer symbol already contains the fully-rendered leaf content
  of all nested static sub-instances.
- The nested sub-instance's "optimization" happens transparently inside the def (the def is
  rendered once at t=0, which already flattens everything inside).

So we only need to handle the case where a **root-level** SceneObject is a static symbol instance.

**Loop approach:**
1. Pre-compute `staticOptimizable: Map<string, { assetId: string; transform: string; opacity: string }>` 
   for root objects that are static symbol instances.
2. In the body loop, when `leaf.renderId.includes('/')`, the FIRST segment is the top-level instance id.
   Check if that id is in `staticOptimizable`.
3. If yes, AND we haven't yet emitted the `<use>` for this instance: skip all leaves belonging to
   this instance, emit `<use>` for the instance once, and mark it emitted.
4. Continue loop.

This cleanly handles the contiguous-run invariant: all leaves of one instance are contiguous, so we
skip the whole run in one pass.

---

## Implementation in renderSvgDocument

```typescript
// 1. Build staticOptimizable map
const staticOptimizable = buildStaticOptimizableInstances(project, assetsById);

// 2. Build static symbol defs
const staticSymDefs: string[] = [];
const usedStaticSymIds = new Set<string>();

// 3. Body loop: detect static instance runs
const emittedStaticInsts = new Set<string>();
while (i < leaves.length) {
  const leaf = leaves[i];
  const topInstId = leaf.renderId.includes('/') ? leaf.renderId.split('/')[0] : null;
  const staticInfo = topInstId ? staticOptimizable.get(topInstId) : null;

  if (staticInfo && !emittedStaticInsts.has(topInstId!)) {
    // Emit <use> for this instance, skip all its leaves
    emittedStaticInsts.add(topInstId!);
    // Emit def if not yet done
    if (!usedStaticSymIds.has(staticInfo.assetId)) {
      usedStaticSymIds.add(staticInfo.assetId);
      staticSymDefs.push(buildStaticSymbolDef(staticInfo.assetId, assetsById, project, gradientDefs));
    }
    bodyParts.push(`<use data-savig-object="${topInstId}" href="#savig-sym-${staticInfo.assetId}" transform="${staticInfo.transform}" opacity="${staticInfo.opacity}"/>`);
    // Skip all leaves of this instance
    while (i < leaves.length && leaves[i].renderId.startsWith(topInstId! + '/')) i++;
  } else if (staticInfo) {
    // Already emitted for this instance — skip remaining leaves
    while (i < leaves.length && leaves[i].renderId.startsWith(topInstId! + '/')) i++;
  } else {
    // Existing path (clip/tint run or plain leaf)
    ...
  }
}
```

---

## Gradient defs inside the static symbol def

When rendering the symbol's leaves into the `<g>` def, gradients get IDs like
`savig-grad-<leafObjId>-fill`. These are emitted into the shared `gradientDefs[]` array.
Since all instances share the same def, the gradient defs are emitted once (the first time
the def is built). Subsequent instances share the `<use>` and thus the same gradient references.

---

## Data-attribute convention

- `data-savig-object="<instanceId>"` on the `<use>` element — the instance's composite id in the
  scene (for the root level this is just the SceneObject's id, e.g. `"inst"`).
- The runtime's node lookup by `data-savig-object` won't find leaves inside the def (they're in
  `<defs>`, not the live document). This is correct: a static symbol has no animation, so the
  runtime doesn't need to touch its leaves. The runtime skips nodes it doesn't find in its
  precomputed frame, so this is safe.

---

## Parity + runtime safety

- Static symbols have `symbolEffectiveDuration === 0` → the runtime's animation loop produces no
  frame changes for their leaves. Even if the runtime tried to animate them, it would produce
  no-ops. The export optimization is therefore safe: it just reorganizes how the static content
  appears in the DOM without affecting runtime behavior.
- **ANIMATED symbol instances**: `isStaticSymbol` returns false → fall through to existing
  inlining path → byte-identical to current output. No regression.
- **Non-symbol exports** (pure vector, SVG-asset): unaffected — the body loop only adds a
  pre-check for the static instance case, which doesn't fire for non-symbol leaves.

---

## Deferrals (v1 scope)

1. **Clipped static instances** — fall back to inlining. Clip+`<use>` requires wrapping `<use>` in
   a per-instance `<g clip-path>`, which is structurally doable but adds complexity to the body loop.
2. **Tinted static instances** — fall back to inlining (same reasoning as clip).
3. **Nested static symbol instances inside another static symbol** — the outer `<g>` def already
   contains fully flattened content of nested symbols, so they're "optimized" inside the def
   (content appears once in `<defs>`). The nested instances themselves are NOT emitted as `<use>`
   inside the def — they're fully inlined into the def's content (correct and safe).
4. **Per-instance `symbolTime` / `freezeFirstFrame`** — conservative exclusion even when the symbol
   is content-static (non-default timing fields present = exclude from optimization).
5. **SVG operands inside static symbols** — if a static symbol contains SVG-asset objects, those
   objects reference the shared SVG-asset defs (which are still emitted). The static symbol `<g>`
   def contains `<use href="#savig-asset-...">` elements. This works correctly.

---

## Test plan (TDD)

1. **Two static instances → ONE def + TWO `<use>`**: assert `savig-sym-<assetId>` appears exactly
   once in `<defs>`, two `<use href="#savig-sym-...">` in body, two `data-savig-object` attrs with
   instance ids.
2. **Animated symbol stays inlined**: symbol with a keyframe track → no `<use>` optimization → body
   contains leaf `data-savig-object="inst/inner"` (old path, byte-identical).
3. **Transform correctness**: `<use>` transform matches the instance's `instTransform` (same as
   leaf `transformPrefix` in the current path).
4. **Tinted instance falls back to inlining** (clip/tint v1 scope: no `<use>` for tinted).
5. **Clipped instance falls back to inlining** (same).
6. **Mixed project**: static + animated instances of same or different symbols → static gets `<use>`,
   animated gets inline leaves, both render.
7. **`symbolTime` instance falls back to inlining** (conservative exclusion).
8. **Nested symbol (static outer, static inner)**: outer instance gets `<use>`, def contains inner
   content fully inlined.
9. **`freezeFirstFrame` instance falls back to inlining** (conservative exclusion).
10. **Output is deterministic** (two calls = identical string).
