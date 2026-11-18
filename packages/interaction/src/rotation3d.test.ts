// 3D rotation (spec 2026-11-18-3d-rotation): handle math follows a turned object.
import { describe, expect, it } from 'vitest';
import { mapPoint } from '@savig/engine';
import { linearMaps } from './handleMath';

describe('linearMaps with 3D rotation', () => {
  it('fwd matches mapPoint’s linear part and inv undoes it', () => {
    const t = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 20, skewX: 5, rotationX: 35, rotationY: -40 };
    const L = linearMaps(t.rotation, t.skewX, undefined, t.rotationX, t.rotationY);
    const f = L.fwd(12, -7);
    const m = mapPoint(t, 0, 0, 12, -7);
    expect(f.x).toBeCloseTo(m.x, 9);
    expect(f.y).toBeCloseTo(m.y, 9);
    const back = L.inv(f.x, f.y);
    expect(back.x).toBeCloseTo(12, 9);
    expect(back.y).toBeCloseTo(-7, 9);
  });
});
