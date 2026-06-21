import { pathBounds } from './path';
import type { PathData, ResolvedGeometry, VectorShapeType } from './types';

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
