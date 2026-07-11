import type { PathData } from '../types';
import { pc, ringArea } from './boolean';

// Local structural aliases for polygon-clipping geometry — mirrors geom/boolean.ts:10-17 /
// geom/strokeOutline.ts's own copy. A Pair is [x,y]; a Ring is closed (first==last); a
// Polygon is [outer, ...holes]; ops return MultiPolygon = Polygon[].
type Pair = [number, number];
type PcRing = Pair[];
type PcPolygon = PcRing[];
type PcMultiPolygon = PcPolygon[];

export interface Region {
  rings: PathData[];
  /** Sorted input indices whose polygon contributes this region (planar-arrangement subset). */
  contributors: number[];
  bbox: { x: number; y: number; width: number; height: number };
}

function ringToPathData(ring: PcRing): PathData {
  // polygon-clipping rings are closed (first==last); drop the dup, emit corner nodes.
  const closed =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  return { closed: true, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) };
}

function bboxOfRings(rings: PathData[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const n of r.nodes) {
      const { x, y } = n.anchor;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Net signed area across a region's rings (outer + holes) — matches even-odd fill area. */
function regionArea(rings: PathData[]): number {
  return rings.reduce((sum, r) => sum + ringArea(r.nodes.map((n) => n.anchor)), 0);
}

// Intersection of the polygons at `idxs` (idxs.length >= 1). Single-element case skips the
// polygon-clipping call entirely — mirrors boolean.ts's operandWorldGeom precedent.
function intersectSubset(polys: PcPolygon[], idxs: number[]): PcPolygon | PcMultiPolygon {
  if (idxs.length === 1) return polys[idxs[0]];
  const geoms = idxs.map((i) => polys[i]);
  return pc.intersection(geoms[0], ...geoms.slice(1));
}

// Union of the polygons at `idxs` (idxs.length >= 1). Same single-element shortcut as above.
function unionSubset(polys: PcPolygon[], idxs: number[]): PcPolygon | PcMultiPolygon {
  if (idxs.length === 1) return polys[idxs[0]];
  const geoms = idxs.map((i) => polys[i]);
  return pc.union(geoms[0], ...geoms.slice(1));
}

const AREA_EPS = 1e-9;

/**
 * Decomposes N (world-space, flattened) polygons into the planar arrangement's atomic
 * regions: for every non-empty subset S of the input indices, region_S = intersection(polys in
 * S) minus union(polys NOT in S). Regions with (near-)zero total area are dropped. Ordered by
 * descending total |area| for deterministic output.
 *
 * COST: subset enumeration is 2^N-1 polygon-clipping intersect+difference pairs (worst case;
 * singleton subsets skip the intersect/union call). Callers MUST cap N (the shape-builder spec
 * caps at N<=6 -> at most 63 clips, comfortably cheap for a one-time, memoized decomposition —
 * this is NOT meant to run per-pointermove or for large N).
 */
export function decomposeRegions(polys: PcPolygon[]): Region[] {
  const n = polys.length;
  if (n === 0) return [];
  if (n === 1) {
    const rings = polys[0].map(ringToPathData).filter((r) => r.nodes.length >= 3);
    if (rings.length === 0 || Math.abs(regionArea(rings)) < AREA_EPS) return [];
    return [{ rings, contributors: [0], bbox: bboxOfRings(rings) }];
  }

  const regions: Region[] = [];
  const total = 1 << n; // 2^n
  for (let mask = 1; mask < total; mask++) {
    const inIdx: number[] = [];
    const outIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) inIdx.push(i);
      else outIdx.push(i);
    }

    const inter = intersectSubset(polys, inIdx);
    const interMulti: PcMultiPolygon = inIdx.length === 1 ? [inter as PcPolygon] : (inter as PcMultiPolygon);

    let resultGeom: PcMultiPolygon;
    if (outIdx.length === 0) {
      resultGeom = interMulti;
    } else {
      const outGeom = unionSubset(polys, outIdx);
      resultGeom = pc.difference(interMulti, outGeom);
    }

    const rings: PathData[] = [];
    for (const poly of resultGeom) for (const ring of poly) rings.push(ringToPathData(ring));
    const nonDegenerate = rings.filter((r) => r.nodes.length >= 3);
    if (nonDegenerate.length === 0) continue;
    if (Math.abs(regionArea(nonDegenerate)) < AREA_EPS) continue;

    regions.push({ rings: nonDegenerate, contributors: inIdx, bbox: bboxOfRings(nonDegenerate) });
  }

  regions.sort((a, b) => Math.abs(regionArea(b.rings)) - Math.abs(regionArea(a.rings)));
  return regions;
}
