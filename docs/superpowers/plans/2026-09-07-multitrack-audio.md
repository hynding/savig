# Multitrack Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multitrack audio for Savig — named lanes with gain/mute/solo, per-clip fade-in/out, per-track pan + low/high-pass filter, waveforms on the Timeline, carried through editor playback, the runtime export bundle, and the SVG round-trip, with full DSL/MCP parity.

**Architecture:** Additive, parity-safe model growth: `Project.audioTracks?: AudioTrack[]` + optional `trackId`/`fadeIn`/`fadeOut` on the existing flat `AudioClip[]` (absent field ⇒ byte-identical legacy behavior). All mix math lives in ONE pure engine module (`audio-mix.ts`, the `trim.ts` one-owner pattern); the services audioEngine, the editor transport, and the export runtime are thin consumers mapping its outputs onto WebAudio params. Also fixes a pre-existing defect: `addAudioClip` writes `outPoint: 0` and nothing ever updates it, so UI-placed clips are silently inert.

**Tech Stack:** TypeScript strict, pnpm workspace, Vitest (unit), Playwright (e2e), Zustand slice pattern, WebAudio (`OfflineAudioContext` for gesture-free decode), React 18 (+ ui-core view-model seam).

**Spec:** `docs/superpowers/specs/2026-09-07-multitrack-audio-design.md`

## Global Constraints

- Work on branch `feature/multitrack-audio` (from `main`).
- All new optional model fields follow the conditional-spread pattern: absent stays absent; explicit 0/false/null clears. Legacy projects (no `audioTracks`, no fades) must behave byte-identically.
- Track `gain` 0..1 · clip `volume` 0..1 · `pan` −1..1 · filter `kind` ∈ {lowpass, highpass} · filter `frequency` 10..24000 Hz · fades ≥ 0, clamped to clip length · track `name` length-capped at 120 chars on import.
- **Solo rule:** if ANY track is solo, only solo tracks are audible; mute always wins on its own track.
- Default track (no `trackId`/dangling id): gain 1, unmuted, not solo, no pan/filter.
- Run unit tests from repo root: `node_modules/.bin/vitest run <path>` (targeted) or `pnpm test` (all). E2e: `pnpm e2e -- <spec>` (kill stale vite first for definitive runs). `node_modules/.bin/tsc -b --noEmit 2>/dev/null || pnpm typecheck` must stay clean. Subagents MUST use `node_modules/.bin/{vitest,tsc,eslint,playwright}` directly (`pnpm <script>` breaks for them).
- ⚠ ANY change under `packages/runtime/src` must rerun `pnpm build:runtime` and commit `runtimeSource.generated.ts`.
- `docs/superpowers/INDEX.md` update + security review (`new parse surface: import sanitizer + DSL audio section`) happen in Task 8 before the final `--no-ff` merge.

## File Structure

| File | Responsibility |
|---|---|
| `packages/engine/src/types.ts` (modify) | `AudioFilter`, `AudioTrack`, `AudioAsset.duration?`, `AudioClip.trackId?/fadeIn?/fadeOut?`, `Project.audioTracks?` |
| `packages/engine/src/audio-mix.ts` (create) | ONE owner of mix math: `resolveTrackState`, `clipFadeGainAt`, `fadeEnvelopePoints` |
| `packages/services/src/audio/audioEngine.ts` (modify) | Track chains (gain→panner?→filter?), fade AudioParam scheduling, `updateTracks` |
| `packages/services/src/audio/waveform.ts` (create) | Pure `computePeaks` |
| `packages/services/src/persistence/migrate.ts` + `sanitizeAudio.ts` (create) | v6 migration stamp + audio-field sanitizer (single seam for .savig AND SVG round-trip) |
| `packages/editor-state/src/slices/audioSlice.ts` (create) | All audio store actions (moves `addAudioClip` out of `store.ts`, fixed) |
| `packages/ui-core/src/viewmodels/timeline.ts` (modify) | `audioTracks` VM + audio intents |
| `apps/react/src/ui/audio/decode.ts` (create) | Gesture-free `OfflineAudioContext` decode + peaks cache |
| `apps/react/src/ui/components/Timeline/AudioLanes.tsx` (create) | Lane list, headers, clip drag/trim, waveforms, fade handles (Timeline.tsx delegates) |
| `apps/react/src/ui/components/AssetPanel/AssetPanel.tsx` (modify) | Stamp `AudioAsset.duration` at import |
| `packages/runtime/src/index.ts` (modify) | Track-aware export playback |
| `packages/core/src/{build,describe,validate,dsl}.ts` (modify) | Builders, per-track describe, audio validation, DSL `audio:` section |
| `packages/mcp/src/tools.ts` (modify) | 6 audio tools |
| `e2e/multitrack-audio.spec.ts` (create) | Comprehensive e2e + WAV fixture |

---

### Task 1: Engine model + audio-mix formula owner

**Files:**
- Modify: `packages/engine/src/types.ts` (near `AudioAsset` ~L209 and `AudioClip` ~L417, `Project` ~L479)
- Create: `packages/engine/src/audio-mix.ts`, `packages/engine/src/audio-mix.test.ts`
- Modify: `packages/engine/src/index.ts` (export the new module + types)

**Interfaces:**
- Consumes: existing `AudioClip`, `Keyframe`-free — pure math only.
- Produces (later tasks rely on these EXACT names):
  - `interface AudioFilter { kind: 'lowpass' | 'highpass'; frequency: number }`
  - `interface AudioTrack { id: string; name: string; gain: number; muted: boolean; solo: boolean; pan?: number; filter?: AudioFilter }`
  - `AudioAsset` += `duration?: number` · `AudioClip` += `trackId?: string; fadeIn?: number; fadeOut?: number` · `Project` += `audioTracks?: AudioTrack[]`
  - `interface TrackState { audible: boolean; gain: number; pan: number; filter?: AudioFilter }`
  - `resolveTrackState(tracks: AudioTrack[] | undefined, trackId: string | undefined): TrackState`
  - `clipFadeGainAt(clip: AudioClip, timelineTime: number): number` (0..1; 0 outside the clip window)
  - `fadeEnvelopePoints(clip: AudioClip, fromTime: number): Array<{ t: number; gain: number }>` — piecewise-linear breakpoints (timeline seconds, gain 0..1 fade multiplier only — volume NOT folded in) from `max(clip.startTime, fromTime)` to clip end; consumers map them onto `setValueAtTime`/`linearRampToValueAtTime`. Returns `[]` when the clip ends at/before `fromTime`.

- [ ] **Step 1: Write the failing test** — `packages/engine/src/audio-mix.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clipFadeGainAt, fadeEnvelopePoints, resolveTrackState } from './audio-mix';
import type { AudioClip, AudioTrack } from './types';

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: 'c1', assetId: 'a1', startTime: 2, inPoint: 0, outPoint: 4, volume: 0.8, ...over,
});
const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({
  id: 't1', name: 'T', gain: 0.5, muted: false, solo: false, ...over,
});

describe('resolveTrackState', () => {
  it('default track when tracks absent or trackId dangling/undefined', () => {
    for (const st of [
      resolveTrackState(undefined, undefined),
      resolveTrackState(undefined, 't-missing'),
      resolveTrackState([track()], 't-missing'),
      resolveTrackState([track()], undefined),
    ]) expect(st).toEqual({ audible: true, gain: 1, pan: 0 });
  });
  it('resolves gain/pan/filter from the track', () => {
    const t = track({ pan: -0.5, filter: { kind: 'lowpass', frequency: 800 } });
    expect(resolveTrackState([t], 't1')).toEqual({ audible: true, gain: 0.5, pan: -0.5, filter: { kind: 'lowpass', frequency: 800 } });
  });
  it('mute silences its own track', () => {
    expect(resolveTrackState([track({ muted: true })], 't1').audible).toBe(false);
  });
  it('any solo silences non-solo tracks (incl. the default track), solo+muted stays silent', () => {
    const tracks = [track(), track({ id: 't2', solo: true })];
    expect(resolveTrackState(tracks, 't1').audible).toBe(false);
    expect(resolveTrackState(tracks, 't2').audible).toBe(true);
    expect(resolveTrackState(tracks, undefined).audible).toBe(false); // default lane is non-solo
    expect(resolveTrackState([track({ solo: true, muted: true })], 't1').audible).toBe(false);
  });
});

describe('clipFadeGainAt', () => {
  it('is 1 inside a fade-less clip, 0 outside the window', () => {
    expect(clipFadeGainAt(clip(), 3)).toBe(1);
    expect(clipFadeGainAt(clip(), 1.99)).toBe(0);
    expect(clipFadeGainAt(clip(), 6)).toBe(0); // end (2 + 4s) is exclusive
  });
  it('linear fade-in and fade-out', () => {
    const c = clip({ fadeIn: 1, fadeOut: 2 }); // window 2..6
    expect(clipFadeGainAt(c, 2)).toBe(0);
    expect(clipFadeGainAt(c, 2.5)).toBeCloseTo(0.5);
    expect(clipFadeGainAt(c, 3)).toBe(1);
    expect(clipFadeGainAt(c, 5)).toBeCloseTo(0.5);
    expect(clipFadeGainAt(c, 6 - 1e-9)).toBeCloseTo(0);
  });
  it('overlapping fades on a short clip take the min of the two ramps, each clamped to clip length', () => {
    const c = clip({ outPoint: 1, fadeIn: 2, fadeOut: 2 }); // 1s clip, both fades clamp to 1
    expect(clipFadeGainAt(c, 2.5)).toBeCloseTo(0.5); // min(0.5 in-ramp, 0.5 out-ramp)
    expect(clipFadeGainAt(c, 2.25)).toBeCloseTo(0.25);
  });
});

describe('fadeEnvelopePoints', () => {
  it('no fades → flat 1 from fromTime to end', () => {
    expect(fadeEnvelopePoints(clip(), 0)).toEqual([{ t: 2, gain: 1 }, { t: 6, gain: 1 }]);
  });
  it('emits breakpoints at fade boundaries', () => {
    expect(fadeEnvelopePoints(clip({ fadeIn: 1, fadeOut: 2 }), 0)).toEqual([
      { t: 2, gain: 0 }, { t: 3, gain: 1 }, { t: 4, gain: 1 }, { t: 6, gain: 0 },
    ]);
  });
  it('mid-fade start seeds the instantaneous value and skips passed breakpoints', () => {
    expect(fadeEnvelopePoints(clip({ fadeIn: 1, fadeOut: 2 }), 2.5)).toEqual([
      { t: 2.5, gain: 0.5 }, { t: 3, gain: 1 }, { t: 4, gain: 1 }, { t: 6, gain: 0 },
    ]);
  });
  it('finished clip → []', () => {
    expect(fadeEnvelopePoints(clip(), 7)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `node_modules/.bin/vitest run packages/engine/src/audio-mix.test.ts` → FAIL (module not found).

- [ ] **Step 3: Add the types** to `packages/engine/src/types.ts` — insert `AudioFilter`/`AudioTrack` above `AudioClip`; add the optional fields with doc comments matching house style:

```ts
/** Per-track effect: one biquad filter (absent = bypass). */
export interface AudioFilter {
  kind: 'lowpass' | 'highpass';
  /** Cutoff Hz. */
  frequency: number;
}

/** A mixer lane. Clips reference a track via `AudioClip.trackId`; a clip with no (or a dangling)
 *  trackId plays on the implicit DEFAULT track (gain 1, unmuted, no pan/filter) — legacy parity. */
export interface AudioTrack {
  id: string;
  name: string;
  /** 0..1 linear. */
  gain: number;
  muted: boolean;
  solo: boolean;
  /** -1..1; absent = 0 (center). */
  pan?: number;
  filter?: AudioFilter;
}
```

On `AudioAsset`: `/** Source length in seconds, stamped at import time by decoding. Absent on legacy assets. */ duration?: number;`
On `AudioClip`: `trackId?: string;` + `/** Fade-in/out lengths in seconds (linear), clamped to clip length. Absent = no fade. */ fadeIn?: number; fadeOut?: number;`
On `Project`: `/** Mixer lanes (multitrack audio). Absent = single implicit lane — parity. */ audioTracks?: AudioTrack[];`

- [ ] **Step 4: Implement `packages/engine/src/audio-mix.ts`:**

```ts
/** ONE owner of multitrack mix math (the trim.ts pattern). The services audioEngine, the editor
 *  transport, and the export runtime all consume these outputs; loudness is computed nowhere else.
 *  Effective loudness = clip.volume × clipFadeGainAt × track.gain × audible. */
import type { AudioClip, AudioFilter, AudioTrack } from './types';

export interface TrackState {
  audible: boolean;
  gain: number;
  pan: number;
  filter?: AudioFilter;
}

const DEFAULT_STATE: TrackState = { audible: true, gain: 1, pan: 0 };

export function resolveTrackState(
  tracks: AudioTrack[] | undefined,
  trackId: string | undefined,
): TrackState {
  const anySolo = (tracks ?? []).some((t) => t.solo);
  const track = trackId ? tracks?.find((t) => t.id === trackId) : undefined;
  if (!track) return anySolo ? { ...DEFAULT_STATE, audible: false } : DEFAULT_STATE;
  const audible = !track.muted && (!anySolo || track.solo);
  return {
    audible,
    gain: track.gain,
    pan: track.pan ?? 0,
    ...(track.filter ? { filter: track.filter } : {}),
  };
}

/** Linear fade multiplier at a timeline time: 0 outside [start, end), min(in-ramp, out-ramp)
 *  inside — each fade clamped to the clip length so overlapping fades on short clips compose. */
export function clipFadeGainAt(clip: AudioClip, timelineTime: number): number {
  const len = clip.outPoint - clip.inPoint;
  const end = clip.startTime + len;
  if (timelineTime < clip.startTime || timelineTime >= end || len <= 0) return 0;
  const fadeIn = Math.min(clip.fadeIn ?? 0, len);
  const fadeOut = Math.min(clip.fadeOut ?? 0, len);
  const inRamp = fadeIn > 0 ? Math.min(1, (timelineTime - clip.startTime) / fadeIn) : 1;
  const outRamp = fadeOut > 0 ? Math.min(1, (end - timelineTime) / fadeOut) : 1;
  return Math.min(inRamp, outRamp);
}

/** Piecewise-linear fade envelope from max(clip.startTime, fromTime) to clip end, as
 *  {timeline second, fade gain} breakpoints. Consumers map these 1:1 onto WebAudio
 *  setValueAtTime + linearRampToValueAtTime. Volume is NOT folded in. [] if already finished. */
export function fadeEnvelopePoints(
  clip: AudioClip,
  fromTime: number,
): Array<{ t: number; gain: number }> {
  const len = clip.outPoint - clip.inPoint;
  const end = clip.startTime + len;
  const start = Math.max(clip.startTime, fromTime);
  if (end <= start || len <= 0) return [];
  const fadeIn = Math.min(clip.fadeIn ?? 0, len);
  const fadeOut = Math.min(clip.fadeOut ?? 0, len);
  // clipFadeGainAt is 0 at the EXCLUSIVE end; the envelope's end value must instead be the
  // limit from the left: 0 when fading out, else the value just inside the window.
  const gainAt = (t: number): number => {
    if (t < end) return clipFadeGainAt(clip, t);
    return fadeOut > 0 ? 0 : clipFadeGainAt(clip, Math.max(start, end - Math.min(1e-9, len)));
  };
  const breakpoints = [start, clip.startTime + fadeIn, end - fadeOut, end]
    .filter((t, i, a) => t >= start && t <= end && a.indexOf(t) === i)
    .sort((a, b) => a - b);
  return breakpoints.map((t) => ({ t, gain: gainAt(t) }));
}
```

- [ ] **Step 5: Export** from `packages/engine/src/index.ts`: add `export { resolveTrackState, clipFadeGainAt, fadeEnvelopePoints } from './audio-mix'; export type { TrackState } from './audio-mix';` and add `AudioTrack`, `AudioFilter` to the existing type re-exports.

- [ ] **Step 6: Run tests** — `node_modules/.bin/vitest run packages/engine/src/audio-mix.test.ts` → PASS. Then full engine suite: `node_modules/.bin/vitest run packages/engine` → PASS (nothing existing touched behaviorally).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm typecheck && git add -A && git commit -m "feat(engine): multitrack audio model + audio-mix formula owner"
```

---

### Task 2: Services audioEngine — track chains, fades, updateTracks; transport wiring

**Files:**
- Modify: `packages/services/src/audio/audioEngine.ts` (whole file shown below — it is 80 lines today)
- Modify: `packages/services/src/audio/audioEngine.test.ts` (extend the existing fake ctx)
- Modify: `apps/react/src/ui/playback/audioTransport.ts` (~L47 `engine.start` call; add `updateTracks`)

**Interfaces:**
- Consumes (Task 1): `resolveTrackState`, `fadeEnvelopePoints`, `AudioTrack`.
- Produces:
  - `interface AudioParamLike { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void }`
  - `GainLike.gain: AudioParamLike` (was `{ value: number }`)
  - `interface StereoPannerLike extends AudioNodeLike { pan: AudioParamLike }`
  - `interface BiquadFilterLike extends AudioNodeLike { type: string; frequency: AudioParamLike }`
  - `AudioContextLike` += `createStereoPanner?(): StereoPannerLike; createBiquadFilter?(): BiquadFilterLike` (optionality = older-Safari feature-detect: missing factory ⇒ that node is skipped)
  - `AudioEngine.start(clips: AudioClip[], tracks: AudioTrack[] | undefined, fromTime: number): void`
  - `AudioEngine.updateTracks(tracks: AudioTrack[] | undefined): void` (live gain/mute/solo/pan/filter-param sets; structural filter add/remove applies next start)
  - `AudioTransport.updateTracks(project: Project): void`

- [ ] **Step 1: Extend the fake + write failing tests** in `audioEngine.test.ts`. Upgrade the existing fake ctx: every `gain`/`pan`/`frequency` param becomes `{ value, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }`; add `createStereoPanner`/`createBiquadFilter` factories returning recording fakes with a `connect` spy. Add tests:

```ts
it('routes a clip through its track chain: source→clipGain→trackGain→panner→filter→destination', () => {
  const ctx = makeFakeCtx();
  const engine = createAudioEngine(ctx);
  seedBuffer(ctx, engine, 'a1', 10); // helper: decode a fake buffer of 10s
  const tracks = [{ id: 't1', name: 'T', gain: 0.5, muted: false, solo: false, pan: 0.25, filter: { kind: 'lowpass' as const, frequency: 900 } }];
  engine.start([{ id: 'c1', assetId: 'a1', startTime: 0, inPoint: 0, outPoint: 2, volume: 0.8, trackId: 't1' }], tracks, 0);
  const [clipGain] = ctx.gains; const [trackGain] = ctx.trackGains ?? ctx.gains.slice(1);
  expect(ctx.sources[0].connect).toHaveBeenCalledWith(clipGain);
  expect(trackGain.gain.value).toBe(0.5);
  expect(ctx.panners[0].pan.value).toBe(0.25);
  expect(ctx.filters[0].type).toBe('lowpass');
  expect(ctx.filters[0].frequency.value).toBe(900);
});
it('muted/solo-elsewhere track gets trackGain 0', () => { /* gain.value === 0 via resolveTrackState */ });
it('missing createStereoPanner/createBiquadFilter skips those nodes (chain still reaches destination)', () => { /* delete factories from fake */ });
it('fades schedule setValueAtTime + linearRampToValueAtTime from fadeEnvelopePoints', () => {
  // clip startTime 0, out 4, fadeIn 1, fadeOut 1, volume 0.8, fromTime 0, ctx.currentTime = 10
  // expect clipGain.gain.setValueAtTime(0, 10) and ramps to 0.8 at 11, 0.8 at 13, 0 at 14
});
it('mid-fade start seeds the instantaneous value', () => { /* fromTime 0.5 into a 1s fadeIn → setValueAtTime(0.4, when) */ });
it('updateTracks live-sets gain/pan/frequency on retained chains', () => {
  // start, then updateTracks with gain 0.9 / muted true → trackGain.gain.value 0 etc.
});
it('legacy call (tracks undefined, no fades) behaves as before: clipGain=volume connected to destination', () => { /* parity spy */ });
```

(Write them as real assertions against your fake's recorded arrays — the shapes above are the contract; `seedBuffer`/`makeFakeCtx` are test-local helpers you write in this file, extending the fake that already exists there.)

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/vitest run packages/services/src/audio/audioEngine.test.ts` → FAIL (signature + missing nodes).

- [ ] **Step 3: Implement.** Replace `audioEngine.ts` body:

```ts
import type { AudioClip, AudioTrack } from '@savig/engine';
import { fadeEnvelopePoints, resolveTrackState } from '@savig/engine';

export interface AudioNodeLike { connect(destination: unknown): void }
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
}
export interface GainLike extends AudioNodeLike { gain: AudioParamLike }
export interface StereoPannerLike extends AudioNodeLike { pan: AudioParamLike }
export interface BiquadFilterLike extends AudioNodeLike { type: string; frequency: AudioParamLike }
export interface AudioBufferLike { duration: number }
export interface AudioBufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when: number, offset: number, duration: number): void;
  stop(): void;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  createGain(): GainLike;
  createBufferSource(): AudioBufferSourceLike;
  /** Optional: absent (older Safari / minimal fakes) ⇒ the node is skipped in the chain. */
  createStereoPanner?(): StereoPannerLike;
  createBiquadFilter?(): BiquadFilterLike;
  resume?(): Promise<void>;
}

export interface AudioEngine {
  decode(assetId: string, bytes: Uint8Array): Promise<void>;
  start(clips: AudioClip[], tracks: AudioTrack[] | undefined, fromTime: number): void;
  /** Live mixer update: sets gain/mute/solo/pan/filter params on chains built by start().
   *  Structural changes (filter added/removed, new tracks) apply on the next start(). */
  updateTracks(tracks: AudioTrack[] | undefined): void;
  stop(): void;
  readonly currentTime: number;
}

interface TrackChain { input: GainLike; panner?: StereoPannerLike; filter?: BiquadFilterLike }
const DEFAULT_LANE = '';

export function createAudioEngine(ctx: AudioContextLike): AudioEngine {
  const buffers = new Map<string, AudioBufferLike>();
  let active: AudioBufferSourceLike[] = [];
  let chains = new Map<string, TrackChain>();

  const chainFor = (tracks: AudioTrack[] | undefined, trackId: string | undefined): TrackChain => {
    const key = trackId && tracks?.some((t) => t.id === trackId) ? trackId : DEFAULT_LANE;
    const existing = chains.get(key);
    if (existing) return existing;
    const state = resolveTrackState(tracks, key || undefined);
    const input = ctx.createGain();
    input.gain.value = state.audible ? state.gain : 0;
    let tail: AudioNodeLike = input;
    let panner: StereoPannerLike | undefined;
    let filter: BiquadFilterLike | undefined;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = state.pan;
      tail.connect(panner);
      tail = panner;
    }
    if (state.filter && ctx.createBiquadFilter) {
      filter = ctx.createBiquadFilter();
      filter.type = state.filter.kind;
      filter.frequency.value = state.filter.frequency;
      tail.connect(filter);
      tail = filter;
    }
    tail.connect(ctx.destination);
    const chain: TrackChain = { input, ...(panner ? { panner } : {}), ...(filter ? { filter } : {}) };
    chains.set(key, chain);
    return chain;
  };

  return {
    get currentTime() { return ctx.currentTime; },
    async decode(assetId, bytes) {
      const copy = bytes.slice().buffer as ArrayBuffer;
      buffers.set(assetId, await ctx.decodeAudioData(copy));
    },
    start(clips, tracks, fromTime) {
      chains = new Map();
      for (const clip of clips) {
        const buffer = buffers.get(clip.assetId);
        if (!buffer) continue;
        const clipDuration = clip.outPoint - clip.inPoint;
        const clipEnd = clip.startTime + clipDuration;
        if (clipEnd <= fromTime) continue;
        const startedBefore = clip.startTime <= fromTime;
        const when = ctx.currentTime + (startedBefore ? 0 : clip.startTime - fromTime);
        const offset = clip.inPoint + (startedBefore ? fromTime - clip.startTime : 0);
        const duration = clip.outPoint - offset;

        const gain = ctx.createGain();
        const envelope = fadeEnvelopePoints(clip, fromTime);
        if ((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0) {
          // Map timeline breakpoints onto the ctx clock: timeline t ↦ when + (t - envelope[0].t).
          const t0 = envelope[0];
          gain.gain.setValueAtTime(clip.volume * t0.gain, when);
          for (const p of envelope.slice(1)) {
            gain.gain.linearRampToValueAtTime(clip.volume * p.gain, when + (p.t - t0.t));
          }
        } else {
          gain.gain.value = clip.volume;
        }
        gain.connect(chainFor(tracks, clip.trackId).input);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.start(when, offset, duration);
        active.push(source);
      }
    },
    updateTracks(tracks) {
      for (const [key, chain] of chains) {
        const state = resolveTrackState(tracks, key || undefined);
        chain.input.gain.value = state.audible ? state.gain : 0;
        if (chain.panner) chain.panner.pan.value = state.pan;
        if (chain.filter && state.filter) {
          chain.filter.type = state.filter.kind;
          chain.filter.frequency.value = state.filter.frequency;
        }
      }
    },
    stop() {
      for (const source of active) source.stop();
      active = [];
    },
  };
}
```

- [ ] **Step 4: Wire the transport.** In `apps/react/src/ui/playback/audioTransport.ts`: change `engine!.start(project.audioClips, fromTime)` → `engine!.start(project.audioClips, project.audioTracks, fromTime)`; add to the `AudioTransport` interface and returned object:

```ts
updateTracks(project: Project): void;
// impl:
updateTracks(project) {
  if (active && engine) engine.updateTracks(project.audioTracks);
},
```

Then in `apps/react/src/ui/playback/usePlayback.ts`, inside the existing playing-effect (where `transport` is in `deps`), add a store subscription so mixer edits during playback go live:

```ts
// Live mixer: while playing, forward audioTracks changes to the transport.
const unsub = store.subscribe((s, prev) => {
  const a = s.history.present.audioTracks;
  if (a !== prev.history.present.audioTracks) transport.updateTracks(s.history.present);
});
```
and call `unsub()` in that effect's cleanup. (Match the file's existing subscribe idiom — if `store.subscribe` there takes a single-arg listener, keep a local `prevTracks` variable instead.)

- [ ] **Step 5: Run tests** — `node_modules/.bin/vitest run packages/services apps/react/src/ui/playback` → PASS, including untouched legacy audioEngine tests (updated fake, same assertions).

- [ ] **Step 6: Typecheck + commit** — `pnpm typecheck && git add -A && git commit -m "feat(services): track chains, fade scheduling, live updateTracks"`

---

### Task 3: Store audio slice + import-duration defect fix + Timeline lanes UI

**Files:**
- Create: `packages/editor-state/src/slices/audioSlice.ts`, `packages/editor-state/src/slices/audioSlice.test.ts`
- Modify: `packages/editor-state/src/store.ts` (remove inline `addAudioClip` ~L2139, compose slice), `packages/editor-state/src/store-internals.ts` (action types)
- Create: `apps/react/src/ui/audio/decode.ts`
- Modify: `apps/react/src/ui/components/AssetPanel/AssetPanel.tsx` (`onAudio` ~L28)
- Modify: `packages/ui-core/src/viewmodels/timeline.ts` (VM + intents)
- Create: `apps/react/src/ui/components/Timeline/AudioLanes.tsx`
- Modify: `apps/react/src/ui/components/Timeline/Timeline.tsx` (replace the `audioRow` block ~L261 with `<AudioLanes vm={vm} intents={intents} />`), `Timeline.module.css`
- Create: `e2e/audio-lanes.spec.ts` (basic)

**Interfaces:**
- Consumes (Task 1): `AudioTrack`, `AudioFilter`, `AudioAsset.duration`.
- Produces — store actions (later tasks + UI rely on EXACT names):
  - `addAudioTrack(): void` · `renameAudioTrack(trackId: string, name: string): void`
  - `setAudioTrackProps(trackId: string, props: { gain?: number; muted?: boolean; solo?: boolean; pan?: number; filter?: AudioFilter | null }): void` (`filter: null` clears; `pan: 0` clears the field)
  - `removeAudioTrack(trackId: string): void` (its clips' `trackId` is stripped → default lane)
  - `addAudioClip(assetId: string): void` (FIXED: `outPoint = asset.duration ?? 0`)
  - `setAudioClipTiming(clipId: string, timing: { startTime?: number; inPoint?: number; outPoint?: number }): void` (clamps: `startTime ≥ 0`, `0 ≤ inPoint < outPoint ≤ asset.duration ?? ∞`)
  - `setAudioClipTrack(clipId: string, trackId: string | null): void`
  - `setAudioClipFades(clipId: string, fades: { fadeIn?: number; fadeOut?: number }): void` (clamped to `[0, clipLength]`; 0 removes the field)
  - `removeAudioClip(clipId: string): void`
- Produces — VM (`packages/ui-core/src/viewmodels/timeline.ts`):
  - `TimelineAudioClipVM` += `assetId: string; inPoint: number; outPoint: number; fadeIn: number; fadeOut: number` (0 when absent)
  - `interface TimelineAudioTrackVM { id: string | null; name: string; gain: number; muted: boolean; solo: boolean; pan: number; clips: TimelineAudioClipVM[] }` — `id: null` = default lane, emitted FIRST and only when it has clips or no tracks exist; then one entry per `audioTracks[]` in array order.
  - `TimelineVM` += `audioTracks: TimelineAudioTrackVM[]` (the flat `audioClips` field stays for compat).
  - `timelineIntents` += one thin wrapper per store action above.
- Produces — `apps/react/src/ui/audio/decode.ts`:
  - `decodeAudioBuffer(bytes: Uint8Array): Promise<AudioBuffer>` (via `new OfflineAudioContext(1, 1, 44100)` — gesture-free)
  - `decodeAudioDuration(bytes: Uint8Array): Promise<number | undefined>` (never throws)

- [ ] **Step 1: Write failing store tests** — `audioSlice.test.ts` (follow the existing store test idiom: fresh `useEditor.getState()` per read, never a captured snapshot):

```ts
// covers: addAudioTrack names sequentially; setAudioTrackProps merge + filter:null/pan:0 clear;
// removeAudioTrack strips trackId from its clips; addAudioClip uses asset.duration (the defect fix)
// and 0 when absent; setAudioClipTiming clamps in<out≤duration & startTime≥0; setAudioClipFades
// clamps to clip length and deletes on 0; setAudioClipTrack null clears; removeAudioClip; undo
// restores prior audioTracks AND audioClips for every action (they all go through commit()).
it('addAudioClip uses the asset duration (defect fix)', () => {
  const s = useEditor.getState();
  s.setProject({ ...emptyProject(), assets: [{ id: 'a1', kind: 'audio', name: 'x.wav', mimeType: 'audio/wav', duration: 3.5 }] });
  useEditor.getState().addAudioClip('a1');
  const clip = useEditor.getState().history.present.audioClips[0];
  expect(clip.outPoint).toBe(3.5);
  expect(clip.inPoint).toBe(0);
});
```
Write ALL the behaviors listed in the comment as individual `it` blocks with concrete assertions (same style as the sample).

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/vitest run packages/editor-state/src/slices/audioSlice.test.ts` → FAIL.

- [ ] **Step 3: Implement the slice** (`audioSlice.ts`, mirroring `transportPrefsSlice.ts` structure):

```ts
import { newId } from '@savig/engine';
import type { AudioFilter } from '@savig/engine';
import type { SliceCreator } from '../store-internals';

type AudioKeys =
  | 'addAudioTrack' | 'renameAudioTrack' | 'setAudioTrackProps' | 'removeAudioTrack'
  | 'addAudioClip' | 'setAudioClipTiming' | 'setAudioClipTrack' | 'setAudioClipFades'
  | 'removeAudioClip';

export const createAudioSlice: SliceCreator<AudioKeys> = (set, get) => ({
  addAudioTrack() {
    const project = get().history.present;
    const tracks = project.audioTracks ?? [];
    const track = { id: newId(), name: `Audio ${tracks.length + 1}`, gain: 1, muted: false, solo: false };
    get().commit({ ...project, audioTracks: [...tracks, track] });
  },
  renameAudioTrack(trackId, name) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioTracks: (project.audioTracks ?? []).map((t) => (t.id === trackId ? { ...t, name } : t)),
    });
  },
  setAudioTrackProps(trackId, props) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioTracks: (project.audioTracks ?? []).map((t) => {
        if (t.id !== trackId) return t;
        const { pan, filter, ...rest } = props;
        const next = { ...t, ...rest };
        if (pan !== undefined) { if (pan === 0) delete next.pan; else next.pan = Math.max(-1, Math.min(1, pan)); }
        if (filter !== undefined) { if (filter === null) delete next.filter; else next.filter = filter; }
        if (next.gain !== undefined) next.gain = Math.max(0, Math.min(1, next.gain));
        return next;
      }),
    });
  },
  removeAudioTrack(trackId) {
    const project = get().history.present;
    const remaining = (project.audioTracks ?? []).filter((t) => t.id !== trackId);
    const { audioTracks: _prev, ...rest } = project;
    get().commit({
      ...rest,
      ...(remaining.length ? { audioTracks: remaining } : {}), // absent stays absent
      audioClips: project.audioClips.map((c) => {
        if (c.trackId !== trackId) return c;
        const { trackId: _drop, ...restClip } = c;
        return restClip;
      }),
    });
  },
  addAudioClip(assetId) {
    const project = get().history.present;
    const asset = project.assets.find((a) => a.id === assetId);
    const duration = asset?.kind === 'audio' ? (asset.duration ?? 0) : 0;
    const clip = { id: newId(), assetId, startTime: get().time, inPoint: 0, outPoint: duration, volume: 1 };
    get().commit({ ...project, audioClips: [...project.audioClips, clip] });
  },
  setAudioClipTiming(clipId, timing) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioClips: project.audioClips.map((c) => {
        if (c.id !== clipId) return c;
        const asset = project.assets.find((a) => a.id === c.assetId);
        const max = asset?.kind === 'audio' && asset.duration !== undefined ? asset.duration : Infinity;
        const startTime = Math.max(0, timing.startTime ?? c.startTime);
        const inPoint = Math.max(0, Math.min(timing.inPoint ?? c.inPoint, max));
        const outPoint = Math.max(inPoint + 1e-3, Math.min(timing.outPoint ?? c.outPoint, max));
        return { ...c, startTime, inPoint, outPoint };
      }),
    });
  },
  setAudioClipTrack(clipId, trackId) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioClips: project.audioClips.map((c) => {
        if (c.id !== clipId) return c;
        if (trackId === null) { const { trackId: _drop, ...rest } = c; return rest; }
        return { ...c, trackId };
      }),
    });
  },
  setAudioClipFades(clipId, fades) {
    const project = get().history.present;
    get().commit({
      ...project,
      audioClips: project.audioClips.map((c) => {
        if (c.id !== clipId) return c;
        const len = c.outPoint - c.inPoint;
        const next = { ...c };
        for (const key of ['fadeIn', 'fadeOut'] as const) {
          const v = fades[key];
          if (v === undefined) continue;
          const clamped = Math.max(0, Math.min(v, len));
          if (clamped === 0) delete next[key]; else next[key] = clamped;
        }
        return next;
      }),
    });
  },
  removeAudioClip(clipId) {
    const project = get().history.present;
    get().commit({ ...project, audioClips: project.audioClips.filter((c) => c.id !== clipId) });
  },
});
```

Register the 9 action signatures in `store-internals.ts`'s actions interface (same block style as the others), delete the inline `addAudioClip` from `store.ts`, and compose `...createAudioSlice(set, get)` next to the other slices.

- [ ] **Step 4: Run store tests** → PASS. Run the FULL editor-state suite (`node_modules/.bin/vitest run packages/editor-state`) → PASS.

- [ ] **Step 5: Import decode fix.** Create `apps/react/src/ui/audio/decode.ts`:

```ts
/** Gesture-free decode: OfflineAudioContext.decodeAudioData works before any user gesture
 *  (the PLAYBACK context is created lazily on Play — never reuse it here). */
export async function decodeAudioBuffer(bytes: Uint8Array): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
}

export async function decodeAudioDuration(bytes: Uint8Array): Promise<number | undefined> {
  try {
    return (await decodeAudioBuffer(bytes)).duration;
  } catch {
    return undefined; // undecodable → asset lands without duration (legacy behavior)
  }
}
```

In `AssetPanel.tsx` `onAudio`, stamp the duration before `addAsset`:

```ts
const { asset } = importAudio(file.name, bytes, file.type);
const duration = await decodeAudioDuration(bytes);
intents.addAsset(duration !== undefined ? { ...asset, duration } : asset, bytes);
```

- [ ] **Step 6: VM + intents.** In `packages/ui-core/src/viewmodels/timeline.ts`: extend `TimelineAudioClipVM` and add `TimelineAudioTrackVM` + `TimelineVM.audioTracks` per the Interfaces block. Build:

```ts
const clipVM = (clip: AudioClip): TimelineAudioClipVM => ({
  id: clip.id, assetId: clip.assetId, startTime: clip.startTime,
  duration: clip.outPoint - clip.inPoint, inPoint: clip.inPoint, outPoint: clip.outPoint,
  fadeIn: clip.fadeIn ?? 0, fadeOut: clip.fadeOut ?? 0,
});
const tracks = project.audioTracks ?? [];
const trackIds = new Set(tracks.map((t) => t.id));
const untracked = audioClips.filter((c) => !c.trackId || !trackIds.has(c.trackId));
const audioTrackVMs: TimelineAudioTrackVM[] = [
  ...(untracked.length || tracks.length === 0
    ? [{ id: null, name: 'Audio', gain: 1, muted: false, solo: false, pan: 0, clips: untracked.map(clipVM) }]
    : []),
  ...tracks.map((t) => ({
    id: t.id, name: t.name, gain: t.gain, muted: t.muted, solo: t.solo, pan: t.pan ?? 0,
    clips: audioClips.filter((c) => c.trackId === t.id).map(clipVM),
  })),
];
```
Add to `timelineIntents` (and the `TimelineStore` type union it reads from): `addAudioTrack`, `renameAudioTrack`, `setAudioTrackProps`, `removeAudioTrack`, `addAudioClip`, `setAudioClipTiming`, `setAudioClipTrack`, `setAudioClipFades`, `removeAudioClip` — each a one-line `s().x(...)` wrapper. Unit-test `audioTracks` derivation (default-lane-first, dangling-trackId lands on default lane, no-default-lane-when-empty-and-tracks-exist) in `timeline.test.ts`.

- [ ] **Step 7: AudioLanes component.** Create `AudioLanes.tsx` rendering from `vm.audioTracks`; Timeline.tsx's old `audioRow` div is deleted and replaced by `<AudioLanes vm={vm} intents={intents} />`:

```tsx
// Per-lane row: header (name, M, S, gain, pan) + clip lane. Drag semantics:
// clip-body horizontal drag = retime (setAudioClipTiming.startTime, frame-snapped like keyframes);
// clip-body VERTICAL drag ≥ half a lane height = reassign lane on release (setAudioClipTrack);
// 6px edge zones = trim (inPoint on left edge, outPoint on right; the body keeps startTime).
// The drag pattern copies Timeline's keyframe drag: pointerdown captures, window move previews
// imperatively via style.left/width, pointerup commits ONE store action (single undo entry).
```
Concrete requirements (implement exactly; a reviewer rejects the task if any is missing):
- data-testids: `audio-lane-<trackId|default>`, `audio-clip-<clipId>` (keeps the existing e2e-visible clip id shape), `audio-track-mute-<id>`, `audio-track-solo-<id>`, `audio-track-gain-<id>`, `audio-track-pan-<id>`, `add-audio-track`.
- M/S are `<button aria-pressed={...}>`; gain/pan are `<input type="range">` (`0..1 step 0.01`, `-1..1 step 0.01`) calling `setAudioTrackProps` on change.
- `+ Track` button calls `addAudioTrack`. Track name is a double-click-to-edit inline `<input>` (the Layers rename pattern) committing `renameAudioTrack`.
- Default lane (id null) shows no M/S/gain/pan controls and no rename — label "Audio".
- Filter UI is NOT here (Inspector, Task 5 — keep headers compact).
- CSS: extend `Timeline.module.css` — `.audioLane { display:flex; height:34px; border-top:1px solid var(--color-border); }`, `.laneHeader { width: [TRACK_LABEL_WIDTH]px; display:flex; gap:4px; align-items:center; }`, clip blocks `position:absolute` in a `position:relative` lane strip (reuse the existing `.clip` styling as the base).

- [ ] **Step 8: Basic e2e** — `e2e/audio-lanes.spec.ts`: generate a small WAV in-test and drive the real app:

```ts
// makeWav(): 0.5s 440Hz sine, 16-bit PCM mono 8kHz — ~45 lines of DataView writing, RIFF header.
// (Task 8 moves this helper to e2e/util/wav.ts for reuse; write it inline here first.)
test('import audio → clip lands with real duration; add track; M/S/gain react', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input#<audio-input-id>', { name: 't.wav', mimeType: 'audio/wav', buffer: makeWav() });
  await page.getByTestId(/audio-clip-/).waitFor(); // clip appears after decode+place
  // width > 2px proves outPoint > 0 (the defect fix): zero-length clips rendered 2px before.
  const w = await page.getByTestId(/audio-clip-/).evaluate((el) => el.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(3);
  await page.getByTestId('add-audio-track').click();
  await expect(page.getByTestId(/audio-lane-/)).toHaveCount(2);
});
```
(Adapt the audio-input selector to the AssetPanel's real input id/label; check how existing e2e imports audio — if none does, `setInputFiles` on the hidden input by its `id` attribute. NOTE: the AssetPanel flow needs a click on the placed asset button (`AssetPanel.tsx` `onClick → addAudioClip`) between import and clip appearance — follow the actual flow when writing the test.)

- [ ] **Step 9: Full verification + commit** — `pnpm test` (all units) + `pnpm typecheck` + `node_modules/.bin/playwright test e2e/audio-lanes.spec.ts` → all PASS. `git add -A && git commit -m "feat(editor): audio lanes, track mixer actions, import-duration defect fix"`

---

### Task 4: Waveforms

**Files:**
- Create: `packages/services/src/audio/waveform.ts`, `packages/services/src/audio/waveform.test.ts`
- Modify: `packages/services/src/index.ts` (export `computePeaks`)
- Modify: `apps/react/src/ui/audio/decode.ts` (add peaks cache)
- Modify: `apps/react/src/ui/components/Timeline/AudioLanes.tsx` (render waveform)

**Interfaces:**
- Consumes: `decodeAudioBuffer` (Task 3), store `binaries: Record<string, Uint8Array>` (exists on state, `store-internals.ts:129`).
- Produces:
  - `computePeaks(channelData: Float32Array, bins: number): Float32Array` — length `bins`, each `max(|sample|)` over its window; `bins ≥ 1`; empty input → zeros.
  - `getPeaks(assetId: string, bytes: Uint8Array, bins: number): Promise<{ peaks: Float32Array; duration: number } | null>` (cached by `assetId:bins`; null on decode failure).

- [ ] **Step 1: Failing tests** — `waveform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computePeaks } from './waveform';

describe('computePeaks', () => {
  it('constant signal → constant peaks', () => {
    expect(Array.from(computePeaks(new Float32Array(100).fill(0.5), 4))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
  it('takes max |sample| per bin (negative peaks count)', () => {
    const data = new Float32Array([0, -0.9, 0, 0.2]);
    expect(Array.from(computePeaks(data, 2))).toEqual([0.9, 0.2]);
  });
  it('silence → zeros; empty input → zeros; bins > samples still fills bins', () => {
    expect(Array.from(computePeaks(new Float32Array(8), 3))).toEqual([0, 0, 0]);
    expect(Array.from(computePeaks(new Float32Array(0), 2))).toEqual([0, 0]);
    expect(computePeaks(new Float32Array([1]), 4)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Verify failure**, then implement:

```ts
/** Max-|sample| peak per bin for waveform rendering. Pure — decode happens in the app layer. */
export function computePeaks(channelData: Float32Array, bins: number): Float32Array {
  const peaks = new Float32Array(bins);
  if (channelData.length === 0) return peaks;
  const perBin = channelData.length / bins;
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * perBin);
    const end = Math.min(channelData.length, Math.max(start + 1, Math.floor((b + 1) * perBin)));
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(channelData[i]);
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  return peaks;
}
```
Export from `packages/services/src/index.ts`. Run tests → PASS.

- [ ] **Step 3: Cache in `decode.ts`:**

```ts
const peaksCache = new Map<string, Promise<{ peaks: Float32Array; duration: number } | null>>();
export function getPeaks(assetId: string, bytes: Uint8Array, bins: number) {
  const key = `${assetId}:${bins}`;
  let hit = peaksCache.get(key);
  if (!hit) {
    hit = decodeAudioBuffer(bytes)
      .then((buf) => ({ peaks: computePeaks(buf.getChannelData(0), bins), duration: buf.duration }))
      .catch(() => null);
    peaksCache.set(key, hit);
  }
  return hit;
}
```
(Assets are content-addressed — importAudio test says so — so the cache never goes stale.)

- [ ] **Step 4: Render.** In `AudioLanes.tsx`, a `ClipWaveform` child: `useEffect` calls `getPeaks(clip.assetId, binaries[clip.assetId], 128)` (read `binaries` off the store the same way the transport does) and stores the result in state; render an `<svg viewBox="0 0 128 2" preserveAspectRatio="none">` with ONE `<path>` — mirrored silhouette windowed to the clip's source slice:

```ts
// Window: source-fraction of the ASSET the clip plays = inPoint/duration .. outPoint/duration.
// Map bin i of the windowed slice to x=i, y = 1 ± peaks[binIndex]. Missing binaries/null → no path.
const from = Math.floor((clip.inPoint / duration) * 128), to = Math.ceil((clip.outPoint / duration) * 128);
```
No new unit tests here (jsdom has no OfflineAudioContext); covered by Task 8 e2e (waveform path element present).

- [ ] **Step 5: Verify + commit** — `pnpm test && pnpm typecheck`, re-run `node_modules/.bin/playwright test e2e/audio-lanes.spec.ts`. `git add -A && git commit -m "feat(ui): clip waveforms (computePeaks + OfflineAudioContext cache)"`

---

### Task 5: Fade handles + track filter Inspector controls

**Files:**
- Modify: `apps/react/src/ui/components/Timeline/AudioLanes.tsx` (fade handles + ramp overlay)
- Modify: the Inspector component (find it: `grep -rn "Inspector" apps/react/src/ui/components --include="*.tsx" -l`) — add a "Track" section shown when a track is selected
- Modify: `packages/ui-core/src/viewmodels/timeline.ts` (selected-track plumbing) and the editor-state selection field
- Test: extend `audioSlice.test.ts` + `e2e/audio-lanes.spec.ts`

**Interfaces:**
- Consumes (Task 3): `setAudioClipFades`, `setAudioTrackProps` (`filter` prop incl. `null` clear).
- Produces: store field `selectedAudioTrackId: string | null` + action `selectAudioTrack(trackId: string | null): void` (transient selection, `set` not `commit` — mirrors `selectObject`); `TimelineAudioTrackVM` gains `selected: boolean`.

- [ ] **Step 1: Selection.** Add `selectedAudioTrackId: string | null` to store state (initial null, in `store-internals.ts` next to the other selection fields) and `selectAudioTrack` to the audio slice (plain `set({ selectedAudioTrackId })`; also null it inside the existing object-selection actions? NO — leave independent, audio selection is orthogonal to stage selection). Unit test: select/clear.

- [ ] **Step 2: Fade handles.** In each clip block, two 8×8 corner triangles (`data-testid="fade-in-handle-<clipId>"` / `fade-out-handle-<clipId>`, `<div>` with CSS border-triangle, `cursor: ew-resize`). Pointer pattern identical to clip-trim: capture on pointerdown, imperative preview during move, ONE `setAudioClipFades` on release with `fadeIn = clamp(xToTime(dragX))` (left handle) / `fadeOut = clamp(-xToTime(dragX))` (right). Render the ramp as an SVG `<polyline>` overlay on the clip: `points` from `(0, bottom) → (fadeIn·pxPerSec, top)` and `(width − fadeOut·pxPerSec, top) → (width, bottom)`, `opacity: 0.6`.

- [ ] **Step 3: Inspector track section.** When `vm`'s selected track is non-null (lane header click selects; `aria-selected` on the lane): show name, filter kind `<select>` (`none | lowpass | highpass`, `data-testid="track-filter-kind"`) and frequency `<input type="number" min={10} max={24000}>` (`data-testid="track-filter-freq"`), calling `setAudioTrackProps(id, { filter: kind === 'none' ? null : { kind, frequency } })`. Follow the Inspector's existing section markup/style exactly.

- [ ] **Step 4: E2e additions** to `audio-lanes.spec.ts`: drag the fade-in handle 30px right → store `fadeIn > 0` (read via the app's exposed store or assert the polyline appears); select lane → set filter lowpass/1000 → lane survives, project state holds the filter (assert via UI state, e.g. the freq input re-reads 1000 after deselect/reselect).

- [ ] **Step 5: Verify + commit** — full unit + this spec's e2e + typecheck. `git add -A && git commit -m "feat(ui): fade handles + track filter inspector"`

---

### Task 6: Runtime export + persistence (migration v6 + audio sanitizer)

**Files:**
- Modify: `packages/runtime/src/index.ts` (`create` ~L39, `createAudioStarter` ~L53, `schedule` ~L88)
- Modify: `packages/services/src/persistence/migrate.ts` (v6)
- Create: `packages/services/src/persistence/sanitizeAudio.ts`, `sanitizeAudio.test.ts`
- Modify: engine `createProject` version stamp (find it: `grep -rn "version: 5" packages/engine/src` — update to 6; if the stamp reads from a constant, update the constant)
- Test: extend `packages/services/src/persistence/openFile.test.ts` + `migrate` tests

**Interfaces:**
- Consumes (Task 1): `resolveTrackState`, `fadeEnvelopePoints`, `AudioTrack`.
- Produces: `sanitizeAudioModel(project: Project): Project` — pure; drops malformed tracks/fields, clamps numbers to the Global Constraints ranges, caps `name` at 120 chars, strips unknown filter kinds, drops non-finite `AudioAsset.duration`. Called from `migrateProject` (single seam: .savig AND SVG round-trip both pass through it).

- [ ] **Step 1: Failing sanitizer tests** — `sanitizeAudio.test.ts`: table-driven accept/reject:

```ts
// accepts a valid track verbatim; clamps gain 2→1, pan -3→-1, frequency 1→10 / 1e6→24000;
// truncates a 500-char name to 120; drops a track that is not an object / has non-string id;
// strips filter with kind 'notch'; drops fadeIn: -1 and fadeIn: NaN (field removed, clip kept);
// drops trackId: 42 (field removed); drops AudioAsset.duration: Infinity (field removed);
// leaves a project with NO audioTracks byte-identical (=== same reference when nothing to fix).
```
Each line = one `it` with concrete input/expected objects.

- [ ] **Step 2: Verify failure, implement `sanitizeAudio.ts`** — straightforward field-by-field walk; IMPORTANT: return the ORIGINAL project reference when no change was needed (parity guard asserts `===`). Wire into `migrateProject` (after shape-check, before/after migrations both fine — put it after, on the final doc). Add `migrations[5] = (doc) => ({ ...doc, meta: { ...doc.meta, version: 6 } })`, `CURRENT_VERSION = 6`, and bump the engine `createProject` stamp to 6. Run migrate/openFile/services tests → PASS (fix any test pinning version 5 — they should now expect 6).

- [ ] **Step 3: Runtime.** In `packages/runtime/src/index.ts`: `createAudioStarter(project.audioClips, audio)` → `createAudioStarter(project.audioClips, project.audioTracks, audio)`; import `fadeEnvelopePoints, resolveTrackState` from `@savig/engine`; extend `schedule`:

```ts
function createAudioStarter(clips: AudioClip[], tracks: AudioTrack[] | undefined, audio: Record<string, string>): () => void {
  // ...decode loop unchanged, then:
  //   const chains = new Map<string, GainNode>(); // trackId|'' -> chain INPUT node
  //   for (...) schedule(ctx, decoded, clip, chainInput(ctx, chains, tracks, clip.trackId));
}
function chainInput(ctx: AudioContext, chains: Map<string, GainNode>, tracks: AudioTrack[] | undefined, trackId: string | undefined): GainNode {
  const key = trackId && tracks?.some((t) => t.id === trackId) ? trackId : '';
  const hit = chains.get(key);
  if (hit) return hit;
  const state = resolveTrackState(tracks, key || undefined);
  const input = ctx.createGain();
  input.gain.value = state.audible ? state.gain : 0;
  let tail: AudioNode = input;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = state.pan; tail.connect(p); tail = p; }
  if (state.filter) { const f = ctx.createBiquadFilter(); f.type = state.filter.kind; f.frequency.value = state.filter.frequency; tail.connect(f); tail = f; }
  tail.connect(ctx.destination);
  chains.set(key, input);
  return input;
}
function schedule(ctx: AudioContext, decoded: Map<string, AudioBuffer>, clip: AudioClip, into: AudioNode): void {
  const buffer = decoded.get(clip.assetId);
  if (!buffer) return;
  const gain = ctx.createGain();
  const envelope = fadeEnvelopePoints(clip, 0);
  if (((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0) && envelope.length) {
    const base = ctx.currentTime;
    gain.gain.setValueAtTime(clip.volume * envelope[0].gain, base + envelope[0].t);
    for (const p of envelope.slice(1)) gain.gain.linearRampToValueAtTime(clip.volume * p.gain, base + p.t);
  } else {
    gain.gain.value = clip.volume;
  }
  gain.connect(into);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start(ctx.currentTime + Math.max(0, clip.startTime), clip.inPoint, clip.outPoint - clip.inPoint);
}
```
(The runtime always starts from time 0, so envelope timeline-times ARE ctx offsets from `base` — unlike the editor engine's fromTime remap. The duplicate `resolveActiveClips(clips, 0)` + `startTime > 0` double-schedule loop in the existing code stays as-is, but pass `into` through both call sites.)

- [ ] **Step 4: REBUILD THE RUNTIME** — `pnpm build:runtime` — and verify `packages/runtime/src/runtimeSource.generated.ts` changed; commit it WITH this task.

- [ ] **Step 5: Verify** — `pnpm test && pnpm typecheck`; run the existing export e2e: `node_modules/.bin/playwright test e2e/animated-svg-export.spec.ts e2e/open-svg-roundtrip.spec.ts` (exact names: `ls e2e | grep -i 'export\|roundtrip'`) → PASS (proves legacy parity through the real pipeline).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(runtime,persistence): track-aware export playback; v6 migration + audio sanitizer"`

---

### Task 7: DSL / MCP / describe / validate parity

**Files:**
- Modify: `packages/core/src/build.ts` (+ its test), `packages/core/src/describe.ts` (~L64), `packages/core/src/validate.ts`, `packages/core/src/dsl.ts` (`ShortDoc` ~L107, `compileShort` ~L175, `decompileProject` ~L328)
- Modify: `packages/mcp/src/tools.ts` (+ `tools.test.ts`)

**Interfaces:**
- Consumes (Task 1 types). Produces (EXACT builder signatures — headless has NO decoder, so clip timing is explicit):
  - `addAudioTrack(project: Project, opts?: { id?: string; name?: string; gain?: number; pan?: number; filter?: AudioFilter }): { project: Project; id: string }`
  - `addAudioClip(project: Project, opts: { assetId: string; trackId?: string; at: number; inPoint: number; outPoint: number; volume?: number; fadeIn?: number; fadeOut?: number; id?: string }): { project: Project; id: string }`
  - `setClipFades(project: Project, clipId: string, fades: { fadeIn?: number; fadeOut?: number }): Project`
  - `setTrackEffect(project: Project, trackId: string, effect: { pan?: number; filter?: AudioFilter | null }): Project`
  - DSL: `ShortDoc.audio?: ShortAudio` where `interface ShortAudioClip { id?: string; asset: string; at: number; in: number; out: number; volume?: number; fadeIn?: number; fadeOut?: number }` and `interface ShortAudio { tracks?: Array<{ id?: string; name?: string; gain?: number; pan?: number; filter?: AudioFilter; clips?: ShortAudioClip[] }>; clips?: ShortAudioClip[] }` (top-level `clips` = default lane).
  - MCP tools: `add_audio_track`, `set_audio_track`, `add_audio_clip`, `set_audio_clip`, `remove_audio_track`, `remove_audio_clip`.

- [ ] **Step 1: Builder tests then builders** in `build.ts` (TDD; follow `addRect`'s `{ project, id }` return shape and its id/newId handling). Defaults: `name` = `Audio ${n+1}`, `gain` 1, `volume` 1. `setTrackEffect` merges like the store's `setAudioTrackProps` pan/filter handling (0/null clear). Builders are PURE — no clamping beyond the store's (validate reports instead).

- [ ] **Step 2: describe.** Replace `if (project.audioClips.length) lines.push(...)` with:

```ts
if (project.audioClips.length || project.audioTracks?.length) {
  const tracks = project.audioTracks ?? [];
  const trackIds = new Set(tracks.map((t) => t.id));
  const untracked = project.audioClips.filter((c) => !c.trackId || !trackIds.has(c.trackId));
  lines.push(`Audio: ${project.audioClips.length} clip(s), ${tracks.length} track(s)`);
  if (untracked.length) lines.push(`  - [default lane] ${untracked.length} clip(s)`);
  for (const t of tracks) {
    const n = project.audioClips.filter((c) => c.trackId === t.id).length;
    const flags = [t.muted ? 'muted' : '', t.solo ? 'solo' : ''].filter(Boolean).join(' ');
    const fx = [t.pan ? `pan ${t.pan}` : '', t.filter ? `${t.filter.kind}@${t.filter.frequency}Hz` : ''].filter(Boolean).join(' · ');
    lines.push(`  - "${t.name}" ${n} clip(s) · gain ${t.gain}${flags ? ' · ' + flags : ''}${fx ? ' · ' + fx : ''}`);
  }
}
```
Pin with a describe test (exact-string style matching existing describe tests).

- [ ] **Step 3: validate.** Add an `validateAudio(project, issues)` pass called from the main validate entry: error codes `dangling-audio-asset` (clip.assetId not an audio asset), `dangling-audio-track` (clip.trackId set but missing — WARN, it still plays on default lane), `audio-clip-window` (`inPoint >= outPoint` or negative, or `outPoint > asset.duration` when duration known), `audio-fade-too-long` (warn: fade > clip length — it clamps at runtime), `audio-pan-range`, `audio-filter-frequency-range`, `audio-gain-range`, `audio-volume-range`. Table-driven tests like the existing validate tests.

- [ ] **Step 4: DSL.** Add `ShortAudio` types; in `compileShort` (after objects/scenes compile): tracks via `addAudioTrack`, nested clips via `addAudioClip` with `trackId` from the enclosing track, top-level `audio.clips` via `addAudioClip` without `trackId`, mapping `at→startTime(at), in→inPoint, out→outPoint`. In `decompileProject`: emit `audio` only when `audioClips.length || audioTracks?.length`, tracks in array order with their clips nested, untracked clips into top-level `clips`, ids ALWAYS emitted (`id: c.id` — the existing decompile emits object ids, same convention), optional fields conditional-spread. Round-trip test: build a project with 1 track (pan+filter) + 1 tracked fading clip + 1 default-lane clip → `compileShort(decompileProject(p))` gives deep-equal `audioTracks`/`audioClips`.

- [ ] **Step 5: MCP tools** in `tools.ts` (copy the `set_trim` tool shape; `edited(session, msg)` + `obj/str/num` schema helpers already exist there):

| name | inputSchema (required) | run |
|---|---|---|
| `add_audio_track` | `{ name?, gain?, pan?, filter_kind?, filter_frequency? }` () | `addAudioTrack` → `edited(session, 'Audio track "<id>" added.')` |
| `set_audio_track` | `{ trackId, name?, gain?, muted?, solo?, pan?, filter_kind? ('none' clears), filter_frequency? }` (trackId) | patch track array directly (or `setTrackEffect` + inline name/gain/muted/solo merge) |
| `add_audio_clip` | `{ assetId, at, inPoint, outPoint, trackId?, volume?, fadeIn?, fadeOut? }` (assetId, at, inPoint, outPoint) | `addAudioClip` |
| `set_audio_clip` | `{ clipId, at?, inPoint?, outPoint?, trackId? ('' clears), fadeIn?, fadeOut?, volume? }` (clipId) | inline map over audioClips (conditional-spread each provided field; fade 0 deletes) |
| `remove_audio_track` | `{ trackId }` | filter track + strip its clips' trackId |
| `remove_audio_clip` | `{ clipId }` | filter |
Audio is PROJECT-level, so do NOT wrap in `withScene` — patch `session.project` directly. Every tool description mentions valid ranges (they're the agent's docs). Tests in `tools.test.ts` per existing per-tool style + one describe-output smoke.

- [ ] **Step 6: Verify + commit** — `pnpm test && pnpm typecheck`; `git add -A && git commit -m "feat(core,mcp): audio DSL section, builders, validate, describe, 6 MCP tools"`

---

### Task 8: Comprehensive e2e, INDEX.md, security review, merge

**Files:**
- Create: `e2e/util/wav.ts` (move `makeWav` from Task 3's spec; both specs import it)
- Create: `e2e/multitrack-audio.spec.ts`
- Modify: `docs/superpowers/INDEX.md` (new milestone row: multitrack audio ✅ + spec/plan links; update "What's next")

**Interfaces:** consumes everything; produces the merge.

- [ ] **Step 1: Comprehensive spec** — `e2e/multitrack-audio.spec.ts` (real Chromium; each test independent):

```ts
// 1. import wav → place clip → waveform <path> appears inside the clip block (Task 4 render)
// 2. two tracks + M/S/gain/pan: toggle solo on t1 → aria-pressed states correct; gain slider drag
//    updates value; all survive reload via autosave IF autosave e2e exists — otherwise skip reload.
// 3. drag clip from default lane onto track lane → clip now renders inside audio-lane-<t1>
// 4. trim right edge left → clip narrows; drag fade-in handle → polyline overlay appears
// 5. PLAY smoke: place clip, press Play, expect playhead x to advance and NO page crash
//    (the native-binding regression class) — assert app root still mounted after 500ms.
// 6. round-trip: export animated SVG (palette command, stub showSaveFilePicker per the
//    live-demo recipe) → reopen exported bytes → audioTracks/fades/filter survive (assert via
//    the lanes UI: track name + fade polyline present).
// 7. legacy parity: load a template (no audioTracks) → exactly one "Audio" default lane row,
//    no M/S controls.
```
Write all 7 as real tests. For 6, mirror `open-svg-roundtrip.spec.ts`'s existing export/reopen plumbing.

- [ ] **Step 2: Full suites** — kill stale vite; `pnpm test` (expect ~2680+ unit green), `pnpm e2e` (~150+ green), `pnpm typecheck`, `pnpm lint`. Fix regressions found — a "pre-existing" e2e failure claim requires a main-vs-branch A/B before acceptance.

- [ ] **Step 3: INDEX.md** — add the multitrack-audio milestone row (spec + plan paths, merge hash placeholder → fill after merge), move the roadmap "NEXT" pointer to the next item, note the outPoint:0 defect fix.

- [ ] **Step 4: Security review** — run the security-review skill over the branch diff; focus: `sanitizeAudio.ts` (hostile embedded JSON), DSL audio compile (hostile ShortDoc), MCP input handling, track-name rendering (React-escaped — verify no dangerouslySetInnerHTML/attr sink), describe-string injection. Fix anything Critical/Important; loop until clean.

- [ ] **Step 5: Code review + merge** — `feature-dev:code-reviewer` pass over the full branch; loop until no Critical/Important. Then:

```bash
git checkout main && git merge --no-ff feature/multitrack-audio -m "feat: multitrack audio — lanes, waveforms, fades, pan/filter, agent parity"
pnpm test && pnpm e2e && pnpm typecheck   # verify ON MAIN before declaring done
```
Update INDEX.md merge hash, commit.
