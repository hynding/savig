import type { PathData } from '@savig/engine';

// True iff `c` is cyclic-order-preserving: a rotation/reflection of B's ring (closed) or
// a non-decreasing sequence (open), allowing equal consecutive values (adjacent merges).
export function isOrderPreserving(c: number[], n: number, closed: boolean): boolean {
  if (c.length === 0 || n === 0) return true;
  const nonDecreasing = (seq: number[]) => seq.every((v, i) => i === 0 || v >= seq[i - 1]);
  if (!closed) return nonDecreasing(c);
  // Closed: some rotation of c is non-decreasing in one of the two windings.
  const windings = [c, c.map((v) => n - 1 - v)];
  for (const w of windings) {
    for (let k = 0; k < w.length; k++) {
      const rot = w.slice(k).concat(w.slice(0, k));
      if (nonDecreasing(rot)) return true;
    }
  }
  return false;
}

export function unreferencedTargets(c: number[], n: number): number[] {
  const seen = new Set(c);
  const out: number[] = [];
  for (let j = 0; j < n; j++) if (!seen.has(j)) out.push(j);
  return out;
}

export function linkSegments(
  from: PathData,
  to: PathData,
  c: number[],
): { ai: number; bi: number; ax: number; ay: number; bx: number; by: number }[] {
  const out: { ai: number; bi: number; ax: number; ay: number; bx: number; by: number }[] = [];
  for (let i = 0; i < c.length && i < from.nodes.length; i++) {
    const bi = c[i];
    if (bi < 0 || bi >= to.nodes.length) continue;
    const a = from.nodes[i].anchor;
    const b = to.nodes[bi].anchor;
    out.push({ ai: i, bi, ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }
  return out;
}
