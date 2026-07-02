import { pathBoundsRings } from './path';
import type { Gradient, PathData, ResolvedGeometry, VectorShapeType } from './types';

export interface LocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EMPTY_PATH: PathData = { nodes: [], closed: false };

/** The object-local bbox a gradient's objectBoundingBox normalizes against. */
export function shapeLocalBBox(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  path?: PathData,
  compoundRings?: PathData[],
): LocalRect {
  if (shapeType === 'rect') {
    return { x: 0, y: 0, width: geometry.width ?? 0, height: geometry.height ?? 0 };
  }
  if (shapeType === 'ellipse') {
    return { x: 0, y: 0, width: 2 * (geometry.radiusX ?? 0), height: 2 * (geometry.radiusY ?? 0) };
  }
  return pathBoundsRings(path ?? EMPTY_PATH, compoundRings);
}

export type GradientHandleId = 'start' | 'end' | 'center' | 'radius' | 'focal';

export interface GradientHandle {
  id: GradientHandleId;
  /** Object-local coordinates. */
  x: number;
  y: number;
}

function toLocal(bbox: LocalRect, fx: number, fy: number): { x: number; y: number } {
  return { x: bbox.x + fx * bbox.width, y: bbox.y + fy * bbox.height };
}

/** Handle positions in object-local space. Linear -> [start, end];
 *  Radial -> [center, radius (center + r rightward), focal (defaults to center)]. */
export function gradientHandlePositions(g: Gradient, bbox: LocalRect): GradientHandle[] {
  if (g.type === 'linear') {
    return [
      { id: 'start', ...toLocal(bbox, g.x1, g.y1) },
      { id: 'end', ...toLocal(bbox, g.x2, g.y2) },
    ];
  }
  return [
    { id: 'center', ...toLocal(bbox, g.cx, g.cy) },
    { id: 'radius', ...toLocal(bbox, g.cx + g.r, g.cy) },
    { id: 'focal', ...toLocal(bbox, g.fx ?? g.cx, g.fy ?? g.cy) },
  ];
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function toFraction(bbox: LocalRect, x: number, y: number): { fx: number; fy: number } {
  return {
    fx: bbox.width === 0 ? 0 : (x - bbox.x) / bbox.width,
    fy: bbox.height === 0 ? 0 : (y - bbox.y) / bbox.height,
  };
}

/** Drag `handleId` to object-local point `local`; return the updated gradient.
 *  Fractions clamp to [0,1]; radial r clamps >= 0 (may exceed 1). */
export function applyGradientHandleDrag(
  g: Gradient,
  handleId: GradientHandleId,
  local: { x: number; y: number },
  bbox: LocalRect,
): Gradient {
  const { fx, fy } = toFraction(bbox, local.x, local.y);
  if (g.type === 'linear') {
    if (handleId === 'start') return { ...g, x1: clamp01(fx), y1: clamp01(fy) };
    if (handleId === 'end') return { ...g, x2: clamp01(fx), y2: clamp01(fy) };
    return g;
  }
  if (handleId === 'center') return { ...g, cx: clamp01(fx), cy: clamp01(fy) };
  if (handleId === 'focal') return { ...g, fx: clamp01(fx), fy: clamp01(fy) };
  if (handleId === 'radius') {
    return { ...g, r: Math.max(0, Math.hypot(fx - g.cx, fy - g.cy)) };
  }
  return g;
}
