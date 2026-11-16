/** resvg ignores the SVG `pathLength` attribute, so SaViG's pathLength-normalized dashes, trim
 *  paths and text-on-path offsets (all expressed in 0..1 of the path) rasterize as if the path
 *  were one user unit long: a dashed stroke turns into a grey smear and a trim never draws on.
 *  Browsers honour pathLength, so the editor and the SVG/HTML exports look right — only the
 *  resvg-backed PNG / GIF / thumbnail renders were wrong.
 *
 *  `resolvePathLengths` rewrites a baked frame into its absolute equivalent before rasterizing:
 *  for every element carrying `pathLength`, the dash array, dash offset and any `<textPath>`
 *  `startOffset` that points at it are scaled by (real length / pathLength), and the attribute
 *  is dropped. That is exactly what the attribute means in SVG, so the result renders the same
 *  in a browser with or without it. Lengths are measured in the element's own user space, the
 *  same space the dash values live in, so transforms never enter into it. */

type Pt = { x: number; y: number };

const ARC_STEPS = 64;
const CURVE_STEPS = 64;

function num(el: Element, name: string): number {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(v) ? v : 0;
}

/** Perimeter of an ellipse by numeric integration (exact to well under a pixel). */
export function ellipsePerimeter(rx: number, ry: number): number {
  if (rx <= 0 || ry <= 0) return 0;
  const n = 1024;
  let len = 0;
  let prev: Pt = { x: rx, y: 0 };
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = { x: rx * Math.cos(a), y: ry * Math.sin(a) };
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

/** Perimeter of an SVG <rect>, with the spec's rx/ry auto + clamping rules. */
export function rectPerimeter(width: number, height: number, rxAttr?: number, ryAttr?: number): number {
  if (width <= 0 || height <= 0) return 0;
  let rx = rxAttr ?? ryAttr ?? 0;
  let ry = ryAttr ?? rxAttr ?? 0;
  rx = Math.min(Math.max(0, rx), width / 2);
  ry = Math.min(Math.max(0, ry), height / 2);
  if (rx === 0 || ry === 0) return 2 * (width + height);
  return 2 * (width - 2 * rx) + 2 * (height - 2 * ry) + ellipsePerimeter(rx, ry);
}

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? parseFloat(m[2]));
  return out;
}

function sampleLength(f: (t: number) => Pt, steps: number): number {
  let len = 0;
  let prev = f(0);
  for (let i = 1; i <= steps; i++) {
    const p = f(i / steps);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

function arcLength(p0: Pt, rxIn: number, ryIn: number, phiDeg: number, large: boolean, sweep: boolean, p1: Pt): number {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num2 / den));
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dtheta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dtheta > 0) dtheta -= Math.PI * 2;
  else if (sweep && dtheta < 0) dtheta += Math.PI * 2;
  // Rotation doesn't change length, so measure the axis-aligned ellipse arc.
  return sampleLength((t) => {
    const a = theta1 + dtheta * t;
    return { x: rx * Math.cos(a), y: ry * Math.sin(a) };
  }, ARC_STEPS);
}

/** Total geometric length of an SVG path `d` string (all subpaths, all commands). */
export function svgPathLength(d: string): number {
  const toks = tokenize(d);
  let i = 0;
  let cmd = '';
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let lastCtrl: Pt | null = null; // reflected control for S/T
  let lastCmd = '';
  let len = 0;
  const next = () => toks[i++] as number;
  while (i < toks.length) {
    const t = toks[i];
    if (typeof t === 'string') {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        len += Math.hypot(start.x - cur.x, start.y - cur.y);
        cur = { ...start };
        lastCtrl = null;
        lastCmd = 'Z';
        continue;
      }
    } else if (!cmd) {
      i++;
      continue; // stray number before any command
    }
    if (typeof toks[i] !== 'number') continue;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cur.x : 0;
    const oy = rel ? cur.y : 0;
    const C = cmd.toUpperCase();
    switch (C) {
      case 'M': {
        cur = { x: ox + next(), y: oy + next() };
        start = { ...cur };
        lastCtrl = null;
        cmd = rel ? 'l' : 'L'; // implicit lineto for further pairs
        break;
      }
      case 'L': {
        const p = { x: ox + next(), y: oy + next() };
        len += Math.hypot(p.x - cur.x, p.y - cur.y);
        cur = p;
        lastCtrl = null;
        break;
      }
      case 'H': {
        const x = (rel ? cur.x : 0) + next();
        len += Math.abs(x - cur.x);
        cur = { x, y: cur.y };
        lastCtrl = null;
        break;
      }
      case 'V': {
        const y = (rel ? cur.y : 0) + next();
        len += Math.abs(y - cur.y);
        cur = { x: cur.x, y };
        lastCtrl = null;
        break;
      }
      case 'C':
      case 'S': {
        const c1: Pt = C === 'C'
          ? { x: ox + next(), y: oy + next() }
          : lastCtrl && (lastCmd === 'C' || lastCmd === 'S')
            ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y }
            : { ...cur };
        const c2 = { x: ox + next(), y: oy + next() };
        const p = { x: ox + next(), y: oy + next() };
        const p0 = cur;
        len += sampleLength((u) => {
          const v = 1 - u;
          return {
            x: v * v * v * p0.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * p.x,
            y: v * v * v * p0.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * p.y,
          };
        }, CURVE_STEPS);
        lastCtrl = c2;
        cur = p;
        break;
      }
      case 'Q':
      case 'T': {
        const c: Pt = C === 'Q'
          ? { x: ox + next(), y: oy + next() }
          : lastCtrl && (lastCmd === 'Q' || lastCmd === 'T')
            ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y }
            : { ...cur };
        const p = { x: ox + next(), y: oy + next() };
        const p0 = cur;
        len += sampleLength((u) => {
          const v = 1 - u;
          return { x: v * v * p0.x + 2 * v * u * c.x + u * u * p.x, y: v * v * p0.y + 2 * v * u * c.y + u * u * p.y };
        }, CURVE_STEPS);
        lastCtrl = c;
        cur = p;
        break;
      }
      case 'A': {
        const rx = next();
        const ry = next();
        const phi = next();
        const large = next() !== 0;
        const sweep = next() !== 0;
        const p = { x: ox + next(), y: oy + next() };
        len += arcLength(cur, rx, ry, phi, large, sweep, p);
        cur = p;
        lastCtrl = null;
        break;
      }
      default:
        i++;
    }
    lastCmd = C === 'M' ? 'M' : C;
  }
  return len;
}

/** Geometric length of a shape element in its own user space; undefined for unsupported tags. */
export function elementLength(el: Element): number | undefined {
  switch (el.localName) {
    case 'path':
      return svgPathLength(el.getAttribute('d') ?? '');
    case 'rect': {
      const rx = el.hasAttribute('rx') ? num(el, 'rx') : undefined;
      const ry = el.hasAttribute('ry') ? num(el, 'ry') : undefined;
      return rectPerimeter(num(el, 'width'), num(el, 'height'), rx, ry);
    }
    case 'ellipse':
      return ellipsePerimeter(num(el, 'rx'), num(el, 'ry'));
    case 'circle':
      return ellipsePerimeter(num(el, 'r'), num(el, 'r'));
    case 'line':
      return Math.hypot(num(el, 'x2') - num(el, 'x1'), num(el, 'y2') - num(el, 'y1'));
    case 'polyline':
    case 'polygon': {
      const v = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      let len = 0;
      for (let k = 2; k + 1 < v.length; k += 2) len += Math.hypot(v[k] - v[k - 2], v[k + 1] - v[k - 1]);
      if (el.localName === 'polygon' && v.length >= 4) len += Math.hypot(v[0] - v[v.length - 2], v[1] - v[v.length - 1]);
      return len;
    }
    default:
      return undefined;
  }
}

const fmtLen = (v: number) => String(Math.round(v * 1e4) / 1e4);

function scaleList(value: string, k: number): string | undefined {
  const parts = value.trim().split(/[\s,]+/);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return undefined; // percentages, 'none', etc.
  return nums.map((n) => fmtLen(n * k)).join(' ');
}

/** Rewrite every `pathLength`-normalized value under `root` to absolute user units, in place. */
export function resolvePathLengths(root: Element): void {
  const doc = root.ownerDocument;
  for (const el of Array.from(root.querySelectorAll('[pathLength]'))) {
    const nominal = parseFloat(el.getAttribute('pathLength') ?? '');
    const len = elementLength(el);
    if (!(nominal > 0) || len === undefined) {
      el.removeAttribute('pathLength');
      continue;
    }
    const k = len / nominal;
    const dash = el.getAttribute('stroke-dasharray');
    if (dash && dash !== 'none') {
      const scaled = scaleList(dash, k);
      if (scaled !== undefined) el.setAttribute('stroke-dasharray', scaled);
    }
    const off = el.getAttribute('stroke-dashoffset');
    if (off !== null && Number.isFinite(Number(off))) el.setAttribute('stroke-dashoffset', fmtLen(Number(off) * k));
    const id = el.getAttribute('id');
    if (id && doc) {
      for (const tp of Array.from(root.querySelectorAll('textPath'))) {
        const href = tp.getAttribute('href') ?? tp.getAttribute('xlink:href');
        if (href !== `#${id}`) continue;
        const so = tp.getAttribute('startOffset');
        if (so !== null && Number.isFinite(Number(so))) tp.setAttribute('startOffset', fmtLen(Number(so) * k));
      }
    }
    el.removeAttribute('pathLength');
  }
}
