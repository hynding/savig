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
  const parts = [
    `translate(${fmt(t.x)}, ${fmt(t.y)})`,
    `rotate(${fmt(t.rotation)}, ${fmt(anchorX)}, ${fmt(anchorY)})`,
    `translate(${fmt(anchorX)}, ${fmt(anchorY)})`,
  ];
  // Skew sits between rotation and scale, about the anchor (T·R·SkX·SkY·S). Emitted only when
  // non-zero so every unskewed transform string stays byte-identical.
  if (t.skewX) parts.push(`skewX(${fmt(t.skewX)})`);
  if (t.skewY) parts.push(`skewY(${fmt(t.skewY)})`);
  parts.push(`scale(${fmt(t.scaleX)}, ${fmt(t.scaleY)})`, `translate(${fmt(-anchorX)}, ${fmt(-anchorY)})`);
  return parts.join(' ');
}

/** Largest skew magnitude in degrees: tan(85°) ≈ 11.4, so a skewed drawing stays finite and
 *  pickable. Every sampled skew is clamped to ±MAX_SKEW. */
export const MAX_SKEW = 85;

export function clampSkew(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return Math.max(-MAX_SKEW, Math.min(MAX_SKEW, deg));
}

/** Skew a local offset (dx, dy): SkewX(kx)·SkewY(ky) applied to the scaled offset. */
export function skewOffset(kxDeg: number | undefined, kyDeg: number | undefined, dx: number, dy: number): { x: number; y: number } {
  const ty = kyDeg ? Math.tan((kyDeg * Math.PI) / 180) : 0;
  const tx = kxDeg ? Math.tan((kxDeg * Math.PI) / 180) : 0;
  const y1 = dy + ty * dx; // skewY first (rightmost of the two)
  return { x: dx + tx * y1, y: y1 };
}
