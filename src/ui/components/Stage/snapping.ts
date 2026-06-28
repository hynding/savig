// Pure object-snapping for the select-tool move drag (editor-only chrome; never
// touches geometry data, export, the runtime, or persistence). See spec slice 33.

import { pathBounds, resolveAnchor, sampleObject, shapeLocalBBox, parentGroupOf, mapPoint } from '../../../engine';
import type { Asset, LocalRect, RenderState, SceneObject } from '../../../engine';

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface XformParams {
  anchorX: number;
  anchorY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  baseX: number;
  baseY: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guideX: number | null;
  guideY: number | null;
}

export const SNAP_PX = 6;

// content(p) = anchor + R(rot)·diag(sx,sy)·(p−anchor) + base, then the AABB of the
// four transformed corners (correct for rotated objects).
export function transformedAABB(
  rect: { x: number; y: number; width: number; height: number },
  t: XformParams,
): AABB {
  const rad = (t.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    const ex = t.scaleX * (p.x - t.anchorX);
    const ey = t.scaleY * (p.y - t.anchorY);
    const x = t.anchorX + (c * ex - s * ey) + t.baseX;
    const y = t.anchorY + (s * ex + c * ey) + t.baseY;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function linesX(b: AABB): number[] {
  return [b.minX, (b.minX + b.maxX) / 2, b.maxX];
}
function linesY(b: AABB): number[] {
  return [b.minY, (b.minY + b.maxY) / 2, b.maxY];
}

// Nearest (movingLine, targetLine) pair strictly within `threshold`; first wins on a tie.
function bestAxis(
  movingLines: number[],
  targets: AABB[],
  pick: (b: AABB) => number[],
  threshold: number,
): { delta: number; guide: number | null } {
  let delta = 0;
  let guide: number | null = null;
  let bestAbs = threshold + 1;
  for (const tb of targets) {
    for (const tl of pick(tb)) {
      for (const ml of movingLines) {
        const d = tl - ml;
        const ad = Math.abs(d);
        if (ad <= threshold && ad < bestAbs) {
          bestAbs = ad;
          delta = d;
          guide = tl;
        }
      }
    }
  }
  return { delta, guide };
}

// The offset to align `moving` to the nearest target edge/centre on each axis
// independently, plus the guide-line coordinates to draw (null when no axis snap).
export function computeSnap(moving: AABB, targets: AABB[], threshold: number): SnapResult {
  const x = bestAxis(linesX(moving), targets, linesX, threshold);
  const y = bestAxis(linesY(moving), targets, linesY, threshold);
  return { dx: x.delta, dy: y.delta, guideX: x.guide, guideY: y.guide };
}

// AABB overlap (edge-touch counts). Used by marquee selection (slice 38).
export function aabbIntersect(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// Union of several AABBs (the group bbox for a multi-selection, slice 40). null if empty.
export function groupBBox(boxes: AABB[]): AABB | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }));
}

// The object's ABSOLUTE pivot in object-local coords (for the live drag preview AND
// snapping). Vector objects use `anchorMode:'fraction'`, so the raw obj.anchorX/Y
// (e.g. 0.5) must be resolved against the shape bbox via resolveAnchor — never passed to
// buildTransform directly. Mirrors the rotate-handle resolution; null for audio.
export function resolveObjectAnchor(
  obj: SceneObject,
  asset: Asset | undefined,
  state: RenderState,
): { anchorX: number; anchorY: number; bbox: LocalRect } | null {
  if (!asset) return null;
  if (asset.kind === 'vector') {
    const sampledPath =
      asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
    const bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath, asset.compoundRings);
    const anchor = resolveAnchor(obj, state, asset.shapeType, sampledPath ? pathBounds(sampledPath) : undefined);
    return { anchorX: anchor.anchorX, anchorY: anchor.anchorY, bbox };
  }
  if (asset.kind === 'svg') {
    const anchor = resolveAnchor(obj, state, undefined);
    return { anchorX: anchor.anchorX, anchorY: anchor.anchorY, bbox: { x: 0, y: 0, width: asset.width, height: asset.height } };
  }
  return null;
}

// The object's axis-aligned stage-space bounding box (move-drag snapping, align/distribute).
// Returns null for assets without a box (audio).
export function objectAABB(obj: SceneObject, asset: Asset | undefined, time: number): AABB | null {
  const state = sampleObject(obj, time);
  const resolved = resolveObjectAnchor(obj, asset, state);
  if (!resolved) return null;
  return transformedAABB(resolved.bbox, {
    anchorX: resolved.anchorX,
    anchorY: resolved.anchorY,
    scaleX: state.scaleX,
    scaleY: state.scaleY,
    rotationDeg: state.rotation,
    baseX: state.x,
    baseY: state.y,
  });
}

// The stage AABB of a group CONTAINER (slice 45b): the union of its children's AABBs, each
// mapped through the group's transform M(p) = (gx,gy) + ga + R(grot)·S(gsx,gsy)·(p − ga).
// Null when the group has no children. Used for the group's bbox handles.
export function groupAABB(
  group: SceneObject,
  objects: SceneObject[],
  assets: Asset[],
  time: number,
  seen: Set<string> = new Set(),
  seenAssets: Set<string> = new Set(), // instance cycle guard, threaded for group→instance children (47b)
): AABB | null {
  if (seen.has(group.id)) return null; // cycle guard (corrupt parentId chain)
  seen.add(group.id);
  const children = objects.filter((o) => o.parentId === group.id);
  if (children.length === 0) return null;
  const gs = sampleObject(group, time);
  const rad = (gs.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const map = (px: number, py: number) => {
    const ex = gs.scaleX * (px - group.anchorX);
    const ey = gs.scaleY * (py - group.anchorY);
    return { x: gs.x + group.anchorX + (c * ex - s * ey), y: gs.y + group.anchorY + (s * ex + c * ey) };
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of children) {
    // A nested group child contributes its own (recursive) bbox; a symbol-instance child
    // contributes its instanceAABB (47b); a plain leaf uses objectAABB (45e).
    const cb = child.isGroup
      ? groupAABB(child, objects, assets, time, seen, seenAssets)
      : isSymbolInstance(child, assets)
        ? instanceAABB(child, assets, time, seenAssets)
        : objectAABB(child, assets.find((a) => a.id === child.assetId), time);
    if (!cb) continue;
    for (const [px, py] of [[cb.minX, cb.minY], [cb.maxX, cb.minY], [cb.maxX, cb.maxY], [cb.minX, cb.maxY]] as const) {
      const m = map(px, py);
      if (m.x < minX) minX = m.x;
      if (m.y < minY) minY = m.y;
      if (m.x > maxX) maxX = m.x;
      if (m.y > maxY) maxY = m.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

// True when an object is a symbol INSTANCE: its asset resolves to a SymbolAsset (slice 47b).
export function isSymbolInstance(obj: SceneObject, assets: Asset[]): boolean {
  return assets.find((a) => a.id === obj.assetId)?.kind === 'symbol';
}

// The stage AABB of a single symbol INSTANCE (slice 47b): the symbol scene's content box mapped
// through the instance's transform M(p) = (x,y) + anchor + R(rot)·S(sx,sy)·(p − anchor) — the
// SAME M as groupAABB. Null when the symbol is missing/empty. Cycle-guarded by a visited-ASSET
// set: a symbol may not (transitively) contain itself (mirrors flattenInstances guard #1).
export function instanceAABB(
  instance: SceneObject,
  assets: Asset[],
  time: number,
  seenAssets: Set<string> = new Set(),
): AABB | null {
  const symbol = assets.find((a) => a.id === instance.assetId);
  if (!symbol || symbol.kind !== 'symbol') return null;
  if (seenAssets.has(symbol.id)) return null; // cycle guard
  const next = new Set(seenAssets);
  next.add(symbol.id);
  const content = sceneContentAABB(symbol.objects, assets, time, next);
  if (!content) return null;
  const is = sampleObject(instance, time);
  const rad = (is.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const map = (px: number, py: number) => {
    const ex = is.scaleX * (px - instance.anchorX);
    const ey = is.scaleY * (py - instance.anchorY);
    return { x: is.x + instance.anchorX + (c * ex - s * ey), y: is.y + instance.anchorY + (s * ex + c * ey) };
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of [[content.minX, content.minY], [content.maxX, content.minY], [content.maxX, content.maxY], [content.minX, content.maxY]] as const) {
    const m = map(px, py);
    if (m.x < minX) minX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.x > maxX) maxX = m.x;
    if (m.y > maxY) maxY = m.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

// The content AABB of a whole scene (a symbol's own objects[], or the top-level objects):
// the union of every TOP-LEVEL object's box — group → groupAABB, instance → instanceAABB, else
// → objectAABB. Children are reached through their group/instance, so parentId'd objects are
// skipped here (they would double-count). seenAssets threads the instance cycle guard down.
export function sceneContentAABB(
  objects: SceneObject[],
  assets: Asset[],
  time: number,
  seenAssets: Set<string> = new Set(),
): AABB | null {
  const boxes: AABB[] = [];
  for (const o of objects) {
    if (o.parentId) continue; // reached via its parent group
    let box: AABB | null;
    if (o.isGroup) box = groupAABB(o, objects, assets, time, new Set(), seenAssets); // thread instance cycle guard
    else if (isSymbolInstance(o, assets)) box = instanceAABB(o, assets, time, seenAssets);
    else box = objectAABB(o, assets.find((a) => a.id === o.assetId), time);
    if (box) boxes.push(box);
  }
  return groupBBox(boxes);
}

// Dispatch: the stage AABB of ANY entity — group container, symbol instance, or plain object.
// The single entry point Stage uses for selection bbox / snapping so all three kinds compose.
export function entityAABB(obj: SceneObject, objects: SceneObject[], assets: Asset[], time: number): AABB | null {
  if (obj.isGroup) return groupAABB(obj, objects, assets, time);
  if (isSymbolInstance(obj, assets)) return instanceAABB(obj, assets, time);
  return objectAABB(obj, assets.find((a) => a.id === obj.assetId), time);
}

// The union AABB of a MULTI-selection (slice 47b polish): each selected object contributes its
// entityAABB, so groups and symbol instances are included — not just plain vectors. Hidden/locked
// objects are skipped (not transformable). Null when nothing contributes.
export function multiSelectionAABB(
  ids: string[],
  objects: SceneObject[],
  assets: Asset[],
  time: number,
): AABB | null {
  const boxes: AABB[] = [];
  for (const id of ids) {
    const o = objects.find((x) => x.id === id);
    if (!o || o.hidden || o.locked) continue;
    const a = entityAABB(o, objects, assets, time);
    if (a) boxes.push(a);
  }
  return groupBBox(boxes);
}

/** A path object's node anchor points in CONTENT/stage coords (for node-vertex snapping). Empty for
 *  non-path assets or an empty path. Mirrors transformedAABB's local→content map, per node:
 *  content = anchor + R(rot)·S(scale)·(local − anchor) + base. */
export function pathContentVertices(
  obj: SceneObject,
  asset: Asset | undefined,
  time: number,
  objects?: SceneObject[],
): { x: number; y: number }[] {
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return [];
  const state = sampleObject(obj, time);
  const path = state.path ?? asset.path;
  if (!path || path.nodes.length === 0) return [];
  const resolved = resolveObjectAnchor(obj, asset, state);
  if (!resolved) return [];
  const rad = (state.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const map = (nx: number, ny: number) => {
    const ex = state.scaleX * (nx - resolved.anchorX);
    const ey = state.scaleY * (ny - resolved.anchorY);
    return { x: resolved.anchorX + (c * ex - s * ey) + state.x, y: resolved.anchorY + (s * ex + c * ey) + state.y };
  };
  let out = path.nodes.map((n) => map(n.anchor.x, n.anchor.y));
  // Also the nodes of any boolean-op compound rings — they share the same object transform/anchor as
  // the primary ring (the set objectAABB spans), so they're valid vertex targets too.
  for (const ring of asset.compoundRings ?? []) {
    for (const n of ring.nodes) out.push(map(n.anchor.x, n.anchor.y));
  }
  // When `objects` is supplied, compose the parent-group chain so a path inside a transformed group
  // yields correct WORLD content coords (mirrors toWorld's parent-chain walk; group anchors are absolute).
  if (objects) {
    let cur = parentGroupOf(objects, obj);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const gs = sampleObject(cur, time);
      const g = cur;
      out = out.map((p) => mapPoint(gs, g.anchorX, g.anchorY, p.x, p.y));
      cur = parentGroupOf(objects, cur);
    }
  }
  return out;
}

/** Snap-target vertices for a node-edit drag: every path's node anchors in WORLD content coords —
 *  OTHER paths in full, the SELF path EXCLUDING the dragged primary node (so a node can snap onto its
 *  own path's other vertices). Grouped paths are composed through their parent chain; group
 *  containers are skipped. `selfNodeIndex` is the dragged node's index in the self path's primary ring
 *  (pass -1 to include all self vertices, e.g. when no specific node is dragged). */
export function nodeSnapVertices(
  objects: SceneObject[],
  assets: Asset[],
  selfId: string,
  selfNodeIndex: number,
  time: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const o of objects) {
    if (o.isGroup) continue;
    const verts = pathContentVertices(o, assets.find((a) => a.id === o.assetId), time, objects);
    if (o.id === selfId) {
      out.push(...verts.filter((_, i) => i !== selfNodeIndex));
    } else {
      out.push(...verts);
    }
  }
  return out;
}

/** The nearest vertex (by 2D distance) within `threshold` of `p`, or null when none is close. Used
 *  to snap a dragged path node onto another path's node. */
export function snapToVertices(
  p: { x: number; y: number },
  vertices: { x: number; y: number }[],
  threshold: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = threshold;
  for (const v of vertices) {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}
