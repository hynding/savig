import { describe, it, expect } from 'vitest';
import { selectActiveAssetId, selectActiveObjects, selectEditProject, selectSelectedObject } from './selectors';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '../../engine';
import type { EditorState } from './store';

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
