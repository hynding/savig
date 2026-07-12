# Follow-ups Batch 1 Implementation Plan (art-tools hardening)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the accumulated non-blocking follow-ups from the 9-feature art-tools program: blend hardening, text-on-path seam coherence, editor interaction stragglers, and MCP/DSL property validation.

**Architecture:** Small, independent fixes grouped by subsystem into 4 implementation tasks + 1 e2e/gates task. Each fix's decision is recorded inline below (this plan doubles as the decision record; no separate spec — items were designed by the final reviews that raised them). Seam anchors verified by survey 2026-07-11; re-locate by pattern if drifted.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated, Playwright e2e.

## Global Constraints

- **Parity discipline:** every render-affecting change must keep absent/default cases byte-identical (state the parity argument in each report).
- **Runtime bundle:** `packages/engine/src/project.ts` and `sample.ts`/`path.ts` are IN the runtime bundle. Any commit touching engine files must run `(cd packages/runtime && node scripts/build-runtime.mjs)` in the SAME commit and state a regen-and-diff verdict. `blend.ts` remains editor-only (never imported from packages/runtime/src).
- Env: `node_modules/.bin/{vitest,tsc,eslint,playwright}` from repo root; NEVER `pnpm install`/`pnpm approve-builds`; revert stray `pnpm-workspace.yaml`. Fresh `useEditor.getState()` per test read. E2E stage queries scoped to `section[aria-label="Stage"]`.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Blend hardening

**Files:**
- Modify: `packages/engine/src/blend.ts` (+ `blend.test.ts`), `packages/editor-state/src/store.ts` (+ `store.blend.test.ts`), `packages/core/src/build.ts` (+ `build.test.ts`), `packages/mcp/src/tools.ts` (+ `tools.test.ts`), `packages/ui-core/src/viewmodels/inspector.test.ts`, `apps/react/src/ui/components/Inspector/Inspector.test.tsx`
- Runtime bundle regen in the engine commit (blend.ts is tree-shaken, but verify-and-state).

**Decisions & changes:**
1. **Non-finite count guard (engine entry):** `computeBlendSteps` returns null unless `Number.isFinite(opts.count)` (today `count < 1` lets `Infinity` through → infinite loop for direct store callers). Test: Infinity and NaN → null.
2. **Gradient reference clone (blend seam only — do NOT touch `interpolateGradient`, it's shared with per-frame runtime sampling):** in blend.ts, wherever the STEP-hold branch would place A's gradient into the output style (lerpPaintSlot mismatch arm, and the gradient that comes back from `interpolateGradient`'s linear↔radial type-mismatch arm which returns `a` by reference), deep-clone it: `{ ...g, stops: g.stops.map((s) => ({ ...s })) }`. Update the `BlendStep.style` doc comment ("no shared references" becomes true). Test: mutate one intermediate's gradient stop → other intermediates and source asset A unaffected (compare by value AND reference inequality).
3. **`materializeBlendStep(step: BlendStep, i: number, z: number): { asset: VectorAsset; obj: SceneObject }`** exported from `packages/engine/src/blend.ts`: the 5 shared operations (pathBounds, bbox-normalize anchors preserving handle offsets, createVectorAsset('path', {path, style}), createSceneObject with `name: Blend ${i+1}`, `zOrder: z+i`, fraction anchors 0.5/0.5, `base: {...DEFAULT_TRANSFORM, x: box.x, y: box.y, opacity: step.opacity}`). Replace BOTH loops — store.ts:1132-1152 and build.ts:355-372 — with calls to it; the byte-identical-surfaces doc comment at build.ts:319-331 gets updated to point at the shared helper. Existing store/build tests must stay green UNMODIFIED (they pin the object shape).
4. **MCP `blend` count sanitization:** in the tool's run, `const count = Math.floor(a.count as number); if (!Number.isFinite(count) || count < 1 || count > 100) return error` (isError response naming the 1..100 bound). Test: 2.5 → floors to 2; 1e6 and NaN → clear error, no objects created.
5. **Time-wiring regression test (store):** blend a transform-animated source (x keyframes) at a non-zero playhead → intermediate placement reflects the sampled position, and differs from blending at t=0.
6. **Easing flow-through tests (VM + component):** with easeIn selected vs linear, the middle intermediate's base position differs (engine tests show the technique). One test in inspector.test.ts (intent) and one in Inspector.test.tsx (field → dispatch).

- [ ] TDD per fix → implement → gates (`node_modules/.bin/vitest run packages/engine packages/editor-state packages/core packages/mcp packages/ui-core apps/react`, tsc, eslint) + regen verdict → commit `fix(blend): finite-count guard, gradient clone, shared materializeBlendStep, MCP clamp + easing/time tests`.

---

### Task 2: Text-on-path seam coherence

**Files:**
- Modify: `packages/engine/src/symbol.ts` (or textPath.ts — implementer's judgment, co-locate with the closest precedent) + test: new `symbolHasBoundText(asset: SymbolAsset, assetsById: Map<string, Asset>): boolean` — recursive, visited-set cycle guard (mirror `isStaticSymbol` at packages/engine/src/duration.ts:89-104): true if any object in the symbol's subtree (descending into nested symbol assets) has `obj.textPath`.
- Modify: `packages/services/src/export/renderDocument.ts` (+ test): in `buildStaticOptimizableMap` (lines 278-306), add `!symbolHasBoundText(asset, assetsById)` to the eligibility gate at ~line 291. DECISION: gate in services, NOT inside engine `isStaticSymbol` (that function is duration semantics; export optimization is the services concern). Effect: symbols containing bound text fall to the full-inlining path (root-scoped `resolveTextPath` → plain-text degradation), matching editor and runtime exactly.
- Modify: `packages/ui-core/src/viewmodels/inspector.ts` (+ test): add `danglingTarget: boolean` to the textPath VM (`bound && boundTarget === undefined`).
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (+ test): after `<option value="">None</option>` (~line 858), when `vm.textPath.danglingTarget`, render `<option value={dangling id}>(missing target)</option>` so the controlled select value matches an option.
- Modify: `packages/core/src/node/render.test.ts`: delete the duplicated `PNG_MAGIC` (line 98) and `bytesEqual2` (line 99) in the textPath probe block — use the top-level consts (lines 8-10). ADD a pin test: `renderFramePng` of a bound-text project at t > 0 renders without throwing and differs from the same project unbound (pins the runtime `transform=""` identity behavior probed at the text-on-path final review; use the `withFade()` fixture pattern at lines 12-18).
- Modify: `packages/core/src/dsl.ts`: doc-comment near the motionPath omission noting the `textPath` binding itself is not in the DSL (only the `textPathOffset` track survives a round-trip; an unbound orphan track is inert but counts toward duration) — documentation only, no behavior change.

**Tests:** static-symbol gate — a project with a bound-text symbol exports with NO `<use>`/static def for that symbol AND its text renders as plain `<text>` (matching a computeFrame-driven expectation); a bound-text-free symbol remains static-optimized byte-identical to before (parity pin). VM danglingTarget true only when bound+missing. Inspector renders the option; select value matches.

- [ ] TDD → implement → gates (`node_modules/.bin/vitest run packages/engine packages/services packages/ui-core apps/react packages/core`, tsc, eslint) + engine regen verdict (new engine export → bundle may grow if imported by runtime graph — it isn't; verify) → commit `fix(text-on-path): uniform static-symbol degradation + missing-target affordance + test dedupe`.

---

### Task 3: Editor interaction stragglers

**Files:**
- Modify: `apps/react/src/ui/components/Stage/Stage.tsx` (+ `Stage.test.tsx`):
  1. Onion ghosts (~line 1160): `sampleObject(obj, ghostTime)` → `sampleObject(obj, ghostTime, asset.primitive)` (asset is in scope at line 1162's `gs.path ?? asset.path`).
  2. Resize-handle tool gate: `selectedVector` memo (lines 251-264) gains `if (activeTool !== 'select') return null;` first line + `activeTool` in deps (exact mirror of `selectedRotatable` line 291). Defensively, `onHandlePointerDown` (line 616) checks the tool BEFORE `e.stopPropagation()`.
  3. Operand-ghost press (lines 1472-1475): under eyedropper, mirror `onObjectPointerDown`'s branch (lines 757-764): `applyStyleFrom(g.id); setActiveTool('select')` instead of `selectObject`.
- Modify: `packages/editor-state/src/selectors.ts` (+ test): `selectEditablePath` (lines 113-123) threads the primitive: replace the tail with `const st = sampleObject(obj, s.time, asset?.kind === 'vector' ? asset.primitive : undefined); return st.path ?? asset.path ?? null;` — sampleObject's internal morph-wins branch preserves the existing shapeTrack behavior (delete the now-redundant explicit samplePath branch ONLY if the sampleObject path is provably equivalent — it is: sample.ts:64 samples the same track; state the argument). Node overlay + `selectEditableRings`/`selectActiveRingPath` inherit.
- Modify: `packages/editor-state/src/store.ts` (+ `store` test): `addShapeKeyframe` (~line 1164) and `setPathData`'s shapeTrack-present branch (~lines 841-856) apply `omitPrimitiveTracks(obj.tracks)` (store-internals.ts:753) in the same commit — DECISION: strip-on-shapeTrack-add (the omitPrimitiveTracks precedent), not duration-side shadow detection (duration.ts has no asset access). Tests: first shape keyframe on an object with animated `sides` strips the 5 primitive keys and deflates computeProjectDuration; object without primitive tracks byte-identical.
- Modify: `packages/ui-core/src/commands/registry.ts` (+ test): `kfSelected` (lines 9-18) adds `s.selectedRemapKeyframe`. VERIFY the `edit.deleteKeyframe`/`edit.copyKeyframe`/`edit.cutKeyframe` run handlers actually handle the remap kind (the store has `removeSelectedRemapKeyframe`, store.ts:508 area) — if the delete run dispatches a generic keyframe-delete that misses remap, extend that dispatch; test: with ONLY a remap keyframe selected, the Delete command resolves to `edit.deleteKeyframe` (NOT `edit.deleteObject`) and invoking it removes the remap keyframe, object survives.
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx`: the 2 bare labels — line 272 `<label>{prop}</label>` → `<label htmlFor={`insp-${prop}-paint`}>{prop}</label>`; line 336 `<label>angle</label>` → `htmlFor={`insp-${prop} gradient angle`}` (NumberField self-generates `id={`insp-${label}`}`, Inspector.tsx:56 — ids with spaces are valid; match exactly).

- [ ] TDD → implement → gates (`node_modules/.bin/vitest run apps/react packages/editor-state packages/ui-core`, tsc, eslint) → commit `fix(editor): primitive-sampled overlays, eyedropper tool-gating, shapeTrack orphan strip, remap-kf commands, label pairing`.

---

### Task 4: MCP/DSL property validation

**Files:**
- Modify: `packages/engine/src/project.ts` (+ test): export `ALL_ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = [...ANIMATABLE_PROPERTIES, ...GEOMETRY_PROPERTIES, ...PRIMITIVE_PROPERTIES, 'textPathOffset']` (16 members). Add a compile-time exhaustiveness pin so a future AnimatableProperty member can't be forgotten: `const _exhaustive: AnimatableProperty[] = [...ALL_ANIMATABLE_PROPERTIES]; type _All = (typeof ALL_ANIMATABLE_PROPERTIES)[number]; const _check: [AnimatableProperty] extends [_All] ? true : never = true;` (or equivalent — the point is a type error when the union grows).
- Modify: `packages/core/src/build.ts` (+ test): `setKeyframe` throws `savig/core: unknown animatable property "<p>" (valid: ...)` when `!ALL_ANIMATABLE_PROPERTIES.includes(spec.property)`. This single seam covers the MCP `set_keyframe` tool AND the DSL `animate` path (both funnel through setKeyframe — dsl.ts:120-125, tools.ts:165-172).
- Tests: typo'd property throws + creates NO dead track; every one of the 16 valid names succeeds (loop test); MCP set_keyframe with a typo returns the error (tools.test.ts); DSL compile with a bad animate key surfaces the throw.
- **Runtime bundle:** project.ts IS in the bundle graph → regen in the SAME commit + verdict (expected: bundle grows by the const; state size delta).

- [ ] TDD → implement → gates (`node_modules/.bin/vitest run packages/engine packages/core packages/mcp`, tsc, eslint) + regen → commit `feat(core): validate animatable property names at the setKeyframe boundary`.

---

### Task 5: E2E + full gates

**Files:**
- Modify: `e2e/style-tools.spec.ts` (or create `e2e/eyedropper-handles.spec.ts` if style-tools has no fitting describe — check): regression for the eyedropper hole — draw rect A (fill it via Inspector if the flow exists in the spec already — reuse its helpers), draw rect B, select B (resize handles visible), activate eyedropper (palette button or key), click ON one of B's corner-handle coordinates over A? No — simpler true-to-bug flow: select rect B so its handles render, activate eyedropper, click at B's corner-handle position → the pick applies (previously the handle swallowed the press). Assert B's fill changed to the picked style / or the tool reverted to select with applyStyleFrom effect. PIN THE ACTUAL FIXED BEHAVIOR (with the memo gate, handles are hidden under eyedropper — asserting the handle rect count is 0 under eyedropper is the cheapest honest pin; then the click hits the object and picks).
- [ ] House style; then FULL GATES: tsc, full `node_modules/.bin/vitest run`, eslint, full `node_modules/.bin/playwright test` incl. @portable (if `pnpm dev` webServer fails, start `apps/react` and `apps/svelte` vite directly on 5173/5174 first — known env quirk); exact counts; workspace-file check → commit `test(e2e): eyedropper picks through former handle hole`.

---

## Out of scope (later batches)

Thumbnail def-id isolation + Stage tint XSS (batch 2); add-text tool + text bbox (batch 3); same-path vertex snap, live-linked blend, and all other roadmap-level deferrals.
