import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { promoteToMultiScene, createSceneObject } from '@savig/engine';
import { gettingStartedViewModel } from './gettingStarted';

const done = (id: string) => gettingStartedViewModel(store.getState()).items.find((i) => i.id === id)!.done;

beforeEach(() => {
  store.getState().newProject();
});

describe('gettingStartedViewModel', () => {
  it('all items start undone on a blank project', () => {
    const vm = gettingStartedViewModel(store.getState());
    expect(vm.items.map((i) => i.done)).toEqual([false, false, false, false]);
    expect(vm.allDone).toBe(false);
    expect(vm.total).toBe(4);
  });

  it('draw checks off when an object exists', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(done('draw')).toBe(true);
    expect(done('second')).toBe(false);
  });

  it('animate checks off when a keyframe is added', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(done('animate')).toBe(false);
    store.getState().seek(0);
    store.getState().setProperty('x', 42);
    expect(done('animate')).toBe(true);
  });

  it('second checks off at 2 objects', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    store.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    expect(done('second')).toBe(true);
  });

  it('reuse checks off when a group exists', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    expect(done('reuse')).toBe(false);
    store.getState().groupSelected();
    expect(done('reuse')).toBe(true);
    // The group CONTAINER is not itself a shape: draw/second still reflect the 2 leaf shapes.
    expect(done('draw')).toBe(true);
    expect(done('second')).toBe(true);
  });

  it('counts objects across scenes (multi-scene projects keep root objects empty)', () => {
    // A multi-scene project holds shapes in scenes[].objects, not project.objects.
    const p = promoteToMultiScene({
      ...store.getState().history.present,
      objects: [createSceneObject('a'), createSceneObject('b')],
    });
    store.getState().commit(p);
    expect(store.getState().history.present.objects).toEqual([]); // root really is empty
    expect(done('draw')).toBe(true); // ...but the checklist still sees the scene's shapes
    expect(done('second')).toBe(true);
  });

  it('allDone when every milestone met', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().seek(0);
    store.getState().setProperty('x', 42); // animate
    store.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 }); // second
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected(); // reuse
    const vm = gettingStartedViewModel(store.getState());
    expect(vm.allDone).toBe(true);
    expect(vm.doneCount).toBe(4);
  });
});
