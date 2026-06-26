import { create } from 'zustand';
import {
  createProject,
  createHistory,
  pushHistory,
  createSceneObject,
  createGroupObject,
  createSymbolAsset,
  bakeGroupIntoChild,
  unbakeGroupFromChild,
  createVectorAsset,
  duplicateObject,
  collectReferencedAssetIds,
  reorderObjects,
  moveObjectToTarget as moveObjectToTargetPure,
  createKeyframe,
  DEFAULT_TRANSFORM,
  snapToFrame,
  upsertKeyframe,
  removeKeyframeAt,
  sampleObject,
  samplePath,
  upsertShapeKeyframe,
  removeShapeKeyframeAt,
  upsertColorKeyframe,
  removeColorKeyframeAt,
  upsertGradientKeyframe,
  removeGradientKeyframeAt,
  computeProjectDuration,
  newId,
  undo as undoHistory,
  redo as redoHistory,
} from '../../engine';
import { pathBounds, identityCorrespondence, primitivePathFromSpec, booleanOp as booleanOpEngine, ringArea, symbolContains } from '../../engine';
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
import { deleteNodeAt, insertNodeAt, toggleSmooth, joinHandle, spliceNodeEasings, spliceCorrespondence } from '../components/Stage/pathEdit';
import { objectAABB, groupAABB, resolveObjectAnchor, groupBBox, sceneContentAABB, isSymbolInstance } from '../components/Stage/snapping';
import { computeAlign, computeDistribute, type AlignEdge, type DistributeAxis, type AlignItem } from '../components/Stage/align';
import { selectEditablePath, selectEditedShapeKeyframe, selectActiveAssetId, selectActiveObjects } from './selectors';

/** Tolerance for matching a keyframe by time (times are frame-snapped on creation). */
const KF_EPS = 1e-6;
const DUP_OFFSET = 10;

export type Theme = 'dark' | 'light';

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

/** A snapshot of the selected keyframe for the keyframe clipboard (Slice 24). */
export type KeyframeClip =
  | { kind: 'scalar'; objectId: string; property: AnimatableProperty; keyframe: Keyframe }
  | { kind: 'dash'; objectId: string; keyframe: Keyframe }
  | { kind: 'progress'; objectId: string; keyframe: Keyframe }
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
  selectedNodeIndex: number | null;
  selectedKeyframe: KeyframeRef | null;
  selectedShapeKeyframe: ShapeKeyframeRef | null;
  selectedColorKeyframe: ColorKeyframeRef | null;
  selectedGradientKeyframe: GradientKeyframeRef | null;
  selectedDashKeyframe: DashKeyframeRef | null;
  selectedProgressKeyframe: ProgressKeyframeRef | null;
  time: number;
  playing: boolean;
  autoKey: boolean;
  onionSkin: boolean;
  snapEnabled: boolean;
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
  addMotionPath(objectId: string, path: PathData): void;
  removeMotionPath(objectId: string): void;
  setMotionPathOrient(objectId: string, orient: boolean): void;
  setMotionProgress(value: number): void;
  selectProgressKeyframe(ref: ProgressKeyframeRef | null): void;
  removeSelectedProgressKeyframe(): void;
  deleteSelectedNode(): void;
  insertNode(segmentIndex: number, t: number): void;
  toggleSelectedNodeSmooth(): void;
  joinSelectedNode(): void;
  breakSelectedNode(): void;
  selectNode(index: number | null): void;
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
  /** Repoint a symbol instance at a different symbol, preserving its transform (slice 47d). */
  swapSymbol(instanceId: string, newSymId: string): void;
  /** Boolean path ops (slice 46): combine the selected vector shapes into one (possibly
   *  compound/holed) path object, destructively replacing the sources. */
  booleanOp(op: BoolOp): void;
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

const PATH_DEFAULT_STYLE: VectorStyle = { fill: 'none', stroke: '#000000', strokeWidth: 2 };

// Per-project UI state reset on newProject/setProject (spread below). Do NOT add the
// persistent preferences (theme/onionSkin/snapEnabled/clipboard) here — they live in the
// create body and must SURVIVE newProject; adding one here would also shadow its initial
// value because this object is spread after them.
const TRANSIENT_DEFAULTS = {
  binaries: {} as Record<string, Uint8Array>,
  selectedObjectId: null as string | null,
  selectedObjectIds: [] as string[],
  editPath: [] as string[],
  selectedNodeIndex: null as number | null,
  selectedKeyframe: null as KeyframeRef | null,
  selectedShapeKeyframe: null as ShapeKeyframeRef | null,
  selectedColorKeyframe: null as ColorKeyframeRef | null,
  selectedGradientKeyframe: null as GradientKeyframeRef | null,
  selectedDashKeyframe: null as DashKeyframeRef | null,
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

function replaceObject(project: Project, next: SceneObject): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === next.id ? next : o)) };
}

// Top of the stack = above the current max zOrder. Robust to gaps left by deletes
// (object.length would collide with a survivor after a middle object is removed).
function nextZOrder(objects: SceneObject[]): number {
  return objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
}

// After an undo/redo, drop a selection pointing at an object that no longer exists
// (e.g. undoing a duplicate/add) so the Inspector doesn't show a dangling selection. Scoped to
// the ACTIVE scene (slice 47 edit-mode): in a symbol, selection ids live in the symbol asset's
// objects, not the root — filtering against root would wrongly wipe a still-valid internal
// selection on every undo/redo. Falls back to root when the active asset is missing.
function clearStaleSelection(
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
function applyObjectTransform(
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
function resolveToEntity(objects: SceneObject[], id: string): string {
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
function expandToGroups(objects: SceneObject[], ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const e = resolveToEntity(objects, id);
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/** Gather align/distribute items for the selected MOVABLE objects (locked/hidden excluded
 *  from both the reference bbox and the writes) at the frame-snapped time, then run `fn`.
 *  Sampling at the same snapped time setObjectsTransforms writes to keeps deltas exact. */
function alignItemsUpdates(
  s: EditorState,
  fn: (items: AlignItem[]) => { id: string; x?: number; y?: number }[],
): { id: string; x?: number; y?: number }[] {
  if (!s.autoKey) return [];
  const project = s.history.present;
  const time = snapToFrame(s.time, project.meta.fps);
  const items: AlignItem[] = [];
  for (const id of s.selectedObjectIds) {
    const o = project.objects.find((x) => x.id === id);
    if (!o || o.locked || o.hidden) continue;
    const a = objectAABB(o, project.assets.find((as) => as.id === o.assetId), time);
    if (!a) continue;
    const st = sampleObject(o, time);
    items.push({ id, aabb: a, x: st.x, y: st.y });
  }
  return fn(items);
}

// The selected object's vector asset, but only when it is a path. Used by the
// node-edit actions, which mutate the path stored on the asset.
function selectedPathCtx(get: () => EditorState): { obj: SceneObject; asset: VectorAsset } | null {
  const s = get();
  const project = s.history.present;
  const obj = project.objects.find((o) => o.id === s.selectedObjectId);
  if (!obj) return null;
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  return { obj, asset };
}

export const useEditor = create<EditorState>((set, get) => ({
  history: createHistory(createProject()),
  theme: 'dark',
  // A persistent view preference (like theme) — survives newProject/setProject.
  onionSkin: false,
  // Snapping is a persistent editing preference — survives newProject too.
  snapEnabled: true,
  // The object clipboard also survives newProject (enables cross-project paste). A LIST
  // (slice 39): null or a non-empty array of {object, asset} snapshots.
  clipboard: null as { object: SceneObject; asset?: Asset }[] | null,
  // The keyframe clipboard also survives newProject (mutually exclusive with `clipboard`).
  keyframeClipboard: null as KeyframeClip | null,
  ...TRANSIENT_DEFAULTS,

  setProject(project, binaries = {}) {
    set({ history: createHistory(project), ...TRANSIENT_DEFAULTS, binaries });
  },
  newProject() {
    set({ history: createHistory(createProject()), ...TRANSIENT_DEFAULTS });
  },
  enterSymbol(assetId) {
    const a = get().history.present.assets.find((x) => x.id === assetId);
    if (!a || a.kind !== 'symbol') return; // only symbols are editable scenes
    set({ editPath: [...get().editPath, assetId], activeTool: 'select' });
    get().selectObject(null); // selection ids are scene-local
  },
  exitSymbol() {
    if (get().editPath.length === 0) return;
    set({ editPath: get().editPath.slice(0, -1) });
    get().selectObject(null);
  },
  exitToDepth(depth) {
    if (depth < 0 || depth >= get().editPath.length) return;
    set({ editPath: get().editPath.slice(0, depth) });
    get().selectObject(null);
  },
  commitActiveScene(nextObjects) {
    const s = get();
    const id = selectActiveAssetId(s);
    const project = s.history.present;
    if (!id) {
      get().commit({ ...project, objects: nextObjects });
      return;
    }
    const assets = project.assets.map((a) =>
      a.id === id && a.kind === 'symbol' ? { ...a, objects: nextObjects } : a,
    );
    get().commit({ ...project, assets });
  },
  commit(next) {
    set({ history: pushHistory(get().history, next) });
  },
  undo() {
    const history = undoHistory(get().history);
    set({ history, ...clearStaleSelection(history, get().editPath, get().selectedObjectIds) });
  },
  redo() {
    const history = redoHistory(get().history);
    set({ history, ...clearStaleSelection(history, get().editPath, get().selectedObjectIds) });
  },

  addAsset(asset, bytes) {
    const project = get().history.present;
    if (!project.assets.some((a) => a.id === asset.id)) {
      get().commit({ ...project, assets: [...project.assets, asset] });
    }
    if (bytes) set({ binaries: { ...get().binaries, [asset.id]: bytes } });
  },
  addObject(assetId) {
    const project = get().history.present;
    const asset = project.assets.find((a) => a.id === assetId);
    const anchorX = asset && asset.kind === 'svg' ? asset.width / 2 : 0;
    const anchorY = asset && asset.kind === 'svg' ? asset.height / 2 : 0;
    const obj = createSceneObject(assetId, {
      name: `${asset?.name ?? 'Object'} ${nextZOrder(project.objects) + 1}`,
      zOrder: nextZOrder(project.objects),
      anchorX,
      anchorY,
    });
    get().commit({ ...project, objects: [...project.objects, obj] });
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null });
  },
  duplicateSelected() {
    let project = get().history.present;
    // Bulk: duplicate every selected non-locked object in one commit (slice 36).
    const sources = get()
      .selectedObjectIds.map((id) => project.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked);
    if (sources.length === 0) return;
    const cloneIds: string[] = [];
    for (const obj of sources) {
      const asset = project.assets.find((a) => a.id === obj.assetId);
      const { object, clonedAsset } = duplicateObject(obj, asset, { objectId: newId(), assetId: newId() }, DUP_OFFSET);
      const placed = { ...object, zOrder: nextZOrder(project.objects) };
      project = {
        ...project,
        assets: clonedAsset ? [...project.assets, clonedAsset] : project.assets,
        objects: [...project.objects, placed],
      };
      cloneIds.push(placed.id);
    }
    get().commit(project);
    get().selectObjects(cloneIds);
  },
  copySelected() {
    const s = get();
    const project = s.history.present;
    // Snapshot EVERY selected object (+ its asset), zOrder-sorted for stable paste
    // stacking (slice 39). Immutable snapshots; clears the keyframe clipboard.
    const entries = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o)
      .sort((x, y) => x.zOrder - y.zOrder)
      .map((obj) => ({ object: obj, asset: project.assets.find((a) => a.id === obj.assetId) }));
    if (entries.length === 0) return; // nothing selected -> leave the clipboard untouched
    set({ clipboard: entries, keyframeClipboard: null });
  },
  cut() {
    get().copySelected();
    get().deleteSelectedObject(); // both bulk; cutting a locked member copies but does not remove it
  },
  paste() {
    const clip = get().clipboard;
    if (!clip || clip.length === 0) return;
    let project = get().history.present;
    const selectIds: string[] = [];
    for (const entry of clip) {
      const { object, clonedAsset } = duplicateObject(entry.object, entry.asset, { objectId: newId(), assetId: newId() }, DUP_OFFSET);
      const placed = { ...object, zOrder: nextZOrder(project.objects) };
      // Ensure the referenced asset exists: clonedAsset for a vector asset; otherwise
      // re-add the clipboard's shared/svg asset if the project no longer has it (cross-project paste).
      let assets = project.assets;
      if (clonedAsset) assets = [...assets, clonedAsset];
      else if (entry.asset && !assets.some((a) => a.id === placed.assetId)) assets = [...assets, entry.asset];
      project = { ...project, assets, objects: [...project.objects, placed] };
      if (!placed.locked) selectIds.push(placed.id); // don't select a locked clone (Slice-19)
    }
    get().commit(project);
    get().selectObjects(selectIds);
  },
  copyKeyframe() {
    const s = get();
    const p = s.history.present;
    const kfSelected =
      s.selectedKeyframe ||
      s.selectedShapeKeyframe ||
      s.selectedColorKeyframe ||
      s.selectedGradientKeyframe ||
      s.selectedDashKeyframe ||
      s.selectedProgressKeyframe;
    if (!kfSelected) return; // nothing selected -> don't touch either clipboard
    // A keyframe copy always clears the object clipboard (mutual exclusion). Reset the
    // keyframe clipboard too: a stale/unresolvable ref leaves it null -> paste is a no-op.
    set({ clipboard: null, keyframeClipboard: null });
    const find = <K extends { time: number }>(track: K[] | undefined, time: number) =>
      track?.find((k) => Math.abs(k.time - time) < KF_EPS);
    if (s.selectedKeyframe) {
      const r = s.selectedKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.tracks[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'scalar', objectId: r.objectId, property: r.property, keyframe: kf } });
      return;
    }
    if (s.selectedShapeKeyframe) {
      const r = s.selectedShapeKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.shapeTrack, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'shape', objectId: r.objectId, keyframe: kf } });
      return;
    }
    if (s.selectedColorKeyframe) {
      const r = s.selectedColorKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.colorTracks?.[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'color', objectId: r.objectId, property: r.property, keyframe: kf } });
      return;
    }
    if (s.selectedGradientKeyframe) {
      const r = s.selectedGradientKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.gradientTracks?.[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'gradient', objectId: r.objectId, property: r.property, keyframe: kf } });
      return;
    }
    if (s.selectedDashKeyframe) {
      const r = s.selectedDashKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.dashOffsetTrack, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'dash', objectId: r.objectId, keyframe: kf } });
      return;
    }
    if (s.selectedProgressKeyframe) {
      const r = s.selectedProgressKeyframe;
      const kf = find(p.objects.find((o) => o.id === r.objectId)?.motionPath?.progress, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'progress', objectId: r.objectId, keyframe: kf } });
      return;
    }
  },
  pasteKeyframe() {
    const clip = get().keyframeClipboard;
    if (!clip) return;
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === clip.objectId);
    if (!obj) return;
    const time = snapToFrame(get().time, project.meta.fps);
    switch (clip.kind) {
      case 'scalar': {
        const next = upsertKeyframe(obj.tracks[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [clip.property]: next } }));
        get().selectKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'dash': {
        const next = upsertKeyframe(obj.dashOffsetTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
        get().selectDashKeyframe({ objectId: obj.id, time });
        return;
      }
      case 'progress': {
        if (!obj.motionPath) return;
        const next = upsertKeyframe(obj.motionPath.progress, { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress: next } }));
        get().selectProgressKeyframe({ objectId: obj.id, time });
        return;
      }
      case 'color': {
        const next = upsertColorKeyframe(obj.colorTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [clip.property]: next } }));
        get().selectColorKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'gradient': {
        const next = upsertGradientKeyframe(obj.gradientTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, gradientTracks: { ...obj.gradientTracks, [clip.property]: next } }));
        get().selectGradientKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'shape': {
        const next = upsertShapeKeyframe(obj.shapeTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, shapeTrack: next }));
        get().selectShapeKeyframe({ objectId: obj.id, time });
        return;
      }
    }
  },
  deleteSelectedKeyframe() {
    const s = get();
    if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
    else if (s.selectedGradientKeyframe) s.removeSelectedGradientKeyframe();
    else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
    else if (s.selectedDashKeyframe) s.removeSelectedDashKeyframe();
    else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
    else if (s.selectedKeyframe) s.removeSelectedKeyframe();
  },
  cutKeyframe() {
    get().copyKeyframe(); // snapshot into keyframeClipboard (S24); no commit
    get().deleteSelectedKeyframe(); // then remove it (one commit)
  },
  retimeSelectedKeyframe(newTime) {
    const s = get();
    const project = s.history.present;
    const t = Math.max(0, snapToFrame(newTime, project.meta.fps));
    const find = <K extends { time: number }>(track: K[] | undefined, time: number) =>
      track?.find((k) => Math.abs(k.time - time) < KF_EPS);
    if (s.selectedKeyframe) {
      const r = s.selectedKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const track = obj && obj.tracks[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [r.property]: next } }));
      get().selectKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedShapeKeyframe) {
      const r = s.selectedShapeKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const kf = find(obj?.shapeTrack, r.time);
      if (!obj || !obj.shapeTrack || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertShapeKeyframe(obj.shapeTrack.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, shapeTrack: next }));
      get().selectShapeKeyframe({ objectId: obj.id, time: t });
      return;
    }
    if (s.selectedColorKeyframe) {
      const r = s.selectedColorKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const track = obj?.colorTracks?.[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertColorKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [r.property]: next } }));
      get().selectColorKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedGradientKeyframe) {
      const r = s.selectedGradientKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const track = obj?.gradientTracks?.[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertGradientKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, gradientTracks: { ...obj.gradientTracks, [r.property]: next } }));
      get().selectGradientKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedDashKeyframe) {
      const r = s.selectedDashKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const kf = find(obj?.dashOffsetTrack, r.time);
      if (!obj || !obj.dashOffsetTrack || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(obj.dashOffsetTrack.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
      get().selectDashKeyframe({ objectId: obj.id, time: t });
      return;
    }
    if (s.selectedProgressKeyframe) {
      const r = s.selectedProgressKeyframe;
      const obj = project.objects.find((o) => o.id === r.objectId);
      const kf = find(obj?.motionPath?.progress, r.time);
      if (!obj || !obj.motionPath || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(obj.motionPath.progress.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress: next } }));
      get().selectProgressKeyframe({ objectId: obj.id, time: t });
      return;
    }
  },
  deleteSelectedObject() {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s); // root, or the edited symbol's scene (47-edit)
    const activeId = selectActiveAssetId(s);
    // Selected, non-locked ids that live in the ACTIVE scene (slice 36 bulk).
    const ids = s.selectedObjectIds.filter((id) => {
      const o = objects.find((x) => x.id === id);
      return !!o && !o.locked;
    });
    if (ids.length === 0) return;
    // Cascade: deleting a group CONTAINER removes its whole subtree (recursively for NESTED groups,
    // 45e) so descendants aren't orphaned with a dangling parentId.
    const toDelete = new Set(ids);
    for (let changed = true; changed; ) {
      changed = false;
      for (const o of objects) {
        if (o.parentId && toDelete.has(o.parentId) && !toDelete.has(o.id)) {
          toDelete.add(o.id);
          changed = true;
        }
      }
    }
    const candidateAssetIds = new Set<string>();
    for (const o of objects) if (toDelete.has(o.id) && o.assetId) candidateAssetIds.add(o.assetId);
    const nextObjects = objects.filter((o) => !toDelete.has(o.id));
    if (nextObjects.length === objects.length) return; // nothing removed -> no commit
    // Write the active scene back (root project.objects, or the edited symbol asset).
    let nextProject = activeId
      ? {
          ...project,
          assets: project.assets.map((a) =>
            a.id === activeId && a.kind === 'symbol' ? { ...a, objects: nextObjects } : a,
          ),
        }
      : { ...project, objects: nextObjects };
    // Cross-scene, symbol-preserving prune: drop a deleted object's vector/svg asset only when it
    // is referenced nowhere in the post-delete project; never prune symbol (library) / audio assets.
    const referenced = collectReferencedAssetIds(nextProject);
    const prunedAssets = nextProject.assets.filter((a) => {
      if (!candidateAssetIds.has(a.id)) return true;
      if (a.kind === 'symbol' || a.kind === 'audio') return true;
      return referenced.has(a.id);
    });
    nextProject = { ...nextProject, assets: prunedAssets };
    get().commit(nextProject);
    get().selectObject(null);
  },
  reorderSelected(op) {
    const id = get().selectedObjectId;
    if (id == null) return;
    const project = get().history.present;
    const objects = reorderObjects(project.objects, id, op);
    if (objects === project.objects) return; // no-op -> no commit
    get().commit({ ...project, objects });
  },
  moveObjectToTarget(draggedId, targetId) {
    const project = get().history.present;
    const objects = moveObjectToTargetPure(project.objects, draggedId, targetId);
    if (objects === project.objects) return; // no-op -> no commit
    get().commit({ ...project, objects });
  },
  toggleObjectVisibility(id) {
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === id);
    if (!obj) return;
    get().commit(replaceObject(project, { ...obj, hidden: !obj.hidden }));
  },
  toggleObjectLock(id) {
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === id);
    if (!obj) return; // unknown id -> no-op
    const locking = !obj.locked;
    get().commit(replaceObject(project, { ...obj, locked: locking }));
    // Drop a freshly-locked object from the selection (it can't be edited/deleted).
    if (locking && get().selectedObjectIds.includes(id)) {
      const next = get().selectedObjectIds.filter((x) => x !== id);
      set({ selectedObjectIds: next, selectedObjectId: next.at(-1) ?? null });
    }
  },
  renameObject(id, name) {
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === id);
    if (!obj || obj.name === name) return; // unknown / unchanged -> no-op
    get().commit(replaceObject(project, { ...obj, name }));
  },
  addVectorShape(shapeType, bounds) {
    const project = get().history.present;
    const asset = createVectorAsset(shapeType);
    const shapeBase =
      shapeType === 'ellipse'
        ? { radiusX: bounds.width / 2, radiusY: bounds.height / 2 }
        : { width: bounds.width, height: bounds.height };
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(project.objects) + 1}`,
      zOrder: nextZOrder(project.objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: bounds.x, y: bounds.y },
      shapeBase,
    });
    get().commit({
      ...project,
      assets: [...project.assets, asset],
      objects: [...project.objects, obj],
    });
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, activeTool: 'select' });
  },
  addVectorPath(path, styleSeed) {
    if (path.nodes.length < 2) return;
    const project = get().history.present;
    const box = pathBounds(path);
    // Normalize so the bbox top-left sits at local origin; the object transform places it.
    const normalized: PathData = {
      closed: path.closed,
      nodes: path.nodes.map((n) => ({
        anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
        ...(n.in ? { in: n.in } : {}),
        ...(n.out ? { out: n.out } : {}),
      })),
    };
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE, ...styleSeed } });
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(project.objects) + 1}`,
      zOrder: nextZOrder(project.objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
    });
    get().commit({
      ...project,
      assets: [...project.assets, asset],
      objects: [...project.objects, obj],
    });
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null, activeTool: 'node' });
  },
  addPrimitive(spec) {
    const project = get().history.present;
    const path = primitivePathFromSpec(spec); // stage frame
    if (path.nodes.length < 2) return;
    const box = pathBounds(path);
    // Normalize like addVectorPath; store the spec in the SAME local frame so a later
    // re-edit regenerates around the same centre (base + (cx,cy) stays put).
    const normalized: PathData = {
      closed: path.closed,
      nodes: path.nodes.map((n) => ({
        anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
        ...(n.in ? { in: n.in } : {}),
        ...(n.out ? { out: n.out } : {}),
      })),
    };
    const local: PrimitiveSpec = { ...spec, cx: spec.cx - box.x, cy: spec.cy - box.y };
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE }, primitive: local });
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(project.objects) + 1}`,
      zOrder: nextZOrder(project.objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
    });
    get().commit({ ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] });
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null, activeTool: 'node' });
  },
  setPrimitiveParam(param, value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    const asset = obj ? project.assets.find((a) => a.id === obj.assetId) : undefined;
    if (!asset || asset.kind !== 'vector' || !asset.primitive) return;
    // Guard kind-specific params so a mismatched call can't write a stale field
    // (e.g. 'sides' onto a star). cornerRadius applies to both kinds.
    if (param === 'sides' && asset.primitive.kind !== 'polygon') return;
    if ((param === 'points' || param === 'innerRatio') && asset.primitive.kind !== 'star') return;
    const clamped =
      param === 'sides'
        ? Math.max(3, Math.floor(value))
        : param === 'points'
          ? Math.max(2, Math.floor(value))
          : param === 'innerRatio'
            ? Math.min(0.99, Math.max(0.01, value))
            : Math.max(0, value); // cornerRadius
    const next: PrimitiveSpec = { ...asset.primitive, [param]: clamped };
    const nextAsset: VectorAsset = { ...asset, primitive: next, path: primitivePathFromSpec(next) };
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? nextAsset : a)) });
  },
  setPathData(path, structural) {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj, asset } = ctx;
    // Route to a shape keyframe at the playhead once a morph track exists; otherwise
    // edit the static base (Slice 2 behavior). "Add shape keyframe" is the opt-in.
    if (obj.shapeTrack && obj.shapeTrack.length > 0) {
      const time = snapToFrame(s.time, project.meta.fps);
      const existing = obj.shapeTrack.find((k) => Math.abs(k.time - time) < KF_EPS);
      // Preserve the existing keyframe's fields; only replace the path (and realign
      // nodeEasings on a structural count change). New keyframes default to linear.
      const nodeEasings = structural
        ? spliceNodeEasings(existing?.nodeEasings, structural.index, structural.op)
        : existing?.nodeEasings;
      const correspondence = structural
        ? spliceCorrespondence(existing?.correspondence, structural.index, structural.op)
        : existing?.correspondence;
      const merged: ShapeKeyframe = existing
        ? { ...existing, path, nodeEasings, correspondence }
        : { time, path, easing: 'linear' };
      const shapeTrack = upsertShapeKeyframe(obj.shapeTrack, merged);
      get().commit(replaceObject(project, { ...obj, shapeTrack }));
    } else {
      // A node edit detaches any parametric primitive spec — it becomes a free path.
      const next = { ...asset, path, primitive: undefined };
      get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
    }
  },
  addShapeKeyframe() {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj } = ctx;
    const time = snapToFrame(s.time, project.meta.fps);
    // Seed from the shape currently shown/edited (shared resolver), so the keyframe
    // captures exactly what the overlay displays.
    const current = selectEditablePath(s) ?? { nodes: [], closed: false };
    const shapeTrack = upsertShapeKeyframe(obj.shapeTrack ?? [], { time, path: current, easing: 'linear' });
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
  removeShapeKeyframe() {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj, asset } = ctx;
    const track = obj.shapeTrack;
    if (!track || track.length === 0) return;
    const time =
      s.selectedShapeKeyframe && s.selectedShapeKeyframe.objectId === obj.id
        ? s.selectedShapeKeyframe.time
        : snapToFrame(s.time, project.meta.fps);
    const remaining = removeShapeKeyframeAt(track, time);
    if (remaining.length === track.length) {
      // Nothing at that time (e.g. a stale selection after undo) — clear it so the
      // timeline stops highlighting a keyframe that no longer matches.
      if (s.selectedShapeKeyframe) set({ selectedShapeKeyframe: null });
      return;
    }
    if (remaining.length === 0) {
      // Write the currently-shown shape back into the base so it does not jump.
      const snapshot = samplePath(track, time);
      const nextAsset = { ...asset, path: snapshot };
      get().commit({
        ...project,
        assets: project.assets.map((a) => (a.id === asset.id ? nextAsset : a)),
        objects: project.objects.map((o) => (o.id === obj.id ? { ...obj, shapeTrack: undefined } : o)),
      });
    } else {
      get().commit(replaceObject(project, { ...obj, shapeTrack: remaining }));
    }
    set({ selectedShapeKeyframe: null });
  },
  removeSelectedColorKeyframe() {
    const s = get();
    const ref = s.selectedColorKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    const track = obj?.colorTracks?.[ref.property];
    if (!obj || !track) return;
    const next = removeColorKeyframeAt(track, ref.time);
    get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [ref.property]: next } }));
    set({ selectedColorKeyframe: null });
  },
  selectGradientKeyframe(ref) {
    set({
      selectedGradientKeyframe: ref,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedColorKeyframe: null,
      selectedDashKeyframe: null,
      selectedProgressKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  removeSelectedGradientKeyframe() {
    const s = get();
    const ref = s.selectedGradientKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    const track = obj?.gradientTracks?.[ref.property];
    if (!obj || !track) return;
    const next = removeGradientKeyframeAt(track, ref.time);
    // Collapse an emptied track to absent so the static gradient takes over again
    // (matches setVectorGradient's clear-both branch and the spec's track-absence rule).
    const gradientTracks = { ...obj.gradientTracks, [ref.property]: next };
    if (next.length === 0) delete gradientTracks[ref.property];
    get().commit(
      replaceObject(project, {
        ...obj,
        gradientTracks: Object.keys(gradientTracks).length > 0 ? gradientTracks : undefined,
      }),
    );
    set({ selectedGradientKeyframe: null });
  },
  setStrokeDasharray(dasharray) {
    if (dasharray !== undefined) {
      get().setVectorStyle({ strokeDasharray: dasharray });
      return;
    }
    // Clearing the dash also clears the (now-meaningless) offset animation, so an
    // orphan dashOffsetTrack can't keep inflating computeProjectDuration.
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const nextAssets = project.assets.map((a) =>
      a.id === asset.id ? { ...asset, style: { ...asset.style, strokeDasharray: undefined } } : a,
    );
    get().commit({
      ...project,
      assets: nextAssets,
      objects: project.objects.map((o) => (o.id === obj.id ? { ...o, dashOffsetTrack: undefined } : o)),
    });
    set({ selectedDashKeyframe: null });
  },
  setStrokeDashoffset(value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    if (!s.autoKey) {
      get().setVectorStyle({ strokeDashoffset: value });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const existing = obj.dashOffsetTrack ?? [];
    // Preserve an existing keyframe's easing so editing the offset doesn't reset it.
    const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
    const next = upsertKeyframe(existing, createKeyframe(time, value, { easing: priorEasing }));
    get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
  },
  drawOn() {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const t0 = snapToFrame(s.time, project.meta.fps);
    const t1 = snapToFrame(s.time + 1, project.meta.fps);
    // Atomic: dasharray on the asset + the 1->0 offset track on the object.
    const nextAssets = project.assets.map((a) =>
      a.id === asset.id ? { ...asset, style: { ...asset.style, strokeDasharray: [1, 1] } } : a,
    );
    const dashOffsetTrack = [createKeyframe(t0, 1), createKeyframe(t1, 0)];
    get().commit({
      ...project,
      assets: nextAssets,
      objects: project.objects.map((o) => (o.id === obj.id ? { ...o, dashOffsetTrack } : o)),
    });
  },
  selectDashKeyframe(ref) {
    set({
      selectedDashKeyframe: ref,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedColorKeyframe: null,
      selectedGradientKeyframe: null,
      selectedProgressKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  removeSelectedDashKeyframe() {
    const s = get();
    const ref = s.selectedDashKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.dashOffsetTrack) return;
    const next = removeKeyframeAt(obj.dashOffsetTrack, ref.time);
    get().commit(
      replaceObject(project, { ...obj, dashOffsetTrack: next.length > 0 ? next : undefined }),
    );
    set({ selectedDashKeyframe: null });
  },
  addMotionPath(objectId, path) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj) return;
    const t0 = snapToFrame(s.time, project.meta.fps);
    const t1 = snapToFrame(s.time + 1, project.meta.fps);
    const progress = [createKeyframe(t0, 0), createKeyframe(t1, 1)];
    get().commit(replaceObject(project, { ...obj, motionPath: { path, orient: false, progress } }));
  },
  removeMotionPath(objectId) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObject(project, { ...obj, motionPath: undefined }));
  },
  setMotionPathOrient(objectId, orient) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, orient } }));
  },
  setMotionProgress(value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj?.motionPath || !s.autoKey) return;
    const time = snapToFrame(s.time, project.meta.fps);
    const progress = upsertKeyframe(obj.motionPath.progress, createKeyframe(time, value));
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress } }));
  },
  selectProgressKeyframe(ref) {
    set({
      selectedProgressKeyframe: ref,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedColorKeyframe: null,
      selectedGradientKeyframe: null,
      selectedDashKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  removeSelectedProgressKeyframe() {
    const s = get();
    const ref = s.selectedProgressKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.motionPath) return;
    const progress = removeKeyframeAt(obj.motionPath.progress, ref.time);
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress } }));
    set({ selectedProgressKeyframe: null });
  },
  selectShapeKeyframe(ref) {
    set({
      selectedShapeKeyframe: ref,
      selectedKeyframe: null,
      selectedColorKeyframe: null,
      selectedGradientKeyframe: null,
      selectedDashKeyframe: null,
      selectedProgressKeyframe: null,
      // Selecting a keyframe focuses its object; clear any stale node selection
      // (consistent with selectObject), since it may belong to a different object.
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId], selectedNodeIndex: null } : {}),
    });
  },
  selectColorKeyframe(ref) {
    set({
      selectedColorKeyframe: ref,
      selectedGradientKeyframe: null,
      selectedDashKeyframe: null,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedProgressKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  deleteSelectedNode() {
    const s = get();
    const idx = s.selectedNodeIndex;
    if (idx == null) return;
    const path = selectEditablePath(s);
    if (!path) return;
    const next = deleteNodeAt(path, idx);
    if (next === path) return; // 2-node floor: nothing removed -> don't desync nodeEasings or commit a no-op
    s.setPathData(next, { index: idx, op: 'delete' });
    set({ selectedNodeIndex: null });
  },
  insertNode(segmentIndex, t) {
    const s = get();
    const path = selectEditablePath(s);
    if (!path) return;
    s.setPathData(insertNodeAt(path, segmentIndex, t), { index: segmentIndex + 1, op: 'insert' });
    set({ selectedNodeIndex: segmentIndex + 1 });
  },
  toggleSelectedNodeSmooth() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const path = selectEditablePath(s);
    if (!path) return;
    s.setPathData(toggleSmooth(path, s.selectedNodeIndex));
  },
  joinSelectedNode() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const path = selectEditablePath(s);
    if (!path) return;
    s.setPathData(joinHandle(path, s.selectedNodeIndex));
  },
  breakSelectedNode() {
    // Handles are independent in the data model; "break" makes future handle drags
    // non-mirrored. The mirror choice is decided at drag time by handle collinearity
    // (see usePathTools), so no path mutation is needed here.
  },
  selectNode(index) {
    set({ selectedNodeIndex: index });
  },
  selectObject(id) {
    set({ selectedObjectId: id, selectedObjectIds: id ? [id] : [], selectedKeyframe: null, selectedShapeKeyframe: null, selectedColorKeyframe: null, selectedGradientKeyframe: null, selectedDashKeyframe: null, selectedProgressKeyframe: null, selectedNodeIndex: null });
  },
  toggleObjectSelection(id) {
    const ids = get().selectedObjectIds;
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    set({ selectedObjectIds: next, selectedObjectId: next.at(-1) ?? null, selectedKeyframe: null, selectedShapeKeyframe: null, selectedColorKeyframe: null, selectedGradientKeyframe: null, selectedDashKeyframe: null, selectedProgressKeyframe: null, selectedNodeIndex: null });
  },
  selectObjects(ids) {
    set({ selectedObjectIds: [...ids], selectedObjectId: ids.at(-1) ?? null, selectedKeyframe: null, selectedShapeKeyframe: null, selectedColorKeyframe: null, selectedGradientKeyframe: null, selectedDashKeyframe: null, selectedProgressKeyframe: null, selectedNodeIndex: null });
  },
  groupSelected() {
    const s = get();
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
    // Group the selected TOP-LEVEL non-locked objects (incl. top-level GROUPS — nesting, 45e)
    // into a new container. Exclude objects already in a group (`parentId`) — only top-level
    // entities are grouped, so no cycle. The group's anchor = the selection bbox centre.
    const targets = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked && !o.parentId);
    if (targets.length < 2) return;
    const boxes = targets
      .map((o) =>
        o.isGroup
          ? groupAABB(o, project.objects, project.assets, time)
          : objectAABB(o, project.assets.find((a) => a.id === o.assetId), time),
      )
      .filter((b): b is NonNullable<typeof b> => !!b);
    const bb = groupBBox(boxes);
    const cx = bb ? (bb.minX + bb.maxX) / 2 : 0;
    const cy = bb ? (bb.minY + bb.maxY) / 2 : 0;
    const gid = newId();
    const group = createGroupObject({ id: gid, anchorX: cx, anchorY: cy, zOrder: Math.max(...targets.map((o) => o.zOrder)) + 1 });
    const ids = new Set(targets.map((o) => o.id));
    const objects = [...project.objects.map((o) => (ids.has(o.id) ? { ...o, parentId: gid } : o)), group];
    get().commit({ ...project, objects });
    get().selectObject(gid);
  },
  ungroupSelected() {
    const s = get();
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
    const groups = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o?.isGroup);
    if (groups.length === 0) return;
    const groupIds = new Set(groups.map((g) => g.id));
    const freed: string[] = [];
    const objects = project.objects
      .map((o) => {
        if (!o.parentId || !groupIds.has(o.parentId)) return o;
        const group = groups.find((g) => g.id === o.parentId)!;
        const r = resolveObjectAnchor(o, project.assets.find((a) => a.id === o.assetId), sampleObject(o, time));
        if (!groupIds.has(o.id)) freed.push(o.id); // select the surviving freed children (incl. a surviving child group); skip only the dissolved groups removed below
        // Bake the group's transform into the child, then REPARENT to the first SURVIVING
        // ancestor (skip any ancestor groups also being dissolved in this call), so ungrouping
        // nested groups at once never leaves a dangling parentId (45e).
        let survivorParent = group.parentId;
        const seen = new Set<string>();
        while (survivorParent && groupIds.has(survivorParent) && !seen.has(survivorParent)) {
          seen.add(survivorParent);
          survivorParent = groups.find((g) => g.id === survivorParent)?.parentId;
        }
        return { ...bakeGroupIntoChild(group, o, r ? r.anchorX : o.anchorX, r ? r.anchorY : o.anchorY), parentId: survivorParent };
      })
      .filter((o) => !groupIds.has(o.id)); // remove the dissolved group containers
    get().commit({ ...project, objects });
    get().selectObjects(freed);
  },
  createSymbol() {
    const s = get();
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
    // Selected top-level, non-locked objects (groups allowed as members, like grouping).
    const targets = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked && !o.parentId);
    if (targets.length < 1) return;
    const ids = new Set(targets.map((o) => o.id));
    // Pull in the members' group DESCENDANTS (a grouped member carries its whole subtree into
    // the symbol scene, so `parentId` references stay resolvable inside the SymbolAsset).
    const descendantIds = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of project.objects) {
        if (o.parentId && descendantIds.has(o.parentId) && !descendantIds.has(o.id)) {
          descendantIds.add(o.id);
          grew = true;
        }
      }
    }
    // The instance is an IDENTITY wrapper anchored at the selection-bbox centre; members keep
    // their authored coordinates inside the symbol -> the result renders byte-identical (parity).
    const boxes = targets
      .map((o) =>
        o.isGroup
          ? groupAABB(o, project.objects, project.assets, time)
          : objectAABB(o, project.assets.find((a) => a.id === o.assetId), time),
      )
      .filter((b): b is NonNullable<typeof b> => !!b);
    const bb = groupBBox(boxes);
    const cx = bb ? (bb.minX + bb.maxX) / 2 : 0;
    const cy = bb ? (bb.minY + bb.maxY) / 2 : 0;
    const width = bb ? bb.maxX - bb.minX : 0;
    const height = bb ? bb.maxY - bb.minY : 0;
    const symbolObjects = project.objects.filter((o) => descendantIds.has(o.id));
    const symId = newId();
    const symbol = createSymbolAsset({ id: symId, name: 'Symbol', objects: symbolObjects, width, height });
    const instance = createSceneObject(symId, {
      id: newId(),
      name: 'Symbol',
      zOrder: Math.max(...targets.map((o) => o.zOrder)) + 1,
      anchorX: cx,
      anchorY: cy,
    });
    const objects = [...project.objects.filter((o) => !descendantIds.has(o.id)), instance];
    get().commit({ ...project, assets: [...project.assets, symbol], objects });
    get().selectObject(instance.id);
  },
  placeSymbolInstance(symId) {
    const s = get();
    const project = s.history.present;
    const symbol = project.assets.find((a) => a.id === symId);
    if (!symbol || symbol.kind !== 'symbol') return;
    const containing = selectActiveAssetId(s);
    if (containing && (symId === containing || symbolContains(symId, containing, project.assets))) {
      get().pushToast('error', `Can't place ${symbol.name} here — it would contain itself.`);
      return;
    }
    const objects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    const box = sceneContentAABB(symbol.objects, project.assets, time);
    const cx = box ? (box.minX + box.maxX) / 2 : 0;
    const cy = box ? (box.minY + box.maxY) / 2 : 0;
    const instance = createSceneObject(symId, {
      name: `${symbol.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorX: cx,
      anchorY: cy,
    });
    get().commitActiveScene([...objects, instance]);
    get().selectObject(instance.id);
  },
  swapSymbol(instanceId, newSymId) {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const inst = objects.find((o) => o.id === instanceId);
    if (!inst || !isSymbolInstance(inst, project.assets) || inst.assetId === newSymId) return;
    const newSym = project.assets.find((a) => a.id === newSymId);
    if (!newSym || newSym.kind !== 'symbol') return;
    const containing = selectActiveAssetId(s);
    if (containing && (newSymId === containing || symbolContains(newSymId, containing, project.assets))) {
      get().pushToast('error', `Can't swap to ${newSym.name} — it would contain itself.`);
      return;
    }
    get().commitActiveScene(objects.map((o) => (o.id === instanceId ? { ...o, assetId: newSymId } : o)));
  },
  booleanOp(op) {
    const s = get();
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
    const eligible = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => {
        if (!o || o.isGroup) return false;
        const a = project.assets.find((x) => x.id === o.assetId);
        return a?.kind === 'vector';
      });
    if (eligible.length < 2) return; // gate: never a silent partial op

    const rings = booleanOpEngine(project, eligible, op, time); // world space
    if (rings.length === 0) return; // empty/degenerate -> no-op

    // primary = largest-area ring; the rest become compound rings (holes/disjoint pieces).
    const sorted = rings
      .slice()
      .sort((a, b) => Math.abs(ringArea(b.nodes.map((n) => n.anchor))) - Math.abs(ringArea(a.nodes.map((n) => n.anchor))));
    const box = sorted.reduce(
      (acc, r) => {
        const b = pathBounds(r);
        return {
          minX: Math.min(acc.minX, b.x),
          minY: Math.min(acc.minY, b.y),
          maxX: Math.max(acc.maxX, b.x + b.width),
          maxY: Math.max(acc.maxY, b.y + b.height),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const shift = (p: PathData): PathData => ({
      closed: p.closed,
      nodes: p.nodes.map((n) => ({ anchor: { x: n.anchor.x - box.minX, y: n.anchor.y - box.minY } })),
    });
    const primary = shift(sorted[0]);
    const compoundRings = sorted.slice(1).map(shift);

    // inherit the topmost source's style
    const topMost = eligible.slice().sort((a, b) => b.zOrder - a.zOrder)[0];
    const topAsset = project.assets.find((x) => x.id === topMost.assetId) as VectorAsset;

    const asset = createVectorAsset('path', {
      path: primary,
      ...(compoundRings.length > 0 ? { compoundRings } : {}),
      style: { ...topAsset.style },
    });
    const label = `${op[0].toUpperCase()}${op.slice(1)}`;
    const obj = createSceneObject(asset.id, {
      name: `${label} ${nextZOrder(project.objects) + 1}`,
      zOrder: nextZOrder(project.objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.minX, y: box.minY },
    });

    const removed = new Set(eligible.map((o) => o.id));
    const objects = [...project.objects.filter((o) => !removed.has(o.id)), obj];
    // Prune ONLY the source objects' now-unreferenced assets (vector assets are 1:1 with
    // objects), mirroring removeObject's convention so destructive boolean ops don't accrete
    // orphans. Scoped to the removed sources' assets so unrelated assets (e.g. audio referenced
    // by audioClips, or assets shared with surviving objects) are untouched.
    const orphanedAssetIds = new Set(
      eligible
        .map((o) => o.assetId)
        .filter((aid) => !objects.some((o) => o.assetId === aid)),
    );
    const assets = [...project.assets.filter((a) => !orphanedAssetIds.has(a.id)), asset];
    get().commit({ ...project, assets, objects });
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null });
  },
  reparentObject(id, newParentId) {
    const s = get();
    const project = s.history.present;
    const objs = project.objects;
    const o0 = objs.find((x) => x.id === id);
    if (!o0) return;
    if ((o0.parentId ?? null) === newParentId) return; // no-op: same parent (reorder is a separate path)
    if (newParentId) {
      const np = objs.find((x) => x.id === newParentId);
      if (!np?.isGroup) return; // can only drop INTO a group
      // Cycle guard: the new parent must not be the object itself or a descendant of it.
      const seen = new Set<string>();
      for (let cur: SceneObject | undefined = np; cur && !seen.has(cur.id); ) {
        if (cur.id === id) return; // would nest a group inside itself / its own subtree
        seen.add(cur.id);
        cur = cur.parentId ? objs.find((x) => x.id === cur!.parentId) : undefined;
      }
    }
    const parentGroup = (o: SceneObject) => (o.parentId ? objs.find((x) => x.id === o.parentId && x.isGroup) : undefined);
    const r = resolveObjectAnchor(o0, project.assets.find((a) => a.id === o0.assetId), sampleObject(o0, snapToFrame(s.time, project.meta.fps)));
    const ax = r ? r.anchorX : o0.anchorX;
    const ay = r ? r.anchorY : o0.anchorY;
    // Bake OUT of the whole old ancestor chain (immediate → outermost) → world space.
    let cur = o0;
    for (let g = parentGroup(o0); g; g = parentGroup(g)) cur = bakeGroupIntoChild(g, cur, ax, ay);
    // Unbake INTO the new chain (outermost → immediate).
    const newChain: SceneObject[] = [];
    for (let g = newParentId ? objs.find((x) => x.id === newParentId && x.isGroup) : undefined; g; g = parentGroup(g)) newChain.push(g);
    for (const g of newChain.reverse()) cur = unbakeGroupFromChild(g, cur, ax, ay);
    cur = { ...cur, parentId: newParentId ?? undefined };
    get().commit(replaceObject(project, cur));
    get().selectObject(id);
  },
  setGroupTransform(id, partial) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === id);
    if (!obj || !obj.isGroup) return;
    get().commit(replaceObject(project, { ...obj, base: { ...obj.base, ...partial } }));
  },
  selectObjectOrGroup(id) {
    get().selectObject(resolveToEntity(get().history.present.objects, id));
  },
  toggleObjectOrGroup(id) {
    const e = resolveToEntity(get().history.present.objects, id);
    const cur = get().selectedObjectIds;
    get().selectObjects(cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]);
  },
  selectObjectsExpandingGroups(ids) {
    get().selectObjects(expandToGroups(get().history.present.objects, ids));
  },

  setProperty(property, value) {
    get().setProperties({ [property]: value });
  },
  setProperties(updates) {
    const s = get();
    const objects = selectActiveObjects(s); // root, or the symbol scene in edit mode (slice 47 edit-mode)
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj || obj.locked) return;
    if (!obj.isGroup && !s.autoKey) return; // normal objects edit through keyframes (auto-key); a group: keyframe when auto-key on, base when off (45d)
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    get().commitActiveScene(objects.map((o) => (o.id === obj.id ? applyObjectTransform(obj, updates, time, s.autoKey) : o)));
  },
  setSymbolTiming(partial) {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const cur = obj.symbolTime ?? { startOffset: 0, loop: false, speed: 1 };
    const next: SymbolTiming = {
      startOffset: Math.max(0, partial.startOffset ?? cur.startOffset),
      loop: partial.loop ?? cur.loop,
      speed: Math.max(1e-3, partial.speed ?? cur.speed),
    };
    get().commitActiveScene(objects.map((o) => (o.id === obj.id ? { ...o, symbolTime: next } : o)));
  },
  setAnchor(anchorX, anchorY) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    get().commit(replaceObject(project, { ...obj, anchorX, anchorY }));
  },
  setVectorStyle(updates) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const next = { ...asset, style: { ...asset.style, ...updates } };
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
  },
  setVectorGradient(property, gradient) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const styleKey = property === 'fill' ? 'fillGradient' : 'strokeGradient';

    if (gradient === undefined) {
      // Switch to solid paint: clear BOTH the static gradient and any animated track.
      const nextStyle = { ...asset.style, [styleKey]: undefined };
      const nextAssets = project.assets.map((a) =>
        a.id === asset.id ? { ...asset, style: nextStyle } : a,
      );
      const gradientTracks = { ...obj.gradientTracks };
      delete gradientTracks[property];
      const nextObj = {
        ...obj,
        gradientTracks: Object.keys(gradientTracks).length > 0 ? gradientTracks : undefined,
      };
      get().commit({
        ...project,
        assets: nextAssets,
        objects: project.objects.map((o) => (o.id === obj.id ? nextObj : o)),
      });
      set({ selectedGradientKeyframe: null });
      return;
    }

    if (!s.autoKey) {
      get().setVectorStyle({ [styleKey]: gradient });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const existing = obj.gradientTracks?.[property] ?? [];
    // Preserve the easing already on a keyframe at this time: a stop edit fires
    // setVectorGradient on every change, and hardcoding 'linear' would silently
    // wipe an easing the user set via the EasingEditor.
    const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
    const next = upsertGradientKeyframe(existing, { time, gradient, easing: priorEasing });
    const gradientTracks = { ...obj.gradientTracks, [property]: next };
    get().commit(replaceObject(project, { ...obj, gradientTracks }));
  },
  setVectorColor(property, value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    if (!s.autoKey) {
      get().setVectorStyle({ [property]: value });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const next = upsertColorKeyframe(obj.colorTracks?.[property] ?? [], { time, value, easing: 'linear' });
    const colorTracks = { ...obj.colorTracks, [property]: next };
    get().commit(replaceObject(project, { ...obj, colorTracks }));
  },
  nudgeSelected(dx, dy) {
    if (!dx && !dy) return;
    const s = get();
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    // Move EVERY selected non-locked object by (dx,dy) in a SINGLE commit (slice 37). A
    // a group keyframes when auto-key is on (animatable, 45d), else writes base; a normal
    // object keyframes at the playhead (needs auto-key). Writes the ACTIVE scene (edit mode).
    let objects = selectActiveObjects(s);
    let changed = false;
    for (const id of s.selectedObjectIds) {
      const obj = objects.find((o) => o.id === id);
      if (!obj || obj.locked) continue;
      if (!obj.isGroup && !s.autoKey) continue;
      const state = sampleObject(obj, time);
      const partial: Partial<Record<AnimatableProperty, number>> = {};
      if (dx) partial.x = state.x + dx;
      if (dy) partial.y = state.y + dy;
      objects = objects.map((o) => (o.id === id ? applyObjectTransform(obj, partial, time, s.autoKey) : o));
      changed = true;
    }
    if (changed) get().commitActiveScene(objects);
  },
  setObjectsTransforms(updates) {
    const s = get();
    if (updates.length === 0) return;
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    // Write x/y/scaleX/scaleY/rotation for several objects in ONE commit (group transform;
    // slice 40/41). A group keyframes when auto-key is on (45d), else writes base; a normal
    // object keyframes (needs auto-key). Writes the ACTIVE scene (edit mode).
    let objects = selectActiveObjects(s);
    let changed = false;
    for (const u of updates) {
      const obj = objects.find((o) => o.id === u.id);
      if (!obj || obj.locked) continue;
      if (!obj.isGroup && !s.autoKey) continue;
      const partial: Partial<Record<AnimatableProperty, number>> = {};
      if (u.x !== undefined) partial.x = u.x;
      if (u.y !== undefined) partial.y = u.y;
      if (u.scaleX !== undefined) partial.scaleX = u.scaleX;
      if (u.scaleY !== undefined) partial.scaleY = u.scaleY;
      if (u.rotation !== undefined) partial.rotation = u.rotation;
      objects = objects.map((o) => (o.id === u.id ? applyObjectTransform(obj, partial, time, s.autoKey) : o));
      changed = true;
    }
    if (changed) get().commitActiveScene(objects);
  },
  alignSelected(edge) {
    const updates = alignItemsUpdates(get(), (items) => computeAlign(items, edge));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  distributeSelected(axis) {
    const updates = alignItemsUpdates(get(), (items) => computeDistribute(items, axis));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  selectKeyframe(ref) {
    set({
      selectedKeyframe: ref,
      selectedShapeKeyframe: null,
      selectedColorKeyframe: null,
      selectedGradientKeyframe: null,
      selectedDashKeyframe: null,
      selectedProgressKeyframe: null,
      // See selectShapeKeyframe: focus the keyframe's object, drop stale node selection.
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId], selectedNodeIndex: null } : {}),
    });
  },
  removeSelectedKeyframe() {
    const s = get();
    const ref = s.selectedKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj) return;
    const track = obj.tracks[ref.property] ?? [];
    const next = removeKeyframeAt(track, ref.time);
    get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [ref.property]: next } }));
    set({ selectedKeyframe: null });
  },
  setSelectedKeyframeEasing(easing) {
    const s = get();
    const project = s.history.present;
    if (s.selectedProgressKeyframe) {
      const ref = s.selectedProgressKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      if (!obj?.motionPath) return;
      const progress = obj.motionPath.progress.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress } }));
      return;
    }
    if (s.selectedColorKeyframe) {
      const ref = s.selectedColorKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      const track = obj?.colorTracks?.[ref.property];
      if (!obj || !track) return;
      const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k));
      get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [ref.property]: next } }));
      return;
    }
    if (s.selectedGradientKeyframe) {
      const ref = s.selectedGradientKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      const track = obj?.gradientTracks?.[ref.property];
      if (!obj || !track) return;
      const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k));
      get().commit(
        replaceObject(project, { ...obj, gradientTracks: { ...obj.gradientTracks, [ref.property]: next } }),
      );
      return;
    }
    if (s.selectedDashKeyframe) {
      const ref = s.selectedDashKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      if (!obj?.dashOffsetTrack) return;
      const next = obj.dashOffsetTrack.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
      return;
    }
    if (s.selectedShapeKeyframe) {
      const ref = s.selectedShapeKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      if (!obj?.shapeTrack) return;
      const shapeTrack = obj.shapeTrack.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObject(project, { ...obj, shapeTrack }));
      return;
    }
    const ref = s.selectedKeyframe;
    if (!ref) return;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    const track = obj?.tracks[ref.property];
    if (!obj || !track) return;
    const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k));
    get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [ref.property]: next } }));
  },
  setSelectedKeyframeRotationMode(mode) {
    const s = get();
    const ref = s.selectedKeyframe;
    if (!ref || ref.property !== 'rotation') return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    const track = obj?.tracks.rotation;
    if (!obj || !track) return;
    const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, rotationMode: mode } : k));
    get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, rotation: next } }));
  },
  setSelectedShapeKeyframeMorph(mode) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, morph: mode } : k,
    );
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
  setSelectedShapeKeyframeCorrespondence(correspondence) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, correspondence } : k,
    );
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
  setSelectedNodeEasing(easing) {
    const s = get();
    const idx = s.selectedNodeIndex;
    if (idx == null) return;
    const edited = selectEditedShapeKeyframe(s);
    if (!edited || idx >= edited.kf.path.nodes.length) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj?.shapeTrack) return;
    const arr = (edited.kf.nodeEasings ?? []).slice();
    arr[idx] = easing as Easing;
    const nodeEasings = arr.some((e) => e != null) ? arr : undefined;
    const shapeTrack = obj.shapeTrack.map((k, i) => (i === edited.index ? { ...k, nodeEasings } : k));
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
  enterCorrespondenceEdit() {
    set({ correspondenceEditing: true });
  },
  exitCorrespondenceEdit() {
    set({ correspondenceEditing: false });
  },
  setCorrespondenceLink(aIndex, bIndex) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const idx = obj.shapeTrack.findIndex((k) => Math.abs(k.time - ref.time) < KF_EPS);
    if (idx < 0 || idx >= obj.shapeTrack.length - 1) return;
    const from = obj.shapeTrack[idx].path;
    const to = obj.shapeTrack[idx + 1].path;
    if (aIndex < 0 || aIndex >= from.nodes.length || bIndex < 0 || bIndex >= to.nodes.length) return;
    const cur =
      obj.shapeTrack[idx].correspondence ??
      identityCorrespondence(from.nodes.length, to.nodes.length);
    const next = cur.slice();
    next[aIndex] = bIndex;
    const shapeTrack = obj.shapeTrack.map((k, i) =>
      i === idx ? { ...k, correspondence: next } : k,
    );
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
  addAudioClip(assetId) {
    const project = get().history.present;
    const clip = { id: newId(), assetId, startTime: get().time, inPoint: 0, outPoint: 0, volume: 1 };
    get().commit({ ...project, audioClips: [...project.audioClips, clip] });
  },

  seek(time) {
    const duration = computeProjectDuration(get().history.present);
    const clamped = Math.min(Math.max(0, time), duration > 0 ? duration : Number.MAX_VALUE);
    set({ time: clamped });
  },
  setPlaying(playing) {
    set({ playing });
  },
  toggleAutoKey() {
    set({ autoKey: !get().autoKey });
  },
  toggleSnap() {
    set({ snapEnabled: !get().snapEnabled });
  },
  setSnapEnabled(b) {
    set({ snapEnabled: b });
  },
  toggleOnionSkin() {
    set({ onionSkin: !get().onionSkin });
  },
  stepFrame(direction) {
    const project = get().history.present;
    const frame = 1 / project.meta.fps;
    get().seek(snapToFrame(get().time + direction * frame, project.meta.fps));
  },
  setTheme(theme) {
    set({ theme });
  },
  setZoom(zoom) {
    set({ zoom: Math.min(8, Math.max(0.1, zoom)) });
  },
  setPan(pan) {
    set({ pan });
  },
  setActiveTool(tool) {
    if (get().editPath.length > 0 && tool !== 'select') return; // edit mode is select-tool only (v1, slice 47 edit-mode)
    // The correspondence overlay only renders in the node tool; leaving the node tool
    // hides it, so clear the edit flag too (keeps the "Edit links" toggle consistent).
    set(tool === 'node' ? { activeTool: tool } : { activeTool: tool, correspondenceEditing: false });
  },
  setPolygonSides(n) {
    set({ polygonSides: Math.max(3, Math.floor(n)) });
  },
  setStarPoints(n) {
    set({ starPoints: Math.max(2, Math.floor(n)) });
  },
  setStarInnerRatio(r) {
    set({ starInnerRatio: Math.min(0.99, Math.max(0.01, r)) });
  },
  setPrimitiveCornerRadius(n) {
    set({ primitiveCornerRadius: Math.max(0, Number.isFinite(n) ? n : 0) });
  },
  setBrushSize(n) {
    set({ brushSize: Math.max(1, n) });
  },
  setBrushSmoothing(r) {
    set({ brushSmoothing: Math.min(1, Math.max(0, r)) });
  },
  setPenDrafting(drafting) {
    set({ penDrafting: drafting });
  },
  requestCancelPen() {
    set({ cancelPenRequested: get().cancelPenRequested + 1 });
  },

  pushToast(kind, message) {
    set({ toasts: [{ id: newId(), kind, message }, ...get().toasts] });
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
