// Pure unit tests for `makeMarqueeController` — no React. Injects the real vanilla
// `@savig/editor-state` store and asserts on the returned descriptor + resulting selection,
// mirroring how `useMarqueeSelect` drives it. Coordinate conversion is a lazy thunk (`() => Point
// | null`); tests pass constant thunks. Objects are SVG assets (bbox = {0,0,w,h}) so their stage
// AABB is deterministic: an object at base (x,y) covers {x, y, x+w, y+h}.
import { store } from '@savig/editor-state';
import { createSceneObject } from '@savig/engine';
import type { SvgAsset } from '@savig/engine';
import { makeMarqueeController, type Point } from './marqueeSelect';

const at =
  (p: Point | null) =>
  (): Point | null =>
    p;

const svg = (id: string, w: number, h: number): SvgAsset => ({
  id,
  kind: 'svg',
  name: id,
  normalizedContent: '<svg/>',
  viewBox: `0 0 ${w} ${h}`,
  width: w,
  height: h,
});

/** Seed the edit project with two boxes: A at (0,0) 20×20, B at (100,100) 20×20. */
function seedTwoBoxes() {
  const p = store.getState().history.present;
  const asset = svg('box', 20, 20);
  store.getState().commit({
    ...p,
    assets: [asset],
    objects: [
      createSceneObject('box', { id: 'A', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
      createSceneObject('box', { id: 'B', base: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
    ],
  });
}

beforeEach(() => {
  store.getState().newProject();
});

describe('makeMarqueeController — rect construction + consumed flag', () => {
  it('builds a normalized rect from the press origin to the current point', () => {
    const c = makeMarqueeController(store);
    c.beginSelect(0, at({ x: 10, y: 10 }), false);
    const r = c.move(at({ x: 50, y: 30 }));
    expect(r.consumed).toBe(true);
    expect(r.marquee).toEqual({ minX: 10, minY: 10, maxX: 50, maxY: 30 });
  });

  it('normalizes a drag that goes up-and-left (min/max regardless of direction)', () => {
    const c = makeMarqueeController(store);
    c.beginSelect(0, at({ x: 50, y: 30 }), false);
    expect(c.move(at({ x: 10, y: 10 })).marquee).toEqual({ minX: 10, minY: 10, maxX: 50, maxY: 30 });
  });

  it('move without a begin is not consumed (and never asks for the point)', () => {
    const c = makeMarqueeController(store);
    let asked = false;
    const r = c.move(() => {
      asked = true;
      return { x: 5, y: 5 };
    });
    expect(r).toEqual({ consumed: false, marquee: null });
    expect(asked).toBe(false); // the guard short-circuits before any coordinate conversion
  });

  it('an active marquee with no valid point keeps the last rect and stays consumed', () => {
    const c = makeMarqueeController(store);
    c.beginSelect(0, at({ x: 10, y: 10 }), false);
    const rect = c.move(at({ x: 40, y: 40 })).marquee;
    expect(c.move(at(null))).toEqual({ consumed: true, marquee: rect });
  });
});

describe('makeMarqueeController — arming rules', () => {
  it('does not arm on a non-left button', () => {
    const c = makeMarqueeController(store);
    c.beginSelect(1, at({ x: 0, y: 0 }), false);
    expect(c.move(at({ x: 50, y: 50 })).consumed).toBe(false);
  });

  it('a press with no valid start point deselects immediately', () => {
    seedTwoBoxes();
    store.getState().selectObject('A');
    expect(store.getState().selectedObjectIds).toContain('A');
    const c = makeMarqueeController(store);
    c.beginSelect(0, at(null), false);
    expect(store.getState().selectedObjectIds).toEqual([]);
  });
});

describe('makeMarqueeController — selection on end', () => {
  it('selects objects whose AABB intersects the marquee', () => {
    seedTwoBoxes();
    const c = makeMarqueeController(store);
    c.beginSelect(0, at({ x: -10, y: -10 }), false);
    c.move(at({ x: 30, y: 30 })); // covers A {0..20} only, not B {100..120}
    const r = c.end();
    expect(r).toEqual({ consumed: true, marquee: null });
    expect(store.getState().selectedObjectIds).toEqual(['A']);
  });

  it('additive (shift) unions the hits with the existing selection', () => {
    seedTwoBoxes();
    store.getState().selectObject('A');
    const c = makeMarqueeController(store);
    c.beginSelect(0, at({ x: 90, y: 90 }), true); // additive
    c.move(at({ x: 130, y: 130 })); // covers B only
    c.end();
    expect(store.getState().selectedObjectIds.slice().sort()).toEqual(['A', 'B']);
  });

  it('a plain (no-move) click deselects', () => {
    seedTwoBoxes();
    store.getState().selectObject('A');
    const c = makeMarqueeController(store);
    c.beginSelect(0, at({ x: 5, y: 5 }), false);
    c.end();
    expect(store.getState().selectedObjectIds).toEqual([]);
  });

  it('resets after end so a later move is not consumed', () => {
    seedTwoBoxes();
    const c = makeMarqueeController(store);
    c.beginSelect(0, at({ x: 0, y: 0 }), false);
    c.move(at({ x: 30, y: 30 }));
    c.end();
    expect(c.move(at({ x: 40, y: 40 })).consumed).toBe(false);
  });
});
