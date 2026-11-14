import { describe, expect, it } from 'vitest';
import { bakeSprings, simulateSprings, springConstants } from './springs';
import { createSceneObject } from './project';
import { sampleObject, springOffset } from './sample';
import type { SceneObject } from './types';

/** Root bone r (joint 0,0, length 100 → +x) carrying child bone c (joint at r's tip, length 60).
 *  r swings 0° → 90° over [0, 0.5s] then holds; c has a spring. */
function arm(spring: { strength: number; damping: number } | undefined, rKeys = true): SceneObject[] {
  const r = createSceneObject('', {
    id: 'r',
    zOrder: 0,
    isGroup: true,
    anchorX: 0,
    anchorY: 0,
    bone: { length: 100, angle: 0 },
    tracks: rKeys ? { rotation: [{ time: 0, value: 0, easing: 'easeInOut' }, { time: 0.5, value: 90, easing: 'linear' }] } : {},
  } as Partial<SceneObject>);
  const c = createSceneObject('', {
    id: 'c',
    zOrder: 1,
    parentId: 'r',
    isGroup: true,
    anchorX: 100,
    anchorY: 0,
    bone: { length: 60, angle: 0, ...(spring ? { spring } : {}) },
  } as Partial<SceneObject>);
  return [r, c];
}

describe('bone springs', () => {
  it('constants: stronger = stiffer, more damping = more friction', () => {
    expect(springConstants(100, 50).k).toBeGreaterThan(springConstants(10, 50).k);
    expect(springConstants(50, 100).c).toBeGreaterThan(springConstants(50, 0).c);
  });

  it('a child spring lags its parent, overshoots, then settles back to its keyed angle', () => {
    const offs = simulateSprings(arm({ strength: 30, damping: 20 }), 30, 3).get('c')!;
    expect(offs).toHaveLength(91);
    expect(offs[0]).toBe(0);
    // While the parent turns +90°, the child trails (negative offset)...
    expect(Math.min(...offs.slice(0, 16))).toBeLessThan(-5);
    // ...then swings past (positive) once the parent stops...
    expect(Math.max(...offs.slice(15, 60))).toBeGreaterThan(2);
    // ...and has settled by the end.
    expect(Math.abs(offs[offs.length - 1])).toBeLessThan(1);
  });

  it('no motion, or strength 0, means no offsets', () => {
    expect(simulateSprings(arm({ strength: 50, damping: 50 }, false), 30, 1).get('c')!.every((o) => o === 0)).toBe(true);
    expect(simulateSprings(arm({ strength: 0, damping: 50 }), 30, 1).size).toBe(0);
  });

  it('bakeSprings stores offsets that sampleObject adds; same array when already baked', () => {
    const baked = bakeSprings(arm({ strength: 30, damping: 20 }), 30, 2);
    const c = baked.find((o) => o.id === 'c')!;
    expect(c.bone!.spring!.baked!.fps).toBe(30);
    expect(springOffset(c, 0.25)).not.toBe(0);
    expect(sampleObject(c, 0.25).rotation).toBeCloseTo(springOffset(c, 0.25), 9);
    expect(bakeSprings(baked, 30, 2)).toBe(baked);
    // Turning the spring off clears the bake.
    const off = baked.map((o) => (o.id === 'c' ? { ...o, bone: { ...o.bone!, spring: { ...o.bone!.spring!, strength: 0 } } } : o));
    expect(bakeSprings(off, 30, 2).find((o) => o.id === 'c')!.bone!.spring!.baked).toBeUndefined();
  });

  it('respects joint limits', () => {
    const objs = arm({ strength: 20, damping: 10 }).map((o) => (o.id === 'c' ? { ...o, bone: { ...o.bone!, min: -10, max: 10 } } : o));
    const offs = simulateSprings(objs, 30, 2).get('c')!;
    expect(Math.min(...offs)).toBeGreaterThanOrEqual(-10);
    expect(Math.max(...offs)).toBeLessThanOrEqual(10);
  });
});
