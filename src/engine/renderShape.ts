import { fmt } from './transform';
import { pathToD } from './path';
import { escapeAttr } from './svgAttr';
import { paintRef } from './gradient';
import type { PathData, ResolvedGeometry, VectorShapeType, VectorStyle } from './types';

// Resolved geometry -> SVG attributes. The SINGLE definition shared by
// renderShapeToSvg (initial/static markup) and the per-frame runtime update,
// so animated geometry previews == exports. All numbers go through fmt().
// rect/ellipse only — a path's geometry is its `d` (see pathToD), never scalar
// attrs. Excluding 'path' from the type turns any accidental path call into a
// compile error (defense against silently rendering a path as a 0-radius ellipse).
export function geometryToSvgAttrs(
  shapeType: Exclude<VectorShapeType, 'path'>,
  geometry: ResolvedGeometry,
): Record<string, string> {
  if (shapeType === 'rect') {
    const attrs: Record<string, string> = {
      x: fmt(0),
      y: fmt(0),
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

function styleToSvgAttrs(
  style: VectorStyle,
  idScope?: string,
  gradientPaint?: { fill?: boolean; stroke?: boolean },
): Record<string, string> {
  const fillGrad = !!style.fillGradient || !!gradientPaint?.fill;
  const strokeGrad = !!style.strokeGradient || !!gradientPaint?.stroke;
  const fill = fillGrad && idScope ? paintRef(`savig-grad-${idScope}-fill`) : style.fill;
  const stroke = strokeGrad && idScope ? paintRef(`savig-grad-${idScope}-stroke`) : style.stroke;
  const attrs: Record<string, string> = {
    fill,
    stroke,
    'stroke-width': fmt(style.strokeWidth),
  };
  if (style.strokeLinecap !== undefined) attrs['stroke-linecap'] = style.strokeLinecap;
  if (style.strokeLinejoin !== undefined) attrs['stroke-linejoin'] = style.strokeLinejoin;
  return attrs;
}

export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
  path?: PathData,
  idScope?: string,
  gradientPaint?: { fill?: boolean; stroke?: boolean },
): string {
  if (shapeType === 'path') {
    if (!path || path.nodes.length === 0) return '';
    const attrs = { d: pathToD(path), ...styleToSvgAttrs(style, idScope, gradientPaint) };
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(' ');
    return `<path ${attrStr}/>`;
  }
  const tag = shapeType === 'rect' ? 'rect' : 'ellipse';
  const attrs = { ...geometryToSvgAttrs(shapeType, geometry), ...styleToSvgAttrs(style, idScope, gradientPaint) };
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<${tag} ${attrStr}/>`;
}
