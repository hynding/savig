// Filters (spec 2026-11-13-filters) — sampling, clamps, primitives, wrapChain ordering, duration.
import { describe, expect, it } from 'vitest';
import {
  createFilter,
  filterPrimitives,
  hasActiveFilters,
  sampleFilters,
  symbolUsesFilters,
} from './filters';
import { flattenInstances } from './symbol';
import { objectsMaxKeyframeTime } from './duration';
import { createGroupObject, createProject, createSceneObject, createSymbolAsset, createVectorAsset, createKeyframe } from './project';
import type { Project, SceneObject } from './types';

const rect = (id: string, extra: Partial<SceneObject> = {}) => createSceneObject('va', { id, ...extra });
function proj(objects: SceneObject[]): Project {
  const p = createProject({ width: 100, height: 100 });
  p.assets.push(createVectorAsset('rect', { id: 'va' }));
  p.objects.push(...objects);
  return p;
}

describe('sampleFilters', () => {
  it('fills defaults, skips disabled/unknown kinds, keeps order', () => {
    const o = rect('a', {
      filters: [
        { id: 'f1', kind: 'blur', params: {} },
        { id: 'f2', kind: 'glow', params: { blur: 3 }, enabled: false },
        { id: 'f3', kind: 'bogus' as never, params: {} },
        createFilter('dropShadow', 'f4'),
      ],
    });
    const r = sampleFilters(o, 0);
    expect(r.map((f) => f.id)).toEqual(['f1', 'f4']);
    expect(r[0].params).toEqual({ blur: 4 });
    expect(r[1]).toEqual({ id: 'f4', kind: 'dropShadow', params: { dx: 4, dy: 4, blur: 4, opacity: 0.5 }, color: '#000000' });
  });

  it('a track wins over the static param, and values are clamped', () => {
    const o = rect('a', {
      filters: [{ id: 'f', kind: 'adjustColor', params: { brightness: 5, hue: 30 } }],
      filterTracks: { 'f.hue': [createKeyframe(0, 0), createKeyframe(1, 400)] },
    });
    expect(sampleFilters(o, 0)[0].params).toMatchObject({ brightness: 1, hue: 0 });
    expect(sampleFilters(o, 1)[0].params.hue).toBe(180);
    expect(sampleFilters(o, 0.25)[0].params.hue).toBe(100);
  });

  it('[] and hasActiveFilters=false without filters', () => {
    expect(sampleFilters(rect('a'), 0)).toEqual([]);
    expect(hasActiveFilters(rect('a'))).toBe(false);
    expect(hasActiveFilters(rect('a', { filters: [{ id: 'f', kind: 'blur', params: {}, enabled: false }] }))).toBe(false);
  });
});

describe('filterPrimitives', () => {
  it('chains each filter on the previous result; structure is independent of values', () => {
    const o = rect('a', { filters: [createFilter('blur', 'b'), createFilter('glow', 'g'), createFilter('adjustColor', 'c')] });
    const prims = filterPrimitives(sampleFilters(o, 0));
    expect(prims.map((p) => p.tag)).toEqual([
      'feGaussianBlur',
      'feGaussianBlur', 'feFlood', 'feComposite', 'feComponentTransfer', 'feMerge',
      'feColorMatrix', 'feColorMatrix', 'feComponentTransfer',
    ]);
    expect(prims[0].attrs).toMatchObject({ in: 'SourceGraphic', stdDeviation: '4', result: 'f0' });
    expect(prims[1].attrs.in).toBe('f0');
    expect(prims[5].children!.map((c) => c.attrs.in)).toEqual(['f1s', 'f0']);
    expect(prims[6].attrs.in).toBe('f1');
    expect(prims[8].children!.map((c) => c.tag)).toEqual(['feFuncR', 'feFuncG', 'feFuncB']);
  });

  it('adjustColor maps contrast/brightness to a linear transfer', () => {
    const o = rect('a', { filters: [{ id: 'c', kind: 'adjustColor', params: { contrast: 0.5, brightness: 0.1 } }] });
    const fn = filterPrimitives(sampleFilters(o, 0))[2].children![0].attrs;
    expect(fn).toEqual({ type: 'linear', slope: '1.5', intercept: '-0.15' });
  });
});

describe('flattenInstances wrapChain', () => {
  const blur = (id = 'fb') => [createFilter('blur', id)];

  it('parity: no filters → no wrapChain', () => {
    const leaves = flattenInstances(proj([rect('a', { maskedBy: 'm' }), rect('m', { isMask: true })]), 0);
    expect(leaves.every((l) => l.wrapChain === undefined)).toBe(true);
  });

  it('own filter on a leaf', () => {
    const [leaf] = flattenInstances(proj([rect('a', { filters: blur() })]), 0);
    expect(leaf.wrapChain!.map((r) => [r.kind, r.id])).toEqual([['filter', 'savig-filter-a']]);
    expect(leaf.wrapChain![0]).toMatchObject({ owner: { id: 'a' }, time: 0 });
  });

  it('per node: mask then filter; group (outer) before child (inner)', () => {
    const p = proj([
      { ...createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }), maskedBy: 'm', filters: blur('gf') },
      rect('kid', { parentId: 'g', zOrder: 1, filters: blur('kf'), maskedBy: 'm2' }),
      rect('m', { zOrder: 2, isMask: true }),
      rect('m2', { zOrder: 3, isMask: true }),
    ]);
    const kid = flattenInstances(p, 0).find((l) => l.renderId === 'kid')!;
    expect(kid.wrapChain!.map((r) => r.id)).toEqual(['savig-mask-m', 'savig-filter-g', 'savig-mask-m2', 'savig-filter-kid']);
    expect(kid.maskChain).toEqual(['savig-mask-m', 'savig-mask-m2']);
  });

  it('a filtered symbol instance wraps its internals (sampled at the parent time); ids are per path', () => {
    const p = proj([
      createSceneObject('S', { id: 'i1', zOrder: 0, filters: blur(), filterTracks: { 'fb.blur': [createKeyframe(0, 0), createKeyframe(2, 8)] } }),
    ]);
    p.assets.push(createSymbolAsset({ id: 'S', objects: [rect('in', { filters: blur('x') })] }));
    const [leaf] = flattenInstances(p, 1);
    expect(leaf.wrapChain!.map((r) => r.id)).toEqual(['savig-filter-i1', 'savig-filter-i1/in']);
    const ref = leaf.wrapChain![0];
    expect(ref.kind === 'filter' && sampleFilters(ref.owner, ref.time)[0].params.blur).toBe(4);
    expect(symbolUsesFilters(p.assets.find((a) => a.id === 'S') as never, new Map(p.assets.map((a) => [a.id, a])) as never)).toBe(true);
  });

  it('mask content ignores filters', () => {
    const p = proj([rect('a', { maskedBy: 'm', zOrder: 0 }), rect('m', { isMask: true, filters: blur(), zOrder: 1 })]);
    const m = flattenInstances(p, 0).find((l) => l.renderId === 'm')!;
    expect(m.maskOf).toBe('savig-mask-m');
    expect(m.wrapChain).toBeUndefined();
  });
});

describe('duration', () => {
  it('objectsMaxKeyframeTime folds filterTracks', () => {
    expect(objectsMaxKeyframeTime([rect('a', { filterTracks: { 'f.blur': [createKeyframe(0, 0), createKeyframe(3.5, 2)] } })])).toBe(3.5);
  });
});
