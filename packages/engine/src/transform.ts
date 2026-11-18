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
  // 3D rotation (spec 2026-11-18-3d-rotation): the orthographic projection of rotateX·rotateY,
  // innermost after scale. Emitted only when non-zero so flat transforms stay byte-identical.
  if (t.rotationX || t.rotationY) {
    const [a, b, c, d] = tiltMatrix(t.rotationX, t.rotationY);
    // Six decimals: the coefficients multiply local coordinates, so 1e-4 would drift on big drawings.
    const f6 = (n: number) => String(Object.is(Math.round(n * 1e6) / 1e6, -0) ? 0 : Math.round(n * 1e6) / 1e6);
    parts.push(`matrix(${f6(a)}, ${f6(b)}, ${f6(c)}, ${f6(d)}, 0, 0)`);
  }
  parts.push(`scale(${fmt(t.scaleX)}, ${fmt(t.scaleY)})`, `translate(${fmt(-anchorX)}, ${fmt(-anchorY)})`);
  return parts.join(' ');
}

/** The 2×2 linear part [a, b, c, d] (SVG matrix order: x' = a·x + c·y, y' = b·x + d·y) of the
 *  orthographic projection of rotateX(rx)·rotateY(ry) — the same order as CSS
 *  `rotateX(rx) rotateY(ry)`, so a point turns about Y first, then tips about X. */
export function tiltMatrix(rxDeg: number | undefined, ryDeg: number | undefined): [number, number, number, number] {
  const rx = ((rxDeg ?? 0) * Math.PI) / 180;
  const ry = ((ryDeg ?? 0) * Math.PI) / 180;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  return [cy, sx * sy, 0, cx];
}

/** Tilt a local offset (dx, dy) by the 3D rotation's projection. */
export function tiltOffset(rxDeg: number | undefined, ryDeg: number | undefined, dx: number, dy: number): { x: number; y: number } {
  if (!rxDeg && !ryDeg) return { x: dx, y: dy };
  const [a, b, c, d] = tiltMatrix(rxDeg, ryDeg);
  return { x: a * dx + c * dy, y: b * dx + d * dy };
}

/** Undo `tiltOffset`. Edge-on (90°) has no inverse; the determinant is kept off zero so callers
 *  get a large but finite point instead of NaN. */
export function untiltOffset(rxDeg: number | undefined, ryDeg: number | undefined, x: number, y: number): { x: number; y: number } {
  if (!rxDeg && !ryDeg) return { x, y };
  const [a, b, c, d] = tiltMatrix(rxDeg, ryDeg);
  let det = a * d - b * c;
  if (Math.abs(det) < 1e-6) det = det < 0 ? -1e-6 : 1e-6;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
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
