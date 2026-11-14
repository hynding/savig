// CSS-only export (spec 2026-11-14-css-export): sampled computeFrame series become CSS @keyframes
// in one <style>; no SMIL, no script.
import { describe, it, expect } from 'vitest';
import { promoteToMultiScene } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import { decompose, parseTransform } from './smilTransform';
import { renderCssSvgDocument } from './cssSvg';
import { gradientProject, movingRectProject, pathMorphProject, setDipTransition, trimProject, withSecondScene } from './exportFixtures.testutil';

const parseDoc = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml');
const styleOf = (doc: Document) => doc.querySelector('style')?.textContent ?? '';

/** The animations (name, timing) applied to `el` by its savig-a* class rule. */
function animationsOf(doc: Document, el: Element): string[] {
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).find((c) => c.startsWith('savig-a'));
  if (!cls) return [];
  const rule = new RegExp(`\\.${cls}\\{animation:([^;}]*)`).exec(styleOf(doc));
  return rule ? rule[1].split(',') : [];
}

/** The keyframes body of the animation of `el` whose keyframes set `prop`. */
function keyframesFor(doc: Document, el: Element, prop: string): Array<{ pct: number; value: string }> {
  const css = styleOf(doc);
  for (const a of animationsOf(doc, el)) {
    const name = a.trim().split(' ')[0];
    const m = new RegExp(`@keyframes ${name}\\{(.*?)\\}\\n`).exec(css + '\n');
    if (!m) continue;
    const frames = [...m[1].matchAll(/([\d.]+)%\{([a-z-]+):([^}]*)\}/g)].map((x) => ({ pct: Number(x[1]), prop: x[2], value: x[3] }));
    if (frames[0]?.prop === prop) return frames;
  }
  return [];
}

describe('renderCssSvgDocument', () => {
  it('animates with CSS only: a <style> of @keyframes, no SMIL elements, deterministic', () => {
    const p = movingRectProject();
    const markup = renderCssSvgDocument(p);
    expect(renderCssSvgDocument(p)).toBe(markup);
    const doc = parseDoc(markup);
    expect(doc.querySelector('animate, animateTransform, set, script')).toBeNull();
    expect(styleOf(doc)).toMatch(/@keyframes savig-k0\{/);
    // <style> sits right after the embedded source metadata.
    expect(doc.documentElement.firstElementChild!.tagName).toBe('metadata');
    expect(doc.documentElement.children[1].tagName).toBe('style');
    const wrapper = doc.querySelector('[data-savig-object="o1"]')!;
    const anims = animationsOf(doc, wrapper);
    expect(anims).toHaveLength(1);
    expect(anims[0]).toMatch(/^savig-k\d+ 1s linear 0s 1 forwards$/);
    expect(styleOf(doc)).toContain('transform-box:view-box;transform-origin:0 0');
  });

  it('parity: transform keyframes match the decomposed computeFrame transform at each sample', () => {
    const p = movingRectProject();
    const doc = parseDoc(renderCssSvgDocument(p));
    const frames = keyframesFor(doc, doc.querySelector('[data-savig-object="o1"]')!, 'transform');
    expect(frames.length).toBe(11);
    for (const f of frames) {
      const t = (f.pct / 100) * 1;
      const item = computeFrame(p, t).find((it) => it.objectId === 'o1')!;
      const d = decompose(parseTransform(item.transform!));
      const m = /translate\(([-\d.]+)px,([-\d.]+)px\) rotate\(([-\d.]+)deg\) skewX\(([-\d.]+)deg\) scale\(([-\d.]+),([-\d.]+)\)/.exec(f.value)!;
      expect(Number(m[1])).toBeCloseTo(d.tx, 3);
      expect(Number(m[2])).toBeCloseTo(d.ty, 3);
    }
  });

  it('loop plays infinitely; a static or zero-duration project gets no <style>', () => {
    const p = movingRectProject();
    p.meta.loop = true;
    const doc = parseDoc(renderCssSvgDocument(p));
    expect(animationsOf(doc, doc.querySelector('[data-savig-object="o1"]')!)[0]).toMatch(/ linear 0s infinite$/);
    const still = movingRectProject();
    (still.objects[0] as { tracks: Record<string, unknown> }).tracks = {};
    expect(parseDoc(renderCssSvgDocument(still)).querySelector('style')).toBeNull();
  });

  it('prunes keyframes where a value holds', () => {
    const p = movingRectProject();
    p.objects[0].tracks.x = [{ time: 0, value: 0, easing: 'linear' }, { time: 0.3, value: 30, easing: 'linear' }];
    const doc = parseDoc(renderCssSvgDocument(p));
    const frames = keyframesFor(doc, doc.querySelector('[data-savig-object="o1"]')!, 'transform');
    // 0..0.3 moves (4 samples), then one keyframe where the hold starts and the final one.
    expect(frames.map((f) => f.pct)).toEqual([0, 10, 20, 30, 100]);
  });

  it('path morphs animate `d: path(...)` linearly on the inner shape', () => {
    const doc = parseDoc(renderCssSvgDocument(pathMorphProject()));
    const shape = doc.querySelector('[data-savig-object="path1"]')!.firstElementChild!;
    const frames = keyframesFor(doc, shape, 'd');
    expect(frames.length).toBeGreaterThan(2);
    expect(frames[0].value).toMatch(/^path\("M/);
    expect(animationsOf(doc, shape)[0]).toContain(' linear ');
  });

  it('trim animates stroke-dasharray / stroke-dashoffset and pins pathLength=1', () => {
    const doc = parseDoc(renderCssSvgDocument(trimProject()));
    const shape = doc.querySelector('[data-savig-object="pt"]')!.firstElementChild!;
    expect(keyframesFor(doc, shape, 'stroke-dasharray').length).toBeGreaterThan(2);
    expect(keyframesFor(doc, shape, 'stroke-dashoffset').length).toBeGreaterThan(2);
    expect(shape.getAttribute('pathLength')).toBe('1');
  });

  it('gradient stops animate stop-color', () => {
    const doc = parseDoc(renderCssSvgDocument(gradientProject()));
    const stop = doc.querySelector('[id="savig-grad-o1-fill"] stop')!;
    const frames = keyframesFor(doc, stop, 'stop-color');
    expect(frames[0].value).not.toBe(frames[frames.length - 1].value);
  });

  it('single-scene camera animates transform on the camera group', () => {
    const p = movingRectProject();
    (p.objects[0] as { tracks: Record<string, unknown> }).tracks = {};
    p.camera = { base: { x: 160, y: 120, zoom: 1, rotation: 0 }, tracks: { zoom: [{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 2, easing: 'linear' }] } };
    const doc = parseDoc(renderCssSvgDocument(p));
    expect(keyframesFor(doc, doc.querySelector('[data-savig-camera]')!, 'transform').length).toBeGreaterThan(2);
  });

  it('multi-scene: hidden scenes are opacity 0 with instant switches (no display / inline style)', () => {
    const doc = parseDoc(renderCssSvgDocument(withSecondScene(promoteToMultiScene(movingRectProject()))));
    const groups = [...doc.querySelectorAll('[data-savig-scene]')];
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.getAttribute('opacity'))).toEqual(['1', '0']);
    for (const g of groups) {
      expect(g.getAttribute('style')).toBeNull();
      expect(g.getAttribute('display')).toBeNull();
      const f = keyframesFor(doc, g, 'opacity');
      // The cut at 0.5s is a keyframe pair 0.001% apart, not a one-frame fade.
      const i = f.findIndex((x) => x.pct === 50);
      expect(f[i - 1].pct).toBeCloseTo(49.999, 6);
      expect(f[i - 1].value).not.toBe(f[i].value);
    }
  });

  it('dip transition: the overlay is an opacity ramp (no display attribute)', () => {
    const p = withSecondScene(promoteToMultiScene(movingRectProject()));
    setDipTransition(p);
    const doc = parseDoc(renderCssSvgDocument(p));
    const rect = doc.querySelector('rect[data-savig-dip]')!;
    expect(rect.getAttribute('display')).toBeNull();
    expect(Math.max(...keyframesFor(doc, rect, 'opacity').map((f) => Number(f.value)))).toBeGreaterThan(0.5);
  });
});
