import { pathBounds } from './path';
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
): LocalRect {
  if (shapeType === 'rect') {
    return { x: 0, y: 0, width: geometry.width ?? 0, height: geometry.height ?? 0 };
  }
  if (shapeType === 'ellipse') {
    return { x: 0, y: 0, width: 2 * (geometry.radiusX ?? 0), height: 2 * (geometry.radiusY ?? 0) };
  }
  return pathBounds(path ?? EMPTY_PATH);
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
