import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from '@savig/engine';
import { sanitizeModifiers } from './sanitizeModifiers';
import { migrateProject } from './migrate';

describe('sanitizeModifiers', () => {
  it('keeps well-formed modifiers and drops malformed or unsupported ones', () => {
    const o = createSceneObject('a', {
      id: 'o',
      modifiers: {
        x: { loop: 'cycle', wiggle: { amplitude: 4, frequency: 2, seed: 1 } },
        y: { loop: 'bounce' },
        textPathOffset: { loop: 'cycle' },
        rotation: { wiggle: { amplitude: 'big', frequency: 1 } },
      } as never,
    });
    const out = sanitizeModifiers({ ...createProject(), objects: [o] });
    expect(out.objects[0].modifiers).toEqual({ x: { loop: 'cycle', wiggle: { amplitude: 4, frequency: 2, seed: 1 } } });
  });
  it('removes an empty or junk field and runs on load', () => {
    const junk = createSceneObject('a', { id: 'j', modifiers: 'nope' as never });
    const p = { ...createProject(), objects: [junk, createSceneObject('a', { id: 'k', modifiers: { opacity: { wiggle: { amplitude: 0.2, frequency: 1 } } } })] };
    const out = migrateProject(JSON.parse(JSON.stringify(p)));
    expect('modifiers' in out.objects[0]).toBe(false);
    expect(out.objects[1].modifiers).toEqual({ opacity: { wiggle: { amplitude: 0.2, frequency: 1 } } });
  });
});
