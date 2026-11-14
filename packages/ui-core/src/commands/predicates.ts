import { exposedFrameKeyId, isBone, isLockedInTree, snapToFrame } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects, selectTargetFrameLayer, isShapeBuilderEligible, isBlendEligible } from '@savig/editor-state';
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

/** Shape Builder entry eligibility (art-tools #7): 2..6 selected, EVERY one a plain CLOSED
 *  vector leaf (`isShapeBuilderEligible`, shared with the store's own `enterShapeBuilder` gate so
 *  the two never drift). Cheap — flag reads only, no geometry/pc — same cost class as
 *  `canOutlineStroke`. The `path.shapeBuilder` command's `when` also ORs in `!!s.shapeBuilder` so
 *  the toggle stays available to EXIT while active, even if the frozen selection later changes. */
export const canShapeBuilder = (s: EditorState): boolean => {
  const ids = s.selectedObjectIds;
  if (ids.length < 2 || ids.length > 6) return false;
  const objects = selectActiveObjects(s);
  const project = s.history.present;
  const lockById = buildLockIndex(objects);
  return ids.every((id) => {
    const o = objects.find((obj) => obj.id === id);
    return !!o && isShapeBuilderEligible(o, project, objects, lockById);
  });
};

/** Blend eligibility (art-tools #9): exactly 2 selected, BOTH eligible (`isBlendEligible`,
 *  shared with the store's own `blendSelected` gate so the two never drift). Cheap — flag reads
 *  only, no geometry — same cost class as `canShapeBuilder`. */
export const canBlend = (s: EditorState): boolean => {
  const ids = s.selectedObjectIds;
  if (ids.length !== 2) return false;
  const objects = selectActiveObjects(s);
  const project = s.history.present;
  const lockById = buildLockIndex(objects);
  return ids.every((id) => {
    const o = objects.find((obj) => obj.id === id);
    return !!o && isBlendEligible(o, project, objects, lockById);
  });
};

/** A frame-by-frame layer is targeted (selected, or holding the selection) — the F5/F6/F7 verbs'
 *  gate (spec 2026-11-07). */
export const hasFrameLayerTarget = (s: EditorState): boolean => selectTargetFrameLayer(s) !== null;

/** Shape tween (spec 2026-11-13): the target frame layer's key under the playhead is tweened. */
export function hasShapeTweenAtPlayhead(s: EditorState): boolean {
  const layer = selectTargetFrameLayer(s);
  if (!layer?.frames) return false;
  const id = exposedFrameKeyId(layer.frames, snapToFrame(s.time, s.history.present.meta.fps));
  return !!layer.frames.keys.find((k) => k.id === id)?.tween;
}

/** Mask layers (spec 2026-11-13): 2+ objects selected in the active scene (createMask picks the
 *  topmost as the mask and refuses with a toast if nothing is left to mask). */
/** Exactly one object selected in the active scene, unlocked — what the filter verbs act on. */
export function canAddFilter(s: EditorState): boolean {
  if (s.selectedObjectIds.length !== 1) return false;
  const objects = selectActiveObjects(s);
  const sel = objects.find((o) => o.id === s.selectedObjectId);
  return !!sel && !isLockedInTree(sel, buildLockIndex(objects));
}

export const canCreateMask = (s: EditorState): boolean => s.selectedObjectIds.length >= 2;

/** The primary selection is a mask, or is masked by one (what releaseMask acts on). */
export function canReleaseMask(s: EditorState): boolean {
  const objects = selectActiveObjects(s);
  const sel = objects.find((o) => o.id === s.selectedObjectId);
  if (!sel) return false;
  if (sel.isMask) return true;
  return !!sel.maskedBy && !!objects.find((o) => o.id === sel.maskedBy)?.isMask;
}

/** Some selected object carries a mask link. */
export function canUnmask(s: EditorState): boolean {
  const ids = new Set(s.selectedObjectIds);
  return selectActiveObjects(s).some((o) => ids.has(o.id) && o.maskedBy !== undefined);
}

/** Bones (spec 2026-11-13-bone-tool): exactly one bone plus at least one other (non-bone)
 *  object selected — Attach to Bone files the others under that bone. */
export function canAttachToBone(s: EditorState): boolean {
  const objects = selectActiveObjects(s);
  const picked = s.selectedObjectIds.map((id) => objects.find((o) => o.id === id)).filter((o): o is SceneObject => !!o);
  return picked.filter((o) => isBone(o)).length === 1 && picked.some((o) => !isBone(o));
}

/** Bone skinning (spec 2026-11-14): one or more bones plus exactly one rect/ellipse/path drawing
 *  that isn't inside a bone — Bind to Bones bends that drawing with them. */
export function canBindSkin(s: EditorState): boolean {
  const objects = selectActiveObjects(s);
  const picked = s.selectedObjectIds.map((id) => objects.find((o) => o.id === id)).filter((o): o is SceneObject => !!o);
  const drawings = picked.filter((o) => !isBone(o));
  if (drawings.length !== 1 || drawings.length === picked.length) return false;
  const d = drawings[0];
  const asset = s.history.present.assets.find((a) => a.id === d.assetId);
  return !d.isGroup && asset?.kind === 'vector' && !isBone(objects.find((o) => o.id === d.parentId));
}

/** Some selected drawing is skinned — Unbind from Bones applies. */
export function canUnbindSkin(s: EditorState): boolean {
  const ids = new Set(s.selectedObjectIds);
  return selectActiveObjects(s).some((o) => ids.has(o.id) && !!o.skin);
}

/** Some selected non-bone object sits directly in a bone — Detach from Bone applies. */
export function canDetachFromBone(s: EditorState): boolean {
  const objects = selectActiveObjects(s);
  return s.selectedObjectIds.some((id) => {
    const o = objects.find((x) => x.id === id);
    return !!o && !isBone(o) && isBone(objects.find((x) => x.id === o.parentId));
  });
}
