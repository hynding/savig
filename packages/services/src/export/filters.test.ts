// Filters slice 1 (spec 2026-11-13-filters): the render seam end to end — <filter> defs + <g filter>
// wrappers in the static export, ordering with masks, the runtime rebuilding filter children per
// frame, SMIL <animate> on primitives, the static-<use> bypass and multi-scene prefixing.
import { describe, expect, it } from 'vitest';
import {
  createFilter,
  createGroupObject,
  createKeyframe,
  createProject,
  createSceneObject,
  createSymbolAsset,
  createVectorAsset,
  type Project,
  type SceneObject,
} from '@savig/engine';
import { applyProjectFrame } from '@savig/runtime/frame';
import { renderProjectDocument, renderSvgDocument } from './renderDocument';
import { renderAnimatedSvgDocument } from './animatedSvg';
import { migrateProject } from '../persistence/migrate';

const rect = (id: string, extra: Partial<SceneObject> = {}) =>
  createSceneObject('va', { id, shapeBase: { width: 10, height: 10 }, ...extra });

/** `a` has an animated blur (0 → 8 over 1s); `b` is plain. */
function fixture(): Project {
  const p = createProject({ fps: 10, width: 100, height: 100 });
  p.assets.push(createVectorAsset('rect', { id: 'va' }));
  p.objects.push(
    rect('a', {
      zOrder: 0,
      filters: [createFilter('blur', 'fb')],
      filterTracks: { 'fb.blur': [createKeyframe(0, 0), createKeyframe(1, 8)] },
    }),
    rect('b', { zOrder: 1 }),
  );
  return p;
}

const parse = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;

describe('filters — static export', () => {
  it('emits one <filter> def at t=0 and wraps the filtered object', () => {
    const svg = parse(renderSvgDocument(fixture()));
    const f = svg.querySelector('defs > filter#savig-filter-a')!;
    expect(f).not.toBeNull();
    expect(f.getAttribute('data-savig-object')).toBe('savig-filter-a');
    expect(f.getAttribute('color-interpolation-filters')).toBe('sRGB');
    expect(f.querySelector('feGaussianBlur')!.getAttribute('stdDeviation')).toBe('0');
    const g = svg.querySelector(':scope > g[filter="url(#savig-filter-a)"]')!;
    expect(g.querySelector('[data-savig-object="a"]')).not.toBeNull();
    expect(svg.querySelector(':scope > [data-savig-object="b"]')).not.toBeNull();
  });

  it('parity: no filters, disabled filters and empty lists all give the filter-free render', () => {
    const plain = fixture();
    plain.objects = plain.objects.map((o) => ({ ...o, filters: undefined, filterTracks: undefined }));
    plain.objects.forEach((o) => { delete o.filters; delete o.filterTracks; });
    const disabled = fixture();
    disabled.objects[0] = { ...disabled.objects[0], filters: [{ ...createFilter('blur', 'fb'), enabled: false }], filterTracks: undefined };
    delete disabled.objects[0].filterTracks;
    const empty = fixture();
    empty.objects[0] = { ...empty.objects[0], filters: [] };
    delete empty.objects[0].filterTracks;
    expect(renderSvgDocument(disabled)).toBe(renderSvgDocument(plain));
    expect(renderSvgDocument(empty)).toBe(renderSvgDocument(plain));
    expect(renderSvgDocument(plain)).not.toContain('filter');
  });

  it('a masked, filtered object is filtered inside the mask wrapper; a filtered group wraps its kids', () => {
    const p = createProject({ width: 100, height: 100 });
    p.assets.push(createVectorAsset('rect', { id: 'va' }));
    p.objects.push(
      { ...createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }), filters: [createFilter('dropShadow', 'gs')] },
      rect('k1', { parentId: 'g', zOrder: 1 }),
      rect('k2', { parentId: 'g', zOrder: 2, maskedBy: 'm', filters: [createFilter('glow', 'kg')] }),
      rect('m', { zOrder: 3, isMask: true }),
    );
    const svg = parse(renderSvgDocument(p));
    const outer = svg.querySelector(':scope > g[filter="url(#savig-filter-g)"]')!;
    expect(outer.querySelector(':scope > [data-savig-object="k1"]')).not.toBeNull();
    const masked = outer.querySelector(':scope > g[mask="url(#savig-mask-m)"]')!;
    expect(masked.querySelector(':scope > g[filter="url(#savig-filter-k2)"] > [data-savig-object="k2"]')).not.toBeNull();
    expect(svg.querySelectorAll('defs > filter')).toHaveLength(2);
  });

  it('escapes colors and ids from crafted files', () => {
    const p = fixture();
    p.objects[0] = { ...p.objects[0], id: 'a"x', filters: [{ ...createFilter('glow', 'g'), color: '"><script>' }] };
    const markup = renderSvgDocument(p);
    expect(markup).not.toContain('"><script>');
    expect(markup).not.toContain('a"x');
    expect(parse(markup).querySelector('parsererror')).toBeNull();
  });

  it('inlines a filtered static symbol instance and a symbol containing filters (no <use>)', () => {
    for (const where of ['instance', 'inside'] as const) {
      const p = fixture();
      p.assets.push(createSymbolAsset({ id: 'S', objects: [rect('s1', where === 'inside' ? { filters: [createFilter('blur', 'x')] } : {})] }));
      p.objects.push(createSceneObject('S', { id: 'inst', zOrder: 4, ...(where === 'instance' ? { filters: [createFilter('blur', 'y')] } : {}) }));
      const svg = parse(renderSvgDocument(p));
      expect(svg.querySelector('use[href="#savig-sym-S"]')).toBeNull();
      expect(svg.querySelector('g[filter] [data-savig-object="inst/s1"]')).not.toBeNull();
    }
  });
});

describe('filters — runtime', () => {
  it('applyProjectFrame rebuilds the filter children for the frame and never sets a transform on the def', () => {
    const p = fixture();
    const svg = parse(renderSvgDocument(p));
    const nodes = new Map<string, Element>();
    svg.querySelectorAll('[data-savig-object]').forEach((n) => nodes.set(n.getAttribute('data-savig-object')!, n));
    applyProjectFrame(svg, nodes, p, 0.5);
    const def = nodes.get('savig-filter-a')!;
    expect(def.querySelector('feGaussianBlur')!.getAttribute('stdDeviation')).toBe('4');
    expect(def.children).toHaveLength(1);
    expect(def.hasAttribute('transform')).toBe(false);
  });
});

describe('filters — animated SVG (SMIL)', () => {
  it('animates the changing primitive attribute in place', () => {
    const svg = parse(renderAnimatedSvgDocument(fixture()));
    const blur = svg.querySelector('filter#savig-filter-a > feGaussianBlur')!;
    const anim = blur.querySelector('animate')!;
    expect(anim.getAttribute('attributeName')).toBe('stdDeviation');
    expect(anim.getAttribute('values')!.split(';')[0]).toBe('0');
    expect(anim.getAttribute('values')!.split(';').at(-1)).toBe('8');
    expect(svg.querySelector('filter#savig-filter-a > animateTransform')).toBeNull();
  });
});

describe('filters — multi-scene', () => {
  it('scene-prefixes filter def ids and wrapper references', () => {
    const base = fixture();
    const p: Project = {
      ...base,
      objects: [],
      scenes: [
        { id: 's1', name: 'One', objects: base.objects, duration: 1 },
        { id: 's2', name: 'Two', objects: base.objects, duration: 1 },
      ],
    };
    const svg = parse(renderProjectDocument(p));
    expect(svg.querySelector('filter[id="s1:savig-filter-a"]')).not.toBeNull();
    expect(svg.querySelector('[data-savig-scene="s2"] g[filter="url(#s2:savig-filter-a)"]')).not.toBeNull();
  });
});

describe('filters — persistence', () => {
  it('migrates v9 → v10 and drops malformed entries', () => {
    const p = fixture();
    p.meta.version = 9;
    p.objects[0] = {
      ...p.objects[0],
      filters: [
        { id: 'ok', kind: 'blur', params: { blur: 2, nope: 3, bad: NaN } as never },
        { id: 'ok', kind: 'blur', params: {} },
        { id: 'k', kind: 'sparkle' as never, params: {} },
        { id: 'c', kind: 'glow', params: {}, color: 5 as never },
        null as never,
      ],
      filterTracks: {
        'ok.blur': [createKeyframe(0, 1)],
        'ok.nope': [createKeyframe(0, 1)],
        'gone.blur': [createKeyframe(0, 1)],
        'ok': [createKeyframe(0, 1)],
      },
    };
    const m = migrateProject(p);
    expect(m.meta.version).toBe(11);
    expect(m.objects[0].filters).toEqual([
      { id: 'ok', kind: 'blur', params: { blur: 2 } },
      { id: 'c', kind: 'glow', params: {} },
    ]);
    expect(Object.keys(m.objects[0].filterTracks!)).toEqual(['ok.blur']);
  });

  it('a clean project is returned unchanged', () => {
    const p = fixture();
    expect(migrateProject(p).objects[0]).toBe(p.objects[0]);
  });
});
