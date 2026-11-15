// Lottie export (spec 2026-11-15-lottie-export). Converts a project to a Lottie (bodymovin 5.7)
// JSON animation that plays in lottie-web, lottie-ios, lottie-android and other Lottie players.
//
// Approach: SAMPLED, not translated. Every frame of the timeline is evaluated with the same scene
// walker the SVG exports use (`flattenInstances` + `sampleObject`), so everything that already
// renders — groups, symbol instances with time remaps, motion paths, springs, bones, skins, live
// booleans, path morphs — comes out right without a Lottie mapping per feature. Each drawn leaf
// becomes one shape layer whose channels are keyframed per frame and then thinned: a frame is
// dropped when linear interpolation between its neighbours already reproduces it, so a plain
// tween stays two keyframes while a spring keeps the frames it needs.
//
// The world transform of a leaf (its own transform under every group / instance transform) is one
// 2D affine matrix per frame, decomposed into Lottie's position / rotation / scale / skew with the
// anchor at the origin. Lottie applies, to a point p: P + R(r) · K(sk) · S(s) · (p - A), where
// K(sk) = [[1, -tan(sk)], [0, 1]] for skew axis 0 (lottie-web `skewFromAxis(-sk, sa)`), and R(r)
// rotates clockwise on screen for positive r, like SVG.
import {
  computeProjectDuration,
  flattenInstances,
  pathBounds,
  resolveAnchor,
  resolveBooleanRings,
  sampleObject,
  skinnedPath,
  buildTransform,
  KAPPA,
  parseHex,
} from '@savig/engine';
import type { BlendMode, InstanceLeaf, PathData, Project, VectorAsset } from '@savig/engine';

// ---- Lottie JSON shapes (the subset written) ----

export type LottieValue = number | number[] | LottieShapePath;
export interface LottieKeyframe {
  t: number;
  s: LottieValue[];
  h?: 1;
  i?: { x: number[]; y: number[] };
  o?: { x: number[]; y: number[] };
}
export interface LottieProperty {
  a: 0 | 1;
  k: LottieValue | LottieKeyframe[];
}
export interface LottieShapePath {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}
export interface LottieLayer {
  ddd: 0;
  ind: number;
  ty: number;
  nm: string;
  sr: 1;
  ks: Record<string, unknown>;
  ao: 0;
  shapes?: unknown[];
  ip: number;
  op: number;
  st: 0;
  bm: number;
  [extra: string]: unknown;
}
export interface LottieAnimation {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: unknown[];
  layers: LottieLayer[];
  meta: { g: string };
}

export interface LottieExportResult {
  animation: LottieAnimation;
  /** Things the export could not carry over (once each), for the UI / agent to report. */
  warnings: string[];
}

// ---- matrices ----

/** Column-convention affine [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (SVG order). */
export type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function mul(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Parse an SVG transform list (translate / rotate / scale / matrix / skewX / skewY). */
export function parseTransform(s: string): Affine {
  let m: Affine = IDENTITY;
  const re = /(matrix|translate|rotate|scale|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let hit = re.exec(s); hit; hit = re.exec(s)) {
    const a = hit[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Affine;
    switch (hit[1]) {
      case 'matrix':
        t = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(r);
        const sn = Math.sin(r);
        const cx = a[1] ?? 0;
        const cy = a[2] ?? 0;
        t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy];
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = mul(m, t);
  }
  return m;
}

export interface LottieTRS {
  x: number;
  y: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
  /** Percent. */
  scaleX: number;
  scaleY: number;
  /** Degrees (skew axis 0). */
  skew: number;
}

/** Decompose an affine into Lottie's P · R · K · S (anchor at the origin). */
export function decomposeAffine(m: Affine): LottieTRS {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const th = sx > 1e-12 ? Math.atan2(b, a) : 0;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const c2 = cos * c + sin * d; // = k · sy
  const sy = -sin * c + cos * d;
  const k = Math.abs(sy) > 1e-12 ? c2 / sy : 0;
  return { x: e, y: f, rotation: (th * 180) / Math.PI, scaleX: sx * 100, scaleY: sy * 100, skew: (-Math.atan(k) * 180) / Math.PI };
}

// ---- per-frame samples ----

interface Paint {
  /** [r, g, b] 0..1 */
  color: number[];
}
interface LeafSample {
  key: string;
  name: string;
  trs: LottieTRS;
  opacity: number;
  rings: PathData[];
  evenOdd: boolean;
  fill: Paint | null;
  stroke: (Paint & { width: number; cap: number; join: number }) | null;
  blend: number;
}

const BLEND_INDEX: Record<BlendMode, number> = {
  multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, 'color-dodge': 6, 'color-burn': 7,
  'hard-light': 8, 'soft-light': 9, difference: 10, exclusion: 11, hue: 12, saturation: 13, color: 14, luminosity: 15,
};

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080' };

/** CSS colour -> Lottie [r, g, b] (0..1), or null for none / unparseable. */
export function lottieColor(css: string | undefined): number[] | null {
  if (!css || css === 'none' || css === 'transparent') return null;
  const s = css.trim().toLowerCase();
  const hex = NAMED[s] ?? s;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  const rgb = parseHex(short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : hex.slice(0, 7));
  if (rgb) return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (fn) return [Number(fn[1]) / 255, Number(fn[2]) / 255, Number(fn[3]) / 255];
  return null;
}

function rectPath(w: number, h: number, r: number): PathData {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0) {
    return { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: w, y: 0 } }, { anchor: { x: w, y: h } }, { anchor: { x: 0, y: h } }] };
  }
  const k = rr * KAPPA;
  return {
    closed: true,
    nodes: [
      { anchor: { x: rr, y: 0 }, in: { x: -k, y: 0 } },
      { anchor: { x: w - rr, y: 0 }, out: { x: k, y: 0 } },
      { anchor: { x: w, y: rr }, in: { x: 0, y: -k } },
      { anchor: { x: w, y: h - rr }, out: { x: 0, y: k } },
      { anchor: { x: w - rr, y: h }, in: { x: k, y: 0 } },
      { anchor: { x: rr, y: h }, out: { x: -k, y: 0 } },
      { anchor: { x: 0, y: h - rr }, in: { x: 0, y: k } },
      { anchor: { x: 0, y: rr }, out: { x: 0, y: -k } },
    ],
  };
}

function ellipsePath(rx: number, ry: number): PathData {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    nodes: [
      { anchor: { x: rx, y: 0 }, in: { x: -kx, y: 0 }, out: { x: kx, y: 0 } },
      { anchor: { x: 2 * rx, y: ry }, in: { x: 0, y: -ky }, out: { x: 0, y: ky } },
      { anchor: { x: rx, y: 2 * ry }, in: { x: kx, y: 0 }, out: { x: -kx, y: 0 } },
      { anchor: { x: 0, y: ry }, in: { x: 0, y: ky }, out: { x: 0, y: -ky } },
    ],
  };
}

const CAP: Record<string, number> = { butt: 1, round: 2, square: 3 };
const JOIN: Record<string, number> = { miter: 1, round: 2, bevel: 3 };

class Warnings {
  private seen = new Set<string>();
  readonly list: string[] = [];
  add(msg: string): void {
    if (this.seen.has(msg)) return;
    this.seen.add(msg);
    this.list.push(msg);
  }
}

function sampleLeaf(project: Project, leaf: InstanceLeaf, warn: Warnings): LeafSample | null {
  const obj = leaf.object;
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset) return null;
  if (asset.kind !== 'vector') {
    warn.add(`"${obj.name}" is ${asset.kind === 'image' ? 'an image' : asset.kind === 'text' ? 'text' : `a ${asset.kind} asset`}, which the Lottie export does not include yet.`);
    return null;
  }
  const va = asset as VectorAsset;
  const state = sampleObject(obj, leaf.localTime, va.primitive);
  const box = va.shapeType === 'path' ? pathBounds(state.path ?? va.path ?? { nodes: [], closed: false }) : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, state, va.shapeType, box);
  const matrix = parseTransform(`${leaf.transformPrefix} ${buildTransform(state, anchorX, anchorY)}`);

  let rings: PathData[];
  if (obj.boolean) {
    rings = resolveBooleanRings(project, obj, leaf.localTime);
  } else if (va.shapeType === 'rect') {
    const g = state.geometry ?? {};
    rings = [rectPath(Math.max(0, g.width ?? 0), Math.max(0, g.height ?? 0), g.cornerRadius ?? 0)];
  } else if (va.shapeType === 'ellipse') {
    const g = state.geometry ?? {};
    rings = [ellipsePath(Math.max(0, g.radiusX ?? 0), Math.max(0, g.radiusY ?? 0))];
  } else {
    const base = state.path ?? va.path ?? { nodes: [], closed: false };
    const path = obj.skin ? skinnedPath(project.objects, obj, base, leaf.localTime) : base;
    rings = [path, ...(obj.shapeTrack?.length ? [] : va.compoundRings ?? [])];
  }

  const fillCss = state.fill ?? va.style.fill;
  const strokeCss = state.stroke ?? va.style.stroke;
  if (state.fillGradient ?? va.style.fillGradient) warn.add(`"${obj.name}" has a gradient fill, which the Lottie export draws as its first colour for now.`);
  if (state.strokeGradient ?? va.style.strokeGradient) warn.add(`"${obj.name}" has a gradient stroke, which the Lottie export draws as its first colour for now.`);
  const gradFirst = (g: { stops: { color: string }[] } | undefined) => (g?.stops?.[0] ? lottieColor(g.stops[0].color) : null);
  const fillColor = gradFirst(state.fillGradient ?? va.style.fillGradient) ?? lottieColor(fillCss);
  const strokeColor = gradFirst(state.strokeGradient ?? va.style.strokeGradient) ?? lottieColor(strokeCss);
  if (va.style.strokeDasharray?.length || state.trim) warn.add(`"${obj.name}" has a dashed or trimmed stroke, which the Lottie export draws solid for now.`);
  if (obj.filters?.some((f) => f.enabled !== false)) warn.add(`"${obj.name}" has filters, which Lottie players do not support; they are left out.`);

  return {
    key: leaf.renderId,
    name: obj.name,
    trs: decomposeAffine(matrix),
    opacity: leaf.exposed === false ? 0 : Math.max(0, Math.min(1, state.opacity * leaf.opacityFactor)) * 100,
    rings,
    evenOdd: rings.length > 1 || !!obj.boolean,
    fill: fillColor ? { color: fillColor } : null,
    stroke: strokeColor && va.style.strokeWidth > 0 ? { color: strokeColor, width: va.style.strokeWidth, cap: CAP[va.style.strokeLinecap ?? 'butt'], join: JOIN[va.style.strokeLinejoin ?? 'miter'] } : null,
    blend: obj.blendMode ? BLEND_INDEX[obj.blendMode] ?? 0 : 0,
  };
}

// ---- channel building ----

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Keyframe a numeric channel sampled once per frame, keeping only frames linear interpolation
 *  between kept frames cannot reproduce (within `eps`). */
export function numericChannel(values: number[][], eps = 1e-3): LottieProperty {
  const v = values.map((x) => x.map(round));
  const dims = v[0].length;
  const scalar = dims === 1;
  const out = (x: number[]) => (scalar ? x[0] : x);
  if (v.every((x) => x.every((n, i) => Math.abs(n - v[0][i]) <= eps))) return { a: 0, k: out(v[0]) };
  const kept = [0];
  let start = 0;
  for (let j = 2; j < v.length; j++) {
    // Can the segment start..j cover every frame strictly between?
    let ok = true;
    for (let i = start + 1; i < j && ok; i++) {
      const t = (i - start) / (j - start);
      for (let d = 0; d < dims; d++) {
        if (Math.abs(v[start][d] + (v[j][d] - v[start][d]) * t - v[i][d]) > eps) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) {
      kept.push(j - 1);
      start = j - 1;
    }
  }
  kept.push(v.length - 1);
  const lin = { o: { x: Array(dims).fill(0), y: Array(dims).fill(0) }, i: { x: Array(dims).fill(1), y: Array(dims).fill(1) } };
  const k: LottieKeyframe[] = kept.map((f, idx) => (idx < kept.length - 1 ? { t: f, s: v[f], ...lin } : { t: f, s: v[f] }));
  return { a: 1, k };
}

function shapePath(p: PathData): LottieShapePath {
  const pt = (q: { x: number; y: number } | undefined) => (q ? [round(q.x), round(q.y)] : [0, 0]);
  return { c: p.closed, v: p.nodes.map((n) => pt(n.anchor)), i: p.nodes.map((n) => pt(n.in)), o: p.nodes.map((n) => pt(n.out)) };
}

/** A path channel: held per frame (Lottie only interpolates paths of equal vertex count, and a
 *  hold reproduces every frame exactly), identical consecutive frames merged. */
function pathChannel(paths: LottieShapePath[]): LottieProperty {
  const same = (a: LottieShapePath, b: LottieShapePath) => JSON.stringify(a) === JSON.stringify(b);
  if (paths.every((p) => same(p, paths[0]))) return { a: 0, k: paths[0] };
  const k: LottieKeyframe[] = [];
  paths.forEach((p, f) => {
    if (f === 0 || !same(p, paths[f - 1])) k.push({ t: f, s: [p], h: 1 });
  });
  return { a: 1, k };
}

/** Unwrap a degree series so consecutive frames never jump by more than 180°. */
function unwrap(deg: number[]): number[] {
  const out = [...deg];
  for (let i = 1; i < out.length; i++) {
    while (out[i] - out[i - 1] > 180) out[i] -= 360;
    while (out[i] - out[i - 1] < -180) out[i] += 360;
  }
  return out;
}

function buildLayer(series: (LeafSample | null)[], ind: number, op: number): LottieLayer | null {
  const first = series.find((s): s is LeafSample => !!s);
  if (!first) return null;
  // A frame where the leaf is absent holds its last known geometry at opacity 0.
  let last = first;
  const full = series.map((s) => {
    if (s) last = s;
    return s ?? { ...last, opacity: 0 };
  });
  const trs = full.map((s) => s.trs);
  const ringCount = Math.max(...full.map((s) => s.rings.length));
  const pathItems = Array.from({ length: ringCount }, (_, r) => ({
    ty: 'sh',
    nm: `Path ${r + 1}`,
    ks: pathChannel(full.map((s) => shapePath(s.rings[r] ?? { closed: true, nodes: [] }))),
  }));
  const items: unknown[] = [...pathItems];
  if (full.some((s) => s.stroke)) {
    items.push({
      ty: 'st',
      nm: 'Stroke',
      c: colorChannel(full.map((s) => s.stroke?.color ?? [0, 0, 0])),
      o: numericChannel(full.map((s) => [s.stroke ? 100 : 0])),
      w: numericChannel(full.map((s) => [s.stroke?.width ?? 0])),
      lc: first.stroke?.cap ?? 1,
      lj: first.stroke?.join ?? 1,
      ml: 4,
    });
  }
  if (full.some((s) => s.fill)) {
    items.push({
      ty: 'fl',
      nm: 'Fill',
      c: colorChannel(full.map((s) => s.fill?.color ?? [0, 0, 0])),
      o: numericChannel(full.map((s) => [s.fill ? 100 : 0])),
      r: first.evenOdd ? 2 : 1,
    });
  }
  items.push({ ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } });
  return {
    ddd: 0,
    ind,
    ty: 4,
    nm: first.name,
    sr: 1,
    ks: {
      o: numericChannel(full.map((s) => [s.opacity])),
      r: numericChannel(unwrap(trs.map((t) => t.rotation)).map((r) => [r])),
      p: { s: true, x: numericChannel(trs.map((t) => [t.x])), y: numericChannel(trs.map((t) => [t.y])) },
      a: { a: 0, k: [0, 0, 0] },
      s: numericChannel(trs.map((t) => [t.scaleX, t.scaleY, 100])),
      sk: numericChannel(trs.map((t) => [t.skew])),
      sa: { a: 0, k: 0 },
    },
    ao: 0,
    shapes: [{ ty: 'gr', nm: first.name, it: items }],
    ip: 0,
    op,
    st: 0,
    bm: first.blend,
  };
}

/** Colour channel: [r, g, b, 1], interpolated linearly like SVG colour tracks. */
function colorChannel(colors: number[][]): LottieProperty {
  return numericChannel(colors.map((c) => [...c, 1]));
}

/** Convert `project` (root scene) to a Lottie animation. */
export function exportLottie(project: Project): LottieExportResult {
  const warn = new Warnings();
  const fps = project.meta.fps;
  const duration = computeProjectDuration(project);
  const op = Math.max(1, Math.round(duration * fps));
  if (project.scenes) warn.add('This project has several scenes; the Lottie export includes only the first one for now.');
  const view: Project = project.scenes ? { ...project, objects: project.scenes[0].objects, scenes: undefined } : project;

  const order: string[] = [];
  const byKey = new Map<string, (LeafSample | null)[]>();
  for (let f = 0; f <= op; f++) {
    const t = Math.min(duration, f / fps);
    const leaves = flattenInstances(view, t);
    for (const leaf of leaves) {
      if (leaf.maskOf) {
        warn.add('Masks are not in the Lottie export yet; masked objects are drawn unmasked.');
        continue;
      }
      if (leaf.clipId || leaf.tintId) warn.add('Symbol clipping and tint are not in the Lottie export yet.');
      const s = sampleLeaf(view, leaf, warn);
      if (!s) continue;
      if (!byKey.has(s.key)) {
        byKey.set(s.key, Array(op + 1).fill(null));
        order.push(s.key);
      }
      byKey.get(s.key)![f] = s;
    }
  }

  // Lottie draws layers[0] on top; the scene walker lists leaves bottom first.
  const layers: LottieLayer[] = [];
  let ind = 1;
  for (const key of [...order].reverse()) {
    const layer = buildLayer(byKey.get(key)!, ind, op);
    if (layer) {
      layers.push(layer);
      ind++;
    }
  }

  return {
    animation: {
      v: '5.7.4',
      fr: fps,
      ip: 0,
      op,
      w: project.meta.width,
      h: project.meta.height,
      nm: project.meta.name || 'SaViG animation',
      ddd: 0,
      assets: [],
      layers,
      meta: { g: 'SaViG' },
    },
    warnings: warn.list,
  };
}
