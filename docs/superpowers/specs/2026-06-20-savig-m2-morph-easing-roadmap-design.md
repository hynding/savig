# Savig — M2 Morph & Easing Roadmap (Design)

## Summary

A sequencing roadmap for the four deferred features catalogued in
[§11 of the Slice 3 morphing design](./2026-06-20-savig-m2-slice3-path-morphing-design.md),
plus three small related items discovered while planning:

1. **Unified keyframe easing-editing UI** (scalar **and** shape keyframes)
2. **Arc-length / cross-shape morph** (true-topology resampling, e.g. circle → star)
3. **Node-correspondence editor** (explicit node→node mapping across keyframes)
4. **Per-node easing** (one easing per morphing node, not one per keyframe)

This document is **not** an implementation plan. It establishes the dependency
structure, recommends a build order with rationale, and gives a per-feature design
sketch (approach options, recommendation, risks, test strategy, plan decomposition)
so each feature can enter its own `brainstorming → spec → writing-plans` cycle when
its turn comes. The first feature (easing-editing UI) is taken further, into a full
design, immediately after this roadmap is approved.

### Stack & standards (unchanged from M1/M2)

pnpm · Vite · React 18 + TS (strict) · Zustand · Vitest + RTL · Playwright ·
CSS Modules + design tokens. Client-only. TDD throughout. The engine layer stays
**pure TypeScript with zero React/DOM dependencies** so the render core lifts
verbatim into the export runtime. Preview == export parity is preserved for every
feature: the editor Stage and the export runtime interpolate via the **same** pure
`samplePath`/`interpolate` and serialize via the **same** `pathToD`.

---

## 1. The unifying architecture

### 1.1 The reconciliation seam

All three *morph* features (2, 3, 4) touch **one** step inside `samplePath`
(`engine/path.ts`): the reconciliation of two keyframes' node lists into matched,
equal-length pairs before componentwise interpolation. Today that step is hardcoded
as **index-pad** (`padNodes`, `path.ts:80`): match by index, pad the shorter list's
tail with degenerate nodes collapsed onto the last shared anchor.

The roadmap's foundational move is to factor that one step into a pluggable
**reconciliation strategy**:

```ts
// engine/morph/reconcile.ts (new)
interface Reconciled {
  an: PathNode[];          // a's nodes, length L
  bn: PathNode[];          // b's nodes, length L
  pairEasings?: Easing[];  // optional per-pair easing (feature 4)
}
function reconcile(a: PathData, b: PathData, kf: ShapeKeyframe): Reconciled;
```

- **index-pad** — today's behavior; the default when nothing else is requested.
- **arc-length resample** — feature 2 (a new strategy).
- **explicit map** — feature 3 (a user-authored strategy).

`samplePath` keeps its bracketing/clamp/easing logic and calls `reconcile` where it
currently calls `padNodes`. **Critical constraint:** with no new keyframe fields,
`reconcile` must return byte-identical arrays to today's `padNodes`, so the Slice 2/3
parity tests and export e2e pass unchanged. The refactor is behavior-preserving by
construction.

### 1.2 Everything hangs off optional `ShapeKeyframe` fields

Like `easing`, each feature's data lives on the **"from" keyframe** that owns the
outbound transition, and each field is **optional** — so default-absent reproduces
today's index-pad morph exactly, and every persistence migration is a **no-op
version bump**:

```ts
interface ShapeKeyframe {
  time: number;
  path: PathData;
  easing: Easing;                          // (exists) per-keyframe transition easing
  morph?: 'corresponded' | 'resampled';    // feature 2 — default 'corresponded' (= index-pad)
  correspondence?: number[];               // feature 3 — a-index → b-index map
  nodeEasings?: Easing[];                   // feature 4 — per-node easing, corresponded mode only
}
```

That all four features reduce to optional fields on one interface — none requiring a
schema break — is the strongest signal the ordering below is natural rather than
forced.

### 1.3 The node-identity tension (why order matters)

Two features **require node identity** to be preserved across keyframes
(they map "node *i* → node *j*"): **per-node easing (4)** and the
**correspondence editor (3)**. One feature **destroys** node identity:
**arc-length resampling (2)** generates fresh sample points, so "node 3" stops
meaning anything user-visible.

Resolution — a per-transition **morph mode**:

- **corresponded** (index or explicit map): identity-preserving; supports per-node
  easing and the correspondence editor.
- **resampled** (arc-length): single easing for the whole transition; per-node
  easing is not offered.

So features 2 and 3 are **sibling strategies** under the same seam, not competitors,
and feature 4 layers cleanly onto corresponded transitions only.

---

## 2. Recommended order

| # | Feature | Rationale for position |
|---|---------|------------------------|
| **1** | **Unified easing-editing UI** | Independent, lowest-risk, highest value-to-effort. `Easing` (incl. `cubicBezier`) is already stored on scalar **and** shape keyframes and already consumed by `interpolate`/`applyEasing` — so this is **pure UI, zero engine change**. Builds the curve-editor widget reused by features 3–4. Benefits *every* keyframe, not just morphs. |
| **2** | **Arc-length / cross-shape morph** | The "documented next slice." Establishes the **reconciliation seam** (the big refactor) and the arc-length strategy. Doing the seam early gives 3 and 4 stable ground. The headline feature; also the highest-risk one. |
| **3** | **Node-correspondence editor** | Explicit-map strategy on the seam + an editor UI. Fixes the documented "middle-insert rolling morph" limitation; gives manual control where auto-resample isn't wanted. Also resolves the cross-keyframe node-selection corner noted in Slice 3 §7. |
| **4** | **Per-node easing** | Most expressive, most niche, depends on everything: reuses feature 1's curve editor and attaches easing to the corresponded node-pairs that 2/3 define. |

**Acceptable swaps:** If you'd rather lead with the headline morph, swap 1↔2 — feature 1
is days-not-weeks, so the cost is small. Feature 4 can be pulled before 3 if per-node
easing is wanted sooner and index-matching fragility is acceptable.

**Three small related items, folded in (not standalone):**

- **"Animate from current" one-click** (seed a keyframe at t=0 from base) — tiny;
  rides along with feature 2's morph-authoring UI.
- **Curve-tight `pathBounds`** — currently anchor-extent only (`path.ts:42`); improves
  selection and the correspondence-editor overlay; bundle with feature 3.
- **Per-frame path buffer reuse** (perf) — fast-follow after feature 2, which adds
  per-frame resample cost on top of the per-frame `samplePath`/`pathToD` already
  incurred by morphs.

---

## 3. Feature sketches

### 3.1 Feature 1 — Unified keyframe easing-editing UI  *(next deep-dive)*

**Goal.** Let the user edit the `easing` of any selected keyframe — scalar
(`Keyframe`) or shape (`ShapeKeyframe`) — via presets and a draggable cubic-bezier
curve. Pure UI: the engine already interpolates whatever `Easing` value is stored.

**Approach options.**
- **(A1) Presets-only dropdown** — `linear / easeIn / easeOut / easeInOut`. Trivial,
  but leaves `cubicBezier` (already supported in data) unreachable.
- **(A2, recommended) Presets + draggable bezier curve editor** — a small SVG curve
  widget with two draggable control points writing a `CubicBezierEasing`, plus preset
  buttons that snap the curve. Exposes the full power already in the engine; the
  widget is the reusable primitive features 3–4 need.
- **(A3) Numeric four-field bezier entry** — precise but unfriendly; offer as a
  secondary input inside A2, not instead of it.

**Recommendation:** A2, with A1's presets as one-click snaps and A3's numeric fields
as an "advanced" affordance.

**Discovered scope to fold in:** `Keyframe.rotationMode` (`types.ts:38`) also has no
editor. The per-keyframe **detail panel** this feature introduces is its natural home
(a `shortest / raw` toggle, shown only for rotation-track keyframes).

**Surfaces.** Inspector gains a "Keyframe" detail section shown when a scalar or shape
keyframe is selected (selection plumbing already exists: `selectedKeyframe` /
`selectedShapeKeyframe`). One store action `setSelectedKeyframeEasing(easing)` routes
to the scalar track or the shape track by which selection is active (mirrors the
existing context-aware Delete priority). One undo step per change.

**Risks.** Low. Curve-editor drag math and keyboard accessibility are the only real
work. No engine, no migration, no parity surface.

**Tests.** RTL: preset buttons write the named easing; dragging a control point writes
a `cubicBezier`; the editor reads back the selected keyframe's current easing; routes
to scalar vs shape track correctly; rotationMode toggle only for rotation keyframes;
one undo step. Engine already covered.

**Plan decomposition.** Single plan (UI-only): curve-editor widget → Inspector detail
section + store action → rotationMode toggle → wiring/selection tests.

---

### 3.2 Feature 2 — Arc-length / cross-shape morph

**Goal.** Morph between shapes of genuinely different topology (circle → star)
without the index-pad "grow from a point" artifact, by resampling both bracketing
paths to a common, evenly-parameterized point set.

**Approach options.**
- **(B1) Uniform arc-length resampling to N points** — flatten each path to a
  polyline, resample both at N equal arc-length positions, interpolate positionally.
  Simple, robust, loses bezier smoothness mid-morph (re-fit optional).
- **(B2, recommended) Arc-length resampling with rotation + winding alignment** — B1
  plus: pick N from the max node count (or a setting); choose the **cut point** that
  minimizes total travel (rotate the sample ring so start points align) and **match
  winding direction** so the morph doesn't twist or turn inside-out.
- **(B3) Curvature-aware correspondence** — match by turning-angle/feature points.
  Best quality, much higher complexity; defer.

**Recommendation:** B2. The cut-point and winding alignment are exactly what separate
a clean circle→star from a twisting mess; they're the core of the feature, not polish.

**Seam work (prerequisite).** Land §1.1's `reconcile` refactor **first**, byte-identical
for index-pad, guarded by existing parity tests. Add `morph?: 'corresponded' |
'resampled'` to `ShapeKeyframe` (default-absent = corresponded = index-pad). The
arc-length strategy runs when the from-keyframe is `'resampled'`.

**Risks.** Highest of the four. Open sub-questions: choosing N (fixed? max-count?
per-keyframe setting?); resampling cubic segments by arc length (numeric length +
parameter inversion, cf. the bezier solver already in `easing.ts`); preserving/refit
of handles; the per-frame cost of resampling (feeds the buffer-reuse fast-follow).
These get resolved in feature 2's own brainstorm, not here.

**Tests.** Engine: resample produces N points; round-trip a path through resample is
shape-stable; cut-point alignment minimizes travel on a rotated copy; winding match
prevents inversion; immutability. Parity: resampled `d` identical Stage == export ==
runtime at several `t`. e2e: circle keyframe → star keyframe, export animates without
the index-pad collapse artifact.

**Plan decomposition.** Plan A (engine): reconcile seam + `morph` field + arc-length
strategy + parity. Plan B (UI/perf): morph-mode toggle in Inspector, "animate from
current" one-click, optional buffer reuse.

---

### 3.3 Feature 3 — Node-correspondence editor

**Goal.** Let the user explicitly map which node of keyframe A becomes which node of
keyframe B, fixing the index-pad middle-insert "rolling morph" limitation and giving
deliberate control over corresponded morphs.

**Approach options.**
- **(C1) Auto-correspondence heuristic only** (nearest-neighbour / angular) — no UI;
  helps but is unpredictable and unfixable when wrong.
- **(C2, recommended) Explicit map stored on the keyframe + drag-to-link editor** —
  `correspondence?: number[]` on the from-keyframe (a-index → b-index; absent = identity).
  Editor renders both bracketing shapes (ghosted) with their nodes and lets the user
  drag links; unmapped nodes fall back to index/grow-from-point.
- **(C3) C2 seeded by C1's heuristic** — auto-propose, user corrects. Best UX; do
  the heuristic as a "suggest" button inside C2, not a separate mode.

**Recommendation:** C2, with C3's "suggest" as a follow-on affordance.

**Depends on.** The reconcile seam (feature 2). Benefits from **curve-tight
`pathBounds`** for an accurate ghost overlay — bundle that refinement here. Resolves
Slice 3 §7's cross-keyframe node-selection corner (the map makes "the same node"
well-defined).

**Risks.** Medium-high, mostly UI: a two-shape linking canvas, link persistence,
validation (one-to-one? many-to-one allowed for merges?), and undo granularity.

**Tests.** Engine: `reconcile` honors an explicit map (incl. many-to-one / unmapped
fallback); immutability. RTL: drag creates/removes a link; map persists; "suggest"
seeds a heuristic map; one undo step. e2e: map a middle-inserted node so the morph no
longer rolls.

**Plan decomposition.** Plan A (engine): explicit-map reconcile strategy +
`correspondence` field + curve-tight bounds. Plan B (UI): the linking editor + suggest.

---

### 3.4 Feature 4 — Per-node easing

**Goal.** Give each morphing node its own easing into the next keyframe (a blob whose
lobes arrive on different beats), instead of one easing for the whole shape.

**Approach options.**
- **(D1, recommended) Optional `nodeEasings?: Easing[]` parallel to `nodes`** —
  honored only in corresponded mode; absent entries fall back to the keyframe's
  `easing`. `reconcile` carries `pairEasings`; `lerpNode` takes a per-pair easing.
- **(D2) Per-node easing as a separate keyframe-like structure** — more general,
  far heavier; YAGNI.

**Recommendation:** D1 — minimal, optional, identity-preserving, sparse-by-default.

**Depends on.** Feature 1 (reuses the curve editor, now scoped to the selected node)
and the corresponded reconcile path from features 2/3 (defines what a "node pair" is).
Explicitly **not offered** for `'resampled'` transitions (§1.3).

**Risks.** Low-medium. Main subtlety: `nodeEasings` must track node add/delete edits
on the keyframe (keep the array aligned, or store sparsely keyed by node index).

**Tests.** Engine: `samplePath` applies per-node easing in corresponded mode; ignores
it in resampled mode; absent entry falls back to keyframe easing; array stays aligned
across a node edit. RTL: select a node → edit its easing via the feature-1 widget →
one undo step. e2e: two-node path where one node eases in and the other linear.

**Plan decomposition.** Single plan: `nodeEasings` field + `reconcile`/`lerpNode`
plumbing + Inspector "selected node easing" reuse of the feature-1 widget + tests.

---

## 4. Cross-cutting invariants (apply to every feature)

- **Preview == export parity** through shared pure `samplePath`/`interpolate` →
  `pathToD`. Every morph feature adds a parity assertion at several `t`.
- **Optional fields only** → every persistence change is a no-op version bump; old
  projects load unchanged; default-absent reproduces today's behavior.
- **One undo step per user gesture**, consistent with existing keyframe/node actions.
- **Engine stays pure** (no React/DOM) so the runtime bundle lifts verbatim; UI-only
  features (1) touch no engine, engine features regenerate the runtime bundle.
- **TDD**: engine oracle tests first, then runtime/parity, then RTL, then e2e.

---

## 5. Fresh-perspective review (self-review of this roadmap)

- **Is feature 1 truly engine-free?** Verified: `interpolate.ts:39` and
  `applyEasing` (`easing.ts:63`) already consume `Easing` incl. `cubicBezier`; the
  editor only writes the value. No migration. ✓
- **Does the seam refactor risk the parity guarantee?** Only if it changes index-pad
  output. The refactor is defined as behavior-preserving and is guarded by the Slice
  2/3 parity tests + export e2e, which must pass before the arc-length strategy lands. ✓
- **Are 2 and 3 actually independent, or does one block the other?** Both depend only
  on the seam (lands with 2). After that they're parallelizable; 3 is placed third
  only because correspondence editing is most valuable once arc-length exists as the
  alternative. ✓
- **Could the order strand value if we stop early?** No — each prefix is shippable: 1
  alone is a complete feature; 1+2 delivers cross-shape morph; +3 adds control; +4
  adds polish. ✓
- **Scope check.** Four features + three folded items, each decomposing into 1–2
  plans, each its own brainstorm cycle. Appropriately decomposed; this doc stays a
  roadmap, not a mega-spec. ✓
- **Biggest residual risk.** Feature 2's arc-length resampling quality (cut-point,
  winding, N, handle re-fit). Flagged as the schedule risk; its open questions are
  deliberately deferred to its own brainstorm rather than guessed here. ✓

---

## 6. Next step

After this roadmap is reviewed, deep-dive **Feature 1 — Unified keyframe
easing-editing UI** into a full design and then an implementation plan
(`writing-plans`). Features 2–4 each begin their own `brainstorming → spec →
writing-plans` cycle when reached.
