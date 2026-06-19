import { describe, expect, test } from 'vitest';
import { sampleObject, sampleProject } from './sample';
import { createKeyframe, createProject, createSceneObject } from './project';

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
