import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from '@savig/engine';
import { sanitizeBlend } from './sanitizeBlend';
import { migrateProject } from './migrate';

describe('sanitizeBlend', () => {
  it('keeps known modes and drops anything else, normal included', () => {
    const p = createProject();
    p.objects.push(
      { ...createSceneObject('a', { id: 'ok' }), blendMode: 'multiply' },
      { ...createSceneObject('a', { id: 'normal' }), blendMode: 'normal' as never },
      { ...createSceneObject('a', { id: 'evil' }), blendMode: 'multiply;background:url(x)' as never },
    );
    const out = sanitizeBlend(p);
    expect(out.objects.map((o) => o.blendMode)).toEqual(['multiply', undefined, undefined]);
    expect('blendMode' in out.objects[1]).toBe(false);
  });

  it('runs on load', () => {
    const p = createProject();
    p.objects.push({ ...createSceneObject('a', { id: 'x' }), blendMode: 'bogus' as never });
    expect('blendMode' in migrateProject(JSON.parse(JSON.stringify(p))).objects[0]).toBe(false);
  });
});
