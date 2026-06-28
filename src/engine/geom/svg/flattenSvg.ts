// Flatten SVG markup to polygon rings, pure-JS (jsdom + the runtime bundle; DOMParser only, no
// browser SVG geometry APIs). Supports path/rect/circle/ellipse/polygon and <g transform> nesting;
// curves are flattened (cubic/quadratic De Casteljau, arc via SVG-spec endpoint->center). Fill regions
// only (no stroke); each subpath/shape -> one ring (holes union solid in v1).
import { parsePathD } from './parsePathD';
import type { SvgAsset } from '../../types';

export type Mat2x3 = [number, number, number, number, number, number]; // [a,b,c,d,e,f]
type Pair = [number, number];

const IDENTITY: Mat2x3 = [1, 0, 0, 1, 0, 0];
const SVG_CIRCLE_STEPS = 64;
const FLATTEN_STEPS = 16;
const ARC_STEPS = 16;

const apply = (m: Mat2x3, x: number, y: number): Pair => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// compose(A, B): the matrix M with apply(M, p) === apply(A, apply(B, p)).
function compose(a: Mat2x3, b: Mat2x3): Mat2x3 {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

const nums = (s: string): number[] =>
  s
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0)
    .map(Number);

/** Parse an SVG `transform` attribute (matrix/translate/scale/rotate/skewX/skewY), composed
 *  left-to-right. Identity for null/empty/unparseable parts. */
export function parseTransformList(s: string | null): Mat2x3 {
  if (!s) return IDENTITY;
  let m = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s)) !== null) {
    const name = match[1];
    const a = nums(match[2]);
    let t: Mat2x3 | null = null;
    if (name === 'matrix' && a.length === 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (name === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (name === 'scale') {
      const sx = Number.isFinite(a[0]) ? a[0] : 1;
      const sy = Number.isFinite(a[1]) ? a[1] : sx; // scale(s) -> uniform
      t = [sx, 0, 0, sy, 0, 0];
    }
    else if (name === 'rotate') {
      const r = ((a[0] || 0) * Math.PI) / 180;
      const rot: Mat2x3 = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      t = a.length >= 3 ? compose(compose([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]) : rot;
    } else if (name === 'skewX') t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === 'skewY') t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    if (t) m = compose(m, t);
  }
  return m;
}

const num = (el: Element, name: string, def = 0): number => {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(v) ? v : def;
};

function cubic(p0: Pair, c1: Pair, c2: Pair, p3: Pair, out: Pair[]): void {
  for (let s = 1; s <= FLATTEN_STEPS; s++) {
    const t = s / FLATTEN_STEPS;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
    ]);
  }
}

function quad(p0: Pair, c: Pair, p1: Pair, out: Pair[]): void {
  for (let s = 1; s <= FLATTEN_STEPS; s++) {
    const t = s / FLATTEN_STEPS;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
}

// SVG 1.1 F.6.5 arc endpoint -> center parameterization, sampled by sweep angle.
function arc(
  p0: Pair, rxIn: number, ryIn: number, rotDeg: number, large: boolean, sweep: boolean, end: Pair, out: Pair[],
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    out.push(end);
    return;
  }
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (p0[0] - end[0]) / 2;
  const dy = (p0[1] - end[1]) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = large !== sweep ? 1 : -1;
  const numr = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, numr / denom));
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * -(ry * x1p)) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0[0] + end[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0[1] + end[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  for (let s = 1; s <= ARC_STEPS; s++) {
    const th = theta1 + (delta * s) / ARC_STEPS;
    const ex = Math.cos(th) * rx;
    const ey = Math.sin(th) * ry;
    out.push([cx + cosP * ex - sinP * ey, cy + sinP * ex + cosP * ey]);
  }
}

/** Closed polygon rings (target frame = `ctm`) for ONE drawable element. [] for unsupported elements
 *  (g/text/line/polyline/unknown — the caller recurses into g). */
export function flattenElementToRings(el: Element, ctm: Mat2x3): Pair[][] {
  const tag = el.tagName.toLowerCase();
  const rings: Pair[][] = [];
  const push = (pts: Pair[]) => {
    if (pts.length >= 3) rings.push(pts.map(([x, y]) => apply(ctm, x, y)));
  };

  if (tag === 'rect') {
    const x = num(el, 'x');
    const y = num(el, 'y');
    const w = num(el, 'width');
    const h = num(el, 'height');
    if (w > 0 && h > 0) push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  } else if (tag === 'circle' || tag === 'ellipse') {
    const cx = num(el, 'cx');
    const cy = num(el, 'cy');
    const rx = tag === 'circle' ? num(el, 'r') : num(el, 'rx');
    const ry = tag === 'circle' ? num(el, 'r') : num(el, 'ry');
    if (rx > 0 && ry > 0) {
      const pts: Pair[] = [];
      for (let s = 0; s < SVG_CIRCLE_STEPS; s++) {
        const t = (s / SVG_CIRCLE_STEPS) * 2 * Math.PI;
        pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
      }
      push(pts);
    }
  } else if (tag === 'polygon') {
    const pts = nums(el.getAttribute('points') ?? '');
    const ring: Pair[] = [];
    for (let k = 0; k + 1 < pts.length; k += 2) ring.push([pts[k], pts[k + 1]]);
    push(ring);
  } else if (tag === 'path') {
    const cmds = parsePathD(el.getAttribute('d') ?? '');
    let ring: Pair[] = [];
    let px = 0;
    let py = 0;
    let startX = 0;
    let startY = 0;
    for (const c of cmds) {
      if (c.type === 'M') {
        push(ring);
        ring = [[c.x, c.y]];
        px = startX = c.x;
        py = startY = c.y;
      } else if (c.type === 'L') {
        ring.push([c.x, c.y]);
        px = c.x;
        py = c.y;
      } else if (c.type === 'C') {
        cubic([px, py], [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y], ring);
        px = c.x;
        py = c.y;
      } else if (c.type === 'Q') {
        quad([px, py], [c.x1, c.y1], [c.x, c.y], ring);
        px = c.x;
        py = c.y;
      } else if (c.type === 'A') {
        arc([px, py], c.rx, c.ry, c.rot, c.large, c.sweep, [c.x, c.y], ring);
        px = c.x;
        py = c.y;
      } else if (c.type === 'Z') {
        push(ring);
        ring = [];
        px = startX;
        py = startY;
      }
    }
    push(ring);
  }
  return rings;
}

function walk(node: Element, ctm: Mat2x3, out: Pair[][]): void {
  for (const child of Array.from(node.children)) {
    const local = compose(ctm, parseTransformList(child.getAttribute('transform')));
    const tag = child.tagName.toLowerCase();
    if (tag === 'g' || tag === 'svg') {
      walk(child, local, out);
    } else {
      try {
        out.push(...flattenElementToRings(child, local));
      } catch {
        // skip an element that fails to flatten; never corrupt the whole operand
      }
    }
  }
}

/** All filled-shape rings of an SVG asset in OBJECT-LOCAL coords (0..width x 0..height after the
 *  viewBox mapping). [] for empty / unsupported-only markup. Never throws. */
export function svgAssetRings(asset: SvgAsset): Pair[][] {
  let root: Element | null;
  try {
    root = new DOMParser().parseFromString(asset.normalizedContent, 'image/svg+xml').documentElement;
  } catch {
    return [];
  }
  if (!root || root.tagName === 'parsererror') return []; // DOMParser surfaces XML errors as a node
  // asset.viewBox (the normalized field) is canonical; fall back to the root attribute if absent.
  const vb = nums(asset.viewBox || root.getAttribute('viewBox') || '');
  let base: Mat2x3 = IDENTITY;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    base = compose([asset.width / vb[2], 0, 0, asset.height / vb[3], 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]);
  }
  const out: Pair[][] = [];
  walk(root, base, out);
  return out.filter((r) => r.length >= 3);
}
