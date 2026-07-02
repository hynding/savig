// Pure unit tests for `makeObjectDragController` — no React. Drives the real vanilla
// `@savig/editor-state` store; asserts on the returned preview descriptor + the committed
// position. Objects are SVG boxes (leaf nodes → nodeTransforms). baseAABB=null disables snapping
// so the delta math is exact. zoom defaults to 1.
import { store } from '@savig/editor-state';
import { createGroupObject, createSceneObject, sampleObject } from '@savig/engine';
import type { SvgAsset } from '@savig/engine';
import { makeObjectDragController, type DragState } from './objectDrag';

// autoKey defaults ON, so commits land as keyframes at the playhead — read positions via
// sampleObject, not `base`.
const posOf = (id: string) => {
  const o = store.getState().history.present.objects.find((obj) => obj.id === id)!;
  const s = sampleObject(o, 0);
  return [s.x, s.y];
};

const svg = (id: string, w: number, h: number): SvgAsset => ({
  id,
  kind: 'svg',
  name: id,
  normalizedContent: '<svg/>',
  viewBox: `0 0 ${w} ${h}`,
  width: w,
  height: h,
});

function seed() {
  const p = store.getState().history.present;
  store.getState().commit({
    ...p,
    assets: [svg('box', 20, 20)],
    objects: [
      createSceneObject('box', { id: 'A', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
      createSceneObject('box', { id: 'B', base: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
    ],
  });
}

const baseDrag = (over: Partial<DragState>): DragState => ({
  id: 'A',
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  curX: 0,
  curY: 0,
  moved: false,
  baseAABB: null,
  targets: [],
  ...over,
});

beforeEach(() => {
  store.getState().newProject();
});

describe('makeObjectDragController — single', () => {
  it('move without a begin is not consumed', () => {
    const c = makeObjectDragController(store);
    expect(c.move(10, 10, false)).toEqual({ consumed: false });
  });

  it('emits a node transform + drag offset for the dragged leaf', () => {
    seed();
    const c = makeObjectDragController(store);
    c.begin(baseDrag({ id: 'A', originX: 0, originY: 0 }));
    const r = c.move(30, 25, false);
    expect(r.consumed).toBe(true);
    expect(r.preview?.dragOffset).toEqual({ dx: 30, dy: 25 });
    expect(r.preview?.nodeTransforms.map((n) => n.id)).toEqual(['A']);
    expect(r.preview?.containerPreviews).toEqual([]);
  });

  it('commits the snapped position on end', () => {
    seed();
    const c = makeObjectDragController(store);
    c.begin(baseDrag({ id: 'A', originX: 0, originY: 0 }));
    c.move(30, 25, false);
    expect(c.end()).toEqual({ consumed: true });
    expect(posOf('A')).toEqual([30, 25]);
  });

  it('a single group drag produces NO preview entry (preserved asymmetry vs multi)', () => {
    const p = store.getState().history.present;
    store.getState().commit({
      ...p,
      assets: [svg('box', 20, 20)],
      objects: [
        createGroupObject({ id: 'G', anchorX: 0, anchorY: 0, zOrder: 0 }),
        createSceneObject('box', { id: 'child', parentId: 'G', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
      ],
    });
    const c = makeObjectDragController(store);
    c.begin(baseDrag({ id: 'G' }));
    const r = c.move(30, 25, false);
    expect(r.consumed).toBe(true);
    expect(r.preview?.nodeTransforms).toEqual([]);
    expect(r.preview?.containerPreviews).toEqual([]); // single group: no subtree preview
    expect(r.preview?.dragOffset).toEqual({ dx: 30, dy: 25 }); // the outline still follows
  });

  it('a drag with no movement commits nothing (end still consumes)', () => {
    seed();
    const c = makeObjectDragController(store);
    c.begin(baseDrag({ id: 'A' }));
    // no move() call → moved stays false
    expect(c.end()).toEqual({ consumed: true });
    expect(posOf('A')).toEqual([0, 0]);
  });
});

describe('makeObjectDragController — multi', () => {
  it('previews every member and commits via nudgeSelected on end', () => {
    seed();
    store.getState().selectObjectsExpandingGroups(['A', 'B']);
    const c = makeObjectDragController(store);
    c.begin(baseDrag({ multi: { items: [{ id: 'A', ox: 0, oy: 0 }, { id: 'B', ox: 100, oy: 100 }], dx: 0, dy: 0 } }));
    const r = c.move(20, 10, false);
    expect(r.preview?.dragOffset).toEqual({ dx: 20, dy: 10 });
    expect(r.preview?.nodeTransforms.map((n) => n.id).sort()).toEqual(['A', 'B']);
    c.end();
    expect(posOf('A')).toEqual([20, 10]);
    expect(posOf('B')).toEqual([120, 110]);
  });
});
