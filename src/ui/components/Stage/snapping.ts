// Pure object-snapping for the select-tool move drag (editor-only chrome; never
// touches geometry data, export, the runtime, or persistence). See spec slice 33.

import { pathBounds, resolveAnchor, sampleObject, shapeLocalBBox } from '../../../engine';
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
    const bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
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
