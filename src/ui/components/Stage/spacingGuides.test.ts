import { describe, it, expect } from 'vitest';
import { computeSpacingSnap } from './spacingGuides';
import type { AABB } from './snapping';

const box = (minX: number, minY: number, maxX: number, maxY: number): AABB => ({ minX, minY, maxX, maxY });

describe('computeSpacingSnap — equal spacing between immediate neighbors', () => {
  // L: x 0..20, R: x 100..120, both share the moving object's vertical band (y 0..20).
  const L = box(0, 0, 20, 20);
  const R = box(100, 0, 120, 20);

  it('snaps a near-centered object to equal horizontal gaps + emits two h-guides', () => {
    // moving 50..70: gapL = 50-20 = 30, gapR = 100-70 = 30 already equal → dx 0, still reports guides.
    const r = computeSpacingSnap(box(50, 0, 70, 20), [L, R], 6);
    expect(r.dx).toBeCloseTo(0);
    expect(r.guides.filter((g) => g.orientation === 'h')).toHaveLength(2);
    expect(r.guides[0].gap).toBeCloseTo(30);
  });

  it('shifts a slightly off-center object to equalize the gaps (within threshold)', () => {
    // moving 54..74: gapL = 34, gapR = 26 → δ = (26-34)/2 = -4 (shift left 4) → both become 30.
    const r = computeSpacingSnap(box(54, 0, 74, 20), [L, R], 6);
    expect(r.dx).toBeCloseTo(-4);
    expect(r.guides.every((g) => Math.abs(g.gap - 30) < 1e-6)).toBe(true);
  });

  it('does NOT snap when equalizing would exceed the threshold', () => {
    // moving 60..80: gapL = 40, gapR = 20 → δ = -10, |δ| > 6 → no horizontal spacing.
    const r = computeSpacingSnap(box(60, 0, 80, 20), [L, R], 6);
    expect(r.dx).toBe(0);
    expect(r.guides.filter((g) => g.orientation === 'h')).toHaveLength(0);
  });

  it('ignores neighbors that do not vertically overlap the moving object', () => {
    const farL = box(0, 200, 20, 220); // way below — not in the row
    const r = computeSpacingSnap(box(50, 0, 70, 20), [farL, R], 6);
    expect(r.dx).toBe(0);
    expect(r.guides).toHaveLength(0); // only one side present → no centering
  });

  it('detects vertical equal spacing independently', () => {
    const T = box(0, 0, 20, 20);
    const B = box(0, 100, 20, 120);
    // moving y 54..74 (x overlaps): gapT = 34, gapB = 26 → δy = -4.
    const r = computeSpacingSnap(box(0, 54, 20, 74), [T, B], 6);
    expect(r.dy).toBeCloseTo(-4);
    expect(r.guides.filter((g) => g.orientation === 'v')).toHaveLength(2);
  });

  it('returns nothing when there are no flanking neighbors', () => {
    const r = computeSpacingSnap(box(50, 0, 70, 20), [L], 6); // only a left neighbor
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});
