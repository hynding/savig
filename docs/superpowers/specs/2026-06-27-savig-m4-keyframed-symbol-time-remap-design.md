# Keyframed Symbol Time-Remap — Design

**Date:** 2026-06-27 · **Milestone:** M4 (nested symbols, 47c follow-up — the last 47c item)
**Status:** approved design, ready for implementation plan

## Problem

A symbol instance's per-instance timing (`SceneObject.symbolTime`) is **constant** over the parent
timeline: `startOffset`, `speed`, `loop`, `pingPong`, `playCount`, `phase`. You cannot make an
instance speed up, slow down, freeze, or run in reverse *over time*. This is the remaining 47c
deliverable.

## Chosen model: a direct time-remap keyframe track (After-Effects "Time Remapping")

Keyframe the instance's **internal time directly** as a function of parent time, instead of
keyframing `startOffset` (indirect: effective rate `speed·(1−so′)`) or `speed` (needs `∫speed dt`,
stateful, hard to keep preview==export exact).

A new optional field:

```ts
// SceneObject
/** Per-instance TIME-REMAP track (47c keyframed). When present & non-empty it DRIVES the
 *  instance's internal clock: at parent time t, the internal sample time = interpolate(track, t).
 *  `time` = PARENT-local-timeline seconds; `value` = internal-clock seconds. SUPERSEDES the
 *  constant `symbolTime` remap (startOffset/speed/phase/loop/pingPong/playCount) when non-empty.
 *  Absent/empty = unchanged (constant remap, or identity if symbolTime is also absent — parity). */
symbolTimeTrack?: Keyframe[];
```

Reuses the existing `Keyframe` type (`{ time, value, easing }`) and `interpolate()` (per-keyframe
easing + endpoint clamping). The track's **slope** is the playback rate (steep = fast, shallow =
slow, **flat = freeze**, **downward = reverse**); the **value** is exactly which internal frame
shows; **integral-free** (a pure lookup) so preview==export is exact by construction.

## Architecture

### Engine seam — one decision in `flattenInstances` (`src/engine/symbol.ts`)

Replace the current `childTime` selection:

```ts
const childTime =
  o.symbolTimeTrack && o.symbolTimeTrack.length > 0
    ? Math.max(0, interpolate(o.symbolTimeTrack, localTime))     // direct remap (47c keyframed)
    : o.symbolTime
      ? remapLocalTime(localTime, o.symbolTime, symbolEffectiveDuration(asset)) // constant remap
      : localTime;                                               // identity (47a)
```

- `interpolate` **throws on an empty track**, hence the `.length > 0` guard.
- `interpolate` **clamps** parent times before the first / after the last keyframe to the curve's
  endpoint values, so the instance holds the authored start/end frame outside the authored range.
- `Math.max(0, …)` guards against a user-keyframed negative value (standard easing won't overshoot
  the keyframed value range; a deliberately-negative keyframe is clamped to internal frame 0).
- **Out-of-range internal times need no special handling:** `sampleObject` already clamps each
  internal track to its first/last keyframe, so `value > duration` holds the symbol's last frame and
  `value < 0` (post-clamp 0) shows its first.
- **Time axis:** the track's `time` is the instance's **parent-local** time — global time for a
  top-level instance, and the enclosing symbol's internal `childTime` for a nested instance (it
  composes through the existing recursion exactly as the constant remap does).
- The instance's **own transform** is still sampled at `localTime` (unchanged); only its internals
  recurse at `childTime`.

This is the **only render-path change** → preview==export parity preserved; existing projects
(no `symbolTimeTrack`) are byte-identical (parity test unchanged).

### Duration awareness (`src/engine/duration.ts`)

`instanceTimelineEnd(obj, assetsById)` — when `symbolTimeTrack` is non-empty, the instance's
parent-timeline extent = the track's **max keyframe `time`** (the authored curve's end), so
`computeProjectDuration` (shared by preview seek-range AND export frame count) covers the curve.
Absent → unchanged.

### Store actions (`src/ui/store/store.ts`) — all active-scene-routed, undoable

Mirror the established seam (`selectActiveObjects` + `replaceObjectInScene(project, selectActiveAssetId(s), …)`):

- **`toggleSymbolTimeRemap()`** — enable/disable on the selected instance. Enable seeds an identity
  curve: `D = symbolEffectiveDuration(asset)`; `D > 0 ? [{time:0,value:0,easing:'linear'},{time:D,value:D,easing:'linear'}] : [{time:0,value:0,easing:'linear'}]`. Disable clears `symbolTimeTrack`
  (back to the constant remap). No-op if no instance selected.
- **`setSymbolTimeRemap(value)`** — upsert a keyframe at the frame-snapped playhead with the given
  internal-time `value` (sorted insert; replace at an existing time). A time-remap track has **no
  static base**, so this upserts a keyframe on every edit regardless of auto-key (documented
  divergence — there is no static fallback to write).

### Keyframe-op surface — the remap track joins the shared ops (no half-routes)

A new selection state **`selectedRemapKeyframe: { objectId: string; time: number } | null`** (mirrors
`selectedProgressKeyframe`/`selectedDashKeyframe`), with `selectRemapKeyframe`. A **`remap` branch**
is added to each shared keyframe function so a visible diamond is fully manipulable (the same
discipline as the in-symbol-timeline-keyframes slice — avoid "visible but can't edit"):
`removeSelectedKeyframe`-equivalent (`removeSelectedRemapKeyframe`), `retimeSelectedKeyframe`,
`copyKeyframe`, `pasteKeyframe`, `setSelectedKeyframeEasing`. All active-scene-routed.

### UI

- **Inspector "Symbol timing" panel:** an **"Enable time remap"** checkbox (`toggleSymbolTimeRemap`).
  While enabled, an **"internal time"** `NumberField` showing `interpolate(symbolTimeTrack, playhead)`
  (read) and upserting a keyframe at the playhead on commit (`setSymbolTimeRemap`). The constant
  timing controls (start offset / speed / loop / ping-pong / play count / phase) are visually marked
  as superseded while a remap track is present (disabled or a "(overridden by time remap)" note).
- **Timeline (`src/ui/components/Timeline/Timeline.tsx`):** render the remap keyframes as a distinct
  diamond row on the instance's track, `data-testid="remap-keyframe-{id}-{time}"`, wired to
  `selectRemapKeyframe` + the shared drag-to-retime (`startKeyframeDrag` → `retimeSelectedKeyframe`),
  reusing the lock-cascade gate. The diamond styling is a new `styles.remapDiamond` variant.

## Data flow

Author: enable remap (seeds identity) → drag diamonds / edit the internal-time field at playhead →
`symbolTimeTrack` keyframes upserted on the instance (active scene). Render: `flattenInstances` →
per instance `childTime = interpolate(symbolTimeTrack, localTime)` → internals sampled at `childTime`
→ leaves → `computeFrame` (preview) and `renderSvgDocument` (export) consume identical leaves.

## Edge cases

- **Empty/single-keyframe track:** `.length > 0` guard; a single keyframe → `interpolate` returns
  that constant value everywhere (a freeze) — a valid starting state.
- **Zero-duration symbol (`D ≤ 0`):** enable seeds a single `{0→0}` keyframe; `interpolate` → 0 →
  static (consistent with the documented 47c zero-duration edge).
- **Negative authored value:** `Math.max(0, …)` → internal frame 0.
- **Reverse / freeze:** downward / flat track segments — both work via pure `sampleObject` lookup, no
  special handling.
- **Coexisting constant `symbolTime`:** harmless; the non-empty track supersedes it for both render
  and duration. Disabling the track restores the constant remap.

## Scope

**In (v1):** `symbolTimeTrack` field + engine seam; `instanceTimelineEnd` awareness;
`toggleSymbolTimeRemap` / `setSymbolTimeRemap`; the full shared keyframe-op surface for the remap
track (select/retime/copy/paste/easing/remove) + `selectedRemapKeyframe`; Inspector enable-toggle +
internal-time field; Timeline remap diamonds. Tests: engine remap (slope=rate, flat=freeze,
reverse, clamp, parity), duration, store actions, keyframe ops, Inspector RTL, Timeline e2e.

**Out (non-goals, documented):** looping / ping-pong *layered on* a remap curve (use the constant
fields for steady loops); a dedicated step/"hold" easing (flat segments already freeze); a graphical
value-vs-time curve editor beyond standard diamonds + easing; keyframing `speed`/`startOffset`
directly (superseded by the track).

## Suggested implementation slicing (for the plan)

The slice is sizeable (a new keyframe *track type* touches the Timeline + every shared keyframe op).
Recommended two `--no-ff` merges, each independently testable:

1. **Core remap** — `symbolTimeTrack` field + `flattenInstances` seam + `instanceTimelineEnd` +
   `toggleSymbolTimeRemap`/`setSymbolTimeRemap` + Inspector enable-toggle & internal-time field.
   (End-to-end usable: enable, keyframe via the field, see speed/freeze/reverse in preview & export.)
2. **Timeline manipulation** — remap diamonds row + `selectedRemapKeyframe` + the `remap` branch in
   the shared retime/copy/paste/easing/remove ops + e2e.

## Parity / invariants

No change to `computeFrame` / `renderSvgDocument` / runtime beyond the single shared
`flattenInstances` seam (which both consume) → preview==export by construction. `symbolTimeTrack`
absent on every existing project → byte-identical; the 47a parity test is unchanged.
