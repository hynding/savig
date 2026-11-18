// Camera tool (spec 2026-11-18-camera-tool): the store verbs.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import { store } from './store';
import { selectActiveSceneCamera } from './selectors';

const st = () => store.getState();
const cam = () => selectActiveSceneCamera(st());

beforeEach(() => {
  st().setProject(createProject());
  if (!st().autoKey) st().toggleAutoKey();
  st().seek(0);
});

describe('camera verbs', () => {
  it('addCamera seeds the default framing once, in one undo step', () => {
    expect(cam()).toBeUndefined();
    st().addCamera();
    const { width, height } = st().history.present.meta;
    expect(cam()).toEqual({ base: { x: width / 2, y: height / 2, zoom: 1, rotation: 0 }, tracks: {} });
    const before = st().history.present;
    st().addCamera();
    expect(st().history.present).toBe(before);
    st().undo();
    expect(cam()).toBeUndefined();
  });

  it('setCameraPose keys the axes at the playhead with auto-key on', () => {
    st().seek(1);
    st().setCameraPose({ x: 100, zoom: 2 });
    expect(cam()!.tracks.x).toEqual([expect.objectContaining({ time: 1, value: 100 })]);
    expect(cam()!.tracks.zoom).toEqual([expect.objectContaining({ time: 1, value: 2 })]);
    expect(cam()!.tracks.y).toBeUndefined();
  });

  it('with auto-key off a still axis edits the framing, an animated one still takes a key', () => {
    st().setCameraPose({ x: 50 });
    st().toggleAutoKey();
    st().seek(0.5);
    st().setCameraPose({ x: 70, rotation: 15 });
    expect(cam()!.tracks.x).toHaveLength(2);
    expect(cam()!.tracks.rotation).toBeUndefined();
    expect(cam()!.base.rotation).toBe(15);
  });

  it('clamps zoom and ignores non-finite values', () => {
    st().setCameraPose({ zoom: 1000 });
    expect(cam()!.tracks.zoom![0].value).toBe(20);
    const before = st().history.present;
    st().setCameraPose({ x: Number.NaN });
    expect(st().history.present).toBe(before);
  });

  it('removeCameraKeyframe drops the key; the last key leaves the axis still at its value', () => {
    st().setCameraPose({ x: 10 });
    st().seek(1);
    st().setCameraPose({ x: 90 });
    st().removeCameraKeyframe('x');
    expect(cam()!.tracks.x).toHaveLength(1);
    st().seek(0);
    st().removeCameraKeyframe('x');
    expect(cam()!.tracks.x).toBeUndefined();
    expect(cam()!.base.x).toBe(10);
  });

  it('removeCamera clears it', () => {
    st().addCamera();
    st().removeCamera();
    expect(cam()).toBeUndefined();
    expect('camera' in st().history.present).toBe(false);
  });

  it('writes the selected scene camera in a multi-scene project', () => {
    st().addScene();
    const scenes = st().history.present.scenes!;
    st().selectScene(scenes[1].id);
    st().setCameraPose({ zoom: 3 });
    const after = st().history.present.scenes!;
    expect(after[1].camera?.tracks.zoom?.[0].value).toBe(3);
    expect(after[0].camera).toBeUndefined();
    expect(st().history.present.camera).toBeUndefined();
  });

  it('choosing the camera tool clears the object selection', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(st().selectedObjectIds).toHaveLength(1);
    st().setActiveTool('camera');
    expect(st().selectedObjectIds).toEqual([]);
  });
});
