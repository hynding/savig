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
import type { AnchorMode, AnimatableProperty, AudioClip, AudioFilter, Behavior, BehaviorAction, Camera, CameraAxis, CameraPose, DurationMode, Easing, PathData, Project, RepeatSpec, Scene, SceneObject, Transform2D, Transition, TrimProperty, Value, VectorStyle } from '@savig/engine';
import { addAudioClip, addAudioTrack, addBehavior, addEllipse, addPath, addRect, addText, setAnchor, setBaseTransform, setKeyframe, setRepeat, setTrim, setTrimKeyframe, setVariable } from './build';
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
  /** Rotation/scale pivot override. `mode` omitted keeps the builder default ('fraction' for
   *  vector shapes — x/y are then 0..1 of the shape bbox — 'absolute' for text). Lets a doc
   *  rotate a limb from its joint (`{ x: 0.5, y: 0 }` = top-centre) instead of the bbox centre. */
  anchor?: { x: number; y: number; mode?: AnchorMode };
  animate?: ShortAnimate;
  trim?: ShortTrim;
  /** Repeater (art-tools #3): N transformed, time-staggered copies of this leaf. Absent = single
   *  copy. Mirrors `SceneObject.repeat` exactly (static spec, no keyframe sub-shape). */
  repeat?: RepeatSpec;
  /** Pointer-event behaviors (M9 interactivity/scripting). Compiled via `addBehavior` right after
   *  the object is created, in array order. */
  behaviors?: ShortBehavior[];
}

/** One event → actions binding, DSL-facing (mirrors `Behavior` 1:1 — see engine/types.ts). Lives
 *  either on a `ShortObjectCommon.behaviors` entry (pointer events only) or on
 *  `ShortDoc.interactions.handlers` (global events only). `id` is optional in (a fresh one is
 *  minted when absent) and always emitted on decompile. */
export interface ShortBehavior {
  id?: string;
  event: Behavior['event'];
  key?: string;
  sceneId?: string;
  actions: Array<{ kind: BehaviorAction['kind']; args?: Record<string, string>; if?: string }>;
}

/** Project-level interactivity (M9): declared variables + global handlers. Mirrors
 *  `InteractionModel` — compiled AFTER objects/scenes/audio, regardless of `doc.scenes`
 *  (project-wide, not scene-scoped — the audio precedent). */
export interface ShortInteractions {
  variables?: Array<{ name: string; initial: Value }>;
  handlers?: ShortBehavior[];
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

/** One audio clip: `at`/`in`/`out` map onto `AudioClip.startTime`/`inPoint`/`outPoint` (the
 *  builder's own field names — see `addAudioClip`). Short, DSL-facing names since these appear
 *  once per clip, possibly many times per document. */
export interface ShortAudioClip {
  id?: string;
  asset: string;
  at: number;
  in: number;
  out: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

/** Multitrack audio (project-level — a single master-timeline mixer, not scene-scoped). A track's
 *  `clips` are nested (assigned that track's id); top-level `clips` play on the implicit default
 *  lane (no `trackId`). */
export interface ShortAudio {
  tracks?: Array<{ id?: string; name?: string; gain?: number; pan?: number; filter?: AudioFilter; clips?: ShortAudioClip[] }>;
  clips?: ShortAudioClip[];
}

export interface ShortDoc {
  meta?: { name?: string; width?: number; height?: number; fps?: number; loop?: boolean; duration?: number; durationMode?: DurationMode };
  /** Single-scene object list. Mutually exclusive with `scenes`. */
  objects?: ShortObject[];
  /** Optional animatable camera (slice 8a): a view transform over the whole short. */
  camera?: ShortCamera;
  /** Multi-scene sequence. Mutually exclusive with `objects`. */
  scenes?: ShortScene[];
  /** Multitrack audio (project-level, regardless of `scenes`). */
  audio?: ShortAudio;
  /** M9 interactivity/scripting: declared variables + global handlers (project-level, regardless
   *  of `scenes`). */
  interactions?: ShortInteractions;
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
    if (o.anchor) project = setAnchor(project, id, o.anchor);
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
    for (const b of o.behaviors ?? []) {
      ({ project } = addBehavior(project, id, {
        event: b.event,
        ...(b.key !== undefined ? { key: b.key } : {}),
        ...(b.sceneId !== undefined ? { sceneId: b.sceneId } : {}),
        actions: b.actions as BehaviorAction[],
        ...(b.id !== undefined ? { id: b.id } : {}),
      }));
    }
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

/** Audio is project-level (the master timeline), never scene-scoped — compiled AFTER
 *  objects/scenes, straight onto the final project, regardless of whether `doc.scenes` was used. */
function compileAudioInto(project: Project, audio: ShortAudio): Project {
  for (const t of audio.tracks ?? []) {
    let trackId: string;
    ({ project, id: trackId } = addAudioTrack(project, { id: t.id, name: t.name, gain: t.gain, pan: t.pan, filter: t.filter }));
    for (const c of t.clips ?? []) {
      ({ project } = addAudioClip(project, { assetId: c.asset, trackId, at: c.at, inPoint: c.in, outPoint: c.out, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, id: c.id }));
    }
  }
  for (const c of audio.clips ?? []) {
    ({ project } = addAudioClip(project, { assetId: c.asset, at: c.at, inPoint: c.in, outPoint: c.out, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, id: c.id }));
  }
  return project;
}

/** M9 interactivity is project-level (never scene-scoped, same reasoning as audio) — compiled
 *  AFTER objects/scenes/audio, straight onto the final project. Variables before handlers so a
 *  handler's guard/args referencing a declared variable never race the declaration (compile order
 *  doesn't actually matter for validate, but mirrors natural authoring order). */
function compileInteractionsInto(project: Project, interactions: ShortInteractions): Project {
  for (const v of interactions.variables ?? []) {
    project = setVariable(project, v.name, v.initial);
  }
  for (const b of interactions.handlers ?? []) {
    ({ project } = addBehavior(project, null, {
      event: b.event,
      ...(b.key !== undefined ? { key: b.key } : {}),
      ...(b.sceneId !== undefined ? { sceneId: b.sceneId } : {}),
      actions: b.actions as BehaviorAction[],
      ...(b.id !== undefined ? { id: b.id } : {}),
    }));
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
    project = { ...project, objects: [], camera: undefined, scenes };
    if (doc.audio) project = compileAudioInto(project, doc.audio);
    if (doc.interactions) project = compileInteractionsInto(project, doc.interactions);
    return project;
  }
  if (!Array.isArray(doc.objects)) throw new Error('compileShort: doc.objects must be an array');
  let project = compileObjectsInto(createProject(doc.meta ?? {}), doc.objects);
  if (doc.camera) project = compileCameraInto(project, doc.camera);
  if (doc.audio) project = compileAudioInto(project, doc.audio);
  if (doc.interactions) project = compileInteractionsInto(project, doc.interactions);
  return project;
}

const DEFAULT_BASE: Transform2D = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };

// --- decompile helpers ---

/** Builder anchor defaults (vector shapes: fraction bbox-centre; text: absolute origin) —
 *  `anchor` is emitted only when the object differs, and `mode` only when IT differs, mirroring
 *  the base/animate non-default convention so compile→decompile→compile round-trips. */
function decompileAnchor(o: SceneObject, kind: 'vector' | 'text'): { x: number; y: number; mode?: AnchorMode } | undefined {
  const def = kind === 'text' ? { mode: 'absolute' as const, x: 0, y: 0 } : { mode: 'fraction' as const, x: 0.5, y: 0.5 };
  const mode: AnchorMode = o.anchorMode ?? 'absolute';
  if (mode === def.mode && o.anchorX === def.x && o.anchorY === def.y) return undefined;
  return { x: o.anchorX, y: o.anchorY, ...(mode !== def.mode ? { mode } : {}) };
}

/** Inverse of the `addBehavior` compile loop: ids ALWAYS emitted (mirrors `decompileAudio`'s
 *  `id: c.id` convention), key/sceneId/args/if conditional-spread. */
function decompileBehaviors(behaviors: Behavior[]): ShortBehavior[] {
  return behaviors.map((b) => ({
    id: b.id,
    event: b.event,
    ...(b.key !== undefined ? { key: b.key } : {}),
    ...(b.sceneId !== undefined ? { sceneId: b.sceneId } : {}),
    actions: b.actions.map((a) => ({
      kind: a.kind,
      ...(a.args !== undefined ? { args: a.args } : {}),
      ...(a.if !== undefined ? { if: a.if } : {}),
    })),
  }));
}

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

    const anchor = decompileAnchor(o, asset.kind);

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
        ...(anchor ? { anchor } : {}),
        ...(Object.keys(base).length ? { base } : {}),
        ...(Object.keys(animate).length ? { animate } : {}),
        ...(trim ? { trim } : {}),
        ...(o.repeat ? { repeat: o.repeat } : {}),
        ...(o.behaviors?.length ? { behaviors: decompileBehaviors(o.behaviors) } : {}),
      });
      continue;
    }

    const common: ShortObjectCommon = {
      id: o.id,
      name: o.name,
      style: { ...asset.style },
      ...(anchor ? { anchor } : {}),
      ...(Object.keys(base).length ? { base } : {}),
      ...(Object.keys(animate).length ? { animate } : {}),
      ...(trim ? { trim } : {}),
      ...(o.repeat ? { repeat: o.repeat } : {}),
      ...(o.behaviors?.length ? { behaviors: decompileBehaviors(o.behaviors) } : {}),
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
        ...(anchor ? { anchor } : {}),
        base: { ...base, x: o.base.x, y: o.base.y },
        ...(Object.keys(animate).length ? { animate } : {}),
        ...(trim ? { trim } : {}),
        ...(o.repeat ? { repeat: o.repeat } : {}),
        ...(o.behaviors?.length ? { behaviors: decompileBehaviors(o.behaviors) } : {}),
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

/** Inverse of `compileAudioInto`: emits `audio` only when there is something to emit (a clip or a
 *  track). Ids are ALWAYS emitted (mirrors `decompileObjects`'s `id: o.id` convention), so a
 *  compile→decompile→compile round-trip reproduces the same ids. Untracked clips (no `trackId`,
 *  or a dangling one) land in the top-level default lane, same grouping as `describeProject`'s
 *  audio summary. */
function decompileAudio(project: Project): ShortAudio | undefined {
  const tracks = project.audioTracks ?? [];
  if (project.audioClips.length === 0 && tracks.length === 0) return undefined;
  const trackIds = new Set(tracks.map((t) => t.id));

  const clipToShort = (c: AudioClip): ShortAudioClip => ({
    id: c.id,
    asset: c.assetId,
    at: c.startTime,
    in: c.inPoint,
    out: c.outPoint,
    ...(c.volume !== 1 ? { volume: c.volume } : {}),
    ...(c.fadeIn !== undefined ? { fadeIn: c.fadeIn } : {}),
    ...(c.fadeOut !== undefined ? { fadeOut: c.fadeOut } : {}),
  });

  const shortTracks = tracks.map((t) => {
    const clips = project.audioClips.filter((c) => c.trackId === t.id).map(clipToShort);
    return {
      id: t.id,
      name: t.name,
      gain: t.gain,
      ...(t.pan !== undefined ? { pan: t.pan } : {}),
      ...(t.filter !== undefined ? { filter: t.filter } : {}),
      ...(clips.length ? { clips } : {}),
    };
  });

  const untracked = project.audioClips.filter((c) => !c.trackId || !trackIds.has(c.trackId)).map(clipToShort);

  return {
    ...(shortTracks.length ? { tracks: shortTracks } : {}),
    ...(untracked.length ? { clips: untracked } : {}),
  };
}

/** Inverse of `compileInteractionsInto`: emits `interactions` only when there's a declared
 *  variable or a global handler to emit — mirrors `decompileAudio`'s "only when non-empty"
 *  convention. Ids on handlers ALWAYS emitted (`decompileBehaviors`). */
function decompileInteractions(project: Project): ShortInteractions | undefined {
  const model = project.interactions;
  if (!model) return undefined;
  const variables = model.variables?.length ? model.variables.map((v) => ({ name: v.name, initial: v.initial })) : undefined;
  const handlers = model.handlers?.length ? decompileBehaviors(model.handlers) : undefined;
  if (!variables && !handlers) return undefined;
  return { ...(variables ? { variables } : {}), ...(handlers ? { handlers } : {}) };
}

/** Best-effort inverse: a `ShortDoc` that recompiles to an equivalent project. Covers the
 *  DSL-authorable subset (vector rect/ellipse/path) plus audio/interactions; groups/symbols/svg
 *  objects are skipped. `compileShort(decompileProject(p))` round-trips for projects built from
 *  the DSL. */
export function decompileProject(project: Project): ShortDoc {
  const meta = { name: project.meta.name, width: project.meta.width, height: project.meta.height, fps: project.meta.fps, loop: project.meta.loop, duration: project.meta.duration, durationMode: project.meta.durationMode };
  const audio = decompileAudio(project);
  const interactions = decompileInteractions(project);
  if (project.scenes) {
    const scenes: ShortScene[] = project.scenes.map((s) => ({
      ...(s.name ? { name: s.name } : {}),
      duration: s.duration,
      objects: decompileObjects({ ...project, objects: s.objects, camera: s.camera, scenes: undefined }),
      ...(s.camera ? { camera: decompileCamera(s.camera) } : {}),
      ...(s.transitionIn && s.transitionIn.kind !== 'cut' ? { transitionIn: s.transitionIn } : {}),
    }));
    return { meta, scenes, ...(audio ? { audio } : {}), ...(interactions ? { interactions } : {}) };
  }
  const doc: ShortDoc = { meta, objects: decompileObjects(project) };
  if (project.camera) doc.camera = decompileCamera(project.camera);
  if (audio) doc.audio = audio;
  if (interactions) doc.interactions = interactions;
  return doc;
}
