// Pure 2D-affine helpers for the SMIL exporter: SMIL's <animateTransform> has no `matrix`
// type, so every sampled transform chain is collapsed to one matrix and decomposed into
// T·R·SkewX·S — reproducible as stacked additive animateTransforms.

/** SVG matrix [a,b,c,d,e,f]: x' = a·x + c·y + e; y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Parse an SVG transform list into one composed matrix. Accepts the two shapes the engine
 *  emits (buildTransform: comma-separated; cameraTransform: space-separated) plus matrix/skew
 *  for defense. Unknown functions throw (they cannot occur in engine output). */
export function parseTransform(s: string): Mat {
  let m = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  for (const match of s.matchAll(re)) {
    const fn = match[1];
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat;
    switch (fn) {
      case 'translate': t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]; break;
      case 'scale': t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const a = rad(args[0] ?? 0);
        const [cx, cy] = [args[1] ?? 0, args[2] ?? 0];
        const [cos, sin] = [Math.cos(a), Math.sin(a)];
        // translate(cx,cy) · rotate(a) · translate(-cx,-cy)
        t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(rad(args[0] ?? 0)), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(rad(args[0] ?? 0)), 0, 1, 0, 0]; break;
      case 'matrix': t = [args[0], args[1], args[2], args[3], args[4], args[5]]; break;
      default: throw new Error(`Unsupported transform function "${fn}"`);
    }
    m = multiply(m, t);
  }
  return m;
}

export interface Decomposed {
  tx: number; ty: number;
  /** degrees */ rotation: number;
  /** degrees */ skewX: number;
  scaleX: number; scaleY: number;
}

/** Exact T·R(θ)·SkewX(φ)·S decomposition of an affine matrix.
 *  Derivation (a=cosθ·sx, b=sinθ·sx, c=(cosθ·k−sinθ)·sy, d=(sinθ·k+cosθ)·sy, k=tanφ):
 *  sx=√(a²+b²), θ=atan2(b,a), sy=det/sx, k=(a·c+b·d)/det.
 *  Degenerate (sx≈0): rotation/skew are unobservable — return 0 angles and raw scales. */
export function decompose(m: Mat): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  if (sx < 1e-9) return { tx: e, ty: f, rotation: 0, skewX: 0, scaleX: 0, scaleY: Math.hypot(c, d) };
  const det = a * d - b * c;
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  const sy = det / sx;
  const skewX = sy === 0 ? 0 : (Math.atan((a * c + b * d) / det) * 180) / Math.PI;
  return { tx: e, ty: f, rotation, skewX, scaleX: sx, scaleY: sy };
}

/** Make an angle series continuous: SMIL interpolates values literally, so a sampled rotation
 *  crossing ±180 (atan2 wraps) must be unwrapped or the tween spins the wrong way. */
export function unwrapDegrees(values: number[]): number[] {
  const out = values.slice(0, 1);
  for (let i = 1; i < values.length; i++) {
    let v = values[i];
    const prev = out[i - 1];
    while (v - prev > 180) v -= 360;
    while (prev - v > 180) v += 360;
    out.push(v);
  }
  return out;
}
