# Savig — M2 Slice 3: Path-Shape Morphing (Design)

## Summary

The third slice of **Milestone 2 — Vector drawing tools**. It makes a path's
**shape animate over time** — node anchors and bezier handles interpolate between
**shape keyframes** so a drawn path can morph (e.g. a wave that ripples, a blob
that breathes). It builds directly on Slice 2's `PathData` model and the proven
M1 keyframe/sample/interpolate architecture.

The defining constraint, chosen during brainstorming: each shape keyframe holds a
**full `PathData` snapshot**, and adjacent keyframes **may differ in node count**.
The engine reconciles differing counts by **index-matched padding** at sample
time (extra trailing nodes collapse onto the last shared anchor, so nodes grow out
of / retract into a point). True arc-length resampling and cross-shape
correspondence are explicitly **deferred** (see §11).

Two architectural consequences worth stating up front:

1. **Morphing is per-instance animation, so the shape track lives on the
   `SceneObject`** (`shapeTrack?: ShapeKeyframe[]`), exactly where the scalar
   transform/geometry tracks already live. The asset's `path` remains the **static
   base** (unchanged, backward-compatible); it is the rendered shape when no
   `shapeTrack` exists and is ignored once one does (mirroring how a scalar `base`
   is ignored once its track has keyframes).
2. **The runtime regains per-frame path work.** Slice 2 boasted "no per-frame path
   update" because `d` was static. A morphed path's `d` must be recomputed each
   frame from the interpolated nodes — so `computeFrame`/`applyFrameToNodes` gain a
   path branch and the committed runtime bundle is regenerated. Non-morphed paths
   keep Slice 2's zero-per-frame cost.

The parity oracle is preserved: the editor Stage and the export runtime both
interpolate via the **same** pure `samplePath` and serialize via the **same**
`pathToD`, so preview cannot drift from export.

### Stack & standards (unchanged from M1/Slice 1/Slice 2)

pnpm · Vite · React 18 + TS (strict) · Zustand (UI state) · Vitest + RTL ·
Playwright (e2e) · CSS Modules + design tokens. Client-only, no backend. TDD
throughout. The engine layer stays **pure TypeScript with zero React/DOM
dependencies** so the render core lifts verbatim into the export runtime.

---

## Scope

### In scope (this slice)

- **Animated path shape.** Node anchors and bezier handles interpolate between
  shape keyframes; the rendered `d` updates per frame in both preview and export.
- **Per-keyframe `PathData` snapshots** with **differing node counts allowed**,
  reconciled by **index-matched padding** at sample time.
- **Authoring (both mechanisms):**
  - **Auto-key on node edit** — with auto-key on, editing a node (move / add /
    delete / convert / break-join) at the current playhead time creates or updates
    a shape keyframe at that time, seeded from the currently-sampled shape.
  - **Explicit shape-keyframe controls** — Inspector **Add shape keyframe** /
    **Remove shape keyframe** buttons, and selectable/deletable shape-keyframe
    **diamonds in the timeline**.
- **Per-shape-keyframe easing in the data** (reuses the existing `Easing` type;
  default `linear`). The easing-*editing* UI is deferred — consistent with the app,
  where scalar keyframes also carry `easing` but have no editor yet (§11).
- **Per-frame pivot recompute** so rotate/scale stay centered as the shape morphs.
- **Preview == export parity** for morphed paths (`samplePath` → `pathToD`).
- Backward-compatible **persistence migration** (v3 → v4; old projects load
  unchanged).

### Out of scope (later M2 slices) — recorded so they are tracked

Arc-length / true-topology **resampling** (cross-shape morph, e.g. circle → star) ·
per-**node** easing · an explicit **node-correspondence** editor · asset-to-asset
morph / morph presets · curve-tight `pathBounds` (also deferred from Slice 2) ·
per-frame path **buffer reuse** (perf) · an "animate from current" one-click that
seeds a keyframe at t=0 from the base · freehand brush · more primitives · gradients ·
fill/stroke **color** animation · `fill-rule` · boolean ops · multi-node marquee /
copy-paste · node/grid snapping · grouping/layers.

> The **next** natural slice after this one is arc-length resampling + cross-shape
> morph, which generalizes the index-pad reconciliation defined here.

---

## 1. Architecture (fits the existing three layers)

No new layers. The work slots into the M1/Slice-1/Slice-2 structure:

```
UI layer        Inspector (add/remove shape keyframe + per-keyframe easing) ·
                Timeline (shape-keyframe lane) · Stage node-edit routing ·
                store (shapeTrack actions + node-edit router) ·
                separate selectedShapeKeyframe selection
Engine layer    ShapeKeyframe type · shapeTrack on SceneObject · samplePath +
                node-count normalization (pure) · RenderState.path ·
                per-frame pivot via sampled bounds
Services layer  computeFrame/applyFrameToNodes pathD branch · runtime bundle regen ·
                export sampled-at-0 initial render · migration v3->v4
```

**Key principle preserved:** `samplePath` and `pathToD` are pure and
dependency-free, called by **both** the Stage and the export runtime, so the
editor and the exported bundle emit byte-identical morph frames — preview cannot
drift from export.

---

## 2. Data model

```ts
interface ShapeKeyframe {
  /** Seconds from the start of the timeline (matches Keyframe.time). */
  time: number;
  /** Full snapshot. Adjacent keyframes MAY differ in node count. */
  path: PathData;
  easing: Easing;          // reuse existing Easing (per-shape-keyframe, not per-node)
}

interface SceneObject {
  // ...existing: tracks, shapeBase, base, anchorMode, etc.
  /** Present iff this path object is being morphed. Static base = asset.path. */
  shapeTrack?: ShapeKeyframe[];
}
```

`PathData` / `PathNode` / `PathPoint` are unchanged from Slice 2. `VectorAsset.path`
is unchanged — it remains the **static base shape**.

### Model decisions

- **Shape track on the object, base on the asset.** Morphing is per-instance
  animation, so it belongs with the scalar tracks on `SceneObject`. `asset.path`
  stays the base: rendered as-is when there is **no** `shapeTrack` (Slice 2
  behavior, byte-identical), and **ignored** once a `shapeTrack` exists (exactly
  like a scalar `base` once its track has keyframes). This keeps Slice 2's
  shared-symbol/instancing semantics intact for the static case while letting each
  instance morph independently.
- **Full snapshot per keyframe; counts may differ.** A shape keyframe carries an
  entire `PathData`, so adding/deleting a node on one keyframe does **not** force
  the others. Reconciliation is a render-time concern (§3.2), not an authoring
  constraint.
- **`closed` is hold-from.** When two bracketing keyframes disagree on `closed`,
  the interpolated path uses the **"from" (earlier) keyframe's** `closed` — no
  flip at the segment midpoint, so there is no visual pop.
- **Per-shape-keyframe easing, not per-node.** One `easing` governs the whole
  shape transition (like a scalar keyframe), stored in the data with default
  `linear`. Per-node easing is deferred; the easing-editing **UI** is also deferred
  to stay consistent with scalar keyframes (which have no editor yet).
- **`shapeTrack` is optional** → the persistence migration is a no-op version bump.

---

## 3. Engine & parity

### 3.1 `samplePath` (the shared, parity-critical morph oracle)

```ts
samplePath(track: ShapeKeyframe[], time: number): PathData
```

Pure, dependency-free, in `engine/path.ts`. Mirrors `interpolate`'s structure:

- Empty track is a programming error (callers guard); a **single** keyframe returns
  that snapshot (static). `time` ≤ first → first snapshot; `time` ≥ last → last
  snapshot (clamp/hold, like `interpolate`).
- Otherwise bracket `time` between keyframes `a`,`b`; `progress =
  applyEasing(a.easing, rawProgress)` (reuse the existing easing solver).
- **Node-count normalization** (`a.path.nodes` vs `b.path.nodes`):
  - Match nodes by **index**.
  - If counts differ, **pad the shorter** by appending degenerate nodes whose
    `anchor` equals the **last shared anchor** of the shorter path and whose
    handles are absent — so extra nodes interpolate as growing out of / retracting
    into that point rather than snapping.
  - Interpolate each matched `PathNode` componentwise: `anchor.x/y`, and `in`/`out`
    treating an **absent handle as a zero offset**; if the interpolated handle is
    (still) zero on **both** sides of a node it is emitted as **absent** (corner /
    `L`), otherwise emitted (curve / `C`). This lets a corner grow a handle
    smoothly while preserving `pathToD`'s straight-segment shortcut.
  - `closed` = `a.path.closed` (hold-from, §2).
- Returns a fresh `PathData`; never mutates inputs.

> **Index-pad limitation (documented, accepted):** index matching assumes the
> count difference is at the **trailing** end (append/delete at the tail). A node
> **inserted in the middle** of one keyframe shifts the index alignment, so that
> keyframe's later nodes morph against the wrong partners ("rolling" morph). This
> is the known cost of index-pad vs. a correspondence map; the **node-correspondence
> editor** that fixes it is deferred (§11). Authoring guidance: add/remove nodes at
> the tail, or keep counts equal, for predictable morphs.

### 3.2 `pathBounds` & per-frame pivot (must-fix vs Slice 2)

A morphed path's bbox changes every frame, so the fractional-anchor pivot must be
recomputed from the **sampled** path, not the static `asset.path`. `resolveAnchor`'s
`path` branch already accepts a `pathBox`; callers (`computeFrame`,
`renderDocument`, Stage) now pass `pathBounds(state.path ?? asset.path)`. `pathBounds`
itself is unchanged (anchor-extent; curve-tight bounds remain deferred).

### 3.3 Sampling → `RenderState.path`

```ts
interface RenderState extends Transform2D {
  objectId: string;
  geometry?: ResolvedGeometry;
  path?: PathData;          // present only when the object has a shapeTrack
}
```

`sampleObject` resolves `shapeTrack` **without needing the asset** (the track lives
on the object): when `obj.shapeTrack?.length` it sets `state.path =
samplePath(obj.shapeTrack, time)`. No track → no `state.path` → the renderer falls
back to `asset.path` (Slice 2 behavior).

### 3.4 `computeProjectDuration` must include `shapeTrack` (must-fix)

Auto-duration currently scans only `obj.tracks` and `audioClips`
(`duration.ts:10`). A morph whose last shape keyframe sits past the scalar
keyframes would be **truncated**. `computeProjectDuration` folds in
`obj.shapeTrack` keyframe times (max over scalar tracks **and** the shape track).

---

## 4. Rendering & export

### Stage (preview)

The path-render branch serializes `pathToD(state.path ?? asset.path)` (sampled when
morphing, static otherwise). `d` is numeric-derived and React-escaped → XSS-safe,
as in Slice 2.

### Runtime / `computeFrame` (the per-frame path branch)

- `FrameItem` gains `pathD?: string`.
- `computeFrame`: for objects with `state.path`, set `item.pathD =
  pathToD(state.path)`; pivot via `pathBounds(state.path ?? asset.path)`.
- `applyFrameToNodes`: when `item.pathD` is present, set `d` on the inner shape
  (`node.firstElementChild`, the same child it already updates for geometry).
- The committed runtime bundle (`runtimeSource.generated.ts`) is **regenerated**
  via the existing esbuild script.
- Non-morphed paths emit **no** `pathD` → zero per-frame path cost (Slice 2 parity).

### Export (HTML5 bundle)

`renderDocument` samples at `t=0` and emits the inline `<g><path d="…"/></g>` with
the **sampled-at-0** path (`renderShapeToSvg(asset.shapeType, …, state.path ??
asset.path)`), so the initial DOM matches frame 0 of a morph. The runtime then
updates `d` per frame via `applyFrameToNodes`.

### Parity

- A test asserts Stage-sampled `d` === exported initial `d` === runtime per-frame
  `d` at several `t`, all routed through `samplePath` → `pathToD`.
- Transform/opacity parity reuses the existing runtime↔engine harness.

---

## 5. UI layer

### 5.1 Node-edit routing (store)

Today every node edit writes `asset.path` unconditionally. Morphing routes all
node-edit commits (`setPathData`, `deleteSelectedNode`, `toggleSelectedNodeSmooth`,
`joinSelectedNode`, and the Stage insert/drag commits) through one rule keyed on
**whether a `shapeTrack` already exists** (NOT on `autoKey`):

```
setPathData(nextPath):
  if obj.shapeTrack?.length:                 // morphing in progress
    upsert a ShapeKeyframe at snapToFrame(t) with nextPath; commit on the OBJECT
  else:                                       // Slice 2 behavior, unchanged
    write nextPath to asset.path (the static base)
```

**Rationale for the refinement (vs. an `autoKey`-gated rule):** `autoKey` defaults
*on*, so gating on it would convert every Slice 2 path edit into a single-keyframe
shape track (timeline noise + breaks Slice 2 behavior/tests). Gating on track
existence keeps static path editing identical to Slice 2 and makes morphing an
explicit, discoverable opt-in via **Add shape keyframe**; once a track exists, node
edits auto-key at the playhead (the "Both" authoring model). The reads that feed
editing use the **sampled** shape at the playhead (`selectEditablePath`), so a node
edit between keyframes seeds a new keyframe from the interpolated shape. Once a
`shapeTrack` exists the base (`asset.path`) is frozen/ignored at render.

New store actions:

- `addShapeKeyframe()` — snapshot the currently-sampled shape as a keyframe at the
  snapped playhead (creates `shapeTrack` from `asset.path` if none). One undo step.
- `removeShapeKeyframe()` — remove the shape keyframe at the playhead (or the
  selected one); removing the **last** keyframe writes its snapshot **back into the
  base** (`asset.path`) and then drops `shapeTrack`, so the visible shape does not
  jump (the base may otherwise be a stale pre-morph shape). One undo step.

`upsertShapeKeyframe` / `removeShapeKeyframeAt` are pure helpers (engine
`keyframes.ts`-adjacent), unit-tested like `upsertKeyframe`/`removeKeyframeAt`.

### 5.2 Selection — separate `selectedShapeKeyframe`

Rather than reshaping `KeyframeRef` (which ripples through Timeline + store + their
tests), shape-keyframe selection gets its **own** transient field:

```ts
interface ShapeKeyframeRef { objectId: string; time: number }
// store: selectedShapeKeyframe: ShapeKeyframeRef | null;  selectShapeKeyframe(ref)
```

`selectKeyframe` and `selectShapeKeyframe` clear each other (and `selectObject`
clears both) so at most one keyframe is highlighted. Context-aware `Delete`
priority: selected **node** (node tool) → selected **shape keyframe** → selected
scalar **keyframe**. Removing a selected shape keyframe calls `removeShapeKeyframe`.

### 5.3 Timeline

The per-object lane gains **shape-keyframe diamonds** (distinct testid, e.g.
`shape-keyframe-{objId}-{time}`) rendered from `obj.shapeTrack`, selectable exactly
like scalar diamonds (set `selectedKeyframe` with `kind:'shape'`). Sub-rows for
per-property timelines remain the deferred M1 item; the shape track is a single
lane alongside the existing flattened scalar diamonds.

### 5.4 Inspector

For a selected path object, in addition to Slice 2's node count + style + node-edit
buttons:

- **Add shape keyframe** / **Remove shape keyframe** buttons.
- A read-out of shape-keyframe state (e.g. count, or "morphing" when ≥2).
- New shape keyframes default to `easing: 'linear'`; the per-keyframe easing
  **editor** is deferred (no keyframe in the app has an easing editor yet, §11).

### 5.5 Keyboard

`Delete`/`Backspace` stays context-aware (Slice 2): node (node tool + node
selected) → delete node; else if a shape keyframe is selected → remove it; else →
existing `removeSelectedKeyframe` for scalar keyframes.

---

## 6. Persistence & migration

- Bump `meta.version` **3 → 4** (`createProject`, `CURRENT_VERSION = 4`); add a
  `3:` **no-op** forward upgrader (old files have no `shapeTrack`; it is optional).
- `shapeTrack` is plain-object data → rides along in the `.savig` zip and IndexedDB
  autosave with no format change, and participates normally in undo/redo (it lives
  on the undoable `SceneObject`).

---

## 7. Error handling & edge cases

- **Empty / single-keyframe `shapeTrack`**: renders the lone snapshot statically;
  `samplePath` never throws for a non-empty track.
- **Differing node counts**: index-pad (§3.1); extra nodes grow from / retract into
  the last shared anchor.
- **`closed` mismatch**: hold-from (no midpoint pop).
- **Corner ↔ smooth across keyframes**: absent handle treated as zero offset;
  handle grows/shrinks smoothly; stays a corner (`L`) only when zero on both sides.
- **Cross-keyframe node-selection**: `selectedNodeIndex` may not exist in some
  keyframe. Editing always seeds the target keyframe from the **currently-sampled**
  shape (well-defined for the bracketing topology), so the selected index stays
  valid within a single edit. The cross-count selection corner is documented; a
  node-correspondence editor is deferred.
- **Per-frame pivot**: recomputed from sampled bounds so rotate/scale stay centered
  during a morph (§3.2).
- **Base edited while morphing**: allowed with auto-key off but not visible while a
  `shapeTrack` exists (documented).
- **Rotated / zoomed / panned path**: pointer math unchanged from Slice 2
  (object-local CTM); morph is orthogonal to the object transform.

---

## 8. Performance

Morphed paths reintroduce per-frame work: `samplePath` allocates a fresh `PathData`
and `pathToD` a fresh string each frame. This is bounded (anchor/handle arithmetic +
one string build) and only incurred for objects that actually have a `shapeTrack`;
static paths keep Slice 2's zero per-frame cost. Per-frame **buffer reuse** (avoid
re-allocating node arrays / string parts) is a deferred optimization that joins
M1's tracked perf items (the O(n) `interpolate` segment scan, per-call easing-solver
allocation). Pen/node interactions remain imperative during drag with a single
commit on release.

---

## 9. Testing strategy (TDD)

Engine (pure, no DOM):
- `samplePath`: clamp before/after; single-keyframe static; equal-count linear &
  eased interpolation; **count-mismatch padding** (grow + retract); `closed`
  hold-from; corner→smooth handle growth; immutability of inputs.
- `upsertShapeKeyframe` / `removeShapeKeyframeAt`: insert ordered, replace same-time,
  remove, remove-last semantics.
- per-frame pivot: `resolveAnchor` uses sampled bounds (off-center morph stays
  centered).
- `computeProjectDuration` extends to the last shape keyframe (a morph past the
  scalar keyframes is not truncated).

Runtime ↔ engine / export:
- `computeFrame` emits `pathD` for morphed paths, none for static paths.
- `applyFrameToNodes` sets `d` on the inner `<path>`.
- Stage-sampled `d` === exported initial `d` === runtime per-frame `d` at several
  `t`.

UI (RTL):
- With NO shape track, a node edit writes the base `asset.path` (Slice 2 behavior).
- With a shape track present, a node edit upserts a keyframe at the playhead (one
  undo step) and leaves the base untouched.
- `addShapeKeyframe` / `removeShapeKeyframe` (incl. remove-last reverts to base);
  new keyframes default to `easing: 'linear'`.
- Timeline shape diamonds render, select, and delete; context-aware `Delete`
  (node → shape keyframe → scalar keyframe).
- Inspector add/remove buttons apply.

E2E (Playwright, real Chromium):
- Draw a path, key its **shape** at t=0 and t=1 (different node positions), export
  the bundle, and assert the exported `d` **animates** and matches the in-editor
  preview at sampled times (extends the Slice 2 export-parity e2e).

Migration:
- A v3 project (paths, no `shapeTrack`) loads unchanged after the bump to v4.

---

## 10. Plan decomposition (for writing-plans)

Two plans, mirroring Slices 1–2, each its own writing-plans → execution cycle:

- **Plan A — Engine & pipeline (no UI):** `ShapeKeyframe` type + `shapeTrack` on
  `SceneObject`; `samplePath` + node-count normalization; `upsertShapeKeyframe` /
  `removeShapeKeyframeAt`; `RenderState.path` from `sampleObject`;
  `computeFrame`/`applyFrameToNodes` `pathD` branch; per-frame pivot via sampled
  bounds; `computeProjectDuration` includes `shapeTrack`; export sampled-at-0
  initial render; runtime bundle regeneration; parity tests; v3 → v4 migration;
  engine barrel updates.
- **Plan B — UI:** `selectEditablePath` selector; track-existence node-edit routing
  in `setPathData`; `addShapeKeyframe` / `removeShapeKeyframe` store actions;
  `selectedShapeKeyframe` selection + `removeShapeKeyframe`; timeline shape-keyframe
  lane; Inspector add/remove shape-keyframe buttons (new keyframes default
  `easing:'linear'`, no easing editor); context-aware `Delete` extension; Stage node
  overlay/render use the sampled editable path; Playwright morph-parity e2e.

---

## 11. Open questions / deferred decisions

- **Arc-length / true-topology resampling** (cross-shape morph, e.g. circle →
  star) — the next slice; generalizes the index-pad reconciliation here.
- **Per-node easing** and an **explicit node-correspondence editor** — deferred;
  one easing per shape keyframe this slice.
- **Keyframe easing-editing UI** (for shape *and* scalar keyframes) — deferred; the
  app has no easing editor yet, so shape keyframes default to `linear` and a unified
  easing editor is a separate piece of work.
- **Asset-to-asset morph / morph presets** — deferred.
- **Curve-tight `pathBounds`** — still deferred (anchor extents suffice for the
  pivot/selection).
- **Per-frame path buffer reuse** — deferred perf item (joins M1's tracked items).
- **"Animate from current" one-click** that seeds a keyframe at t=0 from the base —
  deferred convenience; the explicit **Add shape keyframe** button covers the
  workflow this slice.
