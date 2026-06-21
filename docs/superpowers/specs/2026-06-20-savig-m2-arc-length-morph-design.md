# Savig — Arc-Length / Cross-Shape Morph (Design)

## Summary

Feature 2 of the [M2 Morph & Easing Roadmap](./2026-06-20-savig-m2-morph-easing-roadmap-design.md).
Lets a path morph between shapes of genuinely different topology (circle → star,
blob → arrow) without the index-pad "grow from a point" artifact, by **resampling
both bracketing shapes to a common, arc-length-even point set** and interpolating
point-to-point.

This is the roadmap's headline feature and it lands the **reconciliation seam**: the
one node-normalization step inside `samplePath` is factored into a pluggable
strategy so this feature (and the later correspondence editor + per-node easing)
extend `samplePath` rather than rewrite it.

Two decisions chosen during brainstorming:

1. **Polyline resampling (flubber/polymorph-style).** Each path is resampled to `N`
   points lying on its true bezier curve, by arc length; in-between frames are dense
   polygons (straight segments). Curve-handle refit is deferred.
2. **Explicit per-keyframe opt-in.** Default stays index-pad (`corresponded`,
   backward-compatible, preserves grow-from-a-point). Resampling is turned on per
   shape keyframe via an optional `morph: 'resampled'` field on the **from**-keyframe
   (which governs its outbound transition, exactly like `easing`).

The parity oracle is preserved: the resample + alignment is pure, dependency-free,
and shared by the Stage and the export runtime through the same `samplePath` →
`pathToD`, so a resampled morph is byte-identical preview == export.

### Stack & standards (unchanged from M1/M2)

pnpm · Vite · React 18 + TS (strict) · Zustand · Vitest + RTL · Playwright ·
CSS Modules + design tokens. Client-only. TDD throughout. The engine layer stays
**pure TypeScript with zero React/DOM dependencies** so the render core lifts
verbatim into the export runtime.

---

## Scope

### In scope

- A pluggable **`reconcile(a, b, mode)`** seam inside `samplePath`, with the existing
  index-pad extracted as the `corresponded` strategy (**byte-identical** output).
- The **`resampled`** strategy: deterministic flatten → cumulative arc length →
  `N` even samples → alignment (closed: rotation + winding; open: endpoints fixed).
- An optional **`morph?: 'corresponded' | 'resampled'`** field on `ShapeKeyframe`
  (absent = `corresponded`).
- A **per-keyframe morph-mode toggle** in the Inspector "Keyframe" section.
- `setSelectedShapeKeyframeMorph` store action.
- Preview == export parity for resampled morphs; runtime bundle regeneration.
- Playwright e2e: circle → star resampled morph exports and animates without the
  grow-from-point collapse.

### Out of scope (deferred, tracked)

- **Curve-handle refit** (smooth in-between curves) — polyline only this feature.
- **Feature-point-preserving / curvature-aware resampling** — uniform arc length
  this feature; sharp tips may round slightly (see §7). Roadmap's B3.
- **`selectEditablePath` on-keyframe refinement** — only needed to edit an *interior*
  keyframe of a 3+-keyframe resampled morph; documented rough edge (§7).
- **"Animate from current" one-click** — orthogonal convenience; deferred.
- **Adaptive / configurable `N`** — fixed global constant this feature.
- **Per-transition alignment memoization** (perf) — correctness-first; joins the
  roadmap's buffer-reuse item.
- Node-correspondence editor (Feature 3) · per-node easing (Feature 4).

### No persistence version bump

`morph?` is additive and optional: absent = `corresponded`, so old `.savig`/autosave
projects load unchanged, and new projects load on old code as plain index-pad.
A bump would only re-trigger the Slice-3 version-assertion-test gotcha for zero
functional gain. Plan A includes a check that the loader preserves the field
(round-trips unknown/new optional fields).

---

## 1. Architecture (fits the existing three layers)

```
UI layer        Inspector morph-mode toggle (Keyframe section) ·
                store setSelectedShapeKeyframeMorph
Engine layer    reconcile seam (corresponded | resampled) · resample.ts
                (flatten + arc-length sample) · align.ts (rotation/winding) ·
                morph? on ShapeKeyframe · samplePath integration
Services layer  runtime bundle regen (samplePath already called via computeFrame)
```

**Key principle preserved:** `reconcile`/`resample`/`align`/`pathToD` are pure and
dependency-free, called by **both** the Stage and the export runtime, so the editor
and the exported bundle emit byte-identical morph frames.

New engine files (kept small and single-responsibility):
- `engine/morph/resample.ts` — flatten + arc-length resample of one `PathData` to `N` points.
- `engine/morph/align.ts` — best rotation/winding of one point set against another.
- `engine/morph/reconcile.ts` — the strategy dispatch (`corresponded` = index-pad; `resampled`).

`samplePath` (in `engine/path.ts`) calls `reconcile` where it currently calls
`padNodes`; `padNodes` moves into `reconcile.ts` as the `corresponded` strategy.

---

## 2. Data model

```ts
type MorphMode = 'corresponded' | 'resampled';

interface ShapeKeyframe {
  time: number;
  path: PathData;
  easing: Easing;
  /** Reconciliation for the transition INTO the next keyframe. Absent = 'corresponded'
   *  (index-pad, today's behavior). 'resampled' = arc-length cross-shape morph. */
  morph?: MorphMode;
}
```

`PathData` / `PathNode` are unchanged. The field lives on the **from**-keyframe (like
`easing`): a transition `a → b` is resampled iff `a.morph === 'resampled'`.

---

## 3. Engine

### 3.1 The reconcile seam

```ts
// engine/morph/reconcile.ts
interface Reconciled { an: PathNode[]; bn: PathNode[] }   // equal length L
function reconcile(a: PathData, b: PathData, mode: MorphMode): Reconciled;
```

- **`corresponded`** (default): today's index-pad. `len = max(a.len, b.len)`;
  `an = padNodes(a, len)`, `bn = padNodes(b, len)`. **Byte-identical to today** — the
  Slice-3 parity tests and morph e2e guard this.
- **`resampled`**: `an = resample(a, N)`, `bn = align(resample(b, N), an, a.closed)`.
  Both length `N`; nodes are **corners** (anchor only, no handles).

`samplePath` keeps its bracket/clamp/easing structure and lerps `an[i]`↔`bn[i]` by the
eased progress `t` (the existing `lerpNode` loop, unchanged). `closed = a.path.closed`
(hold-from, unchanged). Clamp/single-keyframe paths still return the **real** `path`
(no resampling outside a transition).

### 3.2 `resample(path, N)` — pure, deterministic

`engine/morph/resample.ts`. `N` is a **global module constant** `SAMPLE_COUNT = 64`
(see §3.4 for why global). Steps:

1. **Flatten** to a fine polyline: each segment from `pathToD`'s view — a straight
   `L` contributes its endpoint; a cubic `C` (either endpoint has a handle) is
   subdivided into `FLATTEN_STEPS = 16` equal-parameter points via the standard cubic
   formula `B(u) = (1-u)³P0 + 3(1-u)²u·C1 + 3(1-u)u²·C2 + u³P3`. Closed paths include
   the closing segment back to node 0.
2. **Cumulative arc length** along the flattened polyline (Euclidean between
   consecutive flattened points).
3. **Sample `N` points** at even arc-length positions. Open path: fractions
   `i/(N-1)` for `i in [0, N-1]` (endpoints exactly hit). Closed path: fractions
   `i/N` for `i in [0, N-1]` (no duplicate close point; index 0 = arc-length 0).
   Each sampled position is found by walking the cumulative-length table and linearly
   interpolating within the bracketing flattened segment, so sampled points lie on the
   true curve.
4. Return `N` corner `PathNode`s (`{ anchor }`, no `in`/`out`).

**Degenerate guards:** a path with 0 nodes → `N` zero points; with all points
coincident (total length 0) → `N` copies of that point (no divide-by-zero).

### 3.3 `align(bPoints, aPoints, closed)` — pure

`engine/morph/align.ts`. Returns `bPoints` reordered to best match `aPoints`
(both length `N`), minimizing **total squared distance** Σ|aPoints[i] − bPoints[i]|².

- **Closed:** try every cyclic rotation offset `k in [0, N)` of `bPoints`, in both
  forward and reversed winding (`2N` candidates), pick the minimum-cost ordering.
  O(N²) per transition (≈ 8k ops at N=64; per-frame for now, memoization deferred).
- **Open:** no rotation (endpoints are fixed); compare forward vs reversed only, pick
  the cheaper. (Reversing an open path keeps its endpoints, swapping which is first.)

`aPoints` is canonical (never reordered), so a keyframe's own resampled set is stable.

### 3.4 Why `N` is global (continuity at interior keyframes)

At an interior keyframe shared by two resampled transitions, the keyframe is rendered
from its left segment (as the *to*-shape, aligned to the previous keyframe) and its
right segment (as the canonical *from*-shape). With a **global** `N`, both are the
same `N` points of that keyframe's geometry; alignment may reorder/reverse them, but a
closed polygon through the same points is **visually identical** regardless of starting
vertex/direction — so there is no resolution or shape pop at the boundary. A
per-transition `N` would render the shared keyframe at two different resolutions on
either side. Hence `N` is a single global constant.

### 3.5 Pipeline (unchanged plumbing)

`sampleObject` → `RenderState.path = samplePath(shapeTrack, time)` is unchanged;
`computeFrame` already emits `pathD = pathToD(state.path)` and the per-frame pivot
from sampled bounds (Slice 3). Because resampling is internal to `samplePath`, the
**runtime bundle (`runtimeSource.generated.ts`) is regenerated** via the existing
esbuild script and a resampled path animates in export with no new runtime code.

---

## 4. Rendering & export / parity

- **Stage & runtime** both serialize `pathToD(samplePath(track, t))`; resampled output
  is `M` + `N−1`/`N` straight `L`s (numeric-derived → XSS-safe, as Slice 3).
- A parity test asserts Stage-sampled `d` === exported initial `d` === runtime
  per-frame `d` at several `t` for a `resampled` morph, all through the shared
  `samplePath` → `pathToD`.
- The `corresponded` path keeps Slice 3's exact behavior (byte-identical), reconfirmed
  by the existing morph parity e2e.

---

## 5. UI layer (Plan B)

### 5.1 Inspector — morph-mode toggle

In the existing **"Keyframe" section** (added by Feature 1), when the selected keyframe
is a **shape** keyframe, render a `corresponded / resampled` control (a `select` or
segmented toggle, `aria-label="morph mode"`) bound to `setSelectedShapeKeyframeMorph`.
It governs the outbound transition, so — like easing — it is inert on the last keyframe
(the section's existing inert hint communicates this; the control is shown, not hidden,
for consistency with easing).

### 5.2 Store action

```ts
setSelectedShapeKeyframeMorph(mode: MorphMode): void
```

Applies only when a shape keyframe is selected (`selectedShapeKeyframe`): maps the
object's `shapeTrack`, replacing the entry at the selected time (`KF_EPS`) with
`{ ...k, morph: mode }`; one `commit` (one undo step). No-op otherwise. Mirrors
`setSelectedKeyframeEasing`.

### 5.3 No Stage changes

The resampled shape renders through the existing path-render branch
(`samplePath` → `pathToD`). Authoring stays on keyframes: the two (or more) shape
keyframes are drawn/edited as normal `PathData`; toggling `resampled` only changes how
the in-between is reconciled, not the stored snapshots.

---

## 6. Persistence

No version bump (§Scope). `morph` is plain optional data: it rides along in the
`.savig` zip and IndexedDB autosave, and participates in undo/redo (it lives on the
undoable `SceneObject.shapeTrack`). Plan A adds a round-trip test confirming `morph`
survives save → load.

---

## 7. Error handling & edge cases

- **Mode absent** → `corresponded` (today's behavior).
- **Clamp / single keyframe / outside a transition** → real `path` returned, no
  resampling.
- **Zero-length / coincident path** → `N` copies of the point (§3.2 guard).
- **Open vs closed** → §3.2/§3.3 handle each; open keeps endpoints, closed aligns
  rotation + winding.
- **Sharp tips slightly rounded** under uniform arc-length sampling when no sample lands
  on a vertex (mitigated by `N=64`); feature-point-preserving resampling deferred.
- **Editing an interior keyframe of a 3+-keyframe resampled morph** at its exact time
  shows the resampled polygon in the node overlay (samplePath returns the resampled set
  there), so a node edit would seed a polygon. The 2-keyframe case is unaffected (first
  & last clamp-return their real paths). Authoring guidance: **author shapes on the
  first/last keyframes, or toggle resampled after authoring.** The `selectEditablePath`
  on-keyframe refinement that removes this edge is deferred.
- **Per-frame cost** — resample+align run per frame (pure, like `samplePath` today);
  memoization is the tracked perf fast-follow.

---

## 8. Performance

Resampled morphs add per-frame work: flatten (`FLATTEN_STEPS`×segments), arc-length
sample (`N`), and alignment (O(N²) for closed). At `N=64` this is bounded (a few
thousand float ops per morphing path per frame) and only incurred for paths whose
from-keyframe is `resampled`; `corresponded` paths and static paths keep their current
cost. Alignment and the resampled point sets are deterministic per keyframe-pair, so
**per-transition memoization** is the natural optimization (deferred), joining M1's
tracked perf items.

---

## 9. Testing strategy (TDD)

**Engine (pure, no DOM):**
- `resample`: returns `N` points; sampled points lie on the curve (a straight-edge case
  has exact midpoints; a known cubic has expected arc-length points); uniform arc-length
  spacing (consecutive gaps ≈ equal on a constant-curvature shape); open endpoints hit
  exactly; closed has no duplicate close point; zero-length guard; immutability.
- `align`: a rotated copy of a shape aligns to ~zero cost at the correct offset (no
  twist); a reversed-winding copy is detected; open path picks forward vs reversed.
- `reconcile`: `corresponded` is byte-identical to the old `padNodes` path (snapshot a
  few count-mismatch cases); `resampled` returns `N`-length corner nodes.
- `samplePath`: `resampled` from-keyframe interpolates point-to-point with easing;
  `corresponded`/absent unchanged; clamp returns real path.
- `computeProjectDuration`, pivot, etc. unchanged (no new behavior).

**Runtime ↔ engine / export / parity:**
- `computeFrame` emits `pathD` for a resampled morph; Stage-sampled `d` === exported
  initial `d` === runtime per-frame `d` at several `t`.
- Existing `corresponded` morph parity e2e still passes (byte-identical seam).

**UI (RTL):**
- `setSelectedShapeKeyframeMorph` writes `morph` on the selected shape keyframe (one
  undo step); no-op when no shape keyframe selected.
- Inspector shows the morph toggle for a selected shape keyframe and applies it; not
  shown for a scalar keyframe.

**E2E (Playwright, real Chromium):**
- Draw/author a ~circle keyframe and a star keyframe at two times, set the first to
  `resampled`, export, and assert the exported `d` **animates with a constant point
  count** across frames (no index-pad grow-from-point collapse) and matches the
  in-editor preview at sampled times.

**Persistence:**
- A project with a `morph:'resampled'` keyframe round-trips through save → load
  unchanged; a v4 project with no `morph` loads as `corresponded`.

---

## 10. Plan decomposition (for writing-plans)

Two plans, mirroring Slices 1–3, each its own writing-plans → execution cycle:

- **Plan A — Engine & pipeline (no UI):** `MorphMode` + `morph?` on `ShapeKeyframe`;
  `engine/morph/resample.ts`, `align.ts`, `reconcile.ts` (extract `corresponded` =
  index-pad byte-identical; add `resampled`); `samplePath` integration; parity tests;
  runtime bundle regeneration; persistence round-trip test; engine barrel updates.
- **Plan B — UI:** `setSelectedShapeKeyframeMorph` store action; Inspector morph-mode
  toggle in the Keyframe section; Playwright circle→star resampled-morph e2e.

---

## 11. Open questions / deferred decisions

- **Curve-handle refit** for smooth in-between curves — deferred (polyline this feature).
- **Feature-point-preserving resampling** (preserve sharp vertices) — deferred (B3).
- **`selectEditablePath` on-keyframe refinement** (edit interior keyframes of 3+-keyframe
  resampled morphs) — deferred; documented rough edge (§7).
- **"Animate from current"** one-click — deferred convenience.
- **Adaptive / configurable `N`** and **per-transition memoization** — deferred.
- **Node-correspondence editor (Feature 3)** generalizes `reconcile` with an explicit
  map; **per-node easing (Feature 4)** attaches easing to corresponded pairs. Both build
  on this feature's seam.
