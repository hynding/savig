// 9-slice scaling (roadmap 13), Flash's "scale-9 grid": four guides split a symbol into nine
// cells. When an instance is scaled, the corners keep their size, the edges stretch along one
// axis and only the middle stretches both ways, so rounded buttons and panels resize cleanly.
//
// Rendering: each cell's mapping is affine (a translate and a per-axis scale), so an instance is
// drawn as nine copies of its content, each clipped to one cell and mapped by that cell's matrix,
// with the instance's own scale replaced by the grid mapping. This works for every kind of
// content (paths, text, bitmaps, nested symbols) and every exporter that understands clipping.
import type { Project, Scale9Grid, Scale9Resolved, SymbolAsset } from './types';

/** Joins an instance's render id and a cell index ("inst~4"): leaves inside a 9-slice instance
 *  have render ids like "inst~4/shape". The cell suffix belongs to the instance's segment, so code
 *  that maps a render id back to its authored object strips it (see stripScale9Cell). */
export const SCALE9_CELL_SEP = '~';

/** "inst~4" -> "inst"; other ids unchanged. */
export function stripScale9Cell(segment: string): string {
  return segment.replace(/~[0-8]$/, '');
}

/** The minimum middle-cell size (symbol units) a grid must leave. */
export const SCALE9_MIN_MIDDLE = 1;

/** The symbol's usable grid, resolved against its box (absent box fields: [0,width] x [0,height]),
 *  or undefined when it has none (absent, or the box leaves no middle). */
export function scale9Of(symbol: SymbolAsset): Scale9Resolved | undefined {
  const g = symbol.scale9;
  if (!g) return undefined;
  return normalizeScale9(g, symbol.width, symbol.height);
}

const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Resolve a grid's box (defaults: x=0, y=0, the given width/height) and clamp its insets to it:
 *  insets >= 0, leaving at least SCALE9_MIN_MIDDLE in the middle. Undefined when the box is too
 *  small to hold a middle. */
export function normalizeScale9(g: Partial<Scale9Grid>, width: number, height: number): Scale9Resolved | undefined {
  const x = finite(g.x, 0);
  const y = finite(g.y, 0);
  const w = finite(g.width, width);
  const h = finite(g.height, height);
  if (!(w > SCALE9_MIN_MIDDLE) || !(h > SCALE9_MIN_MIDDLE)) return undefined;
  const fix = (v: unknown) => Math.max(0, finite(v, 0));
  const squeeze = (a: number, b: number, size: number): [number, number] => {
    const room = size - SCALE9_MIN_MIDDLE;
    if (a + b <= room) return [a, b];
    const k = room / (a + b);
    return [a * k, b * k];
  };
  const [left, right] = squeeze(fix(g.left), fix(g.right), w);
  const [top, bottom] = squeeze(fix(g.top), fix(g.bottom), h);
  return { left, top, right, bottom, x, y, width: w, height: h };
}

/** A default grid for a box: a quarter of the shorter side in from every edge. */
export function defaultScale9(box: { x: number; y: number; width: number; height: number }): Scale9Resolved | undefined {
  const inset = Math.max(0, Math.min(box.width, box.height) / 4);
  return normalizeScale9({ ...box, left: inset, top: inset, right: inset, bottom: inset }, box.width, box.height);
}

/** One axis of the grid mapping: three spans, each `p -> p * scale + offset`. */
export interface Scale9Axis {
  /** Span edges in symbol space: (-inf, a], [a, b], [b, +inf). */
  a: number;
  b: number;
  /** Per span: [scale, offset]. */
  spans: [[number, number], [number, number], [number, number]];
}

/**
 * The 1D grid mapping for a box [origin, origin+size] with guides at `a` and `b`, stretched by
 * `s` (>= 0). The box maps to [s*origin, s*(origin+size)], matching ordinary scaling about 0: the
 * outer spans keep their size (shrinking only when the box gets smaller than both of them) and
 * the middle span takes up the difference.
 */
export function scale9Axis(origin: number, size: number, a: number, b: number, s: number): Scale9Axis {
  const sc = Math.max(0, s);
  const target = sc * size;
  const outer = a - origin + (origin + size - b);
  const middle = b - a;
  // Outer spans keep their size unless the target can't hold them; then everything shrinks.
  const k = outer > 0 && target < outer ? target / outer : 1;
  const midTarget = Math.max(0, target - outer * k);
  const mk = middle > 0 ? midTarget / middle : 0;
  const start = sc * origin; // where the box's first edge lands
  const fa = start + (a - origin) * k; // where guide a lands
  return {
    a,
    b,
    spans: [
      [k, start - origin * k],
      [mk, fa - a * mk],
      [k, fa + midTarget - b * k],
    ],
  };
}

/** Map a point through an axis mapping (for anchors and tests). */
export function mapScale9(axis: Scale9Axis, p: number): number {
  const [sc, off] = p <= axis.a ? axis.spans[0] : p >= axis.b ? axis.spans[2] : axis.spans[1];
  return p * sc + off;
}

/** How far outer cells reach past the box (symbol units): content outside the box still draws. */
const OUTER_REACH = 1e5;
/** Cells overlap their neighbors by this much (symbol units) so anti-aliasing leaves no seams. */
const SEAM = 0.5;

export interface Scale9Cell {
  /** 0..8, row-major (top-left first). */
  index: number;
  /** The cell's clip rect in symbol space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The cell's mapping as an SVG matrix(a, 0, 0, d, e, f). */
  matrix: [number, number, number, number, number, number];
}

/** The nine cells of a resolved grid stretched by (sx, sy). */
export function scale9Cells(grid: Scale9Resolved, sx: number, sy: number): Scale9Cell[] {
  const { ax, ay } = scale9Axes(grid, sx, sy);
  const edges = (axis: Scale9Axis): [number, number][] => [
    [axis.a - OUTER_REACH, axis.a + SEAM],
    [axis.a - SEAM, axis.b + SEAM],
    [axis.b - SEAM, axis.b + OUTER_REACH],
  ];
  const ex = edges(ax);
  const ey = edges(ay);
  const cells: Scale9Cell[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const [x0, x1] = ex[col]!;
      const [y0, y1] = ey[row]!;
      const [kx, ox] = ax.spans[col]!;
      const [ky, oy] = ay.spans[row]!;
      cells.push({ index: row * 3 + col, x: x0, y: y0, width: x1 - x0, height: y1 - y0, matrix: [kx, 0, 0, ky, ox, oy] });
    }
  }
  return cells;
}

/** Both axis mappings of a resolved grid stretched by (sx, sy). */
export function scale9Axes(grid: Scale9Resolved, sx: number, sy: number): { ax: Scale9Axis; ay: Scale9Axis } {
  return {
    ax: scale9Axis(grid.x, grid.width, grid.x + grid.left, grid.x + grid.width - grid.right, sx),
    ay: scale9Axis(grid.y, grid.height, grid.y + grid.top, grid.y + grid.height - grid.bottom, sy),
  };
}

/** Drop unusable grids (bad numbers, no middle) from every symbol; keep valid ones clamped. */
export function sanitizeScale9(project: Project): Project {
  if (!Array.isArray(project.assets)) return project; // malformed files are someone else's concern
  let changed = false;
  const assets = project.assets.map((a) => {
    if (!a || a.kind !== 'symbol' || a.scale9 === undefined) return a;
    const g = a.scale9 && typeof a.scale9 === 'object' ? normalizeScale9(a.scale9, a.width, a.height) : undefined;
    const cur = a.scale9 as Partial<Scale9Grid> | null;
    // Keep a clean stored grid as-is (box fields may be absent and fall back to the defaults).
    const same = (k: keyof Scale9Grid) => cur![k] === undefined ? k !== 'left' && k !== 'top' && k !== 'right' && k !== 'bottom' : cur![k] === g![k];
    if (g && cur && (['left', 'top', 'right', 'bottom', 'x', 'y', 'width', 'height'] as const).every(same)) return a;
    changed = true;
    const next: SymbolAsset = { ...a };
    if (g) next.scale9 = g;
    else delete next.scale9;
    return next;
  });
  return changed ? { ...project, assets } : project;
}
