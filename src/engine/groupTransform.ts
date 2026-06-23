// Group-container composition (slice 45). A group is a static container object (`isGroup`)
// whose transform composes onto its children at COMPUTE time via a prepended transform
// string — no DOM nesting. Editor-only/engine math; shared by computeFrame + renderDocument.

import { buildTransform } from './transform';
import { sampleObject } from './sample';
import type { Project, SceneObject } from './types';

/** The group container that `obj` belongs to (via `parentId`), or null. One level (v1). */
export function parentGroupOf(project: Project, obj: SceneObject): SceneObject | null {
  if (!obj.parentId) return null;
  const g = project.objects.find((o) => o.id === obj.parentId && o.isGroup);
  return g ?? null;
}

/** The transform STRING to prepend to a child's own transform so it renders inside its
 *  group container. `''` when the object has no group parent. SVG composes
 *  `transform="<prefix> <childTransform>"` exactly (group outer, child inner). */
export function groupTransformPrefix(project: Project, obj: SceneObject, time: number): string {
  const group = parentGroupOf(project, obj);
  if (!group) return '';
  const gs = sampleObject(group, time);
  return buildTransform(gs, group.anchorX, group.anchorY);
}

/** Apply a 2D point through `buildTransform`'s matrix: M(p) = (x,y) + a + R(rot)·S·(p − a). */
function mapPoint(
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
  const gs = sampleObject(group, 0); // static container -> time-independent
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
