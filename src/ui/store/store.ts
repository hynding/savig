import { create } from 'zustand';
import {
  createProject,
  createHistory,
  pushHistory,
  createSceneObject,
  createVectorAsset,
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
  computeProjectDuration,
  newId,
  undo as undoHistory,
  redo as redoHistory,
} from '../../engine';
import { pathBounds, identityCorrespondence } from '../../engine';
import type {
  AnimatableProperty,
  Asset,
  Easing,
  History,
  MorphMode,
  ColorProperty,
  PathData,
  Project,
  RotationMode,
  SceneObject,
  ShapeKeyframe,
  VectorAsset,
  VectorShapeType,
  VectorStyle,
} from '../../engine';
import { deleteNodeAt, insertNodeAt, toggleSmooth, joinHandle, spliceNodeEasings, spliceCorrespondence } from '../components/Stage/pathEdit';
import { selectEditablePath, selectEditedShapeKeyframe } from './selectors';

/** Tolerance for matching a keyframe by time (times are frame-snapped on creation). */
const KF_EPS = 1e-6;

export type Theme = 'dark' | 'light';

export type ToolMode = 'select' | 'pen' | 'node' | 'rect' | 'ellipse';

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
  selectedObjectId: string | null;
  selectedNodeIndex: number | null;
  selectedKeyframe: KeyframeRef | null;
  selectedShapeKeyframe: ShapeKeyframeRef | null;
  selectedColorKeyframe: ColorKeyframeRef | null;
  time: number;
  playing: boolean;
  autoKey: boolean;
  theme: Theme;
  zoom: number;
  pan: { x: number; y: number };
  activeTool: ToolMode;
  /** True while a pen draft is in progress (so the keyboard handler can target it). */
  penDrafting: boolean;
  /** Incremented to ask an in-progress pen draft to cancel (keyboard -> usePathTools). */
  cancelPenRequested: number;
  toasts: Toast[];

  // --- document actions ---
  setProject(project: Project, binaries?: Record<string, Uint8Array>): void;
  newProject(): void;
  commit(next: Project): void;
  undo(): void;
  redo(): void;
  addAsset(asset: Asset, bytes?: Uint8Array): void;
  addObject(assetId: string): void;
  addVectorShape(shapeType: VectorShapeType, bounds: { x: number; y: number; width: number; height: number }): void;
  addVectorPath(path: PathData): void;
  setPathData(path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void;
  addShapeKeyframe(): void;
  removeShapeKeyframe(): void;
  selectShapeKeyframe(ref: ShapeKeyframeRef | null): void;
  selectColorKeyframe(ref: ColorKeyframeRef | null): void;
  deleteSelectedNode(): void;
  insertNode(segmentIndex: number, t: number): void;
  toggleSelectedNodeSmooth(): void;
  joinSelectedNode(): void;
  breakSelectedNode(): void;
  selectNode(index: number | null): void;
  selectObject(id: string | null): void;
  setProperty(property: AnimatableProperty, value: number): void;
  setProperties(updates: Partial<Record<AnimatableProperty, number>>): void;
  setAnchor(anchorX: number, anchorY: number): void;
  setVectorStyle(updates: Partial<VectorStyle>): void;
  setVectorColor(property: ColorProperty, value: string): void;
  nudgeSelected(dx: number, dy: number): void;
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
  stepFrame(direction: 1 | -1): void;
  setTheme(theme: Theme): void;
  setZoom(zoom: number): void;
  setPan(pan: { x: number; y: number }): void;
  setActiveTool(tool: ToolMode): void;
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

const TRANSIENT_DEFAULTS = {
  binaries: {} as Record<string, Uint8Array>,
  selectedObjectId: null as string | null,
  selectedNodeIndex: null as number | null,
  selectedKeyframe: null as KeyframeRef | null,
  selectedShapeKeyframe: null as ShapeKeyframeRef | null,
  selectedColorKeyframe: null as ColorKeyframeRef | null,
  time: 0,
  playing: false,
  autoKey: true,
  zoom: 1,
  pan: { x: 0, y: 0 },
  activeTool: 'select' as ToolMode,
  penDrafting: false,
  correspondenceEditing: false,
  cancelPenRequested: 0,
  toasts: [] as Toast[],
};

function replaceObject(project: Project, next: SceneObject): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === next.id ? next : o)) };
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
  ...TRANSIENT_DEFAULTS,

  setProject(project, binaries = {}) {
    set({ history: createHistory(project), ...TRANSIENT_DEFAULTS, binaries });
  },
  newProject() {
    set({ history: createHistory(createProject()), ...TRANSIENT_DEFAULTS });
  },
  commit(next) {
    set({ history: pushHistory(get().history, next) });
  },
  undo() {
    set({ history: undoHistory(get().history) });
  },
  redo() {
    set({ history: redoHistory(get().history) });
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
      name: `${asset?.name ?? 'Object'} ${project.objects.length + 1}`,
      zOrder: project.objects.length,
      anchorX,
      anchorY,
    });
    get().commit({ ...project, objects: [...project.objects, obj] });
    set({ selectedObjectId: obj.id, selectedKeyframe: null });
  },
  addVectorShape(shapeType, bounds) {
    const project = get().history.present;
    const asset = createVectorAsset(shapeType);
    const shapeBase =
      shapeType === 'ellipse'
        ? { radiusX: bounds.width / 2, radiusY: bounds.height / 2 }
        : { width: bounds.width, height: bounds.height };
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${project.objects.length + 1}`,
      zOrder: project.objects.length,
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
    set({ selectedObjectId: obj.id, selectedKeyframe: null, activeTool: 'select' });
  },
  addVectorPath(path) {
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
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE } });
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${project.objects.length + 1}`,
      zOrder: project.objects.length,
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
    set({ selectedObjectId: obj.id, selectedKeyframe: null, selectedNodeIndex: null, activeTool: 'node' });
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
      const next = { ...asset, path };
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
  selectShapeKeyframe(ref) {
    set({
      selectedShapeKeyframe: ref,
      selectedKeyframe: null,
      selectedColorKeyframe: null,
      // Selecting a keyframe focuses its object; clear any stale node selection
      // (consistent with selectObject), since it may belong to a different object.
      ...(ref ? { selectedObjectId: ref.objectId, selectedNodeIndex: null } : {}),
    });
  },
  selectColorKeyframe(ref) {
    set({
      selectedColorKeyframe: ref,
      selectedKeyframe: null,
      selectedShapeKeyframe: null,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId } : {}),
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
    set({ selectedObjectId: id, selectedKeyframe: null, selectedShapeKeyframe: null, selectedColorKeyframe: null, selectedNodeIndex: null });
  },

  setProperty(property, value) {
    get().setProperties({ [property]: value });
  },
  setProperties(updates) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj || !s.autoKey) return; // editing blocked unless object selected & auto-key on
    const time = snapToFrame(s.time, project.meta.fps);
    const tracks = { ...obj.tracks };
    for (const [property, value] of Object.entries(updates) as [AnimatableProperty, number][]) {
      tracks[property] = upsertKeyframe(obj.tracks[property] ?? [], createKeyframe(time, value));
    }
    get().commit(replaceObject(project, { ...obj, tracks }));
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
    const s = get();
    const obj = s.history.present.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const state = sampleObject(obj, snapToFrame(s.time, s.history.present.meta.fps));
    // Single atomic commit so a diagonal nudge is one undo step.
    const updates: Partial<Record<AnimatableProperty, number>> = {};
    if (dx) updates.x = state.x + dx;
    if (dy) updates.y = state.y + dy;
    get().setProperties(updates);
  },
  selectKeyframe(ref) {
    set({
      selectedKeyframe: ref,
      selectedShapeKeyframe: null,
      selectedColorKeyframe: null,
      // See selectShapeKeyframe: focus the keyframe's object, drop stale node selection.
      ...(ref ? { selectedObjectId: ref.objectId, selectedNodeIndex: null } : {}),
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
    // The correspondence overlay only renders in the node tool; leaving the node tool
    // hides it, so clear the edit flag too (keeps the "Edit links" toggle consistent).
    set(tool === 'node' ? { activeTool: tool } : { activeTool: tool, correspondenceEditing: false });
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
