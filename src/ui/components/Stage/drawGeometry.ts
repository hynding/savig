import { polygonPath, starPath, linePath, type PathData, type PrimitiveSpec } from '../../../engine';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Normalizes a drag (either direction) into a positive-extent box. Returns null
// when either dimension is below minSize (a degenerate click, not a shape).
export function rectFromDrag(start: Point, end: Point, minSize: number): Bounds | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < minSize || height < minSize) return null;
  return { x, y, width, height };
}

export interface PrimitiveOpts {
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
  cornerRadius: number;
}

// Turns a single drag into a primitive's PathData (stage-space). For polygon/star the
// drag origin is the center and the drag distance is the radius (the drag direction
// orients the first vertex); a line spans start→end. Returns null for a sub-threshold
// drag (a degenerate click).
export function primitivePathFromDrag(
  tool: 'polygon' | 'star' | 'line',
  start: Point,
  end: Point,
  opts: PrimitiveOpts,
  minSize: number,
): PathData | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < minSize) return null;
  if (tool === 'line') return linePath(start, end);
  const rotation = Math.atan2(dy, dx) + Math.PI / 2; // first vertex points toward the drag
  if (tool === 'polygon') return polygonPath(start.x, start.y, dist, opts.polygonSides, rotation, opts.cornerRadius);
  return starPath(start.x, start.y, dist, dist * opts.starInnerRatio, opts.starPoints, rotation, opts.cornerRadius);
}

// The STAGE-frame parametric spec for a polygon/star stamp (slice 35). Mirrors
// primitivePathFromDrag's center-out geometry; null for a sub-threshold drag.
export function primitiveSpecFromDrag(
  tool: 'polygon' | 'star',
  start: Point,
  end: Point,
  opts: PrimitiveOpts,
  minSize: number,
): PrimitiveSpec | null {
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  if (dist < minSize) return null;
  const rotation = Math.atan2(end.y - start.y, end.x - start.x) + Math.PI / 2;
  return tool === 'polygon'
    ? { kind: 'polygon', cx: start.x, cy: start.y, radius: dist, rotation, sides: opts.polygonSides, cornerRadius: opts.cornerRadius }
    : { kind: 'star', cx: start.x, cy: start.y, radius: dist, rotation, points: opts.starPoints, innerRatio: opts.starInnerRatio, cornerRadius: opts.cornerRadius };
}
