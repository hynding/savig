import type { PathData, PathPoint } from '../../../engine';
import { hitTestAnchor, hitTestHandle } from './pathHitTest';

export type RingTarget =
  | { ring: number; kind: 'anchor'; index: number }
  | { ring: number; kind: 'handle'; index: number; side: 'in' | 'out' };

// Pick the node/handle under `local` across all editable rings. Handle hits beat anchor
// hits (handles are the finer target and sit slightly off the anchor); lower ring index
// wins ties. Returns null when nothing is within `tol`.
export function pickRingTarget(rings: PathData[], local: PathPoint, tol: number): RingTarget | null {
  for (let ring = 0; ring < rings.length; ring++) {
    const h = hitTestHandle(rings[ring], local, tol);
    if (h) return { ring, kind: 'handle', index: h.index, side: h.side };
  }
  for (let ring = 0; ring < rings.length; ring++) {
    const a = hitTestAnchor(rings[ring], local, tol);
    if (a != null) return { ring, kind: 'anchor', index: a };
  }
  return null;
}
