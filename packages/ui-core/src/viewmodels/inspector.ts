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
  RotationMode,
  SceneObject,
  SymbolAsset,
  SymbolTiming,
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
} from '@savig/editor-state';
import type { EditorState, ToolMode } from '@savig/editor-state';

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
}

export interface InspectorMultiVM {
  kind: 'multi';
  count: number;
  someGrouped: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  canBool: boolean;
  canCreateSymbol: boolean;
}

export interface InspectorGroupVM {
  kind: 'group';
  name: string;
}

export type InspectorKeyframeKind = 'progress' | 'color' | 'gradient' | 'dash' | 'shape' | 'scalar';

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
  primitive: { sides: number; points: number; innerRatio: number; cornerRadius: number } | null;
  strokeWidth: number;
  dashOffset: number;
  motionPath: InspectorMotionPathVM | null;
  keyframe: InspectorKeyframeVM | null;
  nodeEasing: InspectorNodeEasingVM | null;
  symbol: InspectorSymbolVM | null;
}

export type InspectorVM = InspectorEmptyVM | InspectorMultiVM | InspectorGroupVM | InspectorSingleVM;

// Single-slot memo keyed on the EditorState reference. `inspectorViewModel` is consumed via
// React's `useSyncExternalStore` (through zustand's `useStore(store, inspectorViewModel)`),
// which requires getSnapshot to be referentially STABLE when called twice in a row with an
// unchanged state (React does this internally to detect concurrent tearing). Since the store's
// `s` is replaced wholesale on every `set()` but is the SAME reference between real updates,
// caching on `s` gives that stability for free while still recomputing on every genuine state
// change — no React/zustand import needed here, so this stays framework-neutral.
let lastState: EditorState | undefined;
let lastVM: InspectorVM | undefined;

export function inspectorViewModel(s: EditorState): InspectorVM {
  if (lastState === s && lastVM) return lastVM;
  const vm = computeInspectorViewModel(s);
  lastState = s;
  lastVM = vm;
  return vm;
}

function computeInspectorViewModel(s: EditorState): InspectorVM {
  const selectedIds = s.selectedObjectIds;
  const objects = selectActiveObjects(s);
  const assets = s.history.present.assets;
  const time = s.time;
  const fps = s.history.present.meta.fps;

  // --- multi-select -----------------------------------------------------------------------
  if (selectedIds.length > 1) {
    const lockById = new Map(objects.map((o) => [o.id, o]));
    const someGrouped = selectedIds.some((id) => objects.find((o) => o.id === id)?.isGroup);
    // Align/distribute act only on MOVABLE members (locked/hidden are skipped in the store),
    // so gate the buttons on the movable count — never enable a button that silently no-ops.
    // Lock cascades: a child of a locked group is not movable either.
    const movableCount = selectedIds.filter((id) => {
      const o = objects.find((obj) => obj.id === id);
      return o && !isLockedInTree(o, lockById) && !o.hidden;
    }).length;
    const canAlign = movableCount >= 2;
    const canDistribute = movableCount >= 3;
    // Boolean ops need >=2 operands; a GROUP counts when it has vector-leaf descendants (it acts as
    // the union of its leaves), and a DIRECT SVG-asset object counts (its filled silhouette joins the
    // clip) — mirrors the store's booleanOp eligibility (vectorLeavesOf(o).length > 0 || isSvgOperand).
    const hasVectorLeaf = (o: SceneObject): boolean => {
      if (!o.isGroup) return assets.find((x) => x.id === o.assetId)?.kind === 'vector';
      return objects.some((c) => c.parentId === o.id && hasVectorLeaf(c));
    };
    const isSvgOperand = (o: SceneObject): boolean =>
      !o.isGroup && assets.find((x) => x.id === o.assetId)?.kind === 'svg';
    const eligibleForBool = selectedIds.filter((id) => {
      const o = objects.find((obj) => obj.id === id);
      return !!o && (hasVectorLeaf(o) || isSvgOperand(o));
    }).length;
    const canBool = eligibleForBool >= 2;
    // Create Symbol needs >=1 non-locked top-level object (groups allowed as members, like
    // grouping). The store's createSymbol uses the same predicate (slice 47a).
    const canCreateSymbol = selectedIds.some((id) => {
      const o = objects.find((obj) => obj.id === id);
      return !!o && !o.locked && !o.parentId;
    });
    return { kind: 'multi', count: selectedIds.length, someGrouped, canAlign, canDistribute, canBool, canCreateSymbol };
  }

  const obj = selectSelectedObject(s);
  if (!obj) return { kind: 'empty' };

  // A group CONTAINER has no asset — a dedicated panel (never the asset-dependent editors
  // below, which would throw on a group). Slice 45b.
  if (obj.isGroup) {
    return { kind: 'group', name: obj.name };
  }

  const lockById = new Map(objects.map((o) => [o.id, o]));
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

  const primitive = vector?.primitive
    ? {
        sides: vector.primitive.sides ?? 5,
        points: vector.primitive.points ?? 5,
        innerRatio: round(vector.primitive.innerRatio ?? 0.5),
        cornerRadius: round(vector.primitive.cornerRadius),
      }
    : null;

  const strokeWidth = vector ? round(vector.style.strokeWidth) : 0;
  const dashOffset = vector ? round(sampled.strokeDashoffset ?? vector.style.strokeDashoffset ?? 0) : 0;

  const motionPath = obj.motionPath
    ? {
        orient: obj.motionPath.orient,
        progressDisplay: round(obj.motionPath.progress.length ? interpolate(obj.motionPath.progress, time) : 0),
        progressAtSnapped: round(
          obj.motionPath.progress.length ? interpolate(obj.motionPath.progress, snapped) : 0,
        ),
      }
    : null;

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
    primitive,
    strokeWidth,
    dashOffset,
    motionPath,
    keyframe,
    nodeEasing,
    symbol,
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
    setSymbolClip: (symId: string, clip: boolean) => s().setSymbolClip(symId, clip),
    setInstanceFreeze: (freeze: boolean) => s().setInstanceFreeze(freeze),
    setInstanceTint: (tint: { color: string; amount: number } | undefined) => s().setInstanceTint(tint),
    swapSymbol: (instanceId: string, newSymId: string) => s().swapSymbol(instanceId, newSymId),
    booleanOp: (op: BoolOp, opts?: { live?: boolean }) => s().booleanOp(op, opts),
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
    setActiveTool: (tool: ToolMode) => s().setActiveTool(tool),
    setPrimitiveParam: (param: 'sides' | 'points' | 'innerRatio' | 'cornerRadius', value: number) =>
      s().setPrimitiveParam(param, value),
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
