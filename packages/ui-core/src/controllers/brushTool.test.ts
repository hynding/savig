// Pure unit tests for `makeBrushToolController` — no React. Drives the real vanilla
// `@savig/editor-state` store; asserts on the returned preview `d` and the committed stroke.
import { store } from '@savig/editor-state';
import { makeBrushToolController } from './brushTool';
import type { Point } from './coords';

const at =
  (p: Point | null) =>
  (): Point | null =>
    p;

beforeEach(() => {
  store.getState().newProject();
});

describe('makeBrushToolController', () => {
  it('move without a begin is not consumed (and never asks for the point)', () => {
    const c = makeBrushToolController(store);
    let asked = false;
    const r = c.move(() => {
      asked = true;
      return { x: 0, y: 0 };
    });
    expect(r).toEqual({ consumed: false, d: null });
    expect(asked).toBe(false);
  });

  it('returns a growing polyline d string as points are added', () => {
    const c = makeBrushToolController(store);
    c.begin({ x: 0, y: 0 });
    const r1 = c.move(at({ x: 10, y: 10 }));
    expect(r1.consumed).toBe(true);
    expect(r1.d).toMatch(/^M/);
    const r2 = c.move(at({ x: 20, y: 5 }));
    expect((r2.d ?? '').length).toBeGreaterThan((r1.d ?? '').length); // more points -> longer path
  });

  it('an active stroke with no valid point leaves the overlay untouched', () => {
    const c = makeBrushToolController(store);
    c.begin({ x: 0, y: 0 });
    expect(c.move(at(null))).toEqual({ consumed: true, d: null });
  });

  it('commits a vector path when the stroke has >= 2 points', () => {
    const before = store.getState().history.present.objects.length;
    const c = makeBrushToolController(store);
    c.begin({ x: 0, y: 0 });
    c.move(at({ x: 10, y: 10 }));
    c.move(at({ x: 20, y: 20 }));
    expect(c.end()).toEqual({ consumed: true });
    expect(store.getState().history.present.objects.length).toBe(before + 1);
  });

  it('end without a begin is not consumed', () => {
    const c = makeBrushToolController(store);
    expect(c.end()).toEqual({ consumed: false });
  });
});
