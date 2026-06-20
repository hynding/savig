import { fmt } from './transform';
import type { ResolvedGeometry, VectorShapeType, VectorStyle } from './types';

// Resolved geometry -> SVG attributes. The SINGLE definition shared by
// renderShapeToSvg (initial/static markup) and the per-frame runtime update,
// so animated geometry previews == exports. All numbers go through fmt().
export function geometryToSvgAttrs(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
): Record<string, string> {
  if (shapeType === 'rect') {
    const attrs: Record<string, string> = {
      x: '0',
      y: '0',
      width: fmt(Math.max(0, geometry.width ?? 0)),
      height: fmt(Math.max(0, geometry.height ?? 0)),
    };
    if (geometry.cornerRadius !== undefined) {
      const r = fmt(Math.max(0, geometry.cornerRadius));
      attrs.rx = r;
      attrs.ry = r;
    }
    return attrs;
  }
  const rx = Math.max(0, geometry.radiusX ?? 0);
  const ry = Math.max(0, geometry.radiusY ?? 0);
  return { cx: fmt(rx), cy: fmt(ry), rx: fmt(rx), ry: fmt(ry) };
}

function styleToSvgAttrs(style: VectorStyle): Record<string, string> {
  return {
    fill: style.fill,
    stroke: style.stroke,
    'stroke-width': fmt(style.strokeWidth),
  };
}

export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
): string {
  const tag = shapeType === 'rect' ? 'rect' : 'ellipse';
  const attrs = { ...geometryToSvgAttrs(shapeType, geometry), ...styleToSvgAttrs(style) };
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return `<${tag} ${attrStr}/>`;
}
