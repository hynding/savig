# Shape Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shape Builder mode — hover-highlighted atomic regions over 2–6 selected vector shapes; click = union the region's contributors; alt-click = punch the region out of them; Escape exits.

**Architecture:** Engine `decomposeRegions` (subset intersections over the low-level `pc` binding, ≤63 ops at N=6, flattened world polygons) + interaction `pointInRings` (even-odd). Store: `shapeBuilder: {ids} | null` transient mode (correspondenceEditing precedent), `canShapeBuilder` (2..6 plain CLOSED vector leaves, long exclusion list), `shapeBuilderMerge` (engine booleanOp on the explicit subset + post-processing FACTORED out of groupSymbolSlice), `shapeBuilderPunch` (per-contributor pc.difference write-back, one commit). Stage: memoized regions, React hover state, translucent overlays (operand-ghost styling), early-exit pointer routing, Escape via keymap's special-cased block. Command + Inspector button.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated, Playwright e2e, polygon-clipping.

**Spec:** `docs/superpowers/specs/2026-07-11-shape-builder-design.md` (approved; Decisions 1–8 binding). Anchors from a verified seam survey; re-locate by pattern if drifted.

## Global Constraints

- Region math on FLATTENED world polygons (`objectToWorldPolygon`); commits on the REAL engine `booleanOp(project, objs, op, time)` (curve-provenance preserved). Decomposition NEVER recomputes per pointermove — Stage `useMemo` keyed `[project, shapeBuilder.ids, time]`.
- `canShapeBuilder`: 2..6 selected objects, EVERY one a plain vector leaf with a CLOSED primary ring, none of: group / instance / svg / text / `obj.boolean` / boolean operand / `shapeTrack` / `repeat` / `isLockedInTree`.
- Merge: subset union; merged id replaces contributors in the frozen ids; size-1 regions inert on click; auto-exit when <2 ids remain. Punch: per-contributor difference; empty contributor removed; trim/dashOffsetTrack dropped w/ scissors info toast; primitive-detach. ONE commit per gesture.
- groupSymbolSlice's `booleanOp` tests stay green UNMODIFIED after the post-processing factor-out.
- regions.ts/pointInRings are editor-only — verify runtime bundle unaffected (regen-and-diff; engine geom is barrel-exported, the PRIMITIVE_PROPERTIES lesson applies — if the bundle grows, judge and commit with rationale like d4f150a).
- Env: `node_modules/.bin/{vitest,tsc,eslint,playwright}` from repo root; NEVER `pnpm install`/`pnpm approve-builds`; revert stray `pnpm-workspace.yaml`. Fresh `useEditor.getState()` per test read.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Engine — `decomposeRegions` + interaction `pointInRings`

**Files:**
- Create: `packages/engine/src/geom/regions.ts` + `regions.test.ts`; `packages/interaction/src/pointInRings.ts` + test
- Modify: `packages/engine/src/index.ts`, `packages/interaction/src/index.ts` (exports)

**Interfaces:**
- Produces: `decomposeRegions(polys: PcPolygon[]): Region[]`, `interface Region { rings: PathData[]; contributors: number[]; bbox: { x: number; y: number; width: number; height: number } }` (contributors = input indices; rings from pc output largest-first, PathData corner nodes — reuse/mirror the ring→PathData conversion in strokeOutline/boolean); `pointInRings(rings: PathData[], p: PathPoint): boolean` (even-odd over all rings' polygons).
- Consumes: the exported `pc` binding (boolean.ts), `ringArea`, `PcPolygon` type (export it from boolean.ts if local — check).

- [ ] **Steps:** failing tests per the spec's engine/interaction lists (two-squares → 3 regions w/ contributor sets {0},{1},{0,1} and hand-computed areas; three offset squares → 7; disjoint → N; area-sum pin; pointInRings hole case + boundary epsilon) → implement (subset enumeration 1..2^N−1; intersection of S; difference of the rest; drop empties by area epsilon) → gates (`vitest run packages/engine packages/interaction`, tsc, eslint) → bundle regen-and-diff verdict → commit `feat(engine,interaction): region decomposition + even-odd point test`.

---

### Task 2: Store — mode state + predicate + merge/punch actions

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` (`shapeBuilder: { ids: string[] } | null` transient + action signatures), `packages/editor-state/src/slices/groupSymbolSlice.ts` (FACTOR the destructive-boolean post-processing into a shared helper — style-from-topmost/bbox-shift/remove/append — used by both the existing `booleanOp` action and the new merge; new actions `enterShapeBuilder()`, `exitShapeBuilder()`, `shapeBuilderMerge(contributorIds: string[])`, `shapeBuilderPunch(regionRings: PathData[], contributorIds: string[])`)
- Modify: `packages/ui-core/src/commands/predicates.ts` (`canShapeBuilder`), `packages/ui-core/src/commands/registry.ts` (`path.shapeBuilder` toggle command, `when: canShapeBuilder OR active` — active must allow exit), `packages/ui-core/src/controllers/keymap.ts` (Escape branch BEFORE editPath's: shapeBuilder active → exitShapeBuilder)
- Create: `packages/editor-state/src/store.shapeBuilder.test.ts`; append predicates/registry/keymap tests

- [ ] **Steps:** failing tests (every eligibility exclusion; enter freezes ids; toggle/Escape/auto-exit-under-2; merge on subset — engine union of exactly the contributors, ids-list replacement, style-from-topmost, one commit, groupSymbolSlice booleanOp suite UNMODIFIED green; punch — per-contributor difference results written back (hand-computed simple case: two overlapping squares, punch overlap → both L-shaped), empty-removal, trim/dash drop + toast, primitive-detach, one commit; in-symbol scope) → implement → gates (`vitest run packages/editor-state packages/ui-core`, tsc, eslint) → commit `feat(editor-state,ui-core): shape-builder mode, merge/punch actions, eligibility`.

---

### Task 3: Stage — overlay, hover, gestures

**Files:**
- Modify: `apps/react/src/ui/components/Stage/Stage.tsx` (regions useMemo — build polys via `objectToWorldPolygon(project, obj, time)` for the frozen ids; hover state; overlay render after the operand-ghost block, translucent evenodd fills, hovered emphasis, `onPointerDown` stopPropagation → alt? punch : merge (size-1 inert); early-exit branches in BOTH press handlers while active so tools don't fire; the corner hint element)
- Test: `Stage.test.tsx` (append: enter mode w/ two overlapping rects → overlay paths present (count = regions); synthetic pointermove sets hover emphasis (assert attribute/class); click overlap region → objects merged (count 1, fresh getState); alt-click → punch (both remain, `d`s changed); Escape exits — if keymap is reachable in the component test, else store-level covered in T2 and note it)

- [ ] **Steps:** TDD → implement → gates (`vitest run apps/react`, tsc, eslint) → commit `feat(app-react): shape-builder stage overlay + gestures`.

---

### Task 4: Inspector button + hint polish

**Files:**
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (multi-select panel: "Shape Builder" button beside the boolean row, aria-label `Shape builder`, disabled via canShapeBuilder mirror — follow the boolean buttons' VM wiring; when ACTIVE, the button reads "Done" or stays toggled — pin whichever)
- Test: Inspector.test.tsx append

- [ ] **Steps:** TDD → implement → gates → commit `feat(ui): shape-builder inspector affordance`.

---

### Task 5: E2E + full gates

**Files:**
- Create: `e2e/shape-builder.spec.ts`

- [ ] **Steps:** house style; draw two OVERLAPPING rects (drag coordinates overlapping); select both (marquee or shift-click per existing multi-select e2e precedent — find one); Inspector "Shape builder"; click the overlap region's stage coordinates → object count 1; undo → 2 (pin mode state after undo honestly); re-enter, alt-click overlap → count still 2 but both `d` attributes changed; undo. FULL GATES (tsc, full vitest, eslint, full playwright incl. @portable; workspace check; exact counts) → commit `test(e2e): shape-builder merge + punch flows`.

---

## Out of scope (per spec)

Drag multi-merge; curve-fidelity hover outlines; group/SVG operands; N>6; open-path operands; DSL/MCP.
