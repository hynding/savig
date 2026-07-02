import { createAudioTransport } from './audioTransport';
import { createProject } from '@savig/engine';
import type { AudioContextLike } from '@savig/services';

function fakeCtx() {
  const started: Array<{ when: number; offset: number; duration: number }> = [];
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
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
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
