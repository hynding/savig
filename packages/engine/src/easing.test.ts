import { describe, expect, it, test } from 'vitest';
import type { Easing } from './types';
import { applyEasing, easingRegistry, easingAsBezier, splitEasing } from './easing';

describe('easingRegistry', () => {
  test('all named easings fix the endpoints 0 and 1', () => {
    for (const fn of Object.values(easingRegistry)) {
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
  });

  test('linear is the identity', () => {
    expect(easingRegistry.linear(0.25)).toBeCloseTo(0.25, 6);
    expect(easingRegistry.linear(0.5)).toBeCloseTo(0.5, 6);
  });

  test('easeIn starts slow (below linear at t=0.5)', () => {
    expect(easingRegistry.easeIn(0.5)).toBeLessThan(0.5);
  });

  test('easeOut ends slow (above linear at t=0.5)', () => {
    expect(easingRegistry.easeOut(0.5)).toBeGreaterThan(0.5);
  });

  test('easeInOut is symmetric and crosses 0.5 at the midpoint', () => {
    expect(easingRegistry.easeInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(easingRegistry.easeInOut(0.25)).toBeLessThan(0.25); // slow start
    expect(easingRegistry.easeInOut(0.75)).toBeGreaterThan(0.75); // fast then slow finish
  });
});

describe('applyEasing', () => {
  test('resolves a named easing', () => {
    expect(applyEasing('linear', 0.4)).toBeCloseTo(0.4, 6);
  });

  test('resolves a cubic-bezier easing at the midpoint of a symmetric curve', () => {
    // ease-in-out cubic-bezier(0.42, 0, 0.58, 1) is symmetric → 0.5 at t=0.5
    const eased = applyEasing(
      { type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 },
      0.5,
    );
    expect(eased).toBeCloseTo(0.5, 3);
  });

  test('cubic-bezier fixes the endpoints', () => {
    const easing = { type: 'cubicBezier', p1: 0.25, p2: 0.1, p3: 0.25, p4: 1 } as const;
    expect(applyEasing(easing, 0)).toBeCloseTo(0, 4);
    expect(applyEasing(easing, 1)).toBeCloseTo(1, 4);
  });
});

describe('splitEasing (motion editor: insert a key without changing the motion)', () => {
  const cases: [string, Easing][] = [
    ['easeIn', 'easeIn'],
    ['easeOut', 'easeOut'],
    ['bezier', { type: 'cubicBezier', p1: 0.2, p2: 0.9, p3: 0.3, p4: 1.2 }],
    ['overshoot', { type: 'cubicBezier', p1: 0.6, p2: -0.4, p3: 0.4, p4: 1.4 }],
  ];
  for (const [name, e] of cases) {
    it(`${name}: the two halves reproduce the original curve`, () => {
      for (const u of [0.25, 0.5, 0.7]) {
        const halves = splitEasing(e, u)!;
        expect(halves).not.toBeNull();
        const [l, r] = halves;
        const ym = applyEasing(e, u);
        for (const x of [0.1, 0.4, 0.9]) {
          // Left half covers [0, u] of time and [0, ym] of value; right half the rest.
          expect(ym * applyEasing(l, x)).toBeCloseTo(applyEasing(e, x * u), 4);
          expect(ym + (1 - ym) * applyEasing(r, x)).toBeCloseTo(applyEasing(e, u + x * (1 - u)), 4);
        }
      }
    });
  }
  it('linear stays linear; out-of-range u gives null', () => {
    expect(splitEasing('linear', 0.3)).toEqual(['linear', 'linear']);
    expect(splitEasing('easeIn', 0)).toBeNull();
    expect(splitEasing('easeIn', 1)).toBeNull();
  });
  it('easingAsBezier: exact for the quadratics', () => {
    for (const n of ['linear', 'easeIn', 'easeOut'] as const) {
      for (const u of [0.2, 0.6]) expect(applyEasing(easingAsBezier(n), u)).toBeCloseTo(applyEasing(n, u), 4);
    }
  });
});
