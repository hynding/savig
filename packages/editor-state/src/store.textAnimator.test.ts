// Per-character text animation (spec 2026-11-16-text-animator): the store verb.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type SceneObject } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const sel = (): SceneObject => selectActiveObjects(st()).find((o) => o.id === st().selectedObjectId)!;

beforeEach(() => st().setProject(createProject({ fps: 10 })));

describe('setTextAnimator', () => {
  it('applies a preset at the playhead, merges fields, refuses bad values and removes, one undo step each', () => {
    st().addTextObject(10, 10);
    st().seek(0.5);
    st().setTextAnimator(null, 'typewriter');
    expect(sel().textAnimator).toMatchObject({ by: 'char', start: 0.5, duration: 0, from: { opacity: 0 } });
    st().setTextAnimator({ from: { dy: 8 }, order: 'reverse' });
    expect(sel().textAnimator).toMatchObject({ order: 'reverse', from: { opacity: 0, dy: 8 } });
    const before = st().history.past.length;
    st().setTextAnimator({ stagger: -1 });
    expect(st().history.past.length).toBe(before);
    expect(st().toasts[0]?.message).toMatch(/Text animation/);
    st().setTextAnimator(null);
    expect('textAnimator' in sel()).toBe(false);
    st().undo();
    expect(sel().textAnimator?.order).toBe('reverse');
  });

  it('ignores non-text objects', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    st().setTextAnimator(null, 'fadeUp');
    expect(sel().textAnimator).toBeUndefined();
  });
});
