# Savig — M2 Feature 3: Node-Correspondence Editor (Design)

**Date:** 2026-06-20
**Status:** Approved design — ready for implementation planning
**Author:** Steve Hynding (with Claude)
**Roadmap:** [M2 Morph & Easing Roadmap §3.3](./2026-06-20-savig-m2-morph-easing-roadmap-design.md) — feature 3 of 4
**Builds on:** the reconcile seam landed by [Feature 2 — Arc-length morph](./2026-06-20-savig-m2-arc-length-morph-design.md)

## Summary

Let the user **explicitly control which node of keyframe A morphs into which node of
keyframe B**, instead of always matching by index. This fixes the index-pad
"rolling morph" artifact (a cyclically-shifted or middle-inserted node set rotates
through the whole shape mid-morph) while **preserving the user's real nodes and bezier
handles** — the thing arc-length `resampled` mode throws away.

The feature is **auto-suggest first, light manual second**:

- **Suggest** (one click) computes the cut-point rotation + winding that minimizes
  total travel and writes it as an explicit map. This alone fixes the headline
  equal-count rolling-morph case. It is `align()` re-expressed as an index map — a pure
  function, no new morph math.
- **Manual** correction is an offset nudge (shift cut-point ± / reverse winding) plus a
  Stage drag-to-link overlay for overrides and count-mismatch insertions.

Everything reduces to **one optional field** on the from-keyframe
(`correspondence?: number[]`), honored only in `corresponded` mode. Default-absent
reproduces today's index-pad morph exactly, so persistence is a **no-op version bump**
and every existing parity/e2e test passes unchanged.

### Stack & standards (unchanged from M1/M2)

pnpm · Vite · React 18 + TS (strict) · Zustand · Vitest + RTL · Playwright · CSS
Modules + design tokens. Client-only. TDD throughout. The engine layer stays **pure
TypeScript with zero React/DOM dependencies**; the render core lifts verbatim into the
export runtime. Preview == export parity is preserved: the editor Stage and the export
runtime reconcile/interpolate via the **same** pure `reconcile`/`samplePath` and
serialize via the **same** `pathToD`.

---

## 1. Why this feature, when `resampled` already exists

Feature 2's `resampled` mode produces a clean circle→star automatically — so it's worth
being precise about why feature 3 isn't redundant, because that distinction drives the
UI (the two modes must never look like competing knobs).

| | `resampled` (feature 2) | `corresponded` + `correspondence` (feature 3) |
|---|---|---|
| Node identity | **Destroyed** — fresh sample points | **Preserved** — your exact nodes |
| Bezier handles | Discarded (polyline flatten) | **Kept** |
| Sharp tips | Round slightly at N=64 | Exact |
| Best for | Genuinely different topology (circle→star) | Same/near topology where pairing is wrong (reorder, cyclic shift, middle insert) |
| Per-node easing (feature 4) | Not offered | Supported |

So the two are **sibling strategies under one seam**, not competitors. `correspondence`
is meaningful **only in `corresponded` mode**; the editor surfaces it only there.

---

## 2. Data model

One new **optional** field on the from-keyframe, mirroring the existing `easing`/`morph`
pattern (the from-keyframe owns its outbound transition):

```ts
interface ShapeKeyframe {
  time: number;
  path: PathData;
  easing: Easing;
  morph?: MorphMode;          // feature 2 — 'corresponded' (default) | 'resampled'
  correspondence?: number[];  // feature 3 — a-index → b-index map (corresponded mode only)
}
```

Semantics of `correspondence`:

- `correspondence[i] = j` means **A's node `i` morphs into B's node `j`**.
- Length is `=== a.nodes.length` (one entry per A node).
- **Default-absent = identity** = today's index-pad. No-op migration; old projects load
  unchanged; every Slice 2/3 + Feature 2 parity/e2e test passes byte-identically.
- Honored **only when** the transition resolves to `corresponded` mode
  (`a.morph ?? 'corresponded'`). Ignored under `resampled` (no stable node identity).

### 2.1 The cyclic-order constraint (load-bearing)

`samplePath` draws the interpolated array **in array order**, so the *pairing order is
the draw order*. It also returns the **raw keyframe** at `time ≤ first.time` and
`time ≥ last.time` — the reconciled array is used only *strictly between* — so the morph
is continuous at each end only if the reconciled array approaches that keyframe's outline.

The engine builds the matched arrays by **walking B in ring order** (§3.1), which makes
the **destination (B) endpoint trace B's outline exactly by construction**, for any
length+range-valid map. The remaining question is the *origin* (A) endpoint: its approach
is clean only when the map is **cyclic-order-preserving** (a rotation/reflection of the
ring, plus grow-from-point insertions) — otherwise the A nodes emerge in a reordered
sequence as `t → 0⁺`.

That ordering is therefore something the editor **steers toward, not something the engine
enforces**: the rotation Suggest and the shift/reverse controls only ever author
cyclic-order-preserving maps, and the drag-link overlay **flags** a crossing
(non-order-preserving) link with a warning style so the user can normalize it with
Suggest/shift (§4). The engine does not re-derive ordering — it relies on walk-B for the
destination and guards only the cheap, definite failure modes (length/range). This keeps
the parity oracle intact: a valid map preserves the destination endpoint always, and an
order-preserving map preserves both; even a crossing map still renders the **final** shape
B correctly and merely reorders the A-side approach for `t → 0⁺` — never a wrong endpoint,
never a crash.

Many-to-one **merges of adjacent A nodes** (two neighbours converging onto one B node)
remain cyclic-order-preserving and are allowed; under walk-B they appear as a B node with
two sources — a consecutive duplicate, i.e. an invisible zero-length edge.

---

## 3. Engine

### 3.1 Reconcile: the explicit-map branch

`reconcile` in `src/engine/morph/reconcile.ts` gains an explicit-map path inside the
`corresponded` branch. Its signature grows one optional argument, threaded from
`samplePath` (which already reads `a.morph` from the from-keyframe):

```ts
function reconcile(a: PathData, b: PathData, mode: MorphMode, correspondence?: number[]): Reconciled;
```

Today's `corresponded` branch:

```ts
const len = Math.max(a.nodes.length, b.nodes.length);
return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len) };
```

Revised — when a **valid** `correspondence` `c` is present (absent or invalid → today's
index-pad, unchanged), build the matched arrays by **walking B in ring order**
`j = 0..n-1`, gathering the A nodes that feed each B node (`srcs(j) = { i : c[i] = j }`):

- **`srcs(j)` empty** → B[j] is unreferenced: emit `(degenerate, B[j])` — a grow-from-point
  spur. The degenerate A anchor is the anchor of the **most recently emitted A node**,
  falling back to `A[0]` when none has been emitted yet (the spur grows from its
  neighbour). These are the "inserted" nodes — the middle-insert fix.
- **`srcs(j)` one `i`** → emit `(A[i], B[j])` (the normal pairing).
- **`srcs(j)` many** → an adjacent **merge**: emit `(A[i], B[j])` for each `i` (B[j]
  repeated → an invisible zero-length edge at `t=1`).

This makes `bn` exactly B's nodes in ring order (with consecutive dups for merges) — the
**destination endpoint is exact by construction** (§2.1) — and `an` the A nodes ordered by
their target, plus degenerate spurs. Both arrays have the same length
(`a.nodes.length + #unreferenced-B`). Downstream `lerpNode` is untouched.

**Validation / fallback.** `reconcile` falls back to today's index-pad identity when the
map's length ≠ `a.nodes.length` or any entry is outside `[0, b.nodes.length)` — the cheap,
definite failures (defends against hand-edited / older `.savig` files). It does **not**
re-derive cyclic-order-preservation; that is the editor's invariant (§2.1, §4), and walk-B
keeps the destination correct regardless. An absent map and an identity map
(`[0,1,…,m-1]` with equal counts) both produce byte-identical output to index-pad.

### 3.2 `suggestCorrespondence` — Suggest as a pure function

`align()` (`src/engine/morph/align.ts`) already searches rotations × windings for the
minimum-squared-distance reordering of equal-length node arrays, with deterministic ties
(lowest offset, forward winding). It currently returns *reordered nodes*. Refactor it to
also expose the winning **`{ offset, reversed }`**, then:

```ts
// src/engine/morph/suggest.ts (new, pure)
function suggestCorrespondence(a: PathData, b: PathData): number[];
```

returns the `number[]` index map for that rotation+winding.

- **Closed paths:** all cyclic offsets × both windings (full `align` search).
- **Open paths:** forward vs reversed only — an open path has no valid cyclic shift
  (shifting its start changes its identity). Offset is always 0; only winding may flip.
- **Equal node counts only** produce a rotation map. On **count mismatch**, Suggest
  returns a clamped-identity map (`c[i] = min(i, n-1)`) — a well-defined no-op a user can
  then edit; it does not invent merges. The user resolves insertions via the
  drag-link overlay.

`suggestCorrespondence` is a thin reuse of `align`'s existing cost/rotate logic — no new
geometry, and the same deterministic tie-breaks keep Stage==runtime parity.

### 3.3 What this feature does **not** touch in the engine

- **No curve-tight `pathBounds`.** The roadmap tentatively bundled it here, but only
  because it assumed an inline/modal correspondence canvas that normalizes-and-fits both
  shapes. The Stage-in-place editor (§4) renders both ghosts at their **real
  coordinates** via the existing painter, so there is nothing to fit. `pathBounds`
  stays an independent, separately-tracked refinement.
- **No change to `resample`/`align`'s resampled path**, `lerpNode`, or `pathToD`.
- **No new morph math** — Suggest is reused `align`; reconcile gains array bookkeeping.

---

## 4. UI

The feature surfaces in two shippable phases. The high-value/low-risk phase (Suggest +
nudge) ships first and fixes the documented bug with no new canvas; the heavier drag
overlay follows.

### 4.1 Phase B1 — Inspector "Correspondence" controls (ships first)

The existing Inspector **Keyframe** section (home of Feature 1's easing editor and
Feature 2's Grow/Resample `<select>`) gains a **Correspondence** group, shown **only**
when a shape keyframe is selected **and** its transition is `corresponded`
(hidden/greyed under `resampled` — §1):

- **`[Suggest]`** → `suggestCorrespondence(a, b)`, writes the map. One undo step.
- **`[◀ shift ▶]`** → rotate the cut-point ±1. **Closed paths only** (disabled/hidden
  for open paths — §3.2). One undo step per nudge.
- **`[reverse]`** → flip winding. Closed and open. One undo step.
- A read-only summary line derived by comparing the stored map to existing helpers
  (no new engine analyzer): `auto` (absent), `suggested` (equals
  `suggestCorrespondence`), or `custom` (anything else), with the node count.

Store action: `setSelectedShapeKeyframeCorrespondence(correspondence | undefined)`
(routes to the active shape keyframe; `undefined` clears back to identity), mirroring
`setSelectedShapeKeyframeMorph`. One undo step per gesture.

### 4.2 Phase B2 — Stage drag-to-link overlay

A "correspondence edit" sub-mode entered from the Inspector group (a toggle button;
`Escape`/`[done]` exits). While active:

- Both bracketing keyframes render **ghosted in place** on the Stage at real coordinates
  (reuse the existing path painter at reduced opacity; A and B visually distinguished).
- Nodes are drawn for both; **links** are drawn node→node per the current map.
- **Drag** a link endpoint from an A node to a B node to relink (sets `c[i] = j`). Reuses
  Slice 2's object-local CTM mapping. One undo step per relink (commit on release, outside
  React setState updaters per the Slice 2 StrictMode gotcha).
- **Crossing links flagged, not blocked:** a link that makes the map non-order-preserving
  renders in a warning style; the user normalizes it with Suggest / shift (§2.1). A hard
  "shift-instead-of-cross" drag interaction is deferred polish.
- An **unlinked B node** renders with a distinct dashed "grows from a point" marker, so
  the middle-insert case is legible.

Inspector Suggest/shift/reverse remain available while the overlay is open.

---

## 5. Testing (TDD: engine → parity → RTL → e2e)

**Engine (`reconcile`, `suggest`):**
- `reconcile` honors an explicit identity map byte-identically to absent (index-pad).
- A rotation map produces A's outline at `t=0` and B's outline at `t=1` (endpoints exact).
- The destination (B) endpoint traces B exactly for **any** length+range-valid map
  (including a deliberately non-order-preserving one — walk-B guarantee).
- Unreferenced B nodes appear as grow-from-point spurs at the correct ring position
  (degenerate anchor = previous emitted A node, else `A[0]`).
- Many-to-one adjacent merge is honored (B node duplicated → zero-length edge).
- Invalid maps (wrong length / entry out of range) fall back to index-pad identity.
- `suggestCorrespondence`: minimizes total travel on a rotated copy (recovers the offset);
  recovers reversed winding; open paths never shift (offset 0, winding only); deterministic
  ties (lowest offset, forward winding); immutability (inputs unmutated).

**Parity:** reconciled `d` identical Stage == export == runtime at several `t` for a
correspondence-mapped transition (regenerate the runtime bundle).

**RTL (B1):** Suggest writes a map; shift/reverse mutate it; shift disabled for open
paths; controls visible only in `corresponded` mode; summary reflects state; one undo
step per gesture; routes to the active shape keyframe.

**RTL + e2e (B2):** drag creates/changes a link; crossing links flagged; unlinked B shows
the grow marker; map persists across reload. **e2e:** map a middle-inserted node so the
exported morph no longer rolls (assert the inserted node grows from a point rather than
the whole ring rotating).

---

## 6. Plan decomposition

- **Plan A — engine** (pure, TDD): `correspondence?: number[]` field; explicit-map branch
  in `reconcile` (walk-B + grow-from-point insertions; length/range identity fallback);
  `suggestCorrespondence` refactored out of `align` (expose `{offset, reversed}`);
  runtime bundle regenerated; parity assertions; **no migration** (no-op bump).
- **Plan B1 — Inspector nudge UI** (RTL): `setSelectedShapeKeyframeCorrespondence`;
  Suggest / shift (closed-only) / reverse; corresponded-mode-only visibility; summary;
  one-undo.
- **Plan B2 — Stage drag-link overlay** (RTL + Playwright): ghost overlay; drag-relink via
  object-local CTM; crossing-link warning flag; grow-from-point marker; persistence;
  middle-insert e2e.

Each prefix is shippable: A alone makes `correspondence` honored (Suggest could even be
invoked from tests/console); A+B1 delivers the one-click rolling-morph fix; +B2 adds
manual overrides and the insertion workflow.

---

## 7. Cross-cutting invariants (unchanged)

- **Preview == export parity** through the shared pure `reconcile`/`samplePath` →
  `pathToD`. New parity assertions at several `t`.
- **Optional field only** → persistence is a no-op version bump; default-absent
  reproduces today's index-pad morph exactly.
- **One undo step per user gesture** (Suggest, each shift, reverse, each relink),
  consistent with existing keyframe/node actions.
- **Engine stays pure** (no React/DOM); the runtime bundle lifts verbatim and is
  regenerated when the engine changes.
- **TDD**: engine oracle tests first, then runtime/parity, then RTL, then e2e.

---

## 8. Fresh-perspective self-review

- **Is feature 3 redundant given `resampled`?** No — §1: it preserves real nodes/handles
  and sharp tips that resampling discards, and fixes pairing for same-topology shapes.
  The UI gates `correspondence` to `corresponded` mode so the two never compete. ✓
- **Does the explicit map risk the parity guarantee?** Only if it changed `corresponded`
  output. Default-absent and identity maps are byte-identical to index-pad; length/range-
  invalid maps fall back to identity; the walk-B construction makes the destination
  endpoint exact for any valid map, and the editor keeps maps cyclic-order-preserving so
  the origin approach is clean too. Guarded by existing Slice 2/3 + Feature 2 parity/e2e. ✓
- **Is Suggest actually free?** It's `align()`'s existing rotation×winding search re-emitted
  as an index map; no new geometry, same deterministic ties. ✓
- **Was scope correctly trimmed?** Yes — curve-tight `pathBounds` is dropped (§3.3): the
  Stage-in-place placement removed its only rationale. It remains tracked separately. ✓
- **Open paths handled?** Yes — Suggest never cyclically shifts an open path; the shift
  control is closed-only (§3.2, §4.1). ✓
- **Could stopping early strand value?** No — A / A+B1 / A+B1+B2 are each shippable (§6). ✓
- **Biggest residual risk.** Phase B2's ghost-overlay drag interaction and keeping commits
  outside React setState updaters (Slice 2 StrictMode gotcha). De-risked by flagging (not
  hard-blocking) crossing links — the hard shift-instead-of-cross interaction is deferred.
  Flagged for B2's plan; B1 carries no such risk. ✓
