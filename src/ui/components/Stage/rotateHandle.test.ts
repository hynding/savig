import { describe, it, expect } from 'vitest';
import { angleDeg, rotationFromDrag, rotateHandleLocal } from './rotateHandle';

describe('angleDeg', () => {
  const pivot = { x: 0, y: 0 };
  it('0 to the right, 90 down, 180 left, -90 up (screen y-down)', () => {
    expect(angleDeg(pivot, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(angleDeg(pivot, { x: 0, y: 10 })).toBeCloseTo(90);
    expect(angleDeg(pivot, { x: -10, y: 0 })).toBeCloseTo(180);
    expect(angleDeg(pivot, { x: 0, y: -10 })).toBeCloseTo(-90);
  });
});

describe('rotationFromDrag', () => {
  const pivot = { x: 50, y: 50 };
  it('adds the swept angular delta to the start rotation', () => {
    // start above the pivot (-90deg), drag to the right (0deg) => +90 sweep
    expect(rotationFromDrag(pivot, { x: 50, y: 0 }, { x: 100, y: 50 }, 0)).toBeCloseTo(90);
  });
  it('is relative to the start rotation (no jump when grabbing off-center)', () => {
    expect(rotationFromDrag(pivot, { x: 50, y: 0 }, { x: 50, y: 0 }, 30)).toBeCloseTo(30);
  });
});

describe('rotateHandleLocal', () => {
  it('base at bbox top-center, handle a stalk above', () => {
    expect(rotateHandleLocal({ x: 0, y: 0, width: 100, height: 60 }, 24)).toEqual({
      base: { x: 50, y: 0 },
      handle: { x: 50, y: -24 },
    });
  });
  it('respects a non-zero bbox origin', () => {
    expect(rotateHandleLocal({ x: 10, y: 20, width: 40, height: 40 }, 10)).toEqual({
      base: { x: 30, y: 20 },
      handle: { x: 30, y: 10 },
    });
  });
});
