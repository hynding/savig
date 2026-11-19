import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createKeyframe, createProject, createSceneObject } from '@savig/engine';
import { exportSpriteSheet, type SheetCanvas, type SpriteSheetExportDeps } from './spriteSheetExport';

function project1s() {
  const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 10)] } });
  const p = createProject();
  return { ...p, meta: { ...p.meta, name: 'hero', width: 100, height: 50 }, objects: [obj] };
}

function fakeDeps() {
  const draws: { svg: string; cell: { x: number; y: number; w: number; h: number } }[] = [];
  const sheets: { width: number; height: number; background: string | null }[] = [];
  const deps: Partial<SpriteSheetExportDeps> = {
    makeFrameSource: () => ({ frameSvg: (t: number) => `<svg data-t="${t}"/>` }),
    makeSheet: vi.fn((width: number, height: number, background: string | null) => {
      sheets.push({ width, height, background });
      const sheet: SheetCanvas = {
        draw: async (svg, cell) => void draws.push({ svg, cell }),
        toPng: async () => new Uint8Array([137, 80, 78, 71]),
      };
      return sheet;
    }),
  };
  return { deps, draws, sheets };
}

describe('exportSpriteSheet', () => {
  it('draws each frame into its cell and zips the PNG with its atlas', async () => {
    const { deps, draws, sheets } = fakeDeps();
    const progress: number[] = [];
    const r = await exportSpriteSheet(project1s(), { fps: 4, frameWidth: 20, columns: 2, padding: 1, background: null }, (f) => progress.push(f), new AbortController().signal, deps);
    expect(r).not.toBeNull();
    expect(r!.filename).toBe('hero-spritesheet.zip');
    expect(sheets).toEqual([{ width: 41, height: 21, background: null }]);
    expect(draws.map((d) => d.svg)).toEqual(['<svg data-t="0"/>', '<svg data-t="0.25"/>', '<svg data-t="0.5"/>', '<svg data-t="0.75"/>']);
    expect(draws[3].cell).toEqual({ x: 21, y: 11, w: 20, h: 10 });
    const files = unzipSync(r!.bytes);
    expect(Object.keys(files).sort()).toEqual(['hero.json', 'hero.png']);
    const atlas = JSON.parse(strFromU8(files['hero.json']));
    expect(Object.keys(atlas.frames)).toHaveLength(4);
    expect(atlas.meta.size).toEqual({ w: 41, h: 21 });
    expect(progress.at(-1)).toBe(1);
  });

  it('passes an opaque background through', async () => {
    const { deps, sheets } = fakeDeps();
    await exportSpriteSheet(project1s(), { fps: 1, frameWidth: 20, background: 'white' }, () => {}, new AbortController().signal, deps);
    expect(sheets[0].background).toBe('white');
  });

  it('cancel resolves null', async () => {
    const { deps, draws } = fakeDeps();
    const abort = new AbortController();
    const r = await exportSpriteSheet(project1s(), { fps: 10, frameWidth: 20, background: null }, (f) => {
      if (f > 0.2) abort.abort();
    }, abort.signal, deps);
    expect(r).toBeNull();
    expect(draws.length).toBeLessThan(10);
  });

  it('an oversize sheet is refused before any canvas is made', async () => {
    const { deps } = fakeDeps();
    await expect(exportSpriteSheet(project1s(), { fps: 60, frameWidth: 4000, background: null }, () => {}, new AbortController().signal, deps)).rejects.toThrow(/limit/);
    expect(deps.makeSheet).not.toHaveBeenCalled();
  });
});
