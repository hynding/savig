/** A declarative JSON "short" format + compiler. LLMs emit one structured document far more
 *  reliably than dozens of imperative edits; `compileShort` maps it to a `Project` via the
 *  headless builders (slice 1). `decompileProject` is the best-effort inverse for the
 *  DSL-authorable subset (rect/ellipse/path), so an agent can read a project back and re-edit it.
 *
 *  v1 scope = what the slice-1 builders support: shape objects (rect/ellipse/path) with a static
 *  base transform + per-property keyframe tracks. Groups/symbols/instances/audio are out of scope
 *  until the builder slices (1b+) land. */
import { createProject } from '../engine';
import type { AnimatableProperty, DurationMode, Easing, PathData, Project, Transform2D, VectorStyle } from '../engine';
import { addEllipse, addPath, addRect, setBaseTransform, setKeyframe } from './build';

export interface ShortKeyframe {
  /** Time in seconds. */
  t: number;
  value: number;
  easing?: Easing;
}

/** Per-property animation tracks (`x`, `y`, `scaleX`, `scaleY`, `rotation`, `opacity`, geometry…). */
export type ShortAnimate = Partial<Record<AnimatableProperty, ShortKeyframe[]>>;

interface ShortObjectCommon {
  id?: string;
  name?: string;
  style?: Partial<VectorStyle>;
  /** Static transform overrides applied after creation (rotation/scale/opacity/…). */
  base?: Partial<Transform2D>;
  animate?: ShortAnimate;
}

export interface ShortRect extends ShortObjectCommon {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ShortEllipse extends ShortObjectCommon {
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ShortPath extends ShortObjectCommon {
  type: 'path';
  path: PathData;
}
export type ShortObject = ShortRect | ShortEllipse | ShortPath;

export interface ShortDoc {
  meta?: { name?: string; width?: number; height?: number; fps?: number; loop?: boolean; duration?: number; durationMode?: DurationMode };
  objects: ShortObject[];
}

/** Compile a declarative short into a `Project`. Fails loud on malformed input (a programmatic
 *  caller — and an agent — want a clear error, not a half-built project). */
export function compileShort(doc: ShortDoc): Project {
  if (!doc || !Array.isArray(doc.objects)) throw new Error('compileShort: doc.objects must be an array');
  let project = createProject(doc.meta ?? {});
  for (const o of doc.objects) {
    let id: string;
    switch (o.type) {
      case 'rect':
        ({ project, id } = addRect(project, { x: o.x, y: o.y, width: o.width, height: o.height, id: o.id, name: o.name, style: o.style }));
        break;
      case 'ellipse':
        ({ project, id } = addEllipse(project, { x: o.x, y: o.y, width: o.width, height: o.height, id: o.id, name: o.name, style: o.style }));
        break;
      case 'path':
        ({ project, id } = addPath(project, { path: o.path, id: o.id, name: o.name, style: o.style }));
        break;
      default:
        throw new Error(`compileShort: unknown object type "${(o as { type?: string }).type}"`);
    }
    if (o.base) project = setBaseTransform(project, id, o.base);
    if (o.animate) {
      for (const [prop, kfs] of Object.entries(o.animate) as [AnimatableProperty, ShortKeyframe[] | undefined][]) {
        for (const kf of kfs ?? []) {
          project = setKeyframe(project, { objectId: id, property: prop, time: kf.t, value: kf.value, easing: kf.easing });
        }
      }
    }
  }
  return project;
}

const DEFAULT_BASE: Transform2D = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };

/** Best-effort inverse: a `ShortDoc` that recompiles to an equivalent project. Covers the
 *  DSL-authorable subset (vector rect/ellipse/path); groups/symbols/svg/audio objects are skipped.
 *  `compileShort(decompileProject(p))` round-trips for projects built from the DSL. */
export function decompileProject(project: Project): ShortDoc {
  const objects: ShortObject[] = [];
  for (const o of [...project.objects].sort((a, b) => a.zOrder - b.zOrder)) {
    if (o.isGroup) continue;
    const asset = project.assets.find((a) => a.id === o.assetId);
    if (!asset || asset.kind !== 'vector') continue; // only DSL-representable vector shapes

    const animate: ShortAnimate = {};
    for (const [prop, track] of Object.entries(o.tracks)) {
      if (track && track.length) animate[prop as AnimatableProperty] = track.map((k) => ({ t: k.time, value: k.value, ...(k.easing !== 'linear' ? { easing: k.easing } : {}) }));
    }
    // Non-default, non-positional base fields (x/y live in the shape's top-level coords).
    const base: Partial<Transform2D> = {};
    for (const k of ['scaleX', 'scaleY', 'rotation', 'opacity'] as (keyof Transform2D)[]) {
      if (o.base[k] !== DEFAULT_BASE[k]) base[k] = o.base[k];
    }
    const common: ShortObjectCommon = {
      id: o.id,
      name: o.name,
      style: { ...asset.style },
      ...(Object.keys(base).length ? { base } : {}),
      ...(Object.keys(animate).length ? { animate } : {}),
    };

    if (asset.shapeType === 'rect' && o.shapeBase) {
      objects.push({ type: 'rect', x: o.base.x, y: o.base.y, width: o.shapeBase.width ?? 0, height: o.shapeBase.height ?? 0, ...common });
    } else if (asset.shapeType === 'ellipse' && o.shapeBase) {
      objects.push({ type: 'ellipse', x: o.base.x, y: o.base.y, width: (o.shapeBase.radiusX ?? 0) * 2, height: (o.shapeBase.radiusY ?? 0) * 2, ...common });
    } else if (asset.shapeType === 'path' && asset.path) {
      // A path has no top-level x/y — its position lives in base. The asset path is normalized to
      // local origin, so carry base.x/y (plus any non-default scale/rotation/opacity) back in `base`.
      objects.push({ type: 'path', path: asset.path, id: o.id, name: o.name, style: { ...asset.style }, base: { ...base, x: o.base.x, y: o.base.y }, ...(Object.keys(animate).length ? { animate } : {}) });
    }
  }
  return {
    meta: { name: project.meta.name, width: project.meta.width, height: project.meta.height, fps: project.meta.fps, loop: project.meta.loop, duration: project.meta.duration, durationMode: project.meta.durationMode },
    objects,
  };
}
