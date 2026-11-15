// Motion editor model (spec 2026-11-15-motion-editor): pure, driven through the real store.
import { store } from '@savig/editor-state';
import { applyEasing, interpolate } from '@savig/engine';
import type { CubicBezierEasing, EasingName } from '@savig/engine';
import { easingAsBezier, graphViewModel, handleToEasing, paddedRange, propertyLabel, roundForSpan, segmentHandles, trackWithEasing, trackWithKeyMoved, valueTicks } from './graphEditor';
import type { Keyframe } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

function animatedRect(): string {
  store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = store.getState().selectedObjectId!;
  store.getState().seek(0);
  store.getState().setProperty('x', 10);
  store.getState().setProperty('opacity', 1);
  store.getState().seek(1, { pastEnd: true });
  store.getState().setProperty('x', 110);
  store.getState().seek(2, { pastEnd: true });
  store.getState().setProperty('x', 60);
  store.getState().setProperty('opacity', 0.5);
  return id;
}

describe('easingAsBezier', () => {
  it('linear, easeIn and easeOut are exact cubic Béziers of the quadratics', () => {
    const cubic = (b: CubicBezierEasing) => (u: number) => applyEasing(b, u);
    for (const name of ['linear', 'easeIn', 'easeOut'] as EasingName[]) {
      const f = cubic(easingAsBezier(name));
      for (const u of [0.1, 0.3, 0.5, 0.8]) expect(f(u)).toBeCloseTo(applyEasing(name, u), 4);
    }
    const io = cubic(easingAsBezier('easeInOut'));
    for (const u of [0.2, 0.5, 0.8]) expect(Math.abs(io(u) - applyEasing('easeInOut', u))).toBeLessThan(0.06);
  });

  it('passes a custom Bézier through', () => {
    const b: CubicBezierEasing = { type: 'cubicBezier', p1: 0.1, p2: 0.9, p3: 0.2, p4: 1.3 };
    expect(easingAsBezier(b)).toBe(b);
  });
});

describe('segment handles', () => {
  const from = { time: 1, value: 10 };
  const to = { time: 3, value: 50 };
  const b: CubicBezierEasing = { type: 'cubicBezier', p1: 0.25, p2: 0.1, p3: 0.75, p4: 0.9 };

  it('place handles in the segment box and invert exactly', () => {
    const { handleOut, handleIn } = segmentHandles(from, to, b);
    expect(handleOut).toEqual({ time: 1.5, value: 14 });
    expect(handleIn).toEqual({ time: 2.5, value: 46 });
    expect(handleToEasing(from, to, b, 'out', handleOut)).toEqual(b);
    expect(handleToEasing(from, to, b, 'in', { time: 2, value: 70 })).toEqual({ ...b, p3: 0.5, p4: 1.5 });
  });

  it('clamps time into the segment and overshoot to -1..2', () => {
    expect(handleToEasing(from, to, b, 'out', { time: 0, value: 500 })).toEqual({ ...b, p1: 0, p2: 2 });
    expect(handleToEasing(from, to, b, 'in', { time: 9, value: -500 })).toEqual({ ...b, p3: 1, p4: -1 });
  });

  it('a flat segment keeps its y', () => {
    const flatTo = { time: 3, value: 10 };
    expect(handleToEasing(from, flatTo, b, 'out', { time: 2, value: 99 })).toEqual({ ...b, p1: 0.5 });
  });
});

describe('graphViewModel', () => {
  it('lists the selected object animated scalar tracks as curves', () => {
    const id = animatedRect();
    const vm = graphViewModel(store.getState());
    expect(vm.objectId).toBe(id);
    expect(vm.curves.map((c) => c.property).sort()).toEqual(['opacity', 'x']);
    const x = vm.curves.find((c) => c.property === 'x')!;
    expect(x.label).toBe('X');
    expect(x.keys.map((k) => [k.time, k.value])).toEqual([[0, 10], [1, 110], [2, 60]]);
    expect(x.segments).toHaveLength(2);
    expect([x.min, x.max]).toEqual([10, 110]);
  });

  it('samples match the engine interpolation', () => {
    animatedRect();
    const track = store.getState().history.present.objects[0].tracks.x!;
    const x = graphViewModel(store.getState(), 'x').focus!;
    for (const p of x.samples) expect(p.value).toBeCloseTo(interpolate(track, p.time), 9);
  });

  it('focus: explicit property, else the selected keyframe property, else the first curve', () => {
    const id = animatedRect();
    expect(graphViewModel(store.getState(), 'opacity').focus!.property).toBe('opacity');
    store.getState().selectKeyframe({ objectId: id, property: 'opacity', time: 2 });
    const vm = graphViewModel(store.getState());
    expect(vm.focus!.property).toBe('opacity');
    expect(vm.focus!.keys.find((k) => k.time === 2)!.selected).toBe(true);
    expect(graphViewModel(store.getState(), 'rotation').focus!.property).toBe('opacity'); // no rotation curve
  });

  it('rotation segments use the shortest path target, like interpolate', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    store.getState().seek(0);
    store.getState().setProperty('rotation', 350);
    store.getState().seek(1);
    store.getState().setProperty('rotation', 10);
    const vm = graphViewModel(store.getState(), 'rotation');
    expect(vm.focus!.segments[0].to.value).toBe(370);
    const track = store.getState().history.present.objects[0].tracks.rotation!;
    const mid = vm.focus!.samples.find((p) => Math.abs(p.time - 0.5) < 1e-9)!;
    expect(mid.value).toBeCloseTo(interpolate(track, 0.5, true), 9);
  });

  it('empty when nothing is selected; range pads and includes handles', () => {
    expect(graphViewModel(store.getState()).objectId).toBeNull();
    expect(paddedRange(5, 5)).toEqual({ min: 4, max: 6 });
    expect(paddedRange(0, 100)).toEqual({ min: -10, max: 110 });
    const id = animatedRect();
    store.getState().setScalarSegmentEasing({ objectId: id, property: 'x', time: 0 }, { type: 'cubicBezier', p1: 0.3, p2: 2, p3: 0.6, p4: 1 });
    const vm = graphViewModel(store.getState(), 'x');
    expect(vm.range.max).toBeGreaterThan(210); // handle at 10 + 2·100
  });

  it('labels and ticks', () => {
    expect(propertyLabel('cornerRadius' as never)).toBe('Corner radius');
    expect(propertyLabel('scaleY')).toBe('Scale Y');
    expect(valueTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(valueTicks(-0.1, 1.1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('store verbs', () => {
  it('moveScalarKeyframe moves time + value in one commit and keeps easing', () => {
    const id = animatedRect();
    store.getState().setScalarSegmentEasing({ objectId: id, property: 'x', time: 1 }, 'easeIn');
    const before = store.getState().history.past.length;
    store.getState().moveScalarKeyframe({ objectId: id, property: 'x', time: 1 }, 1.234, 80);
    const s = store.getState();
    expect(s.history.past.length).toBe(before + 1);
    const fps = s.history.present.meta.fps;
    const t = Math.round(1.234 * fps) / fps;
    const track = s.history.present.objects[0].tracks.x!;
    expect(track.map((k) => [k.time, k.value])).toEqual([[0, 10], [t, 80], [2, 60]]);
    expect(track[1].easing).toBe('easeIn');
    expect(s.selectedKeyframe).toEqual({ objectId: id, property: 'x', time: t });
  });

  it('moveScalarKeyframe refuses to land on another key and ignores no-ops', () => {
    const id = animatedRect();
    const before = store.getState().history.past.length;
    store.getState().moveScalarKeyframe({ objectId: id, property: 'x', time: 1 }, 2, 0);
    store.getState().moveScalarKeyframe({ objectId: id, property: 'x', time: 1 }, 1, 110);
    expect(store.getState().history.past.length).toBe(before);
  });

  it('setScalarSegmentEasing sets the easing of the segment starting at the key', () => {
    const id = animatedRect();
    const b: CubicBezierEasing = { type: 'cubicBezier', p1: 0.2, p2: 0, p3: 0.4, p4: 1 };
    store.getState().setScalarSegmentEasing({ objectId: id, property: 'x', time: 0 }, b);
    expect(store.getState().history.present.objects[0].tracks.x![0].easing).toEqual(b);
  });

  it('locked objects are left alone', () => {
    const id = animatedRect();
    store.getState().toggleObjectLock(id);
    store.setState({ selectedObjectId: id, selectedObjectIds: [id] }); // locking deselects; force it for the check
    const before = store.getState().history.past.length;
    store.getState().moveScalarKeyframe({ objectId: id, property: 'x', time: 1 }, 1.5, 0);
    store.getState().setScalarSegmentEasing({ objectId: id, property: 'x', time: 0 }, 'easeOut');
    expect(store.getState().history.past.length).toBe(before);
    expect(graphViewModel(store.getState()).locked).toBe(true);
  });
});

describe('drag previews', () => {
  const track: Keyframe[] = [
    { time: 0, value: 0, easing: 'easeIn' },
    { time: 1, value: 10, easing: 'linear' },
    { time: 2, value: 5, easing: 'linear' },
  ];
  it('trackWithKeyMoved re-sorts, keeps easing, and refuses collisions', () => {
    expect(trackWithKeyMoved(track, 0, 1.5, 3)).toEqual([
      { time: 1, value: 10, easing: 'linear' },
      { time: 1.5, value: 3, easing: 'easeIn' },
      { time: 2, value: 5, easing: 'linear' },
    ]);
    expect(trackWithKeyMoved(track, 0, 2, 3)).toBe(track);
  });
  it('trackWithEasing swaps one segment easing', () => {
    expect(trackWithEasing(track, 1, 'easeOut')[1].easing).toBe('easeOut');
    expect(trackWithEasing(track, 1, 'easeOut')[0].easing).toBe('easeIn');
  });
  it('roundForSpan rounds to about 1/1000 of the span', () => {
    expect(roundForSpan(12.3456, 120)).toBe(12.3);
    expect(roundForSpan(0.123456, 1.2)).toBe(0.123);
  });
  it('graphViewModel draws a preview track without touching the store', () => {
    const id = animatedRect();
    const stored = store.getState().history.present;
    const vm = graphViewModel(store.getState(), 'x', { property: 'x', track: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 1, easing: 'linear' }] });
    expect(vm.objectId).toBe(id);
    expect(vm.focus!.keys.map((k) => k.value)).toEqual([0, 1]);
    expect(store.getState().history.present).toBe(stored);
  });
});
