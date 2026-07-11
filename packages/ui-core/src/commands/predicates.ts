import { isLockedInTree } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';
import { isSymbolInstance } from '@savig/interaction';
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

/** The PRIMARY selected object (`selectedObjectId`) is a vector — mirrors what `copyStyle()`
 *  actually captures. A group/text/svg/symbol primary selection would leave "Copy style" showing
 *  as available under the looser `hasSelection` gate while silently no-opping; this closes that
 *  gap (final-review Fix 3). */
export const vectorSelected = (s: EditorState): boolean => {
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
  if (!obj) return false;
  return s.history.present.assets.find((a) => a.id === obj.assetId)?.kind === 'vector';
};

export const canAlign = (s: EditorState): boolean => movableCount(s) >= 2;
export const canDistribute = (s: EditorState): boolean => movableCount(s) >= 3;
export const canBool = (s: EditorState): boolean => eligibleForBool(s) >= 2;
export const canGroup = (s: EditorState): boolean => s.selectedObjectIds.length >= 2;

/** A group container is selected (ungroup has something to act on). */
export const canUngroup = (s: EditorState): boolean => {
  const objects = selectActiveObjects(s);
  return s.selectedObjectIds.some((id) => objects.find((o) => o.id === id)?.isGroup);
};

/** Outline-stroke eligibility: a SINGLE selected vector path leaf with a visible stroke, not a
 *  group container, symbol instance, or live-boolean result. Kept CHEAP — predicates run per
 *  keypress — so it covers only the visible/enable state; the deep structural gates (morph,
 *  compoundRings, boolean-operand membership, lock cascade) live in the `outlineStroke` store op
 *  itself and surface as a toast rather than a disabled button. */
export const canOutlineStroke = (s: EditorState): boolean => {
  if (s.selectedObjectIds.length !== 1) return false;
  const objects = selectActiveObjects(s);
  const obj = objects.find((o) => o.id === s.selectedObjectIds[0]);
  if (!obj || obj.isGroup || obj.boolean) return false;
  const assets = s.history.present.assets;
  if (isSymbolInstance(obj, assets)) return false;
  const asset = assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return false;
  return asset.style.stroke !== 'none' && asset.style.strokeWidth > 0;
};

/** A selected, unlocked, top-level object exists (can be promoted to a symbol). */
export const canCreateSymbol = (s: EditorState): boolean => {
  const objects = selectActiveObjects(s);
  return s.selectedObjectIds.some((id) => {
    const o = objects.find((obj) => obj.id === id);
    return !!o && !o.locked && !o.parentId;
  });
};
