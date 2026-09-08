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
