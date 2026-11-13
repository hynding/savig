// Shape tween slice 1 (spec 2026-11-13): the timeline strip flag, the Inspector row and command
// availability for a frame layer whose first key is tweened.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { createFrameLayer, createProject, createSceneObject, createVectorAsset } from '@savig/engine';
import { timelineViewModel } from './timeline';
import { inspectorViewModel } from './inspector';
import { COMMANDS } from '../commands/registry';

const FPS = 10;
const st = () => store.getState();

beforeEach(() => {
  st().setProject({
    ...createProject({ fps: FPS, duration: 2, durationMode: 'manual' }),
    assets: [createVectorAsset('rect', { id: 'ra' })],
    objects: [
      createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'a', time: 0 }, { id: 'b', time: 1 }], end: 2 }),
      createSceneObject('ra', { id: 'A', zOrder: 1, parentId: 'L', frameKeyId: 'a', shapeBase: { width: 10, height: 10 } }),
      createSceneObject('ra', { id: 'B', zOrder: 2, parentId: 'L', frameKeyId: 'b', shapeBase: { width: 30, height: 10 } }),
    ],
  });
  st().selectObject('L');
  st().seek(0.3);
});

const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!;

describe('shape tween UI', () => {
  it('the strip flags the tweened key', () => {
    const keys = () => timelineViewModel(st()).rows.find((r) => r.id === 'L')!.frameLayer!.keys;
    expect(keys().some((k) => k.tween)).toBe(false);
    st().createShapeTween();
    expect(keys().map((k) => !!k.tween)).toEqual([true, false]);
  });

  it('the Inspector row reflects availability, state and easing', () => {
    const row = () => {
      const vm = inspectorViewModel(st());
      return vm.kind === 'group' ? vm.shapeTween : undefined;
    };
    expect(row()).toEqual({ available: true, active: false, easing: 'linear' });
    st().createShapeTween('easeOut');
    expect(row()).toEqual({ available: true, active: true, easing: 'easeOut' });
    st().seek(1.5);
    expect(row()).toEqual({ available: false, active: false, easing: 'linear' });
  });

  it('commands: create needs a frame layer, remove needs a tween under the playhead', () => {
    expect(cmd('anim.createShapeTween').when!(st())).toBe(true);
    expect(cmd('anim.removeShapeTween').when!(st())).toBe(false);
    st().createShapeTween();
    expect(cmd('anim.removeShapeTween').when!(st())).toBe(true);
    st().selectObject(null);
    expect(cmd('anim.createShapeTween').when!(st())).toBe(false);
  });
});
