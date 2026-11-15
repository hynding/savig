// Blend modes (spec 2026-11-15-blend-modes): the store verb.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type SceneObject } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const byId = (id: string): SceneObject => selectActiveObjects(st()).find((o) => o.id === id)!;
const rect = (): string => {
  st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  return st().selectedObjectId!;
};

beforeEach(() => st().setProject(createProject()));

describe('setBlendMode', () => {
  it('sets the selection’s mode in one undo step and clears it with null', () => {
    const a = rect();
    const b = rect();
    st().selectObjects([a, b]);
    const past = st().history.past.length;
    st().setBlendMode('multiply');
    expect(byId(a).blendMode).toBe('multiply');
    expect(byId(b).blendMode).toBe('multiply');
    expect(st().history.past.length).toBe(past + 1);
    st().setBlendMode('multiply'); // no change -> no commit
    expect(st().history.past.length).toBe(past + 1);
    st().setBlendMode(null, [a]);
    expect('blendMode' in byId(a)).toBe(false);
    st().undo();
    expect(byId(a).blendMode).toBe('multiply');
  });

  it('skips locked objects and ignores unknown modes', () => {
    const a = rect();
    st().toggleObjectLock(a);
    st().setBlendMode('screen', [a]);
    expect(byId(a).blendMode).toBeUndefined();
    expect(st().toasts[0]?.message).toMatch(/unlocked object/);
    const b = rect();
    st().setBlendMode('bogus' as never, [b]);
    expect('blendMode' in byId(b)).toBe(false);
  });
});
