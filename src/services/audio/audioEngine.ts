import type { AudioClip } from '../../engine';

export interface AudioNodeLike {
  connect(destination: unknown): void;
}
export interface GainLike extends AudioNodeLike {
  gain: { value: number };
}
export interface AudioBufferLike {
  duration: number;
}
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
}

export interface AudioEngine {
  decode(assetId: string, bytes: Uint8Array): Promise<void>;
  start(clips: AudioClip[], fromTime: number): void;
  stop(): void;
  readonly currentTime: number;
}

// Framework-agnostic Web Audio scheduler. Pure timing math (start time,
// source offset, trimmed duration) is unit-tested via a fake AudioContext;
// RAF/transport wiring belongs to Plan 3.
export function createAudioEngine(ctx: AudioContextLike): AudioEngine {
  const buffers = new Map<string, AudioBufferLike>();
  let active: AudioBufferSourceLike[] = [];

  return {
    get currentTime() {
      return ctx.currentTime;
    },
    async decode(assetId, bytes) {
      // Copy into a standalone ArrayBuffer for decodeAudioData.
      const copy = bytes.slice().buffer as ArrayBuffer;
      buffers.set(assetId, await ctx.decodeAudioData(copy));
    },
    start(clips, fromTime) {
      for (const clip of clips) {
        const buffer = buffers.get(clip.assetId);
        if (!buffer) continue;

        const clipDuration = clip.outPoint - clip.inPoint;
        const clipEnd = clip.startTime + clipDuration;
        if (clipEnd <= fromTime) continue; // already finished

        const startedBefore = clip.startTime <= fromTime;
        const when = ctx.currentTime + (startedBefore ? 0 : clip.startTime - fromTime);
        const offset = clip.inPoint + (startedBefore ? fromTime - clip.startTime : 0);
        const duration = clip.outPoint - offset;

        const gain = ctx.createGain();
        gain.gain.value = clip.volume;
        gain.connect(ctx.destination);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.start(when, offset, duration);
        active.push(source);
      }
    },
    stop() {
      for (const source of active) source.stop();
      active = [];
    },
  };
}
