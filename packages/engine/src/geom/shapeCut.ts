// Shared internals of the shape-cutting tools (eraser, lasso): pc ring plumbing and the
// scene-to-shape-local mapping. Not part of the engine's public API.
import type { PathData, PathPoint, Project, SceneObject, VectorAsset } from '../types';
import { multiPolygonArea } from './paintBucket';
import { sampleObject } from '../sample';
import { invMapPoint } from '../groupTransform';

type Pair = [number, number];
type PcRing = Pair[];
type PcMultiPolygon = PcRing[][];

export function close(r: PcRing): PcRing {
  if (r.length === 0) return r;
  const [fx, fy] = r[0];
  const [lx, ly] = r[r.length - 1];
  return fx === lx && fy === ly ? r : [...r, [fx, fy]];
}

export function ringsToPaths(mp: PcMultiPolygon): PathData[] {
  const rings: { area: number; data: PathData }[] = [];
  for (const poly of mp) {
    for (const r of poly) {
      const nodes = r.slice(0, -1).map(([x, y]) => ({ anchor: { x, y } }));
      if (nodes.length < 3) continue;
      rings.push({ area: Math.abs(multiPolygonArea([[r]])), data: { closed: true, nodes } });
    }
  }
  rings.sort((a, b) => b.area - a.area);
  return rings.map((x) => x.data);
}

// Destructured on a parameter so the dropped names satisfy eslint's argsIgnorePattern.
export function withoutPrimitiveAndRings({ primitive: _primitive, compoundRings: _compoundRings, ...rest }: VectorAsset): VectorAsset {
  return rest;
}

export function visible(paint: string | undefined, gradient: unknown): boolean {
  return !!gradient || (!!paint && paint !== 'none');
}

/** Map a scene-space point into `obj`'s own path coordinates at `time`. */
export function sceneToLocal(project: Project, obj: SceneObject, ax: number, ay: number, p: PathPoint, time: number): PathPoint {
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  const chain: SceneObject[] = [];
  for (let g = obj.parentId ? byId.get(obj.parentId) : undefined; g?.isGroup && !chain.includes(g); g = g.parentId ? byId.get(g.parentId) : undefined) chain.push(g);
  chain.reverse(); // outermost first
  let q = p;
  for (const g of chain) q = invMapPoint(sampleObject(g, time), g.anchorX, g.anchorY, q.x, q.y);
  return invMapPoint(sampleObject(obj, time), ax, ay, q.x, q.y);
}
