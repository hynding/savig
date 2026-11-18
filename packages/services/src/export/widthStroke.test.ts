// Variable-width strokes (spec 2026-11-18-variable-width): every exporter draws the outline.
import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject, createVectorAsset, type PathData, type Project } from '@savig/engine';
import { renderSvgDocument } from './renderDocument';
import { renderAnimatedSvgDocument } from './animatedSvg';
import { renderCssSvgDocument } from './cssSvg';
import { exportLottie } from './lottie';

const k0: PathData = { closed: false, nodes: [{ anchor: { x: 10, y: 10 } }, { anchor: { x: 60, y: 10 } }] };
const k1: PathData = { closed: false, nodes: [{ anchor: { x: 10, y: 10 } }, { anchor: { x: 90, y: 60 } }] };

function fixture(animated: boolean): Project {
  const p = createProject({ width: 100, height: 100, fps: 10 });
  p.assets.push(
    createVectorAsset('path', {
      id: 'va',
      path: k0,
      style: { fill: 'none', stroke: '#112233', strokeWidth: 6, widthProfile: [{ t: 0, w: 2 }, { t: 1, w: 0 }] },
    }),
  );
  const o = createSceneObject('va', { id: 'o' });
  if (animated) {
    o.shapeTrack = [
      { time: 0, easing: 'linear', path: k0 },
      { time: 1, easing: 'linear', path: k1 },
    ];
    o.colorTracks = { stroke: [{ time: 0, value: '#000000', easing: 'linear' }, { time: 1, value: '#ff0000', easing: 'linear' }] };
  }
  p.objects.push(o);
  p.meta.duration = 1;
  return p;
}

describe('variable-width strokes in exports', () => {
  it('static SVG draws the shape without a stroke plus a filled outline', () => {
    const svg = renderSvgDocument(fixture(false));
    expect(svg).toMatch(/<path d="[^"]*" fill="none" stroke="none"\/><path data-savig-width="" d="M[^"]+" fill="#112233"\/>/);
  });

  it('SMIL animates the outline d and fill', () => {
    const svg = renderAnimatedSvgDocument(fixture(true));
    const outline = svg.slice(svg.indexOf('data-savig-width'));
    expect(outline).toMatch(/<animate[^>]*attributeName="d"/);
    expect(outline).toMatch(/<animate[^>]*attributeName="fill"/);
    expect(svg).not.toMatch(/attributeName="stroke"/);
  });

  it('CSS export animates the outline', () => {
    const svg = renderCssSvgDocument(fixture(true));
    // one keyframe set for the shape's own d, one for the outline's
    expect([...svg.matchAll(/@keyframes [\w-]+\{0%\{d:path\(/g)].length).toBe(2);
    expect(svg).toMatch(/@keyframes [\w-]+\{0%\{fill:/);
  });

  it('Lottie draws the stroke as a filled outline group, not a stroke', () => {
    const { animation } = exportLottie(fixture(false));
    const json = JSON.stringify(animation);
    expect(json).toContain('"nm":"Outline 1"');
    expect(json).not.toContain('"ty":"st"');
  });
});
