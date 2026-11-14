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
import { createProject, isBone, removeShapeTween as removeTweenOp, FILTER_DEFAULT_COLOR, FILTER_PARAMS, filterTrackKey, newId, TRIM_TRACK_KEYS } from '@savig/engine';
import type { AnchorMode, AnimatableProperty, FilterKind, AudioClip, AudioFilter, Behavior, BehaviorAction, Camera, CameraAxis, CameraPose, DurationMode, Easing, FrameKey, PathData, Project, RepeatSpec, Scene, SceneObject, Transform2D, Transition, TrimProperty, Value, VectorStyle } from '@savig/engine';
import { addAudioClip, addAudioTrack, addBehavior, addEllipse, addPath, addRect, addText, setAnchor, setBaseTransform, setKeyframe, setRepeat, setTrim, setTrimKeyframe, setVariable } from './build';
import { setCamera, setCameraKeyframe } from './camera';
import { addFrameLayer, putInFrameKey, shapeTween } from './frames';
import { addFilter, setFilterKeyframe } from './filters';
import { addBone, attachToBone, bindSkin } from './bones';

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
  /** Mask layers (spec 2026-11-13): this object is a MASK — never drawn; its filled area reveals
   *  every object whose `maskedBy` names it. */
  mask?: boolean;
  /** Id of a `mask: true` object (anywhere in the same doc's object list) that masks this one. */
  maskedBy?: string;
  /** Filters & color effects (spec 2026-11-13-filters), applied in order. */
  filters?: ShortFilter[];
  /** Bone skinning (spec 2026-11-14): ids of the bones that bend this rect/ellipse/path (it
   *  becomes a path). Bound against the armature at REST, after the whole doc is built; needs an
   *  `id`. Written in rest-pose coordinates, like attached drawings. */
  skin?: string[];
}

/** Param names across all filter kinds (each kind accepts its own subset — see FILTER_PARAMS). */
export type ShortFilterParam = 'blur' | 'dx' | 'dy' | 'opacity' | 'strength' | 'brightness' | 'contrast' | 'saturation' | 'hue';

/** One filter, DSL-facing: kind + flat static params (omitted = default), optional static color,
 *  `enabled: false` to keep it but skip it, and per-param keyframe tracks in `animate`. E.g.
 *  `{ kind: 'glow', color: '#ffcc00', blur: 8, animate: { strength: [{ t: 0, value: 0 }, { t: 1, value: 2 }] } }`. */
export type ShortFilter = {
  kind: FilterKind;
  id?: string;
  color?: string;
  enabled?: boolean;
  animate?: Partial<Record<ShortFilterParam, ShortKeyframe[]>>;
} & Partial<Record<ShortFilterParam, number>>;

const SHORT_FILTER_RESERVED = new Set(['kind', 'id', 'color', 'enabled', 'animate']);

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
/** A single drawable leaf — what a frame-by-frame key can hold. */
export type ShortShape = ShortRect | ShortEllipse | ShortPath | ShortText;

/** Shape tween on a frames key (spec 2026-11-13-shape-tween): the key's drawing morphs into the
 *  next key's drawing. `'shape'` = linear; `{ easing }` picks the easing. */
export type ShortTween = 'shape' | { easing?: Easing };

/** A frame-by-frame layer (spec 2026-11-07 §DSL): a run of keys, each showing its own drawing
 *  from its `time` until the next key (the last one until `end`). Key objects are in the layer's
 *  local space — the layer sits at (x, y), default 0,0 = artboard space. `end` defaults to one
 *  frame past the last key. Groups inside a key are out of DSL scope (as at the top level). */
export interface ShortFrames {
  type: 'frames';
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  end?: number;
  keys: Array<{ time: number; label?: string; id?: string; objects: ShortShape[]; tween?: ShortTween }>;
  /** Mask layers: a frame layer can be a mask (an animated, hand-drawn mask) or be masked. */
  mask?: boolean;
  maskedBy?: string;
  /** Filters on the whole layer (applied to every drawing). */
  filters?: ShortFilter[];
}

/** Compile a doc object's `filters` onto the compiled object `id`. */
function applyFilterFields(project: Project, id: string, filters: ShortFilter[] | undefined): Project {
  if (filters === undefined) return project;
  if (!Array.isArray(filters)) throw new Error('compileShort: filters must be an array');
  for (const f of filters) {
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(f)) if (!SHORT_FILTER_RESERVED.has(k)) params[k] = v as number;
    let filterId: string;
    ({ project, filterId } = addFilter(project, id, { kind: f.kind, id: f.id, params, color: f.color, enabled: f.enabled }));
    for (const [param, kfs] of Object.entries(f.animate ?? {})) {
      for (const kf of kfs ?? []) project = setFilterKeyframe(project, { objectId: id, filterId, param, time: kf.t, value: kf.value, easing: kf.easing });
    }
  }
  return project;
}

/** Decompile-side inverse of `applyFilterFields`: non-default params / color only, tracks as `animate`. */
function filterFieldsOf(o: SceneObject): { filters?: ShortFilter[] } {
  if (!o.filters?.length) return {};
  return {
    filters: o.filters.map((f) => {
      const out: Record<string, unknown> = { kind: f.kind, id: f.id };
      const specs = FILTER_PARAMS[f.kind] ?? {};
      for (const [name, spec] of Object.entries(specs)) {
        const v = f.params?.[name];
        if (v !== undefined && v !== spec.def) out[name] = v;
      }
      if (f.color !== undefined && f.color !== FILTER_DEFAULT_COLOR[f.kind]) out.color = f.color;
      if (f.enabled === false) out.enabled = false;
      const animate: Record<string, ShortKeyframe[]> = {};
      for (const name of Object.keys(specs)) {
        const track = o.filterTracks?.[filterTrackKey(f.id, name)];
        if (track?.length) animate[name] = track.map((k) => ({ t: k.time, value: k.value, ...(k.easing !== 'linear' ? { easing: k.easing } : {}) }));
      }
      if (Object.keys(animate).length) out.animate = animate;
      return out as ShortFilter;
    }),
  };
}

/** Set a compiled object's mask fields. Links are written as-is (a mask may come later in the
 *  doc); `validateProject` reports a link that doesn't resolve. */
function applyMaskFields(project: Project, id: string, o: { mask?: boolean; maskedBy?: string }): Project {
  if (!o.mask && o.maskedBy === undefined) return project;
  return {
    ...project,
    objects: project.objects.map((x) =>
      x.id === id ? { ...x, ...(o.mask ? { isMask: true } : {}), ...(o.maskedBy !== undefined ? { maskedBy: o.maskedBy } : {}) } : x,
    ),
  };
}

/** Decompile-side inverse of `applyMaskFields`. */
function maskFieldsOf(o: SceneObject): { mask?: boolean; maskedBy?: string } {
  return { ...(o.isMask ? { mask: true } : {}), ...(o.maskedBy !== undefined ? { maskedBy: o.maskedBy } : {}) };
}

/** A bone (spec 2026-11-13-bone-tool §Agent parity): a nested armature tree. `x`/`y` is the joint
 *  in the parent bone's space — artboard space at rest — and a child bone without `x`/`y` starts at
 *  its parent's tip. `children` are child bones and the drawings attached to this bone, written in
 *  REST-pose coordinates (they follow the bone once it rotates). `animate.rotation` is the pose
 *  (degrees away from rest, keyed over time); `base.rotation` a static pose. */
export interface ShortBone {
  type: 'bone';
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  length: number;
  angle?: number;
  min?: number;
  max?: number;
  pinned?: boolean;
  base?: Partial<Transform2D>;
  animate?: ShortAnimate;
  children?: Array<ShortBone | ShortShape>;
}

export type ShortObject = ShortShape | ShortFrames | ShortBone;

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

function compileFramesInto(project: Project, f: ShortFrames): Project {
  if (!Array.isArray(f.keys) || f.keys.length === 0) throw new Error('compileShort: a frames layer needs a non-empty keys array');
  const keys = f.keys.map((k) => ({ ...k, id: k.id ?? newId() }));
  let layerId: string;
  ({ project, id: layerId } = addFrameLayer(project, { id: f.id, name: f.name, x: f.x, y: f.y, end: f.end, keys }));
  for (const k of keys) {
    if (!Array.isArray(k.objects)) throw new Error('compileShort: each frames key needs an objects array');
    if (k.objects.some((o) => (o as { type?: string }).type === 'frames')) throw new Error('compileShort: frames layers cannot nest');
    const before = new Set(project.objects.map((o) => o.id));
    project = compileObjectsInto(project, k.objects);
    for (const o of project.objects) {
      if (!before.has(o.id) && !o.parentId) project = putInFrameKey(project, o.id, layerId, k.id);
    }
  }
  // Tweens bake once every key's drawing exists (each reads the NEXT key's drawing).
  for (const k of [...keys].reverse()) {
    if (k.tween === undefined) continue;
    if (k.tween !== 'shape' && (typeof k.tween !== 'object' || k.tween === null)) {
      throw new Error(`compileShort: a key's tween must be 'shape' or { easing } (got ${JSON.stringify(k.tween)})`);
    }
    project = shapeTween(project, layerId, k.id, k.tween === 'shape' ? {} : { easing: k.tween.easing });
  }
  return applyFilterFields(applyMaskFields(project, layerId, f), layerId, f.filters);
}

/** Build `b`'s armature tree at rest: bones first, each child drawing compiled then attached (so
 *  its rest coordinates hold); the poses (`base` / `animate`) go on once every attach is done. */
function compileBoneInto(project: Project, b: ShortBone, parentId?: string): Project {
  const poses: Array<{ id: string; b: ShortBone }> = [];
  const build = (p: Project, bone: ShortBone, parent?: string): Project => {
    let id: string;
    ({ project: p, id } = addBone(p, { id: bone.id, name: bone.name, parentId: parent, x: bone.x, y: bone.y, length: bone.length, angle: bone.angle, min: bone.min, max: bone.max, pinned: bone.pinned }));
    poses.push({ id, b: bone });
    for (const c of bone.children ?? []) {
      if (c.type === 'bone') {
        p = build(p, c, id);
        continue;
      }
      if ((c as { type?: string }).type === 'frames') throw new Error('compileShort: a frames layer cannot be attached to a bone');
      const before = new Set(p.objects.map((o) => o.id));
      p = compileObjectsInto(p, [c]);
      const added = p.objects.filter((o) => !before.has(o.id) && !o.parentId).map((o) => o.id);
      if (added.length) p = attachToBone(p, id, added);
    }
    return p;
  };
  project = build(project, b, parentId);
  for (const { id, b: bone } of poses) {
    if (bone.base) project = setBaseTransform(project, id, bone.base);
    for (const [prop, kfs] of Object.entries(bone.animate ?? {}) as [AnimatableProperty, ShortKeyframe[] | undefined][]) {
      for (const kf of kfs ?? []) project = setKeyframe(project, { objectId: id, property: prop, time: kf.t, value: kf.value, easing: kf.easing });
    }
  }
  return project;
}

function compileObjectsInto(project: Project, objects: ShortObject[]): Project {
  for (const o of objects) {
    if (o.type === 'frames') {
      project = compileFramesInto(project, o);
      continue;
    }
    if (o.type === 'bone') {
      project = compileBoneInto(project, o);
      continue;
    }
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
    project = applyMaskFields(project, id, o);
    project = applyFilterFields(project, id, o.filters);
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

/** Every doc shape (at any depth: bone children, frames keys) that asks for a skin. */
function skinRequests(objects: ShortObject[], out: Array<{ id: string; bones: string[] }> = []): Array<{ id: string; bones: string[] }> {
  for (const o of objects) {
    if (o.type === 'bone') skinRequests((o.children ?? []) as ShortObject[], out);
    else if (o.type === 'frames') for (const k of o.keys) skinRequests(k.objects, out);
    else if (o.skin !== undefined) {
      if (!Array.isArray(o.skin) || !o.skin.every((b) => typeof b === 'string')) throw new Error('compileShort: skin must be an array of bone ids');
      if (!o.id) throw new Error('compileShort: a skinned shape needs an id');
      out.push({ id: o.id, bones: o.skin });
    }
  }
  return out;
}

/** Compile a scene's objects, then bind the skins (bones may come later in the doc). */
function compileSceneObjects(project: Project, objects: ShortObject[]): Project {
  project = compileObjectsInto(project, objects);
  for (const r of skinRequests(objects)) project = bindSkin(project, r.id, r.bones, { atRest: true });
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

/** Canonical clip order — (startTime, then id) — applied on BOTH sides of the DSL boundary.
 *  The flat `audioClips` array can interleave lanes in ways the per-track grouping of the DSL
 *  schema cannot represent, so round-tripping would otherwise permute the array unpredictably.
 *  Mixing sums clips order-independently and the lanes UI positions by time, so array order
 *  carries no meaning — canonicalizing makes DSL text and project both fixed points after one
 *  pass. */
const clipOrder = (a: { startTime: number; id: string }, b: { startTime: number; id: string }): number =>
  a.startTime - b.startTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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
  return { ...project, audioClips: [...project.audioClips].sort(clipOrder) };
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
      view = compileSceneObjects(view, sc.objects);
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
  let project = compileSceneObjects(createProject(doc.meta ?? {}), doc.objects);
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

/** True when `o` sits (at any depth) inside a frame-by-frame layer. */
function inFrameLayer(o: SceneObject, byId: Map<string, SceneObject>): boolean {
  for (let p = o.parentId ? byId.get(o.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
    if (p.frames) return true;
  }
  return false;
}

/** True when `o` hangs (at any depth) under a bone — written inside that bone's tree. */
function insideBone(o: SceneObject, byId: Map<string, SceneObject>): boolean {
  const seen = new Set<string>();
  for (let p = o.parentId ? byId.get(o.parentId) : undefined; p && !seen.has(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) {
    seen.add(p.id);
    if (isBone(p)) return true;
  }
  return false;
}

/** Inverse of `compileBoneInto`: the bone, its pose, and its children (child bones and attached
 *  drawings, in the bone's own — rest — space) in stacking order. */
function decompileBone(project: Project, all: SceneObject[], b: SceneObject & { bone: NonNullable<SceneObject['bone']> }): ShortBone {
  const animate: ShortAnimate = {};
  for (const [prop, track] of Object.entries(b.tracks)) {
    if (track && track.length) animate[prop as AnimatableProperty] = track.map((k) => ({ t: k.time, value: k.value, ...(k.easing !== 'linear' ? { easing: k.easing } : {}) }));
  }
  const base: Partial<Transform2D> = {};
  for (const k of Object.keys(DEFAULT_BASE) as (keyof Transform2D)[]) if (b.base[k] !== DEFAULT_BASE[k]) base[k] = b.base[k];
  const children = decompileObjects({ ...project, objects: all.filter((o) => o.parentId === b.id) }, all, true) as Array<ShortBone | ShortShape>;
  return {
    type: 'bone',
    id: b.id,
    name: b.name,
    x: b.anchorX,
    y: b.anchorY,
    length: b.bone.length,
    ...(b.bone.angle !== 0 ? { angle: b.bone.angle } : {}),
    ...(b.bone.min !== undefined ? { min: b.bone.min } : {}),
    ...(b.bone.max !== undefined ? { max: b.bone.max } : {}),
    ...(b.bone.pinned ? { pinned: true } : {}),
    ...(Object.keys(base).length ? { base } : {}),
    ...(Object.keys(animate).length ? { animate } : {}),
    ...(children.length ? { children } : {}),
  };
}

/** Inverse of `compileFramesInto`: one key entry per key (id always, label when set), each with
 *  the key's direct drawable children decompiled in layer space. */
function decompileFrames(project: Project, layer: SceneObject): ShortFrames {
  const frames = layer.frames!;
  // A tweened key is written as its START drawing plus `tween` (compile re-bakes the morph), so
  // un-bake each tween first: drawings go back to static paths, objects the tween created vanish.
  for (const k of frames.keys) {
    if (!k.tween) continue;
    const r = removeTweenOp(project.objects, project.assets, layer.id, k.id);
    project = { ...project, objects: r.objects, assets: r.assets };
  }
  const tweenOf = (k: FrameKey): ShortTween | undefined =>
    k.tween ? (k.tween.easing && k.tween.easing !== 'linear' ? { easing: k.tween.easing } : 'shape') : undefined;
  return {
    type: 'frames',
    id: layer.id,
    name: layer.name,
    ...(layer.base.x !== 0 ? { x: layer.base.x } : {}),
    ...(layer.base.y !== 0 ? { y: layer.base.y } : {}),
    end: frames.end,
    keys: frames.keys.map((k) => ({
      time: k.time,
      id: k.id,
      ...(k.label ? { label: k.label } : {}),
      ...(tweenOf(k) ? { tween: tweenOf(k) } : {}),
      objects: decompileObjects({ ...project, objects: project.objects.filter((o) => o.parentId === layer.id && o.frameKeyId === k.id) }) as ShortShape[],
    })),
    ...maskFieldsOf(layer),
    ...filterFieldsOf(layer),
  };
}

/** `all` is the whole object list (for walking into bone trees); `nested` = `project.objects` is
 *  one bone's direct children, already scoped by the caller. */
function decompileObjects(project: Project, all: SceneObject[] = project.objects, nested = false): ShortObject[] {
  const objects: ShortObject[] = [];
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  const allById = new Map(all.map((o) => [o.id, o] as const));
  for (const o of [...project.objects].sort((a, b) => a.zOrder - b.zOrder)) {
    if (!nested && insideBone(o, allById)) continue;
    if (isBone(o)) {
      if (!inFrameLayer(o, allById)) objects.push(decompileBone(project, all, o));
      continue;
    }
    if (o.isGroup && o.frames) {
      if (!inFrameLayer(o, byId)) objects.push(decompileFrames(project, o));
      continue;
    }
    if (o.isGroup || inFrameLayer(o, byId)) continue;
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
        ...maskFieldsOf(o),
        ...filterFieldsOf(o),
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
      ...maskFieldsOf(o),
      ...filterFieldsOf(o),
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
        ...(o.skin ? { skin: o.skin.bones } : {}),
        style: { ...asset.style },
        ...(anchor ? { anchor } : {}),
        base: { ...base, x: o.base.x, y: o.base.y },
        ...(Object.keys(animate).length ? { animate } : {}),
        ...(trim ? { trim } : {}),
        ...(o.repeat ? { repeat: o.repeat } : {}),
        ...(o.behaviors?.length ? { behaviors: decompileBehaviors(o.behaviors) } : {}),
        ...maskFieldsOf(o),
        ...filterFieldsOf(o),
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
    const clips = project.audioClips.filter((c) => c.trackId === t.id).sort(clipOrder).map(clipToShort);
    return {
      id: t.id,
      name: t.name,
      gain: t.gain,
      ...(t.pan !== undefined ? { pan: t.pan } : {}),
      ...(t.filter !== undefined ? { filter: t.filter } : {}),
      ...(clips.length ? { clips } : {}),
    };
  });

  const untracked = project.audioClips
    .filter((c) => !c.trackId || !trackIds.has(c.trackId))
    .sort(clipOrder)
    .map(clipToShort);

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
