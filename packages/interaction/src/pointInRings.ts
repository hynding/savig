import type { PathData, PathPoint } from '@savig/engine';

/**
 * Even-odd point-in-region hit test over a set of CORNER-NODE polygon rings (e.g. a
 * `decomposeRegions` region's `rings`, or any compound even-odd shape's flattened outline —
 * node in/out handles are ignored, matching the corner-only rings these tests are meant for).
 * Ray-casts in +x from `p` and counts edge crossings across ALL rings combined — a point
 * inside an odd number of rings (fill) but an even number counting a hole ring on top is
 * correctly excluded, exactly like SVG fill-rule:evenodd.
 *
 * Boundary rule (half-open, avoids double-counting shared vertices): an edge from a to b
 * counts as crossing the p.y scanline when `a.y <= p.y < b.y` or `b.y <= p.y < a.y` (whichever
 * endpoint is lower "owns" that y). For an axis-aligned rectangle this pins boundary points
 * on the LEFT and BOTTOM edges as inside, and the RIGHT and TOP edges as outside — see
 * pointInRings.test.ts.
 */
export function pointInRings(rings: PathData[], p: PathPoint): boolean {
  let inside = false;
  for (const ring of rings) {
    const pts = ring.nodes.map((n) => n.anchor);
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const crosses = (a.y <= p.y && p.y < b.y) || (b.y <= p.y && p.y < a.y);
      if (!crosses) continue;
      const t = (p.y - a.y) / (b.y - a.y);
      const xAtY = a.x + t * (b.x - a.x);
      if (p.x < xAtY) inside = !inside;
    }
  }
  return inside;
}
