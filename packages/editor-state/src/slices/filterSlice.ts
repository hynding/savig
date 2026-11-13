// Filters & color effects authoring verbs (spec 2026-11-13-filters-design.md, slice 2). Each verb
// acts on the single selected object (leaf, group or symbol instance) in the active scene (root, a
// Scene, or an edited symbol), commits one undoable step, and is a no-op without a target.
import { createFilter, createKeyframe, filterTrackKey, FILTER_DEFAULT_COLOR, FILTER_PARAMS, newId, removeKeyframeAt, snapToFrame, upsertKeyframe } from '@savig/engine';
import type { FilterKind, ObjectFilter, SceneObject } from '@savig/engine';
import { selectActiveObjects, selectActiveScope } from '../selectors';
import { KF_EPS, NO_KEYFRAME_SELECTION, replaceObjectInScene, type SliceCreator, type StoreGet } from '../store-internals';

type FilterKeys =
  | 'addFilter'
  | 'removeFilter'
  | 'moveFilter'
  | 'toggleFilter'
  | 'setFilterParam'
  | 'setFilterColor'
  | 'selectFilterKeyframe'
  | 'removeSelectedFilterKeyframe';

/** `o` with `filters` / `filterTracks` replaced; empty ones are removed (parity with no filters). */
function withFilters(o: SceneObject, filters: ObjectFilter[], tracks: SceneObject['filterTracks']): SceneObject {
  const out = { ...o };
  if (filters.length > 0) out.filters = filters;
  else delete out.filters;
  if (tracks && Object.keys(tracks).length > 0) out.filterTracks = tracks;
  else delete out.filterTracks;
  return out;
}

/** The selected object + a committer for its replacement, or null when nothing single is selected. */
function target(get: StoreGet, objectId?: string) {
  const s = get();
  const id = objectId ?? (s.selectedObjectIds.length === 1 ? s.selectedObjectId : null);
  const obj = id ? selectActiveObjects(s).find((o) => o.id === id) : undefined;
  if (!obj) return null;
  const commit = (next: SceneObject) =>
    get().commit(replaceObjectInScene(s.history.present, selectActiveScope(s), next));
  return { s, obj, commit };
}

export const createFilterSlice: SliceCreator<FilterKeys> = (set, get) => ({
  addFilter(kind: FilterKind) {
    const t = target(get);
    if (!t) return;
    const f = createFilter(kind, newId());
    t.commit(withFilters(t.obj, [...(t.obj.filters ?? []), f], t.obj.filterTracks));
  },

  removeFilter(filterId) {
    const t = target(get);
    if (!t?.obj.filters?.some((f) => f.id === filterId)) return;
    const prefix = `${filterId}.`;
    const tracks = Object.fromEntries(Object.entries(t.obj.filterTracks ?? {}).filter(([k]) => !k.startsWith(prefix)));
    t.commit(withFilters(t.obj, t.obj.filters.filter((f) => f.id !== filterId), tracks));
    const sel = get().selectedFilterKeyframe;
    if (sel && sel.key.startsWith(prefix)) set({ selectedFilterKeyframe: null });
  },

  moveFilter(filterId, dir) {
    const t = target(get);
    const list = t?.obj.filters ?? [];
    const i = list.findIndex((f) => f.id === filterId);
    const j = i + dir;
    if (!t || i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    t.commit(withFilters(t.obj, next, t.obj.filterTracks));
  },

  toggleFilter(filterId) {
    const t = target(get);
    if (!t?.obj.filters?.some((f) => f.id === filterId)) return;
    const next = t.obj.filters.map((f) => {
      if (f.id !== filterId) return f;
      if (f.enabled === false) {
        const on = { ...f };
        delete on.enabled;
        return on;
      }
      return { ...f, enabled: false };
    });
    t.commit(withFilters(t.obj, next, t.obj.filterTracks));
  },

  setFilterParam(filterId, param, value) {
    const t = target(get);
    const f = t?.obj.filters?.find((x) => x.id === filterId);
    const spec = f ? FILTER_PARAMS[f.kind]?.[param] : undefined;
    if (!t || !f || !spec || !Number.isFinite(value)) return;
    const v = Math.min(spec.max, Math.max(spec.min, value));
    const key = filterTrackKey(filterId, param);
    if (t.s.autoKey) {
      const time = snapToFrame(t.s.time, t.s.history.present.meta.fps);
      const existing = t.obj.filterTracks?.[key] ?? [];
      // Preserve an existing keyframe's easing so editing the value doesn't reset it.
      const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
      const track = upsertKeyframe(existing, createKeyframe(time, v, { easing: priorEasing }));
      t.commit(withFilters(t.obj, t.obj.filters!, { ...t.obj.filterTracks, [key]: track }));
      return;
    }
    const next = t.obj.filters!.map((x) => (x.id === filterId ? { ...x, params: { ...x.params, [param]: v } } : x));
    t.commit(withFilters(t.obj, next, t.obj.filterTracks));
  },

  setFilterColor(filterId, color) {
    const t = target(get);
    const f = t?.obj.filters?.find((x) => x.id === filterId);
    if (!t || !f || FILTER_DEFAULT_COLOR[f.kind] === undefined || typeof color !== 'string') return;
    const next = t.obj.filters!.map((x) => (x.id === filterId ? { ...x, color } : x));
    t.commit(withFilters(t.obj, next, t.obj.filterTracks));
  },

  selectFilterKeyframe(ref) {
    set({
      ...NO_KEYFRAME_SELECTION,
      selectedFilterKeyframe: ref,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },

  removeSelectedFilterKeyframe() {
    const ref = get().selectedFilterKeyframe;
    if (!ref) return;
    const t = target(get, ref.objectId);
    const track = t?.obj.filterTracks?.[ref.key];
    if (!t || !track) return;
    const next = removeKeyframeAt(track, ref.time);
    const tracks = { ...t.obj.filterTracks };
    if (next.length > 0) tracks[ref.key] = next;
    else delete tracks[ref.key];
    t.commit(withFilters(t.obj, t.obj.filters ?? [], tracks));
    set({ selectedFilterKeyframe: null });
  },
});
