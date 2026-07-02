import { describe, expect, it, vi } from 'vitest';
import type { AudioClip } from '@savig/engine';
import { createAudioEngine, type AudioContextLike } from './audioEngine';

function fakeCtx(currentTime = 10) {
  const started: Array<{ when: number; offset: number; duration: number; gain: number }> = [];
  let pendingGain = 1;
  const ctx: AudioContextLike = {
    currentTime,
    destination: {},
    decodeAudioData: vi.fn().mockResolvedValue({ duration: 5 }),
    createGain: () => ({ gain: { set value(v: number) { pendingGain = v; } }, connect: vi.fn() }),
    createBufferSource: () => ({
      buffer: null,
      connect: vi.fn(),
      start: (when: number, offset: number, duration: number) =>
        started.push({ when, offset, duration, gain: pendingGain }),
      stop: vi.fn(),
    }),
  };
  return { ctx, started };
}

const clip = (over: Partial<AudioClip>): AudioClip => ({
  id: 'c', assetId: 'a1', startTime: 0, inPoint: 0, outPoint: 5, volume: 1, ...over,
});

describe('audioEngine', () => {
  it('schedules a clip that starts in the future relative to fromTime', async () => {
    const { ctx, started } = fakeCtx(10);
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 2 })], 0);
    expect(started).toHaveLength(1);
    expect(started[0].when).toBeCloseTo(12); // ctx.currentTime(10) + (startTime 2 - fromTime 0)
    expect(started[0].offset).toBeCloseTo(0);
    expect(started[0].duration).toBeCloseTo(5);
  });

  it('offsets into a clip already playing at fromTime', async () => {
    const { ctx, started } = fakeCtx(10);
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 0, inPoint: 0, outPoint: 5 })], 2);
    expect(started[0].when).toBeCloseTo(10); // already playing -> now
    expect(started[0].offset).toBeCloseTo(2); // 2s into the source
    expect(started[0].duration).toBeCloseTo(3); // 5 - 2 remaining
  });

  it('applies clip volume to the gain node', async () => {
    const { ctx, started } = fakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ volume: 0.25 })], 0);
    expect(started[0].gain).toBeCloseTo(0.25);
  });

  it('skips clips whose asset is not decoded', async () => {
    const { ctx, started } = fakeCtx();
    const engine = createAudioEngine(ctx);
    engine.start([clip({ assetId: 'missing' })], 0);
    expect(started).toHaveLength(0);
  });

  it('skips clips that have already finished before fromTime', async () => {
    const { ctx, started } = fakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 0, outPoint: 5 })], 6); // ended at t=5, fromTime=6
    expect(started).toHaveLength(0);
  });
});
