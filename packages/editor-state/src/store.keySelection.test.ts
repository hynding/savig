// Multi-keyframe selection (spec 2026-11-19-key-selection): store verbs.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createVectorAsset } from '@savig/engine';
import type { Keyframe, SceneObject } from '@savig/engine';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const obj = (id: string): SceneObject => selectActiveObjects(st()).find((o) => o.id === id)!;
const k = (time: number, value: number): Keyframe => ({ time, value, easing: 'linear' });
const xs = (id: string) => obj(id).tracks.x?.map((q) => [q.time, q.value]);

beforeEach(() => {
  const p = createProject();
  p.meta.fps = 10;
  p.assets = [createVectorAsset('rect', { id: 'va' })];
  const a = createSceneObject('va', { id: 'a' });
  a.tracks = { x: [k(0, 0), k(1, 10), k(2, 20)] };
  const b = createSceneObject('va', { id: 'b' });
  b.tracks = { x: [k(1, 5)] };
  p.objects = [a, b];
  st().setProject(p);
});

describe('key selection verbs', () => {
  it('selectKeyRange normalizes and clears a single keyframe selection; selecting one key clears it', () => {
    st().selectKeyframe({ objectId: 'a', property: 'x', time: 1 });
    st().selectKeyRange({ objectIds: ['a', 'a'], start: 2, end: 1 });
    expect(st().keySelection).toEqual({ objectIds: ['a'], start: 1, end: 2 });
    expect(st().selectedKeyframe).toBeNull();
    st().selectKeyframe({ objectId: 'a', property: 'x', time: 0 });
    expect(st().keySelection).toBeNull();
  });

  it('moves the range across objects in one undo step, snapped, never before 0', () => {
    st().selectKeyRange({ objectIds: ['a', 'b'], start: 1, end: 2 });
    st().moveKeySelection(0.53);
    expect(xs('a')).toEqual([[0, 0], [1.5, 10], [2.5, 20]]);
    expect(xs('b')).toEqual([[1.5, 5]]);
    expect(st().keySelection).toMatchObject({ start: 1.5, end: 2.5 });
    st().moveKeySelection(-10); // clamps at the earliest selected key
    expect(xs('a')).toEqual([[0, 10], [1, 20]]); // the moved 10-key replaces the key at 0
    st().undo();
    st().undo();
    expect(xs('a')).toEqual([[0, 0], [1, 10], [2, 20]]);
  });

  it('stretches, reverses and deletes', () => {
    st().selectKeyRange({ objectIds: ['a'], start: 0, end: 2 });
    st().stretchKeySelection(4);
    expect(xs('a')).toEqual([[0, 0], [2, 10], [4, 20]]);
    expect(st().keySelection?.end).toBe(4);
    st().reverseKeySelection();
    expect(xs('a')).toEqual([[0, 20], [2, 10], [4, 0]]);
    st().deleteKeySelection();
    expect(obj('a').tracks.x).toBeUndefined();
    expect(st().keySelection).toBeNull();
  });

  it('reverse with a single key says so instead of changing anything', () => {
    st().selectKeyRange({ objectIds: ['b'], start: 0, end: 2 });
    st().reverseKeySelection();
    expect(xs('b')).toEqual([[1, 5]]);
    expect(st().toasts[0]?.message).toMatch(/at least two/);
  });

  it('copies and pastes at the playhead: home objects, or onto the one selected object', () => {
    st().selectKeyRange({ objectIds: ['a', 'b'], start: 1, end: 2 });
    st().copyKeySelection();
    expect(st().keysClipboard?.span).toBe(1);
    st().seek(1.5); // (seeking is clamped to the 2s timeline)
    st().selectObject(null);
    st().pasteKeys();
    expect(xs('a')).toEqual([[0, 0], [1, 10], [1.5, 10], [2, 20], [2.5, 20]]);
    expect(xs('b')).toEqual([[1, 5], [1.5, 5]]);
    expect(st().keySelection).toEqual({ objectIds: ['a', 'b'], start: 1.5, end: 2.5 });

    st().selectKeyRange({ objectIds: ['a'], start: 0, end: 0 });
    st().copyKeySelection();
    st().selectObject('b');
    st().seek(0);
    st().pasteKeys();
    expect(xs('b')).toEqual([[0, 0], [1, 5], [1.5, 5]]);
  });

  it('cut = copy + delete; locked objects are left alone', () => {
    const p = st().history.present;
    st().setProject({ ...p, objects: p.objects.map((o) => (o.id === 'b' ? { ...o, locked: true } : o)) });
    st().selectKeyRange({ objectIds: ['a', 'b'], start: 1, end: 1 });
    st().cutKeySelection();
    expect(xs('a')).toEqual([[0, 0], [2, 20]]);
    expect(xs('b')).toEqual([[1, 5]]);
    expect(st().keysClipboard).not.toBeNull();
  });
});
