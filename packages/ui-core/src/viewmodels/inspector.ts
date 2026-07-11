// Framework-neutral view-model + intents for the Inspector panel (slice 4, task 1 — pattern
// exemplar). `inspectorViewModel` is a PURE function `EditorState -> InspectorVM`: every
// derivation, formatted number, eligibility flag, dropdown/option list, sampled value, and
// keyframe/selection-kind resolution that used to live inline in `Inspector.tsx` lives here
// instead, so it would read identically if the component were rewritten in Svelte or Vue.
// `inspectorIntents` are thin wrappers around store actions — no logic beyond dispatch.
import {
  sampleObject,
  snapToFrame,
  interpolate,
  suggestCorrespondence,
  shiftCorrespondence,
  reverseCorrespondence,
  symbolContains,
  isLockedInTree,
  TRIM_TRACK_KEYS,
  REPEAT_DEFAULTS,
} from '@savig/engine';
import type {
  AnimatableProperty,
  Asset,
  BoolOp,
  ColorProperty,
  Easing,
  Gradient,
  MorphMode,
  PathData,
  RenderState,
  RepeatSpec,
  RotationMode,
  SceneObject,
  SymbolAsset,
  SymbolTiming,
  TrimProperty,
  VectorAsset,
  VectorStyle,
} from '@savig/engine';
import { isSymbolInstance } from '@savig/interaction';
import type { AlignEdge, DistributeAxis } from '@savig/interaction';
import {
  selectSelectedObject,
  selectEditablePath,
  selectEditedShapeKeyframe,
  selectActiveObjects,
  selectActiveAssetId,
  selectActiveSymbolAsset,
  activeSceneDims,
  canRepeat,
} from '@savig/editor-state';
import type { EditorState, ToolMode } from '@savig/editor-state';
import { buildLockIndex } from './lockIndex';
import { canAlign, canDistribute, canBool, canCreateSymbol as canCreateSymbolPred, canOutlineStroke as canOutlineStrokePred, canShapeBuilder, canBlend } from '../commands/predicates';
import { toggleShapeBuilder } from '../commands/intents';

const KF_EPS = 1e-6;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Describe the stored map relative to existing helpers (no new engine analyzer):
// 'auto' (absent) / 'suggested' (equals the suggestion) / 'custom' (anything else).
function correspondenceSummary(map: number[] | undefined, from: PathData, to: PathData): string {
  const n = from.nodes.length; // the map has one entry per FROM node
  if (!map) return `auto · ${n} nodes`;
  const suggested = suggestCorrespondence(from, to);
  const eq = map.length === suggested.length && map.every((v, i) => v === suggested[i]);
  return `${eq ? 'suggested' : 'custom'} · ${n} nodes`;
}

export interface InspectorEmptyVM {
  kind: 'empty';
  /** 'symbol' only when editing a symbol (root fallback otherwise) — drives the panel label. */
  scope: 'root' | 'symbol';
  /** The active artboard's current size (root meta, or the edited symbol's intrinsic size). */
  dims: { width: number; height: number };
}

export interface InspectorMultiVM {
  kind: 'multi';
  count: number;
  someGrouped: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  canBool: boolean;
  canCreateSymbol: boolean;
  /** Shape Builder entry eligibility (art-tools #7) — shares one definition with the command
   *  registry, like `canBool` above, so they never drift. The Inspector button ignores this while
   *  `shapeBuilderActive` is true (exit must always be available). */
  canShapeBuilder: boolean;
  /** Shape Builder mode is currently active (`s.shapeBuilder !== null`) — swaps the button's label
   *  to "Done" and keeps it enabled regardless of `canShapeBuilder`. */
  shapeBuilderActive: boolean;
  /** Blend eligibility (art-tools #9) — shares one definition with the command registry's
   *  `path.blend`, like `canBool`/`canShapeBuilder` above, so they never drift. Only meaningful
   *  (and only rendered by the Inspector) when `count === 2` — blend always takes exactly 2. */
  canBlend: boolean;
}

export interface InspectorGroupVM {
  kind: 'group';
  name: string;
}

export type InspectorKeyframeKind =
  | 'progress'
  | 'color'
  | 'gradient'
  | 'dash'
  | 'trim'
  | 'shape'
  | 'scalar';

export interface InspectorKeyframeCorrespondenceVM {
  from: PathData;
  to: PathData;
  map: number[] | undefined;
  summary: string;
  /** Shift controls only apply to a closed `to` path. */
  canShift: boolean;
}

export interface InspectorKeyframeVM {
  kind: InspectorKeyframeKind;
  header: string;
  easing: Easing;
  isRotation: boolean;
  rotationMode: RotationMode;
  inert: boolean;
  morph: MorphMode | null;
  correspondence: InspectorKeyframeCorrespondenceVM | null;
}

export interface InspectorNodeEasingVM {
  index: number;
  value: Easing;
  inert: boolean;
}

export interface InspectorMotionPathVM {
  orient: boolean;
  progressDisplay: number;
  progressAtSnapped: number;
}

/** Text-on-path binding panel (text-on-path #3). Only meaningful for a TEXT object —
 *  `InspectorSingleVM.textPath` is null for every other kind. `pathTargets` lists every
 *  eligible path in the active scope (swapTargets precedent: a plain vector `shapeType: 'path'`
 *  object, excluding live-boolean nodes — the same eligibility `bindTextPath`/`resolveTextPath`
 *  check) regardless of the current binding, so the bound target is always a valid `<select>`
 *  option. `offset` is track-sampled at the playhead when a non-empty `tracks.textPathOffset`
 *  exists, else the static `textPath.startOffset` base, else 0 while unbound. */
export interface InspectorTextPathVM {
  bound: boolean;
  pathTargets: { id: string; name: string }[];
  boundName: string | null;
  offset: number;
}

export interface InspectorSymbolTintVM {
  enabled: boolean;
  color: string;
  amount: number;
}

export interface InspectorSymbolVM {
  remapOn: boolean;
  /** Only meaningful when `remapOn` is true. */
  internalTime: number;
  startOffset: number;
  /** Shared disabled gate for the constant timing fields (start offset/loop/pingPong/speed/
   *  playCount/phase) — true once a time-remap curve exists. */
  timingDisabled: boolean;
  loop: boolean;
  pingPong: boolean;
  speed: number;
  playCount: number;
  phase: number;
  duration: number;
  clip: boolean;
  swapTargets: { id: string; name: string }[];
  freezeFirstFrame: boolean;
  tint: InspectorSymbolTintVM;
}

/** Repeater panel (art-tools #3): mirrors RepeatSpec plus an `on` flag. `on: false` carries the
 *  defaults `{count:2, dx:0, dy:0, rotate:0, scale:1, stagger:0}` (obj.repeat absent — eligible
 *  but off); `on: true` carries the live spec. The VM field itself is null when the selected
 *  object fails `canRepeat` (a group container or a symbol instance). */
export interface InspectorRepeatVM {
  on: boolean;
  count: number;
  dx: number;
  dy: number;
  rotate: number;
  scale: number;
  stagger: number;
}

export interface InspectorSingleVM {
  kind: 'single';
  obj: SceneObject;
  sampled: RenderState;
  asset: Asset | undefined;
  vector: VectorAsset | null;
  isInstance: boolean;
  /** Create Symbol is enabled unless the object is locked (own lock or an ancestor group). */
  canCreateSymbol: boolean;
  transform: Record<'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity', number>;
  anchor: { x: number; y: number };
  /** Rounded geometry values keyed by every rect/ellipse geometry property; the component
   *  picks which keys apply based on `vector.shapeType`. */
  geometry: Record<string, number>;
  pathNodeCount: number;
  canRemoveShapeKeyframe: boolean;
  /** Outline stroke (M6) is enabled — mirrors the `path.outlineStroke` command's `when` gate
   *  (shares one definition with the command registry, like `canBool`, so they never drift). */
  canOutlineStroke: boolean;
  primitive: { sides: number; points: number; innerRatio: number; cornerRadius: number; rotation: number } | null;
  strokeWidth: number;
  dashOffset: number;
  /** A stroke dasharray is set — with `trimActive`, drives the dash/trim mutual-exclusion gate
   *  (dash wins at render; the UI disables the other family's controls). */
  dashed: boolean;
  /** Trim values at the playhead (sampled ?? base ?? identity {0,1,0}). */
  trimStart: number;
  trimEnd: number;
  trimOffset: number;
  /** The object has a trim path (`obj.trim` present). */
  trimActive: boolean;
  motionPath: InspectorMotionPathVM | null;
  /** Non-null only for a TEXT object (`asset.kind === 'text'`) — see InspectorTextPathVM. */
  textPath: InspectorTextPathVM | null;
  keyframe: InspectorKeyframeVM | null;
  nodeEasing: InspectorNodeEasingVM | null;
  symbol: InspectorSymbolVM | null;
  /** Null when the selected object fails `canRepeat` (group container / symbol instance). */
  repeat: InspectorRepeatVM | null;
  /** Show the node-edit button row (Corner/Smooth, Join, Break, Delete node) — the node tool is
   *  active with a node selected. Folds the component's raw activeTool/selectedNodeIndex reads. */
  showNodeEditButtons: boolean;
  /** Auto-key on: property edits keyframe at the playhead. Gates the number-field `disabled`s. */
  autoKey: boolean;
}

export type InspectorVM = InspectorEmptyVM | InspectorMultiVM | InspectorGroupVM | InspectorSingleVM;

export interface StagePreset {
  label: string;
  width: number;
  height: number;
}

/** Common artboard sizes offered in the Inspector's stage-size panel (neutral data). */
export const STAGE_PRESETS: StagePreset[] = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Portrait', width: 1080, height: 1920 },
];

export function inspectorViewModel(s: EditorState): InspectorVM {
  const selectedIds = s.selectedObjectIds;
  const objects = selectActiveObjects(s);
  const assets = s.history.present.assets;
  const time = s.time;
  const fps = s.history.present.meta.fps;

  // --- multi-select -----------------------------------------------------------------------
  if (selectedIds.length > 1) {
    const someGrouped = selectedIds.some((id) => objects.find((o) => o.id === id)?.isGroup);
    // Availability gates (align/distribute movable count, boolean eligibility, create-symbol) share
    // one definition with the command registry (commands/predicates) so they never drift.
    return {
      kind: 'multi',
      count: selectedIds.length,
      someGrouped,
      canAlign: canAlign(s),
      canDistribute: canDistribute(s),
      canBool: canBool(s),
      canCreateSymbol: canCreateSymbolPred(s),
      canShapeBuilder: canShapeBuilder(s),
      shapeBuilderActive: !!s.shapeBuilder,
      canBlend: canBlend(s),
    };
  }

  const obj = selectSelectedObject(s);
  if (!obj) {
    // Shares selectActiveSymbolAsset with activeSceneDims (below), so scope and dims can never
    // disagree about whether the active artboard is a symbol.
    const scope: 'root' | 'symbol' = selectActiveSymbolAsset(s) ? 'symbol' : 'root';
    return { kind: 'empty', scope, dims: activeSceneDims(s) };
  }

  // A group CONTAINER has no asset — a dedicated panel (never the asset-dependent editors
  // below, which would throw on a group). Slice 45b.
  if (obj.isGroup) {
    return { kind: 'group', name: obj.name };
  }

  const lockById = buildLockIndex(objects);
  const sampled = sampleObject(obj, time);
  const asset = assets.find((a) => a.id === obj.assetId);
  const vector = asset && asset.kind === 'vector' ? asset : null;
  const isInstance = isSymbolInstance(obj, assets);
  const canCreateSymbol = !isLockedInTree(obj, lockById);

  const snapped = snapToFrame(time, fps);

  // --- selected keyframe (scalar or shape) on THIS object, for the easing editor. ----------
  let keyframe: InspectorKeyframeVM | null = null;
  const {
    selectedProgressKeyframe,
    selectedColorKeyframe,
    selectedGradientKeyframe,
    selectedDashKeyframe,
    selectedTrimKeyframe,
    selectedShapeKeyframe,
    selectedKeyframe,
  } = s;
  if (selectedProgressKeyframe && selectedProgressKeyframe.objectId === obj.id && obj.motionPath) {
    const track = obj.motionPath.progress;
    const idx = track.findIndex((k) => Math.abs(k.time - selectedProgressKeyframe.time) < KF_EPS);
    if (idx >= 0) {
      keyframe = {
        kind: 'progress',
        easing: track[idx].easing,
        header: `progress @ ${round(track[idx].time)}s`,
        isRotation: false,
        rotationMode: 'shortest',
        inert: idx === track.length - 1,
        morph: null,
        correspondence: null,
      };
    }
  } else if (selectedColorKeyframe && selectedColorKeyframe.objectId === obj.id) {
    const track = obj.colorTracks?.[selectedColorKeyframe.property];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedColorKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      keyframe = {
        kind: 'color',
        easing: track[idx].easing,
        header: `${selectedColorKeyframe.property} @ ${round(track[idx].time)}s`,
        isRotation: false,
        rotationMode: 'shortest',
        inert: idx === track.length - 1,
        morph: null,
        correspondence: null,
      };
    }
  } else if (selectedGradientKeyframe && selectedGradientKeyframe.objectId === obj.id) {
    const track = obj.gradientTracks?.[selectedGradientKeyframe.property];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedGradientKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      keyframe = {
        kind: 'gradient',
        easing: track[idx].easing,
        header: `${selectedGradientKeyframe.property} gradient @ ${round(track[idx].time)}s`,
        isRotation: false,
        rotationMode: 'shortest',
        inert: idx === track.length - 1,
        morph: null,
        correspondence: null,
      };
    }
  } else if (selectedDashKeyframe && selectedDashKeyframe.objectId === obj.id) {
    const track = obj.dashOffsetTrack;
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedDashKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      keyframe = {
        kind: 'dash',
        easing: track[idx].easing,
        header: `dash @ ${round(track[idx].time)}s`,
        isRotation: false,
        rotationMode: 'shortest',
        inert: idx === track.length - 1,
        morph: null,
        correspondence: null,
      };
    }
  } else if (selectedTrimKeyframe && selectedTrimKeyframe.objectId === obj.id) {
    const track = obj.trim?.[TRIM_TRACK_KEYS[selectedTrimKeyframe.prop]];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedTrimKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      keyframe = {
        kind: 'trim',
        easing: track[idx].easing,
        header: `trim ${selectedTrimKeyframe.prop} @ ${round(track[idx].time)}s`,
        isRotation: false,
        rotationMode: 'shortest',
        inert: idx === track.length - 1,
        morph: null,
        correspondence: null,
      };
    }
  } else if (selectedShapeKeyframe && selectedShapeKeyframe.objectId === obj.id && obj.shapeTrack) {
    const track = obj.shapeTrack;
    const idx = track.findIndex((k) => Math.abs(k.time - selectedShapeKeyframe.time) < KF_EPS);
    if (idx >= 0) {
      const morph = track[idx].morph ?? 'corresponded';
      // Correspondence applies only to a corresponded transition INTO a next keyframe.
      let correspondence: InspectorKeyframeCorrespondenceVM | null = null;
      if (idx < track.length - 1 && morph === 'corresponded') {
        const from = track[idx].path;
        const to = track[idx + 1].path;
        const map = track[idx].correspondence;
        correspondence = { from, to, map, summary: correspondenceSummary(map, from, to), canShift: to.closed };
      }
      keyframe = {
        kind: 'shape',
        easing: track[idx].easing,
        header: `shape @ ${round(track[idx].time)}s`,
        isRotation: false,
        rotationMode: 'shortest',
        inert: idx === track.length - 1,
        morph,
        correspondence,
      };
    }
  } else if (selectedKeyframe && selectedKeyframe.objectId === obj.id) {
    const track = obj.tracks[selectedKeyframe.property];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      keyframe = {
        kind: 'scalar',
        easing: track[idx].easing,
        header: `${selectedKeyframe.property} @ ${round(track[idx].time)}s`,
        isRotation: selectedKeyframe.property === 'rotation',
        rotationMode: track[idx].rotationMode ?? 'shortest',
        inert: idx === track.length - 1,
        morph: null,
        correspondence: null,
      };
    }
  }

  // Per-node easing for the node selected on the keyframe at the playhead (corresponded only).
  let nodeEasing: InspectorNodeEasingVM | null = null;
  {
    const edited = selectEditedShapeKeyframe(s);
    if (
      s.selectedNodeRing === 0 && // per-node easings are a primary-path morph construct
      s.selectedNodeIndex != null &&
      edited &&
      s.selectedNodeIndex < edited.kf.path.nodes.length &&
      (edited.kf.morph ?? 'corresponded') === 'corresponded'
    ) {
      nodeEasing = {
        index: s.selectedNodeIndex,
        value: edited.kf.nodeEasings?.[s.selectedNodeIndex] ?? edited.kf.easing,
        inert: !!obj.shapeTrack && edited.index === obj.shapeTrack.length - 1,
      };
    }
  }

  // For a path: the shape actually shown/edited at the playhead (the sampled morph shape when
  // a shapeTrack exists, else the static base) — used for the node count.
  const editablePath = vector?.shapeType === 'path' ? selectEditablePath(s) : null;
  const pathNodeCount = editablePath?.nodes.length ?? vector?.path?.nodes.length ?? 0;

  // "Remove shape keyframe" is only meaningful when removeShapeKeyframe() would act: a
  // keyframe sits at the snapped playhead, or one is selected for this object.
  const canRemoveShapeKeyframe =
    (obj.shapeTrack?.length ?? 0) > 0 &&
    ((obj.shapeTrack?.some((k) => Math.abs(k.time - snapped) < KF_EPS) ?? false) ||
      selectedShapeKeyframe?.objectId === obj.id);

  // Shares one definition with the command registry (commands/predicates), like canBool above.
  const canOutlineStroke = canOutlineStrokePred(s);

  const transform = {
    x: round(sampled.x),
    y: round(sampled.y),
    scaleX: round(sampled.scaleX),
    scaleY: round(sampled.scaleY),
    rotation: round(sampled.rotation),
    opacity: round(sampled.opacity),
  };
  const anchor = { x: round(obj.anchorX), y: round(obj.anchorY) };
  const geometry: Record<string, number> = {
    width: round(sampled.geometry?.width ?? 0),
    height: round(sampled.geometry?.height ?? 0),
    cornerRadius: round(sampled.geometry?.cornerRadius ?? 0),
    radiusX: round(sampled.geometry?.radiusX ?? 0),
    radiusY: round(sampled.geometry?.radiusY ?? 0),
  };

  // Rotation is animatable (Task 3: obj.tracks.primitiveRotation, degrees) but primitive props
  // aren't in the ANIMATABLE/GEOMETRY loops `sampled` is built from, so it isn't on `sampled` —
  // read the track directly at the playhead (mirrors dashOffset's track-vs-static split above),
  // falling back to the static spec (radians -> degrees) when no track exists.
  const primitiveRotationTrack = obj.tracks.primitiveRotation;
  // Task 4b: sides/points(starPoints)/innerRatio/cornerRadius are animatable too, same as
  // rotation above, but also aren't in the ANIMATABLE/GEOMETRY loops `sampled` is built from —
  // same track-wins-at-playhead read, no unit conversion (track and spec share units).
  const primitiveParamAtPlayhead = (trackKey: AnimatableProperty, staticValue: number): number => {
    const track = obj.tracks[trackKey];
    return track && track.length > 0 ? interpolate(track, time) : staticValue;
  };
  const primitive = vector?.primitive
    ? {
        sides: primitiveParamAtPlayhead('sides', vector.primitive.sides ?? 5),
        points: primitiveParamAtPlayhead('starPoints', vector.primitive.points ?? 5),
        innerRatio: round(primitiveParamAtPlayhead('innerRatio', vector.primitive.innerRatio ?? 0.5)),
        cornerRadius: round(primitiveParamAtPlayhead('cornerRadius', vector.primitive.cornerRadius)),
        rotation: round(
          primitiveRotationTrack && primitiveRotationTrack.length > 0
            ? interpolate(primitiveRotationTrack, time)
            : (vector.primitive.rotation * 180) / Math.PI,
        ),
      }
    : null;

  const strokeWidth = vector ? round(vector.style.strokeWidth) : 0;
  const dashOffset = vector ? round(sampled.strokeDashoffset ?? vector.style.strokeDashoffset ?? 0) : 0;
  const dashed = !!vector && !!vector.style.strokeDasharray && vector.style.strokeDasharray.length > 0;
  // Trim at the playhead: the sampled RenderState (present iff obj.trim is), falling back to
  // the base values, else the identity window {0,1,0}.
  const trimSampled = vector ? sampled.trim ?? obj.trim : undefined;
  const trimStart = round(trimSampled?.start ?? 0);
  const trimEnd = round(trimSampled?.end ?? 1);
  const trimOffset = round(trimSampled?.offset ?? 0);
  const trimActive = !!obj.trim;

  const motionPath = obj.motionPath
    ? {
        orient: obj.motionPath.orient,
        progressDisplay: round(obj.motionPath.progress.length ? interpolate(obj.motionPath.progress, time) : 0),
        progressAtSnapped: round(
          obj.motionPath.progress.length ? interpolate(obj.motionPath.progress, snapped) : 0,
        ),
      }
    : null;

  // Text-on-path (text-on-path #3): only meaningful for a TEXT object. pathTargets mirrors
  // bindTextPath's eligibility (plain vector path, no live-boolean) — swapTargets precedent,
  // but does NOT exclude the currently bound target (it must remain a valid <select> option).
  let textPath: InspectorTextPathVM | null = null;
  if (asset?.kind === 'text') {
    const pathTargets = objects
      .filter((o) => o.id !== obj.id && !o.boolean)
      .filter((o) => {
        const a = assets.find((x) => x.id === o.assetId);
        return a?.kind === 'vector' && a.shapeType === 'path';
      })
      .map((o) => ({ id: o.id, name: o.name }));
    const boundTarget = obj.textPath ? objects.find((o) => o.id === obj.textPath!.pathObjectId) : undefined;
    const offsetTrack = obj.tracks.textPathOffset;
    const offset = obj.textPath
      ? round(offsetTrack && offsetTrack.length > 0 ? interpolate(offsetTrack, time) : obj.textPath.startOffset)
      : 0;
    textPath = { bound: !!obj.textPath, pathTargets, boundName: boundTarget?.name ?? null, offset };
  }

  let symbol: InspectorSymbolVM | null = null;
  if (isInstance) {
    const remapOn = !!obj.symbolTimeTrack && obj.symbolTimeTrack.length > 0;
    const timingDisabled = !!obj.symbolTimeTrack?.length;
    const activeAssetId = selectActiveAssetId(s);
    const swapTargets = assets
      .filter(
        (a) =>
          a.kind === 'symbol' &&
          a.id !== obj.assetId &&
          !(activeAssetId && (a.id === activeAssetId || symbolContains(a.id, activeAssetId, assets))),
      )
      .map((a) => ({ id: a.id, name: a.name }));
    symbol = {
      remapOn,
      internalTime: remapOn ? round(Math.max(0, interpolate(obj.symbolTimeTrack!, snapped))) : 0,
      startOffset: round(obj.symbolTime?.startOffset ?? 0),
      timingDisabled,
      loop: obj.symbolTime?.loop ?? false,
      pingPong: obj.symbolTime?.pingPong ?? false,
      speed: round(obj.symbolTime?.speed ?? 1),
      playCount: round(obj.symbolTime?.playCount ?? 0),
      phase: round(obj.symbolTime?.phase ?? 0),
      duration: round((asset as SymbolAsset | undefined)?.duration ?? 0),
      clip: (asset as SymbolAsset | undefined)?.clip ?? false,
      swapTargets,
      freezeFirstFrame: obj.freezeFirstFrame ?? false,
      tint: {
        enabled: !!obj.tint,
        color: obj.tint?.color ?? '#ff0000',
        amount: obj.tint?.amount ?? 0.5,
      },
    };
  }

  // Repeater (art-tools #3): null when ineligible (group/instance — canRepeat mirrors the
  // store's own gate so the panel and the intents never disagree about eligibility). Eligible
  // but off (obj.repeat absent) reports the defaults with on:false; a live spec reports on:true
  // with its own values.
  const repeat: InspectorRepeatVM | null = canRepeat(obj, assets)
    ? { on: !!obj.repeat, ...(obj.repeat ?? REPEAT_DEFAULTS) }
    : null;

  return {
    kind: 'single',
    obj,
    sampled,
    asset,
    vector,
    isInstance,
    canCreateSymbol,
    transform,
    anchor,
    geometry,
    pathNodeCount,
    canRemoveShapeKeyframe,
    canOutlineStroke,
    primitive,
    strokeWidth,
    dashOffset,
    dashed,
    trimStart,
    trimEnd,
    trimOffset,
    trimActive,
    motionPath,
    textPath,
    keyframe,
    nodeEasing,
    symbol,
    repeat,
    showNodeEditButtons: s.activeTool === 'node' && s.selectedNodeIndex != null,
    autoKey: s.autoKey,
  };
}

/** The minimal shape `inspectorIntents` needs from the vanilla `@savig/editor-state` store —
 *  avoids importing zustand's `StoreApi` type just for this signature. `store` (the real
 *  vanilla StoreApi) satisfies this structurally. */
export interface InspectorStore {
  getState: () => EditorState;
}

export function inspectorIntents(store: InspectorStore) {
  const s = () => store.getState();
  return {
    setProperty: (property: AnimatableProperty, value: number) => s().setProperty(property, value),
    setAnchor: (anchorX: number, anchorY: number) => s().setAnchor(anchorX, anchorY),
    duplicateSelected: () => s().duplicateSelected(),
    deleteSelectedObject: () => s().deleteSelectedObject(),
    groupSelected: () => s().groupSelected(),
    ungroupSelected: () => s().ungroupSelected(),
    createSymbol: () => s().createSymbol(),
    setSymbolTiming: (partial: Partial<SymbolTiming>) => s().setSymbolTiming(partial),
    toggleSymbolTimeRemap: () => s().toggleSymbolTimeRemap(),
    setSymbolTimeRemap: (value: number) => s().setSymbolTimeRemap(value),
    setSymbolDuration: (symId: string, duration: number) => s().setSymbolDuration(symId, duration),
    setStageSize: (width: number, height: number) => s().setStageSize(width, height),
    setSymbolClip: (symId: string, clip: boolean) => s().setSymbolClip(symId, clip),
    setInstanceFreeze: (freeze: boolean) => s().setInstanceFreeze(freeze),
    setInstanceTint: (tint: { color: string; amount: number } | undefined) => s().setInstanceTint(tint),
    swapSymbol: (instanceId: string, newSymId: string) => s().swapSymbol(instanceId, newSymId),
    setRepeat: (partial: Partial<RepeatSpec>) => s().setRepeat(partial),
    toggleRepeat: () => s().toggleRepeat(),
    booleanOp: (op: BoolOp, opts?: { live?: boolean }) => s().booleanOp(op, opts),
    outlineStroke: () => s().outlineStroke(),
    alignSelected: (edge: AlignEdge) => s().alignSelected(edge),
    distributeSelected: (axis: DistributeAxis) => s().distributeSelected(axis),
    distributeCentersSelected: (axis: DistributeAxis) => s().distributeCentersSelected(axis),
    distributeSpacingSelected: (axis: DistributeAxis, gap: number) => s().distributeSpacingSelected(axis, gap),
    centerOnCanvas: () => s().centerOnCanvas(),
    alignToCanvas: (edge: AlignEdge) => s().alignToCanvas(edge),
    reorderSelected: (op: Parameters<EditorState['reorderSelected']>[0]) => s().reorderSelected(op),
    setVectorStyle: (updates: Partial<VectorStyle>) => s().setVectorStyle(updates),
    setVectorColor: (property: ColorProperty, value: string) => s().setVectorColor(property, value),
    setVectorGradient: (property: ColorProperty, gradient: Gradient | undefined) =>
      s().setVectorGradient(property, gradient),
    toggleSelectedNodeSmooth: () => s().toggleSelectedNodeSmooth(),
    joinSelectedNode: () => s().joinSelectedNode(),
    breakSelectedNode: () => s().breakSelectedNode(),
    deleteSelectedNode: () => s().deleteSelectedNode(),
    removeSelectedColorKeyframe: () => s().removeSelectedColorKeyframe(),
    removeSelectedGradientKeyframe: () => s().removeSelectedGradientKeyframe(),
    setStrokeDasharray: (dasharray: number[] | undefined) => s().setStrokeDasharray(dasharray),
    setStrokeDashoffset: (value: number) => s().setStrokeDashoffset(value),
    drawOn: () => s().drawOn(),
    removeSelectedDashKeyframe: () => s().removeSelectedDashKeyframe(),
    setTrim: (prop: TrimProperty, value: number) => s().setTrim(prop, value),
    removeSelectedTrimKeyframe: () => s().removeSelectedTrimKeyframe(),
    addShapeKeyframe: () => s().addShapeKeyframe(),
    removeShapeKeyframe: () => s().removeShapeKeyframe(),
    setSelectedKeyframeEasing: (easing: Easing) => s().setSelectedKeyframeEasing(easing),
    setSelectedKeyframeRotationMode: (mode: RotationMode) => s().setSelectedKeyframeRotationMode(mode),
    setSelectedShapeKeyframeMorph: (mode: MorphMode) => s().setSelectedShapeKeyframeMorph(mode),
    setSelectedShapeKeyframeCorrespondence: (c: number[] | undefined) =>
      s().setSelectedShapeKeyframeCorrespondence(c),
    setSelectedNodeEasing: (easing: Easing | undefined) => s().setSelectedNodeEasing(easing),
    removeMotionPath: (objectId: string) => s().removeMotionPath(objectId),
    setMotionPathOrient: (objectId: string, orient: boolean) => s().setMotionPathOrient(objectId, orient),
    setMotionProgress: (value: number) => s().setMotionProgress(value),
    bindTextPath: (pathObjectId: string) => s().bindTextPath(pathObjectId),
    unbindTextPath: () => s().unbindTextPath(),
    setTextPathOffset: (value: number) => s().setTextPathOffset(value),
    setActiveTool: (tool: ToolMode) => s().setActiveTool(tool),
    setPrimitiveParam: (param: 'sides' | 'points' | 'innerRatio' | 'cornerRadius' | 'rotation', value: number) =>
      s().setPrimitiveParam(param, value),
    // The Shape Builder button's toggle — reuses the `path.shapeBuilder` command's own run logic
    // (commands/intents' `toggleShapeBuilder`) rather than re-deriving the enter/exit ternary.
    toggleShapeBuilder: () => toggleShapeBuilder(s()),
    blendSelected: (count: number, easing?: Easing) => s().blendSelected(count, easing),
    // Composes the two correspondence-edit-mode actions the "Edit links" button needs — the
    // overlay renders only in the node tool (it reuses the node-edit transform), so entering
    // edit mode must establish that precondition.
    toggleCorrespondenceEdit: () => {
      const st = store.getState();
      if (st.correspondenceEditing) {
        st.exitCorrespondenceEdit();
      } else {
        st.setActiveTool('node');
        st.enterCorrespondenceEdit();
      }
    },
    // Shape-keyframe correspondence helpers used by the Correspondence group's buttons.
    suggestCorrespondence: (from: PathData, to: PathData) =>
      s().setSelectedShapeKeyframeCorrespondence(suggestCorrespondence(from, to)),
    shiftCorrespondence: (cur: number[], n: number, delta: 1 | -1) =>
      s().setSelectedShapeKeyframeCorrespondence(shiftCorrespondence(cur, n, delta)),
    reverseCorrespondence: (cur: number[], n: number) =>
      s().setSelectedShapeKeyframeCorrespondence(reverseCorrespondence(cur, n)),
  };
}
