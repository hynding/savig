// Mask layers slice 2 (spec 2026-11-13): createMask / releaseMask / unmaskSelected, delete cleanup.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const byId = (id: string) => objects().find((o) => o.id === id)!;
const rect = (x = 0) => {
  st().addVectorShape('rect', { x, y: 0, width: 10, height: 10 });
  return st().selectedObjectId!;
};

beforeEach(() => {
  st().setProject(createProject());
});

describe('createMask', () => {
  it('makes the topmost selected object the mask and links the rest, in one undo step', () => {
    const a = rect(0);
    const b = rect(20);
    const m = rect(40); // drawn last = topmost
    st().selectObjects([a, m, b]);
    st().createMask();
    expect(byId(m).isMask).toBe(true);
    expect(byId(a).maskedBy).toBe(m);
    expect(byId(b).maskedBy).toBe(m);
    expect(st().selectedObjectId).toBe(m);
    st().undo();
    expect(byId(m).isMask).toBeUndefined();
    expect(byId(a).maskedBy).toBeUndefined();
  });

  it('refuses fewer than two objects or a locked mask (toast, no commit)', () => {
    const a = rect(0);
    st().selectObjects([a]);
    const before = st().history.present;
    st().createMask();
    expect(st().history.present).toBe(before);
    const m = rect(10);
    st().commitActiveScene(objects().map((o) => (o.id === m ? { ...o, locked: true } : o)));
    st().selectObjects([a, m]);
    const before2 = st().history.present;
    st().createMask();
    expect(st().history.present).toBe(before2);
    expect(st().toasts.length).toBeGreaterThan(0);
  });

  it('skips existing masks and locked objects as targets; the new mask drops its own link', () => {
    const old = rect(0);
    const t = rect(10);
    const locked = rect(20);
    const m = rect(30);
    st().commitActiveScene(objects().map((o) =>
      o.id === old ? { ...o, isMask: true } : o.id === locked ? { ...o, locked: true } : o.id === m ? { ...o, maskedBy: old } : o));
    st().selectObjects([old, t, locked, m]);
    st().createMask();
    expect(byId(t).maskedBy).toBe(m);
    expect(byId(old).maskedBy).toBeUndefined();
    expect(byId(locked).maskedBy).toBeUndefined();
    expect(byId(m).maskedBy).toBeUndefined();
  });

  it('works inside an edited symbol', () => {
    const va = createVectorAsset('rect', { id: 'va' });
    const sym = createSymbolAsset({
      id: 'S',
      objects: [createSceneObject('va', { id: 'x', zOrder: 0 }), createSceneObject('va', { id: 'y', zOrder: 1 })],
    });
    const p = createProject();
    p.assets.push(va, sym);
    p.objects.push(createSceneObject('S', { id: 'inst' }));
    st().setProject(p);
    st().enterSymbol('S');
    st().selectObjects(['x', 'y']);
    st().createMask();
    const s = st().history.present.assets.find((a) => a.id === 'S') as { objects: SceneObject[] };
    expect(s.objects.find((o) => o.id === 'y')!.isMask).toBe(true);
    expect(s.objects.find((o) => o.id === 'x')!.maskedBy).toBe('y');
  });
});

describe('releaseMask / unmaskSelected / delete', () => {
  function masked() {
    const a = rect(0);
    const b = rect(10);
    const m = rect(20);
    st().selectObjects([a, b, m]);
    st().createMask();
    return { a, b, m };
  }

  it('release from the mask or from a masked object clears every link', () => {
    const { a, b, m } = masked();
    st().selectObject(a);
    st().releaseMask();
    expect(byId(m).isMask).toBeUndefined();
    expect(byId(a).maskedBy).toBeUndefined();
    expect(byId(b).maskedBy).toBeUndefined();
  });

  it('unmaskSelected unlinks only the selection', () => {
    const { a, b, m } = masked();
    st().selectObject(a);
    st().unmaskSelected();
    expect(byId(a).maskedBy).toBeUndefined();
    expect(byId(b).maskedBy).toBe(m);
  });

  it('deleting a mask unlinks what it masked', () => {
    const { a, b, m } = masked();
    st().selectObject(m);
    st().deleteSelectedObject();
    expect(objects().some((o) => o.id === m)).toBe(false);
    expect(byId(a).maskedBy).toBeUndefined();
    expect(byId(b).maskedBy).toBeUndefined();
  });
});
