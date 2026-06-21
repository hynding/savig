import type { MorphMode, PathData, PathNode } from '../types';
import { resample, SAMPLE_COUNT } from './resample';
import { align } from './align';

export interface Reconciled {
  an: PathNode[];
  bn: PathNode[];
  /** Source from-node index for each output pair, or -1 when the pair has no source
   *  node (index-pad padding, grow-from-point spur, or a resampled point). Lets a
   *  per-node easing follow its node through reconciliation. */
  aIndex: number[];
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

// A map is structurally valid when it has one entry per A node and every entry indexes a
// real B node. Cyclic-order-preservation is the EDITOR's invariant (walk-B keeps the
// destination endpoint exact regardless), so it is not checked here.
function validMap(c: number[] | undefined, m: number, n: number): c is number[] {
  if (!c || c.length !== m || n === 0) return false;
  for (const j of c) {
    if (!Number.isInteger(j) || j < 0 || j >= n) return false;
  }
  return true;
}

// Walk B in ring order; gather the A nodes feeding each B node. Empty source -> a
// grow-from-point spur (degenerate A at the last emitted A anchor, else A[0]). Multiple
// sources -> an adjacent merge (B node duplicated). This makes `bn` exactly B's nodes in
// ring order, so the destination endpoint traces B by construction.
function reconcileMap(a: PathData, b: PathData, c: number[]): Reconciled {
  const an: PathNode[] = [];
  const bn: PathNode[] = [];
  const aIndex: number[] = [];
  let lastAAnchor = a.nodes[0].anchor;
  for (let j = 0; j < b.nodes.length; j++) {
    const srcs: number[] = [];
    for (let i = 0; i < c.length; i++) if (c[i] === j) srcs.push(i);
    if (srcs.length === 0) {
      an.push({ anchor: { x: lastAAnchor.x, y: lastAAnchor.y } });
      bn.push(b.nodes[j]);
      aIndex.push(-1);
    } else {
      for (const i of srcs) {
        an.push(a.nodes[i]);
        bn.push(b.nodes[j]);
        aIndex.push(i);
        lastAAnchor = a.nodes[i].anchor;
      }
    }
  }
  return { an, bn, aIndex };
}

// Produce equal-length matched node arrays for two bracketing shapes. The single
// reconciliation seam: index-pad (corresponded, default), an explicit corresponded map,
// or arc-length resample.
export function reconcile(
  a: PathData,
  b: PathData,
  mode: MorphMode,
  correspondence?: number[],
): Reconciled {
  if (mode === 'resampled') {
    const an = resample(a, SAMPLE_COUNT);
    const bn = align(resample(b, SAMPLE_COUNT), an, a.closed);
    return { an, bn, aIndex: new Array<number>(an.length).fill(-1) };
  }
  if (validMap(correspondence, a.nodes.length, b.nodes.length)) {
    return reconcileMap(a, b, correspondence);
  }
  const len = Math.max(a.nodes.length, b.nodes.length);
  const m = a.nodes.length;
  const aIndex = Array.from({ length: len }, (_, i) => (i < m ? i : -1));
  return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len), aIndex };
}
