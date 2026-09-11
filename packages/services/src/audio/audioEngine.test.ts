import { describe, expect, it, vi } from 'vitest';
import type { AudioClip, AudioTrack } from '@savig/engine';
import {
  createAudioEngine,
  type AudioContextLike,
  type AudioEngine,
  type AudioParamLike,
  type GainLike,
  type StereoPannerLike,
  type BiquadFilterLike,
  type AudioBufferSourceLike,
} from './audioEngine';

function makeParam(initial = 0): AudioParamLike {
  return { value: initial, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
}

function makeFakeCtx(currentTime = 10) {
  const gains: GainLike[] = [];
  const panners: StereoPannerLike[] = [];
  const filters: BiquadFilterLike[] = [];
  const sources: AudioBufferSourceLike[] = [];
  const started: Array<{ when: number; offset: number; duration: number }> = [];

  const ctx: AudioContextLike = {
    currentTime,
    destination: {},
    decodeAudioData: vi.fn().mockResolvedValue({ duration: 5 }),
    createGain: (): GainLike => {
      const g: GainLike = { gain: makeParam(1), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(g);
      return g;
    },
    createBufferSource: (): AudioBufferSourceLike => {
      const s: AudioBufferSourceLike = {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn((when: number, offset: number, duration: number) => {
          started.push({ when, offset, duration });
        }),
        stop: vi.fn(),
      };
      sources.push(s);
      return s;
    },
    createStereoPanner: (): StereoPannerLike => {
      const p: StereoPannerLike = { pan: makeParam(0), connect: vi.fn(), disconnect: vi.fn() };
      panners.push(p);
      return p;
    },
    createBiquadFilter: (): BiquadFilterLike => {
      const f: BiquadFilterLike = { type: 'lowpass', frequency: makeParam(0), connect: vi.fn(), disconnect: vi.fn() };
      filters.push(f);
      return f;
    },
  };

  return { ctx, gains, panners, filters, sources, started };
}

/** Decodes a fake buffer of the given duration (seconds) for assetId, so start() finds it. */
async function seedBuffer(
  ctx: AudioContextLike,
  engine: AudioEngine,
  assetId: string,
  duration: number,
): Promise<void> {
  (ctx.decodeAudioData as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ duration });
  await engine.decode(assetId, new Uint8Array([1]));
}

const clip = (over: Partial<AudioClip>): AudioClip => ({
  id: 'c', assetId: 'a1', startTime: 0, inPoint: 0, outPoint: 5, volume: 1, ...over,
});

describe('audioEngine (legacy scheduling, single implicit lane)', () => {
  it('schedules a clip that starts in the future relative to fromTime', async () => {
    const { ctx, started } = makeFakeCtx(10);
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 2 })], undefined, 0);
    expect(started).toHaveLength(1);
    expect(started[0].when).toBeCloseTo(12); // ctx.currentTime(10) + (startTime 2 - fromTime 0)
    expect(started[0].offset).toBeCloseTo(0);
    expect(started[0].duration).toBeCloseTo(5);
  });

  it('offsets into a clip already playing at fromTime', async () => {
    const { ctx, started } = makeFakeCtx(10);
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 0, inPoint: 0, outPoint: 5 })], undefined, 2);
    expect(started[0].when).toBeCloseTo(10); // already playing -> now
    expect(started[0].offset).toBeCloseTo(2); // 2s into the source
    expect(started[0].duration).toBeCloseTo(3); // 5 - 2 remaining
  });

  it('applies clip volume to the gain node', async () => {
    const { ctx, gains } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ volume: 0.25 })], undefined, 0);
    expect(gains[0].gain.value).toBeCloseTo(0.25);
  });

  it('skips clips whose asset is not decoded', async () => {
    const { ctx, started } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    engine.start([clip({ assetId: 'missing' })], undefined, 0);
    expect(started).toHaveLength(0);
  });

  it('skips clips that have already finished before fromTime', async () => {
    const { ctx, started } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ startTime: 0, outPoint: 5 })], undefined, 6); // ended at t=5, fromTime=6
    expect(started).toHaveLength(0);
  });
});

describe('audioEngine (track chains, fades, updateTracks)', () => {
  it('routes a clip through its track chain: source→clipGain→trackGain→panner→filter→destination', async () => {
    const { ctx, gains, panners, filters, sources } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await seedBuffer(ctx, engine, 'a1', 10);
    const tracks: AudioTrack[] = [
      { id: 't1', name: 'T', gain: 0.5, muted: false, solo: false, pan: 0.25, filter: { kind: 'lowpass', frequency: 900 } },
    ];
    engine.start([{ id: 'c1', assetId: 'a1', startTime: 0, inPoint: 0, outPoint: 2, volume: 0.8, trackId: 't1' }], tracks, 0);

    const [clipGain] = gains;
    const [trackGain] = gains.slice(1);
    expect(sources[0].connect).toHaveBeenCalledWith(clipGain);
    expect(clipGain.connect).toHaveBeenCalledWith(trackGain);
    expect(trackGain.gain.value).toBe(0.5);
    expect(trackGain.connect).toHaveBeenCalledWith(panners[0]);
    expect(panners[0].pan.value).toBe(0.25);
    expect(panners[0].connect).toHaveBeenCalledWith(filters[0]);
    expect(filters[0].type).toBe('lowpass');
    expect(filters[0].frequency.value).toBe(900);
    expect(filters[0].connect).toHaveBeenCalledWith(ctx.destination);
  });

  it('muted/solo-elsewhere track gets trackGain 0', async () => {
    const { ctx, gains } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await seedBuffer(ctx, engine, 'a1', 10);
    const tracks: AudioTrack[] = [
      { id: 't1', name: 'Muted', gain: 1, muted: true, solo: false },
      { id: 't2', name: 'Solo', gain: 1, muted: false, solo: true },
      { id: 't3', name: 'Plain', gain: 1, muted: false, solo: false },
    ];
    engine.start(
      [
        clip({ id: 'c1', assetId: 'a1', trackId: 't1' }),
        clip({ id: 'c2', assetId: 'a1', trackId: 't3' }),
      ],
      tracks,
      0,
    );
    // gains[0]=c1 clipGain, gains[1]=t1 trackGain, gains[2]=c2 clipGain, gains[3]=t3 trackGain.
    expect(gains[1].gain.value).toBe(0); // explicitly muted
    expect(gains[3].gain.value).toBe(0); // not soloed while another track is
  });

  it('missing createStereoPanner/createBiquadFilter skips those nodes (chain still reaches destination)', async () => {
    const { ctx, gains } = makeFakeCtx();
    delete (ctx as { createStereoPanner?: unknown }).createStereoPanner;
    delete (ctx as { createBiquadFilter?: unknown }).createBiquadFilter;
    const engine = createAudioEngine(ctx);
    await seedBuffer(ctx, engine, 'a1', 10);
    const tracks: AudioTrack[] = [
      { id: 't1', name: 'T', gain: 1, muted: false, solo: false, pan: 0.5, filter: { kind: 'highpass', frequency: 200 } },
    ];
    engine.start([clip({ id: 'c1', assetId: 'a1', trackId: 't1' })], tracks, 0);
    const trackGain = gains[1];
    expect(trackGain.connect).toHaveBeenCalledWith(ctx.destination);
  });

  it('fades schedule setValueAtTime + linearRampToValueAtTime from fadeEnvelopePoints', async () => {
    const { ctx, gains } = makeFakeCtx(10);
    const engine = createAudioEngine(ctx);
    await seedBuffer(ctx, engine, 'a1', 10);
    engine.start(
      [clip({ id: 'c1', assetId: 'a1', startTime: 0, outPoint: 4, volume: 0.8, fadeIn: 1, fadeOut: 1 })],
      undefined,
      0,
    );
    const clipGain = gains[0];
    expect(clipGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
    expect(clipGain.gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(1, 0.8, 11);
    expect(clipGain.gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(2, 0.8, 13);
    expect(clipGain.gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(3, 0, 14);
  });

  it('mid-fade start seeds the instantaneous value', async () => {
    const { ctx, gains } = makeFakeCtx(10);
    const engine = createAudioEngine(ctx);
    await seedBuffer(ctx, engine, 'a1', 10);
    // 1s fadeIn, starting playback 0.5s into it -> instantaneous fade multiplier is 0.5.
    engine.start(
      [clip({ id: 'c1', assetId: 'a1', startTime: 0, outPoint: 4, volume: 0.8, fadeIn: 1, fadeOut: 1 })],
      undefined,
      0.5,
    );
    const clipGain = gains[0];
    expect(clipGain.gain.setValueAtTime).toHaveBeenCalledWith(0.4, 10);
  });

  it('updateTracks live-sets gain/pan/frequency on retained chains', async () => {
    const { ctx, gains, panners, filters } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await seedBuffer(ctx, engine, 'a1', 10);
    const tracks: AudioTrack[] = [
      { id: 't1', name: 'T', gain: 0.5, muted: false, solo: false, pan: 0.1, filter: { kind: 'lowpass', frequency: 500 } },
    ];
    engine.start([clip({ id: 'c1', assetId: 'a1', trackId: 't1' })], tracks, 0);
    const trackGain = gains[1];
    const panner = panners[0];
    const filter = filters[0];

    engine.updateTracks([
      { id: 't1', name: 'T', gain: 0.9, muted: true, solo: false, pan: -0.3, filter: { kind: 'highpass', frequency: 300 } },
    ]);
    expect(trackGain.gain.value).toBe(0); // muted -> inaudible
    expect(panner.pan.value).toBe(-0.3);
    expect(filter.type).toBe('highpass');
    expect(filter.frequency.value).toBe(300);

    engine.updateTracks([
      { id: 't1', name: 'T', gain: 0.9, muted: false, solo: false, pan: -0.3, filter: { kind: 'highpass', frequency: 300 } },
    ]);
    expect(trackGain.gain.value).toBe(0.9); // unmuted -> live gain applied
  });

  it('legacy call (tracks undefined, no fades) behaves as before: clipGain=volume connected to destination', async () => {
    const { ctx, gains, panners } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await seedBuffer(ctx, engine, 'a1', 10);
    engine.start([clip({ id: 'c1', assetId: 'a1', volume: 0.8 })], undefined, 0);
    const [clipGain] = gains;
    expect(clipGain.gain.value).toBe(0.8);
    // No tracks -> default lane; the chain still terminates at ctx.destination.
    expect(panners[0].connect).toHaveBeenCalledWith(ctx.destination);
  });
});

describe('mid-play filter add/remove (structural updateTracks)', () => {
  const track: AudioTrack = { id: 't1', name: 'T', gain: 1, muted: false, solo: false };

  it('turning a filter ON mid-play splices a biquad into the live chain', async () => {
    const { ctx, panners, filters } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ trackId: 't1' })], [track], 0);
    expect(filters).toHaveLength(0); // no filter configured at start

    engine.updateTracks([{ ...track, filter: { kind: 'highpass', frequency: 800 } }]);

    expect(filters).toHaveLength(1);
    expect(filters[0].type).toBe('highpass');
    expect(filters[0].frequency.value).toBe(800);
    // Re-routed live: the pre-filter tail (panner) dropped its destination edge, now feeds the
    // filter, and the filter terminates at the destination.
    expect(panners[0].disconnect).toHaveBeenCalled();
    expect(panners[0].connect).toHaveBeenLastCalledWith(filters[0]);
    expect(filters[0].connect).toHaveBeenCalledWith(ctx.destination);
  });

  it('turning the filter OFF mid-play unsplices it (pre-tail reconnects straight to destination)', async () => {
    const { ctx, panners, filters } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ trackId: 't1' })], [{ ...track, filter: { kind: 'lowpass', frequency: 500 } }], 0);
    expect(filters).toHaveLength(1); // built with the filter in-chain

    engine.updateTracks([track]); // filter removed

    expect(filters[0].disconnect).toHaveBeenCalled();
    expect(panners[0].connect).toHaveBeenLastCalledWith(ctx.destination);
    // A later param-level update must NOT resurrect or touch the detached node.
    engine.updateTracks([track]);
    expect(filters).toHaveLength(1);
  });

  it('kind/frequency edits on an existing filter stay param-level (no new node, no re-route)', async () => {
    const { ctx, panners, filters } = makeFakeCtx();
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ trackId: 't1' })], [{ ...track, filter: { kind: 'lowpass', frequency: 500 } }], 0);
    const disconnectsBefore = (panners[0].disconnect as ReturnType<typeof vi.fn>).mock.calls.length;

    engine.updateTracks([{ ...track, filter: { kind: 'highpass', frequency: 1200 } }]);

    expect(filters).toHaveLength(1); // same node
    expect(filters[0].type).toBe('highpass');
    expect(filters[0].frequency.value).toBe(1200);
    expect((panners[0].disconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(disconnectsBefore);
  });

  it('nodes without disconnect (older Safari / minimal fakes): filter toggle defers to next start, no crash', async () => {
    const { ctx, panners, filters } = makeFakeCtx();
    for (const p of panners) delete (p as { disconnect?: unknown }).disconnect;
    const engine = createAudioEngine(ctx);
    await engine.decode('a1', new Uint8Array([1]));
    engine.start([clip({ trackId: 't1' })], [track], 0);
    delete (panners[0] as { disconnect?: unknown }).disconnect;

    expect(() => engine.updateTracks([{ ...track, filter: { kind: 'lowpass', frequency: 500 } }])).not.toThrow();
    expect(filters).toHaveLength(0); // deferred — no splice without a disconnect to re-route with
  });
});
