import { describe, it, expect } from 'vitest';
import { symbolThumbnailSvg } from './symbolThumbnail';
import { createProject, createSymbolAsset, createSceneObject, createVectorAsset } from '../../../engine';
import type { PathData } from '../../../engine';

const square = (off: number): PathData => ({
  closed: true,
  nodes: [
    { anchor: { x: off, y: off } },
    { anchor: { x: off + 10, y: off } },
    { anchor: { x: off + 10, y: off + 10 } },
    { anchor: { x: off, y: off + 10 } },
  ],
});

describe('symbolThumbnailSvg (47d)', () => {
  it('frames the symbol content with a content-AABB viewBox', () => {
    const meta = createProject().meta;
    const pathAsset = createVectorAsset('path', { id: 'pa-asset', path: square(100) }); // 100..110
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('pa-asset', { id: 'pa' })], width: 10, height: 10 });
    const svg = symbolThumbnailSvg(sym, [pathAsset, sym], meta)!;
    expect(svg).toContain('viewBox="100 100 10 10"');
    expect(svg).toContain('<svg');
  });

  it('returns null for an empty symbol (placeholder)', () => {
    const meta = createProject().meta;
    const sym = createSymbolAsset({ id: 'sym', objects: [], width: 0, height: 0 });
    expect(symbolThumbnailSvg(sym, [sym], meta)).toBeNull();
  });
});
