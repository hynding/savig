import { describe, expect, it, vi } from 'vitest';
import {
  createGroupObject,
  createProject,
  createSceneObject,
  createSymbolAsset,
  createTextAsset,
  createVectorAsset,
  pathToD,
  samplePath,
  type InstanceLeaf,
  type Project,
  type Scene,
  type ShapeKeyframe,
  type SvgAsset,
} from '@savig/engine';
import * as engine from '@savig/engine';
import { MissingAssetError } from '../errors';
import { computeFrame } from '@savig/runtime/frame';
import { renderSvgDocument, renderSceneBody, renderProjectDocument } from './renderDocument';

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

describe('group visibility cascade (slice 45c)', () => {
  it('omits the children of a hidden group from the export', () => {
    const project = createProject();
    project.assets.push({ id: 'svg1', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 } as SvgAsset);
    const g = createGroupObject({ id: 'g1', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.hidden = true;
    const child = createSceneObject('svg1', { id: 'c1', parentId: 'g1' });
    project.objects.push(g, child);
    expect(renderSvgDocument(project)).not.toContain('data-savig-object="c1"'); // child hidden via the group
  });
});

describe('group visibility cascade — defs orphan (slice 45c review)', () => {
  it('omits the symbol def for an svg asset used only by a child of a hidden group', () => {
    const project = createProject();
    project.assets.push({ id: 'only', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 } as SvgAsset);
    const g = createGroupObject({ id: 'g1', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.hidden = true;
    const child = createSceneObject('only', { id: 'c1', parentId: 'g1' });
    project.objects.push(g, child);
    const svg = renderSvgDocument(project);
    expect(svg).not.toContain('id="savig-asset-only"'); // no orphaned <defs> symbol
    expect(svg).not.toContain('data-savig-object="c1"');
  });
});

describe('renderSvgDocument compound rings (slice 46)', () => {
  it('emits a path with fill-rule evenodd and a subpath per compound ring', () => {
    const square = (s: number, off: number) => ({
      closed: true,
      nodes: [
        { anchor: { x: off, y: off } },
        { anchor: { x: off + s, y: off } },
        { anchor: { x: off + s, y: off + s } },
        { anchor: { x: off, y: off + s } },
      ],
    });
    const asset = createVectorAsset('path', {
      id: 'bool1',
      path: square(30, 0),
      compoundRings: [square(10, 10)],
      style: { fill: '#000', stroke: 'none', strokeWidth: 1 },
    });
    const project = createProject({ width: 100, height: 80 });
    project.assets.push(asset);
    project.objects.push(
      createSceneObject('bool1', { id: 'objB', zOrder: 0, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
    );
    const out = renderSvgDocument(project);
    expect(out).toContain('fill-rule="evenodd"');
    const path = out.slice(out.indexOf('<path'));
    const d = path.match(/d="([^"]*)"/)?.[1] ?? '';
    expect((d.match(/M /g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('symbol instances (slice 47a)', () => {
  it('static symbol instance: emits a <use> element; instance transform is correctly composed (export parity 47g)', () => {
    // A static symbol (no keyframes) is optimized: the instance becomes a <use> whose transform
    // matches the instance's world transform (instTransform), NOT the individual leaf transform.
    // computeFrame still reports leaf-level objectIds for animation queries, but the export body
    // uses a <use> element for visual placement.
    const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 1 });
    innerObj.shapeBase = { width: 10, height: 10 };
    const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
    const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1 });
    instance.base.x = 50;
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [instance];
    const svg = renderSvgDocument(p);
    // Static optimization: <use> in body, leaf inside def only
    expect(svg).toContain('data-savig-object="inst"');
    expect(svg).toContain('href="#savig-sym-sym-1"');
    // The <use> transform places the instance at x=50
    const useIdx = svg.indexOf('data-savig-object="inst"');
    const nearUse = svg.slice(Math.max(0, useIdx - 100), useIdx + 300);
    expect(nearUse).toContain('translate(50, 0)');
    // The leaf appears in the def (not the body)
    const defsEnd = svg.indexOf('</defs>');
    const defsBlock = svg.slice(0, defsEnd);
    expect(defsBlock).toContain('data-savig-object="inner"');
  });

  it('animated symbol instance: emits leaf elements with composite ids (export parity)', () => {
    // An animated symbol (has keyframes) falls through to inlining. The instance id is prefixed
    // onto each leaf's renderId. computeFrame parity: leaf transforms must match.
    const inner = createVectorAsset('rect', { id: 'asset-inner2', shapeType: 'rect' });
    const innerObj = createSceneObject('asset-inner2', { id: 'inner2', name: 'inner2', zOrder: 1 });
    innerObj.shapeBase = { width: 10, height: 10 };
    innerObj.tracks = { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 100, easing: 'linear' }] };
    const sym = createSymbolAsset({ id: 'sym-anim-47a', objects: [innerObj] });
    const instance = createSceneObject('sym-anim-47a', { id: 'inst47a', name: 'inst47a', zOrder: 1 });
    instance.base.x = 50;
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [instance];
    const svg = renderSvgDocument(p);
    // Animated: still inlined (no <use> optimization)
    expect(svg).toContain('data-savig-object="inst47a/inner2"');
    expect(svg).not.toContain('href="#savig-sym-sym-anim-47a"');
    const item = computeFrame(p, 0).find((i) => i.objectId === 'inst47a/inner2')!;
    expect(svg).toContain(`transform="${item.transform}"`);
  });

  it('a timed instance keeps export==computeFrame parity (slice 47c)', () => {
    const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 1 });
    innerObj.shapeBase = { width: 10, height: 10 };
    innerObj.tracks = { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 100, easing: 'linear' }] };
    const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
    const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1 });
    instance.symbolTime = { startOffset: 0.3, loop: true, speed: 1 };
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [instance];
    const svg = renderSvgDocument(p);
    // symbolTime is set → excluded from static optimization → stays inlined
    const item = computeFrame(p, 0).find((i) => i.objectId === 'inst/inner')!;
    expect(svg).toContain(`transform="${item.transform}"`);
  });

  it('two static instances of one symbol both render (instancing, 47g optimized)', () => {
    // Both static instances → two <use> elements sharing one savig-sym def.
    const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 1 });
    innerObj.shapeBase = { width: 10, height: 10 };
    const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
    const a = createSceneObject('sym-1', { id: 'a', name: 'a', zOrder: 1 });
    const b = createSceneObject('sym-1', { id: 'b', name: 'b', zOrder: 2 });
    b.base.x = 80;
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [a, b];
    const svg = renderSvgDocument(p);
    // Both instances appear as <use> elements
    expect(svg).toContain('data-savig-object="a"');
    expect(svg).toContain('data-savig-object="b"');
    // One def, two uses
    expect((svg.match(/href="#savig-sym-sym-1"/g) ?? []).length).toBe(2);
    expect((svg.match(/id="savig-sym-sym-1"/g) ?? []).length).toBe(1);
  });
});

describe('renderSvgDocument viewBox override (thumbnails, 47d)', () => {
  it('honors an explicit viewBox', () => {
    const p = createProject();
    const svg = renderSvgDocument(p, { viewBox: '5 6 7 8' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 6 7 8">')).toBe(true);
  });

  it('defaults to "0 0 W H" when no opts (export unchanged)', () => {
    const p = createProject();
    const svg = renderSvgDocument(p);
    expect(svg).toContain(`viewBox="0 0 ${p.meta.width} ${p.meta.height}"`);
  });
});

describe('renderSvgDocument — live boolean', () => {
  function liveBoolProject(op: 'union' | 'subtract', smallInterior = false) {
    const aAsset = createVectorAsset('rect', { id: 'a-asset' });
    const bAsset = createVectorAsset('rect', { id: 'b-asset' });
    const boolAsset = createVectorAsset('path', { id: 'bool-asset', path: { nodes: [], closed: false } });
    const a = createSceneObject('a-asset', { id: 'opA', zOrder: 0, shapeBase: { width: 40, height: 40 } });
    const b = createSceneObject('b-asset', {
      id: 'opB', zOrder: 1, shapeBase: smallInterior ? { width: 10, height: 10 } : { width: 40, height: 40 },
      base: { x: smallInterior ? 15 : 20, y: smallInterior ? 15 : 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const boolObj = createSceneObject('bool-asset', { id: 'boolobj', zOrder: 2, boolean: { op, operandIds: ['opA', 'opB'] } });
    const project = createProject();
    project.assets = [aAsset, bAsset, boolAsset];
    project.objects = [a, b, boolObj];
    return project;
  }

  it('emits a boolean <path> with evenodd + non-empty d; operands are not in the markup', () => {
    const out = renderSvgDocument(liveBoolProject('union'));
    expect(out).toContain('data-savig-object="boolobj"');
    // same <path>: non-empty d AND evenodd (renderShapeToSvg emits d before fill-rule)
    expect(out).toMatch(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*\bd="M[^"]+"[^>]*fill-rule="evenodd"/);
    expect(out).not.toContain('data-savig-object="opA"');
    expect(out).not.toContain('data-savig-object="opB"');
  });

  it('a subtract with an interior operand emits a compound d (>=2 subpaths)', () => {
    const out = renderSvgDocument(liveBoolProject('subtract', true));
    const m = out.match(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*\bd="([^"]*)"/);
    expect(m).toBeTruthy();
    expect((m![1].match(/M/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('a degenerate boolean (non-overlapping intersect) emits an empty-d evenodd placeholder', () => {
    const aAsset = createVectorAsset('rect', { id: 'a2' });
    const bAsset = createVectorAsset('rect', { id: 'b2' });
    const boolAsset = createVectorAsset('path', { id: 'bool2', path: { nodes: [], closed: false } });
    const a = createSceneObject('a2', { id: 'opA', zOrder: 0, shapeBase: { width: 20, height: 20 } });
    const b = createSceneObject('b2', { id: 'opB', zOrder: 1, shapeBase: { width: 20, height: 20 }, base: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const boolObj = createSceneObject('bool2', { id: 'boolobj', zOrder: 2, boolean: { op: 'intersect', operandIds: ['opA', 'opB'] } });
    const project = createProject();
    project.assets = [aAsset, bAsset, boolAsset];
    project.objects = [a, b, boolObj];
    const out = renderSvgDocument(project);
    expect(out).toMatch(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*fill-rule="evenodd"[^>]*d=""/);
  });

  it('exports a live boolean with a GROUP operand: non-empty evenodd path, group leaves absent (3b)', () => {
    const g1 = createSceneObject('g1-a', { id: 'g1', parentId: 'grp', zOrder: 0, shapeBase: { width: 20, height: 40 } });
    const g2 = createSceneObject('g2-a', {
      id: 'g2', parentId: 'grp', zOrder: 1, shapeBase: { width: 20, height: 40 },
      base: { x: 20, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 0 });
    const cover = createSceneObject('cov-a', { id: 'cover', zOrder: 1, shapeBase: { width: 40, height: 40 } });
    const boolObj = createSceneObject('bg-a', { id: 'boolobj', zOrder: 2, boolean: { op: 'intersect', operandIds: ['grp', 'cover'] } });
    const project = createProject();
    project.assets = [
      createVectorAsset('rect', { id: 'g1-a' }),
      createVectorAsset('rect', { id: 'g2-a' }),
      createVectorAsset('rect', { id: 'cov-a' }),
      createVectorAsset('path', { id: 'bg-a', path: { nodes: [], closed: false } }),
    ];
    project.objects = [g1, g2, group, cover, boolObj];
    const out = renderSvgDocument(project);
    expect(out).toMatch(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*\bd="M[^"]+"[^>]*fill-rule="evenodd"/);
    expect(out).not.toContain('data-savig-object="g1"');
    expect(out).not.toContain('data-savig-object="g2"');
  });

  it('exports a live boolean with a NESTED boolean operand: non-empty path, inner subtree absent (3b)', () => {
    // inner = subtract(big 0..40, small interior); outer = union(inner, far disjoint rect).
    const big = createSceneObject('big-a', { id: 'big', zOrder: 0, shapeBase: { width: 40, height: 40 } });
    const small = createSceneObject('small-a', {
      id: 'small', zOrder: 1, shapeBase: { width: 10, height: 10 },
      base: { x: 15, y: 15, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const inner = createSceneObject('inner-a', { id: 'inner', zOrder: 2, boolean: { op: 'subtract', operandIds: ['big', 'small'] } });
    const far = createSceneObject('far-a', {
      id: 'far', zOrder: 3, shapeBase: { width: 10, height: 10 },
      base: { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const outer = createSceneObject('outer-a', { id: 'boolobj', zOrder: 4, boolean: { op: 'union', operandIds: ['inner', 'far'] } });
    const project = createProject();
    project.assets = [
      createVectorAsset('rect', { id: 'big-a' }),
      createVectorAsset('rect', { id: 'small-a' }),
      createVectorAsset('path', { id: 'inner-a', path: { nodes: [], closed: false } }),
      createVectorAsset('rect', { id: 'far-a' }),
      createVectorAsset('path', { id: 'outer-a', path: { nodes: [], closed: false } }),
    ];
    project.objects = [big, small, inner, far, outer];
    const out = renderSvgDocument(project);
    expect(out).toMatch(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*\bd="M[^"]+"[^>]*fill-rule="evenodd"/);
    expect(out).not.toContain('data-savig-object="inner"'); // inner boolean + its operands render-hidden
    expect(out).not.toContain('data-savig-object="big"');
  });
});

// ─── Static-symbol <use> export optimization (slice 47g) ────────────────────

describe('renderSvgDocument static-symbol <use> optimization (slice 47g)', () => {
  function makeStaticSymbolProject() {
    const inner = createVectorAsset('rect', { id: 'static-inner', shapeType: 'rect' });
    inner.style = { fill: '#0000ff', stroke: 'none', strokeWidth: 0 };
    const innerObj = createSceneObject('static-inner', {
      id: 'leaf1', name: 'leaf1', zOrder: 1,
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 30, height: 20 },
    });
    const sym = createSymbolAsset({ id: 'sym-static', objects: [innerObj], width: 100, height: 80 });
    const p = createProject({ width: 200, height: 100 });
    p.assets = [inner, sym];
    const instA = createSceneObject('sym-static', { id: 'instA', name: 'instA', zOrder: 1 });
    instA.base.x = 10;
    const instB = createSceneObject('sym-static', { id: 'instB', name: 'instB', zOrder: 2 });
    instB.base.x = 120;
    p.objects = [instA, instB];
    return p;
  }

  it('two static instances emit ONE savig-sym def and TWO <use> elements', () => {
    const out = renderSvgDocument(makeStaticSymbolProject());
    // Def appears exactly once in <defs>
    const defMatches = (out.match(/id="savig-sym-sym-static"/g) ?? []).length;
    expect(defMatches).toBe(1);
    // Two <use> elements for the two instances
    const useMatches = (out.match(/href="#savig-sym-sym-static"/g) ?? []).length;
    expect(useMatches).toBe(2);
  });

  it('static instances emit instance-level data-savig-object, not leaf-level', () => {
    const out = renderSvgDocument(makeStaticSymbolProject());
    // The <use> elements carry the instance ids
    expect(out).toContain('data-savig-object="instA"');
    expect(out).toContain('data-savig-object="instB"');
    // Leaf-level ids must NOT appear in the body (they live inside the def)
    const bodyPart = out.slice(out.indexOf('</defs>'));
    expect(bodyPart).not.toContain('data-savig-object="instA/leaf1"');
    expect(bodyPart).not.toContain('data-savig-object="instB/leaf1"');
  });

  it('the <use> transform matches the instance world transform (translate)', () => {
    const out = renderSvgDocument(makeStaticSymbolProject());
    // instA is at x=10 → translate(10, 0)
    // Find the <use> for instA
    const useAIdx = out.indexOf('data-savig-object="instA"');
    expect(useAIdx).toBeGreaterThanOrEqual(0);
    const nearUse = out.slice(Math.max(0, useAIdx - 100), useAIdx + 200);
    expect(nearUse).toContain('translate(10, 0)');
    // instB is at x=120 → translate(120, 0)
    const useBIdx = out.indexOf('data-savig-object="instB"');
    const nearUseB = out.slice(Math.max(0, useBIdx - 100), useBIdx + 200);
    expect(nearUseB).toContain('translate(120, 0)');
  });

  it('the static symbol def is inside <defs>', () => {
    const out = renderSvgDocument(makeStaticSymbolProject());
    const defsStart = out.indexOf('<defs>');
    const defsEnd = out.indexOf('</defs>');
    const defsBlock = out.slice(defsStart, defsEnd);
    expect(defsBlock).toContain('id="savig-sym-sym-static"');
  });

  it('static symbol def contains the leaf shape content', () => {
    const out = renderSvgDocument(makeStaticSymbolProject());
    const defsEnd = out.indexOf('</defs>');
    const defsBlock = out.slice(0, defsEnd);
    // The leaf's rect shape should appear inside the def
    expect(defsBlock).toContain('data-savig-object="leaf1"');
  });

  it('output is deterministic (two calls = same string)', () => {
    const p = makeStaticSymbolProject();
    expect(renderSvgDocument(p)).toBe(renderSvgDocument(p));
  });

  it('animated symbol stays inlined (no <use> optimization)', () => {
    const inner = createVectorAsset('rect', { id: 'anim-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('anim-inner', {
      id: 'aleaf', name: 'aleaf', zOrder: 1,
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 20, height: 20 },
    });
    // Animated: has keyframe tracks
    innerObj.tracks = { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 50, easing: 'linear' }] };
    const sym = createSymbolAsset({ id: 'sym-anim', objects: [innerObj] });
    const p = createProject();
    p.assets = [inner, sym];
    const inst = createSceneObject('sym-anim', { id: 'animInst', zOrder: 1 });
    p.objects = [inst];
    const out = renderSvgDocument(p);
    // Must NOT emit a <use> for the symbol
    expect(out).not.toContain('href="#savig-sym-sym-anim"');
    expect(out).not.toContain('id="savig-sym-sym-anim"');
    // Must inline the leaf
    expect(out).toContain('data-savig-object="animInst/aleaf"');
  });

  it('tinted static instance falls back to inlining (v1 deferral)', () => {
    const inner = createVectorAsset('rect', { id: 'tint-s-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('tint-s-inner', { id: 'tsleaf', zOrder: 1, shapeBase: { width: 10, height: 10 }, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym-tints', objects: [innerObj] });
    const p = createProject();
    p.assets = [inner, sym];
    const inst = createSceneObject('sym-tints', { id: 'tintInst', zOrder: 1 });
    inst.tint = { color: '#ff0000', amount: 0.5 }; // tinted → excluded from optimization
    p.objects = [inst];
    const out = renderSvgDocument(p);
    expect(out).not.toContain('href="#savig-sym-sym-tints"');
    expect(out).toContain('data-savig-object="tintInst/tsleaf"'); // still inlined
  });

  it('clipped static instance falls back to inlining (v1 deferral)', () => {
    const inner = createVectorAsset('rect', { id: 'clip-s-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('clip-s-inner', { id: 'csleaf', zOrder: 1, shapeBase: { width: 10, height: 10 }, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym-clips', objects: [innerObj], width: 60, height: 40 });
    (sym as import('@savig/engine').SymbolAsset).clip = true; // clipping → excluded from optimization
    const p = createProject();
    p.assets = [inner, sym];
    const inst = createSceneObject('sym-clips', { id: 'clipInst', zOrder: 1 });
    p.objects = [inst];
    const out = renderSvgDocument(p);
    expect(out).not.toContain('href="#savig-sym-sym-clips"');
    expect(out).toContain('data-savig-object="clipInst/csleaf"'); // still inlined
  });

  it('symbolTime instance falls back to inlining (conservative exclusion)', () => {
    const inner = createVectorAsset('rect', { id: 'st-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('st-inner', { id: 'stleaf', zOrder: 1, shapeBase: { width: 10, height: 10 }, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym-st', objects: [innerObj] });
    const p = createProject();
    p.assets = [inner, sym];
    const inst = createSceneObject('sym-st', { id: 'stInst', zOrder: 1 });
    inst.symbolTime = { startOffset: 0, loop: false, speed: 1 }; // non-default timing → excluded
    p.objects = [inst];
    const out = renderSvgDocument(p);
    expect(out).not.toContain('href="#savig-sym-sym-st"');
    expect(out).toContain('data-savig-object="stInst/stleaf"');
  });

  it('freezeFirstFrame instance falls back to inlining (conservative exclusion)', () => {
    const inner = createVectorAsset('rect', { id: 'ff-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('ff-inner', { id: 'ffleaf', zOrder: 1, shapeBase: { width: 10, height: 10 }, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym-ff', objects: [innerObj] });
    const p = createProject();
    p.assets = [inner, sym];
    const inst = createSceneObject('sym-ff', { id: 'ffInst', zOrder: 1 });
    inst.freezeFirstFrame = true;
    p.objects = [inst];
    const out = renderSvgDocument(p);
    expect(out).not.toContain('href="#savig-sym-sym-ff"');
    expect(out).toContain('data-savig-object="ffInst/ffleaf"');
  });

  it('mixed project: static instance gets <use>, animated instance gets inline', () => {
    // Static symbol
    const sInner = createVectorAsset('rect', { id: 'mix-s-inner', shapeType: 'rect' });
    const sLeaf = createSceneObject('mix-s-inner', { id: 'msleaf', zOrder: 1, shapeBase: { width: 10, height: 10 }, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const staticSym = createSymbolAsset({ id: 'mix-sym-static', objects: [sLeaf] });
    // Animated symbol
    const aInner = createVectorAsset('rect', { id: 'mix-a-inner', shapeType: 'rect' });
    const aLeaf = createSceneObject('mix-a-inner', { id: 'maleaf', zOrder: 1, shapeBase: { width: 10, height: 10 }, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    aLeaf.tracks = { y: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 50, easing: 'linear' }] };
    const animSym = createSymbolAsset({ id: 'mix-sym-anim', objects: [aLeaf] });
    const p = createProject();
    p.assets = [sInner, staticSym, aInner, animSym];
    const sInst = createSceneObject('mix-sym-static', { id: 's-inst', zOrder: 1 });
    const aInst = createSceneObject('mix-sym-anim', { id: 'a-inst', zOrder: 2, base: { x: 50, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    p.objects = [sInst, aInst];
    const out = renderSvgDocument(p);
    // Static: optimized
    expect(out).toContain('href="#savig-sym-mix-sym-static"');
    expect(out).toContain('data-savig-object="s-inst"');
    // Animated: inlined
    expect(out).not.toContain('href="#savig-sym-mix-sym-anim"');
    expect(out).toContain('data-savig-object="a-inst/maleaf"');
  });

  it('boolean object inside a static symbol renders correctly (not as empty path)', () => {
    // CRITICAL regression guard: resolveBooleanRings must use the symbol-local objects
    // (not the root project.objects) when the boolean node is inside a static symbol def.
    const aAsset = createVectorAsset('rect', { id: 'bool-a-asset' });
    const bAsset = createVectorAsset('rect', { id: 'bool-b-asset' });
    const boolAsset = createVectorAsset('path', { id: 'bool-result-asset', path: { nodes: [], closed: false } });
    const a = createSceneObject('bool-a-asset', { id: 'boolOpA', zOrder: 0, shapeBase: { width: 40, height: 40 } });
    const b = createSceneObject('bool-b-asset', { id: 'boolOpB', zOrder: 1, shapeBase: { width: 40, height: 40 }, base: { x: 20, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const boolObj = createSceneObject('bool-result-asset', { id: 'boolNode', zOrder: 2, boolean: { op: 'union', operandIds: ['boolOpA', 'boolOpB'] } });
    const sym = createSymbolAsset({ id: 'sym-with-bool', objects: [a, b, boolObj] });
    const p = createProject();
    p.assets = [aAsset, bAsset, boolAsset, sym];
    const inst = createSceneObject('sym-with-bool', { id: 'boolSymInst', zOrder: 1 });
    p.objects = [inst];
    const out = renderSvgDocument(p);
    // Should be optimized (symbol is static: no keyframe tracks on objects)
    expect(out).toContain('href="#savig-sym-sym-with-bool"');
    // The boolean shape inside the def must NOT be empty — it should have a non-empty d attribute
    const defsEnd = out.indexOf('</defs>');
    const defsBlock = out.slice(0, defsEnd);
    expect(defsBlock).toContain('data-savig-object="boolNode"');
    // The boolean is a union of two overlapping rects → non-empty path (d="M...")
    const m = defsBlock.match(/data-savig-object="boolNode"[^>]*>\s*<path[^>]*\bd="([^"]*)"/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/^M/); // non-empty path data
  });

  it('SVG-asset leaf inside a static symbol def emits correctly', () => {
    // IMPORTANT: SVG-asset leaves inside a static symbol should render as <use href="#savig-asset-...">
    // and the SVG asset def should still be emitted in <defs>.
    const svgAsset: SvgAsset = {
      id: 'inner-svg-asset',
      kind: 'svg',
      name: 'icon.svg',
      normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>',
      viewBox: '0 0 10 10',
      width: 10,
      height: 10,
    };
    const innerObj = createSceneObject('inner-svg-asset', { id: 'svgLeaf', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym-with-svg', objects: [innerObj] });
    const p = createProject();
    p.assets = [svgAsset, sym];
    const inst = createSceneObject('sym-with-svg', { id: 'svgSymInst', zOrder: 1 });
    p.objects = [inst];
    const out = renderSvgDocument(p);
    // Optimized
    expect(out).toContain('href="#savig-sym-sym-with-svg"');
    // SVG asset def must still be emitted (even though its flattenInstances leaves are skipped)
    expect(out).toContain('id="savig-asset-inner-svg-asset"');
    // The def's content should have a <use> pointing at the svg asset
    const defsEnd = out.indexOf('</defs>');
    const defsBlock = out.slice(0, defsEnd);
    expect(defsBlock).toContain('href="#savig-asset-inner-svg-asset"');
  });

  it('gradient inside a static symbol def uses leaf-id-based gradient ids (not instance-prefixed)', () => {
    const grad = { type: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };
    const inner = createVectorAsset('rect', { id: 'grad-s-inner', shapeType: 'rect', style: { fill: '#000', stroke: 'none', strokeWidth: 0, fillGradient: grad } });
    const innerObj = createSceneObject('grad-s-inner', { id: 'gradleaf', zOrder: 1, shapeBase: { width: 30, height: 20 }, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym-grad', objects: [innerObj] });
    const p = createProject();
    p.assets = [inner, sym];
    const inst = createSceneObject('sym-grad', { id: 'gradInst', zOrder: 1 });
    p.objects = [inst];
    const out = renderSvgDocument(p);
    // The <use> should be emitted
    expect(out).toContain('href="#savig-sym-sym-grad"');
    // A gradient def should appear (in defs)
    expect(out).toContain('savig-grad-gradleaf-fill');
  });
});

describe('renderSvgDocument — symbol clip (slice 47e)', () => {
  function makeClipProject(clip: boolean) {
    const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('asset-inner', {
      id: 'inner', name: 'inner', zOrder: 1,
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 10, height: 10 },
    });
    const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 60, height: 40 });
    if (clip) (sym as import('@savig/engine').SymbolAsset).clip = true;
    const p = createProject();
    p.assets = [inner, sym];
    const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1 });
    instance.base.x = 20;
    instance.base.y = 10;
    p.objects = [instance];
    return p;
  }

  it('a non-clipping symbol renders with no <clipPath> (parity)', () => {
    const out = renderSvgDocument(makeClipProject(false));
    expect(out).not.toContain('<clipPath');
    expect(out).not.toContain('clip-path');
  });

  it('a clipping symbol emits a <clipPath> def with the symbol dimensions', () => {
    const out = renderSvgDocument(makeClipProject(true));
    expect(out).toContain('<clipPath id="clip-inst"');
    expect(out).toContain('width="60"');
    expect(out).toContain('height="40"');
  });

  it('the clipPath rect carries the instance transform', () => {
    const out = renderSvgDocument(makeClipProject(true));
    // The instance is at x=20, y=10 → translate(20, 10) in the rect transform
    const clipSection = out.slice(out.indexOf('<clipPath id="clip-inst"'));
    expect(clipSection).toContain('translate(20, 10)');
  });

  it('a clipping symbol wraps its leaves in a <g clip-path="url(#clip-inst)">', () => {
    const out = renderSvgDocument(makeClipProject(true));
    expect(out).toContain('clip-path="url(#clip-inst)"');
    // The leaf is inside the wrapping <g>
    const wrapIdx = out.indexOf('clip-path="url(#clip-inst)"');
    const leafIdx = out.indexOf('data-savig-object="inst/inner"');
    expect(wrapIdx).toBeGreaterThanOrEqual(0);
    expect(leafIdx).toBeGreaterThan(wrapIdx);
  });

  it('two instances of a clipping symbol get distinct clipPath ids', () => {
    const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
    const innerObj = createSceneObject('asset-inner', {
      id: 'inner', name: 'inner', zOrder: 1,
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 10, height: 10 },
    });
    const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 60, height: 40 });
    (sym as import('@savig/engine').SymbolAsset).clip = true;
    const p = createProject();
    p.assets = [inner, sym];
    const a = createSceneObject('sym-1', { id: 'a', name: 'a', zOrder: 1 });
    const b = createSceneObject('sym-1', { id: 'b', name: 'b', zOrder: 2 });
    b.base.x = 80;
    p.objects = [a, b];
    const out = renderSvgDocument(p);
    expect(out).toContain('<clipPath id="clip-a"');
    expect(out).toContain('<clipPath id="clip-b"');
    expect(out).toContain('clip-path="url(#clip-a)"');
    expect(out).toContain('clip-path="url(#clip-b)"');
    expect(out).toContain('data-savig-object="a/inner"');
    expect(out).toContain('data-savig-object="b/inner"');
  });

  it('output is deterministic (same call twice = same string)', () => {
    const p = makeClipProject(true);
    expect(renderSvgDocument(p)).toBe(renderSvgDocument(p));
  });
});

// ─── Per-instance tint (slice 47f) ──────────────────────────────────────────

describe('renderSvgDocument tint (slice 47f)', () => {
  function makeTintProject(tint?: { color: string; amount: number }) {
    const inner = createVectorAsset('rect', { id: 'tint-inner', shapeType: 'rect' });
    inner.style = { fill: '#0000ff', stroke: 'none', strokeWidth: 0 };
    const innerObj = createSceneObject('tint-inner', {
      id: 'inner', name: 'inner', zOrder: 1,
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 60, height: 40 },
    });
    const sym = createSymbolAsset({ id: 'sym-tint', objects: [innerObj], width: 60, height: 40 });
    const p = createProject();
    p.assets = [inner, sym];
    const inst = createSceneObject('sym-tint', { id: 'inst', name: 'inst', zOrder: 1 });
    if (tint) inst.tint = tint;
    p.objects = [inst];
    return p;
  }

  it('no tint: output has no savig-tint filter (parity)', () => {
    const out = renderSvgDocument(makeTintProject());
    expect(out).not.toContain('savig-tint');
    expect(out).not.toContain('<filter');
    expect(out).not.toContain('feFlood');
  });

  it('tinted instance: output contains a savig-tint filter def in <defs>', () => {
    const out = renderSvgDocument(makeTintProject({ color: '#ff0000', amount: 0.5 }));
    expect(out).toContain('<filter id="savig-tint-inst"');
    expect(out).toContain('feFlood');
    expect(out).toContain('feComposite');
    expect(out).toContain('feBlend');
    expect(out).toContain('flood-color="#ff0000"');
    expect(out).toContain('flood-opacity="0.5"');
  });

  it('tinted instance: output contains a <g filter="url(#savig-tint-inst)"> wrapper', () => {
    const out = renderSvgDocument(makeTintProject({ color: '#ff0000', amount: 0.5 }));
    expect(out).toContain('filter="url(#savig-tint-inst)"');
    // The leaf is inside the tint wrapper
    const wrapIdx = out.indexOf('filter="url(#savig-tint-inst)"');
    const leafIdx = out.indexOf('data-savig-object="inst/inner"');
    expect(wrapIdx).toBeGreaterThanOrEqual(0);
    expect(leafIdx).toBeGreaterThan(wrapIdx);
  });

  it('tinted instance: filter uses multiply blend mode', () => {
    const out = renderSvgDocument(makeTintProject({ color: '#aabbcc', amount: 0.7 }));
    expect(out).toContain('mode="multiply"');
  });

  it('tinted instance with amount=0: still emits filter (rendering layer is consistent)', () => {
    // amount=0 tint is passed through; the filter has no visual effect but is structurally present.
    const out = renderSvgDocument(makeTintProject({ color: '#ff0000', amount: 0 }));
    expect(out).toContain('<filter id="savig-tint-inst"');
    expect(out).toContain('flood-opacity="0"');
  });

  it('two tinted instances of the same symbol get distinct filter ids', () => {
    const inner = createVectorAsset('rect', { id: 'ti2-inner', shapeType: 'rect' });
    inner.style = { fill: '#0000ff', stroke: 'none', strokeWidth: 0 };
    const innerObj = createSceneObject('ti2-inner', {
      id: 'i2', name: 'inner', zOrder: 1,
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 60, height: 40 },
    });
    const sym = createSymbolAsset({ id: 'ti2-sym', objects: [innerObj], width: 60, height: 40 });
    const p = createProject();
    p.assets = [inner, sym];
    const a = createSceneObject('ti2-sym', { id: 'tiA', name: 'A', zOrder: 1 });
    const b = createSceneObject('ti2-sym', { id: 'tiB', name: 'B', zOrder: 2 });
    a.tint = { color: '#ff0000', amount: 0.5 };
    b.tint = { color: '#0000ff', amount: 0.8 };
    b.base.x = 80;
    p.objects = [a, b];
    const out = renderSvgDocument(p);
    expect(out).toContain('<filter id="savig-tint-tiA"');
    expect(out).toContain('<filter id="savig-tint-tiB"');
    expect(out).toContain('filter="url(#savig-tint-tiA)"');
    expect(out).toContain('filter="url(#savig-tint-tiB)"');
    expect(out).toContain('data-savig-object="tiA/i2"');
    expect(out).toContain('data-savig-object="tiB/i2"');
  });

  it('tinted instance renders the same as non-tinted at t=0 minus the filter wrapper (structural parity)', () => {
    const outTinted = renderSvgDocument(makeTintProject({ color: '#ff0000', amount: 0.5 }));
    const outPlain = renderSvgDocument(makeTintProject());
    // Tinted instance: falls back to inlining (v1 deferral) → leaf appears in body
    expect(outTinted).toContain('data-savig-object="inst/inner"');
    // Plain (no tint, static symbol): static-<use> optimization fires → instance appears as <use>
    // The leaf is inside the def, not the body.
    expect(outPlain).toContain('data-savig-object="inst"'); // the <use> element
    expect(outPlain).toContain('href="#savig-sym-sym-tint"'); // pointing at the static def
    // The plain version has no filter
    expect(outPlain).not.toContain('savig-tint');
    // The tinted version has the filter
    expect(outTinted).toContain('savig-tint');
  });

  it('output with tint is deterministic (same call twice = same string)', () => {
    const p = makeTintProject({ color: '#ff0000', amount: 0.5 });
    expect(renderSvgDocument(p)).toBe(renderSvgDocument(p));
  });
});

// ─── Tint/clip XSS regression (security review) ─────────────────────────────
// The export path used to interpolate tint/clip values into raw HTML strings with
// no escaping — the same bug class as the (now-fixed) Stage.tsx dangerouslySetInnerHTML
// hole. These prove a hostile value lands as an escaped attribute, never as markup.
describe('renderSvgDocument — tint/clip XSS regression (security review)', () => {
  const HOSTILE = '"><image href=x onerror=alert(1)>';
  const ESCAPED = '&quot;&gt;&lt;image href=x onerror=alert(1)&gt;';

  it('a hostile tint.color/tint.amount is escaped as an attribute value, not injected as markup', () => {
    // tint.color/amount come straight from SceneObject.tint (types.ts:191), never
    // runtime-validated — a crafted .savig can set them to anything, reachable via a
    // completely ordinary per-instance override (no engine bypass needed).
    const inner = createVectorAsset('rect', { id: 'xss-tint-inner', shapeType: 'rect' });
    inner.style = { fill: '#0000ff', stroke: 'none', strokeWidth: 0 };
    const innerObj = createSceneObject('xss-tint-inner', {
      id: 'inner', name: 'inner', zOrder: 1,
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 60, height: 40 },
    });
    const sym = createSymbolAsset({ id: 'sym-xss-tint', objects: [innerObj], width: 60, height: 40 });
    const p = createProject();
    p.assets = [inner, sym];
    const inst = createSceneObject('sym-xss-tint', { id: 'inst', name: 'inst', zOrder: 1 });
    inst.tint = { color: HOSTILE, amount: 1 };
    p.objects = [inst];

    const out = renderSvgDocument(p);
    expect(out).not.toContain('<image');
    expect(out).toContain(`flood-color="${ESCAPED}"`);
    expect(out).toContain('flood-opacity="1"');
  });

  it('a hostile clipId/clipTransform is escaped as an attribute value, not injected as markup (defense in depth)', () => {
    // Unlike tint.color, clipId/clipTransform are engine-derived (buildTransform's numeric-only
    // output today, per fmt()'s finite-value guard) rather than settable via a normal SceneObject
    // field — flattenInstances is mocked here so this regression test exercises the export's
    // raw-string clip defs/wrapper build directly with a hostile value, proving the fix holds
    // regardless of how the value reaches it (defense in depth, matching the same escaping
    // discipline as the tint filter above).
    const asset = createVectorAsset('rect', { id: 'xss-clip-asset', shapeType: 'rect' });
    const obj = createSceneObject('xss-clip-asset', { id: 'r', zOrder: 0, shapeBase: { width: 10, height: 10 } });
    const p = createProject();
    p.assets = [asset];
    p.objects = [obj];

    const hostileLeaf: InstanceLeaf = {
      renderId: 'r',
      object: obj,
      transformPrefix: '',
      opacityFactor: 1,
      localTime: 0,
      clipId: HOSTILE,
      clipTransform: HOSTILE,
      clipWidth: 10,
      clipHeight: 10,
    };
    const spy = vi.spyOn(engine, 'flattenInstances').mockReturnValue([hostileLeaf]);
    try {
      const out = renderSvgDocument(p);
      expect(out).not.toContain('<image');
      expect(out).toContain(`<clipPath id="${ESCAPED}"`);
      expect(out).toContain(`transform="${ESCAPED}"`);
      expect(out).toContain(`clip-path="url(#${ESCAPED})"`);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('renderSceneBody — scene id prefixing (8b-2a)', () => {
  it('prefixes data-savig-object and gradient def ids with "<sceneId>:" when sceneId is set', () => {
    // a rect with an animated/explicit fill gradient (exercises the gradient-id derivation)
    const asset = createVectorAsset('rect', { id: 'rectA' });
    asset.style.fillGradient = { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [
      { offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' } ] };
    const obj = createSceneObject('rectA', { id: 'r1' });
    const project = { ...createProject(), assets: [asset], objects: [obj] };

    const { body, localDefs } = renderSceneBody(project, 'sc1');
    expect(body).toContain('data-savig-object="sc1:r1"');
    expect(localDefs).toContain('savig-grad-sc1:r1-fill'); // matches runtime computeFrame objectId "sc1:r1"
    expect(body).toContain('url(#savig-grad-sc1:r1-fill)');
  });

  it('sceneId=null leaves ids unprefixed (parity path)', () => {
    const asset = createVectorAsset('rect', { id: 'rectA' });
    const obj = createSceneObject('rectA', { id: 'r1' });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    const { body } = renderSceneBody(project, null);
    expect(body).toContain('data-savig-object="r1"');
    expect(body).not.toContain(':r1"');
  });
});

describe('renderProjectDocument — multi-scene (8b-2b)', () => {
  function twoSceneProject() {
    const a = createVectorAsset('rect', { id: 'aRect' });
    const b = createVectorAsset('rect', { id: 'bRect' });
    const scenes: Scene[] = [
      { id: 'scA', name: 'A', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 2 },
      { id: 'scB', name: 'B', objects: [createSceneObject('bRect', { id: 'ob' })], duration: 2 },
    ];
    return { ...createProject(), assets: [a, b], objects: [], scenes };
  }

  it('single-scene project delegates to renderSvgDocument (byte-identical)', () => {
    const asset = createVectorAsset('rect', { id: 'r' });
    const p = { ...createProject(), assets: [asset], objects: [createSceneObject('r', { id: 'o' })] };
    expect(renderProjectDocument(p)).toBe(renderSvgDocument(p));
  });

  it('emits one <g data-savig-scene> per scene; first visible, rest hidden', () => {
    const out = renderProjectDocument(twoSceneProject());
    expect(out).toContain('<g data-savig-scene="scA"');
    expect(out).toContain('<g data-savig-scene="scB"');
    expect(out).toMatch(/data-savig-scene="scB"[^>]*style="display:none"/);
    expect(out).not.toMatch(/data-savig-scene="scA"[^>]*display:none/); // first scene visible
    expect(out).toContain('data-savig-object="scA:oa"');
    expect(out).toContain('data-savig-object="scB:ob"');
  });

  it('dedups a shared svg-asset def across scenes (one savig-asset def)', () => {
    const svgAsset = { id: 'svg1', kind: 'svg' as const, name: 's', normalizedContent: '<rect/>', viewBox: '0 0 1 1', width: 1, height: 1 };
    const project = {
      ...createProject(), assets: [svgAsset], objects: [],
      scenes: [
        { id: 'scA', name: 'A', objects: [createSceneObject('svg1', { id: 'oa' })], duration: 1 },
        { id: 'scB', name: 'B', objects: [createSceneObject('svg1', { id: 'ob' })], duration: 1 },
      ],
    };
    const out = renderProjectDocument(project);
    const defCount = (out.match(/id="savig-asset-svg1"/g) ?? []).length;
    expect(defCount).toBe(1); // global dedup by assetId
  });

  it('wraps each scene body in its own data-savig-camera when the scene has a camera', () => {
    const p = twoSceneProject();
    p.scenes[0].camera = { base: { x: 0, y: 0, zoom: 2, rotation: 0 }, tracks: {} };
    const out = renderProjectDocument(p);
    // scene A has a camera wrapper; scene B (no camera) does not
    expect(out).toMatch(/data-savig-scene="scA"[^>]*>\s*<g data-savig-camera/);
  });
});

describe('renderSvgDocument — repeater render pins (repeater Task 3)', () => {
  it('emits 3 data-savig-object nodes for a repeated leaf (count 3)', () => {
    const project = createProject();
    project.assets.push(createVectorAsset('rect', { id: 'rect-asset' }));
    const obj = createSceneObject('rect-asset', {
      id: 'r',
      zOrder: 0,
      shapeBase: { width: 10, height: 10 },
    });
    obj.repeat = { count: 3, dx: 40, dy: 0, rotate: 0, scale: 1, stagger: 0.5 };
    project.objects.push(obj);
    const out = renderSvgDocument(project);
    expect(out).toContain('data-savig-object="r"');
    expect(out).toContain('data-savig-object="r@1"');
    expect(out).toContain('data-savig-object="r@2"');
    expect((out.match(/data-savig-object="r(@\d)?"/g) ?? []).length).toBe(3);
  });

  it('a gradient fill on a repeated leaf gets unique per-copy gradient-def ids', () => {
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
        id: 'grad-rect-asset',
        style: { fill: '#000000', stroke: 'none', strokeWidth: 0, fillGradient: grad },
      }),
    );
    const obj = createSceneObject('grad-rect-asset', {
      id: 'r',
      zOrder: 0,
      shapeBase: { width: 10, height: 10 },
    });
    obj.repeat = { count: 3, dx: 40, dy: 0, rotate: 0, scale: 1, stagger: 0.5 };
    project.objects.push(obj);
    const out = renderSvgDocument(project);
    expect(out).toContain('<linearGradient id="savig-grad-r-fill"');
    expect(out).toContain('<linearGradient id="savig-grad-r@1-fill"');
    expect(out).toContain('<linearGradient id="savig-grad-r@2-fill"');
    expect(out).toContain('fill="url(#savig-grad-r-fill)"');
    expect(out).toContain('fill="url(#savig-grad-r@1-fill)"');
    expect(out).toContain('fill="url(#savig-grad-r@2-fill)"');
  });
});

describe('renderSvgDocument — text-on-path (Task 2)', () => {
  function pathProject(): Project {
    const path = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
    const project = createProject();
    project.assets.push(createVectorAsset('path', { id: 'pathAsset', path }));
    project.objects.push(createSceneObject('pathAsset', { id: 'pathObj', zOrder: 0 }));
    return project;
  }

  function textProject(textPath?: { pathObjectId: string; startOffset: number }): Project {
    const project = pathProject();
    project.assets.push(createTextAsset({ id: 'textAsset', content: 'Hello' }));
    project.objects.push(
      createSceneObject('textAsset', {
        id: 'textObj',
        zOrder: 1,
        base: { x: 5, y: 6, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        ...(textPath ? { textPath } : {}),
      }),
    );
    return project;
  }

  it('bound text emits a <path> def + <textPath href/startOffset>, identity transform, opacity kept', () => {
    const project = textProject({ pathObjectId: 'pathObj', startOffset: 0.25 });
    const out = renderSvgDocument(project);
    expect(out).toContain('<path id="savig-textpath-textObj" d="M 0 0 L 100 0" pathLength="1" fill="none"/>');
    expect(out).toContain('<g data-savig-object="textObj" opacity="1">');
    expect(out).not.toContain('<g data-savig-object="textObj" transform=');
    expect(out).toContain(
      '<textPath href="#savig-textpath-textObj" startOffset="0.25">Hello</textPath>',
    );
  });

  it('dangling pathObjectId falls back to plain <text> markup, byte-identical to unbound', () => {
    const bound = renderSvgDocument(textProject({ pathObjectId: 'nope', startOffset: 0 }));
    const unbound = renderSvgDocument(textProject());
    expect(bound).toBe(unbound);
  });

  it('unbound text is byte-identical to the pre-textPath plain-text markup (parity)', () => {
    const out = renderSvgDocument(textProject());
    expect(out).toContain(
      '<g data-savig-object="textObj" transform="translate(5, 6) rotate(0, 0, 0) translate(0, 0) scale(1, 1) translate(0, 0)" opacity="1">' +
        '<text x="0" y="0" font-size="48" fill="#000000" dominant-baseline="text-before-edge">Hello</text></g>',
    );
    expect(out).not.toContain('<textPath');
    expect(out).not.toContain('savig-textpath-');
  });

  it('escapes attribute-hostile content in the worldD def and text content', () => {
    const path = {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    };
    const project = createProject();
    project.assets.push(createVectorAsset('path', { id: 'pathAsset', path }));
    project.objects.push(createSceneObject('pathAsset', { id: 'pathObj', zOrder: 0 }));
    project.assets.push(createTextAsset({ id: 'textAsset', content: '<b>&"quote"</b>' }));
    project.objects.push(
      createSceneObject('textAsset', {
        id: 'textObj',
        zOrder: 1,
        textPath: { pathObjectId: 'pathObj', startOffset: 0 },
      }),
    );
    const out = renderSvgDocument(project);
    expect(out).toContain('&lt;b&gt;&amp;&quot;quote&quot;&lt;/b&gt;');
    expect(out).not.toContain('<b>');
  });
});

describe('renderSvgDocument — static-symbol gate excludes bound-text symbols (Task 2)', () => {
  // A symbol whose content is otherwise fully static (no keyframes) but contains a text object
  // bound to a symbol-local path. buildStaticSymbolDef scopes `resolveTextPath` to the symbol's
  // own objects[], so a naive static-<use> optimization would resolve the binding INSIDE the
  // static def — but the editor Stage and runtime both sample with a ROOT-scoped project and
  // never find `innerPath` there, degrading to plain <text>. The gate must keep export in sync:
  // no static def/`<use>` for this symbol, and the text renders as plain `<text>` (root-scoped
  // resolveTextPath also fails to find `innerPath`, matching editor/runtime exactly).
  function makeBoundTextSymbolProject(): Project {
    const innerPathAsset = createVectorAsset('path', {
      id: 'inner-path-asset',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: 0 } }] },
    });
    const innerPathObj = createSceneObject('inner-path-asset', { id: 'innerPath', name: 'innerPath', zOrder: 0 });
    const innerTextAsset = createTextAsset({ id: 'inner-text-asset', content: 'Bound' });
    const innerTextObj = createSceneObject('inner-text-asset', {
      id: 'innerText',
      name: 'innerText',
      zOrder: 1,
      textPath: { pathObjectId: 'innerPath', startOffset: 0 },
    });
    const sym = createSymbolAsset({
      id: 'sym-textbound',
      objects: [innerPathObj, innerTextObj],
      width: 100,
      height: 80,
    });
    const p = createProject({ width: 200, height: 100 });
    p.assets = [innerPathAsset, innerTextAsset, sym];
    const inst = createSceneObject('sym-textbound', { id: 'inst1', name: 'inst1', zOrder: 0 });
    p.objects = [inst];
    return p;
  }

  it('emits NO static <use>/def for a symbol containing bound text', () => {
    const out = renderSvgDocument(makeBoundTextSymbolProject());
    expect(out).not.toContain('href="#savig-sym-sym-textbound"');
    expect(out).not.toContain('id="savig-sym-sym-textbound"');
  });

  it('the bound text inside the (now non-static) symbol renders as plain <text> (root-scoped resolution fails, matching editor/runtime)', () => {
    const out = renderSvgDocument(makeBoundTextSymbolProject());
    expect(out).toContain('<text x="0" y="0" font-size="48" fill="#000000" dominant-baseline="text-before-edge">Bound</text>');
    expect(out).not.toContain('<textPath');
    expect(out).not.toContain('savig-textpath-');
  });

  it('a bound-text-FREE symbol remains static-optimized (parity pin, unaffected by the new gate)', () => {
    const innerAsset = createVectorAsset('rect', { id: 'plain-inner-asset', shapeType: 'rect' });
    innerAsset.style = { fill: '#00ff00', stroke: 'none', strokeWidth: 0 };
    const innerObj = createSceneObject('plain-inner-asset', {
      id: 'plainLeaf', name: 'plainLeaf', zOrder: 0,
      anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
      shapeBase: { width: 20, height: 10 },
    });
    const sym = createSymbolAsset({ id: 'sym-plain', objects: [innerObj], width: 100, height: 80 });
    const p = createProject({ width: 200, height: 100 });
    p.assets = [innerAsset, sym];
    const inst = createSceneObject('sym-plain', { id: 'instPlain', name: 'instPlain', zOrder: 0 });
    p.objects = [inst];
    const out = renderSvgDocument(p);
    expect(out).toContain('id="savig-sym-sym-plain"');
    expect(out).toContain('href="#savig-sym-sym-plain"');
    // Deterministic across calls (same parity property as the existing 47g suite).
    expect(renderSvgDocument(p)).toBe(out);
  });
});
