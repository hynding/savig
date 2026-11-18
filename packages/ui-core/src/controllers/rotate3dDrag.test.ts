import { describe, expect, it } from 'vitest';
import { store } from '@savig/editor-state';
import { createProject, sampleObject } from '@savig/engine';
import { makeRotate3DDragController, rotate3DFromDrag } from './rotate3dDrag';

describe('rotate3DFromDrag', () => {
  it('horizontal travel turns about Y, upward travel tips about X', () => {
    expect(rotate3DFromDrag({ rotationX: 0, rotationY: 0 }, 40, 0, false)).toEqual({ rotationX: 0, rotationY: 20 });
    expect(rotate3DFromDrag({ rotationX: 0, rotationY: 0 }, 0, -40, false)).toEqual({ rotationX: 20, rotationY: 0 });
  });
  it('Shift locks the dominant axis and snaps to 15°', () => {
    expect(rotate3DFromDrag({ rotationX: 5, rotationY: 0 }, 50, 10, true)).toEqual({ rotationX: 5, rotationY: 30 });
  });
});

describe('makeRotate3DDragController', () => {
  it('previews the turned transform and commits one keyed step', () => {
    const s = store.getState();
    s.setProject(createProject());
    if (!store.getState().autoKey) store.getState().toggleAutoKey();
    store.getState().seek(0);
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 20 });
    const obj = store.getState().history.present.objects[0];
    const ctrl = makeRotate3DDragController(store);
    ctrl.begin({ objId: obj.id, startClientX: 100, startClientY: 100, anchorX: 20, anchorY: 10, state: sampleObject(obj, 0) });
    const r = ctrl.move(220, 100, false);
    expect(r.preview?.nodeTransforms[0].transform).toContain('matrix(');
    expect(r.preview?.label).toBe('3D X 0° · Y 60°');
    const past = store.getState().history.past.length;
    ctrl.end();
    const after = store.getState().history.present.objects[0];
    expect(after.tracks.rotationY?.[0].value).toBe(60);
    expect(after.tracks.rotationX).toBeUndefined();
    expect(store.getState().history.past.length).toBe(past + 1);
  });
});
