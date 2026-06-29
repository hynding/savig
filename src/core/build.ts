/** Headless, id-addressed, store-free authoring builders over a `Project`.
 *
 * Every function takes a `Project` (+ explicit args) and returns a NEW `Project` (or `{ project, id }`
 * when it creates an object) — no `useEditor`, no selection, no DOM. This is the agent/SDK surface;
 * the Zustand store keeps wrapping the same engine functions for humans. v1 is ROOT-SCENE only
 * (no symbol edit-path — a UI concern) and FAILS LOUD on bad references (a programmatic caller wants
 * an error, not the store's silent no-op). Object/asset ids are deterministic when an `id` is given
 * (the asset id is derived as `<id>-asset`), so a short is reproducible. */
import {
  createSceneObject,
  createVectorAsset,
  createTextAsset,
  createKeyframe,
  newId,
  upsertKeyframe,
  pathBounds,
  collectReferencedAssetIds,
  DEFAULT_TRANSFORM,
  DEFAULT_VECTOR_STYLE,
} from '../engine';
import type { AnimatableProperty, Easing, PathData, Project, SceneObject, Transform2D, VectorStyle } from '../engine';

function nextZ(objects: SceneObject[]): number {
  return objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
}

function requireObject(project: Project, id: string): SceneObject {
  const o = project.objects.find((x) => x.id === id);
  if (!o) throw new Error(`savig/core: no object with id "${id}"`);
  return o;
}

function replaceObject(project: Project, next: SceneObject): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === next.id ? next : o)) };
}

interface ShapeOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  id?: string;
  name?: string;
  style?: Partial<VectorStyle>;
}

/** Add an axis-aligned rectangle. Vector objects use fractional-centre anchors, so no bbox math is
 *  needed at build time (the renderer resolves the pivot from `shapeBase` per frame). */
export function addRect(project: Project, opts: ShapeOpts): { project: Project; id: string } {
  return addShape(project, 'rect', opts, { width: opts.width, height: opts.height });
}

/** Add an ellipse. `width`/`height` are the bounding box; stored as radiusX/radiusY. */
export function addEllipse(project: Project, opts: ShapeOpts): { project: Project; id: string } {
  return addShape(project, 'ellipse', opts, { radiusX: opts.width / 2, radiusY: opts.height / 2 });
}

function addShape(
  project: Project,
  shapeType: 'rect' | 'ellipse',
  opts: ShapeOpts,
  shapeBase: SceneObject['shapeBase'],
): { project: Project; id: string } {
  const id = opts.id ?? newId();
  const asset = createVectorAsset(shapeType, {
    id: `${id}-asset`,
    style: { ...DEFAULT_VECTOR_STYLE, ...opts.style },
  });
  const z = nextZ(project.objects);
  const obj = createSceneObject(asset.id, {
    id,
    name: opts.name ?? `${shapeType === 'rect' ? 'Rectangle' : 'Ellipse'} ${z + 1}`,
    zOrder: z,
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM, x: opts.x, y: opts.y },
    shapeBase,
  });
  return {
    project: { ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] },
    id,
  };
}

/** Add a free vector path. The path is normalized so its bbox top-left sits at local origin and the
 *  object's base transform places it (mirrors the pen/import path — keeps anchors/transforms sane). */
export function addPath(
  project: Project,
  opts: { path: PathData; id?: string; name?: string; style?: Partial<VectorStyle> },
): { project: Project; id: string } {
  if (opts.path.nodes.length < 2) throw new Error('savig/core: addPath needs at least 2 nodes');
  const id = opts.id ?? newId();
  const box = pathBounds(opts.path);
  const normalized: PathData = {
    closed: opts.path.closed,
    nodes: opts.path.nodes.map((n) => ({
      anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
      ...(n.in ? { in: n.in } : {}),
      ...(n.out ? { out: n.out } : {}),
    })),
  };
  const asset = createVectorAsset('path', {
    id: `${id}-asset`,
    path: normalized,
    style: { ...DEFAULT_VECTOR_STYLE, ...opts.style },
  });
  const z = nextZ(project.objects);
  const obj = createSceneObject(asset.id, {
    id,
    name: opts.name ?? `Path ${z + 1}`,
    zOrder: z,
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
  });
  return {
    project: { ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] },
    id,
  };
}

/** Add a text object (title/caption/kinetic type) at (x, y) — the top-left of the text. Animates
 *  via the generic transform/opacity tracks. */
export function addText(
  project: Project,
  opts: { content: string; x: number; y: number; fontSize?: number; fontFamily?: string; fill?: string; stroke?: string; strokeWidth?: number; textAnchor?: 'start' | 'middle' | 'end'; id?: string; name?: string },
): { project: Project; id: string } {
  const id = opts.id ?? newId();
  const asset = createTextAsset({
    id: `${id}-asset`,
    content: opts.content,
    ...(opts.fontSize !== undefined ? { fontSize: opts.fontSize } : {}),
    ...(opts.fontFamily !== undefined ? { fontFamily: opts.fontFamily } : {}),
    ...(opts.fill !== undefined ? { fill: opts.fill } : {}),
    ...(opts.stroke !== undefined ? { stroke: opts.stroke } : {}),
    ...(opts.strokeWidth !== undefined ? { strokeWidth: opts.strokeWidth } : {}),
    ...(opts.textAnchor !== undefined ? { textAnchor: opts.textAnchor } : {}),
  });
  const z = nextZ(project.objects);
  const obj = createSceneObject(asset.id, {
    id,
    name: opts.name ?? `Text ${z + 1}`,
    zOrder: z,
    anchorMode: 'absolute',
    anchorX: 0,
    anchorY: 0,
    base: { ...DEFAULT_TRANSFORM, x: opts.x, y: opts.y },
  });
  return {
    project: { ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] },
    id,
  };
}

/** Upsert a keyframe on a transform/geometry track (x/y/scaleX/scaleY/rotation/opacity/width/…). */
export function setKeyframe(
  project: Project,
  spec: { objectId: string; property: AnimatableProperty; time: number; value: number; easing?: Easing },
): Project {
  const obj = requireObject(project, spec.objectId);
  const track = upsertKeyframe(
    obj.tracks[spec.property] ?? [],
    createKeyframe(spec.time, spec.value, spec.easing ? { easing: spec.easing } : {}),
  );
  return replaceObject(project, { ...obj, tracks: { ...obj.tracks, [spec.property]: track } });
}

/** Write any of the static base transform fields (used when a property has no keyframes). */
export function setBaseTransform(project: Project, objectId: string, partial: Partial<Transform2D>): Project {
  const obj = requireObject(project, objectId);
  return replaceObject(project, { ...obj, base: { ...obj.base, ...partial } });
}

/** Remove objects (cascading group descendants) and prune the now-orphaned vector/svg assets they
 *  referenced — never prunes symbol (library) / audio assets, nor assets still referenced elsewhere.
 *  Mirrors the store delete's cross-scene-safe prune. */
export function removeObjects(project: Project, ids: string[]): Project {
  const toDelete = new Set(ids);
  for (let changed = true; changed; ) {
    changed = false;
    for (const o of project.objects) {
      if (o.parentId && toDelete.has(o.parentId) && !toDelete.has(o.id)) {
        toDelete.add(o.id);
        changed = true;
      }
    }
  }
  const candidateAssetIds = new Set(
    project.objects.filter((o) => toDelete.has(o.id) && o.assetId).map((o) => o.assetId),
  );
  let next: Project = { ...project, objects: project.objects.filter((o) => !toDelete.has(o.id)) };
  const referenced = collectReferencedAssetIds(next);
  next = {
    ...next,
    assets: next.assets.filter((a) => {
      if (!candidateAssetIds.has(a.id)) return true;
      if (a.kind === 'symbol' || a.kind === 'audio') return true;
      return referenced.has(a.id);
    }),
  };
  return next;
}
