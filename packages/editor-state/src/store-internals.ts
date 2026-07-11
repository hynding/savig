// Shared store internals: state types, constants, and pure helpers used across the
// store slices (see ./slices/*). Extracted from store.ts so each slice can import the
// helpers without a circular dependency on the composed store. No behavior change.
import type { StoreApi } from 'zustand';
import {
  createKeyframe,
  snapToFrame,
  upsertKeyframe,
  sampleObject,
} from '@savig/engine';
import { isLockedInTree } from '@savig/engine';
import type {
  AnimatableProperty,
  Asset,
  BoolOp,
  PrimitiveSpec,
  Easing,
  Gradient,
  History,
  MorphMode,
  ColorProperty,
  PathData,
  Project,
  RepeatSpec,
  ReorderOp,
  RotationMode,
  SceneObject,
  SymbolTiming,
  Transition,
  Keyframe,
  ColorKeyframe,
  GradientKeyframe,
  ShapeKeyframe,
  TrimProperty,
  VectorAsset,
  VectorShapeType,
  VectorStyle,
} from '@savig/engine';
import { objectAABB, isSymbolInstance, type AABB } from '@savig/interaction';
import { type AlignEdge, type DistributeAxis, type AlignItem } from '@savig/interaction';
import { selectActiveObjects, selectActiveSymbolAsset } from './selectors';

/** Tolerance for matching a keyframe by time (times are frame-snapped on creation). */
export const KF_EPS = 1e-6;
export const DUP_OFFSET = 10;

export type Theme = 'dark' | 'light';

/** The two-axis active-scene scope: the selected SCENE (multi-scene) and the entered SYMBOL
 *  (slice 47). Symbol wins when set; else the scene base governs the root objects[]. */
export interface SceneScope {
  sceneId: string | null;
  assetId: string | null;
}

export type ToolMode =
  | 'select' | 'pen' | 'node' | 'rect' | 'ellipse' | 'motion'
  | 'polygon' | 'star' | 'line' | 'brush' | 'eyedropper' | 'scissors';

export interface KeyframeRef {
  objectId: string;
  property: AnimatableProperty;
  time: number;
}

export interface ShapeKeyframeRef {
  objectId: string;
  time: number;
}

export interface ColorKeyframeRef {
  objectId: string;
  property: ColorProperty;
  time: number;
}

export interface GradientKeyframeRef {
  objectId: string;
  property: ColorProperty;
  time: number;
}

export interface DashKeyframeRef {
  objectId: string;
  time: number;
}

/** A selected trim-path keyframe (start/end/offset track). */
export interface TrimKeyframeRef {
  objectId: string;
  prop: TrimProperty;
  time: number;
}

export interface ProgressKeyframeRef {
  objectId: string;
  time: number;
}

/** A selected symbol time-remap keyframe (47c keyframed). */
export interface RemapKeyframeRef {
  objectId: string;
  time: number;
}

/** A snapshot of the selected keyframe for the keyframe clipboard (Slice 24). */
export type KeyframeClip =
  | { kind: 'scalar'; objectId: string; property: AnimatableProperty; keyframe: Keyframe }
  | { kind: 'dash'; objectId: string; keyframe: Keyframe }
  | { kind: 'trim'; objectId: string; prop: TrimProperty; keyframe: Keyframe }
  | { kind: 'progress'; objectId: string; keyframe: Keyframe }
  | { kind: 'remap'; objectId: string; keyframe: Keyframe }
  | { kind: 'color'; objectId: string; property: ColorProperty; keyframe: ColorKeyframe }
  | { kind: 'gradient'; objectId: string; property: ColorProperty; keyframe: GradientKeyframe }
  | { kind: 'shape'; objectId: string; keyframe: ShapeKeyframe };

export interface Toast {
  id: string;
  kind: 'error' | 'info';
  message: string;
}

export interface EditorState {
  // --- undoable document ---
  history: History<Project>;
  // --- transient (never in history) ---
  binaries: Record<string, Uint8Array>;
  clipboard: { object: SceneObject; asset?: Asset }[] | null;
  keyframeClipboard: KeyframeClip | null;
  /** Captured VectorStyle for Copy/Paste Style (transient; deep-copied on capture). */
  styleClipboard: VectorStyle | null;
  selectedObjectId: string | null;
  /** The full multi-selection (slice 36). `selectedObjectId` is the primary = last of this. */
  selectedObjectIds: string[];
  /** Symbol edit mode (slice 47 edit-mode): the symbol-asset ids entered, outermost-first.
   *  [] = editing the root scene. Transient view state (never in history). */
  editPath: string[];
  /** The active scene in multi-scene mode (8b-3). null = use scene[0]. Transient. */
  selectedSceneId: string | null;
  selectedNodeIndex: number | null;
  /** Which ring of the selected path the node tool addresses: 0 = primary `path`,
   *  k = `compoundRings[k-1]`. Only meaningful when selectedNodeIndex is non-null. */
  selectedNodeRing: number;
  selectedKeyframe: KeyframeRef | null;
  selectedShapeKeyframe: ShapeKeyframeRef | null;
  selectedColorKeyframe: ColorKeyframeRef | null;
  selectedGradientKeyframe: GradientKeyframeRef | null;
  selectedDashKeyframe: DashKeyframeRef | null;
  selectedTrimKeyframe: TrimKeyframeRef | null;
  selectedProgressKeyframe: ProgressKeyframeRef | null;
  selectedRemapKeyframe: RemapKeyframeRef | null;
  time: number;
  playing: boolean;
  autoKey: boolean;
  onionSkin: boolean;
  snapEnabled: boolean;
  /** Snap-to-grid toggle (independent of snapEnabled) + the lattice spacing in content px. */
  gridEnabled: boolean;
  gridSize: number;
  /** Stage-frame overlay: outline the artboard + dim everything outside it. */
  frameEnabled: boolean;
  theme: Theme;
  zoom: number;
  pan: { x: number; y: number };
  activeTool: ToolMode;
  /** Creation-time options for the primitive tools (used by the Stage drag, not stored
   *  parametrically on the asset — a stamped primitive is an ordinary editable path). */
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
  /** Creation-time corner-radius (>=0) applied to stamped polygon/star primitives. */
  primitiveCornerRadius: number;
  /** Creation-time brush options (stroke width seed + 0..1 smoothing for strokeToPath). */
  brushSize: number;
  brushSmoothing: number;
  /** True while a pen draft is in progress (so the keyboard handler can target it). */
  penDrafting: boolean;
  /** Incremented to ask an in-progress pen draft to cancel (keyboard -> usePathTools). */
  cancelPenRequested: number;
  toasts: Toast[];

  // --- document actions ---
  setProject(project: Project, binaries?: Record<string, Uint8Array>): void;
  newProject(): void;
  /** Descend into a symbol instance's scene to edit its internals (edit-in-place). */
  enterSymbol(assetId: string): void;
  /** Pop one edit-path level (exit the current symbol). */
  exitSymbol(): void;
  /** Truncate the edit path to `depth` (0 = root); breadcrumb navigation. */
  exitToDepth(depth: number): void;
  /** Commit `nextObjects` to the ACTIVE scene (root project.objects, or the edited symbol asset). */
  commitActiveScene(nextObjects: SceneObject[]): void;
  commit(next: Project): void;
  undo(): void;
  redo(): void;
  addAsset(asset: Asset, bytes?: Uint8Array): void;
  addObject(assetId: string): void;
  duplicateSelected(): void;
  copySelected(): void;
  cut(): void;
  paste(): void;
  copyKeyframe(): void;
  pasteKeyframe(): void;
  deleteSelectedKeyframe(): void;
  cutKeyframe(): void;
  retimeSelectedKeyframe(newTime: number): void;
  deleteSelectedObject(): void;
  reorderSelected(op: ReorderOp): void;
  moveObjectToTarget(draggedId: string, targetId: string): void;
  toggleObjectVisibility(id: string): void;
  toggleObjectLock(id: string): void;
  renameObject(id: string, name: string): void;
  addVectorShape(shapeType: VectorShapeType, bounds: { x: number; y: number; width: number; height: number }): void;
  addVectorPath(path: PathData, styleSeed?: Partial<VectorStyle>): void;
  /** Multi-ring generalization of `addVectorPath` — `addVectorPath(path)` delegates to
   *  `addVectorOutline([path])` (they are semantically equivalent for a single ring; see the
   *  parity test). `rings` are assumed largest-first (outlineStroke's convention) — never
   *  re-sorted here. All rings are normalized together by the COMBINED bbox origin (union of
   *  every ring's `pathBounds`), so `rings[0]` becomes the asset's `path` and any remaining rings
   *  become `compoundRings` (omitted entirely when there are none — byte-clean, matching the
   *  boolean-op/outlineStroke convention). No-ops (no commit) on an empty `rings` array or when
   *  `rings[0]` has fewer than 2 nodes, mirroring `addVectorPath`'s own guard. */
  addVectorOutline(rings: PathData[], styleSeed?: Partial<VectorStyle>): void;
  /** Stamp a parametric polygon/star (slice 35). `spec` is in STAGE coords. */
  addPrimitive(spec: PrimitiveSpec): void;
  /** Re-edit a stamped primitive's param; no-op without a spec. autoKey ON -> keyframe on the
   *  mapped track (points->starPoints, rotation->primitiveRotation, others same-named) at the
   *  frame-snapped playhead, preserving an existing keyframe's easing; spec left untouched.
   *  autoKey OFF -> today's spec-overwrite + path regeneration (rotation converts degrees input
   *  to radians onto spec.rotation). */
  setPrimitiveParam(param: 'sides' | 'points' | 'innerRatio' | 'cornerRadius' | 'rotation', value: number): void;
  setPathData(path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void;
  setRingPathData(ring: number, path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void;
  /** Scissors (art-tools #4): cut the selected path at curve-parameter `t` along segment
   *  `segmentIndex` (de Casteljau, `cutPath` — engine). A closed path opens at the cut point
   *  (same object id); an open path splits into two objects (ONE commit). Gated (toast + no
   *  commit): non-vector-path target, a morphing (`shapeTrack`) path, a path with
   *  `compoundRings`, or a live-boolean result (`obj.boolean`). A degenerate/boundary cut
   *  (`cutPath` returns `{kind:'noop'}`) is a silent no-op — no toast, no commit. */
  cutSelectedPathAt(segmentIndex: number, t: number): void;
  /** Outline stroke (M6 feature): converts the selected path's STROKE into a filled shape
   *  (`outlineStroke` — engine), replacing the path with the offset ring(s) (largest first ->
   *  `path`, the rest -> `compoundRings`) and swapping stroke paint into fill paint. Identity is
   *  kept (same object id) — a GROUPED path is allowed (unlike scissors). Gated (toast + no
   *  commit): non-vector/non-path target, no visible stroke, a morphing (`shapeTrack`) path, a
   *  path with `compoundRings`, a live-boolean result or operand (`obj.boolean` /
   *  `operandIds.includes`), or a locked path (lock cascade). A degenerate outline (the engine
   *  returns no rings) is a silent no-op — no toast, no commit. */
  outlineStroke(): void;
  addShapeKeyframe(): void;
  removeShapeKeyframe(): void;
  selectShapeKeyframe(ref: ShapeKeyframeRef | null): void;
  selectColorKeyframe(ref: ColorKeyframeRef | null): void;
  removeSelectedColorKeyframe(): void;
  selectGradientKeyframe(ref: GradientKeyframeRef | null): void;
  removeSelectedGradientKeyframe(): void;
  setStrokeDasharray(dasharray: number[] | undefined): void;
  setStrokeDashoffset(value: number): void;
  drawOn(): void;
  selectDashKeyframe(ref: DashKeyframeRef | null): void;
  removeSelectedDashKeyframe(): void;
  /** Set a trim property (0..1, clamped). autoKey ON keyframes at the playhead (preserving an
   *  existing keyframe's easing); OFF writes the base value. Identity ({0,1,0}, trackless)
   *  normalizes trim back to absent. No-op while a dash pattern is set (dash wins). */
  setTrim(prop: TrimProperty, value: number): void;
  selectTrimKeyframe(ref: TrimKeyframeRef | null): void;
  removeSelectedTrimKeyframe(): void;
  selectRemapKeyframe(ref: RemapKeyframeRef | null): void;
  removeSelectedRemapKeyframe(): void;
  addMotionPath(objectId: string, path: PathData): void;
  removeMotionPath(objectId: string): void;
  setMotionPathOrient(objectId: string, orient: boolean): void;
  setMotionProgress(value: number): void;
  selectProgressKeyframe(ref: ProgressKeyframeRef | null): void;
  removeSelectedProgressKeyframe(): void;
  deleteSelectedNode(): void;
  insertNode(ring: number, segmentIndex: number, t: number): void;
  toggleSelectedNodeSmooth(): void;
  joinSelectedNode(): void;
  breakSelectedNode(): void;
  selectNode(index: number | null, ring?: number): void;
  selectObject(id: string | null): void;
  toggleObjectSelection(id: string): void;
  selectObjects(ids: string[]): void;
  /** Group containers (slice 45): a group is a real container object; children via parentId. */
  groupSelected(): void;
  ungroupSelected(): void;
  /** Nested symbols (slice 47a): move the selected top-level objects into a new reusable
   *  SymbolAsset and replace them with one instance referencing it (visually identical). */
  createSymbol(): void;
  /** Place a fresh instance of a symbol into the active scene (slice 47d). Cycle-guarded. */
  placeSymbolInstance(symId: string): void;
  /** Place a symbol instance with its content-centre at scene point (x, y) — drag-to-place. (47d) */
  placeSymbolInstanceAt(symId: string, x: number, y: number): void;
  /** Repoint a symbol instance at a different symbol, preserving its transform (slice 47d). */
  swapSymbol(instanceId: string, newSymId: string): void;
  /** Rename any asset (library symbol, svg, audio). Empty/whitespace keeps the old name. (47d) */
  renameAsset(assetId: string, name: string): void;
  /** Delete a library symbol — blocked (toast) while any instance references it; prunes its
   *  now-orphaned internal vector/svg assets. (47d) */
  deleteSymbol(symId: string): void;
  /** Delete a non-symbol asset (svg/audio) — blocked (toast) while any object or audio clip
   *  references it. Symbols use deleteSymbol. (47d) */
  deleteAsset(assetId: string): void;
  /** Boolean path ops (slice 46): combine the selected vector shapes into one (possibly
   *  compound/holed) path object, destructively replacing the sources. */
  booleanOp(op: BoolOp, opts?: { live?: boolean }): void;
  /** Move `id` into the group `newParentId` (or to root when null), preserving its world
   *  position via bake-out/unbake-in across the group chain (drag-reparent, slice 45f). */
  reparentObject(id: string, newParentId: string | null): void;
  /** Write a group container's static base transform directly (unused since 45b; the group
   *  transform is normally edited via setObjectsTransforms/nudgeSelected — base when auto-key
   *  is off, keyframes when on, slice 45d). */
  setGroupTransform(id: string, partial: Partial<Record<'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation', number>>): void;
  selectObjectOrGroup(id: string): void;
  toggleObjectOrGroup(id: string): void;
  selectObjectsExpandingGroups(ids: string[]): void;
  setProperty(property: AnimatableProperty, value: number): void;
  setProperties(updates: Partial<Record<AnimatableProperty, number>>): void;
  /** Set per-instance internal-timeline timing (slice 47c) on the selected symbol instance. */
  setSymbolTiming(partial: Partial<SymbolTiming>): void;
  /** Enable/disable a keyframed time-remap on the selected instance (47c). Enable seeds an identity
   *  curve (or a single 0->0 keyframe for a zero-duration symbol); disable clears symbolTimeTrack. */
  toggleSymbolTimeRemap(): void;
  /** Upsert a time-remap keyframe at the frame-snapped playhead (value = internal-clock seconds). */
  setSymbolTimeRemap(value: number): void;
  /** Set a symbol's manual duration override (seconds; 0 = auto/intrinsic). Affects every instance. (47c) */
  setSymbolDuration(symId: string, duration: number): void;
  /** Merge a partial RepeatSpec onto the selected object (enable-default when absent), routed
   *  through normalizeRepeat (art-tools #3). No-op unless `canRepeat` (non-group, non-instance
   *  leaf) and a non-finite field in the merged result rejects the whole write (repeat unchanged). */
  setRepeat(partial: Partial<RepeatSpec>): void;
  /** Toggle the repeater off (repeat undefined) or on (defaults {count:2, dx:0, dy:0, rotate:0,
   *  scale:1, stagger:0}) for the selected object. No-op unless `canRepeat`. */
  toggleRepeat(): void;
  /** Set the ACTIVE artboard's size: the edited symbol's width/height in symbol-edit mode,
   *  else the root meta.width/height. Clamps each dim to an integer >= 1; no-ops when unchanged.
   *  Content is not moved. Undoable (routed through commit). */
  setStageSize(width: number, height: number): void;
  /** Toggle the symbol-level content-clip flag (slice 47e). When true, every instance of this
   *  symbol clips its rendered content to the [0,width]×[0,height] box. */
  setSymbolClip(symId: string, clip: boolean): void;
  /** Set or clear the per-instance freeze flag on the selected symbol instance (slice 47f).
   *  When true, the instance's internal clock is forced to 0 (first frame). */
  setInstanceFreeze(freeze: boolean): void;
  /** Set or clear the per-instance tint override on the selected symbol instance (slice 47f).
   *  Pass undefined to remove the tint (no overlay). */
  setInstanceTint(tint: { color: string; amount: number } | undefined): void;
  setAnchor(anchorX: number, anchorY: number): void;
  setVectorStyle(updates: Partial<VectorStyle>): void;
  setVectorColor(property: ColorProperty, value: string): void;
  setVectorGradient(property: ColorProperty, gradient: Gradient | undefined): void;
  /** Capture the selected vector's asset style into the style clipboard. */
  copyStyle(): void;
  /** Apply the style clipboard to every selected vector object (WYSIWYG: clears the pasted
   *  properties' animation tracks; skips dash fields on trimmed targets). One commit. */
  pasteStyle(): void;
  /** Eyedropper core: with a selection, restyle it from `sourceObjectId` (paste semantics) in one
   *  commit; with no selection, copy the source's style to the clipboard instead. */
  applyStyleFrom(sourceObjectId: string): void;
  nudgeSelected(dx: number, dy: number): void;
  /** Set any of x/y/scaleX/scaleY/rotation for several objects in one commit (group
   *  transform; slice 40 scale, slice 41 rotate). Only the provided fields are written. */
  setObjectsTransforms(updates: { id: string; x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number }[]): void;
  /** Align (6 edges) / distribute (equal-gap) the multi-selection in one undo step (slice 43). */
  alignSelected(edge: AlignEdge): void;
  distributeSelected(axis: DistributeAxis): void;
  /** Distribute the selection by equal CENTER spacing along the axis (needs >=3). */
  distributeCentersSelected(axis: DistributeAxis): void;
  distributeSpacingSelected(axis: DistributeAxis, gap: number): void;
  /** Center the selection's combined bbox on the artboard (align-to-artboard). Works for >=1 object. */
  centerOnCanvas(): void;
  alignToCanvas(edge: AlignEdge): void;
  selectKeyframe(ref: KeyframeRef | null): void;
  removeSelectedKeyframe(): void;
  setSelectedKeyframeEasing(easing: Easing): void;
  setSelectedKeyframeRotationMode(mode: RotationMode): void;
  setSelectedShapeKeyframeMorph(mode: MorphMode): void;
  setSelectedShapeKeyframeCorrespondence(correspondence: number[] | undefined): void;
  setSelectedNodeEasing(easing: Easing | undefined): void;
  addAudioClip(assetId: string): void;

  // --- scene lifecycle actions (8b-3) ---
  addScene(): void;
  deleteScene(sceneId: string): void;
  reorderScene(sceneId: string, toIndex: number): void;
  renameScene(sceneId: string, name: string): void;
  setSceneDuration(sceneId: string, duration: number): void;
  selectScene(sceneId: string): void;
  setSceneTransition(sceneId: string, transition: Transition): void;

  // --- transport / view actions ---
  seek(time: number): void;
  setPlaying(playing: boolean): void;
  toggleAutoKey(): void;
  toggleOnionSkin(): void;
  toggleSnap(): void;
  setSnapEnabled(b: boolean): void;
  toggleGrid(): void;
  setGridSize(n: number): void;
  toggleFrame(): void;
  stepFrame(direction: 1 | -1): void;
  setTheme(theme: Theme): void;
  setZoom(zoom: number): void;
  setPan(pan: { x: number; y: number }): void;
  setActiveTool(tool: ToolMode): void;
  setPolygonSides(n: number): void;
  setStarPoints(n: number): void;
  setStarInnerRatio(r: number): void;
  setPrimitiveCornerRadius(n: number): void;
  setBrushSize(n: number): void;
  setBrushSmoothing(r: number): void;
  setPenDrafting(drafting: boolean): void;
  requestCancelPen(): void;
  correspondenceEditing: boolean;
  enterCorrespondenceEdit(): void;
  exitCorrespondenceEdit(): void;
  setCorrespondenceLink(aIndex: number, bIndex: number): void;

  // --- toasts ---
  pushToast(kind: Toast['kind'], message: string): void;
  dismissToast(id: string): void;
}

/** A slice creator gets the store's `set`/`get` and returns its slice of `EditorState`.
 *  Every slice's `get` returns the WHOLE state, so a slice may call another slice's action. */
export type StoreSet = StoreApi<EditorState>['setState'];
export type StoreGet = StoreApi<EditorState>['getState'];
export type SliceCreator<K extends keyof EditorState> = (set: StoreSet, get: StoreGet) => Pick<EditorState, K>;

/** A state patch that clears every keyframe-selection kind. Spread into a `set({...})` before
 *  re-setting the one field being selected, so the 7 keyframe selections stay mutually exclusive.
 *  Replaces the 7 hand-written "null the other six" blocks the select actions used to repeat.
 *  INVARIANT: because every select action spreads this first, at most one keyframe-selection field
 *  is ever truthy. @savig/ui-core view-models rely on this — they discriminate on a derived
 *  `keyframe.kind` instead of checking each raw field; keep this mutual exclusivity if you change
 *  the select actions, or those discriminated guards can silently disagree with the raw fields. */
export const NO_KEYFRAME_SELECTION: Pick<
  EditorState,
  | 'selectedKeyframe'
  | 'selectedShapeKeyframe'
  | 'selectedColorKeyframe'
  | 'selectedGradientKeyframe'
  | 'selectedDashKeyframe'
  | 'selectedTrimKeyframe'
  | 'selectedRemapKeyframe'
  | 'selectedProgressKeyframe'
> = {
  selectedKeyframe: null,
  selectedShapeKeyframe: null,
  selectedColorKeyframe: null,
  selectedGradientKeyframe: null,
  selectedDashKeyframe: null,
  selectedTrimKeyframe: null,
  selectedRemapKeyframe: null,
  selectedProgressKeyframe: null,
};

export const PATH_DEFAULT_STYLE: VectorStyle = { fill: 'none', stroke: '#000000', strokeWidth: 2 };

// Per-project UI state reset on newProject/setProject (spread below). Do NOT add the
// persistent preferences (theme/onionSkin/snapEnabled/clipboard) here — they live in the
// create body and must SURVIVE newProject; adding one here would also shadow its initial
// value because this object is spread after them.
// Tools usable INSIDE a symbol in edit mode: select + the geometry-create tools + node + motion
// (each tool's edit actions are now routed to the active scene — author-in-symbol phases). (phase 2/8)
export const SYMBOL_EDIT_TOOLS: ReadonlySet<ToolMode> = new Set([
  'select', 'rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'brush', 'node', 'motion', 'scissors',
]);

export const TRANSIENT_DEFAULTS = {
  binaries: {} as Record<string, Uint8Array>,
  selectedObjectId: null as string | null,
  selectedObjectIds: [] as string[],
  editPath: [] as string[],
  selectedSceneId: null as string | null,
  selectedNodeIndex: null as number | null,
  selectedNodeRing: 0,
  selectedKeyframe: null as KeyframeRef | null,
  selectedShapeKeyframe: null as ShapeKeyframeRef | null,
  selectedColorKeyframe: null as ColorKeyframeRef | null,
  selectedGradientKeyframe: null as GradientKeyframeRef | null,
  selectedDashKeyframe: null as DashKeyframeRef | null,
  selectedTrimKeyframe: null as TrimKeyframeRef | null,
  selectedRemapKeyframe: null as RemapKeyframeRef | null,
  selectedProgressKeyframe: null as ProgressKeyframeRef | null,
  time: 0,
  playing: false,
  autoKey: true,
  zoom: 1,
  pan: { x: 0, y: 0 },
  activeTool: 'select' as ToolMode,
  polygonSides: 5,
  starPoints: 5,
  starInnerRatio: 0.5,
  primitiveCornerRadius: 0,
  brushSize: 4,
  brushSmoothing: 0.5,
  penDrafting: false,
  correspondenceEditing: false,
  cancelPenRequested: 0,
  toasts: [] as Toast[],
};

// ---------------------------------------------------------------------------
// Pure project/scene helpers shared by the slices.
// ---------------------------------------------------------------------------

export function replaceObject(project: Project, next: SceneObject): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === next.id ? next : o)) };
}

/** The active scene's objects[] for a scope: the entered symbol's objects (symbol wins), else the
 *  selected scene's objects (multi-scene), else root project.objects. Read dual of writeSceneObjects. */
export function sceneObjectsOf(project: Project, scope: SceneScope): SceneObject[] {
  if (scope.assetId) {
    const a = project.assets.find((x) => x.id === scope.assetId);
    if (a && a.kind === 'symbol') return a.objects;
  }
  if (scope.sceneId && project.scenes) {
    const sc = project.scenes.find((x) => x.id === scope.sceneId);
    if (sc) return sc.objects;
  }
  return project.objects;
}

/** Apply `map` to the active scene's objects[] in place within the project (symbol > scene > root).
 *  The single write seam; all scene-aware writers compose it. */
function writeSceneObjects(
  project: Project,
  scope: SceneScope,
  map: (objects: SceneObject[]) => SceneObject[],
): Project {
  if (scope.assetId) {
    const a = project.assets.find((x) => x.id === scope.assetId);
    if (a && a.kind === 'symbol') {
      return {
        ...project,
        assets: project.assets.map((x) =>
          x.id === scope.assetId && x.kind === 'symbol' ? { ...x, objects: map(x.objects) } : x,
        ),
      };
    }
  }
  if (scope.sceneId && project.scenes) {
    return {
      ...project,
      scenes: project.scenes.map((sc) => (sc.id === scope.sceneId ? { ...sc, objects: map(sc.objects) } : sc)),
    };
  }
  return { ...project, objects: map(project.objects) };
}

export function withSceneObjects(project: Project, scope: SceneScope, objects: SceneObject[]): Project {
  return writeSceneObjects(project, scope, () => objects);
}

// Append ONE object to the ACTIVE scene (root project.objects, the edited symbol's objects[],
// or the selected scene's objects[] in multi-scene mode). No asset add.
export function appendToScene(project: Project, scope: SceneScope, obj: SceneObject): Project {
  return writeSceneObjects(project, scope, (o) => [...o, obj]);
}

// Replace one object in the ACTIVE scene: root project.objects, the edited symbol's objects[],
// or the selected scene's objects[] in multi-scene mode.
export function replaceObjectInScene(project: Project, scope: SceneScope, next: SceneObject): Project {
  return writeSceneObjects(project, scope, (o) => o.map((x) => (x.id === next.id ? next : x)));
}

// Add a freshly-created asset to the GLOBAL assets[] and its object to the ACTIVE scene (root
// project.objects, or the edited symbol's objects[] when scope.assetId is set). Caller commits +
// sets selection. (author-in-symbol draw, phase 2 — now composes appendToScene)
export function appendObjectToScene(
  project: Project,
  scope: SceneScope,
  asset: Asset,
  obj: SceneObject,
): Project {
  return appendToScene({ ...project, assets: [...project.assets, asset] }, scope, obj);
}

// Top of the stack = above the current max zOrder. Robust to gaps left by deletes
// (object.length would collide with a survivor after a middle object is removed).
export function nextZOrder(objects: SceneObject[]): number {
  return objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
}

// After an undo/redo, drop a selection pointing at an object that no longer exists
// (e.g. undoing a duplicate/add) so the Inspector doesn't show a dangling selection. Scoped to
// the ACTIVE scene (slice 47 edit-mode): in a symbol, selection ids live in the symbol asset's
// objects, not the root — filtering against root would wrongly wipe a still-valid internal
// selection on every undo/redo. Falls back to root when the active asset is missing.
// Also resets selectedSceneId when a restore (undo of promote/scene-delete) leaves it pointing
// at a gone scene (8b-3).
export function clearStaleSelection(
  history: History<Project>,
  editPath: string[],
  selectedSceneId: string | null,
  ids: string[],
): { selectedObjectIds: string[]; selectedObjectId: string | null; selectedSceneId: string | null } {
  const present = history.present;
  const scenes = present.scenes;
  // A restore (undo of promote/scene-delete) may leave selectedSceneId naming a gone scene.
  const nextSceneId = scenes
    ? scenes.some((sc) => sc.id === selectedSceneId)
      ? selectedSceneId
      : scenes[0]?.id ?? null
    : null;
  const scope: SceneScope = { sceneId: nextSceneId, assetId: editPath.at(-1) ?? null };
  const objects = sceneObjectsOf(present, scope);
  const live = ids.filter((id) => objects.some((o) => o.id === id));
  return { selectedObjectIds: live, selectedObjectId: live.at(-1) ?? null, selectedSceneId: nextSceneId };
}

/** Write a transform partial onto an object. A group container with auto-key OFF positions
 *  statically (writes BASE, slice 45b); with auto-key ON it keyframes at the playhead like
 *  any object — an animatable group (slice 45d). The group transform composes onto its
 *  children per frame via the shared computeFrame, so an animated group animates in preview
 *  AND export. Normal objects are already gated on auto-key by the caller (they always
 *  keyframe here). */
export function applyObjectTransform(
  obj: SceneObject,
  partial: Partial<Record<AnimatableProperty, number>>,
  time: number,
  autoKey: boolean,
): SceneObject {
  if (obj.isGroup && !autoKey) return { ...obj, base: { ...obj.base, ...partial } };
  const tracks = { ...obj.tracks };
  for (const [p, v] of Object.entries(partial) as [AnimatableProperty, number][]) {
    tracks[p] = upsertKeyframe(obj.tracks[p] ?? [], createKeyframe(time, v));
  }
  return { ...obj, tracks };
}

/** The selection ENTITY for `id`: the OUTERMOST ancestor group (clicking any descendant
 *  selects the top-level group, Figma-style), else `id` itself (slice 45e). */
export function resolveToEntity(objects: SceneObject[], id: string): string {
  let top = id;
  let cur = objects.find((o) => o.id === id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId); // cycle guard
    const p = objects.find((o) => o.id === cur!.parentId && o.isGroup);
    if (!p) break;
    top = p.id;
    cur = p;
  }
  return top;
}

/** Unique union of each id resolved to its selection entity (group-or-self, order-stable). */
export function expandToGroups(objects: SceneObject[], ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const e = resolveToEntity(objects, id);
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/** Effective-lock cascade over a scene's objects: an object is locked if it OR any ancestor
 *  group is locked (slice lock-cascade). Builds the id map once per call — callers in hot
 *  loops should build the Map themselves and call isLockedInTree directly. */
export function lockedInScene(objects: SceneObject[], obj: SceneObject): boolean {
  return isLockedInTree(obj, new Map(objects.map((o) => [o.id, o])));
}

/** True when `obj` is eligible for the repeater (art-tools #3): a plain leaf, not a group
 *  container and not a symbol instance (mirrors the inspector VM's `isInstance` derivation via
 *  `isSymbolInstance`). Any vector/text/svg leaf qualifies. */
export function canRepeat(obj: SceneObject, assets: Asset[]): boolean {
  return !obj.isGroup && !isSymbolInstance(obj, assets);
}

/** The active scene's artboard dims: the edited symbol's intrinsic width/height in edit mode,
 *  else the root artboard (meta). Lets center/edge-align target the right frame inside a symbol. */
export function activeSceneDims(s: EditorState): { width: number; height: number } {
  const sym = selectActiveSymbolAsset(s);
  if (sym) return { width: sym.width, height: sym.height };
  return { width: s.history.present.meta.width, height: s.history.present.meta.height };
}

/** Gather align/distribute items for the selected MOVABLE objects (locked/hidden excluded
 *  from both the reference bbox and the writes) at the frame-snapped time, then run `fn`.
 *  Sampling at the same snapped time setObjectsTransforms writes to keeps deltas exact. */
export function alignItemsUpdates(
  s: EditorState,
  fn: (items: AlignItem[]) => { id: string; x?: number; y?: number }[],
): { id: string; x?: number; y?: number }[] {
  if (!s.autoKey) return [];
  const project = s.history.present;
  const time = snapToFrame(s.time, project.meta.fps);
  // Read the ACTIVE scene (root objects, or the edited symbol's objects[] in edit mode) so
  // align/distribute work INSIDE a symbol; assets are global. The write path (setObjectsTransforms)
  // is already active-scene-aware.
  const objects = selectActiveObjects(s);
  const lockById = new Map(objects.map((o) => [o.id, o]));
  const items: AlignItem[] = [];
  for (const id of s.selectedObjectIds) {
    const o = objects.find((x) => x.id === id);
    if (!o || isLockedInTree(o, lockById) || o.hidden) continue;
    const a = objectAABB(o, project.assets.find((as) => as.id === o.assetId), time);
    if (!a) continue;
    const st = sampleObject(o, time);
    items.push({ id, aabb: a, x: st.x, y: st.y });
  }
  return fn(items);
}

// The selected object's vector asset, but only when it is a path. Used by the
// node-edit actions, which mutate the path stored on the asset.
export function selectedPathCtx(get: () => EditorState): { obj: SceneObject; asset: VectorAsset } | null {
  const s = get();
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId); // active scene (root or edited symbol)
  if (!obj) return null;
  const asset = s.history.present.assets.find((a) => a.id === obj.assetId); // assets are global
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  return { obj, asset };
}

export type { AABB };
