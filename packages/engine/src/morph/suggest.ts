import type { PathData } from '../types';
import { bestAlignment } from './align';

// c[i] = min(i, n-1): a well-defined identity map clamped into B's index range.
export function identityCorrespondence(m: number, n: number): number[] {
  const out = new Array<number>(m);
  for (let i = 0; i < m; i++) out[i] = Math.min(i, n - 1);
  return out;
}

// Suggested a-index -> b-index map. Equal counts: the cut-point rotation (+ winding) that
// minimizes total travel, reusing align()'s search. Unequal counts: clamped identity.
export function suggestCorrespondence(a: PathData, b: PathData): number[] {
  const m = a.nodes.length;
  const n = b.nodes.length;
  if (m === 0 || n === 0) return [];
  if (m !== n) return identityCorrespondence(m, n);
  const { offset, reversed } = bestAlignment(b.nodes, a.nodes, a.closed);
  const out = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    const rotated = (i + offset) % n;
    out[i] = reversed ? n - 1 - rotated : rotated;
  }
  return out;
}

// Rotate the cut point: every target advances by `delta` (mod n). Keeps a rotation a
// rotation; uniformly rotates a custom map's targets. delta is typically +1 / -1.
export function shiftCorrespondence(c: number[], n: number, delta: number): number[] {
  if (n === 0) return c.slice();
  return c.map((j) => (((j + delta) % n) + n) % n);
}

// Flip winding: target j -> n-1-j.
export function reverseCorrespondence(c: number[], n: number): number[] {
  return c.map((j) => n - 1 - j);
}
