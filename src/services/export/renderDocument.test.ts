import { describe, expect, it } from 'vitest';
import {
  createGroupObject,
  createProject,
  createSceneObject,
  createVectorAsset,
  pathToD,
  samplePath,
  type Project,
  type ShapeKeyframe,
  type SvgAsset,
} from '../../engine';
import { MissingAssetError } from '../errors';
import { renderSvgDocument } from './renderDocument';

function fixture(): Project {
  const asset: SvgAsset = {
    id: 'aaaa1111',
    kind: 'svg',
    name: 'box.svg',
    normalizedContent:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    viewBox: '0 0 10 10',
    width: 10,
    height: 10,
  };
  const project = createProject({ width: 100, height: 80 });
  project.assets.push(asset);
  project.objects.push(
    createSceneObject('aaaa1111', { id: 'obj1', zOrder: 0, base: { x: 5, y: 6, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
  );
  return project;
}

describe('renderSvgDocument', () => {
  it('emits a root svg sized to the project', () => {
    const out = renderSvgDocument(fixture());
    expect(out).toContain('viewBox="0 0 100 80"');
    expect(out.startsWith('<svg')).toBe(true);
  });

  it('defines each used asset once in <defs>', () => {
    const out = renderSvgDocument(fixture());
    expect(out).toContain('id="savig-asset-aaaa1111"');
    expect((out.match(/savig-asset-aaaa1111"/g) ?? []).length).toBe(2); // defs id + use href
  });

  it('emits a <use> with object id, transform, and opacity', () => {
    const out = renderSvgDocument(fixture());
    expect(out).toContain('data-savig-object="obj1"');
    expect(out).toContain('href="#savig-asset-aaaa1111"');
    expect(out).toContain('translate(5, 6)');
  });

  it('is deterministic across calls', () => {
    expect(renderSvgDocument(fixture())).toBe(renderSvgDocument(fixture()));
  });

  it('sanitizes asset script content when inlining (defense-in-depth)', () => {
    const project = fixture();
    project.assets[0] = {
      ...(project.assets[0] as SvgAsset),
      normalizedContent:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>evil()</script><rect onclick="x()"/></svg>',
    };
    const out = renderSvgDocument(project);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('evil()');
    expect(out).not.toContain('onclick');
  });

  it('throws MissingAssetError for an unknown asset reference', () => {
    const project = fixture();
    project.objects[0] = createSceneObject('nope9999', { id: 'obj1' });
    expect(() => renderSvgDocument(project)).toThrow(MissingAssetError);
  });
});

describe('renderSvgDocument with vector shapes', () => {
  it('inlines a vector object as <g><rect/></g> with no def', () => {
    const project = createProject();
    project.assets.push(
      createVectorAsset('rect', { id: 'vr', style: { fill: '#f00', stroke: 'none', strokeWidth: 0 } }),
    );
    const obj = createSceneObject('vr', {
      id: 'o1',
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      shapeBase: { width: 100, height: 50 },
      base: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    project.objects.push(obj);

    const out = renderSvgDocument(project);
    expect(out).toContain('<defs></defs>');
    expect(out).toContain('<g data-savig-object="o1"');
    expect(out).toContain(
      '<rect x="0" y="0" width="100" height="50" fill="#f00" stroke="none" stroke-width="0"/>',
    );
    expect(out).not.toContain('<use');
  });

  it('inlines a path object as <g><path/></g> with no def', () => {
    const path = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: false };
    const project = createProject();
    project.assets.push(
      createVectorAsset('path', { id: 'vp', path, style: { fill: 'none', stroke: '#000000', strokeWidth: 2 } }),
    );
    project.objects.push(
      createSceneObject('vp', {
        id: 'p1',
        anchorMode: 'fraction',
        anchorX: 0.5,
        anchorY: 0.5,
        base: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      }),
    );

    const out = renderSvgDocument(project);
    expect(out).toContain(`<path d="${pathToD(path)}" fill="none" stroke="#000000" stroke-width="2"/>`);
    expect(out).toContain('<g data-savig-object="p1"');
    expect(out).toContain('<defs></defs>');
    expect(out).not.toContain('<use');
  });

  it('emits gradient defs for a vector object and references them', () => {
    const grad = {
      type: 'linear' as const,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    };
    const project = createProject();
    project.assets.push(
      createVectorAsset('rect', {
        id: 'vg',
        style: { fill: '#000000', stroke: 'none', strokeWidth: 0, fillGradient: grad },
      }),
    );
    project.objects.push(
      createSceneObject('vg', {
        id: 'o1',
        anchorMode: 'fraction',
        shapeBase: { width: 100, height: 50 },
        base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      }),
    );
    const out = renderSvgDocument(project);
    expect(out).toContain('<linearGradient id="savig-grad-o1-fill"');
    expect(out).toContain('fill="url(#savig-grad-o1-fill)"');
  });

  it('emits a gradient def sampled at t=0 + a url() ref for an animated-only gradient (no static)', () => {
    const g0 = {
      type: 'linear' as const,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      stops: [
        { offset: 0, color: '#aa0000' },
        { offset: 1, color: '#0000aa' },
      ],
    };
    const g1 = { ...g0, x2: 1 };
    const project = createProject();
    // NOTE: asset style has NO fillGradient — the gradient lives only on the track.
    project.assets.push(
      createVectorAsset('rect', {
        id: 'vg2',
        style: { fill: '#000000', stroke: 'none', strokeWidth: 0 },
      }),
    );
    project.objects.push(
      createSceneObject('vg2', {
        id: 'o1',
        anchorMode: 'fraction',
        shapeBase: { width: 100, height: 50 },
        base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        gradientTracks: {
          fill: [
            { time: 0, gradient: g0, easing: 'linear' },
            { time: 2, gradient: g1, easing: 'linear' },
          ],
        },
      }),
    );
    const out = renderSvgDocument(project);
    expect(out).toContain('<linearGradient id="savig-grad-o1-fill"');
    expect(out).toContain('fill="url(#savig-grad-o1-fill)"');
    // Sampled at t=0 -> the FIRST keyframe's geometry (x2=0).
    expect(out).toContain('<linearGradient id="savig-grad-o1-fill" x1="0" y1="0" x2="0" y2="0">');
  });
});

describe('renderSvgDocument stroke dash', () => {
  it('bakes the t=0 dash offset + pathLength for an animated dashoffset object', () => {
    const project = createProject();
    project.assets.push(
      createVectorAsset('rect', {
        id: 'vd',
        style: { fill: 'none', stroke: '#000000', strokeWidth: 2, strokeDasharray: [1, 1] },
      }),
    );
    project.objects.push(
      createSceneObject('vd', {
        id: 'o1',
        anchorMode: 'fraction',
        shapeBase: { width: 100, height: 50 },
        base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        dashOffsetTrack: [
          { time: 0, value: 1, easing: 'linear' },
          { time: 2, value: 0, easing: 'linear' },
        ],
      }),
    );
    const out = renderSvgDocument(project);
    expect(out).toContain('pathLength="1"');
    expect(out).toContain('stroke-dasharray="1 1"');
    expect(out).toContain('stroke-dashoffset="1"'); // sampled at t=0
  });
});

describe('renderSvgDocument morphed path', () => {
  it('renders the sampled-at-0 path d for a morphed path', () => {
    const base = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 1, y: 0 } }] };
    const shapeTrack: ShapeKeyframe[] = [
      { time: 0, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 9, y: 0 } }] } },
      { time: 1, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] } },
    ];
    const asset = createVectorAsset('path', { path: base });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', shapeTrack });
    const project: Project = { ...createProject(), assets: [asset], objects: [obj] };
    const svg = renderSvgDocument(project);
    expect(svg).toContain(`d="${pathToD(samplePath(shapeTrack, 0))}"`);
    expect(svg).not.toContain(`d="${pathToD(base)}"`);
  });
});

it('omits a hidden object (and its gradient def) from the export', () => {
  const grad = {
    type: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 0,
    stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
  };
  const project = createProject();
  project.assets.push(
    createVectorAsset('rect', { id: 'vh', style: { fill: '#000000', stroke: 'none', strokeWidth: 0, fillGradient: grad } }),
  );
  project.objects.push(
    createSceneObject('vh', {
      id: 'o1',
      hidden: true,
      anchorMode: 'fraction',
      shapeBase: { width: 50, height: 50 },
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    }),
  );
  const out = renderSvgDocument(project);
  expect(out).not.toContain('data-savig-object="o1"');
  expect(out).not.toContain('<linearGradient id="savig-grad-o1-fill"');
});

it('does not emit a symbol def for an svg asset referenced only by a hidden object', () => {
  const svgAsset = {
    id: 'sv',
    kind: 'svg' as const,
    name: 'box',
    normalizedContent: '<svg/>',
    viewBox: '0 0 1 1',
    width: 1,
    height: 1,
  };
  const project = createProject();
  project.assets.push(svgAsset);
  project.objects.push(createSceneObject('sv', { id: 'h1', hidden: true }));
  const out = renderSvgDocument(project);
  expect(out).not.toContain('savig-asset-sv'); // no orphaned <symbol>/<svg> def

  // But a second VISIBLE object sharing the asset keeps the def.
  project.objects.push(createSceneObject('sv', { id: 'v2' }));
  const out2 = renderSvgDocument(project);
  expect(out2).toContain('savig-asset-sv');
});

describe('group containers (slice 45)', () => {
  it('emits no element for a group and prepends the group transform to its child', () => {
    const project = createProject();
    project.assets.push({
      id: 'svg1', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1,
    } as SvgAsset);
    const g = createGroupObject({ id: 'g1', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.base = { ...g.base, x: 10, y: 20 };
    const child = createSceneObject('svg1', { id: 'c1', parentId: 'g1', base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    project.objects.push(g, child);
    const svg = renderSvgDocument(project);
    expect(svg).not.toContain('data-savig-object="g1"'); // no group element
    const m = /data-savig-object="c1"[^>]*transform="([^"]*)"/.exec(svg)!;
    expect(m[1].startsWith('translate(10, 20)')).toBe(true); // group prefix first
    expect(m[1]).toContain('translate(5, 7)');
  });
});
