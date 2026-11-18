// Variable-width strokes (spec 2026-11-18-variable-width): the runtime re-drives the outline.
import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject, createVectorAsset, widthStrokeD, type PathData, type Project, type ShapeKeyframe } from '@savig/engine';
import { applyFrameToNodes, computeFrame } from './frame';

const k0: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: 0 } }] };
const k1: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 40 } }] };
const style = { fill: 'none', stroke: '#112233', strokeWidth: 8, widthProfile: [{ t: 0, w: 2 }, { t: 1, w: 0 }] };

function project(opts: { morph?: boolean; color?: boolean }): Project {
  const asset = createVectorAsset('path', { id: 'va', path: k0, style });
  const shapeTrack: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: k0 },
    { time: 1, easing: 'linear', path: k1 },
  ];
  const obj = createSceneObject('va', {
    id: 'o',
    ...(opts.morph ? { shapeTrack } : {}),
    ...(opts.color ? { colorTracks: { stroke: [{ time: 0, value: '#000000', easing: 'linear' }, { time: 1, value: '#ffffff', easing: 'linear' }] } } : {}),
  });
  return { ...createProject(), assets: [asset], objects: [obj] };
}

describe('computeFrame with a width profile', () => {
  it('a morphing path carries the outline d for the frame', () => {
    const item = computeFrame(project({ morph: true }), 1)[0];
    expect(item.widthD).toBe(widthStrokeD(k1, style));
    expect(item.pathD).toBeDefined();
  });

  it('an animated stroke colour lands on the outline, not the shape stroke', () => {
    const item = computeFrame(project({ color: true }), 1)[0];
    expect(item.widthFill).toBeDefined();
    expect(item.stroke).toBeUndefined();
  });

  it('a static profiled path emits no per-frame outline', () => {
    const item = computeFrame(project({}), 0.5)[0];
    expect(item.widthD).toBeUndefined();
  });

  it('applyFrameToNodes updates the outline element', () => {
    const NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g');
    const shape = document.createElementNS(NS, 'path');
    const outline = document.createElementNS(NS, 'path');
    outline.setAttribute('data-savig-width', '');
    g.append(shape, outline);
    const items = computeFrame(project({ morph: true, color: true }), 1);
    applyFrameToNodes(new Map([['o', g]]), items);
    expect(outline.getAttribute('d')).toBe(items[0].widthD);
    expect(outline.getAttribute('fill')).toBe(items[0].widthFill);
    expect(shape.getAttribute('stroke')).toBeNull();
  });
});
