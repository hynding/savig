// Pure unit tests for `makeGradientDragController` — no React. Uses a FAKE store to spy on the
// `setVectorGradient` commit (the controller only touches the store on release), so we can assert
// the no-op-skip logic precisely. The pointer→gradient-space math (`applyGradientHandleDrag`) is
// engine-tested; here we exercise the descriptor outputs + commit gate.
import type { Gradient, LocalRect } from '@savig/engine';
import { makeGradientDragController } from './gradientDrag';
import type { ControllerStore } from './store';
import type { Point } from './coords';

const at =
  (p: Point | null) =>
  (): Point | null =>
    p;

const linear: Gradient = { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [] };
const bbox: LocalRect = { x: 0, y: 0, width: 100, height: 100 };

function spyStore() {
  const commits: { property: 'fill' | 'stroke'; gradient: Gradient }[] = [];
  const store = {
    getState: () => ({
      setVectorGradient: (property: 'fill' | 'stroke', gradient: Gradient) => commits.push({ property, gradient }),
    }),
  } as unknown as ControllerStore;
  return { store, commits };
}

describe('makeGradientDragController', () => {
  it('move without a begin is not consumed', () => {
    const { store } = spyStore();
    const c = makeGradientDragController(store);
    expect(c.move(at({ x: 10, y: 10 }))).toEqual({ consumed: false });
  });

  it('returns a dragState descriptor on a valid move', () => {
    const { store } = spyStore();
    const c = makeGradientDragController(store);
    c.begin('start', 'fill', bbox, linear);
    const r = c.move(at({ x: 50, y: 50 }));
    expect(r.consumed).toBe(true);
    expect(r.dragState?.property).toBe('fill');
    expect(r.dragState?.gradient).toBeDefined();
  });

  it('consumes but does not update dragState when the CTM point is unavailable', () => {
    const { store } = spyStore();
    const c = makeGradientDragController(store);
    c.begin('start', 'fill', bbox, linear);
    expect(c.move(at(null))).toEqual({ consumed: true });
  });

  it('commits the moved gradient on end', () => {
    const { store, commits } = spyStore();
    const c = makeGradientDragController(store);
    c.begin('start', 'stroke', bbox, linear);
    c.move(at({ x: 80, y: 20 }));
    expect(c.end()).toEqual({ consumed: true });
    expect(commits).toHaveLength(1);
    expect(commits[0].property).toBe('stroke');
    expect(commits[0].gradient).not.toBe(linear); // a fresh gradient, not the start ref
  });

  it('skips the commit for a no-op drag (begin then end, no move)', () => {
    const { store, commits } = spyStore();
    const c = makeGradientDragController(store);
    c.begin('start', 'fill', bbox, linear);
    expect(c.end()).toEqual({ consumed: true });
    expect(commits).toHaveLength(0);
  });

  it('end without a begin is not consumed', () => {
    const { store } = spyStore();
    const c = makeGradientDragController(store);
    expect(c.end()).toEqual({ consumed: false });
  });
});
