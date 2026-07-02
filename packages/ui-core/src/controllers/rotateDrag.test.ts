// Pure unit tests for `makeRotateDragController` — no React. Drives the real vanilla
// `@savig/editor-state` store. Snap is bypassed (metaKey/ctrlKey → the `bypass` arg) so the angle
// math is exact. rotationFromDrag/snapAngle themselves are interaction-tested; here we exercise
// the descriptor shape (node transform + handle transform + HUD) and the commit.
import { store } from '@savig/editor-state';
import { createSceneObject, sampleObject } from '@savig/engine';
import type { RenderState, SvgAsset } from '@savig/engine';
import { makeRotateDragController, type GroupSnapshot, type SingleSnapshot } from './rotateDrag';
import type { Point } from './coords';

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
    objects: [createSceneObject('box', { id: 'A', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } })],
  });
}

const at =
  (p: Point | null) =>
  (): Point | null =>
    p;

beforeEach(() => {
  store.getState().newProject();
});

describe('makeRotateDragController — single', () => {
  it('move without a begin is not consumed', () => {
    const c = makeRotateDragController(store);
    expect(c.move(0, 0, at({ x: 0, y: 0 }), true)).toEqual({ consumed: false });
  });

  it('emits a node + handle transform and an absolute-angle HUD', () => {
    seed();
    const state: RenderState = sampleObject(store.getState().history.present.objects[0], 0);
    const snap: SingleSnapshot = {
      objId: 'A',
      pivot: { x: 0, y: 0 },
      start: { x: 10, y: 0 }, // 0°
      startRotation: 0,
      anchorX: 0,
      anchorY: 0,
      state,
      last: undefined,
    };
    const c = makeRotateDragController(store);
    c.beginSingle(snap);
    const r = c.move(0, 10, at({ x: 5, y: 5 }), true); // drag to 90°, snap bypassed
    expect(r.preview?.nodeTransforms.map((n) => n.id)).toEqual(['A']);
    expect(typeof r.preview?.handleTransform).toBe('string');
    expect(r.preview?.hud).toEqual({ x: 5, y: 5, label: '90°', snapped: false });
  });

  it('commits the rotation on end', () => {
    seed();
    const state: RenderState = sampleObject(store.getState().history.present.objects[0], 0);
    const c = makeRotateDragController(store);
    c.beginSingle({ objId: 'A', pivot: { x: 0, y: 0 }, start: { x: 10, y: 0 }, startRotation: 0, anchorX: 0, anchorY: 0, state, last: undefined });
    c.move(0, 10, at({ x: 5, y: 5 }), true);
    expect(c.end()).toEqual({ consumed: true });
    expect(sampleObject(store.getState().history.present.objects.find((o) => o.id === 'A')!, 0).rotation).toBeCloseTo(90, 6);
  });
});

describe('makeRotateDragController — group', () => {
  it('rotates each member about the centre and commits via setObjectsTransforms', () => {
    seed();
    const snap: GroupSnapshot = {
      center: { x: 50, y: 50 },
      start: { x: 100, y: 50 }, // 0° about the centre
      items: [{ id: 'A', ox: 0, oy: 0, orot: 0, ax: 0, ay: 0 }],
      theta: 0,
      moved: false,
    };
    const c = makeRotateDragController(store);
    c.beginGroup(snap);
    const r = c.move(0, 0, at({ x: 50, y: 100 }), true); // 90° sweep about the centre
    expect(r.preview?.nodeTransforms.map((n) => n.id)).toEqual(['A']);
    expect(r.preview?.hud?.label).toBe('90°');
    c.end();
    const a = sampleObject(store.getState().history.present.objects.find((o) => o.id === 'A')!, 0);
    expect(a.rotation).toBeCloseTo(90, 6);
    expect(a.x).toBeCloseTo(100, 6); // anchor (0,0) rotated 90° about centre (50,50) -> (100,0)
    expect(a.y).toBeCloseTo(0, 6);
  });
});
