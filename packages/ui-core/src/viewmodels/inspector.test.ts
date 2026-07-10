// Pure unit tests for `inspectorViewModel` — no React. Drives the real vanilla
// `@savig/editor-state` store through its actions (same store the app uses) and asserts on
// the resulting descriptor, mirroring how `Inspector.tsx` consumes it at runtime.
import { store } from '@savig/editor-state';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import { inspectorViewModel, inspectorIntents, STAGE_PRESETS } from './inspector';

beforeEach(() => {
  store.getState().newProject();
});

describe('inspectorViewModel — empty selection', () => {
  it('returns kind "empty" when nothing is selected', () => {
    store.getState().selectObject(null);
    const vm = inspectorViewModel(store.getState());
    expect(vm.kind).toBe('empty');
  });

  it('reports root dims + scope at the root artboard', () => {
    store.getState().selectObject(null);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'empty') throw new Error('expected empty');
    expect(vm.scope).toBe('root');
    expect(vm.dims).toEqual({ width: 1280, height: 720 });
  });

  it('reports symbol dims + scope in symbol-edit mode', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [], width: 100, height: 80 });
    store.getState().addAsset(sym);
    store.getState().enterSymbol('sym');
    store.getState().selectObject(null);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'empty') throw new Error('expected empty');
    expect(vm.scope).toBe('symbol');
    expect(vm.dims).toEqual({ width: 100, height: 80 });
  });
});

describe('inspectorViewModel — single object', () => {
  it('folds autoKey + node-edit-row visibility (slice 4 minor)', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    let vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.autoKey).toBe(store.getState().autoKey);
    expect(vm.showNodeEditButtons).toBe(false); // not the node tool

    store.getState().setActiveTool('node');
    store.getState().selectNode(0, 0); // a node selected in the node tool
    vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.showNodeEditButtons).toBe(true);
  });

  it('describes a selected rect vector: sampled geometry, transform, canCreateSymbol', () => {
    store.getState().addVectorShape('rect', { x: 5, y: 10, width: 40, height: 20 });
    const vm = inspectorViewModel(store.getState());
    expect(vm.kind).toBe('single');
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.vector?.shapeType).toBe('rect');
    expect(vm.geometry.width).toBe(40);
    expect(vm.geometry.height).toBe(20);
    expect(vm.transform.x).toBe(5);
    expect(vm.transform.y).toBe(10);
    expect(vm.canCreateSymbol).toBe(true); // unlocked, no ancestor group
    expect(vm.isInstance).toBe(false);
    expect(vm.symbol).toBeNull();
  });

  it('disables Create Symbol when an ancestor group is locked (lock cascade)', () => {
    // Locking an object directly drops it from the selection (store behavior), so the
    // realistic case this gate defends is a locked ANCESTOR GROUP with a child still
    // selected — isLockedInTree cascades the lock down to the child.
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const groupId = store.getState().selectedObjectId!;
    store.getState().toggleObjectLock(groupId);
    store.getState().selectObject(a);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.canCreateSymbol).toBe(false);
  });

  it('rounds sampled transform values to 3 decimal places', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    store.getState().setProperty('x', 1.23456789);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.transform.x).toBe(1.235);
  });

  it('exposes the FROM-node correspondence summary for a corresponded shape keyframe', () => {
    store.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    });
    store.getState().addShapeKeyframe();
    const id = store.getState().selectedObjectId!;
    store.getState().seek(1);
    store.getState().addShapeKeyframe();
    store.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.keyframe?.kind).toBe('shape');
    expect(vm.keyframe?.correspondence?.summary).toMatch(/auto · 2 nodes/);
  });

  it('returns no keyframe descriptor when nothing is selected as a keyframe', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.keyframe).toBeNull();
  });
});

describe('inspectorViewModel — trim path', () => {
  it('samples trimEnd at the playhead (interpolated) with trimActive true', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    store.getState().drawOn(); // endTrack: 0 -> 0, 1 -> 1
    store.getState().seek(0.5);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.trimEnd).toBe(0.5);
    expect(vm.trimStart).toBe(0);
    expect(vm.trimOffset).toBe(0);
    expect(vm.trimActive).toBe(true);
  });

  it('returns identity defaults ({0,1,0}) and trimActive false when the object has no trim', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.trimStart).toBe(0);
    expect(vm.trimEnd).toBe(1);
    expect(vm.trimOffset).toBe(0);
    expect(vm.trimActive).toBe(false);
  });

  it('selected trim keyframe -> kind "trim" with the prop in the header; last keyframe is inert', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = store.getState().selectedObjectId!;
    store.getState().drawOn();
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    let vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.keyframe?.kind).toBe('trim');
    expect(vm.keyframe?.header).toBe('trim end @ 0s');
    expect(vm.keyframe?.inert).toBe(false);

    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 1 });
    vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.keyframe?.kind).toBe('trim');
    expect(vm.keyframe?.header).toBe('trim end @ 1s');
    expect(vm.keyframe?.inert).toBe(true);
  });

  it('exposes `dashed` (dasharray set) for the Task 8 dash/trim mutual gate', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    let vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.dashed).toBe(false);

    store.getState().setStrokeDasharray([4, 2]);
    vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.dashed).toBe(true);
  });
});

describe('inspectorViewModel — group container', () => {
  it('returns kind "group" with the container name for a selected group', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const vm = inspectorViewModel(store.getState());
    expect(vm.kind).toBe('group');
  });
});

describe('inspectorViewModel — multi-select', () => {
  it('reports count/canAlign/canDistribute for a 2-object selection', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 60, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    const vm = inspectorViewModel(store.getState());
    expect(vm.kind).toBe('multi');
    if (vm.kind !== 'multi') throw new Error('expected multi');
    expect(vm.count).toBe(2);
    expect(vm.canAlign).toBe(true);
    expect(vm.canDistribute).toBe(false); // needs >=3 movable
    expect(vm.canCreateSymbol).toBe(true);
  });

  it('is boolean-eligible (canBool) for 2 vector shapes', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 5, y: 5, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'multi') throw new Error('expected multi');
    expect(vm.canBool).toBe(true);
  });

  it('a group counts as ONE boolean operand (its vector leaves union)', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const c = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const groupId = store.getState().selectedObjectId!;
    store.getState().selectObjects([groupId, c]);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'multi') throw new Error('expected multi');
    expect(vm.canBool).toBe(true);
  });

  it('gates canDistribute on the MOVABLE count, not the raw selection size', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 60, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 120, y: 0, width: 10, height: 10 });
    const c = store.getState().selectedObjectId!;
    store.getState().toggleObjectLock(c); // 3 selected but only 2 movable
    store.getState().selectObjects([a, b, c]);
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'multi') throw new Error('expected multi');
    expect(vm.canDistribute).toBe(false);
    expect(vm.canAlign).toBe(true);
  });
});

describe('inspectorViewModel — symbol instance', () => {
  it('exposes default timing (not looping, no remap) for a plain instance', () => {
    const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({
      id: 'sym',
      objects: [createSceneObject('inner-asset', { id: 'inner' })],
      width: 10,
      height: 10,
    });
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [createSceneObject('sym', { id: 'a' })];
    store.getState().commit(p);
    store.getState().selectObject('a');
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.isInstance).toBe(true);
    expect(vm.symbol).not.toBeNull();
    expect(vm.symbol?.loop).toBe(false);
    expect(vm.symbol?.remapOn).toBe(false);
    expect(vm.symbol?.timingDisabled).toBe(false);
  });

  it('lists other symbols as swap targets, excluding the instance\'s own symbol', () => {
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symP = createSymbolAsset({ id: 'symP', name: 'P', objects: [createSceneObject('rect-asset', { id: 'p-leaf' })], width: 10, height: 10 });
    const symQ = createSymbolAsset({ id: 'symQ', name: 'Q', objects: [createSceneObject('rect-asset', { id: 'q-leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, symP, symQ];
    p.objects = [createSceneObject('symP', { id: 'inst' })];
    store.getState().commit(p);
    store.getState().selectObject('inst');
    const vm = inspectorViewModel(store.getState());
    if (vm.kind !== 'single') throw new Error('expected single');
    expect(vm.symbol?.swapTargets).toEqual([{ id: 'symQ', name: 'Q' }]);
  });
});

describe('stage-size intent + presets', () => {
  it('exposes the stage presets', () => {
    expect(STAGE_PRESETS.map((p) => p.label)).toEqual(['720p', '1080p', 'Square', 'Portrait']);
  });

  it('setStageSize intent resizes the active artboard', () => {
    inspectorIntents(store).setStageSize(500, 400);
    expect(store.getState().history.present.meta.width).toBe(500);
    expect(store.getState().history.present.meta.height).toBe(400);
  });
});
