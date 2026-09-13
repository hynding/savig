import { describe, expect, it, vi } from 'vitest';
import { createProject } from '@savig/engine';
import { renderMasterMix, type OfflineCtxLike } from './renderMix';

function fakeOfflineCtx(captured: { started: number; decoded: string[] }) {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const rendered = {
    numberOfChannels: 2,
    getChannelData: (c: number) => new Float32Array([c === 0 ? 0.5 : -0.5]),
  };
  const ctx: OfflineCtxLike = {
    currentTime: 0,
    destination: {},
    sampleRate: 44100,
    decodeAudioData: vi.fn(async () => {
      captured.decoded.push('x');
      return { duration: 1 };
    }),
    createGain: () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => ({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(() => {
        captured.started += 1;
      }),
      stop: vi.fn(),
    }),
    createStereoPanner: () => ({ pan: param(), connect: vi.fn(), disconnect: vi.fn() }),
    startRendering: vi.fn(async () => rendered),
  };
  return ctx;
}

function projectWithClip() {
  const p = createProject();
  return {
    ...p,
    assets: [{ id: 'au', kind: 'audio' as const, name: 'a.wav', mimeType: 'audio/wav', duration: 1 }],
    audioClips: [{ id: 'c1', assetId: 'au', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 }],
  };
}

describe('renderMasterMix', () => {
  it('decodes each audio asset, schedules clips from 0, and returns the rendered channels', async () => {
    const captured = { started: 0, decoded: [] as string[] };
    const mix = await renderMasterMix(projectWithClip(), { au: new Uint8Array([1, 2]) }, () => fakeOfflineCtx(captured));
    expect(captured.decoded).toHaveLength(1);
    expect(captured.started).toBe(1);
    expect(mix).not.toBeNull();
    expect(mix!.sampleRate).toBe(44100);
    expect(mix!.channels).toHaveLength(2);
    expect(mix!.channels[0][0]).toBeCloseTo(0.5, 6);
  });

  it('returns null when the project has no audio clips (spec §5: no silent track)', async () => {
    const mix = await renderMasterMix(createProject(), {}, () => {
      throw new Error('must not construct a context');
    });
    expect(mix).toBeNull();
  });

  it('skips clips whose bytes are missing from binaries (matches live playback) and still renders', async () => {
    const captured = { started: 0, decoded: [] as string[] };
    const mix = await renderMasterMix(projectWithClip(), {}, () => fakeOfflineCtx(captured));
    expect(captured.decoded).toHaveLength(0);
    expect(captured.started).toBe(0);
    expect(mix).not.toBeNull(); // rendered silence is fine; the orchestrator still muxes it
  });
});
