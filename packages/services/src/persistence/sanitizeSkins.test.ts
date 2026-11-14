import { describe, expect, it } from 'vitest';
import { createGroupObject, createProject, createSceneObject } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { migrateProject } from './migrate';
import { sanitizeSkins } from './sanitizeSkins';

const withObj = (o: SceneObject) => ({ ...createProject(), objects: [o] });
const leaf = (skin: unknown) => ({ ...createSceneObject('a', { id: 'l' }), skin } as SceneObject);
const I = [1, 0, 0, 1, 0, 0];

describe('sanitizeSkins', () => {
  it('keeps a valid skin reference-equal', () => {
    const p = withObj(leaf({ bones: ['a', 'b'], binds: [I, I], weights: [[1, 0], [0.5, 0.5]] }));
    expect(sanitizeSkins(p)).toBe(p);
  });

  it('drops malformed skins and skins on groups', () => {
    const bad = [
      { bones: [], binds: [], weights: [[1]] },
      { bones: ['a'], binds: [[1, 0, 0]], weights: [[1]] },
      { bones: ['a'], binds: [I], weights: [[1, 0]] },
      { bones: ['a'], binds: [I], weights: [[-1]] },
      { bones: ['a'], binds: [I], weights: [[0]] },
      { bones: ['a', 'a'], binds: [I, I], weights: [[1, 0]] },
      'nope',
    ];
    for (const skin of bad) expect(sanitizeSkins(withObj(leaf(skin))).objects[0]).not.toHaveProperty('skin');
    const g = { ...createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }), skin: { bones: ['a'], binds: [I], weights: [[1]] } } as SceneObject;
    expect(sanitizeSkins(withObj(g)).objects[0]).not.toHaveProperty('skin');
  });

  it('renormalizes weight rows', () => {
    const out = sanitizeSkins(withObj(leaf({ bones: ['a', 'b'], binds: [I, I], weights: [[2, 2]] })));
    expect(out.objects[0].skin!.weights).toEqual([[0.5, 0.5]]);
  });

  it('a v10 file migrates to v11 and is sanitized on load', () => {
    const p = { ...withObj(leaf({ bones: ['a'], binds: [I], weights: 'x' })), meta: { ...createProject().meta, version: 10 } };
    const m = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(m.meta.version).toBe(11);
    expect(m.objects[0]).not.toHaveProperty('skin');
  });
});
