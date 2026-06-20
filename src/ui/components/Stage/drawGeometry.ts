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
