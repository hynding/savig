import { describe, it, expect } from 'vitest';
import { snapAABBToGrid, snapPointToGridAxes } from './gridSnap';
import type { AABB } from './snapping';

const box = (minX: number, minY: number, maxX: number, maxY: number): AABB => ({ minX, minY, maxX, maxY });

describe('snapAABBToGrid', () => {
  it('snaps the bbox top-left to the nearest grid multiple (both axes)', () => {
    const r = snapAABBToGrid(box(23, 17, 63, 57), 20);
    expect(r.dx).toBe(-3); // 23 → 20
    expect(r.dy).toBe(3); // 17 → 20
  });

  it('rounds to the nearest line (down or up)', () => {
    expect(snapAABBToGrid(box(8, 0, 18, 10), 20).dx).toBe(-8); // 8 → 0
    expect(snapAABBToGrid(box(12, 0, 22, 10), 20).dx).toBe(8); // 12 → 20
  });

  it('is a no-op when already on the grid', () => {
    expect(snapAABBToGrid(box(40, 60, 80, 100), 20)).toEqual({ dx: 0, dy: 0 });
  });

  it('handles negative coordinates', () => {
    expect(snapAABBToGrid(box(-23, -17, -3, 3), 20)).toEqual({ dx: 3, dy: -3 }); // -23→-20, -17→-20
  });

  it('returns no shift for a non-positive grid size (guard)', () => {
    expect(snapAABBToGrid(box(23, 17, 63, 57), 0)).toEqual({ dx: 0, dy: 0 });
    expect(snapAABBToGrid(box(23, 17, 63, 57), -5)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('snapPointToGridAxes (handle drags — per dragged, unclaimed axis)', () => {
  it('snaps both dragged, unclaimed axes to the grid', () => {
    expect(snapPointToGridAxes({ x: 23, y: 17 }, true, true, false, false, 20)).toEqual({ x: 20, y: 20 });
  });

  it('does NOT snap an axis already claimed by object-snap', () => {
    expect(snapPointToGridAxes({ x: 23, y: 17 }, true, true, true, false, 20)).toEqual({ x: 23, y: 20 });
  });

  it('does NOT snap a non-dragged axis (e.g. an east edge handle: x only)', () => {
    expect(snapPointToGridAxes({ x: 23, y: 17 }, true, false, false, false, 20)).toEqual({ x: 20, y: 17 });
  });

  it('is a no-op for a non-positive grid size', () => {
    expect(snapPointToGridAxes({ x: 23, y: 17 }, true, true, false, false, 0)).toEqual({ x: 23, y: 17 });
  });
});
