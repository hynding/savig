// Lasso (spec 2026-11-18-lasso): the store verb.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const loop = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

beforeEach(() => {
  st().setProject(createProject());
});

describe('lassoSelect', () => {
  it('selects what the loop touches, and Shift adds', () => {
    st().addVectorShape('rect', { x: 10, y: 10, width: 40, height: 40 });
    const a = st().selectedObjectId!;
    st().addVectorShape('rect', { x: 200, y: 10, width: 40, height: 40 });
    const b = st().selectedObjectId!;
    st().selectObject(null);
    st().lassoSelect(loop(0, 0, 30, 30), false);
    expect(st().selectedObjectIds).toEqual([a]);
    st().lassoSelect(loop(190, 0, 260, 60), true);
    expect(st().selectedObjectIds).toEqual([a, b]);
    st().lassoSelect(loop(500, 500, 600, 600), false);
    expect(st().selectedObjectIds).toEqual([]);
  });

  it('cuts the looped part of the one selected drawing in one undo step', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 100 });
    const id = st().selectedObjectId!;
    st().lassoSelect(loop(-10, -10, 50, 110), false);
    expect(selectActiveObjects(st())).toHaveLength(2);
    expect(st().selectedObjectId).not.toBe(id);
    st().undo();
    expect(selectActiveObjects(st())).toHaveLength(1);
  });

  it('a loop around the whole selected drawing just selects it', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 100 });
    const id = st().selectedObjectId!;
    const before = st().history.present;
    st().lassoSelect(loop(-10, -10, 120, 120), false);
    expect(st().history.present).toBe(before);
    expect(st().selectedObjectIds).toEqual([id]);
  });

  it('setLassoMode only takes the two modes', () => {
    st().setLassoMode('polygon');
    expect(st().lassoMode).toBe('polygon');
    st().setLassoMode('weird' as never);
    expect(st().lassoMode).toBe('polygon');
    st().setLassoMode('freehand');
  });
});
