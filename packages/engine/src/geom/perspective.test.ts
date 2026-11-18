// Bake perspective (spec 2026-11-18-3d-rotation, slice 3).
import { describe, expect, it } from 'vitest';
import { applyPerspective, perspectiveOffset } from './warp';
import { createProject, createSceneObject, createVectorAsset } from '../project';
import { mapPoint } from '../groupTransform';
import { resolveAnchor, sampleObject } from '../sample';
import { tiltOffset } from '../transform';
import type { SceneObject, VectorAsset } from '../types';

function tilted(base: Partial<SceneObject['base']>, extra: Partial<SceneObject> = {}) {
  const p = createProject();
  p.assets.push(createVectorAsset('rect', { id: 'va' }));
  p.objects.push(
    createSceneObject('va', {
      id: 'r',
      shapeBase: { width: 100, height: 50 },
      base: { x: 20, y: 30, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, ...base },
      ...extra,
    }),
  );
  return p;
}

describe('perspectiveOffset', () => {
  it('is the orthographic tilt when the eye is far away', () => {
    const q = perspectiveOffset(30, 50, 1e9, 40, -20);
    const o = tiltOffset(30, 50, 40, -20);
    expect(q.x).toBeCloseTo(o.x, 4);
    expect(q.y).toBeCloseTo(o.y, 4);
  });

  it('turning about Y brings one side nearer (bigger) and pushes the other away', () => {
    const near = perspectiveOffset(0, 40, 500, -50, 25); // left side swings toward the viewer
    const far = perspectiveOffset(0, 40, 500, 50, 25);
    expect(near.z).toBeGreaterThan(0);
    expect(far.z).toBeLessThan(0);
    expect(Math.abs(near.y)).toBeGreaterThan(Math.abs(far.y));
  });
});

describe('applyPerspective', () => {
  it('writes the projected outline into the path and clears the 3D rotation', () => {
    const p = tilted({ rotationY: 40, scaleX: 1.5 });
    const obj = p.objects[0];
    const st = sampleObject(obj, 0);
    const { anchorX, anchorY } = resolveAnchor(obj, st, 'rect');
    const pivotBefore = mapPoint(st, anchorX, anchorY, 0, 0);
    const r = applyPerspective(p.objects, p.assets, 'r', 0, 500);
    if ('refused' in r) throw new Error(r.refused);
    const o2 = r.objects[0];
    const asset = r.assets[0] as VectorAsset;
    expect(o2.base.rotationX).toBeUndefined();
    expect(o2.base.rotationY).toBeUndefined();
    expect(asset.shapeType).toBe('path');
    // Still four straight sides.
    expect(asset.path!.nodes).toHaveLength(4);
    expect(asset.path!.nodes.every((n) => !n.in && !n.out)).toBe(true);
    // Each corner is the scaled offset projected, then unscaled.
    const tl = asset.path!.nodes[0].anchor;
    const q = perspectiveOffset(0, 40, 500, (0 - anchorX) * 1.5, (0 - anchorY) * 1);
    expect(tl.x).toBeCloseTo(anchorX + q.x / 1.5, 9);
    expect(tl.y).toBeCloseTo(anchorY + q.y, 9);
    // The left edge (nearer) is now taller than the right edge.
    const [a, b, c, d] = asset.path!.nodes.map((n) => n.anchor);
    expect(d.y - a.y).toBeGreaterThan(c.y - b.y);
    // The pivot does not move on screen.
    const st2 = sampleObject(o2, 0);
    const pivotAfter = mapPoint(st2, o2.anchorX, o2.anchorY, 0, 0);
    expect(pivotAfter.x).toBeCloseTo(pivotBefore.x, 9);
    expect(pivotAfter.y).toBeCloseTo(pivotBefore.y, 9);
  });

  it('bakes a still keyed pose (one angle) and clears its keys', () => {
    const p = tilted({}, { tracks: { rotationY: [{ time: 0, value: 30 }] } as never });
    const r = applyPerspective(p.objects, p.assets, 'r', 0);
    if ('refused' in r) throw new Error(r.refused);
    expect(r.objects[0].tracks.rotationY).toBeUndefined();
  });

  it('refuses a flat drawing, keyed or wiggled 3D rotation, and a corner behind the eye', () => {
    expect(applyPerspective(tilted({}).objects, tilted({}).assets, 'r', 0)).toEqual({ refused: 'flat' });
    const keyed = tilted({ rotationY: 20 }, { tracks: { rotationY: [{ time: 0, value: 0 }, { time: 1, value: 30 }] } as never });
    expect(applyPerspective(keyed.objects, keyed.assets, 'r', 0)).toEqual({ refused: 'animated-3d' });
    const wig = tilted({ rotationY: 20 }, { modifiers: { rotationY: { wiggle: { amplitude: 5, frequency: 1 } } } as never });
    expect(applyPerspective(wig.objects, wig.assets, 'r', 0)).toEqual({ refused: 'animated-3d' });
    const close = tilted({ rotationY: -80 }); // pivot at the top-left: the right side swings toward the eye
    expect(applyPerspective(close.objects, close.assets, 'r', 0, 40)).toEqual({ refused: 'too-close' });
  });
});
