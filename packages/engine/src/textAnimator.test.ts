import { describe, expect, it } from 'vitest';
import {
  isTextAnimator, sampleTextAnimator, textAnimatorEnd, textAnimatorMarkup, textUnitAttrs, textUnits, unitRanks,
  TEXT_ANIMATOR_PRESETS,
} from './textAnimator';
import type { TextAnimator } from './types';

const fade: TextAnimator = { by: 'char', start: 1, stagger: 0.5, duration: 1, easing: 'linear', from: { opacity: 0, dy: 10 } };

describe('textUnits', () => {
  it('splits characters (code points) and words that join back to the content', () => {
    expect(textUnits('Hi!', 'char')).toEqual(['H', 'i', '!']);
    expect(textUnits('a😀', 'char')).toEqual(['a', '😀']);
    const words = textUnits('  hello big  world ', 'word');
    expect(words.join('')).toBe('  hello big  world ');
    expect(words).toHaveLength(3);
  });
});

describe('sampleTextAnimator', () => {
  it('staggers units from the from-pose to rest', () => {
    const at = (t: number) => sampleTextAnimator(fade, 'abc', t);
    expect(at(0).map((p) => p.opacity)).toEqual([0, 0, 0]);
    expect(at(1.5)[0]).toMatchObject({ opacity: 0.5, dy: 5 });
    expect(at(1.5)[1]).toMatchObject({ opacity: 0, dy: 10 });
    expect(at(3).map((p) => p.opacity)).toEqual([1, 1, 1]);
    expect(at(3).every((p) => p.dy === 0)).toBe(true);
  });
  it('out goes from rest to the from-pose; duration 0 snaps (typewriter)', () => {
    const out = sampleTextAnimator({ ...fade, direction: 'out' }, 'ab', 2);
    expect(out[0].opacity).toBe(0);
    expect(out[1].opacity).toBe(0.5);
    const tw = sampleTextAnimator({ ...fade, duration: 0 }, 'ab', 1.2);
    expect(tw.map((p) => p.opacity)).toEqual([1, 0]);
  });
  it('orders: reverse, center and seeded random', () => {
    expect(unitRanks(4, 'reverse')).toEqual([3, 2, 1, 0]);
    expect(unitRanks(5, 'center')).toEqual([2, 1, 0, 1, 2]);
    expect(unitRanks(4, 'center')).toEqual([1, 0, 0, 1]);
    const r = unitRanks(6, 'random', 3);
    expect([...r].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(unitRanks(6, 'random', 3)).toEqual(r);
    expect(unitRanks(6, 'random', 4)).not.toEqual(r);
  });
  it('ends when the last unit lands', () => {
    expect(textAnimatorEnd(fade, 'abc')).toBe(1 + 0.5 * 2 + 1);
    expect(textAnimatorEnd({ ...fade, order: 'center' }, 'abcde')).toBe(1 + 0.5 * 2 + 1);
    expect(textAnimatorEnd(fade, '')).toBe(1);
  });
});

describe('tspan attributes and markup', () => {
  it('dx/dy carry the difference from the previous unit so each unit sits at its own offset', () => {
    const attrs = textUnitAttrs([
      { opacity: 1, dx: 0, dy: 10, rotation: 0 },
      { opacity: 1, dx: 0, dy: 4, rotation: 5 },
      { opacity: 1, dx: 2, dy: 4, rotation: 0 },
    ]);
    expect(attrs.map((a) => a.dy)).toEqual(['10', '-6', '0']);
    expect(attrs.map((a) => a.dx)).toEqual(['0', '0', '2']);
    expect(attrs[1].rotate).toBe('5');
  });
  it('markup escapes content and tags every unit', () => {
    const m = textAnimatorMarkup(fade, 'a<b', 0);
    expect(m.match(/data-savig-unit/g)).toHaveLength(3);
    expect(m).toContain('&lt;');
    expect(m).toContain('fill-opacity="0"');
  });
});

describe('isTextAnimator', () => {
  it('accepts every preset and rejects malformed animators', () => {
    for (const p of Object.values(TEXT_ANIMATOR_PRESETS)) expect(isTextAnimator({ start: 0, ...p.animator })).toBe(true);
    expect(isTextAnimator({ ...fade, by: 'line' })).toBe(false);
    expect(isTextAnimator({ ...fade, stagger: -1 })).toBe(false);
    expect(isTextAnimator({ ...fade, from: { dy: 'x' } })).toBe(false);
    expect(isTextAnimator({ ...fade, order: 'sideways' })).toBe(false);
  });
});
