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
        banana: { loop: 'cycle' },
        rotation: { wiggle: { amplitude: 'big', frequency: 1 } },
      } as never,
    });
    const out = sanitizeModifiers({ ...createProject(), objects: [o] });
    expect(out.objects[0].modifiers).toEqual({ x: { loop: 'cycle', wiggle: { amplitude: 4, frequency: 2, seed: 1 } } });
  });
  it('keeps the wider targets, drops a wiggle on a loop-only target, and cleans camera modifiers', () => {
    const o = createSceneObject('a', {
      id: 'o',
      modifiers: {
        trimEnd: { wiggle: { amplitude: 0.1, frequency: 1 } },
        'filter:f1.blur': { loop: 'pingpong' },
        'filter:nodot': { loop: 'cycle' },
        fill: { loop: 'cycle', wiggle: { amplitude: 1, frequency: 1 } },
        shape: { wiggle: { amplitude: 1, frequency: 1 } },
      } as never,
    });
    const camera = { base: { x: 0, y: 0, zoom: 1, rotation: 0 }, tracks: {}, modifiers: { zoom: { wiggle: { amplitude: 0.1, frequency: 2 } }, roll: { loop: 'cycle' } } as never };
    const out = sanitizeModifiers({ ...createProject(), objects: [o], camera });
    expect(out.objects[0].modifiers).toEqual({
      trimEnd: { wiggle: { amplitude: 0.1, frequency: 1 } },
      'filter:f1.blur': { loop: 'pingpong' },
      fill: { loop: 'cycle' },
    });
    expect(out.camera!.modifiers).toEqual({ zoom: { wiggle: { amplitude: 0.1, frequency: 2 } } });
  });
  it('removes an empty or junk field and runs on load', () => {
    const junk = createSceneObject('a', { id: 'j', modifiers: 'nope' as never });
    const p = { ...createProject(), objects: [junk, createSceneObject('a', { id: 'k', modifiers: { opacity: { wiggle: { amplitude: 0.2, frequency: 1 } } } })] };
    const out = migrateProject(JSON.parse(JSON.stringify(p)));
    expect('modifiers' in out.objects[0]).toBe(false);
    expect(out.objects[1].modifiers).toEqual({ opacity: { wiggle: { amplitude: 0.2, frequency: 1 } } });
  });
});
