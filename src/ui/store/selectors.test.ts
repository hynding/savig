import { describe, it, expect } from 'vitest';
import {
  selectActiveAssetId,
  selectActiveObjects,
  selectActiveSceneId,
  selectActiveScope,
  selectEditProject,
  selectSelectedObject,
  selectEditableRings,
  selectActiveRingPath,
} from './selectors';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset, promoteToMultiScene } from '../../engine';
import type { Camera, PathData } from '../../engine';
import type { EditorState } from './store';

// A state with a selected path object whose vector asset has `path` (+ optional compoundRings).
function stateWithSelectedPath(path: PathData, compoundRings?: PathData[], selectedNodeRing = 0): EditorState {
  const asset = createVectorAsset('path', { id: 'pa', path, ...(compoundRings ? { compoundRings } : {}) });
  const obj = createSceneObject('pa', { id: 'po', zOrder: 0 });
  const project = createProject();
  project.assets = [asset];
  project.objects = [obj];
  return {
    history: { past: [], present: project, future: [] },
    editPath: [],
    selectedObjectId: 'po',
    selectedObjectIds: ['po'],
    selectedNodeRing,
    time: 0,
  } as unknown as EditorState;
}

function stateWith(editPath: string[]): EditorState {
  const innerAsset = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const instance = createSceneObject('sym', { id: 'inst', zOrder: 0 });
  const project = createProject();
  project.assets = [innerAsset, sym];
  project.objects = [instance];
  return { history: { past: [], present: project, future: [] }, editPath } as unknown as EditorState;
}

describe('active-scene selectors (symbol edit mode)', () => {
  it('returns the root scene and null asset id when editPath is empty', () => {
    const s = stateWith([]);
    expect(selectActiveAssetId(s)).toBeNull();
    expect(selectActiveObjects(s).map((o) => o.id)).toEqual(['inst']);
    expect(selectEditProject(s)).toBe(s.history.present); // same ref at root
  });
  it('returns the symbol scene and its asset id when editPath points at a symbol', () => {
    const s = stateWith(['sym']);
    expect(selectActiveAssetId(s)).toBe('sym');
    expect(selectActiveObjects(s).map((o) => o.id)).toEqual(['inner']);
    expect(selectEditProject(s).objects.map((o) => o.id)).toEqual(['inner']);
  });
  it('falls back to root when the active asset is missing', () => {
    const s = stateWith(['gone']);
    expect(selectActiveObjects(s).map((o) => o.id)).toEqual(['inst']);
  });
  it('returns a stable objects reference (no fresh array)', () => {
    const s = stateWith(['sym']);
    const sym = s.history.present.assets.find((a) => a.id === 'sym') as { objects: unknown };
    expect(selectActiveObjects(s)).toBe(sym.objects);
  });
  it('selectSelectedObject resolves against the active scene in edit mode', () => {
    const s = stateWith(['sym']);
    (s as { selectedObjectId: string }).selectedObjectId = 'inner';
    (s as { selectedObjectIds: string[] }).selectedObjectIds = ['inner'];
    expect(selectSelectedObject(s)?.id).toBe('inner');
  });
});

describe('compound-ring selectors', () => {
  const primary: PathData = {
    closed: true,
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }],
  };
  const hole: PathData = {
    closed: true,
    nodes: [{ anchor: { x: 2, y: 2 } }, { anchor: { x: 4, y: 2 } }, { anchor: { x: 4, y: 4 } }],
  };

  it('selectEditableRings returns primary + compound rings for a boolean result', () => {
    const rings = selectEditableRings(stateWithSelectedPath(primary, [hole]));
    expect(rings).toHaveLength(2);
    expect(rings[0].nodes[0].anchor).toEqual({ x: 0, y: 0 }); // primary
    expect(rings[1].nodes[0].anchor).toEqual({ x: 2, y: 2 }); // compound
  });

  it('selectActiveRingPath honors selectedNodeRing', () => {
    expect(selectActiveRingPath(stateWithSelectedPath(primary, [hole], 0))!.nodes[0].anchor).toEqual({ x: 0, y: 0 });
    expect(selectActiveRingPath(stateWithSelectedPath(primary, [hole], 1))!.nodes[0].anchor).toEqual({ x: 2, y: 2 });
  });

  it('selectEditableRings is [primary] for a non-boolean path (no compoundRings)', () => {
    expect(selectEditableRings(stateWithSelectedPath(primary))).toHaveLength(1);
  });
});

function stateOf(project: ReturnType<typeof createProject>, over: Partial<EditorState> = {}): EditorState {
  return { history: { present: project, past: [], future: [] }, editPath: [], selectedSceneId: null, ...over } as EditorState;
}

describe('scene-base resolution', () => {
  it('single-scene: selectActiveObjects returns project.objects (parity ref)', () => {
    const p = { ...createProject(), objects: [createSceneObject('a')] };
    const s = stateOf(p);
    expect(selectActiveObjects(s)).toBe(p.objects);
    expect(selectActiveSceneId(s)).toBeNull();
    expect(selectEditProject(s)).toBe(p); // unchanged ref => no spurious rerender
  });

  it('multi-scene: selectActiveObjects returns the selected scene objects', () => {
    const p = promoteToMultiScene({ ...createProject(), objects: [createSceneObject('a')] });
    const sceneId = p.scenes![0].id;
    const s = stateOf(p, { selectedSceneId: sceneId });
    expect(selectActiveObjects(s)).toBe(p.scenes![0].objects);
    expect(selectActiveScope(s)).toEqual({ sceneId, assetId: null });
  });

  it('multi-scene: selectedSceneId null defaults to scene 0', () => {
    const p = promoteToMultiScene({ ...createProject(), objects: [createSceneObject('a')] });
    const s = stateOf(p, { selectedSceneId: null });
    expect(selectActiveSceneId(s)).toBe(p.scenes![0].id);
  });

  it('multi-scene: selectEditProject builds a single-scene view (scenes undefined, scene camera)', () => {
    const cam: Camera = { base: { x: 0, y: 0, zoom: 1, rotation: 0 }, tracks: {} };
    const base = promoteToMultiScene({ ...createProject(), objects: [createSceneObject('a')] });
    const p = { ...base, scenes: [{ ...base.scenes![0], camera: cam }] };
    const s = stateOf(p, { selectedSceneId: p.scenes![0].id });
    const view = selectEditProject(s);
    expect(view.scenes).toBeUndefined();
    expect(view.objects).toBe(p.scenes![0].objects);
    expect(view.camera).toBe(cam);
  });
});
