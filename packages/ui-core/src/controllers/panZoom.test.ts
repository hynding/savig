// Pure unit tests for `makePanZoomController` — no React. Injects the real vanilla
// `@savig/editor-state` store (the same store the app passes in) and asserts on the resulting
// zoom/pan state, mirroring how `usePanZoom` drives it at runtime.
import { store } from '@savig/editor-state';
import { makePanZoomController } from './panZoom';

beforeEach(() => {
  store.getState().newProject();
  store.getState().setZoom(1);
  store.getState().setPan({ x: 0, y: 0 });
});

describe('makePanZoomController — wheel zoom', () => {
  it('zooms in on a negative deltaY (×1.1)', () => {
    const c = makePanZoomController(store);
    c.onWheel(-1);
    expect(store.getState().zoom).toBeCloseTo(1.1, 10);
  });

  it('zooms out on a positive deltaY (÷1.1)', () => {
    const c = makePanZoomController(store);
    c.onWheel(1);
    expect(store.getState().zoom).toBeCloseTo(1 / 1.1, 10);
  });
});

describe('makePanZoomController — pan', () => {
  it('only begins a pan on the middle button (button === 1)', () => {
    const c = makePanZoomController(store);
    expect(c.beginPan(0, 100, 100)).toBe(false);
    expect(c.beginPan(2, 100, 100)).toBe(false);
    expect(c.beginPan(1, 100, 100)).toBe(true);
  });

  it('panMove before beginPan is a no-op (returns false)', () => {
    const c = makePanZoomController(store);
    expect(c.panMove(50, 50)).toBe(false);
    expect(store.getState().pan).toEqual({ x: 0, y: 0 });
  });

  it('translates pan by the pointer delta from the press origin', () => {
    store.getState().setPan({ x: 10, y: 20 });
    const c = makePanZoomController(store);
    c.beginPan(1, 100, 100);
    expect(c.panMove(130, 90)).toBe(true);
    // origin pan (10,20) + (130-100, 90-100) = (40, 10)
    expect(store.getState().pan).toEqual({ x: 40, y: 10 });
  });

  it('endPan clears the drag so a later panMove is ignored', () => {
    const c = makePanZoomController(store);
    c.beginPan(1, 100, 100);
    c.endPan();
    const before = store.getState().pan;
    expect(c.panMove(200, 200)).toBe(false);
    expect(store.getState().pan).toBe(before);
  });
});
