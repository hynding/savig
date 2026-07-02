// Pure unit tests for `makeDrawToolController` — no React. Drives the real vanilla
// `@savig/editor-state` store; asserts on the returned preview descriptor and the committed object.
import { store } from '@savig/editor-state';
import { makeDrawToolController } from './drawTool';
import type { Point } from './coords';

const at =
  (p: Point | null) =>
  (): Point | null =>
    p;

beforeEach(() => {
  store.getState().newProject();
});

describe('makeDrawToolController — preview descriptors', () => {
  it('move without a begin is not consumed (and never asks for the point)', () => {
    const c = makeDrawToolController(store);
    let asked = false;
    const r = c.move(() => {
      asked = true;
      return { x: 0, y: 0 };
    });
    expect(r).toEqual({ consumed: false, preview: null });
    expect(asked).toBe(false);
  });

  it('rect tool returns a normalized rect preview', () => {
    store.getState().setActiveTool('rect');
    const c = makeDrawToolController(store);
    c.begin({ x: 40, y: 30 });
    expect(c.move(at({ x: 10, y: 10 }))).toEqual({
      consumed: true,
      preview: { target: 'rect', x: 10, y: 10, width: 30, height: 20 },
    });
  });

  it('polygon tool returns a primitive path preview with a d string', () => {
    store.getState().setActiveTool('polygon');
    const c = makeDrawToolController(store);
    c.begin({ x: 0, y: 0 });
    const r = c.move(at({ x: 50, y: 50 }));
    expect(r.consumed).toBe(true);
    expect(r.preview?.target).toBe('primitive');
    if (r.preview?.target === 'primitive') expect(typeof r.preview.d).toBe('string');
  });

  it('an active draw with no valid point leaves the overlays untouched', () => {
    store.getState().setActiveTool('rect');
    const c = makeDrawToolController(store);
    c.begin({ x: 0, y: 0 });
    expect(c.move(at(null))).toEqual({ consumed: true, preview: null });
  });
});

describe('makeDrawToolController — commit on end', () => {
  it('rect tool commits a vector shape', () => {
    store.getState().setActiveTool('rect');
    const before = store.getState().history.present.objects.length;
    const c = makeDrawToolController(store);
    c.begin({ x: 0, y: 0 });
    c.move(at({ x: 50, y: 30 }));
    expect(c.end()).toEqual({ consumed: true });
    expect(store.getState().history.present.objects.length).toBe(before + 1);
  });

  it('polygon tool commits a parametric primitive', () => {
    store.getState().setActiveTool('polygon');
    const before = store.getState().history.present.objects.length;
    const c = makeDrawToolController(store);
    c.begin({ x: 0, y: 0 });
    c.move(at({ x: 60, y: 60 }));
    c.end();
    expect(store.getState().history.present.objects.length).toBe(before + 1);
  });

  it('end without a begin is not consumed', () => {
    const c = makeDrawToolController(store);
    expect(c.end()).toEqual({ consumed: false });
  });

  it('a sub-threshold drag commits nothing', () => {
    store.getState().setActiveTool('rect');
    const before = store.getState().history.present.objects.length;
    const c = makeDrawToolController(store);
    c.begin({ x: 0, y: 0 });
    c.move(at({ x: 1, y: 1 })); // below MIN_DRAW_SIZE (3)
    c.end();
    expect(store.getState().history.present.objects.length).toBe(before);
  });
});
