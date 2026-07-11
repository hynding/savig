// Group-container composition (slice 45). A group is a static container object (`isGroup`)
// whose transform composes onto its children at COMPUTE time via a prepended transform
// string — no DOM nesting. Editor-only/engine math; shared by computeFrame + renderDocument.

import { buildTransform } from './transform';
import { sampleObject, type RenderState } from './sample';
import type { PathNode, PathPoint, Project, SceneObject } from './types';

/** The group container that `obj` belongs to (via `parentId`), or null. Resolves within the
 *  given scene `objects` list — top-level OR a symbol's own objects[] (slice 47a). */
export function parentGroupOf(objects: SceneObject[], obj: SceneObject): SceneObject | null {
  if (!obj.parentId) return null;
  const g = objects.find((o) => o.id === obj.parentId && o.isGroup);
  return g ?? null;
}

/** Every object whose parentId chain reaches `groupId` (leaves, instances, nested groups
 *  and their descendants). Excludes the group itself. Cycle-guarded. */
export function groupDescendantIds(objects: SceneObject[], groupId: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const o of objects) {
      if (o.parentId !== pid || out.has(o.id)) continue;
      out.add(o.id);
      walk(o.id);
    }
  };
  walk(groupId);
  out.delete(groupId); // robustly exclude the group itself, even if a corrupt parentId cycle routed back to it
  return out;
}

/** True when `obj` must be omitted from render/export: it is hidden, OR ANY ancestor group
 *  container is hidden — group visibility cascades down the whole chain (slice 45c/45e). */
export function isRenderHidden(obj: SceneObject, objectsById: Map<string, SceneObject>): boolean {
  if (obj.hidden) return true;
  const seen = new Set<string>();
  let pid = obj.parentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid); // cycle guard
    const p = objectsById.get(pid);
    if (!p?.isGroup) break;
    if (p.hidden) return true;
    pid = p.parentId;
  }
  return false;
}

/** True when `obj` must be treated as locked for EDITING: it is locked, OR ANY ancestor group
 *  container is locked — group lock cascades down the whole chain (mirrors `isRenderHidden`,
 *  slice 45c/45e). Editor-only interaction gating; never affects render/export. */
export function isLockedInTree(obj: SceneObject, objectsById: Map<string, SceneObject>): boolean {
  if (obj.locked) return true;
  const seen = new Set<string>();
  let pid = obj.parentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid); // cycle guard
    const p = objectsById.get(pid);
    if (!p?.isGroup) break;
    if (p.locked) return true;
    pid = p.parentId;
  }
  return false;
}

/** The transform STRING to prepend to a child's own transform so it renders inside its group
 *  container(s). `''` when the object has no group ancestor. Composes EVERY ancestor group
 *  outermost-first (SVG applies left→right, so `transform="<GP> <P> <childTransform>"` =
 *  `GP ∘ P ∘ child` — nested groups, slice 45e). */
export function groupTransformPrefix(objects: SceneObject[], obj: SceneObject, time: number): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = parentGroupOf(objects, obj);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); // cycle guard
    parts.push(buildTransform(sampleObject(cur, time), cur.anchorX, cur.anchorY));
    cur = parentGroupOf(objects, cur); // walk up the chain
  }
  return parts.reverse().join(' '); // outermost ancestor first
}

/** Apply a 2D point through `buildTransform`'s matrix: M(p) = (x,y) + a + R(rot)·S·(p − a). */
export function mapPoint(
  t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  ax: number,
  ay: number,
  px: number,
  py: number,
): { x: number; y: number } {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const ex = t.scaleX * (px - ax);
  const ey = t.scaleY * (py - ay);
  return { x: t.x + ax + (c * ex - s * ey), y: t.y + ay + (s * ex + c * ey) };
}

/** Bake a group container's (static) transform into a child so its WORLD position is
 *  preserved after the group is dissolved (ungroup). Returns the child with `parentId`
 *  cleared and `base` adjusted. EXACT for translate / uniform-scale / rotate; a
 *  non-uniformly-scaled rotated group introduces shear (not representable as a Transform2D)
 *  — a documented v1 limitation. Bakes the static base; an ANIMATED child under a
 *  transformed group is approximate (the group transform is static, so the common case —
 *  identity/translate group — is exact regardless of child animation).
 *
 *  `childAnchorX/Y` are the child's ABSOLUTE anchor (resolved by the caller for fractional
 *  vector anchors). */
export function bakeGroupIntoChild(
  group: SceneObject,
  child: SceneObject,
  childAnchorX: number,
  childAnchorY: number,
): SceneObject {
  const gs = sampleObject(group, 0); // bake the group's T=0 transform (an ANIMATED group's later keyframes are dropped — 45d v1 limit)
  const cb = child.base;
  // Map the child's anchor POINT through the group transform; the anchor point of an object
  // is (anchor + base-translation) (the R·S term vanishes at p = anchor in the child frame).
  const mapped = mapPoint(gs, group.anchorX, group.anchorY, childAnchorX + cb.x, childAnchorY + cb.y);
  return {
    ...child,
    parentId: undefined,
    base: {
      ...cb,
      x: mapped.x - childAnchorX,
      y: mapped.y - childAnchorY,
      scaleX: cb.scaleX * gs.scaleX,
      scaleY: cb.scaleY * gs.scaleY,
      rotation: cb.rotation + gs.rotation,
    },
  };
}

/** One link in a world-transform chain: a sampled Transform2D-ish state plus the anchor
 *  (pivot) it rotates/scales about, as consumed by `mapPoint`. */
export interface WorldChainLink {
  state: RenderState;
  ax: number;
  ay: number;
}

/** The target object's own transform, then every group ancestor outermost-last (mapPoint
 *  composition order — innermost/object's own transform applied FIRST), so a point can be
 *  mapped through the whole chain by folding `mapPoint` over the array in order. Hoists the
 *  per-frame sampling of each chain link OUTSIDE the per-node point loop of a caller (every
 *  node/handle of the same target reuses one chain).
 *
 *  Extracted from `resolveTextPath` (textPath.ts) so both it and `computeBlendSteps`
 *  (blend.ts, world-space blend) share the ONE definition of "an object's full parent-chain
 *  composed transform" — do not re-derive this per caller. Mirrors geom/boolean.ts's
 *  unexported `toWorld` (same `mapPoint` + `parentGroupOf` composition), which stays a local
 *  mirror rather than importing across the geom/ boundary (deliberate precedent, see its own
 *  comment) — this export is for the non-geom/ callers. */
export function worldChain(project: Project, obj: SceneObject, ax: number, ay: number, time: number): WorldChainLink[] {
  const chain: WorldChainLink[] = [{ state: sampleObject(obj, time), ax, ay }];
  let cur = parentGroupOf(project.objects, obj);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push({ state: sampleObject(cur, time), ax: cur.anchorX, ay: cur.anchorY });
    cur = parentGroupOf(project.objects, cur);
  }
  return chain;
}

function applyWorldChain(chain: WorldChainLink[], p: PathPoint): PathPoint {
  let q = p;
  for (const link of chain) {
    q = mapPoint(link.state, link.ax, link.ay, q.x, q.y);
  }
  return q;
}

/** Transform one PathNode through the world chain. Handles (`in`/`out`) are ANCHOR-RELATIVE
 *  OFFSETS, not absolute points: mapping them naively as points (as if they were their own
 *  anchor) would apply the chain's TRANSLATION to the offset too, which is wrong. Each chain
 *  link is affine (mapPoint = translate + rotate + scale) and composition of affine maps is
 *  affine (world(p) = A·p + b for some fixed A,b), so:
 *    world(anchor + offset) - world(anchor) = (A·anchor + A·offset + b) - (A·anchor + b) = A·offset
 *  — i.e. transforming the ABSOLUTE point (anchor+offset) and subtracting the transformed
 *  anchor gives exactly the rotated/scaled (never translated) handle offset, correct for the
 *  WHOLE composed chain (not just a single rotation/scale level). Hand-verified with a
 *  rotated+scaled target in textPath.test.ts. */
export function worldTransformNode(chain: WorldChainLink[], n: PathNode): PathNode {
  const worldAnchor = applyWorldChain(chain, n.anchor);
  const node: PathNode = { anchor: worldAnchor };
  if (n.in) {
    const worldAbs = applyWorldChain(chain, { x: n.anchor.x + n.in.x, y: n.anchor.y + n.in.y });
    node.in = { x: worldAbs.x - worldAnchor.x, y: worldAbs.y - worldAnchor.y };
  }
  if (n.out) {
    const worldAbs = applyWorldChain(chain, { x: n.anchor.x + n.out.x, y: n.anchor.y + n.out.y });
    node.out = { x: worldAbs.x - worldAnchor.x, y: worldAbs.y - worldAnchor.y };
  }
  return node;
}

/** Inverse of mapPoint: solve M(p) = q for p, i.e. p = a + S⁻¹·R⁻¹·(q − (x,y) − a). */
function invMapPoint(
  t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  ax: number,
  ay: number,
  qx: number,
  qy: number,
): { x: number; y: number } {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = qx - t.x - ax;
  const dy = qy - t.y - ay;
  const rx = c * dx + s * dy; // R⁻¹ row 1
  const ry = -s * dx + c * dy; // R⁻¹ row 2
  return { x: ax + rx / t.scaleX, y: ay + ry / t.scaleY };
}

/** Inverse of bakeGroupIntoChild: place `child` (currently in `group`'s PARENT space) into
 *  `group`'s LOCAL space with `parentId = group.id`, so re-composing the group transform onto
 *  it reproduces the child's current world position — drag-reparent INTO a group (slice 45f).
 *  Exact for translate/uniform-scale/rotate (same shear caveat as bakeGroupIntoChild). */
export function unbakeGroupFromChild(
  group: SceneObject,
  child: SceneObject,
  childAnchorX: number,
  childAnchorY: number,
): SceneObject {
  const gs = sampleObject(group, 0);
  const cb = child.base;
  const local = invMapPoint(gs, group.anchorX, group.anchorY, childAnchorX + cb.x, childAnchorY + cb.y);
  return {
    ...child,
    parentId: group.id,
    base: {
      ...cb,
      x: local.x - childAnchorX,
      y: local.y - childAnchorY,
      scaleX: cb.scaleX / gs.scaleX,
      scaleY: cb.scaleY / gs.scaleY,
      rotation: cb.rotation - gs.rotation,
    },
  };
}
