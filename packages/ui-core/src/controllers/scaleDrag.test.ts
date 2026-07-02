// Pure unit tests for `makeScaleDragController` — no React. Drives the real vanilla
// `@savig/editor-state` store. Snap is bypassed so the scale math is exact; applyScaleHandleDrag/
// applyHandleResize are interaction-tested, so here we exercise the descriptor shape + the commit.
import { store } from '@savig/editor-state';
import { createSceneObject, createVectorAsset, sampleObject } from '@savig/engine';
import type { RenderState, SvgAsset } from '@savig/engine';
import { makeScaleDragController, type ResizeCoords, type ScaleMoveCtx } from './scaleDrag';
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

const state0: RenderState = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } as RenderState;

/** A scale/group ctx whose clientToLocal returns `p` and whose resizeCoords is unused. */
const scaleCtx = (p: Point | null, over: Partial<ScaleMoveCtx> = {}): ScaleMoveCtx => ({
  clientToLocal: () => p,
  resizeCoords: () => null,
  zoom: 1,
  bypass: true, // no snap
  shiftKey: false,
  altKey: false,
  ...over,
});

function seedSvg() {
  const p = store.getState().history.present;
  store.getState().commit({
    ...p,
    assets: [svg('box', 20, 20)],
    objects: [createSceneObject('box', { id: 'A', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } })],
  });
}

beforeEach(() => {
  store.getState().newProject();
});

describe('makeScaleDragController — single scale', () => {
  it('move without a begin is not consumed', () => {
    const c = makeScaleDragController(store);
    expect(c.move(scaleCtx({ x: 0, y: 0 }))).toEqual({ consumed: false });
  });

  it('emits node + overlay transforms and commits the scale on end', () => {
    seedSvg();
    const c = makeScaleDragController(store);
    // 'e' handle: corner.x != opposite.x (sxAxis), corner.y == opposite.y (syAxis false).
    c.beginScale({
      snapshot: { objId: 'A', state: state0, corner: { x: 10, y: 0 }, opposite: { x: 0, y: 0 }, anchorX: 0, anchorY: 0, startScaleX: 1, startScaleY: 1, baseX: 0, baseY: 0, rotationDeg: 0 },
      targets: [],
    });
    const r = c.move(scaleCtx({ x: 20, y: 0 })); // pointer at 2x the corner distance -> scaleX 2
    expect(r.preview?.nodeTransforms.map((n) => n.id)).toEqual(['A']);
    expect(typeof r.preview?.scaleGroupTransform).toBe('string');
    expect(r.preview?.containerPreviews).toEqual([]);
    c.end();
    expect(sampleObject(store.getState().history.present.objects.find((o) => o.id === 'A')!, 0).scaleX).toBeCloseTo(2, 6);
  });
});

describe('makeScaleDragController — group scale', () => {
  it('scales each member about the pivot and commits via setObjectsTransforms', () => {
    seedSvg();
    const c = makeScaleDragController(store);
    c.beginGroup({
      pivot: { x: 0, y: 0 },
      corner: { x: 10, y: 10 },
      sxAxis: true,
      syAxis: true,
      items: [{ id: 'A', ox: 0, oy: 0, osx: 1, osy: 1, ax: 0, ay: 0 }],
      targets: [],
      sx: 1,
      sy: 1,
      moved: false,
    });
    const r = c.move(scaleCtx({ x: 20, y: 20 })); // corner 10,10 -> pointer 20,20 => 2x
    expect(r.preview?.nodeTransforms.map((n) => n.id)).toEqual(['A']);
    c.end();
    const a = sampleObject(store.getState().history.present.objects.find((o) => o.id === 'A')!, 0);
    expect(a.scaleX).toBeCloseTo(2, 6);
    expect(a.scaleY).toBeCloseTo(2, 6);
  });
});

describe('makeScaleDragController — resize', () => {
  it('emits geometry attrs and commits the new size on end', () => {
    const p = store.getState().history.present;
    const rect = createVectorAsset('rect', { id: 'rect', shapeType: 'rect' });
    const obj = createSceneObject('rect', { id: 'A', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    obj.shapeBase = { width: 20, height: 20 };
    store.getState().commit({ ...p, assets: [rect], objects: [obj] });

    const c = makeScaleDragController(store);
    c.beginResize({ handle: 'se', snapshot: { objId: 'A', isEllipse: false, width: 20, height: 20, anchorFracX: 0, anchorFracY: 0, baseX: 0, baseY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0 }, targets: [] });
    // resizeCoords: drag the SE corner to (40,40); identity toStage/toLocal; snap skipped (no content CTM).
    const rc: ResizeCoords = { localX: 40, localY: 40, toStage: (x, y) => ({ x, y }), toLocal: (x, y) => ({ x, y }), hasContentCtm: false };
    const r = c.move(scaleCtx(null, { resizeCoords: () => rc }));
    expect(r.preview?.geometry?.objId).toBe('A');
    expect(Object.keys(r.preview?.geometry?.attrs ?? {})).toEqual(expect.arrayContaining(['width', 'height']));
    c.end();
    const a = sampleObject(store.getState().history.present.objects.find((o) => o.id === 'A')!, 0);
    expect(a.geometry?.width).toBeCloseTo(40, 6);
  });

  it('resize consumes but does nothing when the handle CTM is unavailable', () => {
    const c = makeScaleDragController(store);
    c.beginResize({ handle: 'se', snapshot: { objId: 'A', isEllipse: false, width: 20, height: 20, anchorFracX: 0, anchorFracY: 0, baseX: 0, baseY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0 }, targets: [] });
    expect(c.move(scaleCtx(null))).toEqual({ consumed: true }); // resizeCoords() -> null
  });
});
