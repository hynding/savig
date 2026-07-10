// Pure unit tests for `timelineViewModel` — no React. Drives the real vanilla
// `@savig/editor-state` store through its actions (same store the app uses) and asserts on
// the resulting descriptor, mirroring how `Timeline.tsx` consumes it at runtime.
import { store } from '@savig/editor-state';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import { timelineViewModel } from './timeline';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

beforeEach(() => {
  store.getState().newProject();
});

describe('timelineViewModel — rows & scalar keyframes', () => {
  it('one row per active object, with the row name + a lane per animated scalar property', () => {
    store.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    store.getState().addObject('a');
    const id = store.getState().selectedObjectId!;
    store.getState().seek(1);
    store.getState().setProperty('x', 50);

    const vm = timelineViewModel(store.getState());
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0].id).toBe(id);
    expect(vm.rows[0].name).toBe(store.getState().history.present.objects[0].name);
    const xTrack = vm.rows[0].scalarTracks.find((t) => t.property === 'x');
    expect(xTrack?.keyframes.map((k) => k.time)).toEqual([1]);
  });

  it('marks the selected scalar keyframe (and only that one) as selected', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = store.getState().selectedObjectId!;
    store.getState().seek(0);
    store.getState().setProperty('y', 5);
    store.getState().seek(1);
    store.getState().setProperty('y', 25);
    store.getState().selectKeyframe({ objectId: id, property: 'y', time: 1 });

    const vm = timelineViewModel(store.getState());
    const yTrack = vm.rows[0].scalarTracks.find((t) => t.property === 'y')!;
    const byTime = new Map(yTrack.keyframes.map((k) => [k.time, k.selected]));
    expect(byTime.get(0)).toBe(false);
    expect(byTime.get(1)).toBe(true);
  });

  it('reflects the playhead time and fps', () => {
    store.getState().seek(2.5);
    const vm = timelineViewModel(store.getState());
    expect(vm.time).toBe(2.5);
    expect(vm.fps).toBe(store.getState().history.present.meta.fps);
  });
});

describe('timelineViewModel — other lane kinds', () => {
  it('shape keyframes: times + selection', () => {
    store.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    });
    store.getState().addShapeKeyframe();
    store.getState().seek(1);
    store.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 40, y: 0 } }] });
    const id = store.getState().selectedObjectId!;
    store.getState().selectShapeKeyframe({ objectId: id, time: 1 });

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    expect(row.shapeKeyframes.map((k) => k.time)).toEqual([0, 1]);
    expect(row.shapeKeyframes.find((k) => k.time === 1)?.selected).toBe(true);
    expect(row.shapeKeyframes.find((k) => k.time === 0)?.selected).toBe(false);
  });

  it('color keyframes: separate fill/stroke lanes', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    const id = store.getState().selectedObjectId!;
    store.getState().seek(1);
    store.getState().setVectorColor('fill', '#ff0000');

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    const fill = row.colorTracks.find((t) => t.property === 'fill')!;
    const stroke = row.colorTracks.find((t) => t.property === 'stroke')!;
    expect(fill.keyframes.map((k) => k.time)).toEqual([1]);
    expect(stroke.keyframes).toEqual([]);
  });

  it('gradient keyframes on the fill lane', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = store.getState().selectedObjectId!;
    store.getState().seek(0);
    store.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    const fill = row.gradientTracks.find((t) => t.property === 'fill')!;
    expect(fill.keyframes.map((k) => k.time)).toEqual([0]);
  });

  it('dash-offset keyframes', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = store.getState().selectedObjectId!;
    store.getState().seek(0);
    store.getState().setStrokeDashoffset(1);

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    expect(row.dashKeyframes.map((k) => k.time)).toEqual([0]);
  });

  it('trim keyframes: per-prop tracks; only props with keyframes emit a track', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = store.getState().selectedObjectId!;
    store.getState().drawOn(); // endTrack: 0 -> 0, 1 -> 1; no start/offset keyframes

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    expect(row.trimTracks.map((t) => t.prop)).toEqual(['end']);
    expect(row.trimTracks[0].keyframes.map((k) => k.time)).toEqual([0, 1]);
  });

  it('no trim -> no trim tracks', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = store.getState().selectedObjectId!;
    const vm = timelineViewModel(store.getState());
    expect(vm.rows.find((r) => r.id === id)!.trimTracks).toEqual([]);
  });

  it('trim keyframe selection matches on objectId + prop + time (all three)', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = store.getState().selectedObjectId!;
    store.getState().drawOn(); // endTrack keyframes at 0 and 1
    if (!store.getState().autoKey) store.getState().toggleAutoKey();
    store.getState().seek(0);
    store.getState().setTrim('start', 0.2); // startTrack keyframe at 0
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    const end = row.trimTracks.find((t) => t.prop === 'end')!;
    const start = row.trimTracks.find((t) => t.prop === 'start')!;
    expect(end.keyframes.find((k) => k.time === 0)?.selected).toBe(true); // full match
    expect(end.keyframes.find((k) => k.time === 1)?.selected).toBe(false); // time differs
    expect(start.keyframes.find((k) => k.time === 0)?.selected).toBe(false); // prop differs
  });

  it('motion-path progress keyframes', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = store.getState().selectedObjectId!;
    store.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    expect(row.progressKeyframes.map((k) => k.time)).toEqual([0, 1]); // addMotionPath seeds start+end
  });

  it('symbol time-remap keyframes (47c)', () => {
    const inner = createVectorAsset('rect', { id: 'r', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('r', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    store.getState().commit(p);
    store.getState().selectObject('inst');
    store.getState().toggleSymbolTimeRemap(); // seeds [0->0]

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === 'inst')!;
    expect(row.remapKeyframes.map((k) => k.time)).toEqual([0]);
  });
});

describe('timelineViewModel — lock-aware rows', () => {
  it('own lock drives `ownLocked`; ancestor-group lock drives `locked` cascade without setting `ownLocked`', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const groupId = store.getState().selectedObjectId!;
    store.getState().toggleObjectLock(groupId);

    const vm = timelineViewModel(store.getState());
    const child = vm.rows.find((r) => r.id === a)!;
    expect(child.ownLocked).toBe(false); // the child itself was never directly locked
    expect(child.locked).toBe(true); // cascades from the locked ancestor group
  });

  it('a directly-locked object: both ownLocked and locked are true', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = store.getState().selectedObjectId!;
    store.getState().toggleObjectLock(id);

    const vm = timelineViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    expect(row.ownLocked).toBe(true);
    expect(row.locked).toBe(true);
  });
});

describe('timelineViewModel — selected row + audio + header state', () => {
  it('marks the selected object row', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    store.getState().selectObject(a);

    const vm = timelineViewModel(store.getState());
    expect(vm.rows.find((r) => r.id === a)?.selected).toBe(true);
    expect(vm.rows.find((r) => r.id !== a)?.selected).toBe(false);
  });

  it('derives audio clip duration from in/out points', () => {
    store.getState().addAsset({ id: 'aud', kind: 'audio', name: 'song', mimeType: 'audio/mpeg' }, new Uint8Array([1]));
    store.getState().seek(0);
    store.getState().addAudioClip('aud');
    const p = store.getState().history.present;
    store.getState().commit({ ...p, audioClips: p.audioClips.map((c) => ({ ...c, outPoint: 2 })) });

    const vm = timelineViewModel(store.getState());
    expect(vm.audioClips).toHaveLength(1);
    expect(vm.audioClips[0].duration).toBe(2); // outPoint(2) - inPoint(0)
  });

  it('exposes header toggle state verbatim', () => {
    store.getState().toggleGrid();
    store.getState().setGridSize(20);
    const vm = timelineViewModel(store.getState());
    expect(vm.autoKey).toBe(store.getState().autoKey);
    expect(vm.onionSkin).toBe(store.getState().onionSkin);
    expect(vm.snapEnabled).toBe(store.getState().snapEnabled);
    expect(vm.gridEnabled).toBe(true);
    expect(vm.gridSize).toBe(20);
  });
});
