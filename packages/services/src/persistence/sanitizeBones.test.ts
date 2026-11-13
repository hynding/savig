import { describe, expect, it } from 'vitest';
import { createGroupObject, createProject, createSceneObject } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { sanitizeBones } from './sanitizeBones';

const withObj = (o: SceneObject) => ({ ...createProject(), objects: [o] });
const group = (bone: unknown) => ({ ...createGroupObject({ id: 'b', anchorX: 0, anchorY: 0, zOrder: 0 }), bone } as SceneObject);

describe('sanitizeBones', () => {
  it('keeps a valid bone reference-equal', () => {
    const p = withObj(group({ length: 10, angle: 45, min: -30, max: 30, pinned: true }));
    expect(sanitizeBones(p)).toBe(p);
  });

  it('drops a malformed spec or one on a non-group', () => {
    expect(sanitizeBones(withObj(group({ length: 0, angle: 0 }))).objects[0]).not.toHaveProperty('bone');
    expect(sanitizeBones(withObj(group({ length: 5, angle: 'x' }))).objects[0]).not.toHaveProperty('bone');
    const leaf = { ...createSceneObject('a', { id: 'l' }), bone: { length: 5, angle: 0 } };
    expect(sanitizeBones(withObj(leaf)).objects[0]).not.toHaveProperty('bone');
  });

  it('drops inverted or non-finite limits and a non-boolean pinned', () => {
    expect(sanitizeBones(withObj(group({ length: 5, angle: 0, min: 10, max: -10, pinned: 'yes' }))).objects[0].bone).toEqual({ length: 5, angle: 0 });
    expect(sanitizeBones(withObj(group({ length: 5, angle: 0, min: Infinity, max: 20 }))).objects[0].bone).toEqual({ length: 5, angle: 0, max: 20 });
  });
});
