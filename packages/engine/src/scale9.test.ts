import { describe, expect, test } from 'vitest';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from './project';
import { flattenInstances } from './symbol';
import {
  defaultScale9,
  mapScale9,
  normalizeScale9,
  sanitizeScale9,
  scale9Axis,
  scale9Cells,
  scale9Of,
  stripScale9Cell,
} from './scale9';
import type { Project, SceneObject } from './types';

describe('scale9Axis', () => {
  test('outer spans keep their size; the middle takes the difference', () => {
    // A 100-wide box, guides at 20 and 80, stretched 2x -> 200 wide.
    const ax = scale9Axis(0, 100, 20, 80, 2);
    expect(mapScale9(ax, 0)).toBe(0);
    expect(mapScale9(ax, 20)).toBe(20);
    expect(mapScale9(ax, 80)).toBe(180);
    expect(mapScale9(ax, 100)).toBe(200);
    expect(mapScale9(ax, 50)).toBeCloseTo(100, 9);
    expect(mapScale9(ax, -10)).toBe(-10); // outside the box: moves with its span
  });

  test('a box away from the origin maps like ordinary scaling about 0', () => {
    // Box [150, 250], guides 170 / 230, stretched 2x -> [300, 500].
    const ax = scale9Axis(150, 100, 170, 230, 2);
    expect(mapScale9(ax, 150)).toBeCloseTo(300, 9);
    expect(mapScale9(ax, 170)).toBeCloseTo(320, 9);
    expect(mapScale9(ax, 230)).toBeCloseTo(480, 9);
    expect(mapScale9(ax, 250)).toBeCloseTo(500, 9);
  });

  test('at scale 1 the mapping is the identity', () => {
    const ax = scale9Axis(0, 100, 20, 80, 1);
    for (const p of [-5, 0, 10, 20, 55, 80, 99, 120]) expect(mapScale9(ax, p)).toBeCloseTo(p, 9);
  });

  test('shrinking below the corners squeezes them evenly; the middle vanishes', () => {
    const ax = scale9Axis(0, 100, 20, 80, 0.2); // target 20 < outer 40
    expect(mapScale9(ax, 20)).toBeCloseTo(10, 9);
    expect(mapScale9(ax, 80)).toBeCloseTo(10, 9);
    expect(mapScale9(ax, 100)).toBeCloseTo(20, 9);
    const shrink = scale9Axis(0, 100, 20, 80, 0.5); // target 50: corners intact, middle 10
    expect(mapScale9(shrink, 80) - mapScale9(shrink, 20)).toBeCloseTo(10, 9);
  });
});

describe('grids', () => {
  test('normalize clamps insets and keeps a middle', () => {
    expect(normalizeScale9({ left: -5, top: 10, right: 20, bottom: Number.NaN }, 100, 50)).toEqual({ left: 0, top: 10, right: 20, bottom: 0, x: 0, y: 0, width: 100, height: 50 });
    expect(normalizeScale9({ left: 1, top: 1, right: 1, bottom: 1, x: 5, y: 6, width: 30, height: 40 }, 100, 50)).toMatchObject({ x: 5, y: 6, width: 30, height: 40 });
    const squeezed = normalizeScale9({ left: 80, right: 80, top: 0, bottom: 0 }, 100, 50)!;
    expect(squeezed.left + squeezed.right).toBeCloseTo(99, 9);
    expect(normalizeScale9({}, 0.5, 50)).toBeUndefined();
    expect(defaultScale9({ x: 0, y: 0, width: 100, height: 40 })).toEqual({ left: 10, top: 10, right: 10, bottom: 10, x: 0, y: 0, width: 100, height: 40 });
  });

  test('nine cells: corners only translate, edges stretch one way, the middle both', () => {
    const cells = scale9Cells(normalizeScale9({ left: 20, top: 10, right: 20, bottom: 10 }, 100, 40)!, 2, 3);
    expect(cells).toHaveLength(9);
    const scaleOf = (i: number) => [cells[i]!.matrix[0], cells[i]!.matrix[3]];
    expect(scaleOf(0)).toEqual([1, 1]);
    expect(scaleOf(8)).toEqual([1, 1]);
    expect(scaleOf(1)).toEqual([(200 - 40) / 60, 1]);
    expect(scaleOf(3)).toEqual([1, (120 - 20) / 20]);
    expect(scaleOf(4)).toEqual([(200 - 40) / 60, 5]);
    // The bottom-right corner lands at the stretched box's corner.
    const [, , , , e, f] = cells[8]!.matrix;
    expect(100 + e).toBe(200);
    expect(40 + f).toBe(120);
  });

  test('sanitize drops broken grids and normalizes the rest', () => {
    const p = createProject();
    const good = createSymbolAsset({ id: 'g', width: 100, height: 100, scale9: { left: 10, top: 10, right: 10, bottom: 10 } });
    const bad = createSymbolAsset({ id: 'b', width: 0, height: 0, scale9: { left: 1, top: 1, right: 1, bottom: 1 } });
    const neg = createSymbolAsset({ id: 'n', width: 100, height: 100, scale9: { left: -3, top: 10, right: 10, bottom: 10 } });
    const out = sanitizeScale9({ ...p, assets: [good, bad, neg] });
    expect(out.assets[0]).toBe(good);
    expect('scale9' in out.assets[1]!).toBe(false);
    expect((out.assets[2] as typeof neg).scale9!.left).toBe(0);
    expect(sanitizeScale9(p)).toBe(p);
  });

  test('stripScale9Cell', () => {
    expect(stripScale9Cell('inst~4')).toBe('inst');
    expect(stripScale9Cell('inst')).toBe('inst');
    expect(stripScale9Cell('a~b')).toBe('a~b');
  });
});

/** A 100x40 panel symbol holding one rect, and an instance scaled (sx, sy). */
function panel(sx: number, sy: number, grid = true): Project {
  const rect = createVectorAsset('rect', { id: 'r' });
  const inner: SceneObject = createSceneObject('r', { id: 'shape', zOrder: 0 });
  const sym = createSymbolAsset({
    id: 'panel', width: 100, height: 40, objects: [inner],
    ...(grid ? { scale9: { left: 20, top: 10, right: 20, bottom: 10 } } : {}),
  });
  const inst = createSceneObject('panel', { id: 'p', zOrder: 0 });
  inst.base = { ...inst.base, scaleX: sx, scaleY: sy } as never;
  const p = createProject();
  return { ...p, assets: [...p.assets, rect, sym], objects: [inst] };
}

describe('flattenInstances with 9-slice', () => {
  test('a 9-slice instance draws nine clipped cells with live clips', () => {
    const leaves = flattenInstances(panel(2, 3), 0);
    expect(leaves.map((l) => l.renderId)).toEqual(Array.from({ length: 9 }, (_, i) => `p~${i}/shape`));
    expect(new Set(leaves.map((l) => l.clipId)).size).toBe(9);
    expect(leaves.every((l) => l.clipLive === true)).toBe(true);
    // The instance's own scale is replaced by the cell mapping.
    expect(leaves[0]!.transformPrefix).toContain('scale(1, 1)');
    expect(leaves[4]!.transformPrefix).toMatch(/matrix\(2\.6667, 0, 0, 5, /);
    expect(scale9Of((panel(1, 1).assets.find((a) => a.id === 'panel') as never))).toBeDefined();
  });

  test('without a grid, or with scale9: false, the instance scales normally (parity)', () => {
    const plain = flattenInstances(panel(2, 3, false), 0);
    expect(plain.map((l) => l.renderId)).toEqual(['p/shape']);
    expect(plain[0]!.clipLive).toBeUndefined();
    const off = flattenInstances(panel(2, 3), 0, { scale9: false });
    expect(off.map((l) => l.renderId)).toEqual(['p/shape']);
    expect(off[0]!.transformPrefix).toContain('scale(2, 3)');
  });

  test('a flipped instance keeps its flip', () => {
    const leaves = flattenInstances(panel(-2, 1), 0);
    expect(leaves[0]!.transformPrefix).toContain('scale(-1, 1)');
  });
});
