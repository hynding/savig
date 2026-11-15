// Bitmap import slice 2 (spec 2026-11-15-bitmap-import): placing image objects and toggling guides.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type ImageAsset, type SceneObject } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const byId = (id: string) => objects().find((o) => o.id === id)!;
const image: ImageAsset = { id: 'img', kind: 'image', name: 'Photo', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 40, height: 20 };

beforeEach(() => {
  st().setProject(createProject());
  st().addAsset(image);
});

describe('addObject with an image asset', () => {
  it('anchors at the box centre and, given a point, centres the object on it', () => {
    st().addObject('img');
    const a = byId(st().selectedObjectId!);
    expect(a).toMatchObject({ anchorX: 20, anchorY: 10 });
    expect(a.base).toMatchObject({ x: 0, y: 0 });
    st().addObject('img', { x: 100, y: 50 });
    expect(byId(st().selectedObjectId!).base).toMatchObject({ x: 80, y: 40 });
  });
});

describe('toggleGuide', () => {
  it('marks every selected object a guide, then clears it, one undo step each', () => {
    st().addObject('img');
    const a = st().selectedObjectId!;
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const b = st().selectedObjectId!;
    st().selectObjects([a, b]);
    st().toggleGuide();
    expect(byId(a).guide).toBe(true);
    expect(byId(b).guide).toBe(true);
    st().toggleGuide();
    expect('guide' in byId(a)).toBe(false);
    st().undo();
    expect(byId(b).guide).toBe(true);
  });

  it('a mixed selection becomes all guides; locked objects are skipped; nothing selectable = toast', () => {
    st().addObject('img');
    const a = st().selectedObjectId!;
    st().addObject('img');
    const b = st().selectedObjectId!;
    st().toggleGuide([a]);
    st().toggleGuide([a, b]);
    expect(byId(a).guide && byId(b).guide).toBe(true);
    st().toggleObjectLock(a);
    st().toggleGuide([a]);
    expect(byId(a).guide).toBe(true); // locked: untouched
    expect(st().toasts.at(-1)?.message).toMatch(/unlocked object/);
  });
});
