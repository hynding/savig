import { describe, it, expect } from 'vitest';
import { createProject, createSceneObject, createVectorAsset } from '@savig/engine';
import type { Project } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import { decompose, parseTransform } from './smilTransform';
import { renderAnimatedSvgDocument } from './animatedSvg';

/** A 1s project with one rect whose x animates 0 -> 100.
 *  Uses the engine's factories (createProject/createSceneObject/createVectorAsset) rather than
 *  bare literals — a bare SceneObject literal would omit `shapeBase` (geometry silently absent)
 *  and `anchorX`/`anchorY` (pivot silently zeroed), mirroring how renderDocument.test.ts builds
 *  minimal projects. */
function movingRectProject(): Project {
  const p = createProject({ name: 'anim-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  p.assets.push(
    createVectorAsset('rect', { id: 'a1', style: { fill: '#ff0000', stroke: 'none', strokeWidth: 1 } }),
  );
  p.objects.push(
    createSceneObject('a1', {
      id: 'o1',
      zOrder: 0,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      shapeBase: { width: 20, height: 20 },
      tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 100, easing: 'linear' }] },
    }),
  );
  return p;
}

const parseDoc = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml');

describe('renderAnimatedSvgDocument core', () => {
  it('is deterministic (byte-identical on repeat calls)', () => {
    const p = movingRectProject();
    expect(renderAnimatedSvgDocument(p)).toBe(renderAnimatedSvgDocument(p));
  });

  it('emits stacked animateTransforms on the animated wrapper, shape stays firstElementChild', () => {
    const doc = parseDoc(renderAnimatedSvgDocument(movingRectProject()));
    const wrapper = doc.querySelector('[data-savig-object="o1"]')!;
    expect(wrapper.firstElementChild!.tagName).toBe('rect'); // runtime contract preserved
    const translates = wrapper.querySelectorAll('animateTransform[type="translate"]');
    expect(translates.length).toBe(1);
    const tr = translates[0];
    expect(tr.getAttribute('dur')).toBe('1s');
    expect(tr.getAttribute('begin')).toBe('0s');
    expect(tr.getAttribute('fill')).toBe('freeze'); // loop=false
    expect(tr.getAttribute('repeatCount')).toBeNull();
  });

  it('parity: emitted translate values match decomposed computeFrame transforms at sample times', () => {
    const p = movingRectProject();
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const tr = doc.querySelector('[data-savig-object="o1"] animateTransform[type="translate"]')!;
    const values = tr.getAttribute('values')!.split(';');
    expect(values.length).toBe(11); // N=10 intervals -> 11 samples
    values.forEach((v, i) => {
      const t = (i * 1) / 10;
      const item = computeFrame(p, t).find((it) => it.objectId === 'o1')!;
      const d = decompose(parseTransform(item.transform));
      const [x, y] = v.split(',').map(Number);
      expect(x).toBeCloseTo(d.tx, 3);
      expect(y).toBeCloseTo(d.ty, 3);
    });
  });

  it('loop=true emits repeatCount=indefinite and no fill', () => {
    const p = movingRectProject();
    p.meta.loop = true;
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const tr = doc.querySelector('animateTransform[type="translate"]')!;
    expect(tr.getAttribute('repeatCount')).toBe('indefinite');
    expect(tr.getAttribute('fill')).toBeNull();
  });

  it('a fully static project or zero duration emits NO animation elements', () => {
    const p = createProject({ name: 'static' });
    p.assets.push(
      createVectorAsset('rect', { id: 'a1', style: { fill: '#00ff00', stroke: 'none', strokeWidth: 1 } }),
    );
    p.objects.push(
      createSceneObject('a1', {
        id: 'o1',
        zOrder: 0,
        anchorMode: 'fraction',
        anchorX: 0.5,
        anchorY: 0.5,
        base: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        shapeBase: { width: 10, height: 10 },
        tracks: {},
      }),
    );
    const markup = renderAnimatedSvgDocument(p);
    expect(markup).not.toContain('<animate');
    expect(markup).toContain('data-savig-object');
  });

  it('animated opacity emits an opacity <animate> on the wrapper', () => {
    const p = movingRectProject();
    p.objects[0].tracks = {
      opacity: [{ time: 0, value: 1, easing: 'linear' }, { time: 1, value: 0, easing: 'linear' }],
    };
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const anim = doc.querySelector('[data-savig-object="o1"] animate[attributeName="opacity"]')!;
    const vals = anim.getAttribute('values')!.split(';');
    expect(Number(vals[0])).toBeCloseTo(1, 3);
    expect(Number(vals[vals.length - 1])).toBeCloseTo(0, 3);
  });
});
