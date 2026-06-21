import { describe, expect, it, test } from 'vitest';
import { resolveAnchor, sampleObject, sampleProject } from './sample';
import { createKeyframe, createProject, createSceneObject } from './project';
import { sampleColor } from './color';
import type { ShapeKeyframe } from './types';

describe('sampleObject', () => {
  test('uses base values when a property has no keyframes', () => {
    const obj = createSceneObject('a', {
      base: { x: 7, y: 8, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 },
    });
    const state = sampleObject(obj, 1);
    expect(state.x).toBe(7);
    expect(state.y).toBe(8);
    expect(state.opacity).toBe(0.5);
    expect(state.objectId).toBe(obj.id);
  });

  test('interpolates a keyframed property and falls back to base elsewhere', () => {
    const obj = createSceneObject('a', {
      base: { x: 0, y: 99, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: { x: [createKeyframe(0, 0), createKeyframe(2, 100)] },
    });
    const state = sampleObject(obj, 1);
    expect(state.x).toBeCloseTo(50, 6);
    expect(state.y).toBe(99);
  });

  test('rotation track defaults to the shortest angular path', () => {
    // Proves sampleObject passes isRotation=true for the rotation property:
    // 350 → 10 must go forward +20 (→ 360 at the midpoint), not backward.
    const obj = createSceneObject('a', {
      tracks: { rotation: [createKeyframe(0, 350), createKeyframe(1, 10)] },
    });
    expect(sampleObject(obj, 0.5).rotation).toBeCloseTo(360, 6);
  });

  test('treats an empty track array as no keyframes (uses base)', () => {
    const obj = createSceneObject('a', {
      base: { x: 12, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: { x: [] },
    });
    expect(sampleObject(obj, 1).x).toBe(12);
  });
});

describe('sampleProject', () => {
  test('returns one render state per object, ordered by zOrder', () => {
    const project = createProject();
    project.objects = [
      createSceneObject('a', { id: 'top', zOrder: 5 }),
      createSceneObject('a', { id: 'bottom', zOrder: 1 }),
    ];
    const states = sampleProject(project, 0);
    expect(states.map((s) => s.objectId)).toEqual(['bottom', 'top']);
  });

  test('is a pure function (does not mutate the project)', () => {
    const project = createProject();
    project.objects = [createSceneObject('a', { id: 'x', zOrder: 2 })];
    const snapshot = JSON.stringify(project);
    sampleProject(project, 1);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
});

describe('sampleObject geometry', () => {
  test('resolves static geometry from shapeBase when there is no track', () => {
    const obj = createSceneObject('a', { shapeBase: { width: 40, height: 20 } });
    expect(sampleObject(obj, 1).geometry).toEqual({ width: 40, height: 20 });
  });

  test('interpolates geometry tracks like any scalar', () => {
    const obj = createSceneObject('a', { shapeBase: { width: 0 } });
    obj.tracks.width = [createKeyframe(0, 0), createKeyframe(2, 100)];
    expect(sampleObject(obj, 1).geometry).toEqual({ width: 50 });
  });

  test('omits geometry entirely for objects without any', () => {
    expect(sampleObject(createSceneObject('a'), 0).geometry).toBeUndefined();
  });
});

describe('resolveAnchor', () => {
  test('returns the absolute anchor by default', () => {
    const obj = createSceneObject('a', { anchorX: 7, anchorY: 9 });
    expect(resolveAnchor(obj, sampleObject(obj, 0), undefined)).toEqual({ anchorX: 7, anchorY: 9 });
  });

  test('resolves a fractional anchor against the path bbox including its min', () => {
    const obj = createSceneObject('a', { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const pathBox = { x: 4, y: 6, width: 10, height: 20 };
    // x: 4 + 0.5*10 = 9 ; y: 6 + 0.5*20 = 16
    expect(resolveAnchor(obj, sampleObject(obj, 0), 'path', pathBox)).toEqual({ anchorX: 9, anchorY: 16 });
  });

  test('resolves a fractional anchor against resolved rect geometry', () => {
    const obj = createSceneObject('a', {
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      shapeBase: { width: 100, height: 40 },
    });
    expect(resolveAnchor(obj, sampleObject(obj, 0), 'rect')).toEqual({ anchorX: 50, anchorY: 20 });
  });

  test('resolves a fractional anchor against ellipse bbox (2 * radius)', () => {
    const obj = createSceneObject('a', {
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      shapeBase: { radiusX: 30, radiusY: 10 },
    });
    expect(resolveAnchor(obj, sampleObject(obj, 0), 'ellipse')).toEqual({ anchorX: 30, anchorY: 10 });
  });
});

describe('sampleObject path morphing', () => {
  const track: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] } },
    { time: 2, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] } },
  ];

  it('sets state.path from the shape track when present', () => {
    const obj = createSceneObject('asset-1', { anchorMode: 'fraction', shapeTrack: track });
    expect(sampleObject(obj, 1).path?.nodes[1].anchor.x).toBe(10);
  });

  it('omits state.path when there is no shape track', () => {
    const obj = createSceneObject('asset-1', { anchorMode: 'fraction' });
    expect(sampleObject(obj, 1).path).toBeUndefined();
  });
});

describe('sampleObject color tracks', () => {
  it('resolves fill/stroke only when a color track exists', () => {
    const base = createSceneObject('asset-1', {
      colorTracks: {
        fill: [
          { time: 0, value: '#000000', easing: 'linear' },
          { time: 2, value: '#ffffff', easing: 'linear' },
        ],
      },
    });
    const mid = sampleObject(base, 1);
    expect(mid.fill).toBe('#808080');
    expect(mid.fill).toBe(sampleColor(base.colorTracks!.fill!, 1));
    expect(mid.stroke).toBeUndefined();

    const plain = createSceneObject('asset-1', {});
    expect(sampleObject(plain, 1).fill).toBeUndefined();
  });
});
