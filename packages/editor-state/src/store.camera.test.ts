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

describe('camera keys on the timeline (slice 2)', () => {
  const twoKeys = () => {
    st().setCameraPose({ zoom: 1 });
    st().seek(1);
    st().setCameraPose({ zoom: 2 });
  };

  it('selecting a camera key clears the object selection', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    twoKeys();
    st().selectCameraKeyframe({ axis: 'zoom', time: 1 });
    expect(st().selectedObjectIds).toEqual([]);
    expect(st().selectedCameraKeyframe).toEqual({ axis: 'zoom', time: 1 });
  });

  it('retimes the selected camera key and keeps it selected; never onto another key', () => {
    twoKeys();
    st().selectCameraKeyframe({ axis: 'zoom', time: 1 });
    st().retimeSelectedKeyframe(1.5);
    expect(cam()!.tracks.zoom!.map((k) => k.time)).toEqual([0, 1.5]);
    expect(st().selectedCameraKeyframe).toEqual({ axis: 'zoom', time: 1.5 });
    const before = st().history.present;
    st().retimeSelectedKeyframe(0);
    expect(st().history.present).toBe(before);
  });

  it('Delete removes the selected camera key; cut leaves it alone', () => {
    twoKeys();
    st().selectCameraKeyframe({ axis: 'zoom', time: 1 });
    st().cutKeyframe();
    expect(cam()!.tracks.zoom).toHaveLength(2);
    st().deleteSelectedKeyframe();
    expect(cam()!.tracks.zoom!.map((k) => k.time)).toEqual([0]);
    expect(st().selectedCameraKeyframe).toBeNull();
  });

  it('sets the easing into the selected key', () => {
    twoKeys();
    st().selectCameraKeyframe({ axis: 'zoom', time: 1 });
    st().setSelectedCameraKeyframeEasing('easeOut');
    expect(cam()!.tracks.zoom![1].easing).toBe('easeOut');
  });

  it('camera keys extend the automatic timeline length', () => {
    twoKeys();
    expect(st().history.present.meta.durationMode).not.toBe('manual');
    // The camera alone animates for one second.
    expect(cam()!.tracks.zoom!.at(-1)!.time).toBe(1);
  });

  it('setCameraModifier adds and clears a shake; a shake on a still project gives it 2 s to play', () => {
    st().setCameraModifier('x', { wiggle: { amplitude: 8, frequency: 3, seed: 0 } });
    expect(cam()!.modifiers?.x?.wiggle?.amplitude).toBe(8);
    expect(st().history.present.meta).toMatchObject({ durationMode: 'manual', duration: 2 });
    st().setCameraModifier('x', { loop: 'cycle' });
    expect(cam()!.modifiers?.x).toEqual({ wiggle: { amplitude: 8, frequency: 3, seed: 0 }, loop: 'cycle' });
    st().setCameraModifier('x', null);
    expect(cam()!.modifiers).toBeUndefined();
  });

  it('rejects an invalid wiggle', () => {
    const before = st().history.present;
    st().setCameraModifier('x', { wiggle: { amplitude: Number.NaN, frequency: 1, seed: 0 } });
    expect(st().history.present).toBe(before);
  });
});
