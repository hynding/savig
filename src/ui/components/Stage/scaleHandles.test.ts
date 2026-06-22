import { describe, it, expect } from 'vitest';
import { applyScaleHandleDrag, scaleHandleLocalPositions, oppositeHandle, MIN_SCALE } from './scaleHandles';

// 100x100 bbox at origin, anchor at centre (50,50), no rotation, scale 1, base (0,0).
const base = {
  anchorX: 50,
  anchorY: 50,
  startScaleX: 1,
  startScaleY: 1,
  baseX: 0,
  baseY: 0,
  rotationDeg: 0,
};

describe('scaleHandleLocalPositions / oppositeHandle', () => {
  it('places all eight handles (respecting a non-zero bbox origin)', () => {
    const p = scaleHandleLocalPositions({ x: 10, y: 20, width: 100, height: 60 });
    expect(p.nw).toEqual({ x: 10, y: 20 });
    expect(p.n).toEqual({ x: 60, y: 20 });
    expect(p.ne).toEqual({ x: 110, y: 20 });
    expect(p.e).toEqual({ x: 110, y: 50 });
    expect(p.se).toEqual({ x: 110, y: 80 });
    expect(p.s).toEqual({ x: 60, y: 80 });
    expect(p.sw).toEqual({ x: 10, y: 80 });
    expect(p.w).toEqual({ x: 10, y: 50 });
  });
  it('maps each handle to its opposite (corners and edges)', () => {
    expect(oppositeHandle('nw')).toBe('se');
    expect(oppositeHandle('se')).toBe('nw');
    expect(oppositeHandle('ne')).toBe('sw');
    expect(oppositeHandle('sw')).toBe('ne');
    expect(oppositeHandle('n')).toBe('s');
    expect(oppositeHandle('s')).toBe('n');
    expect(oppositeHandle('e')).toBe('w');
    expect(oppositeHandle('w')).toBe('e');
  });
});

describe('applyScaleHandleDrag', () => {
  it('dragging SE to (200,200) doubles the scale and keeps NW fixed', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 100 }, // SE local
      opposite: { x: 0, y: 0 }, // NW local
      pointerX: 200,
      pointerY: 200, // content coords
    });
    expect(r.scaleX).toBeCloseTo(2);
    expect(r.scaleY).toBeCloseTo(2);
    expect(r.x).toBeCloseTo(50);
    expect(r.y).toBeCloseTo(50);
    // content(p) = a + R·S·(p-a) + (x,y); rot=0 -> a + S·(p-a) + (x,y).
    const nwContentX = 50 + r.scaleX * (0 - 50) + r.x;
    const nwContentY = 50 + r.scaleY * (0 - 50) + r.y;
    expect(nwContentX).toBeCloseTo(0); // NW stays where it started (content 0,0)
    expect(nwContentY).toBeCloseTo(0);
  });

  it('keeps the opposite corner fixed under rotation (90deg)', () => {
    const rot = 90;
    const corner = { x: 100, y: 100 }; // SE
    const opposite = { x: 0, y: 0 }; // NW (fixed)
    const startNwX = 50 + 50; // R(90)·(o-a) = R(90)·(-50,-50) = (50,-50); content x = 50+50
    const startNwY = 50 + -50; // content y = 50-50
    const r = applyScaleHandleDrag({ ...base, rotationDeg: rot, corner, opposite, pointerX: 300, pointerY: 120 });
    const t = (rot * Math.PI) / 180,
      c = Math.cos(t),
      s = Math.sin(t);
    const vx = r.scaleX * (0 - 50),
      vy = r.scaleY * (0 - 50);
    const nwX = 50 + (c * vx - s * vy) + r.x;
    const nwY = 50 + (s * vx + c * vy) + r.y;
    expect(nwX).toBeCloseTo(startNwX);
    expect(nwY).toBeCloseTo(startNwY);
  });

  it('clamps a collapsing drag to MIN_SCALE', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 100 },
      opposite: { x: 0, y: 0 },
      pointerX: 0,
      pointerY: 0, // dragged onto the opposite corner -> would be scale 0
    });
    expect(r.scaleX).toBeCloseTo(MIN_SCALE);
    expect(r.scaleY).toBeCloseTo(MIN_SCALE);
  });

  it('dragging the E (right-edge) handle scales only X and holds the left edge fixed', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 50 }, // right-edge mid (E), local
      opposite: { x: 0, y: 50 }, // left-edge mid (W), local
      pointerX: 200,
      pointerY: 50, // content coords
    });
    expect(r.scaleX).toBeCloseTo(2);
    expect(r.scaleY).toBeCloseTo(1); // Y unchanged (single-axis)
    // The left edge (W, local x=0) stays at content x=0: a + R·S·(o-a) + (x,y), rot=0.
    expect(50 + r.scaleX * (0 - 50) + r.x).toBeCloseTo(0);
  });

  it('dragging the N (top-edge) handle scales only Y', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 50, y: 0 }, // top-edge mid (N)
      opposite: { x: 50, y: 100 }, // bottom-edge mid (S)
      pointerX: 50,
      pointerY: -100,
    });
    expect(r.scaleY).toBeCloseTo(2);
    expect(r.scaleX).toBeCloseTo(1); // X unchanged
  });

  it('uniform: an off-diagonal SE drag keeps a square aspect (scaleX === scaleY)', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 100 }, // SE
      opposite: { x: 0, y: 0 }, // NW
      pointerX: 200,
      pointerY: 150, // off the (0,0)->(100,100) diagonal
      uniform: true,
    });
    expect(r.scaleX).toBeCloseTo(r.scaleY); // aspect locked
    expect(r.scaleX).toBeCloseTo(1.75); // projection of (200,150) onto the diagonal -> (175,175)
  });

  it('uniform: preserves a NON-square start aspect (scaleX/scaleY === startScaleX/startScaleY)', () => {
    const r = applyScaleHandleDrag({
      ...base,
      startScaleX: 2,
      startScaleY: 1, // start aspect 2:1
      corner: { x: 100, y: 100 },
      opposite: { x: 0, y: 0 },
      pointerX: 260,
      pointerY: 130,
      uniform: true,
    });
    expect(r.scaleX / r.scaleY).toBeCloseTo(2); // 2:1 preserved regardless of pointer
  });
});
