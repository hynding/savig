// 3D rotation (spec 2026-11-18-3d-rotation): every exporter carries a turned or turning object
// through its existing matrix decomposition.
import { describe, expect, it } from 'vitest';
import { createKeyframe, createProject, createSceneObject, createVectorAsset, type Project } from '@savig/engine';
import { renderSvgDocument } from './renderDocument';
import { renderAnimatedSvgDocument } from './animatedSvg';
import { renderCssSvgDocument } from './cssSvg';
import { exportLottie } from './lottie';
import { decompose, parseTransform } from './smilTransform';

function fixture(animated: boolean): Project {
  const p = createProject({ width: 100, height: 100, fps: 10 });
  p.assets.push(createVectorAsset('rect', { id: 'va' }));
  const o = createSceneObject('va', { id: 'r', shapeBase: { width: 20, height: 20 } });
  if (animated) o.tracks = { rotationY: [createKeyframe(0, 0, { easing: 'linear' }), createKeyframe(1, 60, { easing: 'linear' })] };
  else o.base = { ...o.base, rotationY: 60 };
  p.objects.push(o);
  p.meta.duration = 1;
  return p;
}

describe('3D rotation in exports', () => {
  it('static SVG writes the projected matrix', () => {
    expect(renderSvgDocument(fixture(false))).toContain('matrix(0.5, 0, 0, 1, 0, 0)');
  });

  it('SMIL animates the turn (the decomposed scale narrows)', () => {
    const svg = renderAnimatedSvgDocument(fixture(true));
    const scale = svg.match(/<animateTransform[^>]*type="scale"[^>]*values="([^"]+)"/);
    expect(scale).not.toBeNull();
    const firstX = Number(scale![1].split(';')[0].trim().split(/[\s,]+/)[0]);
    const lastX = Number(scale![1].split(';').at(-1)!.trim().split(/[\s,]+/)[0]);
    expect(firstX).toBeCloseTo(1, 2);
    expect(lastX).toBeCloseTo(0.5, 2);
  });

  it('CSS export carries the turn in its keyframes', () => {
    const svg = renderCssSvgDocument(fixture(true));
    expect(svg).toMatch(/scale\(0\.5,1\)|scale\(0\.5, 1\)/);
  });

  it('Lottie scales the layer to 50% wide', () => {
    const { animation } = exportLottie(fixture(false));
    const layer = (animation as unknown as { layers: { ks: { s: { k: unknown } } }[] }).layers[0];
    expect(JSON.stringify(layer.ks.s)).toContain('50');
  });

  it('a 180° turn decomposes to a mirror', () => {
    const d = decompose(parseTransform('matrix(-1, 0, 0, 1, 0, 0)'));
    expect(d.scaleX * d.scaleY).toBeLessThan(0);
  });
});
