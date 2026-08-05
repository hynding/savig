import { describe, it, expect } from 'vitest';
import { createProject, createSceneObject, createVectorAsset, DEFAULT_VECTOR_STYLE } from '@savig/engine';
import type { Project, ShapeKeyframe } from '@savig/engine';
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

/** A 1s project with one path object whose shapeTrack morphs one node — same 2-node,
 *  open-path command skeleton ("M"+"L") in every frame, so linear (default) calcMode applies.
 *  Mirrors packages/runtime/src/frame.test.ts's `morphProject()` (search "shapeTrack"). */
function pathMorphProject(): Project {
  const k0 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
  const k1 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] };
  const shapeTrack: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: k0 },
    { time: 1, easing: 'linear', path: k1 },
  ];
  const p = createProject({ name: 'anim-morph-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  const asset = createVectorAsset('path', { id: 'p-asset', path: k0 });
  p.assets.push(asset);
  p.objects.push(
    createSceneObject('p-asset', { id: 'path1', anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack }),
  );
  return p;
}

/** A 1s project with one stroked rect whose trim window (start/end) animates — dasharray width
 *  changes per frame while token count stays uniform (2 tokens throughout). Mirrors
 *  packages/runtime/src/frame.test.ts's `projectWithTrimRect()` (search "trim"). */
function trimProject(): Project {
  const p = createProject({ name: 'anim-trim-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  const asset = createVectorAsset('rect', { id: 't-asset', style: { ...DEFAULT_VECTOR_STYLE, stroke: '#000000', strokeWidth: 1 } });
  p.assets.push(asset);
  p.objects.push(
    createSceneObject('t-asset', {
      id: 'pt',
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      shapeBase: { width: 10, height: 10 },
      trim: {
        start: 0,
        end: 1,
        offset: 0,
        endTrack: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1, value: 1, easing: 'linear' },
        ],
        // offset also animates so phase (and thus stroke-dashoffset) is non-constant too —
        // an end-only trim keeps offset/phase pinned at 0 (constant dashoffset, no <animate>).
        offsetTrack: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1, value: 0.3, easing: 'linear' },
        ],
      },
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

describe('shape-level attributes', () => {
  it('animated geometry emits <animate> per attribute on the INNER shape', () => {
    const p = movingRectProject();
    (p.objects[0] as { tracks: Record<string, unknown> }).tracks = {
      width: [{ time: 0, value: 20, easing: 'linear' }, { time: 1, value: 80, easing: 'linear' }],
    };
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const shape = doc.querySelector('[data-savig-object="o1"]')!.firstElementChild!;
    const anim = shape.querySelector('animate[attributeName="width"]')!;
    const vals = anim.getAttribute('values')!.split(';');
    expect(Number(vals[0])).toBeCloseTo(20, 3);
    expect(Number(vals[vals.length - 1])).toBeCloseTo(80, 3);
  });

  it('a morphing path with STABLE structure animates d with default (linear) calcMode', () => {
    // Build a 2-node path whose shapeTrack moves one node — same command skeleton each frame.
    // Copy the shapeTrack project construction from packages/runtime/src/frame.test.ts (search
    // "shapeTrack") — reuse its minimal path asset/object literals verbatim, with 1s duration.
    const p = pathMorphProject(); // helper defined alongside, per frame.test.ts's pattern
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const anim = doc.querySelector('[data-savig-object="path1"] path animate[attributeName="d"]')!;
    expect(anim.getAttribute('calcMode')).toBeNull(); // default = linear
    expect(anim.getAttribute('values')!.split(';').length).toBeGreaterThan(1);
  });

  it('animated fill color emits <animate attributeName="fill"> on the shape', () => {
    const p = movingRectProject();
    p.objects[0].colorTracks = {
      fill: [{ time: 0, value: '#ff0000', easing: 'linear' }, { time: 1, value: '#0000ff', easing: 'linear' }],
    };
    (p.objects[0] as { tracks: Record<string, unknown> }).tracks = {};
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const anim = doc.querySelector('[data-savig-object="o1"] rect animate[attributeName="fill"]')!;
    const vals = anim.getAttribute('values')!.split(';');
    expect(vals[0]).toBe('#ff0000');
    expect(vals[vals.length - 1]).toBe('#0000ff');
  });

  it('trim emits dasharray+dashoffset animates and pins pathLength=1', () => {
    // Trim window start/end animated: copy the trim project literal from
    // packages/engine/src/trim.test.ts / runtime frame.test.ts trim cases (1s duration).
    const p = trimProject();
    const doc = parseDoc(renderAnimatedSvgDocument(p));
    const shape = doc.querySelector('[data-savig-object="pt"]')!.firstElementChild!;
    expect(shape.getAttribute('pathLength')).toBe('1');
    expect(shape.querySelector('animate[attributeName="stroke-dasharray"]')).not.toBeNull();
    expect(shape.querySelector('animate[attributeName="stroke-dashoffset"]')).not.toBeNull();
  });
});
