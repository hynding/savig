import { describe, it, expect } from 'vitest';
import { createProject, sampleObject } from '../engine';
import { addRect, setBaseTransform } from './build';
import { fadeIn, fadeOut, moveTo, scaleTo, rotateTo, spin, pulse, stagger } from './macros';

function rect(id: string, base?: Parameters<typeof setBaseTransform>[2]) {
  let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id }).project;
  if (base) p = setBaseTransform(p, id, base);
  return p;
}

describe('core/macros', () => {
  it('fadeIn ramps opacity 0 -> 1 over [start, start+duration]', () => {
    const p = fadeIn(rect('r'), 'r', { start: 1, duration: 2 });
    const track = p.objects[0].tracks.opacity!;
    expect(track.map((k) => [k.time, k.value])).toEqual([[1, 0], [3, 1]]);
    expect(track[1].easing).toBe('easeInOut');
  });

  it('fadeOut ramps opacity 1 -> 0', () => {
    const p = fadeOut(rect('r'), 'r');
    expect(sampleObject(p.objects[0], 0).opacity).toBeCloseTo(1);
    expect(sampleObject(p.objects[0], 0.5).opacity).toBeCloseTo(0);
  });

  it('moveTo animates from the current base to the target on the given axes', () => {
    const p = moveTo(rect('r', { x: 20 }), 'r', { x: 200 }, { duration: 1 });
    const x = p.objects[0].tracks.x!;
    expect(x.map((k) => [k.time, k.value])).toEqual([[0, 20], [1, 200]]);
    expect(p.objects[0].tracks.y).toBeUndefined(); // y omitted -> untouched
  });

  it('scaleTo (uniform) animates both axes from the base', () => {
    const p = scaleTo(rect('r'), 'r', { scale: 2 }, { duration: 1 });
    expect(p.objects[0].tracks.scaleX!.map((k) => k.value)).toEqual([1, 2]);
    expect(p.objects[0].tracks.scaleY!.map((k) => k.value)).toEqual([1, 2]);
  });

  it('rotateTo and spin animate rotation', () => {
    expect(rotateTo(rect('r'), 'r', 90).objects[0].tracks.rotation!.map((k) => k.value)).toEqual([0, 90]);
    const sp = spin(rect('r', { rotation: 30 }), 'r', 2);
    expect(sp.objects[0].tracks.rotation!.map((k) => k.value)).toEqual([30, 30 + 720]);
    expect(sp.objects[0].tracks.rotation![1].easing).toBe('linear'); // spin defaults to linear
  });

  it('pulse scales up and back (3 keyframes per axis)', () => {
    const p = pulse(rect('r'), 'r', 1.5, { start: 0, duration: 1 });
    const sx = p.objects[0].tracks.scaleX!;
    expect(sx.map((k) => [k.time, k.value])).toEqual([[0, 1], [0.5, 1.5], [1, 1]]);
  });

  it('stagger offsets each object by stride', () => {
    let p = createProject();
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'a' }));
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'b' }));
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'c' }));
    p = stagger(p, ['a', 'b', 'c'], 0.2, (proj, id, start) => fadeIn(proj, id, { start, duration: 0.5 }));
    const starts = ['a', 'b', 'c'].map((id) => p.objects.find((o) => o.id === id)!.tracks.opacity![0].time);
    expect(starts).toEqual([0, 0.2, 0.4]);
  });

  it('throws on an unknown object id', () => {
    expect(() => fadeIn(createProject(), 'nope')).toThrow(/no object/);
  });
});
