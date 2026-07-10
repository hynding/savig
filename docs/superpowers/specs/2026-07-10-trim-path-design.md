# Trim Path — Design

**Date:** 2026-07-10 · **Status:** Approved design, pre-implementation

## Goal

First-class, keyframable trim path (AE/Lottie-style `start`/`end`/`offset`) on vector strokes:
handwriting reveals, line-art draw-ons, progress strokes, and the closed-path "marching snake"
loop. Authoring is Inspector + Timeline (no stage handles in v1).

## Why the dash seam (approach decision)

The existing dash system is **pathLength-normalized**: `styleToSvgAttrs`
(`packages/engine/src/renderShape.ts:36`) emits `pathLength="1"`, so dash units are 0..1 of the
path length uniformly across rect/ellipse/path with zero perimeter math. Trim is expressible in
exactly those terms:

```
visible    = clamp(end − start, 0, 1)
dasharray  = "visible (1−visible)"
dashoffset = −((start + offset) mod 1)
pathLength = 1
```

- **Chosen — A: dasharray synthesis** at the existing style seam. Pure attribute math, ~15-line
  render diff, uniform across shape types, jsdom-testable, and the output (dasharray +
  animated offset) is the shape M6 CSS export wants (`stroke-dasharray`/`stroke-dashoffset` are
  CSS-animatable).
- **Rejected — B: geometric trimming** (per-frame arc-length resample and cut). "Truer" (trimmed
  fills, dash composition) but per-frame geometry churn, jsdom-hostile, breaks byte-identical
  parity and CSS export. Nothing in A blocks a later "convert trim to path" utility built on B.
- **Rejected — C: masking.** SVG cannot clip "along a path's length" without B's math anyway.

**Inherent limitation (by design):** trim affects the **stroke only** — a filled shape keeps its
full fill while its outline trims. This matches how draw-on art is authored (stroke-only paths).
The Inspector shows a hint when the object has a fill but `stroke === 'none'` (trim would be
invisible).

## Model

One optional field on `SceneObject` (`packages/engine/src/types.ts`), following the default-off
parity pattern (like `tint`, `symbolTime`):

```ts
/** Trim path (0..1 of path length). Absent = untrimmed. Stroke-only; mutually
 *  exclusive with style.strokeDasharray (dash wins at render, UI gates both ways). */
trim?: {
  start: number;   // base values, 0..1
  end: number;
  offset: number;
  startTrack?: Keyframe[];
  endTrack?: Keyframe[];
  offsetTrack?: Keyframe[];
};
```

- **Absent = byte-identical render** to today (conditional-spread; never emit `trim` with
  identity values). Identity `{start:0, end:1, offset:0}` with no tracks **normalizes to
  absent** in the store setters (mirror of `pingPong`/`tint` clearing).
- Lives on the **object**, not `VectorStyle` (asset): two instances of one asset trim
  independently — same rationale as `dashOffsetTrack` (`types.ts:118`). `VectorStyle` is
  untouched.
- Tracks reuse the scalar `Keyframe[]` + `interpolate` machinery verbatim. Values are clamped
  0..1 at the setter; `offset` wraps mod 1 at render.
- `computeProjectDuration` must include the three trim tracks (same clause style as
  `dashOffsetTrack` in `packages/engine/src/duration.ts`).

## Sampling & render (slice 1)

- **`sample.ts`** (next to the `dashOffsetTrack` block at line 74): when `obj.trim` is present,
  set `state.trim = { start, end, offset }` — each component `interpolate(track, time)` when its
  track is non-empty, else the base value. Extends `RenderState` (`sample.ts:18`) with
  `trim?: { start: number; end: number; offset: number }`.
- **One shared helper** `trimToDashAttrs(trim): { dasharray: string; dashoffset: string } | null`
  in `renderShape.ts` — the single place the formula above lives. Returns `null` for identity.
  Degenerate `visible <= 0` → `dasharray "0 1"` (stroke vanishes, fill unaffected).
- **`styleToSvgAttrs`** gains a `trim` param (alongside the existing `dashOffset` param).
  **Precedence guard:** if `style.strokeDasharray` is set, trim is ignored (dash wins) — the
  render-side half of mutual exclusivity, so a hand-edited or imported project can never produce
  ambiguous attrs.
- **Threading:** every consumer of `RenderState.strokeDashoffset` gains the trim equivalent via
  the helper: static export (`packages/services/src/export/renderDocument.ts:458` →
  `renderShapeToSvg`), the runtime frame applicator (`packages/runtime/src/frame.ts:100,163` —
  note trim must set **both** `stroke-dasharray` and `stroke-dashoffset` per frame plus
  `pathLength="1"` once, since animating start/end changes the visible width, not just the
  phase), and the editor Stage. Because this flows through the shared `flattenInstances` seam,
  symbol instances, multi-scene, exports, and raster/GIF inherit it for free.

## Editor UI (slice 2)

Everything mirrors the dashOffset implementation one-for-one; all ops route through
`selectActiveScope`/`selectActiveObjects` so trim works inside symbol editing.

- **Store** (`packages/editor-state/src/store.ts`): `setTrim(prop, value)` (autoKey-aware, like
  `setStrokeDashoffset` at :853 including the preserve-existing-easing behavior), plus the
  keyframe op family for the three tracks — add/remove/move/retime/copy-paste and
  `selectedTrimKeyframe: { objectId, prop: 'start'|'end'|'offset', time } | null` — the pattern
  `symbolTimeTrack` already copied once from dash. Setters normalize identity-and-trackless back
  to `trim: undefined`. Deleting the last keyframe of a track drops the track (mirror of
  :900–903). History/undo free via existing `commit` routing.
- **Mutual exclusivity, UI half:** the Trim section renders disabled with hint
  "Remove dash pattern to use Trim" while `style.strokeDasharray` is set; symmetrically the Dash
  section is disabled with "Remove trim to use dashes" while `obj.trim` is present.
  `setStrokeDasharray(undefined)` already clears the orphan `dashOffsetTrack` (:831); no trim
  coupling needed there since the states can't coexist.
- **Inspector VM** (`packages/ui-core/src/viewmodels/inspector.ts`): `trimStart/trimEnd/
  trimOffset` values (sampled-at-playhead like `dashOffset` at :409) + per-prop keyframe-diamond
  state. React `Inspector.tsx`: "Trim Path" section — three 0–100% sliders + numeric inputs +
  keyframe diamonds.
- **Timeline VM** (`packages/ui-core/src/viewmodels/timeline.ts`): `trim.start` / `trim.end` /
  `trim.offset` rows (pattern of `dashKeyframes` at :147), with the full keyframe-interaction
  surface (select/drag/retime/easing via `EasingEditor`).

### `drawOn()` repoint (included in slice 2)

`store.ts:869` already ships a `drawOn()` convenience that fakes draw-on via
`dasharray [1,1]` on the **shared asset style** + a 1→0 `dashOffsetTrack`. Repoint it to author
trim instead: `trim = { start: 0, end: 1, offset: 0, endTrack: [kf(t0, 0), kf(t1, 1)] }`
(t0/t1 frame-snapped now/now+1s, as today).

- Cleaner semantics: per-object (doesn't mutate the shared asset style, so other instances of
  the asset keep their dash), single-field undo, and it frees the dash surface for actual dash
  patterns.
- If the asset already has a dash pattern, `drawOn()` clears it in the same commit (today it
  overwrites the dasharray anyway), so the authored trim is never dead-on-arrival behind the
  dash-wins render guard.
- **No migration:** old projects with dash-based draw-on keep rendering identically (that
  mechanism is untouched). Existing `drawOn` unit/e2e assertions change from
  dasharray/dashOffsetTrack expectations to trim expectations.

## DSL / MCP / macro (slice 3, agent parity)

- **DSL** (`packages/core/src/dsl.ts`): `trim <object> start|end|offset <value>[ at <time>]`
  statement family mirroring existing per-property keyframe statements.
- **MCP** (`packages/mcp`): `set_trim` tool (prop, value, optional time → keyframe) + trim data
  in `describe` output (`packages/core/src/describe.ts` track summary).
- **Macro** (`packages/core/src/macros.ts`): `drawOn(objectId, duration)` — the one-call
  showcase, generating the same trim shape as the store's `drawOn()`.

## Testing

- **Engine unit** (`renderShape.test.ts`, `sample.test.ts`, `duration.test.ts`):
  identity-is-absent → byte-identical SVG string; visible-window math incl. `offset` wrap
  (`start+offset > 1`), `end < start` → `"0 1"`, full-window + offset; dash-conflict guard
  (dasharray set → trim ignored); sampling with easings and partial tracks (only `endTrack`
  present); duration includes trim tracks.
- **Store unit** (`store.test.ts` pattern): setter autoKey on/off, easing preservation,
  identity normalization to `undefined`, last-keyframe-deletion drops track, `drawOn()` new
  shape, ops inside a symbol scope (active-scene seam).
- **VM unit**: Inspector sampled values at playhead; Timeline rows/diamond states.
- **E2E** (Playwright): draw a path → keyframe `trim.end` 0→100% → scrub → assert
  `stroke-dasharray`/`stroke-dashoffset`/`pathLength` at t=0/mid/end; dash↔trim mutual-disable
  hints; `@portable` spec keeps React/Svelte byte-identical (per the restructure invariant).
- Playback-related assertions run in real Chromium e2e, not jsdom-only (lesson from the rAF
  native-binding regression: jsdom cannot catch this class of render/runtime bug).

## Slices (each independently green)

1. **Engine**: model field, `RenderState.trim`, `trimToDashAttrs`, `styleToSvgAttrs` + threading
   (services export, runtime frame), duration. Unit tests.
2. **Editor**: store setter + keyframe ops + selection, Inspector section, Timeline rows,
   mutual-exclusivity gating, `drawOn()` repoint. Unit + e2e.
3. **Agent surface**: DSL statement, MCP tool, `drawOn` macro, describe output. Unit tests.

## Deferred (explicitly out of scope)

- Dash-within-trim composition (per-frame composed dasharray; revisit after M6).
- Stage endpoint handles (gradient-handles-style overlay).
- Trim on groups (cascade to vector leaves, à la Lottie "simultaneously/individually").
- Geometric "convert trim to path" utility (approach B machinery).
- Text / imported-SVG-asset strokes (v1 = vector shapes: rect/ellipse/path incl. compound).

## Implementation notes (post-merge reality)

Recorded after the final-review pass so the design doc reflects what actually shipped, not just
what was planned:

- **Inputs are plain 0..1 `NumberField`s, not 0–100% sliders.** The Inspector's "Trim" section
  renders `trim start` / `trim end` / `trim offset` as the same numeric `<input type="number">`
  pattern used everywhere else in the panel (see `NumberField` in `Inspector.tsx`), committing on
  blur/Enter. No slider control was built.
- **Keyframe diamonds live only in the Timeline**, not in the Inspector. The Inspector shows the
  *selected* trim keyframe's easing editor + a "Delete trim keyframe" button when
  `selectedTrimKeyframe` is set, but there are no per-property diamond widgets next to the trim
  inputs themselves — keyframing happens via `autoKey` (the same convention as transform/dash
  fields): editing a trim value while `autoKey` is on upserts a keyframe at the snapped playhead;
  with `autoKey` off it edits the base scalar.
- **Stroke-none hint, as implemented:** when the vector's `style.stroke === 'none'`, the Trim
  section renders an additional `<p>Add a stroke to see Trim</p>` hint alongside the (still
  enabled) start/end/offset inputs. Authoring trim before adding a stroke is legal — the hint is
  purely informational, matching the "inherent limitation" note above; it does **not** disable
  the inputs (unlike the dash/trim mutual-exclusion hints, which do gate their sections).
- **Dash-checkbox escape hatch (final-review fix):** the headless core builders
  (`setTrim`/`setTrimKeyframe` in `packages/core`) and the MCP `set_trim` tool intentionally do
  **not** gate against an existing dash pattern — only the editor store's `setTrim` does. That
  means an agent-authored or hand-edited `.savig` can load with **both** `obj.trim` and
  `style.strokeDasharray` set, a state the UI's original mutual-exclusion gating couldn't escape
  (dashed checkbox disabled because trim was present; trim inputs hidden behind the "Remove dash
  pattern to use Trim" hint because dash was present). The dashed checkbox's disabled condition
  is therefore `trimActive && !dashed` (not just `trimActive`): if dash is *already* set, the
  checkbox stays enabled so the user can uncheck it — always a move toward a valid state — while
  the gate still blocks *creating* the conflict from a clean state (trim present, dash absent).
  The "Remove trim to use dashes" hint is shown exactly when the checkbox is disabled, i.e.
  `trimActive && !dashed`.
