// Shape tween (spec 2026-11-13): the bake needs no render code — a baked tween is a morphing path
// inside a key, so the runtime emits a fresh `d` (and blended fill) per frame and SMIL animates `d`.
import { describe, expect, it } from 'vitest';
import { bakeShapeTween, createFrameLayer, createProject, createSceneObject, createVectorAsset, type Project } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import { renderAnimatedSvgDocument } from './animatedSvg';

function baked(): Project {
  const p = createProject({ fps: 10, width: 100, height: 100 });
  p.assets.push(
    createVectorAsset('rect', { id: 'ra', style: { fill: '#ff0000', stroke: 'none', strokeWidth: 0 } }),
    createVectorAsset('ellipse', { id: 'ea', style: { fill: '#0000ff', stroke: 'none', strokeWidth: 0 } }),
  );
  p.objects.push(
    createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'k1', time: 0 }, { id: 'k2', time: 1 }], end: 2 }),
    createSceneObject('ra', { id: 'r', parentId: 'L', frameKeyId: 'k1', zOrder: 1, shapeBase: { width: 10, height: 10 } }),
    createSceneObject('ea', { id: 'e', parentId: 'L', frameKeyId: 'k2', zOrder: 2, shapeBase: { radiusX: 20, radiusY: 20 } }),
  );
  const res = bakeShapeTween(p.objects, p.assets, 'L', 'k1');
  if ('error' in res) throw new Error(res.error);
  return { ...p, objects: res.objects, assets: res.assets };
}

describe('shape tween render', () => {
  it('the runtime morphs the drawing across the span', () => {
    const p = baked();
    const item = (t: number) => computeFrame(p, t).find((i) => i.objectId === 'r')!;
    expect(item(0).pathD).toBeTruthy();
    expect(item(0.5).pathD).not.toBe(item(0).pathD);
    expect(item(0.5).visibility).toBe('visible');
    expect(item(0.5).fill).not.toBe('#ff0000');
    expect(item(1.2).visibility).toBe('hidden');
  });

  it('SMIL export animates d and fill', () => {
    const svg = renderAnimatedSvgDocument(baked());
    expect(svg).toMatch(/attributeName="d"/);
    expect(svg).toMatch(/attributeName="fill"/);
  });
});
