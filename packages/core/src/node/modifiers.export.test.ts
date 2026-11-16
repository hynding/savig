// Property modifiers (spec 2026-11-16-property-modifiers) reach every export: they are applied in
// sampleObject, which the raster, SMIL/CSS samplers, Lottie converter and the HTML runtime share.
import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import { exportLottie } from '@savig/services';
import { RUNTIME_JS } from '@savig/runtime/runtimeSource.generated';
import { addRect, setKeyframe } from '../build';
import { setModifier } from '../modifiers';
import { renderFrameSvg } from './render';
import { renderAnimatedSvgNode, renderCssSvgNode } from './animatedSvg';

function wiggling() {
  let p = addRect(createProject({ width: 200, height: 100, fps: 10, duration: 2, durationMode: 'manual' }), { x: 50, y: 25, width: 20, height: 20, id: 'r' }).project;
  p = setModifier(p, 'r', 'rotation', { wiggle: { amplitude: 20, frequency: 2, seed: 1 } });
  return p;
}

function looping() {
  let p = addRect(createProject({ width: 200, height: 100, fps: 10, duration: 4, durationMode: 'manual' }), { x: 0, y: 25, width: 20, height: 20, id: 'r' }).project;
  p = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 0 });
  p = setKeyframe(p, { objectId: 'r', property: 'x', time: 1, value: 100 });
  return setModifier(p, 'r', 'x', { loop: 'pingpong' });
}

describe('modifiers in every export', () => {
  it('raster frames move with a keyless wiggle', () => {
    const p = wiggling();
    expect(renderFrameSvg(p, 0.3)).not.toBe(renderFrameSvg(p, 0.9));
  });

  it('a ping-pong loop comes back in the raster', () => {
    const p = looping();
    const at = (t: number) => /translate\(([-\d.]+)/.exec(renderFrameSvg(p, t))?.[1];
    expect(at(1.5)).toBe(at(0.5));
    expect(at(2.5)).toBe(at(0.5));
    expect(at(3)).toBe(at(1));
  });

  it('animated SVG (SMIL) and CSS exports carry the wiggle', () => {
    const p = wiggling();
    const smil = renderAnimatedSvgNode(p);
    expect(smil).toMatch(/<animate/);
    const css = renderCssSvgNode(p);
    expect(css).toMatch(/@keyframes/);
    // A project with no modifiers and no keys exports no animation at all (parity).
    const still = { ...p, objects: p.objects.map((o) => ({ ...o, modifiers: undefined })) };
    expect(renderAnimatedSvgNode(still)).not.toMatch(/<animate/);
  });

  it('Lottie animates the wiggled rotation', () => {
    const anim = exportLottie(wiggling()).animation;
    expect(JSON.stringify(anim.layers[0].ks)).toMatch(/"r":\{"a":1/);
  });

  it('the HTML runtime bundle includes the modifier sampling', () => {
    expect(RUNTIME_JS).toContain('pingpong');
  });
});
