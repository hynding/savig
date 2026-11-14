import { describe, expect, it } from 'vitest';
import { createFrameLayer, createProject } from '@savig/engine';
import { sanitizeTweens } from './sanitizeTweens';

const project = (tween: unknown) => {
  const p = createProject();
  const L = createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'k1', time: 0, tween } as never, { id: 'k2', time: 1 }], end: 2 });
  return { ...p, objects: [L] };
};

describe('sanitizeTweens', () => {
  it('keeps a valid tween and leaves clean files reference-equal', () => {
    const p = project({ kind: 'shape', easing: 'easeIn', created: ['x'] });
    expect(sanitizeTweens(p)).toBe(p);
    const clean = { ...createProject(), objects: [createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'k', time: 0 }], end: 1 })] };
    expect(sanitizeTweens(clean)).toBe(clean);
  });

  it('drops a malformed tween and filters bad created ids', () => {
    expect(sanitizeTweens(project({ kind: 'motion' })).objects[0].frames!.keys[0]).not.toHaveProperty('tween');
    expect(sanitizeTweens(project('shape')).objects[0].frames!.keys[0]).not.toHaveProperty('tween');
    const fixed = sanitizeTweens(project({ kind: 'shape', easing: 5, created: ['a', 3, ''] }));
    expect(fixed.objects[0].frames!.keys[0].tween).toEqual({ kind: 'shape', created: ['a'] });
  });

  it('keeps well-formed hints, drops bad ones, caps at 26', () => {
    const good = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };
    const p = project({ kind: 'shape', hints: [good] });
    expect(sanitizeTweens(p)).toBe(p);
    const fixed = sanitizeTweens(project({ kind: 'shape', hints: [good, { a: { x: 1 }, b: good.b }, null, { a: good.a, b: { x: Infinity, y: 0 } }] }));
    expect(fixed.objects[0].frames!.keys[0].tween).toEqual({ kind: 'shape', hints: [good] });
    const many = sanitizeTweens(project({ kind: 'shape', hints: Array.from({ length: 30 }, () => good) }));
    expect(many.objects[0].frames!.keys[0].tween!.hints).toHaveLength(26);
    expect(sanitizeTweens(project({ kind: 'shape', hints: 'x' })).objects[0].frames!.keys[0].tween).toEqual({ kind: 'shape' });
  });
});
