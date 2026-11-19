// Multi-keyframe selection verbs (spec 2026-11-19-key-selection). A key selection is a time range
// across objects; every verb edits every keyframe channel of those objects in one undo step, via
// the engine's keyRange rules. Locked objects are left alone.
import {
  copyKeys,
  deleteKeys,
  isLockedInTree,
  keyBlockSpan,
  keyTimesInRange,
  pasteKeys as pasteKeyBlock,
  reverseKeys,
  scaleKeys,
  shiftKeys,
  snapToFrame,
} from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from '../selectors';
import { NO_KEYFRAME_SELECTION } from '../store-internals';
import type { KeySelection, SliceCreator, StoreGet } from '../store-internals';

type KeySelectionKeys =
  | 'selectKeyRange'
  | 'moveKeySelection'
  | 'stretchKeySelection'
  | 'reverseKeySelection'
  | 'deleteKeySelection'
  | 'copyKeySelection'
  | 'cutKeySelection'
  | 'pasteKeys';

/** Applies `edit` to every unlocked selected object; commits one step when anything changed.
 *  Returns false (no commit) when there is no selection or nothing changed. */
function editSelected(get: StoreGet, edit: (o: SceneObject, sel: KeySelection) => SceneObject): boolean {
  const s = get();
  const sel = s.keySelection;
  if (!sel) return false;
  const objects = selectActiveObjects(s);
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const ids = new Set(sel.objectIds);
  let changed = false;
  const next = objects.map((o) => {
    if (!ids.has(o.id) || isLockedInTree(o, byId)) return o;
    const e = edit(o, sel);
    if (e !== o) changed = true;
    return e;
  });
  if (!changed) return false;
  get().commitActiveScene(next);
  return true;
}

export const createKeySelectionSlice: SliceCreator<KeySelectionKeys> = (set, get) => ({
  selectKeyRange(sel) {
    if (!sel || sel.objectIds.length === 0) {
      set({ keySelection: null });
      return;
    }
    const raw = { start: Math.max(0, Math.min(sel.start, sel.end)), end: Math.max(0, Math.max(sel.start, sel.end)) };
    // Keep only rows with keys in the range, and tighten the range to those keys, so the band
    // hugs what is selected (and stretching scales from the first key to the last).
    const ids = new Set(sel.objectIds);
    const hits = selectActiveObjects(get())
      .filter((o) => ids.has(o.id))
      .map((o) => ({ id: o.id, times: keyTimesInRange(o, raw) }))
      .filter((h) => h.times.length > 0);
    if (hits.length === 0) {
      set({ keySelection: null });
      return;
    }
    const all = hits.flatMap((h) => h.times);
    set({ ...NO_KEYFRAME_SELECTION, keySelection: { objectIds: hits.map((h) => h.id), start: Math.min(...all), end: Math.max(...all) } });
  },

  moveKeySelection(dt) {
    const s = get();
    const sel = s.keySelection;
    if (!sel) return;
    const fps = s.history.present.meta.fps;
    // Never move a key before 0: clamp the shift by the earliest selected key.
    const objects = selectActiveObjects(s).filter((o) => sel.objectIds.includes(o.id));
    const first = Math.min(...objects.map((o) => keyTimesInRange(o, sel)[0] ?? Infinity));
    const shift = snapToFrame(Math.max(dt, Number.isFinite(first) ? -first : -sel.start), fps);
    if (Math.abs(shift) < 1e-9) return;
    if (editSelected(get, (o) => shiftKeys(o, sel, shift))) {
      set({ keySelection: { ...sel, start: Math.max(0, sel.start + shift), end: Math.max(0, sel.end + shift) } });
    }
  },

  stretchKeySelection(newEnd) {
    const s = get();
    const sel = s.keySelection;
    if (!sel) return;
    const fps = s.history.present.meta.fps;
    const end = snapToFrame(newEnd, fps);
    if (end <= sel.start || Math.abs(end - sel.end) < 1e-9) return;
    if (editSelected(get, (o) => scaleKeys(o, sel, end, (t) => snapToFrame(t, fps)))) {
      set({ keySelection: { ...sel, end } });
    }
  },

  reverseKeySelection() {
    const sel = get().keySelection;
    if (!sel) return;
    if (!editSelected(get, (o) => (keyTimesInRange(o, sel).length > 1 ? reverseKeys(o, sel) : o))) {
      get().pushToast('info', 'Select at least two keyframes on a row to reverse them.');
    }
  },

  deleteKeySelection() {
    if (editSelected(get, (o, sel) => (keyTimesInRange(o, sel).length ? deleteKeys(o, sel) : o))) set({ keySelection: null });
  },

  copyKeySelection() {
    const s = get();
    const sel = s.keySelection;
    if (!sel) return;
    const blocks: Record<string, ReturnType<typeof copyKeys>> = {};
    for (const o of selectActiveObjects(s)) {
      if (!sel.objectIds.includes(o.id)) continue;
      const b = copyKeys(o, sel);
      if (Object.keys(b).length) blocks[o.id] = b;
    }
    if (Object.keys(blocks).length === 0) return;
    const span = Math.max(...Object.values(blocks).map(keyBlockSpan));
    set({ keysClipboard: { blocks, span }, keyframeClipboard: null, clipboard: null });
  },

  cutKeySelection() {
    get().copyKeySelection();
    get().deleteKeySelection();
  },

  pasteKeys() {
    const s = get();
    const clip = s.keysClipboard;
    if (!clip) return;
    const fps = s.history.present.meta.fps;
    const at = snapToFrame(s.time, fps);
    const objects = selectActiveObjects(s);
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    const sources = Object.keys(clip.blocks);
    // One object's keys paste onto the one selected object; otherwise each block goes home.
    const targets = new Map<string, string>(); // target id -> source id
    if (sources.length === 1 && s.selectedObjectIds.length === 1) targets.set(s.selectedObjectIds[0], sources[0]);
    else for (const id of sources) if (byId.has(id)) targets.set(id, id);
    let changed = false;
    const next = objects.map((o) => {
      const src = targets.get(o.id);
      if (!src || isLockedInTree(o, byId)) return o;
      const p = pasteKeyBlock(o, clip.blocks[src], at);
      if (p !== o) changed = true;
      return p;
    });
    if (!changed) {
      s.pushToast('error', 'Nothing to paste the keyframes onto here.');
      return;
    }
    get().commitActiveScene(next);
    set({ ...NO_KEYFRAME_SELECTION, keySelection: { objectIds: [...targets.keys()], start: at, end: at + clip.span } });
  },
});
