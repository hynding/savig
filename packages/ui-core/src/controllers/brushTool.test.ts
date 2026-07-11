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

describe('makeBrushToolController — taper/pressure profile (byte-identical parity by default)', () => {
  it('PARITY: default options (no taper, no pressure) still commit via addVectorPath, byte-identical args', () => {
    // NB: addVectorPath itself delegates to addVectorOutline internally (task 2) — the parity
    // pin here is on the CONTROLLER's call site (addVectorPath, not a hand-rolled outlineStroke
    // call), so only addVectorPath's own call args are asserted.
    const spy = vi.spyOn(store.getState(), 'addVectorPath');
    const c = makeBrushToolController(store);
    c.begin({ x: 0, y: 0 });
    c.move(at({ x: 10, y: 10 }));
    c.move(at({ x: 20, y: 20 }));
    c.end();
    expect(spy).toHaveBeenCalledTimes(1);
    const [path, styleSeed] = spy.mock.calls[0];
    expect(path).toEqual({
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 20 } }],
    });
    expect(styleSeed).toEqual({
      strokeWidth: store.getState().brushSize,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    });
  });

  it('accumulates index-aligned pressure samples alongside points (begin/move default to 0.5)', () => {
    const c = makeBrushToolController(store);
    // No assertion surface for the internal buffer directly — driven indirectly via the
    // pressure-active outline branch below (pressureLookup consumes it end-to-end).
    c.begin({ x: 0, y: 0 }, 0.2);
    c.move(at({ x: 10, y: 0 }), 0.8);
    c.move(at({ x: 20, y: 0 }));
    expect(c.end()).toEqual({ consumed: true });
  });

  it('ACTIVE (taperIn > 0): commits via addVectorOutline with a fill-only style seed and >=1 closed ring', () => {
    store.getState().setBrushTaperIn(0.3);
    const pathSpy = vi.spyOn(store.getState(), 'addVectorPath');
    const outlineSpy = vi.spyOn(store.getState(), 'addVectorOutline');
    const c = makeBrushToolController(store);
    c.begin({ x: 0, y: 0 });
    c.move(at({ x: 10, y: 0 }));
    c.move(at({ x: 20, y: 0 }));
    c.move(at({ x: 30, y: 0 }));
    c.end();
    expect(pathSpy).not.toHaveBeenCalled();
    expect(outlineSpy).toHaveBeenCalledTimes(1);
    const [rings, styleSeed] = outlineSpy.mock.calls[0];
    expect(styleSeed).toEqual({ fill: '#000000', stroke: 'none', strokeWidth: 0 });
    expect(rings.length).toBeGreaterThanOrEqual(1);
    for (const ring of rings) expect(ring.closed).toBe(true);
    store.getState().setBrushTaperIn(0);
  });

  it('ACTIVE (taperOut > 0): also routes through addVectorOutline', () => {
    store.getState().setBrushTaperOut(0.3);
    const pathSpy = vi.spyOn(store.getState(), 'addVectorPath');
    const outlineSpy = vi.spyOn(store.getState(), 'addVectorOutline');
    const c = makeBrushToolController(store);
    c.begin({ x: 0, y: 0 });
    c.move(at({ x: 10, y: 0 }));
    c.move(at({ x: 20, y: 0 }));
    c.end();
    expect(pathSpy).not.toHaveBeenCalled();
    expect(outlineSpy).toHaveBeenCalledTimes(1);
    store.getState().setBrushTaperOut(0);
  });

  it('ACTIVE (brushUsePressure): routes through addVectorOutline using the accumulated pressure samples', () => {
    store.getState().setBrushUsePressure(true);
    const pathSpy = vi.spyOn(store.getState(), 'addVectorPath');
    const outlineSpy = vi.spyOn(store.getState(), 'addVectorOutline');
    const c = makeBrushToolController(store);
    c.begin({ x: 0, y: 0 }, 0.1);
    c.move(at({ x: 10, y: 0 }), 1);
    c.move(at({ x: 20, y: 0 }), 0.5);
    c.end();
    expect(pathSpy).not.toHaveBeenCalled();
    expect(outlineSpy).toHaveBeenCalledTimes(1);
    store.getState().setBrushUsePressure(false);
  });
});
