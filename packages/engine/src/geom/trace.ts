// Trace Bitmap (spec 2026-11-18-trace-bitmap): turn a raster picture into filled vector regions,
// one per quantized color. Pure and framework-neutral: the caller supplies decoded RGBA pixels.
//
// Pipeline: k-means color quantization (deterministic farthest-point seeding) → speckle cleanup
// (connected components under `minArea` pixels join their commonest neighbor) → crack-edge
// boundary loops per color (inside on the right, so holes come out as their own loops) → staircase
// runs turned into corner / midpoint polygons → Douglas–Peucker → Bézier smoothing that keeps sharp
// corners. Each color's loops form one evenodd path (first loop + compound rings).
import type { Asset, PathData, PathNode, PathPoint, SceneObject, VectorAsset } from '../types';
import { isLockedInTree } from '../groupTransform';
import { simplify } from './simplify';

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: ArrayLike<number>;
}

export type TraceCurveFit = 'pixels' | 'tight' | 'normal' | 'smooth';
export type TraceCorners = 'many' | 'normal' | 'few';

export interface TraceOptions {
  /** Most colors to keep (2–64). Default 8. */
  colors?: number;
  /** Regions smaller than this many pixels are merged into a neighbor. Default 8. */
  minArea?: number;
  /** How closely outlines follow the pixels. Default 'normal'. */
  curveFit?: TraceCurveFit;
  /** How readily a bend becomes a sharp corner. Default 'normal'. */
  corners?: TraceCorners;
  /** Pixels with alpha below this (0–255) are empty. Default 128. */
  alphaThreshold?: number;
  /** Output units per pixel (when the caller traced a downscaled copy). Default 1. */
  pixelSize?: number;
}

export interface TracedRegion {
  /** `#rrggbb`. */
  color: string;
  /** Pixel count (at traced resolution). */
  area: number;
  path: PathData;
  rings: PathData[];
}

export const TRACE_DEFAULTS: Required<Omit<TraceOptions, 'pixelSize'>> = {
  colors: 8,
  minArea: 8,
  curveFit: 'normal',
  corners: 'normal',
  alphaThreshold: 128,
};

const FIT_EPSILON: Record<TraceCurveFit, number> = { pixels: 0, tight: 0.6, normal: 1.0, smooth: 1.8 };
/** Turn angle (degrees) above which a vertex stays a sharp corner. */
const CORNER_ANGLE: Record<TraceCorners, number> = { many: 35, normal: 60, few: 95 };
const TRAIN_SAMPLES = 24000;
const KMEANS_ROUNDS = 12;

/** Trace `img` into filled regions, largest first (draw them in this order). */
export function traceBitmap(img: RasterImage, options: TraceOptions = {}): TracedRegion[] {
  const W = Math.floor(img.width);
  const H = Math.floor(img.height);
  if (!(W > 0 && H > 0) || img.data.length < W * H * 4) return [];
  const k = Math.max(2, Math.min(64, Math.round(options.colors ?? TRACE_DEFAULTS.colors)));
  const minArea = Math.max(0, options.minArea ?? TRACE_DEFAULTS.minArea);
  const fit = options.curveFit ?? TRACE_DEFAULTS.curveFit;
  const cornerAngle = CORNER_ANGLE[options.corners ?? TRACE_DEFAULTS.corners];
  const alphaMin = options.alphaThreshold ?? TRACE_DEFAULTS.alphaThreshold;
  const px = options.pixelSize && options.pixelSize > 0 ? options.pixelSize : 1;

  const { labels, palette } = quantize(img, W, H, k, alphaMin);
  if (minArea > 1) mergeSpeckles(labels, W, H, minArea);

  const regions: TracedRegion[] = [];
  const counts = new Array<number>(palette.length).fill(0);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) counts[labels[i]]++;
  const tracer = makeLoopTracer(W, H);
  for (let c = 0; c < palette.length; c++) {
    if (counts[c] === 0) continue;
    const loops = tracer(labels, c);
    const paths: PathData[] = [];
    for (const loop of loops) {
      const poly = loopPolygon(loop, W);
      const simple = FIT_EPSILON[fit] > 0 ? simplifyClosed(poly, FIT_EPSILON[fit]) : dropCollinear(poly);
      if (simple.length < 3) continue;
      paths.push(fit === 'pixels' ? polygonPath(simple, px) : smoothPath(simple, cornerAngle, px));
    }
    if (paths.length === 0) continue;
    regions.push({ color: palette[c], area: counts[c], path: paths[0], rings: paths.slice(1) });
  }
  return regions.sort((a, b) => b.area - a.area);
}

// ---------- quantization ----------

function quantize(img: RasterImage, W: number, H: number, k: number, alphaMin: number): { labels: Int32Array; palette: string[] } {
  const n = W * H;
  const d = img.data;
  const labels = new Int32Array(n).fill(-1);
  const opaque: number[] = [];
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= alphaMin) opaque.push(i);
  if (opaque.length === 0) return { labels, palette: [] };
  // Training sample: an even stride through the opaque pixels (deterministic).
  const stride = Math.max(1, Math.floor(opaque.length / TRAIN_SAMPLES));
  const sample: number[] = [];
  for (let j = 0; j < opaque.length; j += stride) sample.push(opaque[j]);
  const rgb = (i: number): [number, number, number] => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
  const dist2 = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // Farthest-point seeding from the sample's mean color.
  const mean = [0, 0, 0];
  for (const i of sample) {
    const c = rgb(i);
    mean[0] += c[0];
    mean[1] += c[1];
    mean[2] += c[2];
  }
  mean[0] /= sample.length;
  mean[1] /= sample.length;
  mean[2] /= sample.length;
  const centers: number[][] = [];
  const nearest = new Float64Array(sample.length).fill(Infinity);
  let pick = 0;
  let best = -1;
  sample.forEach((i, j) => {
    const dd = dist2(rgb(i), mean);
    if (dd > best) {
      best = dd;
      pick = j;
    }
  });
  while (centers.length < k) {
    const c = rgb(sample[pick]);
    centers.push([...c]);
    best = -1;
    for (let j = 0; j < sample.length; j++) {
      const dd = dist2(rgb(sample[j]), c);
      if (dd < nearest[j]) nearest[j] = dd;
      if (nearest[j] > best) {
        best = nearest[j];
        pick = j;
      }
    }
    if (best <= 0) break; // fewer distinct colors than k
  }

  const assign = (c: readonly number[]) => {
    let bi = 0;
    let bd = Infinity;
    for (let m = 0; m < centers.length; m++) {
      const dd = dist2(c, centers[m]);
      if (dd < bd) {
        bd = dd;
        bi = m;
      }
    }
    return bi;
  };
  for (let round = 0; round < KMEANS_ROUNDS; round++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const i of sample) {
      const c = rgb(i);
      const s = sum[assign(c)];
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
      s[3]++;
    }
    let moved = 0;
    sum.forEach((s, m) => {
      if (s[3] === 0) return;
      const next = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      moved += dist2(next, centers[m]);
      centers[m] = next;
    });
    if (moved < 0.25) break;
  }
  for (const i of opaque) labels[i] = assign(rgb(i));
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return { labels, palette: centers.map((c) => `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`) };
}

// ---------- speckle cleanup ----------

/** Connected components (4-neighbour) smaller than `minArea` take their commonest neighbour label.
 *  Transparent (-1) counts as a label, so a speck on an empty background disappears. */
function mergeSpeckles(labels: Int32Array, W: number, H: number, minArea: number): void {
  const comp = new Int32Array(W * H).fill(-1);
  const stack: number[] = [];
  const members: number[] = [];
  let id = 0;
  for (let start = 0; start < labels.length; start++) {
    if (comp[start] !== -1) continue;
    const lab = labels[start];
    members.length = 0;
    stack.push(start);
    comp[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      const x = p % W;
      const y = (p - x) / W;
      const visit = (q: number) => {
        if (comp[q] === -1 && labels[q] === lab) {
          comp[q] = id;
          stack.push(q);
        }
      };
      if (x > 0) visit(p - 1);
      if (x < W - 1) visit(p + 1);
      if (y > 0) visit(p - W);
      if (y < H - 1) visit(p + W);
    }
    if (members.length < minArea) {
      const votes = new Map<number, number>();
      for (const p of members) {
        const x = p % W;
        const y = (p - x) / W;
        const vote = (q: number) => {
          if (labels[q] !== lab) votes.set(labels[q], (votes.get(labels[q]) ?? 0) + 1);
        };
        if (x > 0) vote(p - 1);
        if (x < W - 1) vote(p + 1);
        if (y > 0) vote(p - W);
        if (y < H - 1) vote(p + W);
      }
      let to = lab;
      let most = 0;
      for (const [l, v] of votes) {
        if (v > most) {
          most = v;
          to = l;
        }
      }
      // Relabel; the merged pixels keep this component id, so later growth won't revisit them.
      for (const p of members) labels[p] = to;
    }
    id++;
  }
}

// ---------- boundary loops ----------

// Directions: 0 E, 1 S, 2 W, 3 N (screen, y down). Right turn = +1.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** Returns a function tracing every boundary loop of label `c`, as lists of grid-vertex ids
 *  (y·(W+1)+x), inside on the right. Reuses its buffers between labels. */
function makeLoopTracer(W: number, H: number) {
  const V = (W + 1) * (H + 1);
  // Up to two outgoing edges per vertex (two only where regions touch diagonally); 4 bits each.
  const out = new Uint8Array(V);
  const touched: number[] = [];
  return (labels: Int32Array, c: number): number[][] => {
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && labels[y * W + x] === c;
    const add = (vx: number, vy: number, dir: number) => {
      const v = vy * (W + 1) + vx;
      if (out[v] === 0) touched.push(v);
      out[v] |= 1 << dir;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (labels[y * W + x] !== c) continue;
        if (!at(x, y - 1)) add(x, y, 0); // top edge, going E
        if (!at(x + 1, y)) add(x + 1, y, 1); // right edge, going S
        if (!at(x, y + 1)) add(x + 1, y + 1, 2); // bottom edge, going W
        if (!at(x - 1, y)) add(x, y + 1, 3); // left edge, going N
      }
    }
    const loops: number[][] = [];
    for (const start of touched) {
      while (out[start] !== 0) {
        let dir = 0;
        while (!(out[start] & (1 << dir))) dir++;
        const loop: number[] = [];
        let v = start;
        let d = dir;
        for (;;) {
          out[v] &= ~(1 << d);
          loop.push(v);
          const x = (v % (W + 1)) + DX[d];
          const y = Math.floor(v / (W + 1)) + DY[d];
          v = y * (W + 1) + x;
          if (v === start) break; // closed
          // Prefer a right turn, then straight, then left: keeps diagonal touches apart.
          const order = [(d + 1) % 4, d, (d + 3) % 4];
          const next = order.find((nd) => out[v] & (1 << nd));
          if (next === undefined) break;
          d = next;
        }
        if (loop.length >= 4) loops.push(loop);
      }
    }
    for (const v of touched) out[v] = 0;
    touched.length = 0;
    return loops;
  };
}

/** Grid loop → polygon: long runs keep their corners, unit steps become midpoints (a 45° stair
 *  reads as a diagonal, not a staircase). */
function loopPolygon(loop: number[], W: number): PathPoint[] {
  const pts = loop.map((v) => ({ x: v % (W + 1), y: Math.floor(v / (W + 1)) }));
  const n = pts.length;
  // Runs of constant direction.
  const dirOf = (i: number) => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    return (b.x - a.x) * 3 + (b.y - a.y);
  };
  // Start at a direction change so no run wraps.
  let s = 0;
  while (s < n && dirOf(s) === dirOf((s + n - 1) % n)) s++;
  if (s === n) s = 0;
  const runs: { a: PathPoint; b: PathPoint; len: number }[] = [];
  let i = 0;
  while (i < n) {
    const startIdx = (s + i) % n;
    const d = dirOf(startIdx);
    let len = 1;
    while (i + len < n && dirOf((s + i + len) % n) === d) len++;
    runs.push({ a: pts[startIdx], b: pts[(startIdx + len) % n], len });
    i += len;
  }
  const outPts: PathPoint[] = [];
  const push = (p: PathPoint) => {
    const last = outPts[outPts.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) outPts.push(p);
  };
  for (const r of runs) {
    if (r.len === 1) push({ x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 });
    else {
      push(r.a);
      push(r.b);
    }
  }
  if (outPts.length > 1) {
    const f = outPts[0];
    const l = outPts[outPts.length - 1];
    if (f.x === l.x && f.y === l.y) outPts.pop();
  }
  return outPts;
}

function dropCollinear(poly: PathPoint[]): PathPoint[] {
  const n = poly.length;
  const out: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n];
    const p = poly[i];
    const b = poly[(i + 1) % n];
    if (Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-9) out.push(p);
  }
  return out;
}

/** Douglas–Peucker on a closed polygon: split at the vertex farthest from the first. */
function simplifyClosed(poly: PathPoint[], eps: number): PathPoint[] {
  const pts = dropCollinear(poly);
  if (pts.length <= 4) return pts;
  let far = 0;
  let fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const dd = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (dd > fd) {
      fd = dd;
      far = i;
    }
  }
  const a = simplify(pts.slice(0, far + 1), eps);
  const b = simplify([...pts.slice(far), pts[0]], eps);
  const joined = [...a.slice(0, -1), ...b.slice(0, -1)];
  return joined.length >= 3 ? joined : pts;
}

function polygonPath(poly: PathPoint[], px: number): PathData {
  return { closed: true, nodes: poly.map((p) => ({ anchor: { x: p.x * px, y: p.y * px } })) };
}

/** Catmull–Rom-style handles at gentle bends; vertices that turn more than `cornerDeg` stay sharp. */
function smoothPath(poly: PathPoint[], cornerDeg: number, px: number): PathData {
  const n = poly.length;
  const limit = (cornerDeg * Math.PI) / 180;
  const nodes: PathNode[] = poly.map((p, i) => {
    const prev = poly[(i + n - 1) % n];
    const next = poly[(i + 1) % n];
    const ax = p.x - prev.x;
    const ay = p.y - prev.y;
    const bx = next.x - p.x;
    const by = next.y - p.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    const anchor = { x: p.x * px, y: p.y * px };
    if (turn > limit || la < 1e-9 || lb < 1e-9) return { anchor };
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    return {
      anchor,
      in: { x: (-tx * la * px) / 3, y: (-ty * la * px) / 3 },
      out: { x: (tx * lb * px) / 3, y: (ty * lb * px) / 3 },
    };
  });
  return { closed: true, nodes };
}

// ---------- applying a trace to a scene ----------

export type TraceRefusal = 'not-an-image' | 'locked' | 'empty';

/** Replace image object `objectId` with its trace: a group that keeps the image's id, name
 *  ("Traced …"), transform, animation and stacking slot (so masks, parents and keys that point at
 *  it still work), holding one filled drawing per region in the image's own pixel coordinates.
 *  The image asset stays in the library. Scene stacking is renumbered 0..n-1. */
export function applyTrace(
  objects: SceneObject[],
  assets: Asset[],
  objectId: string,
  regions: TracedRegion[],
): { objects: SceneObject[]; assets: Asset[] } | { refused: TraceRefusal } {
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const obj = byId.get(objectId);
  const asset = obj ? assets.find((a) => a.id === obj.assetId) : undefined;
  if (!obj || obj.isGroup || asset?.kind !== 'image') return { refused: 'not-an-image' };
  if (isLockedInTree(obj, byId)) return { refused: 'locked' };
  if (regions.length === 0) return { refused: 'empty' };
  const taken = new Set([...objects.map((o) => o.id), ...assets.map((a) => a.id)]);
  const fresh = (want: string) => {
    let id = want;
    for (let n = 2; taken.has(id); n++) id = `${want}-${n}`;
    taken.add(id);
    return id;
  };
  const fraction = obj.anchorMode === 'fraction';
  const group: SceneObject = {
    ...obj,
    name: `Traced ${obj.name}`,
    assetId: '',
    isGroup: true,
    anchorX: fraction ? obj.anchorX * asset.width : obj.anchorX,
    anchorY: fraction ? obj.anchorY * asset.height : obj.anchorY,
  };
  delete group.anchorMode;
  const newAssets: VectorAsset[] = [];
  const children: SceneObject[] = regions.map((r) => {
    const assetId = fresh(`${obj.id}-trace`);
    newAssets.push({
      id: assetId,
      kind: 'vector',
      name: `Traced ${r.color}`,
      shapeType: 'path',
      style: { fill: r.color, stroke: 'none', strokeWidth: 0 },
      path: r.path,
      ...(r.rings.length ? { compoundRings: r.rings } : {}),
    });
    return {
      id: fresh(`${obj.id}-trace`),
      name: `Color ${r.color}`,
      assetId,
      zOrder: 0,
      parentId: obj.id,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: {},
    };
  });
  const ordered = [...objects].map((o, i) => ({ o, i })).sort((a, b) => a.o.zOrder - b.o.zOrder || a.i - b.i);
  const seq: SceneObject[] = [];
  for (const { o } of ordered) {
    if (o.id === obj.id) seq.push(...children, group);
    else seq.push(o);
  }
  const zOf = new Map(seq.map((o, i) => [o, i] as const));
  // Keep the caller's array order (other code may rely on it); the traced children follow the group.
  const out: SceneObject[] = [];
  for (const o of objects) {
    if (o.id === obj.id) out.push({ ...group, zOrder: zOf.get(group)! }, ...children.map((c) => ({ ...c, zOrder: zOf.get(c)! })));
    else out.push(zOf.get(o) === o.zOrder ? o : { ...o, zOrder: zOf.get(o)! });
  }
  return { objects: out, assets: [...assets, ...newAssets] };
}
