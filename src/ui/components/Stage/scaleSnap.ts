// Position-snapping for scale/resize drags (slice scale-snap). Pure; reuses computeSnap so the
// dragged corner/edge lands on the same target lines + guides as move-snap. snapScalePoint = free
// per-axis; snapScaleAlongSegment = constrained to the uniform diagonal / from-centre ray.
import { computeSnap, type AABB } from './snapping';

export interface ScaleSnapResult {
  x: number;
  y: number;
  guideX: number | null;
  guideY: number | null;
}

const pointAABB = (x: number, y: number): AABB => ({ minX: x, maxX: x, minY: y, maxY: y });

/** Free per-axis snap of a dragged corner/edge POINT to nearby target lines. Only the dragged
 *  axes (sxAxis/syAxis) move; the matched guide is reported per dragged axis. */
export function snapScalePoint(
  p: { x: number; y: number },
  sxAxis: boolean,
  syAxis: boolean,
  targets: AABB[],
  threshold: number,
): ScaleSnapResult {
  const r = computeSnap(pointAABB(p.x, p.y), targets, threshold);
  return {
    x: p.x + (sxAxis ? r.dx : 0),
    y: p.y + (syAxis ? r.dy : 0),
    guideX: sxAxis ? r.guideX : null,
    guideY: syAxis ? r.guideY : null,
  };
}

/** Keep the point on the segment segStart->segEnd (uniform diagonal / from-centre ray) but slide it
 *  ALONG the segment so the grabbed edge lands on a nearby target line. Returns the segment
 *  projection (no guide) when nothing is near — identity through applyScaleHandleDrag's own
 *  projection. */
export function snapScaleAlongSegment(
  p: { x: number; y: number },
  segStart: { x: number; y: number },
  segEnd: { x: number; y: number },
  targets: AABB[],
  threshold: number,
  gridSize?: number,
): ScaleSnapResult {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : ((p.x - segStart.x) * dx + (p.y - segStart.y) * dy) / len2;
  const proj = { x: segStart.x + t * dx, y: segStart.y + t * dy };
  const r = computeSnap(pointAABB(proj.x, proj.y), targets, threshold);
  const candidates: { x: number; y: number; d: number; gx: number | null; gy: number | null }[] = [];
  // Slide along the segment to land the corner on a guide LINE (object snap OR grid) in one axis — a
  // single along-segment move that PRESERVES the diagonal/ray constraint. Grid line = the nearest
  // lattice line to the projected corner per axis. The threshold gate below rejects far slides.
  const gx = gridSize && gridSize > 0 ? Math.round(proj.x / gridSize) * gridSize : null;
  const gy = gridSize && gridSize > 0 ? Math.round(proj.y / gridSize) * gridSize : null;
  for (const line of [r.guideX, gx]) {
    if (line !== null && Math.abs(dx) > 1e-6) {
      const tx = (line - segStart.x) / dx;
      const c = { x: line, y: segStart.y + tx * dy };
      candidates.push({ ...c, d: Math.hypot(c.x - proj.x, c.y - proj.y), gx: line, gy: null });
    }
  }
  for (const line of [r.guideY, gy]) {
    if (line !== null && Math.abs(dy) > 1e-6) {
      const ty = (line - segStart.y) / dy;
      const c = { x: segStart.x + ty * dx, y: line };
      candidates.push({ ...c, d: Math.hypot(c.x - proj.x, c.y - proj.y), gx: null, gy: line });
    }
  }
  if (candidates.length === 0) return { x: proj.x, y: proj.y, guideX: null, guideY: null };
  candidates.sort((a, b) => a.d - b.d);
  const best = candidates[0];
  // computeSnap gates on the PER-AXIS distance, but sliding along a non-45° segment to reach that
  // line can move the point much further; reject if the actual along-segment move exceeds threshold.
  if (best.d > threshold) return { x: proj.x, y: proj.y, guideX: null, guideY: null };
  return { x: best.x, y: best.y, guideX: best.gx, guideY: best.gy };
}
