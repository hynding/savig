import { describe, expect, it, vi } from 'vitest';
import { createKeyframe, createProject, createSceneObject } from '@savig/engine';
import { GIF_MAX_FPS, exportGif, gifFramePlan, type GifExportDeps } from './gifExport';

const svgAsset = {
  id: 'a', kind: 'svg' as const, name: 'box', viewBox: '0 0 10 10', width: 10, height: 10,
  normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
};

/** A 1s project (x animates 0 -> 10). */
function project1s() {
  const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 10)] } });
  return { ...createProject(), assets: [svgAsset], objects: [obj] };
}

/** Solid-colour RGBA frames whose red channel steps per call, so frames differ. */
function fakeDeps() {
  const times: number[] = [];
  let n = 0;
  const deps: Partial<GifExportDeps> = {
    makeFrameSource: () => ({ frameSvg: (t: number) => {
      times.push(t);
      return `<svg data-t="${t}"/>`;
    } }),
    rasterizeRgba: vi.fn(async (_svg: string, width: number, height: number) => {
      const pixels = new Uint8Array(width * height * 4);
      const r = (n++ * 40) % 256;
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = r;
        pixels[i + 1] = 128;
        pixels[i + 2] = 255 - r;
        pixels[i + 3] = 255;
      }
      return { width, height, pixels };
    }),
  };
  return { deps, times };
}

const ascii = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
/** Graphic Control Extension blocks (21 F9 04) = one per frame. */
const countFrames = (b: Uint8Array) => {
  let k = 0;
  for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) k++;
  return k;
};

describe('gifFramePlan', () => {
  it('clamps fps to whole numbers in 1..50 and width to 16..1920, keeping the aspect ratio', () => {
    const p = project1s();
    const plan = gifFramePlan(p, { fps: 60, width: 5000 });
    expect(plan.fps).toBe(GIF_MAX_FPS);
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(Math.round((1920 * p.meta.height) / p.meta.width));
    expect(plan.frameCount).toBe(50);
    expect(gifFramePlan(p, { fps: 0.2, width: 4 })).toMatchObject({ fps: 1, width: 16, frameCount: 1 });
  });

  it('falls back to the project fps/width for a cleared (NaN) field', () => {
    const p = project1s();
    expect(gifFramePlan(p, { fps: NaN, width: NaN })).toMatchObject({ fps: Math.min(50, p.meta.fps), width: p.meta.width });
  });
});

describe('exportGif', () => {
  it('encodes one frame per tick at i/fps into a looping GIF89a', async () => {
    const { deps, times } = fakeDeps();
    const progress: number[] = [];
    const r = await exportGif(project1s(), { fps: 4, width: 40, loop: true }, (f) => progress.push(f), new AbortController().signal, deps);
    expect(r).not.toBeNull();
    expect(r!.mime).toBe('image/gif');
    expect(r!.filename.endsWith('.gif')).toBe(true);
    expect(ascii(r!.bytes.subarray(0, 6))).toBe('GIF89a');
    expect(r!.bytes.at(-1)).toBe(0x3b); // trailer
    expect(ascii(r!.bytes)).toContain('NETSCAPE2.0');
    expect(countFrames(r!.bytes)).toBe(4);
    expect(times).toEqual([0, 0.25, 0.5, 0.75]);
    // Logical screen size = the requested width x aspect height.
    expect(r!.bytes[6] | (r!.bytes[7] << 8)).toBe(40);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('play-once omits the NETSCAPE loop block', async () => {
    const { deps } = fakeDeps();
    const r = await exportGif(project1s(), { fps: 2, width: 20, loop: false }, () => {}, new AbortController().signal, deps);
    expect(ascii(r!.bytes)).not.toContain('NETSCAPE2.0');
    expect(countFrames(r!.bytes)).toBe(2);
  });

  it('writes the frame delay in centiseconds (10 fps -> 10 cs)', async () => {
    const { deps } = fakeDeps();
    const r = await exportGif(project1s(), { fps: 10, width: 20, loop: true }, () => {}, new AbortController().signal, deps);
    const b = r!.bytes;
    const i = b.findIndex((v, k) => v === 0x21 && b[k + 1] === 0xf9 && b[k + 2] === 0x04);
    expect(b[i + 4] | (b[i + 5] << 8)).toBe(10);
  });

  it('cancel resolves null and stops rendering frames', async () => {
    const { deps } = fakeDeps();
    const abort = new AbortController();
    const r = await exportGif(project1s(), { fps: 10, width: 20, loop: true }, (f) => {
      if (f >= 0.3) abort.abort();
    }, abort.signal, deps);
    expect(r).toBeNull();
    expect((deps.rasterizeRgba as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThan(10);
  });

  it('rejects a zero-duration project before rendering anything', async () => {
    const { deps } = fakeDeps();
    await expect(exportGif(createProject(), { fps: 10, width: 20, loop: true }, () => {}, new AbortController().signal, deps)).rejects.toThrow(/zero duration/);
    expect(deps.rasterizeRgba).not.toHaveBeenCalled();
  });
});
