// Mask-layer authoring verbs (spec 2026-11-13-mask-layers-design.md, slice 2). A mask is an
// `isMask` object (never drawn; its area reveals what it masks); masked objects carry `maskedBy`.
// Each verb works on the active scene (root, a Scene, or an edited symbol), commits one undoable
// step, and explains a refusal with a toast.
import { isLockedInTree } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from '../selectors';
import type { SliceCreator } from '../store-internals';

type MaskKeys = 'createMask' | 'releaseMask' | 'unmaskSelected';

/** `o` without its `maskedBy` (same object when it has none). */
function unlinked(o: SceneObject): SceneObject {
  if (o.maskedBy === undefined) return o;
  const rest = { ...o };
  delete rest.maskedBy;
  return rest;
}

export const createMaskSlice: SliceCreator<MaskKeys> = (_set, get) => ({
  createMask() {
    const s = get();
    const objects = selectActiveObjects(s);
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    const picked = s.selectedObjectIds.map((id) => byId.get(id)).filter((o): o is SceneObject => !!o);
    if (picked.length < 2) {
      s.pushToast('error', 'Select the mask shape and the objects it should mask (at least two).');
      return;
    }
    // Flash: the mask sits ABOVE what it masks — the topmost selected object is the mask.
    const order = new Map(objects.map((o, i) => [o.id, i] as const));
    const mask = picked.reduce((a, b) => (b.zOrder > a.zOrder || (b.zOrder === a.zOrder && order.get(b.id)! > order.get(a.id)!) ? b : a));
    if (isLockedInTree(mask, byId)) {
      s.pushToast('error', `"${mask.name}" is locked.`);
      return;
    }
    // A mask can't mask another mask (mask content is never masked), nor anything locked.
    const targets = picked.filter((o) => o.id !== mask.id && !o.isMask && !isLockedInTree(o, byId));
    if (targets.length === 0) {
      s.pushToast('error', 'Nothing left to mask: the other selected objects are masks or locked.');
      return;
    }
    const targetIds = new Set(targets.map((o) => o.id));
    const next = objects.map((o) => {
      if (o.id === mask.id) return { ...unlinked(o), isMask: true };
      if (targetIds.has(o.id)) return { ...o, maskedBy: mask.id };
      return o;
    });
    get().commitActiveScene(next);
    get().selectObject(mask.id);
  },

  releaseMask(maskId) {
    const s = get();
    const objects = selectActiveObjects(s);
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    const sel = s.selectedObjectId ? byId.get(s.selectedObjectId) : undefined;
    const id = maskId ?? (sel?.isMask ? sel.id : sel?.maskedBy);
    const mask = id ? byId.get(id) : undefined;
    if (!mask?.isMask) {
      s.pushToast('error', 'Select a mask (or an object it masks) to release.');
      return;
    }
    const next = objects.map((o) => {
      if (o.id === mask.id) {
        const rest = { ...o };
        delete rest.isMask;
        return rest;
      }
      return o.maskedBy === mask.id ? unlinked(o) : o;
    });
    get().commitActiveScene(next);
  },

  unmaskSelected() {
    const s = get();
    const ids = new Set(s.selectedObjectIds);
    const objects = selectActiveObjects(s);
    if (!objects.some((o) => ids.has(o.id) && o.maskedBy !== undefined)) return;
    get().commitActiveScene(objects.map((o) => (ids.has(o.id) ? unlinked(o) : o)));
  },
});
