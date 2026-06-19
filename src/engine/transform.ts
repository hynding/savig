import type { Transform2D } from './types';

export function fmt(n: number): string {
  // Non-finite values would emit "NaN"/"Infinity" into the SVG attribute,
  // breaking rendering and byte-stable golden output; coerce to "0".
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1e4) / 1e4;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalized);
}

export function buildTransform(
  t: Transform2D,
  anchorX: number,
  anchorY: number,
): string {
  return [
    `translate(${fmt(t.x)}, ${fmt(t.y)})`,
    `rotate(${fmt(t.rotation)}, ${fmt(anchorX)}, ${fmt(anchorY)})`,
    `translate(${fmt(anchorX)}, ${fmt(anchorY)})`,
    `scale(${fmt(t.scaleX)}, ${fmt(t.scaleY)})`,
    `translate(${fmt(-anchorX)}, ${fmt(-anchorY)})`,
  ].join(' ');
}
