/** A declarative JSON "short" format + compiler. LLMs emit one structured document far more
 *  reliably than dozens of imperative edits; `compileShort` maps it to a `Project` via the
 *  headless builders (slice 1). `decompileProject` is the best-effort inverse for the
 *  DSL-authorable subset (rect/ellipse/path), so an agent can read a project back and re-edit it.
 *
 *  v1 scope = what the slice-1 builders support: shape objects (rect/ellipse/path) with a static
 *  base transform + per-property keyframe tracks. Groups/symbols/instances/audio are out of scope
 *  until the builder slices (1b+) land.
 *
 *  Cross-object BINDINGS (motionPath, textPath) are also out of DSL scope — same reasoning as
 *  groups/symbols: `compileObjectsInto`/`decompileObjects` only know about a single object's own
 *  fields, and a binding names ANOTHER object by id, which the DSL has no vocabulary for. Each
 *  binding's per-property TRACK still round-trips, though, because it rides the generic
 *  `AnimatableProperty` track loop (no special-casing needed): `motionPath.progress` has no DSL
 *  equivalent at all (the whole `motionPath` field is skipped), but `textPathOffset` (an
 *  `AnimatableProperty`, see engine/types.ts) IS a plain track like `x`/`opacity`/etc., so
 *  `compileShort`/`decompileProject` carry it through `ShortObjectCommon.animate` untouched —
 *  even though `ShortText` has no field for `textPath.pathObjectId`/`startOffset`, so the
 *  BINDING itself must still be set with `bindTextPath`/a direct object patch after compiling.
 *  A `textPathOffset` track surviving on an unbound text object is inert (resolveTextPath
 *  requires `.textPath` to be present) but still counts toward `computeProjectDuration` via the
 *  generic `objectsMaxKeyframeTime` track scan — an orphaned track costs timeline length even
 *  though nothing visibly animates. */
import { createProject, newId, TRIM_TRACK_KEYS } from '@savig/engine';
import type { AnimatableProperty, Camera, CameraAxis, CameraPose, DurationMode, Easing, PathData, Project, RepeatSpec, Scene, Transform2D, Transition, TrimProperty, VectorStyle } from '@savig/engine';
import { addEllipse, addPath, addRect, addText, setBaseTransform, setKeyframe, setRepeat, setTrim, setTrimKeyframe } from './build';
import { setCamera, setCameraKeyframe } from './camera';

export interface ShortKeyframe {
  /** Time in seconds. */
  t: number;
  value: number;
  easing?: Easing;
}

/** Per-property animation tracks (`x`, `y`, `scaleX`, `scaleY`, `rotation`, `opacity`, geometry…). */
export type ShortAnimate = Partial<Record<AnimatableProperty, ShortKeyframe[]>>;

/** Trim path (stroke draw-on window, 0..1 of path length): static base values plus optional
 *  per-property (`start`/`end`/`offset`) keyframe tracks. Mirrors `ShortCamera`'s base+animate shape. */
export interface ShortTrim {
  start?: number;
  end?: number;
  offset?: number;
  animate?: Partial<Record<TrimProperty, ShortKeyframe[]>>;
}

interface ShortObjectCommon {
  id?: string;
  name?: string;
  style?: Partial<VectorStyle>;
  /** Static transform overrides applied after creation (rotation/scale/opacity/…). */
  base?: Partial<Transform2D>;
  animate?: ShortAnimate;
  trim?: ShortTrim;
  /** Repeater (art-tools #3): N transformed, time-staggered copies of this leaf. Absent = single
   *  copy. Mirrors `SceneObject.repeat` exactly (static spec, no keyframe sub-shape). */
  repeat?: RepeatSpec;
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
export interface ShortText extends ShortObjectCommon {
  type: 'text';
  content: string;
  x: number;
  y: number;
  fontSize?: number;
  fontFamily?: string;
  textAnchor?: 'start' | 'middle' | 'end';
}
export type ShortObject = ShortRect | ShortEllipse | ShortPath | ShortText;

export interface ShortCamera {
  base?: Partial<CameraPose>;
  animate?: Partial<Record<CameraAxis, ShortKeyframe[]>>;
}

export interface ShortScene {
  name?: string;
  duration: number;
  objects: ShortObject[];
  camera?: ShortCamera;
  transitionIn?: Transition;
}

export interface ShortDoc {
  meta?: { name?: string; width?: number; height?: number; fps?: number; loop?: boolean; duration?: number; durationMode?: DurationMode };
  /** Single-scene object list. Mutually exclusive with `scenes`. */
  objects?: ShortObject[];
  /** Optional animatable camera (slice 8a): a view transform over the whole short. */
  camera?: ShortCamera;
  /** Multi-scene sequence. Mutually exclusive with `objects`. */
  scenes?: ShortScene[];
}

// --- compile helpers ---

function compileObjectsInto(project: Project, objects: ShortObject[]): Project {
  for (const o of objects) {
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
      case 'text':
        ({ project, id } = addText(project, { content: o.content, x: o.x, y: o.y, fontSize: o.fontSize, fontFamily: o.fontFamily, textAnchor: o.textAnchor, fill: o.style?.fill, stroke: o.style?.stroke, strokeWidth: o.style?.strokeWidth, id: o.id, name: o.name }));
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
    if (o.trim) {
      const { animate: trimAnimate, ...base } = o.trim;
      if (Object.keys(base).length > 0) project = setTrim(project, id, base);
      for (const [prop, kfs] of Object.entries(trimAnimate ?? {}) as [TrimProperty, ShortKeyframe[] | undefined][]) {
        for (const kf of kfs ?? []) {
          project = setTrimKeyframe(project, { objectId: id, prop, time: kf.t, value: kf.value, easing: kf.easing });
        }
      }
    }
    if (o.repeat) project = setRepeat(project, id, o.repeat);
  }
  return project;
}

function compileCameraInto(project: Project, camera: ShortCamera): Project {
  if (camera.base) project = setCamera(project, camera.base);
  if (camera.animate) {
    for (const [axis, kfs] of Object.entries(camera.animate) as [CameraAxis, ShortKeyframe[] | undefined][]) {
      for (const kf of kfs ?? []) {
        project = setCameraKeyframe(project, { axis, time: kf.t, value: kf.value, easing: kf.easing });
      }
    }
  }
  return project;
}

/** Compile a declarative short into a `Project`. Fails loud on malformed input (a programmatic
 *  caller — and an agent — want a clear error, not a half-built project). */
export function compileShort(doc: ShortDoc): Project {
  if (!doc) throw new Error('compileShort: missing doc');
  if (doc.scenes && doc.objects && doc.objects.length) {
    throw new Error('compileShort: doc.objects and doc.scenes are mutually exclusive');
  }
  if (doc.scenes) {
    let project = createProject(doc.meta ?? {});
    const scenes: Scene[] = [];
    for (const sc of doc.scenes) {
      if (!Array.isArray(sc.objects)) throw new Error('compileShort: each scene needs an objects array');
      if (typeof sc.duration !== 'number') throw new Error('compileShort: each scene needs a numeric duration');
      let view: Project = { ...project, objects: [], camera: undefined };  // carry accumulated global assets
      view = compileObjectsInto(view, sc.objects);
      if (sc.camera) view = compileCameraInto(view, sc.camera);
      scenes.push({
        id: newId(),
        name: sc.name ?? `Scene ${scenes.length + 1}`,
        objects: view.objects,
        duration: sc.duration,
        ...(view.camera ? { camera: view.camera } : {}),
        ...(sc.transitionIn ? { transitionIn: sc.transitionIn } : {}),
      });
      project = { ...project, assets: view.assets };  // accumulate global assets
    }
    return { ...project, objects: [], camera: undefined, scenes };
  }
  if (!Array.isArray(doc.objects)) throw new Error('compileShort: doc.objects must be an array');
  let project = compileObjectsInto(createProject(doc.meta ?? {}), doc.objects);
  if (doc.camera) project = compileCameraInto(project, doc.camera);
  return project;
}

const DEFAULT_BASE: Transform2D = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };

// --- decompile helpers ---

function decompileObjects(project: Project): ShortObject[] {
  const objects: ShortObject[] = [];
  for (const o of [...project.objects].sort((a, b) => a.zOrder - b.zOrder)) {
    if (o.isGroup) continue;
    const asset = project.assets.find((a) => a.id === o.assetId);
    if (!asset || (asset.kind !== 'vector' && asset.kind !== 'text')) continue; // DSL-representable: vector shapes + text

    const animate: ShortAnimate = {};
    for (const [prop, track] of Object.entries(o.tracks)) {
      if (track && track.length) animate[prop as AnimatableProperty] = track.map((k) => ({ t: k.time, value: k.value, ...(k.easing !== 'linear' ? { easing: k.easing } : {}) }));
    }
    // Non-default, non-positional base fields (x/y live in the shape's top-level coords).
    const base: Partial<Transform2D> = {};
    for (const k of ['scaleX', 'scaleY', 'rotation', 'opacity'] as (keyof Transform2D)[]) {
      if (o.base[k] !== DEFAULT_BASE[k]) base[k] = o.base[k];
    }

    // Trim path (draw-on window): only non-default base fields + only non-empty tracks are emitted,
    // and easing only when non-linear — mirrors the `animate` convention above so a round-trip
    // (compile -> decompile -> compile) reproduces the same doc.
    let trim: ShortTrim | undefined;
    if (o.trim) {
      const trimAnimate: NonNullable<ShortTrim['animate']> = {};
      for (const prop of ['start', 'end', 'offset'] as const) {
        const track = o.trim[TRIM_TRACK_KEYS[prop]];
        if (track && track.length) {
          trimAnimate[prop] = track.map((k) => ({ t: k.time, value: k.value, ...(k.easing !== 'linear' ? { easing: k.easing } : {}) }));
        }
      }
      trim = {
        ...(o.trim.start !== 0 ? { start: o.trim.start } : {}),
        ...(o.trim.end !== 1 ? { end: o.trim.end } : {}),
        ...(o.trim.offset !== 0 ? { offset: o.trim.offset } : {}),
        ...(Object.keys(trimAnimate).length ? { animate: trimAnimate } : {}),
      };
    }

    if (asset.kind === 'text') {
      objects.push({
        type: 'text',
        content: asset.content,
        x: o.base.x,
        y: o.base.y,
        fontSize: asset.fontSize,
        ...(asset.fontFamily ? { fontFamily: asset.fontFamily } : {}),
        ...(asset.textAnchor ? { textAnchor: asset.textAnchor } : {}),
        id: o.id,
        name: o.name,
        style: { fill: asset.fill, ...(asset.stroke ? { stroke: asset.stroke } : {}), ...(asset.strokeWidth !== undefined ? { strokeWidth: asset.strokeWidth } : {}) },
        ...(Object.keys(base).length ? { base } : {}),
        ...(Object.keys(animate).length ? { animate } : {}),
        ...(trim ? { trim } : {}),
        ...(o.repeat ? { repeat: o.repeat } : {}),
      });
      continue;
    }

    const common: ShortObjectCommon = {
      id: o.id,
      name: o.name,
      style: { ...asset.style },
      ...(Object.keys(base).length ? { base } : {}),
      ...(Object.keys(animate).length ? { animate } : {}),
      ...(trim ? { trim } : {}),
      ...(o.repeat ? { repeat: o.repeat } : {}),
    };

    if (asset.shapeType === 'rect' && o.shapeBase) {
      objects.push({ type: 'rect', x: o.base.x, y: o.base.y, width: o.shapeBase.width ?? 0, height: o.shapeBase.height ?? 0, ...common });
    } else if (asset.shapeType === 'ellipse' && o.shapeBase) {
      objects.push({ type: 'ellipse', x: o.base.x, y: o.base.y, width: (o.shapeBase.radiusX ?? 0) * 2, height: (o.shapeBase.radiusY ?? 0) * 2, ...common });
    } else if (asset.shapeType === 'path' && asset.path) {
      // A path has no top-level x/y — its position lives in base. The asset path is normalized to
      // local origin, so carry base.x/y (plus any non-default scale/rotation/opacity) back in `base`.
      objects.push({
        type: 'path',
        path: asset.path,
        id: o.id,
        name: o.name,
        style: { ...asset.style },
        base: { ...base, x: o.base.x, y: o.base.y },
        ...(Object.keys(animate).length ? { animate } : {}),
        ...(trim ? { trim } : {}),
        ...(o.repeat ? { repeat: o.repeat } : {}),
      });
    }
  }
  return objects;
}

function decompileCamera(camera: Camera): ShortCamera {
  const animate: NonNullable<ShortCamera['animate']> = {};
  for (const axis of ['x', 'y', 'zoom', 'rotation'] as CameraAxis[]) {
    const track = camera.tracks[axis];
    if (track && track.length) animate[axis] = track.map((k) => ({ t: k.time, value: k.value, ...(k.easing !== 'linear' ? { easing: k.easing } : {}) }));
  }
  return { base: { ...camera.base }, ...(Object.keys(animate).length ? { animate } : {}) };
}

/** Best-effort inverse: a `ShortDoc` that recompiles to an equivalent project. Covers the
 *  DSL-authorable subset (vector rect/ellipse/path); groups/symbols/svg/audio objects are skipped.
 *  `compileShort(decompileProject(p))` round-trips for projects built from the DSL. */
export function decompileProject(project: Project): ShortDoc {
  const meta = { name: project.meta.name, width: project.meta.width, height: project.meta.height, fps: project.meta.fps, loop: project.meta.loop, duration: project.meta.duration, durationMode: project.meta.durationMode };
  if (project.scenes) {
    const scenes: ShortScene[] = project.scenes.map((s) => ({
      ...(s.name ? { name: s.name } : {}),
      duration: s.duration,
      objects: decompileObjects({ ...project, objects: s.objects, camera: s.camera, scenes: undefined }),
      ...(s.camera ? { camera: decompileCamera(s.camera) } : {}),
      ...(s.transitionIn && s.transitionIn.kind !== 'cut' ? { transitionIn: s.transitionIn } : {}),
    }));
    return { meta, scenes };
  }
  const doc: ShortDoc = { meta, objects: decompileObjects(project) };
  if (project.camera) doc.camera = decompileCamera(project.camera);
  return doc;
}
