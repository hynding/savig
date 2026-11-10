// Frame-by-frame slice 1 (spec 2026-11-07): the render seam end to end — the static export's
// initial `visibility`, the runtime's per-frame toggling via the shared computeFrame /
// applyProjectFrame path, and Stage == export parity at t=0.
import { describe, expect, it } from 'vitest';
import {
  createFrameLayer,
  createProject,
  createSceneObject,
  createSymbolAsset,
  createVectorAsset,
  type Project,
} from '@savig/engine';
import { applyFrameToNodes, applyProjectFrame, computeFrame } from '@savig/runtime/frame';
import { renderSvgDocument } from './renderDocument';
import { renderAnimatedSvgDocument } from './animatedSvg';

/** Layer L: r1 in k1 [0, 0.5), r2 in k2 [0.5, 1), blank k3 [1, 1.5). `free` is outside it. */
function fixture(): Project {
  const p = createProject({ fps: 10, width: 100, height: 100 });
  p.assets.push(createVectorAsset('rect', { id: 'va' }));
  p.objects.push(
    createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'k1', time: 0 }, { id: 'k2', time: 0.5 }, { id: 'k3', time: 1 }], end: 1.5 }),
    createSceneObject('va', { id: 'r1', parentId: 'L', frameKeyId: 'k1', zOrder: 1, shapeBase: { width: 10, height: 10 } }),
    createSceneObject('va', { id: 'r2', parentId: 'L', frameKeyId: 'k2', zOrder: 2, shapeBase: { width: 10, height: 10 } }),
    createSceneObject('va', { id: 'free', zOrder: 3, shapeBase: { width: 10, height: 10 } }),
  );
  return p;
}

function mount(project: Project) {
  const doc = new DOMParser().parseFromString(renderSvgDocument(project), 'image/svg+xml');
  const svg = doc.documentElement;
  const nodes = new Map<string, Element>();
  svg.querySelectorAll('[data-savig-object]').forEach((n) => nodes.set(n.getAttribute('data-savig-object')!, n));
  return { svg, nodes };
}

const vis = (nodes: Map<string, Element>, id: string) => nodes.get(id)!.getAttribute('visibility');

describe('frame layers — static export', () => {
  it('starts drawings not on screen at t=0 hidden; the t=0 key and free objects carry no attribute', () => {
    const { nodes } = mount(fixture());
    expect(vis(nodes, 'r1')).toBeNull();
    expect(vis(nodes, 'r2')).toBe('hidden');
    expect(vis(nodes, 'free')).toBeNull();
  });

  it('emits every drawing in the skeleton (time-invariant DOM)', () => {
    const { nodes } = mount(fixture());
    expect([...nodes.keys()].sort()).toEqual(['free', 'r1', 'r2']);
  });

  it('is byte-identical to a frame-free render for objects outside layers (parity)', () => {
    const p = fixture();
    const plain = { ...p, objects: p.objects.filter((o) => o.id === 'free') };
    expect(renderSvgDocument(plain)).not.toContain('visibility');
  });

  it('inlines (no static <use>) a static symbol instance placed in a frame key, so it can toggle', () => {
    const p = fixture();
    p.assets.push(createSymbolAsset({ id: 'S', objects: [createSceneObject('va', { id: 's1', shapeBase: { width: 1, height: 1 } })] }));
    p.objects.push(createSceneObject('S', { id: 'inst', parentId: 'L', frameKeyId: 'k2', zOrder: 4 }));
    const out = renderSvgDocument(p);
    expect(out).not.toContain('savig-sym-S');
    const { nodes } = mount(p);
    expect(vis(nodes, 'inst/s1')).toBe('hidden');
  });
});

describe('frame layers — runtime frame seam', () => {
  it('computeFrame reports visibility only for frame-controlled leaves', () => {
    const items = Object.fromEntries(computeFrame(fixture(), 0.7).map((i) => [i.objectId, i.visibility]));
    expect(items).toEqual({ r1: 'hidden', r2: 'visible', free: undefined });
  });

  it('applyProjectFrame swaps drawings as the playhead crosses keys', () => {
    const project = fixture();
    const { svg, nodes } = mount(project);
    const shown = (t: number) => {
      applyProjectFrame(svg, nodes, project, t);
      return ['r1', 'r2'].filter((id) => vis(nodes, id) === 'visible');
    };
    expect(shown(0)).toEqual(['r1']);
    expect(shown(0.6)).toEqual(['r2']);
    expect(shown(1.2)).toEqual([]); // blank keyframe
    expect(shown(0.1)).toEqual(['r1']); // scrubbing back restores
  });

  it('a display override (M9 show) does not reveal an unexposed drawing', () => {
    const project = fixture();
    const { svg, nodes } = mount(project);
    applyProjectFrame(svg, nodes, project, 0);
    nodes.get('r2')!.setAttribute('display', ''); // what the interactive override pass writes for `show`
    expect(vis(nodes, 'r2')).toBe('hidden');
  });

  it('Stage == export at t=0: the runtime frame agrees with the static markup', () => {
    const project = fixture();
    const { nodes } = mount(project);
    const before = ['r1', 'r2'].map((id) => vis(nodes, id) === 'hidden');
    applyFrameToNodes(nodes, computeFrame(project, 0));
    const after = ['r1', 'r2'].map((id) => vis(nodes, id) === 'hidden');
    expect(after).toEqual(before);
  });
});

describe('frame layers — animated SVG (SMIL, slice 5)', () => {
  const smil = (p: Project) => new DOMParser().parseFromString(renderAnimatedSvgDocument(p), 'image/svg+xml').documentElement;
  const visAnim = (svg: Element, id: string) =>
    svg.querySelector(`[data-savig-object="${id}"]`)!.querySelector(':scope > animate[attributeName="visibility"]');

  it('emits one discrete, frame-exact visibility animate per drawing', () => {
    const svg = smil(fixture()); // auto duration 1.5s @10fps → 16 samples
    const a1 = visAnim(svg, 'r1')!;
    const a2 = visAnim(svg, 'r2')!;
    const values = (a: Element) => a.getAttribute('values')!.split(';');
    expect(values(a1)).toEqual([...Array(5).fill('visible'), ...Array(11).fill('hidden')]);
    expect(values(a2)).toEqual([...Array(5).fill('hidden'), ...Array(5).fill('visible'), ...Array(6).fill('hidden')]);
    expect(a1.getAttribute('calcMode')).toBe('discrete');
    expect(a1.getAttribute('keyTimes')!.split(';')).toHaveLength(16);
    expect(a1.getAttribute('fill')).toBe('freeze');
  });

  it('adds nothing to objects outside frame layers', () => {
    expect(visAnim(smil(fixture()), 'free')).toBeNull();
  });

  it('a non-looping animation freezes on the last drawing, not on a blank end frame', () => {
    const p = fixture();
    p.objects = p.objects.map((o) => (o.id === 'L' ? { ...o, frames: { keys: o.frames!.keys.slice(0, 2), end: 1 } } : o));
    const values = visAnim(smil(p), 'r2')!.getAttribute('values')!.split(';'); // 1s → 11 samples
    expect(values).toEqual([...Array(5).fill('hidden'), ...Array(6).fill('visible')]);
    expect(computeFrame(p, 1).find((it) => it.objectId === 'r2')?.visibility).toBe('hidden'); // the raw end instant
  });

  it('toggles drawings inside a symbol instance placed in a key', () => {
    const p = fixture();
    p.assets.push(createSymbolAsset({ id: 'S', objects: [createSceneObject('va', { id: 's1', shapeBase: { width: 1, height: 1 } })] }));
    p.objects.push(createSceneObject('S', { id: 'inst', parentId: 'L', frameKeyId: 'k2', zOrder: 4 }));
    const a = visAnim(smil(p), 'inst/s1')!;
    expect(a.getAttribute('values')!.split(';').slice(4, 7)).toEqual(['hidden', 'visible', 'visible']);
  });
});
