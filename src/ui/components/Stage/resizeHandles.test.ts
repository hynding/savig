import { describe, expect, it } from 'vitest';
import { applyHandleResize, handleLocalPositions } from './resizeHandles';

// Stage position of a local point under the object transform, using the same
// closed form the engine uses: M(p) = base + A + RS*(p - A), A = (fx*W, fy*H).
function stagePos(
  p: { x: number; y: number },
  o: { W: number; H: number; fx: number; fy: number; bx: number; by: number; sx: number; sy: number; deg: number },
) {
  const Ax = o.fx * o.W;
  const Ay = o.fy * o.H;
  const t = (o.deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const vx = p.x - Ax;
  const vy = p.y - Ay;
  return {
    x: o.bx + Ax + (c * o.sx * vx - s * o.sy * vy),
    y: o.by + Ay + (s * o.sx * vx + c * o.sy * vy),
  };
}

describe('handleLocalPositions', () => {
  it('places 8 handles around the bbox', () => {
    const p = handleLocalPositions(100, 40);
    expect(p.nw).toEqual({ x: 0, y: 0 });
    expect(p.se).toEqual({ x: 100, y: 40 });
    expect(p.n).toEqual({ x: 50, y: 0 });
    expect(p.e).toEqual({ x: 100, y: 20 });
  });
});

describe('applyHandleResize', () => {
  const base = {
    width: 100,
    height: 40,
    anchorFracX: 0.5,
    anchorFracY: 0.5,
    baseX: 10,
    baseY: 20,
    scaleX: 1,
    scaleY: 1,
    minSize: 1,
  };

  it('SE drag (no rotation) resizes and leaves base unchanged (NW fixed)', () => {
    const r = applyHandleResize({ ...base, handle: 'se', localX: 150, localY: 80, rotationDeg: 0 });
    expect(r.width).toBe(150);
    expect(r.height).toBe(80);
    expect(r.baseX).toBeCloseTo(10);
    expect(r.baseY).toBeCloseTo(20);
  });

  it('NW drag (no rotation) keeps the SE corner fixed in stage space', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 0 };
    const seBefore = stagePos({ x: 100, y: 40 }, o);
    const r = applyHandleResize({ ...base, handle: 'nw', localX: 30, localY: 10, rotationDeg: 0 });
    const seAfter = stagePos({ x: r.width, y: r.height }, { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY });
    expect(seAfter.x).toBeCloseTo(seBefore.x);
    expect(seAfter.y).toBeCloseTo(seBefore.y);
  });

  it('NW drag with rotation keeps the SE corner fixed in stage space', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 30 };
    const seBefore = stagePos({ x: 100, y: 40 }, o);
    const r = applyHandleResize({ ...base, handle: 'nw', localX: 25, localY: 8, rotationDeg: 30 });
    const seAfter = stagePos({ x: r.width, y: r.height }, { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY });
    expect(seAfter.x).toBeCloseTo(seBefore.x);
    expect(seAfter.y).toBeCloseTo(seBefore.y);
  });

  it('clamps to minSize', () => {
    const r = applyHandleResize({ ...base, handle: 'se', localX: -5, localY: -5, rotationDeg: 0 });
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it('uniform: an off-diagonal SE drag keeps the start aspect (width/height)', () => {
    const r = applyHandleResize({
      handle: 'se',
      localX: 260,
      localY: 60, // off the (0,0)->(200,120) start diagonal
      width: 200,
      height: 120,
      anchorFracX: 0.5,
      anchorFracY: 0.5,
      baseX: 0,
      baseY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      minSize: 1,
      uniform: true,
    });
    expect(r.width / r.height).toBeCloseTo(200 / 120); // start aspect preserved
  });

  it('uniform: a near-zero drag keeps aspect at the minSize floor (no asymmetric clamp)', () => {
    const r = applyHandleResize({
      handle: 'se',
      localX: 0,
      localY: 0, // dragged onto the opposite (NW) corner -> below the floor
      width: 200,
      height: 120, // non-square: an asymmetric minSize clamp would break 200:120
      anchorFracX: 0.5,
      anchorFracY: 0.5,
      baseX: 0,
      baseY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      minSize: 1,
      uniform: true,
    });
    expect(r.width / r.height).toBeCloseTo(200 / 120); // aspect preserved
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it('fromCenter SE drag (rot 0): grows symmetrically and keeps the centre fixed', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 0 };
    const centreBefore = stagePos({ x: 50, y: 20 }, o); // local centre
    const r = applyHandleResize({ ...base, handle: 'se', localX: 130, localY: 30, rotationDeg: 0, fromCenter: true });
    expect(r.width).toBeCloseTo(160); // 2*|130-50|
    expect(r.height).toBeCloseTo(20); // 2*|30-20|
    const centreAfter = stagePos(
      { x: r.width / 2, y: r.height / 2 },
      { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY },
    );
    expect(centreAfter.x).toBeCloseTo(centreBefore.x);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y);
  });

  it('fromCenter EDGE (E): grows only width about the centre, height + centre fixed', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 0 };
    const centreBefore = stagePos({ x: 50, y: 20 }, o);
    const r = applyHandleResize({ ...base, handle: 'e', localX: 120, localY: 20, rotationDeg: 0, fromCenter: true });
    expect(r.width).toBeCloseTo(140); // 2*|120-50|
    expect(r.height).toBeCloseTo(40); // unchanged
    const centreAfter = stagePos(
      { x: r.width / 2, y: r.height / 2 },
      { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY },
    );
    expect(centreAfter.x).toBeCloseTo(centreBefore.x);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y);
  });

  it('fromCenter SE drag keeps the centre fixed under rotation', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 30 };
    const centreBefore = stagePos({ x: 50, y: 20 }, o);
    const r = applyHandleResize({ ...base, handle: 'se', localX: 140, localY: 35, rotationDeg: 30, fromCenter: true });
    const centreAfter = stagePos(
      { x: r.width / 2, y: r.height / 2 },
      { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY },
    );
    expect(centreAfter.x).toBeCloseTo(centreBefore.x);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y);
  });

  it('fromCenter + uniform: off-diagonal SE drag preserves the start aspect', () => {
    const r = applyHandleResize({
      handle: 'se',
      localX: 160,
      localY: 60, // off the centre->corner line
      width: 200,
      height: 120,
      anchorFracX: 0.5,
      anchorFracY: 0.5,
      baseX: 0,
      baseY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      minSize: 1,
      fromCenter: true,
      uniform: true,
    });
    expect(r.width / r.height).toBeCloseTo(200 / 120);
  });
});
