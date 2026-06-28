import { describe, it, expect } from 'vitest';
import { booleanOp, objectToWorldPolygon, ringArea, operandCubicsWorld, resolveBooleanRings } from './boolean';
import { evalCubic } from './boolean-curves';
import { createProject, createSceneObject, createGroupObject, createVectorAsset, createKeyframe } from '../project';
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

// A rect object: world bbox spans (tx,ty)..(tx+w, ty+h). base.x/y is a pure translation.
function rectObj(id: string, zOrder: number, w: number, h: number, tx: number, ty: number): [SceneObject, VectorAsset] {
  const asset = createVectorAsset('rect', { id: `${id}-a` });
  const obj = createSceneObject(asset.id, {
    id,
    zOrder,
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    shapeBase: { width: w, height: h },
    base: { x: tx, y: ty, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  });
  return [obj, asset];
}

// An ellipse object: world center (tx+rx, ty+ry), radii (rx,ry).
function ellipseObj(id: string, zOrder: number, rx: number, ry: number, tx: number, ty: number): [SceneObject, VectorAsset] {
  const asset = createVectorAsset('ellipse', { id: `${id}-a` });
  const obj = createSceneObject(asset.id, {
    id,
    zOrder,
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    shapeBase: { radiusX: rx, radiusY: ry },
    base: { x: tx, y: ty, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  });
  return [obj, asset];
}

describe('operandCubicsWorld', () => {
  it('rect -> 4 straight cubics spanning the world rect', () => {
    const [o, a] = rectObj('r', 0, 30, 40, 10, 20); // world (10,20)..(40,60)
    const cubics = operandCubicsWorld(proj([o, a]), o, 0);
    expect(cubics).toHaveLength(4);
    const corners = cubics.map((c) => c.p0);
    const hasCorner = (x: number, y: number) =>
      corners.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
    expect(hasCorner(10, 20)).toBe(true);
    expect(hasCorner(40, 20)).toBe(true);
    expect(hasCorner(40, 60)).toBe(true);
    expect(hasCorner(10, 60)).toBe(true);
  });

  it('ellipse -> 4 curved cubics whose midpoints lie on the ellipse', () => {
    const [o, a] = ellipseObj('e', 0, 20, 10, 30, 40); // world center (50,50)
    const cubics = operandCubicsWorld(proj([o, a]), o, 0);
    expect(cubics).toHaveLength(4);
    for (const c of cubics) {
      const m = evalCubic(c, 0.5);
      const v = ((m.x - 50) / 20) ** 2 + ((m.y - 50) / 10) ** 2;
      expect(Math.abs(v - 1)).toBeLessThan(0.02);
    }
  });

  it('group operand -> [] (faceted path kept for groups in v1)', () => {
    const g = createGroupObject({ id: 'g2', anchorX: 0, anchorY: 0, zOrder: 0 });
    const s1 = pathObj('gs1', 1, squarePath(10), 0, 0);
    s1[0].parentId = 'g2';
    const project = { ...createProject(), objects: [g, s1[0]], assets: [s1[1]] };
    expect(operandCubicsWorld(project, g, 0)).toEqual([]);
  });
});

describe('booleanOp curve preservation', () => {
  it('union of two disjoint circles preserves curves (few curved nodes per ring)', () => {
    const A = ellipseObj('ca', 0, 20, 20, 0, 0); // center (20,20)
    const B = ellipseObj('cb', 1, 20, 20, 100, 0); // center (120,20), disjoint
    const rings = booleanOp(proj(A, B), [A[0], B[0]], 'union', 0);
    expect(rings.length).toBe(2);
    for (const r of rings) {
      // curve-preserved: each disjoint circle is ~4 cubic nodes, vs ~64 faceted before.
      expect(r.nodes.length).toBeLessThanOrEqual(8);
      expect(r.nodes.some((n) => n.in || n.out)).toBe(true);
    }
  });

  it('rect intersect rect stays corners-only (parity)', () => {
    const A = rectObj('ra', 0, 20, 20, 0, 0); // (0,0)..(20,20)
    const B = rectObj('rb', 1, 20, 20, 10, 10); // (10,10)..(30,30)
    const rings = booleanOp(proj(A, B), [A[0], B[0]], 'intersect', 0);
    expect(rings.length).toBe(1);
    expect(rings[0].nodes.every((n) => !n.in && !n.out)).toBe(true);
  });

  it('circle subtracted from rect: result contains a curved edge', () => {
    const rect = rectObj('rbit', 0, 40, 40, 0, 0); // (0,0)..(40,40)
    const circ = ellipseObj('cbit', 1, 12, 12, 28, 8); // overlaps the top-right corner
    const rings = booleanOp(proj(rect, circ), [rect[0], circ[0]], 'subtract', 0);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    const curved = rings.flatMap((r) => r.nodes).some((n) => n.in || n.out);
    expect(curved).toBe(true);
  });

  it('degenerate operand geometry does not throw', () => {
    const ok = rectObj('rok', 0, 20, 20, 0, 0);
    const zero = rectObj('rzero', 1, 0, 0, 5, 5); // zero-size -> no cubics
    expect(() => booleanOp(proj(ok, zero), [ok[0], zero[0]], 'union', 0)).not.toThrow();
  });

  it('union of two rects sharing a full edge stays corners-only (tol false-provenance guard)', () => {
    const A = rectObj('sa', 0, 20, 20, 0, 0); // (0,0)..(20,20)
    const B = rectObj('sb', 1, 20, 20, 20, 0); // (20,0)..(40,20), shares the x=20 edge
    const rings = booleanOp(proj(A, B), [A[0], B[0]], 'union', 0);
    expect(rings.length).toBe(1);
    // the shared straight seam must NOT be mis-curved by near-tol provenance
    expect(rings[0].nodes.every((n) => !n.in && !n.out)).toBe(true);
  });

  it('preserves curves at a large coordinate offset (tol scales with bbox)', () => {
    const rect = rectObj('lr', 0, 400, 400, 100000, 100000); // far from origin
    const circ = ellipseObj('lc', 1, 80, 80, 100120, 100120); // interior
    const rings = booleanOp(proj(rect, circ), [rect[0], circ[0]], 'subtract', 0);
    const curved = rings.flatMap((r) => r.nodes).some((n) => n.in || n.out);
    expect(curved).toBe(true);
  });

  it('mixed group + leaf union: leaf arc stays curved, no throw', () => {
    const ell = ellipseObj('me', 0, 20, 20, 0, 0); // leaf, center (20,20)
    const g = createGroupObject({ id: 'mg', anchorX: 0, anchorY: 0, zOrder: 1 });
    const r1 = rectObj('mr1', 2, 10, 10, 60, 0);
    const r2 = rectObj('mr2', 3, 10, 10, 80, 0);
    r1[0].parentId = 'mg';
    r2[0].parentId = 'mg';
    const project = {
      ...createProject(),
      objects: [ell[0], g, r1[0], r2[0]],
      assets: [ell[1], r1[1], r2[1]],
    };
    let rings: PathData[] = [];
    expect(() => {
      rings = booleanOp(project, [ell[0], g], 'union', 0);
    }).not.toThrow();
    // the disjoint ellipse survives as a curved ring
    expect(rings.flatMap((r) => r.nodes).some((n) => n.in || n.out)).toBe(true);
  });
});

describe('resolveBooleanRings', () => {
  function liveUnionFixture() {
    const A = rectObj('la', 0, 20, 20, 0, 0); // 0..20
    const B = rectObj('lb', 1, 20, 20, 10, 0); // 10..30 at t=0
    B[0].tracks = { x: [createKeyframe(0, 10), createKeyframe(1, 40)] };
    const boolAsset = createVectorAsset('path', { id: 'bool-a', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('bool-a', { id: 'boolobj', zOrder: 2, boolean: { op: 'union', operandIds: ['la', 'lb'] } });
    const project = { ...createProject(), objects: [A[0], B[0], boolObj], assets: [A[1], B[1], boolAsset] };
    return { project, boolObj };
  }

  it('clips the operands at the given time; result moves as an operand animates', () => {
    const { project, boolObj } = liveUnionFixture();
    const at0 = resolveBooleanRings(project, boolObj, 0);
    const at1 = resolveBooleanRings(project, boolObj, 1);
    expect(at0.length).toBeGreaterThan(0);
    expect(at1.length).toBeGreaterThan(0);
    const maxX = (rings: PathData[]) => Math.max(...rings.flatMap((r) => r.nodes.map((n) => n.anchor.x)));
    expect(maxX(at1)).toBeGreaterThan(maxX(at0));
  });

  it('returns [] when fewer than two operands resolve', () => {
    const { project, boolObj } = liveUnionFixture();
    boolObj.boolean = { op: 'union', operandIds: ['la', 'missing'] };
    expect(resolveBooleanRings(project, boolObj, 0)).toEqual([]);
  });

  it('returns [] for an object with no boolean field', () => {
    const { project } = liveUnionFixture();
    const plain = createSceneObject('bool-a', { id: 'plain' });
    expect(resolveBooleanRings({ ...project, objects: [...project.objects, plain] }, plain, 0)).toEqual([]);
  });

  it('subtract of an interior operand yields a hole ring (evenodd fill cuts it)', () => {
    const big = rectObj('big', 0, 40, 40, 0, 0); // bottom-most, 0..40
    const small = rectObj('small', 1, 10, 10, 15, 15); // upper, fully interior
    const boolAsset = createVectorAsset('path', { id: 'bsub', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('bsub', { id: 'bsubobj', zOrder: 2, boolean: { op: 'subtract', operandIds: ['big', 'small'] } });
    const project = { ...createProject(), objects: [big[0], small[0], boolObj], assets: [big[1], small[1], boolAsset] };
    const rings = resolveBooleanRings(project, boolObj, 0);
    expect(rings.length).toBe(2); // outer + the hole — pathToDRings emits 2 subpaths; evenodd cuts the hole
  });

  it('resolves a GROUP operand as the union of its vector leaves', () => {
    const g1 = rectObj('g1', 0, 20, 40, 0, 0); // 0..20 x, 0..40 y
    const g2 = rectObj('g2', 1, 20, 40, 20, 0); // 20..40 x
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 2 });
    g1[0].parentId = 'grp';
    g2[0].parentId = 'grp';
    const cover = rectObj('cover', 3, 40, 40, 0, 0); // 0..40 fully covers the group
    const boolAsset = createVectorAsset('path', { id: 'bg', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('bg', { id: 'bgobj', zOrder: 4, boolean: { op: 'intersect', operandIds: ['grp', 'cover'] } });
    const project = {
      ...createProject(),
      objects: [g1[0], g2[0], group, cover[0], boolObj],
      assets: [g1[1], g2[1], cover[1], boolAsset],
    };
    const rings = resolveBooleanRings(project, boolObj, 0);
    expect(rings.length).toBeGreaterThan(0); // group resolved as one operand (union of g1,g2)
    const xs = rings.flatMap((r) => r.nodes.map((n) => n.anchor.x));
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(40, 3); // spans the whole group, not just one rect
  });

  it('resolves a NESTED boolean operand as a multipolygon with its hole preserved', () => {
    // inner = subtract(big 0..40, small interior) -> a ring WITH a hole.
    const big = rectObj('ib', 0, 40, 40, 0, 0);
    const small = rectObj('is', 1, 10, 10, 15, 15);
    const innerAsset = createVectorAsset('path', { id: 'innera', path: { nodes: [], closed: false } });
    const inner = createSceneObject('innera', { id: 'inner', zOrder: 2, boolean: { op: 'subtract', operandIds: ['ib', 'is'] } });
    // far = a disjoint rect far to the right (no overlap with inner).
    const far = rectObj('far', 3, 10, 10, 100, 0);
    const outerAsset = createVectorAsset('path', { id: 'outera', path: { nodes: [], closed: false } });
    const outer = createSceneObject('outera', { id: 'outer', zOrder: 4, boolean: { op: 'union', operandIds: ['inner', 'far'] } });
    const project = {
      ...createProject(),
      objects: [big[0], small[0], inner, far[0], outer],
      assets: [big[1], small[1], innerAsset, far[1], outerAsset],
    };
    const rings = resolveBooleanRings(project, outer, 0);
    // inner contributes 2 rings (outer boundary + hole), far contributes 1 -> 3 total.
    // If the hole were filled (rings fed back as positive polys), inner would be 1 ring -> 2 total.
    expect(rings.length).toBe(3);
  });

  it('returns [] (no infinite recursion) for a cyclic boolean reference', () => {
    const x = rectObj('cx', 0, 20, 20, 0, 0);
    const y = rectObj('cy', 1, 20, 20, 10, 0);
    const aAsset = createVectorAsset('path', { id: 'ca', path: { nodes: [], closed: false } });
    const bAsset = createVectorAsset('path', { id: 'cb', path: { nodes: [], closed: false } });
    // A operand-of [B, x]; B operand-of [A, y] -> mutual cycle.
    const a = createSceneObject('ca', { id: 'A', zOrder: 2, boolean: { op: 'union', operandIds: ['B', 'cx'] } });
    const b = createSceneObject('cb', { id: 'B', zOrder: 3, boolean: { op: 'union', operandIds: ['A', 'cy'] } });
    const project = { ...createProject(), objects: [x[0], y[0], a, b], assets: [x[1], y[1], aAsset, bAsset] };
    expect(resolveBooleanRings(project, a, 0)).toEqual([]);
  });
});
