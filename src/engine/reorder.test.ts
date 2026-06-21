import { describe, it, expect } from 'vitest';
import { reorderObjects } from './reorder';
import { createSceneObject } from './project';

const stack = () => [
  createSceneObject('asset', { id: 'a', zOrder: 0 }),
  createSceneObject('asset', { id: 'b', zOrder: 1 }),
  createSceneObject('asset', { id: 'c', zOrder: 2 }),
];
const zById = (objs: ReturnType<typeof stack>) =>
  Object.fromEntries(objs.map((o) => [o.id, o.zOrder]));

describe('reorderObjects', () => {
  it('forward swaps the object with the next-higher one', () => {
    expect(zById(reorderObjects(stack(), 'a', 'forward'))).toEqual({ a: 1, b: 0, c: 2 });
  });
  it('backward swaps with the next-lower one', () => {
    expect(zById(reorderObjects(stack(), 'c', 'backward'))).toEqual({ a: 0, b: 2, c: 1 });
  });
  it('front moves the object to the top', () => {
    expect(zById(reorderObjects(stack(), 'a', 'front'))).toEqual({ a: 2, b: 0, c: 1 });
  });
  it('back moves the object to the bottom', () => {
    expect(zById(reorderObjects(stack(), 'c', 'back'))).toEqual({ a: 1, b: 2, c: 0 });
  });
  it('preserves the array element order (only zOrder changes)', () => {
    const result = reorderObjects(stack(), 'a', 'front');
    expect(result.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
  it('returns the same reference for no-ops (already at the extreme, unknown id, N<2)', () => {
    const s = stack();
    expect(reorderObjects(s, 'c', 'forward')).toBe(s); // already front
    expect(reorderObjects(s, 'a', 'backward')).toBe(s); // already back
    expect(reorderObjects(s, 'a', 'front')).not.toBe(s); // real change
    expect(reorderObjects(s, 'nope', 'front')).toBe(s); // unknown id
    const one = [createSceneObject('asset', { id: 'a', zOrder: 0 })];
    expect(reorderObjects(one, 'a', 'front')).toBe(one); // N<2
  });
});
