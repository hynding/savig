// Trace Bitmap for agents (spec 2026-11-18-trace-bitmap, slice 2).
import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { createProject, createSceneObject } from '@savig/engine';
import type { ImageAsset, VectorAsset } from '@savig/engine';
import { decodeImageAsset, traceImageObject } from './trace';

/** A 40×30 PNG: red field, blue disc in the middle. */
function badgeAsset(): ImageAsset {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#e61e1e"/><circle cx="20" cy="15" r="9" fill="#1428dc"/></svg>';
  const pngBytes = new Resvg(svg).render().asPng();
  return { id: 'img', kind: 'image', name: 'badge', mimeType: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`, width: 40, height: 30 };
}

function scene() {
  const p = createProject();
  p.assets.push(badgeAsset());
  p.objects.push(createSceneObject('img', { id: 'pic', name: 'badge', anchorX: 20, anchorY: 15 }));
  return p;
}

describe('decodeImageAsset', () => {
  it('decodes a PNG to RGBA at its size, or scaled to fit', () => {
    const r = decodeImageAsset(badgeAsset());
    expect([r.width, r.height]).toEqual([40, 30]);
    expect(Array.from(r.data).slice(0, 4)).toEqual([0xe6, 0x1e, 0x1e, 255]);
    const small = decodeImageAsset(badgeAsset(), 20);
    expect([small.width, small.height]).toEqual([20, 15]);
  });
});

describe('traceImageObject', () => {
  it('turns the picture into a same-id group with one shape per color', () => {
    const p = traceImageObject(scene(), 'pic', { colors: 2 });
    const g = p.objects.find((o) => o.id === 'pic')!;
    expect(g.isGroup).toBe(true);
    const fills = p.objects
      .filter((o) => o.parentId === 'pic')
      .map((o) => (p.assets.find((a) => a.id === o.assetId) as VectorAsset).style.fill);
    // Largest first: the red field, then the disc (means shift slightly with the anti-aliased rim).
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const near = (h: string, want: number[]) => rgb(h).every((v, i) => Math.abs(v - want[i]) <= 12);
    expect(fills).toHaveLength(2);
    expect(near(fills[0], [0xe6, 0x1e, 0x1e])).toBe(true);
    expect(near(fills[1], [0x14, 0x28, 0xdc])).toBe(true);
  });

  it('fails loud', () => {
    expect(() => traceImageObject(scene(), 'nope')).toThrow(/no object/);
    expect(() => traceImageObject(scene(), 'pic', { colors: 1 })).toThrow(/colors/);
    const p = scene();
    p.objects.push(createSceneObject('img', { id: 'g', isGroup: true }));
    expect(() => traceImageObject(p, 'g')).toThrow(/not an imported picture/);
  });
});
