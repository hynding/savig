// Trace Bitmap (spec 2026-11-18-trace-bitmap).
import { describe, expect, it } from 'vitest';
import { applyTrace, traceBitmap, type RasterImage } from './trace';
import { createProject, createSceneObject, createVectorAsset } from '../project';
import type { VectorAsset } from '../types';
import { pathBounds } from '../path';
import { flattenPath } from './arcLength';

type RGBA = [number, number, number, number];
function raster(W: number, H: number, paint: (x: number, y: number) => RGBA): RasterImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(paint(x, y), (y * W + x) * 4);
  return { width: W, height: H, data };
}
const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

/** Even-odd point-in-path over the flattened loops. */
function inside(loops: { x: number; y: number }[][], px: number, py: number): boolean {
  let c = false;
  for (const pts of loops) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  }
  return c;
}

describe('traceBitmap', () => {
  it('a solid square on transparency becomes one 4-corner region at its pixel edges', () => {
    const img = raster(20, 20, (x, y) => (x >= 5 && x < 15 && y >= 4 && y < 12 ? RED : CLEAR));
    const r = traceBitmap(img);
    expect(r).toHaveLength(1);
    expect(r[0].color).toBe('#ff0000');
    expect(r[0].rings).toHaveLength(0);
    expect(r[0].path.nodes).toHaveLength(4);
    expect(pathBounds(r[0].path)).toEqual({ x: 5, y: 4, width: 10, height: 8 });
  });

  it('a ring keeps its hole (evenodd) and the inner color is its own region', () => {
    const img = raster(30, 30, (x, y) => {
      const d = Math.hypot(x + 0.5 - 15, y + 0.5 - 15);
      return d < 6 ? BLUE : d < 12 ? RED : CLEAR;
    });
    const r = traceBitmap(img, { colors: 2 });
    const red = r.find((g) => g.color === '#ff0000')!;
    const blue = r.find((g) => g.color === '#0000ff')!;
    expect(red.rings).toHaveLength(1);
    const loops = [red.path, ...red.rings].map((p) => flattenPath(p).pts);
    expect(inside(loops, 15, 15)).toBe(false); // the hole
    expect(inside(loops, 15, 6)).toBe(true); // the ring
    const blueLoops = [blue.path].map((p) => flattenPath(p).pts);
    expect(inside(blueLoops, 15, 15)).toBe(true);
    // Round shapes come out as curves.
    expect(red.path.nodes.some((n) => n.in || n.out)).toBe(true);
    // Largest first.
    expect(r[0]).toBe(red);
  });

  it('quantizes noise down to the requested color count and drops specks', () => {
    const img = raster(40, 20, (x, y) => {
      const base: RGBA = x < 20 ? [200, 30, 30, 255] : [30, 30, 200, 255];
      const jitter = ((x * 7 + y * 13) % 11) - 5;
      const speck = x === 10 && y === 10;
      return speck ? [30, 200, 30, 255] : [base[0] + jitter, base[1] + jitter, base[2] + jitter, 255];
    });
    const r = traceBitmap(img, { colors: 3, minArea: 4 });
    expect(r).toHaveLength(2);
    expect(r.every((g) => g.rings.length === 0)).toBe(true);
  });

  it('pixels mode keeps the staircase as straight segments; pixelSize scales the output', () => {
    const img = raster(10, 10, (x, y) => (x + y < 10 ? RED : CLEAR));
    const r = traceBitmap(img, { curveFit: 'pixels', pixelSize: 2 });
    expect(r[0].path.nodes.every((n) => !n.in && !n.out)).toBe(true);
    expect(pathBounds(r[0].path)).toMatchObject({ x: 0, y: 0, width: 20, height: 20 });
  });

  it('diagonally touching pixels trace as closed loops', () => {
    const img = raster(4, 4, (x, y) => ((x + y) % 2 === 0 ? RED : BLUE));
    const r = traceBitmap(img, { colors: 2, minArea: 0, curveFit: 'pixels' });
    expect(r).toHaveLength(2);
    for (const g of r) for (const p of [g.path, ...g.rings]) expect(p.closed).toBe(true);
  });

  it('empty or fully transparent input gives nothing', () => {
    expect(traceBitmap({ width: 0, height: 0, data: [] })).toEqual([]);
    expect(traceBitmap(raster(5, 5, () => CLEAR))).toEqual([]);
  });
});

describe('applyTrace', () => {
  function scene() {
    const p = createProject();
    p.assets.push({ id: 'img', kind: 'image', name: 'logo', mimeType: 'image/png', dataUrl: 'data:image/png;base64,', width: 20, height: 20 });
    p.assets.push(createVectorAsset('rect', { id: 'va' }));
    p.objects.push(createSceneObject('va', { id: 'below', zOrder: 0 }));
    p.objects.push(
      createSceneObject('img', {
        id: 'pic',
        name: 'logo',
        zOrder: 1,
        anchorX: 10,
        anchorY: 10,
        base: { x: 100, y: 50, scaleX: 2, scaleY: 2, rotation: 30, opacity: 0.5 },
        tracks: { x: [{ time: 0, value: 100, easing: 'linear' }, { time: 1, value: 200, easing: 'linear' }] },
      }),
    );
    p.objects.push(createSceneObject('va', { id: 'above', zOrder: 2 }));
    return p;
  }
  const regions = traceBitmap(raster(20, 20, (x, y) => (x < 10 ? RED : y < 10 ? BLUE : CLEAR)), { curveFit: 'pixels' });

  it('swaps the image for a same-id group of filled drawings in its stacking slot', () => {
    const p = scene();
    const r = applyTrace(p.objects, p.assets, 'pic', regions);
    if ('refused' in r) throw new Error(r.refused);
    const g = r.objects.find((o) => o.id === 'pic')!;
    expect(g.isGroup).toBe(true);
    expect(g.name).toBe('Traced logo');
    expect(g.base).toEqual(p.objects[1].base);
    expect(g.tracks.x).toHaveLength(2);
    expect([g.anchorX, g.anchorY]).toEqual([10, 10]);
    const kids = r.objects.filter((o) => o.parentId === 'pic');
    expect(kids).toHaveLength(2);
    const z = (id: string) => r.objects.find((o) => o.id === id)!.zOrder;
    for (const k of kids) {
      expect(k.zOrder).toBeGreaterThan(z('below'));
      expect(k.zOrder).toBeLessThan(z('above'));
    }
    const fills = kids.map((k) => (r.assets.find((a) => a.id === k.assetId) as VectorAsset).style.fill);
    expect(fills.sort()).toEqual(['#0000ff', '#ff0000']);
    expect(r.assets.some((a) => a.id === 'img')).toBe(true);
  });

  it('refuses a non-image, a locked image, and an empty trace', () => {
    const p = scene();
    expect(applyTrace(p.objects, p.assets, 'below', regions)).toEqual({ refused: 'not-an-image' });
    expect(applyTrace(p.objects, p.assets, 'pic', [])).toEqual({ refused: 'empty' });
    const locked = p.objects.map((o) => (o.id === 'pic' ? { ...o, locked: true } : o));
    expect(applyTrace(locked, p.assets, 'pic', regions)).toEqual({ refused: 'locked' });
  });
});
