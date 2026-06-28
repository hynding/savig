// Group-container composition (slice 45). A group is a static container object (`isGroup`)
// whose transform composes onto its children at COMPUTE time via a prepended transform
// string — no DOM nesting. Editor-only/engine math; shared by computeFrame + renderDocument.

import { buildTransform } from './transform';
import { sampleObject } from './sample';
import type { SceneObject } from './types';

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
