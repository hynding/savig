// Mask layers (spec 2026-11-13). An `isMask` object is never drawn: its rendered area (alpha)
// reveals every object whose `maskedBy` names it. These helpers resolve, within ONE object list
// (root scene, a Scene, or a symbol's objects), which mask an object honours and whether an object
// is mask CONTENT (inside an `isMask` subtree). `flattenInstances` uses them; so do the editor and
// validate, so every caller agrees on the same rules.
import type { SceneObject } from './types';
import { isRenderHidden } from './groupTransform';

/** Ancestors of `obj` through group containers, nearest first (cycle-guarded). */
export function groupAncestors(obj: SceneObject, objectsById: Map<string, SceneObject>): SceneObject[] {
  const out: SceneObject[] = [];
  const seen = new Set<string>([obj.id]);
  let pid = obj.parentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = objectsById.get(pid);
    if (!p?.isGroup) break;
    out.push(p);
    pid = p.parentId;
  }
  return out;
}

/** The topmost `isMask` object among `obj` and its group ancestors, or null when `obj` is not mask
 *  content. The topmost one names the mask (a mask group's children are all its content). */
export function maskContentRoot(obj: SceneObject, objectsById: Map<string, SceneObject>): SceneObject | null {
  let root: SceneObject | null = obj.isMask ? obj : null;
  for (const a of groupAncestors(obj, objectsById)) if (a.isMask) root = a;
  return root;
}

/** The mask `obj.maskedBy` names, if it is honoured: it exists in the same list, is an `isMask`
 *  object, is not render-hidden, and is neither `obj` itself nor one of its ancestors (nor inside
 *  `obj`'s own subtree, which would make it mask itself). Otherwise null → rendered unmasked. */
export function resolveMaskTarget(obj: SceneObject, objectsById: Map<string, SceneObject>): SceneObject | null {
  if (!obj.maskedBy || obj.maskedBy === obj.id) return null;
  const m = objectsById.get(obj.maskedBy);
  if (!m || !m.isMask) return null;
  if (isRenderHidden(m, objectsById)) return null;
  if (groupAncestors(obj, objectsById).some((a) => a.id === m.id)) return null;
  if (groupAncestors(m, objectsById).some((a) => a.id === obj.id)) return null;
  return m;
}

/** The honoured masks applying to `obj` within its own list, OUTERMOST first: each masked group
 *  ancestor's mask, then `obj`'s own. Mask content never carries a chain (returns []). */
export function maskChainFor(obj: SceneObject, objectsById: Map<string, SceneObject>): SceneObject[] {
  if (maskContentRoot(obj, objectsById)) return [];
  const chain: SceneObject[] = [];
  for (const node of [obj, ...groupAncestors(obj, objectsById)]) {
    const m = resolveMaskTarget(node, objectsById);
    if (m) chain.unshift(m);
  }
  return chain;
}

/** Def id of a mask: unique per instance path so two instances of a symbol with an internal mask
 *  get distinct `<mask>` elements. `idPrefix` is the walker's render-id prefix ('' at the root). */
export function maskDefId(idPrefix: string, maskObjectId: string): string {
  return `savig-mask-${idPrefix ? `${idPrefix}/` : ''}${maskObjectId}`;
}

/** Ids of the objects (in one list) whose `maskedBy` names `maskId` — the editor's "masked
 *  objects" of a mask. Not filtered by honour rules: a hidden mask still owns its links. */
export function maskedObjectIds(objects: SceneObject[], maskId: string): string[] {
  return objects.filter((o) => o.maskedBy === maskId).map((o) => o.id);
}

/** True iff any object in `asset`'s subtree (recursively through nested symbols, cycle-guarded)
 *  is a mask or masked — such symbols need the inlined per-leaf render path (no static `<use>`). */
export function symbolUsesMasks(
  asset: { id: string; objects: SceneObject[] },
  assetsById: Map<string, { id: string; kind: string; objects?: SceneObject[] }>,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(asset.id)) return false;
  visited.add(asset.id);
  for (const o of asset.objects) {
    if (o.isMask || o.maskedBy) return true;
    const child = assetsById.get(o.assetId);
    if (child && child.kind === 'symbol' && child.objects && symbolUsesMasks({ id: child.id, objects: child.objects }, assetsById, visited)) return true;
  }
  return false;
}
