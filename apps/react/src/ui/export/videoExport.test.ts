import { describe, expect, it, vi } from 'vitest';
import { createProject, createSceneObject, createKeyframe } from '@savig/engine';
import { segmentEncodeArgs, concatMuxArgs, concatListText, singlePassArgs, singlePassMuxArgs } from '@savig/services';
import { exportVideo, type VideoExportDeps, type VideoPhase } from './videoExport';

const svgAsset = {
  id: 'a', kind: 'svg' as const, name: 'box', viewBox: '0 0 10 10', width: 10, height: 10,
  normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
};

/** 3s project at the test fps of 2 -> 6 frames -> segments of 4,2 (SEGMENT_SECONDS=2). */
function projectWith3s() {
  const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(3, 10)] } });
  return { ...createProject(), assets: [svgAsset], objects: [obj] };
}

function fakeDeps() {
  const calls: { execs: string[][]; writes: string[]; deletes: string[]; makeFfmpeg: number } = { execs: [], writes: [], deletes: [], makeFfmpeg: 0 };
  const ffmpeg = {
    writeFile: vi.fn(async (name: string) => {
      calls.writes.push(name);
    }),
    exec: vi.fn(async (args: string[], onProgress?: (p: number) => void) => {
      calls.execs.push(args);
      onProgress?.(1);
    }),
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    deleteFile: vi.fn(async (name: string) => {
      calls.deletes.push(name);
    }),
    terminate: vi.fn(),
  };
  const deps: Partial<VideoExportDeps> = {
    makeFfmpeg: async () => {
      calls.makeFfmpeg++;
      return ffmpeg;
    },
    makeFrameSource: () => ({ frameSvg: (t: number) => `<svg data-t="${t}"/>` }),
    rasterize: vi.fn(async () => new Blob([new Uint8Array([9])], { type: 'image/jpeg' })),
    renderMix: vi.fn(async () => ({ channels: [new Float32Array([0])], sampleRate: 44100 })),
  };
  return { calls, ffmpeg, deps };
}

const opts = { format: 'mp4' as const, fps: 2, width: 100 };

describe('exportVideo', () => {
  it('runs frames -> audio -> per-segment encode (deleting each segment) -> concat mux -> result', async () => {
    const { calls, deps } = fakeDeps();
    const phases: VideoPhase[] = [];
    const result = await exportVideo(projectWith3s(), {}, opts, (phase) => {
      if (phases.at(-1) !== phase) phases.push(phase);
    }, new AbortController().signal, deps);

    // Wall-clock order: audio renders first (one offline pass), then frames/encode interleave
    // per segment, then finalize. Assert the truthful shape, not a fake linear sequence.
    expect(phases[0]).toBe('audio');
    expect(phases).toContain('frames');
    expect(phases).toContain('encode');
    expect(phases.at(-1)).toBe('finalize');
    const spec = { format: 'mp4' as const, fps: 2, frameCount: 6, hasAudio: true };
    // Two segments (4 + 2 frames) with the exact shared argv, then the exact mux argv.
    expect(calls.execs).toEqual([
      segmentEncodeArgs(spec, { index: 0, frames: 4 }),
      segmentEncodeArgs(spec, { index: 1, frames: 2 }),
      concatMuxArgs(spec),
    ]);
    // Every segment's frames were deleted before the next segment ran.
    expect(calls.deletes.filter((n) => n.startsWith('frame'))).toHaveLength(6);
    expect(calls.writes).toContain('mix.wav');
    expect(calls.writes).toContain('list.txt');
    expect(result).toEqual({ bytes: new Uint8Array([1, 2, 3, 4]), filename: `${createProject().meta.name}.mp4`, mime: 'video/mp4' });
  });

  it('writes the concat list with the shared concatListText', async () => {
    const { calls, deps, ffmpeg } = fakeDeps();
    const listBodies: string[] = [];
    (ffmpeg.writeFile as ReturnType<typeof vi.fn>).mockImplementation(async (name: string, data: Uint8Array) => {
      calls.writes.push(name);
      if (name === 'list.txt') listBodies.push(new TextDecoder().decode(data));
    });
    await exportVideo(projectWith3s(), {}, opts, () => {}, new AbortController().signal, deps);
    expect(listBodies).toEqual([concatListText({ format: 'mp4', fps: 2, frameCount: 6, hasAudio: true })]);
  });

  it('no-audio project: renderMix null -> hasAudio false argv, no mix.wav write', async () => {
    const { calls, deps } = fakeDeps();
    (deps.renderMix as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await exportVideo(projectWith3s(), {}, opts, () => {}, new AbortController().signal, deps);
    expect(calls.writes).not.toContain('mix.wav');
    expect(calls.execs.at(-1)).toEqual(concatMuxArgs({ format: 'mp4', fps: 2, frameCount: 6, hasAudio: false }));
  });

  it('cancel during the frame phase: resolves null, terminates ffmpeg, never saves', async () => {
    const { deps, ffmpeg } = fakeDeps();
    const abort = new AbortController();
    (deps.rasterize as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      abort.abort(); // cancel fires mid-frame-loop
      return new Blob([new Uint8Array([9])], { type: 'image/jpeg' });
    });
    const result = await exportVideo(projectWith3s(), {}, opts, () => {}, abort.signal, deps);
    expect(result).toBeNull();
    expect(ffmpeg.terminate).toHaveBeenCalled();
    expect(ffmpeg.exec).not.toHaveBeenCalled();
  });

  it('a 0-duration project throws "nothing to export"', async () => {
    const { deps } = fakeDeps();
    await expect(
      exportVideo(createProject(), {}, opts, () => {}, new AbortController().signal, deps),
    ).rejects.toThrow(/nothing to export/i);
  });

  it('webm with audio routes SINGLE-PASS video-only encode (ruling) THEN a vp9-free stream-copy mux exec — never mixes audio into the vp9 exec itself', async () => {
    const { calls, deps } = fakeDeps();
    await exportVideo(projectWith3s(), {}, { ...opts, format: 'webm' }, () => {}, new AbortController().signal, deps);
    const spec = { format: 'webm' as const, fps: 2, frameCount: 6, hasAudio: true };
    expect(calls.execs).toEqual([singlePassArgs(spec), singlePassMuxArgs(spec)]);
    expect(calls.writes).not.toContain('list.txt');
    expect(calls.writes.filter((n) => n.startsWith('frame'))).toHaveLength(6); // global 0..5
  });

  it('webm without audio: ONE exec only (no second mux pass needed), straight to out.webm', async () => {
    const { calls, deps } = fakeDeps();
    (deps.renderMix as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await exportVideo(projectWith3s(), {}, { ...opts, format: 'webm' }, () => {}, new AbortController().signal, deps);
    const spec = { format: 'webm' as const, fps: 2, frameCount: 6, hasAudio: false };
    expect(calls.execs).toEqual([singlePassArgs(spec)]);
  });

  it('webm beyond WEBM_MAX_FRAMES throws the capped-export error before any ffmpeg work', async () => {
    const { calls, deps } = fakeDeps();
    const longOpts = { format: 'webm' as const, fps: 60, width: 100 };
    const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(31, 10)] } }); // 31s x 60fps = 1860 > 1800
    const longProject = { ...createProject(), assets: [svgAsset], objects: [obj] };
    await expect(
      exportVideo(longProject, {}, longOpts, () => {}, new AbortController().signal, deps),
    ).rejects.toThrow(/capped at 1800 frames/i);
    expect(calls.execs).toHaveLength(0);
    expect(calls.writes).toHaveLength(0); // no mix.wav, no frames — the cap fires FIRST
    expect(calls.makeFfmpeg).toBe(0); // the wasm core is never even loaded
  });

  it('progress is monotonically non-decreasing across the whole run', async () => {
    const { deps } = fakeDeps();
    const fractions: number[] = [];
    await exportVideo(projectWith3s(), {}, opts, (_phase, f) => fractions.push(f), new AbortController().signal, deps);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    expect(fractions.at(-1)).toBe(1);
  });
});
