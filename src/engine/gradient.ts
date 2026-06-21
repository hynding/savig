import { fmt } from './transform';
import { escapeAttr } from './svgAttr';
import type { Gradient, GradientStop, LinearGradient } from './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Reference string for a gradient by id, e.g. url(#savig-grad-abc-fill). */
export function paintRef(id: string): string {
  return `url(#${id})`;
}

/** A stop's RAW attributes (offset/stop-color, stop-opacity only when < 1). The
 *  single source of truth for a stop, shared by the string emitter (with
 *  escapeAttr) and the runtime DOM builder (setAttribute, which auto-escapes). */
export function gradientStopAttrs(s: GradientStop): Record<string, string> {
  const attrs: Record<string, string> = {
    offset: fmt(clamp01(s.offset)),
    'stop-color': s.color,
  };
  if (s.opacity !== undefined && s.opacity < 1) attrs['stop-opacity'] = fmt(clamp01(s.opacity));
  return attrs;
}

function stopToSvg(s: GradientStop): string {
  const attrStr = Object.entries(gradientStopAttrs(s))
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  return `<stop ${attrStr}/>`;
}

/** The gradient element's coordinate attributes (no id, no stops). */
export function gradientAttrs(g: Gradient): Record<string, string> {
  if (g.type === 'linear') {
    return { x1: fmt(g.x1), y1: fmt(g.y1), x2: fmt(g.x2), y2: fmt(g.y2) };
  }
  const attrs: Record<string, string> = { cx: fmt(g.cx), cy: fmt(g.cy), r: fmt(g.r) };
  if (g.fx !== undefined) attrs.fx = fmt(g.fx);
  if (g.fy !== undefined) attrs.fy = fmt(g.fy);
  return attrs;
}

/** The `<stop>` children markup for a gradient. */
export function gradientStopsMarkup(g: Gradient): string {
  return g.stops.map(stopToSvg).join('');
}

/**
 * Emit a <linearGradient>/<radialGradient> def with <stop> children. No
 * gradientUnits attribute (objectBoundingBox default). Pure: numbers via fmt,
 * colors via escapeAttr; offset/opacity clamped to [0,1].
 */
export function gradientToSvg(id: string, g: Gradient): string {
  const stops = gradientStopsMarkup(g);
  const attrs = Object.entries(gradientAttrs(g))
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  const tag = g.type === 'linear' ? 'linearGradient' : 'radialGradient';
  return `<${tag} id="${escapeAttr(id)}" ${attrs}>${stops}</${tag}>`;
}

/** A two-stop gradient (seedColor -> white), horizontal linear / centered radial. */
export function defaultGradient(type: 'linear' | 'radial', seedColor?: string): Gradient {
  const stops: GradientStop[] = [
    { offset: 0, color: seedColor ?? '#000000' },
    { offset: 1, color: '#ffffff' },
  ];
  return type === 'linear'
    ? { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops }
    : { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops };
}

// Angle in degrees, 0 = left->right, increasing clockwise (y grows downward).
// Endpoints are the unit-bbox diameter through the center along the angle.
export function angleToLinearCoords(deg: number): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

export function linearCoordsToAngle(g: LinearGradient): number {
  const deg = (Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}
