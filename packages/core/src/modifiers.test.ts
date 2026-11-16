import { describe, expect, it } from 'vitest';
import { createProject, sampleObject } from '@savig/engine';
import { addRect, setKeyframe } from './build';
import { setModifier } from './modifiers';
import { validateProject } from './validate';
import { compileShort, decompileProject } from './dsl';

const rect = () => addRect(createProject({ width: 100, height: 100 }), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;

describe('setModifier', () => {
  it('merges wiggle and loop, and "none"/null/clear remove them', () => {
    let p = setModifier(rect(), 'r', 'x', { loop: 'cycle' });
    p = setModifier(p, 'r', 'x', { wiggle: { amplitude: 3, frequency: 1 } });
    expect(p.objects[0].modifiers).toEqual({ x: { loop: 'cycle', wiggle: { amplitude: 3, frequency: 1 } } });
    p = setModifier(p, 'r', 'x', { loop: 'none' });
    expect(p.objects[0].modifiers).toEqual({ x: { wiggle: { amplitude: 3, frequency: 1 } } });
    p = setModifier(p, 'r', 'x', { clear: true });
    expect('modifiers' in p.objects[0]).toBe(false);
  });
  it('fails loud on bad input', () => {
    expect(() => setModifier(rect(), 'nope', 'x', { loop: 'cycle' })).toThrow(/no object/);
    expect(() => setModifier(rect(), 'r', 'textPathOffset', { loop: 'cycle' })).toThrow(/takes no modifiers/);
    expect(() => setModifier(rect(), 'r', 'x', { wiggle: { amplitude: 1, frequency: -2 } })).toThrow(/wiggle needs/);
  });
  it('validate warns about a loop with too few keys, not one with a span', () => {
    const p = setModifier(rect(), 'r', 'x', { loop: 'pingpong' });
    expect(validateProject(p).some((i) => i.code === 'modifier-loop-no-keys')).toBe(true);
    let q = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 0 });
    q = setKeyframe(q, { objectId: 'r', property: 'x', time: 1, value: 50 });
    expect(validateProject(q).some((i) => i.code === 'modifier-loop-no-keys')).toBe(false);
    expect(sampleObject(q.objects[0], 1.5).x).toBeCloseTo(25, 9);
  });
});

describe('DSL modifiers', () => {
  it('compiles and round-trips', () => {
    const p = compileShort({
      meta: { width: 100, height: 100, fps: 10, duration: 2 },
      objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, modifiers: { rotation: { wiggle: { amplitude: 10, frequency: 2, seed: 7 } } } }],
    } as never);
    expect(p.objects[0].modifiers).toEqual({ rotation: { wiggle: { amplitude: 10, frequency: 2, seed: 7 } } });
    const back = compileShort(decompileProject(p));
    expect(back.objects[0].modifiers).toEqual(p.objects[0].modifiers);
  });
});
