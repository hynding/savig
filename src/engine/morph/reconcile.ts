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
  let lastAAnchor = a.nodes[0].anchor;
  for (let j = 0; j < b.nodes.length; j++) {
    const srcs: number[] = [];
    for (let i = 0; i < c.length; i++) if (c[i] === j) srcs.push(i);
    if (srcs.length === 0) {
      an.push({ anchor: { x: lastAAnchor.x, y: lastAAnchor.y } });
      bn.push(b.nodes[j]);
    } else {
      for (const i of srcs) {
        an.push(a.nodes[i]);
        bn.push(b.nodes[j]);
        lastAAnchor = a.nodes[i].anchor;
      }
    }
  }
  return { an, bn };
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
    return { an, bn };
  }
  if (validMap(correspondence, a.nodes.length, b.nodes.length)) {
    return reconcileMap(a, b, correspondence);
  }
  const len = Math.max(a.nodes.length, b.nodes.length);
  return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len) };
}
