// Skew (spec 2026-11-18-skew-distort): every exporter carries a skewed or skew-animated object.
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
  if (animated) {
    o.tracks = { skewX: [createKeyframe(0, 0), createKeyframe(1, 30)] };
  } else {
    o.base = { ...o.base, skewX: 30 };
  }
  p.objects.push(o);
  p.meta.duration = 1;
  return p;
}

describe('skew in exports', () => {
  it('static SVG writes the skew into the transform', () => {
    expect(renderSvgDocument(fixture(false))).toContain('skewX(30)');
  });

  it('SMIL animates skew with an additive skewX animateTransform', () => {
    const svg = renderAnimatedSvgDocument(fixture(true));
    expect(svg).toMatch(/<animateTransform[^>]*type="skewX"/);
  });

  it('CSS export carries the skew in its keyframes', () => {
    const svg = renderCssSvgDocument(fixture(true));
    const skews = [...svg.matchAll(/skewX\((-?[\d.]+)deg\)/g)].map((m) => Number(m[1]));
    expect(Math.max(...skews.map(Math.abs))).toBeGreaterThan(20);
  });

  it('Lottie writes a non-zero layer skew', () => {
    const { animation } = exportLottie(fixture(false));
    const layer = (animation as unknown as { layers: { ks: { sk: { k: unknown } } }[] }).layers[0];
    expect(JSON.stringify(layer.ks.sk)).not.toBe(JSON.stringify({ a: 0, k: 0 }));
  });

  it('the shared decomposition recovers the skew angle', () => {
    const d = decompose(parseTransform('skewX(30)'));
    expect(d.skewX).toBeCloseTo(30);
    expect(d.rotation).toBeCloseTo(0);
  });
});
