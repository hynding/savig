import type { MorphMode, PathData, PathNode } from '../types';
import { resample, SAMPLE_COUNT } from './resample';
import { align } from './align';

export interface Reconciled {
  an: PathNode[];
  bn: PathNode[];
}

// Index-pad: lengthen `nodes` to `len` by repeating a degenerate corner node at the
// last anchor, so extra nodes morph as growing out of / retracting into a point.
// (Moved verbatim from path.ts so `corresponded` is byte-identical to Slice 3.)
function padNodes(nodes: PathNode[], len: number): PathNode[] {
  if (nodes.length >= len) return nodes;
  const last = nodes[nodes.length - 1];
  const padded = nodes.slice();
  while (padded.length < len) padded.push({ anchor: { x: last.anchor.x, y: last.anchor.y } });
  return padded;
}

// Produce equal-length matched node arrays for two bracketing shapes. The single
// reconciliation seam: index-pad (corresponded, default) or arc-length resample.
export function reconcile(
  a: PathData,
  b: PathData,
  mode: MorphMode,
  _correspondence?: number[],
): Reconciled {
  if (mode === 'resampled') {
    const an = resample(a, SAMPLE_COUNT);
    const bn = align(resample(b, SAMPLE_COUNT), an, a.closed);
    return { an, bn };
  }
  const len = Math.max(a.nodes.length, b.nodes.length);
  return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len) };
}
