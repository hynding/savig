import { describe, expect, it } from 'vitest';
import {
  buildTransform,
  createKeyframe,
  createProject,
  createSceneObject,
  createVectorAsset,
  fmt,
  geometryToSvgAttrs,
  pathToD,
  resolveAnchor,
  samplePath,
  sampleProject,
  type Project,
  type ShapeKeyframe,
} from '../engine';
import { applyFrameToNodes, computeFrame } from './frame';

function animated(): Project {
  const project = createProject();
  project.assets.push({
    id: 'aaaa1111', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1,
  });
  const obj = createSceneObject('aaaa1111', { id: 'o1', anchorX: 5, anchorY: 5 });
  obj.tracks.x = [createKeyframe(0, 0), createKeyframe(1, 100)];
  project.objects.push(obj);
  return project;
}

describe('computeFrame parity with engine sampling', () => {
  it('matches sampleProject + buildTransform at multiple times', () => {
    const project = animated();
    for (const t of [0, 0.25, 0.5, 1]) {
      const expected = sampleProject(project, t).map((state) => {
        const obj = project.objects.find((o) => o.id === state.objectId)!;
        return {
          objectId: state.objectId,
          transform: buildTransform(state, obj.anchorX, obj.anchorY),
          opacity: fmt(state.opacity),
        };
      });
      expect(computeFrame(project, t)).toEqual(expected);
    }
  });
});

function animatedVector(): Project {
  const project = createProject();
  project.assets.push(createVectorAsset('rect', { id: 'vrect1' }));
  const obj = createSceneObject('vrect1', {
    id: 'v1',
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    shapeBase: { width: 100, height: 50 },
  });
  obj.tracks.width = [createKeyframe(0, 100), createKeyframe(1, 200)];
  project.objects.push(obj);
  return project;
}

describe('computeFrame parity for vector geometry', () => {
  it('matches engine geometry attrs + resolved fractional anchor at multiple times', () => {
    const project = animatedVector();
    const obj = project.objects[0];
    for (const t of [0, 0.5, 1]) {
      const [state] = sampleProject(project, t);
      const { anchorX, anchorY } = resolveAnchor(obj, state, 'rect');
      const expected = [
        {
          objectId: 'v1',
          transform: buildTransform(state, anchorX, anchorY),
          opacity: fmt(state.opacity),
          geometry: geometryToSvgAttrs('rect', state.geometry!),
        },
      ];
      expect(computeFrame(project, t)).toEqual(expected);
    }
  });

  it('emits no geometry for imported SVG objects', () => {
    const project = animated();
    expect(computeFrame(project, 0)[0].geometry).toBeUndefined();
  });
});

describe('computeFrame for path objects', () => {
  it('produces no geometry for a path object and pivots on its bbox', () => {
    const path = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }], closed: false };
    const asset = createVectorAsset('path', { id: 'vpath1', path });
    const obj = createSceneObject('vpath1', {
      id: 'po1',
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 },
    });
    const project: Project = { ...createProject(), assets: [asset], objects: [obj] };

    const items = computeFrame(project, 0);
    const item = items.find((i) => i.objectId === 'po1')!;
    expect(item.geometry).toBeUndefined();
    // bbox center is (10, 0): the rotate pivot must be there, matching the export.
    expect(item.transform).toContain('rotate(90, 10, 0)');
  });
});

describe('computeFrame path morphing', () => {
  const k0 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
  const k2 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] };
  const shapeTrack: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: k0 },
    { time: 2, easing: 'linear', path: k2 },
  ];

  function morphProject(): Project {
    const asset = createVectorAsset('path', { path: k0 });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack });
    return { ...createProject(), assets: [asset], objects: [obj] };
  }

  it('emits pathD equal to pathToD(sampled path) for morphed paths', () => {
    const item = computeFrame(morphProject(), 1)[0];
    expect(item.pathD).toBe(pathToD(samplePath(shapeTrack, 1)));
  });

  it('does NOT emit pathD for a static (no shapeTrack) path', () => {
    const asset = createVectorAsset('path', { path: k0 });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction' });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].pathD).toBeUndefined();
  });

  it('emits pathD equal to pathToD(samplePath) for a RESAMPLED morph', () => {
    const ra = { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }] };
    const rb = { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] };
    const rTrack: ShapeKeyframe[] = [
      { time: 0, easing: 'linear', path: ra, morph: 'resampled' },
      { time: 2, easing: 'linear', path: rb },
    ];
    const asset = createVectorAsset('path', { path: ra });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack: rTrack });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    const item = computeFrame(project, 1)[0];
    // Stage/runtime parity: computeFrame routes through the same samplePath -> pathToD.
    expect(item.pathD).toBe(pathToD(samplePath(rTrack, 1)));
    expect(samplePath(rTrack, 1).nodes.length).toBe(64); // actually resampled, not index-pad
  });
});

describe('applyFrameToNodes path d', () => {
  it('sets the inner shape `d` when pathD is present', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-savig-object', 'obj-1');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    g.appendChild(path);
    const nodes = new Map<string, Element>([['obj-1', g]]);
    applyFrameToNodes(nodes, [
      { objectId: 'obj-1', transform: '', opacity: '1', pathD: 'M 0 0 L 5 0' },
    ]);
    expect(path.getAttribute('d')).toBe('M 0 0 L 5 0');
  });
});
