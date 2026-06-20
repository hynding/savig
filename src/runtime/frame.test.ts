import { describe, expect, it } from 'vitest';
import {
  buildTransform,
  createKeyframe,
  createProject,
  createSceneObject,
  createVectorAsset,
  fmt,
  geometryToSvgAttrs,
  resolveAnchor,
  sampleProject,
  type Project,
} from '../engine';
import { computeFrame } from './frame';

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
