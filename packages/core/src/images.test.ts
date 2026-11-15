// Bitmap import slice 3 (spec 2026-11-15-bitmap-import): core builders, DSL, describe, validate.
import { describe, expect, it } from 'vitest';
import { createProject, type ImageAsset } from '@savig/engine';
import { base64ToBytes } from '@savig/services';
import { addImage, setGuide } from './images';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { describeProject } from './describe';
import { validateProject } from './validate';
import { createMask } from './masks';
import { addRect } from './build';
import { renderFrameRgba } from './node/render';

const RED_2X2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';
const px = (img: { width: number; pixels: Uint8Array }, x: number, y: number) => Array.from(img.pixels.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

describe('addImage', () => {
  it('places the natural size at (x, y) with a centre pivot; asset id is <id>-asset', () => {
    const { project, id } = addImage(createProject(), { src: RED_2X2, x: 5, y: 7, id: 'pic', name: 'Dot' });
    const a = project.assets[0] as ImageAsset;
    expect(a).toMatchObject({ id: 'pic-asset', kind: 'image', width: 2, height: 2, mimeType: 'image/png', name: 'Dot' });
    expect(project.objects[0]).toMatchObject({ id, anchorX: 1, anchorY: 1, base: { x: 5, y: 7, scaleX: 1, scaleY: 1 } });
  });

  it('width/height scale the box so its top-left stays at (x, y) — checked by raster', () => {
    const p0 = createProject({ width: 100, height: 100 });
    const { project } = addImage(p0, { src: RED_2X2, x: 20, y: 30, width: 50, height: 40 });
    const img = renderFrameRgba(project, 0);
    expect(px(img, 21, 31)).toEqual([255, 0, 0]);
    expect(px(img, 68, 68)).toEqual([255, 0, 0]);
    expect(px(img, 18, 50)).toEqual([255, 255, 255]);
    expect(px(img, 72, 50)).toEqual([255, 255, 255]);
    expect(px(img, 40, 72)).toEqual([255, 255, 255]);
  });

  it('one dimension keeps the aspect ratio; raw bytes work too; bad input fails loud', () => {
    const { project } = addImage(createProject(), { src: base64ToBytes(RED_2X2.split(',')[1]), x: 0, y: 0, width: 10 });
    expect(project.objects[0].base).toMatchObject({ scaleX: 5, scaleY: 5 });
    expect(() => addImage(createProject(), { src: 'data:image/svg+xml;base64,PHN2Zz4=', x: 0, y: 0 })).toThrow(/data:image/);
    expect(() => addImage(createProject(), { src: 'data:image/png;base64,AAAA', x: 0, y: 0 })).toThrow(/readable/);
    expect(() => addImage(createProject(), { src: RED_2X2, x: 0, y: 0, width: -1 })).toThrow(/positive/);
  });
});

describe('guides in core', () => {
  it('setGuide toggles; validate warns when a guide is used as a mask; describe marks it', () => {
    let p = addRect(createProject(), { id: 'card', x: 0, y: 0, width: 10, height: 10 }).project;
    p = addRect(p, { id: 'm', x: 0, y: 0, width: 5, height: 5 }).project;
    p = createMask(p, 'm', ['card']);
    p = setGuide(p, ['m']);
    expect(validateProject(p).map((i) => i.code)).toContain('mask-is-guide');
    expect(describeProject(p)).toContain('GUIDE (editor only, not exported)');
    p = setGuide(p, ['m'], false);
    expect(validateProject(p).map((i) => i.code)).not.toContain('mask-is-guide');
    expect(() => setGuide(p, ['nope'])).toThrow(/no object/);
  });

  it('validate flags an image asset without a safe data URL', () => {
    const { project } = addImage(createProject(), { src: RED_2X2, x: 0, y: 0, id: 'pic' });
    (project.assets[0] as ImageAsset).dataUrl = 'https://example.com/a.png';
    expect(validateProject(project).find((i) => i.code === 'image-bad-src')?.severity).toBe('error');
  });
});

describe('DSL images', () => {
  it('compiles image objects (with guide) and round-trips through decompile', () => {
    const doc: ShortDoc = {
      meta: { width: 200, height: 100, fps: 24 },
      objects: [
        { type: 'image', id: 'bg', src: RED_2X2, x: 0, y: 0, width: 200, height: 100, animate: { opacity: [{ t: 0, value: 0 }, { t: 1, value: 1 }] } },
        { type: 'image', id: 'ref', src: RED_2X2, x: 30, y: 40, guide: true, base: { rotation: 15 } },
        { type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, guide: true },
      ],
    };
    const p = compileShort(doc);
    expect(p.objects.find((o) => o.id === 'ref')?.guide).toBe(true);
    expect(p.objects.find((o) => o.id === 'r')?.guide).toBe(true);
    const back = decompileProject(p);
    const bg = back.objects!.find((o) => o.id === 'bg')!;
    expect(bg).toMatchObject({ type: 'image', src: RED_2X2, x: 0, y: 0, width: 200, height: 100 });
    expect(back.objects!.find((o) => o.id === 'ref')).toMatchObject({ type: 'image', x: 30, y: 40, guide: true, base: { rotation: 15 } });
    expect(compileShort(back)).toEqual(p);
  });

  it('refuses trim on an image', () => {
    expect(() => compileShort({ objects: [{ type: 'image', src: RED_2X2, x: 0, y: 0, trim: { end: 0.5 } }] } as ShortDoc)).toThrow(/trim/);
  });
});
