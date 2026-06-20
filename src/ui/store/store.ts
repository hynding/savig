import { create } from 'zustand';
import {
  createProject,
  createHistory,
  pushHistory,
  createSceneObject,
  createKeyframe,
  snapToFrame,
  upsertKeyframe,
  removeKeyframeAt,
  sampleObject,
  computeProjectDuration,
  newId,
  undo as undoHistory,
  redo as redoHistory,
} from '../../engine';
import type { AnimatableProperty, Asset, History, Project, SceneObject } from '../../engine';

export type Theme = 'dark' | 'light';

export interface KeyframeRef {
  objectId: string;
  property: AnimatableProperty;
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
  selectedKeyframe: KeyframeRef | null;
  time: number;
  playing: boolean;
  autoKey: boolean;
  theme: Theme;
  zoom: number;
  pan: { x: number; y: number };
  toasts: Toast[];

  // --- document actions ---
  setProject(project: Project, binaries?: Record<string, Uint8Array>): void;
  newProject(): void;
  commit(next: Project): void;
  undo(): void;
  redo(): void;
  addAsset(asset: Asset, bytes?: Uint8Array): void;
  addObject(assetId: string): void;
  selectObject(id: string | null): void;
  setProperty(property: AnimatableProperty, value: number): void;
  setAnchor(anchorX: number, anchorY: number): void;
  nudgeSelected(dx: number, dy: number): void;
  selectKeyframe(ref: KeyframeRef | null): void;
  removeSelectedKeyframe(): void;
  addAudioClip(assetId: string): void;

  // --- transport / view actions ---
  seek(time: number): void;
  setPlaying(playing: boolean): void;
  toggleAutoKey(): void;
  stepFrame(direction: 1 | -1): void;
  setTheme(theme: Theme): void;
  setZoom(zoom: number): void;
  setPan(pan: { x: number; y: number }): void;

  // --- toasts ---
  pushToast(kind: Toast['kind'], message: string): void;
  dismissToast(id: string): void;
}

const TRANSIENT_DEFAULTS = {
  binaries: {} as Record<string, Uint8Array>,
  selectedObjectId: null as string | null,
  selectedKeyframe: null as KeyframeRef | null,
  time: 0,
  playing: false,
  autoKey: true,
  zoom: 1,
  pan: { x: 0, y: 0 },
  toasts: [] as Toast[],
};

function replaceObject(project: Project, next: SceneObject): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === next.id ? next : o)) };
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
  selectObject(id) {
    set({ selectedObjectId: id, selectedKeyframe: null });
  },

  setProperty(property, value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj || !s.autoKey) return; // editing blocked unless object selected & auto-key on
    const time = snapToFrame(s.time, project.meta.fps);
    const track = obj.tracks[property] ?? [];
    const next = upsertKeyframe(track, createKeyframe(time, value));
    get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [property]: next } }));
  },
  setAnchor(anchorX, anchorY) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    get().commit(replaceObject(project, { ...obj, anchorX, anchorY }));
  },
  nudgeSelected(dx, dy) {
    const s = get();
    const obj = s.history.present.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const state = sampleObject(obj, snapToFrame(s.time, s.history.present.meta.fps));
    if (dx) get().setProperty('x', state.x + dx);
    if (dy) get().setProperty('y', state.y + dy);
  },
  selectKeyframe(ref) {
    set({ selectedKeyframe: ref });
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

  pushToast(kind, message) {
    set({ toasts: [{ id: newId(), kind, message }, ...get().toasts] });
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
