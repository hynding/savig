/** Headless spray brush (roadmap 12): scatter copies of a symbol (or plain dots) along a stroke
 *  in the root scene, the same deterministic particles the editor's Spray Brush makes. Fail loud. */
import {
  DEFAULT_TRANSFORM, createGroupObject, createSceneObject, createVectorAsset, operandWorldRings, pathBounds,
  sprayParticles, swatchColor,
} from '@savig/engine';
import type { Asset, Project, SceneObject } from '@savig/engine';

export interface SprayInput {
  /** The stroke: one point sprays a single burst. */
  points: { x: number; y: number }[];
  /** Spray copies of this symbol; omit for plain dots. */
  symbolId?: string;
  radius?: number;
  density?: number;
  scaleMin?: number;
  scaleMax?: number;
  /** Random rotation range, degrees (0 = upright). */
  rotation?: number;
  seed?: number;
  /** Dots only: diameter at scale 1 (default 8) and color (default #336699). */
  dotSize?: number;
  color?: string;
  /** The group's id (default `spray1`, `spray2`…) and name (default "Spray"). */
  id?: string;
  name?: string;
}

/** Spray along `points`; returns the new group's id and how many copies it holds. */
export function spray(project: Project, input: SprayInput): { project: Project; id: string; count: number } {
  if (!Array.isArray(input.points) || input.points.length === 0) throw new Error('savig/core: spray needs at least one point');
  for (const p of input.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('savig/core: spray points must be { x, y } numbers');
  }
  const symbol = input.symbolId !== undefined ? project.assets.find((a) => a.id === input.symbolId) : undefined;
  if (input.symbolId !== undefined && symbol?.kind !== 'symbol') throw new Error(`savig/core: "${input.symbolId}" is not a symbol`);
  const color = input.color !== undefined ? swatchColor(input.color) : '#336699';
  if (!color) throw new Error(`savig/core: spray color must be a hex color like "#ff8800" (got "${input.color}")`);
  const dotSize = input.dotSize ?? 8;
  if (!Number.isFinite(dotSize) || dotSize <= 0) throw new Error('savig/core: dotSize must be a positive number');

  const particles = sprayParticles(input.points, {
    radius: input.radius, density: input.density, scaleMin: input.scaleMin, scaleMax: input.scaleMax,
    rotation: input.rotation, seed: input.seed ?? 1,
  });
  const ids = new Set([...project.objects.map((o) => o.id), ...project.assets.map((a) => a.id)]);
  let id = input.id;
  if (!id) {
    let n = 1;
    while (ids.has(`spray${n}`)) n++;
    id = `spray${n}`;
  } else if (ids.has(id)) {
    throw new Error(`savig/core: id "${id}" is taken`);
  }
  const z = project.objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
  const cx = particles.reduce((m, p) => m + p.x, 0) / particles.length;
  const cy = particles.reduce((m, p) => m + p.y, 0) / particles.length;
  const group = createGroupObject({ id, name: input.name ?? 'Spray', anchorX: cx, anchorY: cy, zOrder: z });
  const children: SceneObject[] = [];
  const assets: Asset[] = [];

  if (symbol?.kind === 'symbol') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const inner = { ...project, objects: symbol.objects };
    for (const o of symbol.objects) {
      if (o.parentId) continue;
      for (const ring of operandWorldRings(inner, o, 0)) {
        const b = pathBounds(ring);
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
      }
    }
    const ax = minX <= maxX ? (minX + maxX) / 2 : 0;
    const ay = minX <= maxX ? (minY + maxY) / 2 : 0;
    particles.forEach((p, i) => {
      children.push(createSceneObject(symbol.id, {
        id: `${id}-${i + 1}`, name: `${symbol.name} ${i + 1}`, zOrder: z + 1 + i, parentId: id,
        anchorX: ax, anchorY: ay,
        base: { ...DEFAULT_TRANSFORM, x: p.x - ax, y: p.y - ay, scaleX: p.scale, scaleY: p.scale, rotation: p.rotation },
      }));
    });
  } else {
    particles.forEach((p, i) => {
      const r = (dotSize / 2) * p.scale;
      const oid = `${id}-${i + 1}`;
      const asset = createVectorAsset('ellipse', { id: `${oid}-asset`, name: 'Dot', style: { fill: color, stroke: 'none', strokeWidth: 0 } });
      assets.push(asset);
      children.push(createSceneObject(asset.id, {
        id: oid, name: `Dot ${i + 1}`, zOrder: z + 1 + i, parentId: id,
        anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
        base: { ...DEFAULT_TRANSFORM, x: p.x - r, y: p.y - r }, shapeBase: { radiusX: r, radiusY: r },
      }));
    });
  }
  return {
    project: { ...project, assets: [...project.assets, ...assets], objects: [...project.objects, group, ...children] },
    id,
    count: particles.length,
  };
}
