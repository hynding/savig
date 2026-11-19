import { describe, expect, it } from 'vitest';
import { copyKeys, deleteKeys, keyBlockSpan, keyChannels, keyTimesInRange, pasteKeys, reverseEasing, reverseKeys, scaleKeys, shiftKeys } from './keyRange';
import { createSceneObject } from './project';
import { interpolate } from './interpolate';
import type { Keyframe, SceneObject } from './types';

const k = (time: number, value: number, easing: Keyframe['easing'] = 'linear'): Keyframe => ({ time, value, easing });

function obj(): SceneObject {
  const o = createSceneObject('a', { id: 'o' });
  o.tracks = { x: [k(0, 0, 'easeIn'), k(1, 10, 'easeOut'), k(2, 20)], opacity: [k(1, 0.5), k(3, 1)] };
  o.colorTracks = { fill: [{ time: 1, value: '#ff0000', easing: 'linear' }] };
  o.filters = [{ id: 'f', kind: 'blur', params: { radius: 2 } } as never];
  o.filterTracks = { 'f.radius': [k(2, 4)] };
  return o;
}
const times = (o: SceneObject, ch: string) => keyChannels(o).get(ch)?.map((x) => x.time);

describe('key ranges', () => {
  it('lists every channel and the key times in a range', () => {
    expect([...keyChannels(obj()).keys()]).toEqual(['tracks.x', 'tracks.opacity', 'color.fill', 'filter.f.radius']);
    expect(keyTimesInRange(obj(), { start: 1, end: 2 })).toEqual([1, 2]);
  });

  it('shifts only in-range keys across all channels; a moved key replaces one it lands on', () => {
    const o = shiftKeys(obj(), { start: 1, end: 2 }, 1);
    expect(times(o, 'tracks.x')).toEqual([0, 2, 3]);
    expect(times(o, 'tracks.opacity')).toEqual([2, 3]); // 1->2; the 3 key moved? no: 3 is out of range, kept
    expect(keyChannels(o).get('tracks.opacity')!.map((x) => (x as Keyframe).value)).toEqual([0.5, 1]);
    expect(times(o, 'color.fill')).toEqual([2]);
    expect(times(o, 'filter.f.radius')).toEqual([3]);
    const collide = shiftKeys(obj(), { start: 2, end: 2 }, 1); // opacity has no key at 2; x 2->3
    expect(times(collide, 'tracks.x')).toEqual([0, 1, 3]);
    const over = shiftKeys(obj(), { start: 1, end: 1 }, 2); // opacity 1 -> 3 replaces the 3 key
    expect(keyChannels(over).get('tracks.opacity')!.map((x) => [x.time, (x as Keyframe).value])).toEqual([[3, 0.5]]);
  });

  it('stretches from the range start with an optional snap', () => {
    const o = scaleKeys(obj(), { start: 0, end: 2 }, 4);
    expect(times(o, 'tracks.x')).toEqual([0, 2, 4]);
    expect(times(o, 'tracks.opacity')).toEqual([2, 3]); // 3 stays (outside)... 1->2
    const squeezed = scaleKeys(obj(), { start: 0, end: 2 }, 0.1, (t) => Math.round(t * 10) / 10);
    expect(times(squeezed, 'tracks.x')).toEqual([0, 0.1]); // 0.05 rounds onto 0.1 and the later key wins
  });

  it('reverses: times mirror, the motion plays backwards, easings move and flip', () => {
    const before = obj();
    const o = reverseKeys(before, { start: 0, end: 2 });
    const x = keyChannels(o).get('tracks.x') as Keyframe[];
    expect(x.map((q) => [q.time, q.value])).toEqual([[0, 20], [1, 10], [2, 0]]);
    expect(x.map((q) => q.easing)).toEqual(['easeIn', 'easeOut', 'linear']); // the last key keeps the easing that led out
    for (const t of [0.25, 0.5, 1.5]) {
      expect(interpolate(x, t)).toBeCloseTo(interpolate(before.tracks.x!, 2 - t), 6);
    }
  });

  it('reverseEasing mirrors curves', () => {
    expect(reverseEasing('easeIn')).toBe('easeOut');
    const r = reverseEasing({ type: 'cubicBezier', p1: 0.1, p2: 0.2, p3: 0.3, p4: 0.9 }) as { p1: number; p2: number; p3: number; p4: number };
    expect([r.p1, r.p2, r.p3, r.p4].map((v) => Math.round(v * 10) / 10)).toEqual([0.7, 0.1, 0.9, 0.8]);
  });

  it('deletes, copies and pastes blocks', () => {
    const d = deleteKeys(obj(), { start: 1, end: 2 });
    expect(times(d, 'tracks.x')).toEqual([0]);
    expect(keyChannels(d).has('color.fill')).toBe(false);
    expect(d.colorTracks).toBeUndefined();
    const block = copyKeys(obj(), { start: 1, end: 2 });
    expect(keyBlockSpan(block)).toBe(1);
    const p = pasteKeys(obj(), block, 3);
    expect(times(p, 'tracks.x')).toEqual([0, 1, 2, 3, 4]);
    expect(times(p, 'tracks.opacity')).toEqual([1, 3]); // pasted 1->3 replaced the old 3 key
    expect((keyChannels(p).get('tracks.opacity')![1] as Keyframe).value).toBe(0.5);
    const other = createSceneObject('a', { id: 'p' });
    const q = pasteKeys(other, block, 0);
    expect([...keyChannels(q).keys()]).toEqual(['tracks.x', 'tracks.opacity', 'color.fill']); // no filter there
  });
});
