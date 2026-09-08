import { createAudioTransport } from './audioTransport';
import { createProject } from '@savig/engine';
import type { AudioContextLike } from '@savig/services';

function fakeCtx() {
  const started: Array<{ when: number; offset: number; duration: number }> = [];
  // Every createGain() call's param object, in creation order — lets tests inspect
  // the per-clip and per-track chain gains the engine builds (e.g. gains[1] is the
  // first clip's track chain, since the clip gain is always created first).
  const gains: Array<{ value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void }> = [];
  let stopped = 0;
  let now = 0;
  let resumes = 0;
  const ctx: AudioContextLike = {
    get currentTime() {
      return now;
    },
    resume: async () => {
      resumes += 1;
    },
    destination: {},
    decodeAudioData: async () => ({ duration: 2 }),
    createGain: () => {
      const gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} };
      gains.push(gain);
      return { gain, connect() {} };
    },
    createBufferSource: () => ({
      buffer: null,
      connect() {},
      stop() {
        stopped += 1;
      },
      start(when, offset, duration) {
        started.push({ when, offset, duration });
      },
    }),
  };
  return {
    ctx,
    started,
    gains,
    stopCount: () => stopped,
    resumeCount: () => resumes,
    setNow: (t: number) => { now = t; },
  };
}

it('decodes and schedules clips on start', async () => {
  const { ctx, started } = fakeCtx();
  const project = {
    ...createProject(),
    audioClips: [{ id: 'c1', assetId: 'aud', startTime: 0, inPoint: 0, outPoint: 2, volume: 1 }],
  };
  const binaries = { aud: new Uint8Array([1, 2, 3]) };

  const transport = createAudioTransport(() => ctx);
  await transport.start(project, binaries, 0);

  expect(started).toHaveLength(1);
  expect(started[0].duration).toBe(2);
});

it('resumes the context on start (Play-gesture, autoplay-policy guard)', async () => {
  const { ctx, resumeCount } = fakeCtx();
  const project = {
    ...createProject(),
    audioClips: [{ id: 'c1', assetId: 'aud', startTime: 0, inPoint: 0, outPoint: 2, volume: 1 }],
  };
  const transport = createAudioTransport(() => ctx);
  await transport.start(project, { aud: new Uint8Array([1]) }, 0);
  expect(resumeCount()).toBe(1);
});

it('does nothing when there are no clips', async () => {
  const { ctx, started } = fakeCtx();
  const transport = createAudioTransport(() => ctx);
  await transport.start(createProject(), {}, 0);
  expect(started).toHaveLength(0);
});

it('stop halts the scheduled sources', async () => {
  const { ctx, stopCount } = fakeCtx();
  const project = {
    ...createProject(),
    audioClips: [{ id: 'c1', assetId: 'aud', startTime: 0, inPoint: 0, outPoint: 2, volume: 1 }],
  };
  const transport = createAudioTransport(() => ctx);
  await transport.start(project, { aud: new Uint8Array([1]) }, 0);
  transport.stop();
  expect(stopCount()).toBe(1);
});

it('stop before any start is a safe no-op', () => {
  const { ctx } = fakeCtx();
  const transport = createAudioTransport(() => ctx);
  expect(() => transport.stop()).not.toThrow();
});

it('position is null before start and after stop, and tracks the ctx clock while playing', async () => {
  const { ctx, setNow } = fakeCtx();
  const project = {
    ...createProject(),
    audioClips: [{ id: 'c1', assetId: 'aud', startTime: 0, inPoint: 0, outPoint: 2, volume: 1 }],
  };
  const transport = createAudioTransport(() => ctx);
  expect(transport.position()).toBeNull();

  setNow(2); // ctx clock at the moment audio starts
  await transport.start(project, { aud: new Uint8Array([1]) }, 0.5); // playhead anchored at 0.5s
  expect(transport.position()).toBeCloseTo(0.5, 5);

  setNow(2.3); // 0.3s of audio elapsed
  expect(transport.position()).toBeCloseTo(0.8, 5);

  transport.stop();
  expect(transport.position()).toBeNull();
});

it('position is null when there are no clips (RAF stays master)', async () => {
  const { ctx } = fakeCtx();
  const transport = createAudioTransport(() => ctx);
  await transport.start(createProject(), {}, 0);
  expect(transport.position()).toBeNull();
});

// --- live mixer: updateTracks (multitrack audio) ---

it('updateTracks forwards live gain changes to the engine while active', async () => {
  const { ctx, gains } = fakeCtx();
  const project = {
    ...createProject(),
    audioClips: [{ id: 'c1', assetId: 'aud', startTime: 0, inPoint: 0, outPoint: 2, volume: 1, trackId: 't1' }],
    audioTracks: [{ id: 't1', name: 'T', gain: 0.5, muted: false, solo: false }],
  };
  const transport = createAudioTransport(() => ctx);
  await transport.start(project, { aud: new Uint8Array([1]) }, 0);
  const trackGain = gains[1]; // gains[0] = clip gain, gains[1] = the t1 track chain's input gain
  expect(trackGain.value).toBe(0.5);

  transport.updateTracks({ ...project, audioTracks: [{ ...project.audioTracks[0], gain: 0.9 }] });
  expect(trackGain.value).toBe(0.9);
});

it('updateTracks is a no-op before start() and after stop() (retained chain untouched)', async () => {
  const { ctx, gains } = fakeCtx();
  const project = {
    ...createProject(),
    audioClips: [{ id: 'c1', assetId: 'aud', startTime: 0, inPoint: 0, outPoint: 2, volume: 1, trackId: 't1' }],
    audioTracks: [{ id: 't1', name: 'T', gain: 0.5, muted: false, solo: false }],
  };
  const transport = createAudioTransport(() => ctx);

  // Before any start(): no engine/chain exists yet, and the call must be a safe no-op.
  expect(() => transport.updateTracks(project)).not.toThrow();
  expect(gains).toHaveLength(0);

  await transport.start(project, { aud: new Uint8Array([1]) }, 0);
  const trackGain = gains[1];
  expect(trackGain.value).toBe(0.5);

  transport.stop();
  // After stop(): `active` is false, so a live mixer edit must NOT reach the
  // still-retained chain (guards against updating gains on stopped audio).
  transport.updateTracks({ ...project, audioTracks: [{ ...project.audioTracks[0], gain: 0.9 }] });
  expect(trackGain.value).toBe(0.5);
});
