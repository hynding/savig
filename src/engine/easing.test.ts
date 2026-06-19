import { describe, expect, test } from 'vitest';
import { applyEasing, easingRegistry } from './easing';

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
