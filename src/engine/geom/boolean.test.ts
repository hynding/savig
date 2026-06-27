import { describe, it, expect } from 'vitest';
import { booleanOp, objectToWorldPolygon, ringArea } from './boolean';
import { createProject, createSceneObject, createGroupObject, createVectorAsset } from '../project';
import type { PathData, Project, SceneObject, VectorAsset } from '../types';

// A closed square path (local coords) from (0,0) to (s,s).
function squarePath(s: number): PathData {
  return {
    closed: true,
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: s, y: 0 } },
      { anchor: { x: s, y: s } },
      { anchor: { x: 0, y: s } },
    ],
  };
}

// Build a project from a list of [object, asset] pairs.
function proj(...pairs: [SceneObject, VectorAsset][]): Project {
  return { ...createProject(), objects: pairs.map((p) => p[0]), assets: pairs.map((p) => p[1]) };
}

// A path object placed at world (tx,ty) with the given local path; anchorMode 'fraction'.
function pathObj(id: string, zOrder: number, path: PathData, tx: number, ty: number): [SceneObject, VectorAsset] {
  const asset = createVectorAsset('path', { id: `${id}-a`, path });
  const obj = createSceneObject(asset.id, {
    id,
    zOrder,
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    base: { x: tx, y: ty, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  });
  return [obj, asset];
}

describe('ringArea', () => {
  it('equals the area magnitude regardless of winding', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(Math.abs(ringArea(sq))).toBeCloseTo(100, 6);
  });
});

describe('objectToWorldPolygon', () => {
  it('bakes a path object through its translation into world coords', () => {
    const [o, a] = pathObj('o', 0, squarePath(10), 100, 50);
    const poly = objectToWorldPolygon(proj([o, a]), o, 0);
    const xs = poly[0].map((p) => p[0]);
    const ys = poly[0].map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(100, 4);
    expect(Math.max(...xs)).toBeCloseTo(110, 4);
    expect(Math.min(...ys)).toBeCloseTo(50, 4);
    expect(Math.max(...ys)).toBeCloseTo(60, 4);
  });
});

describe('booleanOp', () => {
  it('union of two overlapping squares -> one ring spanning the union bbox', () => {
    const A = pathObj('a', 0, squarePath(10), 0, 0); // 0..10
    const B = pathObj('b', 1, squarePath(10), 5, 5); // 5..15
    const out = booleanOp(proj(A, B), [A[0], B[0]], 'union', 0);
    expect(out.length).toBe(1);
    const xs = out[0].nodes.map((n) => n.anchor.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 4);
    expect(Math.max(...xs)).toBeCloseTo(15, 4);
  });

  it('interior subtract -> 2 rings (outer + hole)', () => {
    const big = pathObj('big', 0, squarePath(30), 0, 0); // bottom-most
    const small = pathObj('small', 1, squarePath(10), 10, 10); // fully interior, upper
    const out = booleanOp(proj(big, small), [big[0], small[0]], 'subtract', 0);
    expect(out.length).toBe(2);
  });

  it('intersect of overlap -> one ring at the overlap bbox', () => {
    const A = pathObj('a', 0, squarePath(10), 0, 0); // 0..10
    const B = pathObj('b', 1, squarePath(10), 5, 0); // 5..15
    const out = booleanOp(proj(A, B), [A[0], B[0]], 'intersect', 0);
    expect(out.length).toBe(1);
    const xs = out[0].nodes.map((n) => n.anchor.x);
    expect(Math.min(...xs)).toBeCloseTo(5, 4);
    expect(Math.max(...xs)).toBeCloseTo(10, 4);
  });

  it('intersect of disjoint shapes -> empty', () => {
    const A = pathObj('a', 0, squarePath(10), 0, 0);
    const B = pathObj('b', 1, squarePath(10), 100, 100);
    expect(booleanOp(proj(A, B), [A[0], B[0]], 'intersect', 0)).toEqual([]);
  });

  it('disjoint union -> 2 rings', () => {
    const A = pathObj('a', 0, squarePath(10), 0, 0);
    const B = pathObj('b', 1, squarePath(10), 100, 100);
    const out = booleanOp(proj(A, B), [A[0], B[0]], 'union', 0);
    expect(out.length).toBe(2);
  });

  it('a GROUP operand contributes its leaf shapes (union with an outside square)', () => {
    const C = pathObj('c', 0, squarePath(10), 0, 0); // 0..10
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 1 });
    const D = pathObj('d', 2, squarePath(10), 30, 0); // 30..40, inside the group
    D[0].parentId = 'g';
    const project = { ...createProject(), objects: [C[0], g, D[0]], assets: [C[1], D[1]] };
    const out = booleanOp(project, [C[0], g], 'union', 0);
    expect(out.length).toBe(2); // C and the group's leaf D, disjoint
  });

  it('a GROUP operand acts as the UNION of its leaves — intersect keeps BOTH disjoint pieces', () => {
    // big ∩ group{s1, s2}  ==  big ∩ (s1 ∪ s2)  ==  s1 ∪ s2  (2 rings).
    // If the group were flattened to separate operands it would be big ∩ s1 ∩ s2 = ∅.
    const big = pathObj('big', 0, squarePath(100), 0, 0);
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 1 });
    const s1 = pathObj('s1', 2, squarePath(10), 10, 10);
    const s2 = pathObj('s2', 3, squarePath(10), 50, 50);
    s1[0].parentId = 'g';
    s2[0].parentId = 'g';
    const project = { ...createProject(), objects: [big[0], g, s1[0], s2[0]], assets: [big[1], s1[1], s2[1]] };
    const out = booleanOp(project, [big[0], g], 'intersect', 0);
    expect(out.length).toBe(2);
  });
});
