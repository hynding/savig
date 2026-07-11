# Outline Stroke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-shot "Outline stroke" command converting a stroked path into its filled ink shape (`outlineStroke` engine geometry with a width-function hook for the tapered brush).

**Architecture:** Greenfield `packages/engine/src/geom/strokeOutline.ts` (flatten → per-point normal offsets → caps → one `pc.union` self-resolve → rings). Store op with scissors-convention gates, style swap, animation drops + info toast, absolute-anchor pinning, compoundRings assembly (booleanOp precedent). Registry command + Inspector button + MCP tool.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated, Playwright e2e, `polygon-clipping` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-07-10-outline-stroke-design.md` (approved). Anchors from a verified seam survey; re-locate by pattern if drifted.

## Global Constraints

- `outlineStroke(path, width: number | ((t: number) => number), cap, join): PathData[]` — rings `[outer, ...holes]`; results faceted (corner nodes); `'miter'` join falls back to `'bevel'` (commented).
- Self-union via the LOW-LEVEL `pc` binding pattern from `geom/boolean.ts:19-26` — NOT the ≥2-object `booleanOp()` wrapper.
- v1 targets `shapeType === 'path'` only. Gates (toast + no commit): non-path; `stroke === 'none' || strokeWidth <= 0`; `shapeTrack` non-empty; existing `compoundRings`; `obj.boolean`; boolean OPERAND (operandIds scan over ACTIVE objects); `isLockedInTree`. GROUPED paths allowed (identity preserved).
- Effects in ONE commit: asset path/compoundRings/style swap (`fill`←stroke, `fillGradient`←strokeGradient, stroke 'none', strokeWidth 0, linecap/linejoin/dasharray/dashoffset REMOVED byte-clean); object drops `trim`/`dashOffsetTrack`/`colorTracks`/`gradientTracks` with info toast `"Stroke/fill animation removed — converted to a filled shape."` only-when-present; `tracks`/`motionPath`/`repeat` kept; primitive-detach fires; anchor pinned `absolute` at the pre-op resolved point (scissors math verbatim — see `cutSelectedPathAt`).
- Geometry stays in the SAME local space (offsets around existing node coords; no re-normalization; `base` untouched).
- strokeOutline.ts must NOT enter the runtime bundle graph (editor-only command). Verify by grep + regen-and-diff like scissors Task 1 did; state the verdict.
- Env: `node_modules/.bin/{vitest,tsc,eslint,playwright}` from repo root; NEVER `pnpm install`/`pnpm approve-builds`; revert stray `pnpm-workspace.yaml` after e2e. Fresh `useEditor.getState()` per test read.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Engine — `strokeOutline.ts`

**Files:**
- Create: `packages/engine/src/geom/strokeOutline.ts`, `packages/engine/src/geom/strokeOutline.test.ts`
- Modify: `packages/engine/src/index.ts` (`export * from './geom/strokeOutline';`)

**Interfaces:**
- Consumes: `flattenPath` (geom/arcLength.ts — `{pts, cum, total}`), the module-local `pc` default-export resolution pattern (COPY the defensive ESM/CJS binding from `geom/boolean.ts:19-26` or import the resolved binding if boolean.ts exports it — check first), `PathData`/`PathPoint` types, `ringArea` (boolean.ts) for ordering output rings largest-first.
- Produces: `outlineStroke(path, width, cap, join): PathData[]` and (exported for tests/feature-6) `offsetPolyline(pts: PathPoint[], cum: number[], total: number, width: number | ((t:number)=>number)): { left: PathPoint[]; right: PathPoint[] }`.

- [ ] **Step 1: Write failing tests** — the spec's engine list, verbatim cases:
```
1. Straight 2-node line (0,0)→(100,0), width 10, butt, bevel → ONE ring ≈ rectangle
   [(0,-5),(100,-5),(100,5),(0,5)] — assert bounds ±1e-6 and |area| ≈ 1000 ±1e-3 (vertex order
   free; use ringArea + bounds, not exact array equality — the union may rotate the ring start).
2. Same with cap 'square' → bounds extend to [-5, 105]; area ≈ 1100.
3. Same with cap 'round' → x-bounds ≈ [-5, 105], area between the butt and square areas
   (π/4-ish corners); at least 6 more points than butt (arc sampling).
4. Closed 100×100 square centerline, width 10 → 2 rings; outer bounds 110×110, inner 90×90;
   ringArea signs OPPOSITE (pc convention outer CCW / hole CW).
5. Hairpin fold (0,0)→(100,0)→(0,1) width 20 → output rings have positive count, the LARGEST
   ring's |area| < the naive unfolded ribbon area (self-overlap merged), and pc.union output is
   by-construction non-self-crossing (assert it returned ≥1 ring without throwing).
6. Width FUNCTION t→10−8t on the straight line → ribbon width at x≈0 is ~10, at x≈100 is ~2
   (measure y-extent of points near those x stations ±2).
7. join 'round' vs 'bevel' on an L corner (0,0)→(100,0)→(100,100), width 10: round output has
   more points and larger area (arc wedge) than bevel; 'miter' output EQUALS bevel output.
```
- [ ] **Step 2: RED** — `node_modules/.bin/vitest run packages/engine/src/geom/strokeOutline.test.ts`.
- [ ] **Step 3: Implement** — flatten; tangents from neighbor diffs (endpoint one-sided); normals (−ty, tx); width(t) via `cum[i]/total`; left/right offset points; corner handling: at hard corner nodes (angle beyond ~epsilon between adjacent flatten segments — detectable where consecutive tangents differ sharply; simpler: treat EVERY point uniformly, the union bevels naturally, and for join==='round' insert arc points around corners whose turn angle exceeds a threshold on the OUTER side); caps per spec; assemble ring (left + endCap + right.reversed + startCap, closed); closed-source case: two rings offset ±w/2, each closed, both into the union input as one polygon [outerRing, innerRing]? NO — union input = MultiPolygon [[left-offset ring]], [[right-offset ring]]? For a closed centerline the left offset forms one closed ring and the right another; the ink region = XOR-ish… simplest correct: treat as polygon with outer = outward offset ring and hole = inward offset ring → `pc.union([[outer, inner]])` normalizes orientation. THINK this through against test 4 and document the chosen construction in comments. Convert pc output rings → PathData corner nodes (dedupe the closing duplicate point), order largest-|area| first.
- [ ] **Step 4: GREEN + gates** — `node_modules/.bin/vitest run packages/engine && node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint .` + runtime-graph verdict (grep + regen-and-diff; expect unreferenced).
- [ ] **Step 5: Commit** — `feat(engine): strokeOutline — centerline to filled ink rings (caps, width fn, self-union)`

---

### Task 2: Store op + predicate + Inspector button + registry

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` (signature), `packages/editor-state/src/store.ts` (op — model it on `cutSelectedPathAt`'s structure: gates block, one-commit composition, toasts; scissors is in the same file, mirror it closely)
- Modify: `packages/ui-core/src/commands/predicates.ts` (`canOutlineStroke`), `packages/ui-core/src/commands/registry.ts` (command `path.outlineStroke`, no chord, `when: canOutlineStroke`)
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (button beside the boolean row, aria-label "Outline stroke", disabled via the VM/predicate the boolean buttons use — mirror their wiring)
- Create: `packages/editor-state/src/store.outline.test.ts`; append registry + Inspector tests

**Interfaces:**
- Consumes: `outlineStroke` (Task 1), scissors helpers already in store.ts (`dropTrimAndDash` — EXTEND or sibling a `dropPaintAnimation` helper for colorTracks/gradientTracks; `isLockedInTree` gate pattern; operand scan; anchor-pinning math — reuse the exact code by extracting a small shared helper if clean, else mirror).
- Produces: `outlineStroke(): void` store action; `canOutlineStroke(s): boolean`.

- [ ] **Step 1: Failing tests** — the spec's store list verbatim (every gate incl. grouped-ALLOWED case; effects block; gradient carry; toast only-when-present; anchor pinning both modes; primitive-detach via a stamped-star-turned-path… primitives are CLOSED paths with stroke — a stamped star with a stroke qualifies, pin that outlining detaches the spec; ONE commit/undo; in-symbol).
- [ ] **Step 2-4: RED → implement → GREEN + gates** (`node_modules/.bin/vitest run packages/editor-state packages/ui-core apps/react && node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint .`).
- [ ] **Step 5: Commit** — `feat(editor-state,ui): outline-stroke command — gates, style swap, anchor pinning`

---

### Task 3: Agent surface — core builder + MCP

**Files:**
- Modify: `packages/core/src/build.ts` (`outlineStrokePath(project, objectId): Project` — requireObject/replaceObject style; SAME gates as the store where model-level (visible stroke, path-type, shapeTrack, compoundRings, boolean/operand) — throw with clear messages; locks are editor-only, skip), `packages/core/src/index.ts`
- Modify: `packages/mcp/src/tools.ts` (`outline_stroke` tool: objectId; withScene routing; edited() message)
- Test: build + mcp test files (append)

- [ ] **Step 1-4: standard TDD cycle** (builder effects deep-equal the store's asset/object results for the same input — consider extracting the shared effect-computation into engine or core so store and builder can't drift; judge feasibility and do it if clean, else mirror with a comment). Gates: `node_modules/.bin/vitest run packages/core packages/mcp && node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint .`
- [ ] **Step 5: Commit** — `feat(core,mcp): outlineStrokePath builder + outline_stroke tool`

---

### Task 4: E2E + full gates

**Files:**
- Create: `e2e/outline-stroke.spec.ts`

- [ ] **Step 1:** house style: draw a Line (stroked by default — verify line-tool defaults; set a distinct stroke color via Inspector if needed), click Inspector "Outline stroke" → stage shape has `fill` = the stroke color, `stroke` absent/none, `d` contains `Z`; undo → original restored (stroke back, fill back).
- [ ] **Step 2:** focused run honest-green; **Step 3:** FULL GATES (tsc, full vitest, eslint, full playwright incl. @portable; workspace-file check); **Step 4:** Commit — `test(e2e): outline stroke convert + undo`

---

## Out of scope (per spec)

Rect/ellipse synthesis; dash-aware gaps; trimmed partial ribbons; live variant; curve reconstruction; miter spikes; stroke-anim retargeting.
