// Blend modes (spec 2026-11-15-blend-modes): the wrapper seam in the static export, its order
// with masks and filters, groups, symbols and the raster renderer.
import { describe, expect, it } from 'vitest';
import {
  createFilter,
  createGroupObject,
  createProject,
  createSceneObject,
  createSymbolAsset,
  createVectorAsset,
  flattenInstances,
  type Project,
  type SceneObject,
} from '@savig/engine';
import { renderSvgDocument } from './renderDocument';
import { renderAnimatedSvgDocument } from './animatedSvg';

const rect = (id: string, extra: Partial<SceneObject> = {}) => createSceneObject('va', { id, shapeBase: { width: 10, height: 10 }, ...extra });

function fixture(objects: SceneObject[], extraAssets: Project['assets'] = []): Project {
  const p = createProject({ width: 100, height: 100 });
  p.assets.push(createVectorAsset('rect', { id: 'va' }), ...extraAssets);
  p.objects.push(...objects);
  return p;
}

describe('blend modes in the leaf model', () => {
  it('a blended leaf gets a blend wrap ref; no blend anywhere = no wrapChain (parity)', () => {
    const plain = flattenInstances(fixture([rect('a')]), 0);
    expect(plain[0].wrapChain).toBeUndefined();
    const [leaf] = flattenInstances(fixture([rect('a', { blendMode: 'multiply' })]), 0);
    expect(leaf.wrapChain).toEqual([{ kind: 'blend', id: 'savig-blend-a', mode: 'multiply' }]);
  });

  it('a group blend wraps every child; blend is outside the node’s own filter', () => {
    const g = { ...createGroupObject({ id: 'g', zOrder: 0, anchorX: 0, anchorY: 0 }), blendMode: 'screen' as const };
    const p = fixture([g, rect('a', { parentId: 'g', zOrder: 0, blendMode: 'difference', filters: [createFilter('blur', 'fb')] }), rect('b', { parentId: 'g', zOrder: 1 })]);
    const leaves = flattenInstances(p, 0);
    expect(leaves.map((l) => (l.wrapChain ?? []).map((r) => r.kind + ':' + r.id))).toEqual([
      ['blend:savig-blend-g', 'blend:savig-blend-a', 'filter:savig-filter-a'],
      ['blend:savig-blend-g'],
    ]);
  });
});

describe('blend modes in the export', () => {
  it('wraps the run in <g style="mix-blend-mode:…">, the group as one wrapper', () => {
    const g = { ...createGroupObject({ id: 'g', zOrder: 0, anchorX: 0, anchorY: 0 }), blendMode: 'multiply' as const };
    const svg = renderSvgDocument(fixture([g, rect('a', { parentId: 'g', zOrder: 0 }), rect('b', { parentId: 'g', zOrder: 1 }), rect('c', { zOrder: 1 })]));
    expect(svg.match(/mix-blend-mode/g)).toHaveLength(1);
    const inner = svg.slice(svg.indexOf('<g style="mix-blend-mode:multiply">'));
    const close = inner.indexOf('</g>', inner.lastIndexOf('data-savig-object="b"'));
    expect(inner.indexOf('data-savig-object="a"')).toBeLessThan(close);
    expect(inner.indexOf('data-savig-object="c"')).toBeGreaterThan(close);
  });

  it('works inside symbol instances and in the animated SVG export', () => {
    const sym = createSymbolAsset({ id: 'sym', name: 'S', objects: [rect('inner', { blendMode: 'overlay' })] });
    const p = fixture([createSceneObject('sym', { id: 'i1', zOrder: 0 }), createSceneObject('sym', { id: 'i2', zOrder: 1 })], [sym]);
    expect(renderSvgDocument(p).match(/mix-blend-mode:overlay/g)).toHaveLength(2);
    expect(renderAnimatedSvgDocument(fixture([rect('a', { blendMode: 'lighten' })]))).toContain('mix-blend-mode:lighten');
  });
});
