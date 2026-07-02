import { describe, it, expect } from 'vitest';
import { resolveBooleanRings } from '../boolean';
import { createProject, createSceneObject, createVectorAsset } from '../../project';
import type { SceneObject, VectorAsset } from '../../types';

// A rect object: world bbox (tx,ty)..(tx+w,ty+h).
function rectObj(id: string, zOrder: number, w: number, h: number, tx: number, ty: number): [SceneObject, VectorAsset] {
  const asset = createVectorAsset('rect', { id: `${id}-a` });
  const obj = createSceneObject(asset.id, {
    id, zOrder, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
    shapeBase: { width: w, height: h },
    base: { x: tx, y: ty, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  });
  return [obj, asset];
}

function svgRectAsset(id: string, side: number) {
  return {
    id, kind: 'svg' as const, name: id, viewBox: `0 0 ${side} ${side}`, width: side, height: side,
    normalizedContent:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><rect x="0" y="0" width="${side}" height="${side}"/></svg>`,
  };
}

describe('boolean operand: an SVG-asset object', () => {
  it('an SVG rect operand intersects with a covering rect to its own region', () => {
    const svgAsset = svgRectAsset('svg-a', 20);
    // REAL SVG-object anchor model (store.addObject): absolute anchor at width/2, NO anchorMode.
    // Placed at a non-origin base so toWorld is genuinely exercised. World extent: local 0..20 at (30,30) => 30..50.
    const svgObj = createSceneObject('svg-a', {
      id: 'svgobj', zOrder: 0, anchorX: 10, anchorY: 10,
      base: { x: 30, y: 30, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const cover = rectObj('cover', 1, 60, 60, 20, 20); // (20,20)..(80,80) covers the svg's 30..50 box
    const boolAsset = createVectorAsset('path', { id: 'b-a', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('b-a', { id: 'boolobj', zOrder: 2, boolean: { op: 'intersect', operandIds: ['svgobj', 'cover'] } });
    const project = { ...createProject(), objects: [svgObj, cover[0], boolObj], assets: [svgAsset, cover[1], boolAsset] };
    const rings = resolveBooleanRings(project, boolObj, 0);
    expect(rings.length).toBeGreaterThan(0);
    const xs = rings.flatMap((r) => r.nodes.map((n) => n.anchor.x));
    expect(Math.min(...xs)).toBeCloseTo(30, 2); // the SVG rect's WORLD extent (placed at base 30,30)
    expect(Math.max(...xs)).toBeCloseTo(50, 2);
  });

  it('a degenerate / unsupported-only SVG operand contributes nothing (no clip)', () => {
    const emptySvg = {
      id: 'esvg', kind: 'svg' as const, name: 'esvg', viewBox: '0 0 10 10', width: 10, height: 10,
      normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="0" y="5">hi</text></svg>',
    };
    const svgObj = createSceneObject('esvg', { id: 'svgobj', zOrder: 0, anchorX: 5, anchorY: 5 });
    const cover = rectObj('cover', 1, 20, 20, 0, 0);
    const boolAsset = createVectorAsset('path', { id: 'b2-a', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('b2-a', { id: 'boolobj', zOrder: 2, boolean: { op: 'intersect', operandIds: ['svgobj', 'cover'] } });
    const project = { ...createProject(), objects: [svgObj, cover[0], boolObj], assets: [emptySvg, cover[1], boolAsset] };
    // only one operand contributes geometry -> degenerate -> []
    expect(resolveBooleanRings(project, boolObj, 0)).toEqual([]);
  });
});
