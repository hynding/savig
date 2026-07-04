import { isLockedInTree } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';
import { buildLockIndex } from '../viewmodels/lockIndex';

/** Number of SELECTED objects that can actually be moved (not locked — incl. ancestor-group lock
 *  cascade — and not hidden). Mirrors the Inspector's movable gate. */
function movableCount(s: EditorState): number {
  const objects = selectActiveObjects(s);
  const lockById = buildLockIndex(objects);
  return s.selectedObjectIds.filter((id) => {
    const o = objects.find((obj) => obj.id === id);
    return !!o && !isLockedInTree(o, lockById) && !o.hidden;
  }).length;
}

/** Count of selected objects eligible as a boolean operand: a vector leaf, a group with a vector-leaf
 *  descendant, or a direct SVG-asset object. Mirrors the store's booleanOp eligibility. */
function eligibleForBool(s: EditorState): number {
  const objects = selectActiveObjects(s);
  const assets = s.history.present.assets;
  const hasVectorLeaf = (o: SceneObject): boolean => {
    if (!o.isGroup) return assets.find((x) => x.id === o.assetId)?.kind === 'vector';
    return objects.some((c) => c.parentId === o.id && hasVectorLeaf(c));
  };
  const isSvgOperand = (o: SceneObject): boolean =>
    !o.isGroup && assets.find((x) => x.id === o.assetId)?.kind === 'svg';
  return s.selectedObjectIds.filter((id) => {
    const o = objects.find((obj) => obj.id === id);
    return !!o && (hasVectorLeaf(o) || isSvgOperand(o));
  }).length;
}

export const hasSelection = (s: EditorState): boolean => s.selectedObjectIds.length >= 1;
export const hasMultiSelection = (s: EditorState): boolean => s.selectedObjectIds.length >= 2;

export const canAlign = (s: EditorState): boolean => movableCount(s) >= 2;
export const canDistribute = (s: EditorState): boolean => movableCount(s) >= 3;
export const canBool = (s: EditorState): boolean => eligibleForBool(s) >= 2;
export const canGroup = (s: EditorState): boolean => s.selectedObjectIds.length >= 2;

/** A selected, unlocked, top-level object exists (can be promoted to a symbol). */
export const canCreateSymbol = (s: EditorState): boolean => {
  const objects = selectActiveObjects(s);
  return s.selectedObjectIds.some((id) => {
    const o = objects.find((obj) => obj.id === id);
    return !!o && !o.locked && !o.parentId;
  });
};
