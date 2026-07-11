# Tapered Brush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brush taper-in/out + optional pen pressure; active profile bakes the stroke as a filled outline via `outlineStroke`'s width-fn hook; inactive profile = byte-identical to today.

**Architecture:** `buildBrushWidthFn` (engine brush.ts, pure) composes size × taper ramps × pressure scale (final clamp ≥0.1). Brush controller accumulates (point, pressure) pairs; `end()` branches: profile-inactive → today's `addVectorPath` unchanged; active → `outlineStroke(strokeToPath(...), widthFn, 'round', 'round')` → new store `addVectorOutline(rings, fillSeed)`. PrimitiveOptions gains Taper in/out (%) + Pressure rows.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-11-tapered-brush-design.md` (approved; the widthFn PRODUCT+clamp semantics in its Testing section are binding). Anchors from a verified seam survey; re-locate by pattern if drifted.

## Global Constraints

- **Parity:** taper inactive (`taperIn===0 && taperOut===0 && !usePressure` — the defaults) → the commit path, style seed, and resulting asset are BYTE-IDENTICAL to today. Existing brush tests/e2e stay green UNMODIFIED.
- widthFn: `max(0.1, size · rampIn(t) · rampOut(t) · pressureScale(t))`; rampIn linear 0→1 over [0, taperIn] (1 when 0); rampOut 1→0 over [1−taperOut, 1]; pressureScale = `clamp(2·pressureAtT(t), 0.1, 2)` when enabled else 1.
- Pressure via RAW-sample arc-length resample (piecewise-linear `pressureAtT` built at end() from the captured pairs) — do NOT touch `simplify`/`dedupe`/`PathPoint`.
- `addVectorOutline(rings, styleSeed?)`: normalize ALL rings by the COMBINED bbox origin; `path=rings[0]`, `compoundRings=rings.slice(1)` omitted when empty; selection/tool-switch behavior identical to `addVectorPath`.
- Bake style seed: `{ fill: <the default brush stroke color — read PATH_DEFAULT_STYLE and reuse its stroke value>, stroke: 'none', strokeWidth: 0 }`.
- engine/brush.ts is IN the runtime bundle graph (strokeToPath) — regen `(cd packages/runtime && node scripts/build-runtime.mjs)` in the same commit as brush.ts changes; check whether adding buildBrushWidthFn changes the bundle (may tree-shake — regen-and-diff, include if changed).
- Env: `node_modules/.bin/{vitest,tsc,eslint,playwright}` from repo root; NEVER `pnpm install`/`pnpm approve-builds`; revert stray `pnpm-workspace.yaml`. Fresh `useEditor.getState()` per test read.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Engine — `buildBrushWidthFn` + pressure resampler

**Files:**
- Modify: `packages/engine/src/brush.ts` (+ `buildBrushWidthFn`, `pressureLookup(rawPoints: PathPoint[], pressures: number[]): (t: number) => number`)
- Test: `packages/engine/src/brush.test.ts` (append)
- Possibly: `packages/runtime/src/runtimeSource.generated.ts` (regen-and-diff; include if changed)

**Interfaces:**
- Produces: `buildBrushWidthFn(opts: { size: number; taperIn: number; taperOut: number; pressureAtT?: (t: number) => number }): (t: number) => number`; `pressureLookup(points, pressures)` (piecewise-linear over the RAW polyline's cumulative arc length; single-sample → constant; empty → () => 0.5).

- [ ] **Steps:** failing tests per the spec's binding semantics (taperIn .2/size 10 pins; overlapping-ramps bump pin; pressure resample stations; mouse-0.5 → 1×; clamp floor) → implement → `node_modules/.bin/vitest run packages/engine && node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint .` → regen-and-diff → commit `feat(engine): buildBrushWidthFn + raw-sample pressure lookup`.

---

### Task 2: Store — `addVectorOutline`

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` (signature by `addVectorPath`'s), `packages/editor-state/src/store.ts` (implementation — generalize addVectorPath's normalization; READ it at :729-753 first)
- Test: append the store test file that covers addVectorPath (find it)

**Interfaces:**
- Produces: `addVectorOutline(rings: PathData[], styleSeed?: Partial<VectorStyle>): void`.

- [ ] **Steps:** failing tests (multi-ring combined-bbox normalization exactness; compoundRings byte-clean absent for 1 ring; selection + activeTool post-state matches addVectorPath's; in-symbol scope) → implement → gates (`vitest run packages/editor-state`, tsc, eslint) → commit `feat(editor-state): addVectorOutline — multi-ring vector commit`.

---

### Task 3: State + controller + options UI

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` (+`brushTaperIn`/`brushTaperOut`/`brushUsePressure` fields + defaults + setter signatures), `packages/editor-state/src/slices/transportPrefsSlice.ts` (setters with clamps [0,0.5]/[0,0.5]/boolean)
- Modify: `packages/ui-core/src/controllers/brushTool.ts` (accumulate (point, pressure) pairs — widen begin/move with an optional pressure param defaulting 0.5; `end()` branch per Global Constraints)
- Modify: `apps/react/src/ui/components/Stage/useBrushTool.ts` + `Stage.tsx` handlers (thread `e.pressure` — native event on move, synthetic on down)
- Modify: `packages/ui-core/src/viewmodels/primitiveOptions.ts` (VM fields + intents), `apps/react/src/ui/components/Toolbar/PrimitiveOptions.tsx` (rows: "Taper in" range 0–50 step 5 mapping ↔ fraction, "Taper out" same, "Pressure" checkbox — labels exact for e2e: `Taper in`, `Taper out`, `Pressure`)
- Test: brushTool.test.ts (parity pin: default options → addVectorPath call byte-identical, EXISTING tests unmodified; taper-on → outlineStroke path: assert the committed asset via the store fixture — fill-only style, closed ring(s)); primitiveOptions VM test; PrimitiveOptions.test.tsx rows

- [ ] **Steps:** TDD → implement → gates (`vitest run packages/ui-core packages/editor-state apps/react`, tsc, eslint) → commit `feat(brush): taper/pressure profile — baked outline commit branch + options UI`.

---

### Task 4: E2E + full gates

**Files:**
- Create: `e2e/tapered-brush.spec.ts`

- [ ] **Steps:** house style; select Brush; set "Taper in"/"Taper out" to 30 via the panel (exact:true labels); draw brush.spec's zigzag gesture with page.mouse → ONE `[data-savig-object]`; its shape has `fill` attribute set (not none), `stroke` none/absent, `d` contains `Z`. Verify `e2e/brush.spec.ts` UNTOUCHED passes (parity). FULL GATES (tsc, full vitest, eslint, full playwright incl. @portable; workspace-file check; exact counts) → commit `test(e2e): tapered brush bakes filled outline; classic brush parity`.

---

## Out of scope (per spec)

Ribbon live preview; pressure auto-detect; velocity width; taper easing; post-commit profile editing; DSL/MCP.
