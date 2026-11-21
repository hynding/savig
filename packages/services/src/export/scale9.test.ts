// 9-slice scaling (roadmap 13) through the exporters: the static SVG emits nine clipped cells whose
// clip rects the runtime can find, computeFrame animates those rects with the instance's scale,
// the SMIL export bakes that animation, and Lottie falls back to plain scaling with a warning.
import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset, type Project, type SceneObject } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import { renderSvgDocument } from './renderDocument';
import { renderAnimatedSvgDocument } from './animatedSvg';
import { exportLottie } from './lottie';

function panel(animated: boolean): Project {
  const rect = createVectorAsset('rect', { id: 'r' });
  const inner: SceneObject = createSceneObject('r', { id: 'shape', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'panel', width: 100, height: 40, objects: [inner], scale9: { left: 20, top: 10, right: 20, bottom: 10 } });
  const inst = createSceneObject('panel', { id: 'p', zOrder: 0 });
  inst.base = { ...inst.base, scaleX: 2, scaleY: 1 };
  if (animated) {
    inst.tracks = { ...inst.tracks, scaleX: [{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 3, easing: 'linear' }] };
  }
  const p = createProject();
  return { ...p, meta: { ...p.meta, duration: 1 }, assets: [...p.assets, rect, sym], objects: [inst] };
}

describe('9-slice export', () => {
  it('the static SVG draws nine cells, each clipped by a findable rect', () => {
    const svg = renderSvgDocument(panel(false));
    for (let i = 0; i < 9; i++) {
      expect(svg).toContain(`data-savig-object="p~${i}/shape"`);
      expect(svg).toContain(`<clipPath id="clip-p~${i}" clipPathUnits="userSpaceOnUse">`);
      expect(svg).toMatch(new RegExp(`<rect [^>]*data-savig-object="clip-p~${i}"`));
    }
  });

  it('computeFrame moves the cell clips as the instance scale animates', () => {
    const p = panel(true);
    const clip = (t: number) => computeFrame(p, t).find((it) => it.kind === 'clip' && it.objectId === 'clip-p~4')!;
    expect(clip(0).transform).not.toBe(clip(1).transform);
    expect(computeFrame(p, 0).filter((it) => it.kind === 'clip')).toHaveLength(9);
  });

  it('the SMIL export animates the clip rects', () => {
    const svg = renderAnimatedSvgDocument(panel(true));
    const rect = svg.slice(svg.indexOf('data-savig-object="clip-p~4"'));
    expect(rect.slice(0, rect.indexOf('</clipPath>'))).toContain('animateTransform');
  });

  it('Lottie scales 9-slice symbols normally and says so', () => {
    const { warnings } = exportLottie(panel(false));
    expect(warnings.join(' ')).toMatch(/9-slice/);
  });
});
