# Repeater — Design

**Date:** 2026-07-10 · **Status:** Approved (program roadmap #3; decisions documented per pre-approved
autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

One object → N transformed copies with a per-copy time offset: `repeat: { count, dx, dy, rotate,
scale, stagger }` on a SceneObject renders N leaves everywhere (editor, runtime, export, raster),
copy k offset by k·(dx,dy), k·rotate degrees, scaleᵏ, and playing its animation `k·stagger`
seconds later. Loaders, bursts, ripples, staggered echoes — without hand-placing copies.

## Decisions (with rationale)

1. **Model:** `repeat?: RepeatSpec` on `SceneObject`; `RepeatSpec = { count: number; dx: number;
   dy: number; rotate: number; scale: number; stagger: number }`. All static (no tracks) in v1.
   `count` MUST be static: the runtime node map is built once at load and the per-frame path never
   creates/removes DOM nodes (verified: runtime/index.ts:22-25, applyFrameToNodes) — an animated
   count is architecturally out of scope. Deltas/stagger COULD be animated later; deferred to keep
   the slice bounded. `count ≤ 1` (or absent) normalizes to `repeat: undefined` at write sites
   (`normalizeRepeat`, the trim precedent); count is clamped to an integer in [2, 64] when active
   (64 = perf guard; a repeated leaf multiplies DOM nodes and per-frame work).
2. **Scope v1: plain leaf objects only** (vector/text/svg-asset), NOT groups and NOT symbol
   instances. The walker's instance branch multiplies clip/tint contexts and duration math;
   repeat-an-instance is the natural follow-up once the leaf seam is proven. Store/UI gate
   accordingly (`canRepeat`: non-group, non-instance).
3. **Expansion at the ONE walker seam** — `flattenInstances`' plain-leaf branch
   (packages/engine/src/symbol.ts:193-212): an object with `repeat` pushes `count` leaves in a
   k-loop instead of one. Per copy k:
   - `renderId`: k=0 keeps the BARE id (byte-identical parity for the source copy — node maps,
     gradient-def ids, click routing all unchanged); k≥1 gets `${renderId}@${k}`. `@` is a new
     separator distinct from `/` (instance-chain nesting).
   - `transformPrefix`: `fullPrefix` composed with the per-copy delta
     `translate(k·dx, k·dy) rotate(k·rotate) scale(scaleᵏ)` (delta applied AFTER the prefix,
     BEFORE the object's own transform — copies orbit the source's coordinate frame; emit via the
     existing transform-string helpers, numbers through `fmt()`). k=0 delta is identity and emits
     NOTHING extra (parity).
   - `localTime`: `Math.max(0, localTime - k * stagger)` (mirrors the symbolTimeTrack clamp,
     symbol.ts:173). k=0 time unchanged.
   Because static markup, `computeFrame`, and raster all consume this walker, parity across
   preview/export/runtime is by construction; no other render file changes.
4. **Click routing:** copies are hittable and resolve to the source — Stage's
   `topId = renderId.split('/')[0]` gains a preceding strip of any trailing `@\d+` per segment
   (so `objId@2` → `objId`, `instId/childId@2` → `instId`). Selection bbox/handles stay on the
   source object (entityAABB already ignores render leaves — zero changes; union-of-copies bbox is
   an explicit non-goal for v1).
5. **Duration:** a repeated object's timeline end extends by `stagger·(count−1)`. In
   `computeProjectDuration`'s per-object loop (duration.ts:101-119), fold
   `objectEnd + repeat.stagger*(repeat.count-1)` where `objectEnd` is the object's existing
   contribution (own tracks max; instances excluded by decision 2). Check and extend the
   multi-scene sibling (`computeProjectDurationMulti`, scenes.ts:125) via whatever shared
   per-object path it uses — if it duplicates the math, extend both and note it.
6. **Store:** `setRepeat(partial: Partial<RepeatSpec>): void` mirroring `setSymbolTiming`
   (default-merge over `{count:2, dx:0, dy:0, rotate:0, scale:1, stagger:0}` when enabling,
   sparse handling, `normalizeRepeat` on write, clamps: count int [2,64], stagger ≥0 finite,
   deltas finite, scale in [0.01, 100]); `toggleRepeat()` enable/disable convenience (disable →
   `repeat: undefined`); gated by `canRepeat` (non-group, non-instance, vector/text/svg leaf).
   Active-scene routing. `duplicate` deep-clones `repeat` automatically (JSON clone — verified).
7. **Inspector:** "Repeater" panel mirroring the Symbol-timing block (Inspector.tsx:355-459
   pattern): enable checkbox (`aria-label="repeat"`), NumberFields `copies` (count), `dx`, `dy`,
   `rotate`, `scale`, `stagger`, wired to `intents.setRepeat({...})`. Shown only when `canRepeat`
   or already repeating. No timeline surface (nothing keyframable v1).
8. **Validation & agent surface:** validate.ts gains a `repeat` block (count int ≥2 ≤64, finite
   deltas, stagger ≥0). describe.ts emits `repeat ×N (+dx,+dy, r°, ×s, stagger s)` when present.
   DSL: `repeat?: RepeatSpec` on `ShortObjectCommon` (compile via the store-equivalent core
   builder `setRepeat(project, objectId, spec)`; decompile emits only when present). MCP:
   `set_repeat` tool (objectId + partial fields; count ≤1 clears). Core builder in build.ts
   mirrors setKeyframe's requireObject/replaceObject style.
9. **Out of scope (explicit):** animated count/deltas/stagger; repeat on groups/instances;
   union-of-copies selection bbox; per-copy styling; nested repeat (an object inside a symbol that
   ALSO has repeat — the walker handles it naturally since the leaf branch runs inside recursion,
   with renderIds `instId/childId@k`; ALLOWED, covered by a test, but repeat on the instance
   itself is not); DSL statement sugar beyond the object field.

## Testing

- Engine unit (symbol.test.ts area): leaf-count expansion (count 3 → 3 leaves, ids `a`,`a@1`,`a@2`);
  parity (no repeat → identical leaves; count present → k=0 leaf byte-identical to the unrepeated
  leaf incl. renderId/transformPrefix/localTime); per-copy transform composition (assert exact
  prefix strings via fmt); stagger clamp at 0; nested case (repeated leaf inside a symbol instance
  → `inst/child@k` ids, times compose: instance childTime then stagger); duration extension incl.
  multi-scene.
- Runtime unit: computeFrame emits N FrameItems with distinct objectIds; applyFrameToNodes updates
  all N (jsdom markup with N nodes); staggered items sample different times (assert differing
  animated attr across copies at one t).
- Static export: renderDocument emits N `data-savig-object` nodes; gradient-def ids unique per copy.
- Store unit: setRepeat merge/clamps/normalize-to-undefined; toggleRepeat; canRepeat gates (group,
  instance → no-op); in-symbol scope; duplicate clones repeat.
- Stage/component: click on copy k selects the source (topId strip); Inspector panel commits.
- E2E (`e2e/repeater.spec.ts`): draw a rect, enable repeat (copies 3, dx 40), assert 3 stage nodes
  with the expected transforms; add a y keyframe pair + stagger 0.5, scrub mid-animation and assert
  copy transforms differ (staggered sampling); click copy 2 → source selected (Inspector shows the
  object). Full gates + @portable.
- validate/DSL/MCP tests per decision 8.
