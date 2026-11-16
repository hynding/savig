// Image-sequence import (spec 2026-11-16-image-sequence): engine builder + core + raster.
import { describe, expect, it } from 'vitest';
import { buildImageSequence, computeProjectDuration, createProject, naturalCompare, type ImageAsset } from '@savig/engine';
import { addImageSequence } from './images';
import { validateProject } from './validate';
import { renderFrameRgba } from './node/render';

const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';
const BLUE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC';
const px = (img: { width: number; pixels: Uint8Array }, x: number, y: number) => Array.from(img.pixels.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

describe('naturalCompare', () => {
  it('counts numbers as numbers', () => {
    expect(['f10.png', 'f2.png', 'f1.png'].sort(naturalCompare)).toEqual(['f1.png', 'f2.png', 'f10.png']);
  });
});

describe('buildImageSequence', () => {
  it('makes one key per picture, held `hold` frames, every picture at the layer origin', () => {
    const img = (id: string): ImageAsset => ({ id, kind: 'image', name: id, mimeType: 'image/png', dataUrl: RED, width: 4, height: 2 });
    const { layer, objects } = buildImageSequence([img('a'), img('b'), img('a')], { fps: 10, start: 0.5, hold: 2, zOrder: 3, x: 7, y: 9, layerId: 'L' });
    expect(layer.frames!.keys.map((k) => k.time)).toEqual([0.5, 0.7, 0.9]);
    expect(layer.frames!.end).toBeCloseTo(1.1, 9);
    expect(layer.base).toMatchObject({ x: 7, y: 9 });
    expect(objects.map((o) => [o.assetId, o.frameKeyId, o.parentId])).toEqual([['a', 'L-k0', 'L'], ['b', 'L-k1', 'L'], ['a', 'L-k2', 'L']]);
    expect(objects[0]).toMatchObject({ anchorX: 2, anchorY: 1, base: { x: 0, y: 0 } });
  });
});

describe('addImageSequence', () => {
  it('flips through the pictures over time, centred on the artboard by default, and validates clean', () => {
    const { project, id } = addImageSequence(createProject({ width: 10, height: 10, fps: 10 }), { frames: [RED, BLUE], id: 'seq', hold: 3 });
    expect(project.objects.filter((o) => o.parentId === id)).toHaveLength(2);
    expect(computeProjectDuration(project)).toBeCloseTo(0.6, 9);
    expect(px(renderFrameRgba(project, 0), 5, 5)).toEqual([255, 0, 0]);
    expect(px(renderFrameRgba(project, 0.35), 5, 5)).toEqual([0, 0, 255]);
    expect(px(renderFrameRgba(project, 0.35), 1, 1)).toEqual([255, 255, 255]);
    expect(validateProject(project).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('fails loud with no frames or a bad picture', () => {
    expect(() => addImageSequence(createProject(), { frames: [] })).toThrow(/at least one frame/);
    expect(() => addImageSequence(createProject(), { frames: ['data:text/plain;base64,aGk='] })).toThrow(/image src/);
  });
});
