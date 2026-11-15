// Mask layers (spec 2026-11-13). An `isMask` object is never drawn: its rendered area (alpha)
// reveals every object whose `maskedBy` names it. These helpers resolve, within ONE object list
// (root scene, a Scene, or a symbol's objects), which mask an object honours and whether an object
// is mask CONTENT (inside an `isMask` subtree). `flattenInstances` uses them; so do the editor and
// validate, so every caller agrees on the same rules.
import type { SceneObject } from './types';
import { isGuideInTree, isRenderHidden } from './groupTransform';

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
  // A guide never masks (spec 2026-11-15-bitmap-import): exports drop guides, so honouring one in
  // the editor would make the Stage and the export disagree.
  if (isGuideInTree(m, objectsById)) return null;
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

/** Mask modes (spec 2026-11-14-mask-modes): a mask's non-default style. Absent = alpha, upright. */
export interface MaskStyle {
  luminance?: true;
  invert?: true;
}

/** `mask`'s style, or undefined for a plain alpha mask (parity: leaves carry nothing). */
export function maskStyleOf(mask: SceneObject): MaskStyle | undefined {
  const luminance = mask.maskType === 'luminance';
  const invert = mask.maskInvert === true;
  if (!luminance && !invert) return undefined;
  return { ...(luminance ? { luminance: true as const } : {}), ...(invert ? { invert: true as const } : {}) };
}

/** The `<mask>` elements one mask def id needs, so the export string builder and the Stage's JSX
 *  emit the same structure. `content` = the element that holds the mask-content leaves. An
 *  inverted mask is a luminance mask of a white rect minus a black rect masked by the content
 *  (`<id>-src`): 1 − coverage, the exact complement for alpha and luminance sources alike. */
export interface MaskDefPart {
  id: string;
  type: 'alpha' | 'luminance';
  /** true: holds the content leaves. false: the inversion wrapper (white rect + black rect
   *  masked by `srcId`). */
  content: boolean;
  srcId?: string;
}

export function maskDefParts(id: string, style: MaskStyle | undefined): MaskDefPart[] {
  const type = style?.luminance ? 'luminance' : 'alpha';
  if (!style?.invert) return [{ id, type, content: true }];
  const srcId = `${id}-src`;
  return [
    { id: srcId, type, content: true },
    { id, type: 'luminance', content: false, srcId },
  ];
}

/** The huge userSpaceOnUse region every mask def uses (never crops; content carries its own
 *  transforms). */
export const MASK_REGION = { x: -100000, y: -100000, width: 200000, height: 200000 } as const;
