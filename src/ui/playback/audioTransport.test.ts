import { createAudioTransport } from './audioTransport';
import { createProject } from '../../engine';
import type { AudioContextLike } from '../../services';

function fakeCtx() {
  const started: Array<{ when: number; offset: number; duration: number }> = [];
  const ctx: AudioContextLike = {
    currentTime: 0,
    destination: {},
    decodeAudioData: async () => ({ duration: 2 }),
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBufferSource: () => ({
      buffer: null,
      connect() {},
      stop() {},
      start(when, offset, duration) {
        started.push({ when, offset, duration });
      },
    }),
  };
  return { ctx, started };
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

it('does nothing when there are no clips', async () => {
  const { ctx, started } = fakeCtx();
  const transport = createAudioTransport(() => ctx);
  await transport.start(createProject(), {}, 0);
  expect(started).toHaveLength(0);
});

it('stop halts scheduled sources without throwing', async () => {
  const { ctx } = fakeCtx();
  const project = {
    ...createProject(),
    audioClips: [{ id: 'c1', assetId: 'aud', startTime: 0, inPoint: 0, outPoint: 2, volume: 1 }],
  };
  const transport = createAudioTransport(() => ctx);
  await transport.start(project, { aud: new Uint8Array([1]) }, 0);
  expect(() => transport.stop()).not.toThrow();
});
