// Shared store internals: state types, constants, and pure helpers used across the
// store slices (see ./slices/*). Extracted from store.ts so each slice can import the
// helpers without a circular dependency on the composed store. No behavior change.
import type { StoreApi } from 'zustand';
import {
  createKeyframe,
  snapToFrame,
  upsertKeyframe,
  sampleObject,
} from '../../engine';
import { isLockedInTree } from '../../engine';
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
  ReorderOp,
  RotationMode,
  SceneObject,
  SymbolTiming,
  Keyframe,
  ColorKeyframe,
  GradientKeyframe,
  ShapeKeyframe,
  VectorAsset,
  VectorShapeType,
  VectorStyle,
} from '../../engine';
import { objectAABB, type AABB } from '../components/Stage/snapping';
import { type AlignEdge, type DistributeAxis, type AlignItem } from '../components/Stage/align';
import { selectActiveAssetId, selectActiveObjects } from './selectors';

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
  | 'polygon' | 'star' | 'line' | 'brush';

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
  /** Stamp a parametric polygon/star (slice 35). `spec` is in STAGE coords. */
  addPrimitive(spec: PrimitiveSpec): void;
  /** Re-edit a stamped primitive's param (regenerates the path); no-op without a spec. */
  setPrimitiveParam(param: 'sides' | 'points' | 'innerRatio' | 'cornerRadius', value: number): void;
  setPathData(path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void;
  setRingPathData(ring: number, path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void;
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

  // --- transport / view actions ---
  seek(time: number): void;
  setPlaying(playing: boolean): void;
  toggleAutoKey(): void;
  toggleOnionSkin(): void;
  toggleSnap(): void;
  setSnapEnabled(b: boolean): void;
  toggleGrid(): void;
  setGridSize(n: number): void;
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
 *  Replaces the 7 hand-written "null the other six" blocks the select actions used to repeat. */
export const NO_KEYFRAME_SELECTION: Pick<
  EditorState,
  | 'selectedKeyframe'
  | 'selectedShapeKeyframe'
  | 'selectedColorKeyframe'
  | 'selectedGradientKeyframe'
  | 'selectedDashKeyframe'
  | 'selectedRemapKeyframe'
  | 'selectedProgressKeyframe'
> = {
  selectedKeyframe: null,
  selectedShapeKeyframe: null,
  selectedColorKeyframe: null,
  selectedGradientKeyframe: null,
  selectedDashKeyframe: null,
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
  'select', 'rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'brush', 'node', 'motion',
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

// Replace one object in the ACTIVE scene: root project.objects, or the edited symbol's objects[].
// At the root this is exactly replaceObject. (author-in-symbol node-edit, phase 3)
export function replaceObjectInScene(project: Project, activeAssetId: string | null, next: SceneObject): Project {
  if (!activeAssetId) return replaceObject(project, next);
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol'
        ? { ...a, objects: a.objects.map((o) => (o.id === next.id ? next : o)) }
        : a,
    ),
  };
}

// The active scene's objects[] from any project + activeAssetId: root project.objects, or the
// edited symbol's objects[] (missing/non-symbol asset -> root). Read dual of appendToScene.
// (author-in-symbol clipboard, phase 6)
export function sceneObjectsOf(project: Project, activeAssetId: string | null): SceneObject[] {
  if (!activeAssetId) return project.objects;
  const a = project.assets.find((x) => x.id === activeAssetId);
  return a && a.kind === 'symbol' ? a.objects : project.objects;
}

// Append ONE object to the ACTIVE scene (root project.objects, or the edited symbol's objects[]).
// No asset add. (author-in-symbol clipboard, phase 6)
export function appendToScene(project: Project, activeAssetId: string | null, obj: SceneObject): Project {
  if (!activeAssetId) return { ...project, objects: [...project.objects, obj] };
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects: [...a.objects, obj] } : a,
    ),
  };
}

// Add a freshly-created asset to the GLOBAL assets[] and its object to the ACTIVE scene (root
// project.objects, or the edited symbol's objects[] when activeAssetId is set). Caller commits +
// sets selection. (author-in-symbol draw, phase 2 — now composes appendToScene)
export function appendObjectToScene(
  project: Project,
  activeAssetId: string | null,
  asset: Asset,
  obj: SceneObject,
): Project {
  return appendToScene({ ...project, assets: [...project.assets, asset] }, activeAssetId, obj);
}

// Write the active scene's WHOLE objects[] into a project (root project.objects, or the edited
// symbol's objects[]). The array-write dual of sceneObjectsOf. (author-in-symbol group/boolean, phase 7)
export function withSceneObjects(project: Project, activeAssetId: string | null, objects: SceneObject[]): Project {
  if (!activeAssetId) return { ...project, objects };
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects } : a,
    ),
  };
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
export function clearStaleSelection(
  history: History<Project>,
  editPath: string[],
  ids: string[],
): { selectedObjectIds: string[]; selectedObjectId: string | null } {
  const activeId = editPath.at(-1) ?? null;
  const sym = activeId ? history.present.assets.find((a) => a.id === activeId) : undefined;
  const objects = sym && sym.kind === 'symbol' ? sym.objects : history.present.objects;
  const live = ids.filter((id) => objects.some((o) => o.id === id));
  return { selectedObjectIds: live, selectedObjectId: live.at(-1) ?? null };
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

/** The active scene's artboard dims: the edited symbol's intrinsic width/height in edit mode,
 *  else the root artboard (meta). Lets center/edge-align target the right frame inside a symbol. */
export function activeSceneDims(s: EditorState): { width: number; height: number } {
  const aid = selectActiveAssetId(s);
  if (aid) {
    const a = s.history.present.assets.find((x) => x.id === aid);
    if (a && a.kind === 'symbol') return { width: a.width, height: a.height };
  }
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
