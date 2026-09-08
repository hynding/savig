# Multitrack Audio — Design Spec

**Date:** 2026-09-07
**Milestone:** master spec §10 "M6 — Multitrack audio: waveforms, fades, multiple lanes, simple effects"
(the next unstarted roadmap item; INDEX.md's M6–M11 row)
**Status:** approved design, pre-implementation

## 1. Goal & scope

Grow Savig's audio surface from a single flat clip list into a multitrack mixer:

- **Lanes (tracks):** named tracks with per-track gain, mute, solo.
- **Waveforms:** clips render their audio silhouette on the Timeline.
- **Fades:** per-clip fade-in/fade-out durations (linear ramps).
- **Simple effects:** per-track stereo pan + optional low/high-pass filter.
- **Full agent parity:** DSL section, core builders, describe/validate, MCP tools.
- Carried through **editor playback**, the **runtime export bundle**, and the
  **animated-SVG round-trip JSON**. Pure-SMIL static SVG stays visual-only (existing caveat).

**Non-goals (v1):** keyframed gain envelopes (fade durations only; envelopes can layer on later),
delay/reverb, per-clip effects, audio recording, MCP binary audio upload (clips reference
already-imported assets), mid-playback *structural* changes (clip add/move applies next play).

## 2. Current state (grounding)

- `AudioClip` = `{id, assetId, startTime, inPoint, outPoint, volume}`; `Project.audioClips: AudioClip[]`
  (flat, no lanes) — `packages/engine/src/types.ts`.
- `resolveActiveClips` (`packages/engine/src/audio-timing.ts`) maps timeline time → active clips + source offsets.
- Editor playback: `apps/react/src/ui/playback/audioTransport.ts` → services `audioEngine`
  (WebAudio master clock, per-clip static gain only).
- Runtime export bundle plays audio (`createAudioStarter`, `packages/runtime/src/index.ts`).
- Timeline shows one "♪ Audio" row of untextured blocks (`Timeline.tsx` `audioRow`).
- DSL/describe/MCP: audio explicitly out of scope today (describe prints only a clip count).

## 3. Data model (engine) — additive, parity-safe

Approach chosen: **track entities + `trackId` on clips** (normalized; clips stay a flat list).
Rejected: nested `track.clips[]` (breaking `Project` change, migration burden, no user-visible gain);
per-clip lane index (nothing to hang mute/solo/track-gain/effects on).

```ts
export interface AudioFilter {
  kind: 'lowpass' | 'highpass';
  frequency: number;            // cutoff Hz; validated 10..24000
}

export interface AudioTrack {
  id: string;
  name: string;
  gain: number;                 // 0..1 linear
  muted: boolean;
  solo: boolean;
  pan?: number;                 // -1..1; absent = 0 (center)
  filter?: AudioFilter;         // absent = bypass
}
```

- `Project.audioTracks?: AudioTrack[]` — absent ⇒ legacy single implicit lane (parity).
- `AudioClip` gains `trackId?: string`, `fadeIn?: number`, `fadeOut?: number` (seconds; clamped to
  clip length; absent = no fade — parity). Optional fields follow the repo's conditional-spread
  pattern (absent stays absent; 0/false clears).
- Clip with no `trackId` (or a dangling one) resolves to the **default track**: gain 1, unmuted,
  not solo, no pan/filter. Old projects play byte-identically.
- **Solo rule:** if any track is solo, only solo tracks are audible; mute always wins on its own track.

### 3.1 Formula owner: `packages/engine/src/audio-mix.ts`

One pure module owns all mix math (mirrors the `trim.ts` one-owner pattern):

- `resolveTrackState(tracks: AudioTrack[] | undefined, trackId: string | undefined)`
  → `{ audible: boolean, gain: number, pan: number, filter?: AudioFilter }`
  — solo/mute/default-track semantics live here and nowhere else.
- `clipFadeGainAt(clip: AudioClip, timelineTime: number)` → 0..1 linear fade multiplier
  (1 inside the plateau; ramps at the ends; handles fadeIn+fadeOut overlapping on short clips by
  clamping each to the clip length and taking the min of the two ramps).
- Effective loudness = `clip.volume × clipFadeGainAt × track.gain × audible` — computed nowhere else.

`resolveActiveClips` is untouched.

## 4. Playback graph (services audioEngine · editor transport · runtime)

Per-track WebAudio chain, built at play-start:

```
clip BufferSource → clip GainNode (volume + fade ramps)
                        ↓ (routed by trackId via resolveTrackState)
  track GainNode (gain × mute/solo gate) → StereoPanner? → BiquadFilter? → destination
```

- **Fades:** scheduled on the clip GainNode with `setValueAtTime` + `linearRampToValueAtTime` at
  source-start. Starting mid-fade seeds the instantaneous value from `clipFadeGainAt`, then
  schedules the remaining ramp — scrub-then-play stays correct.
- **Live controls:** the engine retains per-track node refs and exposes `updateTracks(tracks)`;
  gain/mute/solo/pan/filter changes during playback are plain AudioParam sets (no restart).
  Adding/removing a filter node mid-play is structural → applies next play (param-only when present).
- **Runtime bundle:** `createAudioStarter` builds the same chain from the same `audio-mix.ts`
  helpers. ⚠ Any `packages/runtime/src` change reruns `build:runtime`
  (runtimeSource.generated.ts staleness — banked lesson).
- Environments without `StereoPannerNode` (older Safari): pan degrades to bypass (feature-detect).

## 5. Waveforms + Timeline UI

### 5.1 Waveform pipeline

- Pure `computePeaks(channelData: Float32Array, bins: number): Float32Array` — max-abs peak per bin
  (mono-mixed). Framework-agnostic (ui-core or services); unit-tested with synthetic buffers.
- Decode reuses `audioEngine.decode`; peaks cached in a module-level Map keyed `assetId:bins`;
  computed once per asset, async off the render path (flat placeholder block until ready).
- Rendered as one mirrored-silhouette `<path>` inside the clip block, windowed by the clip's
  `inPoint..outPoint` so trims show the correct slice.

### 5.2 Timeline

The single `audioRow` becomes a track list:

- One lane per `AudioTrack`, plus an always-visible default lane while untracked clips exist.
- Track header: inline-renamable name (layers pattern), **M**/**S** toggles, gain slider, pan slider.
  Filter controls live in the Inspector when a track is selected (headers stay compact).
- Clip blocks: waveform; drag-to-move (snapping consistent with existing snap prefs);
  drag across lanes reassigns `trackId`; edge-drag trims `inPoint`/`outPoint`;
  **fade handles** — corner triangles dragged horizontally set `fadeIn`/`fadeOut`, rendered as
  translucent ramps over the waveform.

### 5.3 Store actions (editor-state, per-domain slice pattern; all undoable via `commit`)

`addAudioTrack` · `renameAudioTrack` · `setAudioTrackProps` (gain/mute/solo/pan/filter) ·
`removeAudioTrack` (clips fall back to default lane) · `setAudioClipTiming` (start/in/out) ·
`setAudioClipTrack` · `setAudioClipFades` · `removeAudioClip`.

## 6. Export & round-trip

- **Runtime bundle:** track graph + fades as §4.
- **Animated-SVG round-trip:** embedded project JSON picks up the new optional fields for free;
  the import validator adds schema checks — `audioTracks[]` shape, `trackId` string, fades ≥ 0,
  pan −1..1, filter kind ∈ {lowpass, highpass}, frequency 10..24000; numbers clamped, unknown
  kinds rejected (same hardening style as the existing audio-payload validation).
- **Autosave/persistence:** no change; project JSON is opaque to it.
- **Pure-SMIL static SVG:** unchanged, visual-only.

## 7. DSL / MCP parity

- **Core builders:** `addAudioTrack`, `addAudioClip` (to track), `setClipFades`, `setTrackEffect`
  mirroring store semantics. `describe` gains a per-track line (name, clip count, mute/solo/gain/
  pan/filter). `validate` checks dangling `trackId`, fades > clip length, pan/frequency ranges,
  clip in/out sanity.
- **DSL (`ShortDoc`):** optional `audio:` section — tracks with
  `{name, gain, pan, filter, clips: [{asset, at, in, out, volume, fadeIn, fadeOut}]}`.
  Nested clips are *syntax sugar*; it compiles to the flat model. `get_dsl` emits; `load_dsl` builds;
  `load_dsl(get_dsl(p))` round-trips.
- **MCP tools:** `add_audio_track` · `set_audio_track` (props incl. effects) · `add_audio_clip` ·
  `set_audio_clip` (timing/fades/track) · `remove_audio_track` · `remove_audio_clip` — each returns
  `describe` per the tool contract. No binary upload in v1: clips reference already-imported assets
  (validate reports a clear error otherwise).

## 8. Testing

- **Unit (TDD throughout):**
  - `audio-mix.ts`: solo/mute matrix, default-track fallback, dangling trackId, fade ramp values
    incl. mid-fade seek, short-clip fade overlap clamping.
  - `computePeaks`: synthetic sine/silence/impulse buffers; bin-count edges.
  - Store actions: undo, remove-track clip fallback, clamping.
  - DSL round-trip; validator accept/reject tables; import-validator hardening cases.
- **E2e (real Chromium — the play path is the class jsdom can't catch):** add track → lanes render →
  M/S/gain interactions update state → drag clip across lanes → fade handles set values →
  Play doesn't crash and the playhead advances. (Audibility isn't CI-assertable; graph-construction
  crashes are.)
- **Parity guards:** legacy project (no `audioTracks`, no fades) drives identical engine calls;
  export/import round-trip of a legacy project is byte-identical.

## 9. Slice plan (implementation ordering)

1. **Engine model + audio-mix** — types, formula owner, exhaustive unit tests.
2. **Playback graph** — services audioEngine chain + fades + `updateTracks`; editor transport wiring.
3. **Timeline lanes + clip editing** — track list UI, store slice, drag/trim/reassign.
4. **Waveforms** — computePeaks + cache + clip rendering.
5. **Fade handles** — UI + ramps rendering (playback ramps already in slice 2).
6. **Runtime export + round-trip validation** — runtime graph, import validator, build:runtime.
7. **DSL/MCP parity** — builders, describe/validate, DSL section, MCP tools.
8. **E2e + polish pass** — the §8 e2e suite; review loop; merge.

Each slice: TDD, `feature-dev:code-reviewer` pass (loop until no Critical/Important), then merge —
the established per-slice cadence. Security review gate before the final merge (new parse surface:
import validator + DSL audio section).
