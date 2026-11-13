// Mask layers slice 1 (spec 2026-11-13): the render seam end to end — <mask> defs + <g mask>
// wrappers in the static export, the runtime animating mask content via the shared computeFrame /
// applyProjectFrame path, the SMIL sampler reaching nodes inside <mask>, and multi-scene prefixing.
import { describe, expect, it } from 'vitest';
import {
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

const rect = (id: string, extra: Partial<SceneObject> = {}) =>
  createSceneObject('va', { id, shapeBase: { width: 10, height: 10 }, ...extra });

/** `a` and `b` masked by `m` (which slides right over 1s); `free` sits between them, unmasked. */
function fixture(): Project {
  const p = createProject({ fps: 10, width: 100, height: 100 });
  p.assets.push(createVectorAsset('rect', { id: 'va' }));
  p.objects.push(
    rect('a', { zOrder: 0, maskedBy: 'm' }),
    rect('free', { zOrder: 1 }),
    rect('b', { zOrder: 2, maskedBy: 'm' }),
    rect('m', {
      zOrder: 3,
      isMask: true,
      tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 50)] },
    }),
  );
  return p;
}

const parse = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;

describe('mask layers — static export', () => {
  it('draws the mask into an alpha <mask> def, not the body', () => {
    const svg = parse(renderSvgDocument(fixture()));
    const mask = svg.querySelector('defs > mask#savig-mask-m')!;
    expect(mask).not.toBeNull();
    expect(mask.getAttribute('maskUnits')).toBe('userSpaceOnUse');
    expect(mask.getAttribute('mask-type')).toBe('alpha');
    expect(mask.querySelector('[data-savig-object="m"]')).not.toBeNull();
    expect(svg.querySelectorAll('[data-savig-object="m"]')).toHaveLength(1);
  });

  it('wraps each run of masked objects; a non-contiguous target re-references the same mask', () => {
    const svg = parse(renderSvgDocument(fixture()));
    const wrappers = [...svg.querySelectorAll(':scope > g[mask]')];
    expect(wrappers.map((g) => g.getAttribute('mask'))).toEqual(['url(#savig-mask-m)', 'url(#savig-mask-m)']);
    expect(wrappers[0].querySelector('[data-savig-object="a"]')).not.toBeNull();
    expect(wrappers[1].querySelector('[data-savig-object="b"]')).not.toBeNull();
    expect(svg.querySelector(':scope > [data-savig-object="free"]')).not.toBeNull();
  });

  it('nests stacked masks (masked group + masked child) outermost first', () => {
    const p = createProject({ width: 100, height: 100 });
    p.assets.push(createVectorAsset('rect', { id: 'va' }));
    p.objects.push(
      { ...createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }), maskedBy: 'm1' },
      rect('kid', { parentId: 'g', zOrder: 1, maskedBy: 'm2' }),
      rect('m1', { zOrder: 2, isMask: true }),
      rect('m2', { zOrder: 3, isMask: true }),
    );
    const svg = parse(renderSvgDocument(p));
    const outer = svg.querySelector(':scope > g[mask="url(#savig-mask-m1)"]')!;
    const inner = outer.querySelector(':scope > g[mask="url(#savig-mask-m2)"]')!;
    expect(inner.querySelector('[data-savig-object="kid"]')).not.toBeNull();
  });

  it('parity: removing the mask fields gives the mask-free render', () => {
    const plain = fixture();
    plain.objects = plain.objects.filter((o) => o.id !== 'm').map(({ maskedBy: _m, ...o }) => o);
    const withDangling = fixture();
    withDangling.objects = withDangling.objects.filter((o) => o.id !== 'm'); // dangling maskedBy → unmasked
    expect(renderSvgDocument(withDangling)).toBe(renderSvgDocument(plain));
    expect(renderSvgDocument(plain)).not.toContain('mask');
  });

  it('inlines a masked static symbol instance instead of the <use> optimization', () => {
    const p = fixture();
    p.assets.push(createSymbolAsset({ id: 'S', objects: [rect('s1')] }));
    p.objects.push(createSceneObject('S', { id: 'inst', zOrder: 4, maskedBy: 'm' }));
    const svg = parse(renderSvgDocument(p));
    expect(svg.querySelector('use[href="#savig-sym-S"]')).toBeNull();
    expect(svg.querySelector('g[mask] [data-savig-object="inst/s1"]')).not.toBeNull();
  });

  it('escapes mask ids from crafted object ids', () => {
    const p = fixture();
    p.objects = p.objects.map((o) => (o.id === 'm' ? { ...o, id: 'm"x' } : o.maskedBy ? { ...o, maskedBy: 'm"x' } : o));
    const markup = renderSvgDocument(p);
    expect(markup).not.toContain('m"x');
    expect(parse(markup).querySelector('parsererror')).toBeNull();
  });
});

describe('mask layers — runtime', () => {
  it('applyProjectFrame animates mask content inside <mask> like any node', () => {
    const p = fixture();
    const svg = parse(renderSvgDocument(p));
    const nodes = new Map<string, Element>();
    svg.querySelectorAll('[data-savig-object]').forEach((n) => nodes.set(n.getAttribute('data-savig-object')!, n));
    applyProjectFrame(svg, nodes, p, 1);
    expect(nodes.get('m')!.getAttribute('transform')).toContain('translate(50');
  });
});

describe('mask layers — animated SVG (SMIL)', () => {
  it('animates the mask content in place inside its <mask>', () => {
    const svg = parse(renderAnimatedSvgDocument(fixture()));
    const node = svg.querySelector('mask#savig-mask-m [data-savig-object="m"]')!;
    expect(node.querySelector('animateTransform')).not.toBeNull();
    expect(svg.querySelectorAll('g[mask="url(#savig-mask-m)"]')).toHaveLength(2);
  });
});

describe('mask layers — multi-scene', () => {
  it('scene-prefixes mask def ids and wrapper references', () => {
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
    expect(svg.querySelector('mask[id="s1:savig-mask-m"]')).not.toBeNull();
    expect(svg.querySelector('mask[id="s2:savig-mask-m"]')).not.toBeNull();
    expect(svg.querySelector('[data-savig-scene="s2"] g[mask="url(#s2:savig-mask-m)"]')).not.toBeNull();
  });
});
