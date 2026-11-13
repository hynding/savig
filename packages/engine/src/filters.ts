// Filters & color effects (spec 2026-11-13-filters-design.md). An object's `filters` stack is
// sampled at a time (static params, overridden by `filterTracks`), clamped, and turned into SVG
// filter primitives by ONE builder shared by the export string, the editor Stage and the runtime
// DOM update — so preview, export and raster can't drift.
import { interpolate } from './interpolate';
import { fmt } from './transform';
import { groupAncestors, maskContentRoot, maskDefId, resolveMaskTarget } from './mask';
import type { FilterKind, ObjectFilter, SceneObject } from './types';

export const FILTER_KINDS: readonly FilterKind[] = ['blur', 'dropShadow', 'glow', 'adjustColor'];

/** Per-kind numeric params with default and clamp range. Order = UI order. */
export const FILTER_PARAMS: Record<FilterKind, Record<string, { def: number; min: number; max: number }>> = {
  blur: { blur: { def: 4, min: 0, max: 200 } },
  dropShadow: {
    dx: { def: 4, min: -1000, max: 1000 },
    dy: { def: 4, min: -1000, max: 1000 },
    blur: { def: 4, min: 0, max: 200 },
    opacity: { def: 0.5, min: 0, max: 1 },
  },
  glow: {
    blur: { def: 6, min: 0, max: 200 },
    strength: { def: 1.5, min: 0, max: 10 },
    opacity: { def: 1, min: 0, max: 1 },
  },
  adjustColor: {
    brightness: { def: 0, min: -1, max: 1 },
    contrast: { def: 0, min: -1, max: 1 },
    saturation: { def: 0, min: -1, max: 1 },
    hue: { def: 0, min: -180, max: 180 },
  },
};

export const FILTER_DEFAULT_COLOR: Partial<Record<FilterKind, string>> = { dropShadow: '#000000', glow: '#ffcc00' };

export function isFilterKind(k: unknown): k is FilterKind {
  return typeof k === 'string' && (FILTER_KINDS as readonly string[]).includes(k);
}

/** Track key for a filter param. */
export const filterTrackKey = (filterId: string, param: string): string => `${filterId}.${param}`;

export interface ResolvedFilter {
  id: string;
  kind: FilterKind;
  params: Record<string, number>;
  color?: string;
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** The object's ENABLED filters at `time`, every known param present and clamped. Unknown kinds
 *  and params are dropped. [] when the object has no filters. */
export function sampleFilters(obj: SceneObject, time: number): ResolvedFilter[] {
  if (!obj.filters || obj.filters.length === 0) return [];
  const out: ResolvedFilter[] = [];
  for (const f of obj.filters) {
    if (f.enabled === false || !isFilterKind(f.kind)) continue;
    const params: Record<string, number> = {};
    for (const [name, spec] of Object.entries(FILTER_PARAMS[f.kind])) {
      const track = obj.filterTracks?.[filterTrackKey(f.id, name)];
      const raw = track && track.length > 0 ? interpolate(track, time) : f.params?.[name] ?? spec.def;
      params[name] = clamp(raw, spec.min, spec.max);
    }
    const color = FILTER_DEFAULT_COLOR[f.kind] !== undefined ? f.color ?? FILTER_DEFAULT_COLOR[f.kind] : undefined;
    out.push({ id: f.id, kind: f.kind, params, ...(color !== undefined ? { color } : {}) });
  }
  return out;
}

/** True iff the object has at least one enabled, known filter (structure is time-invariant). */
export function hasActiveFilters(obj: SceneObject): boolean {
  return !!obj.filters?.some((f) => f.enabled !== false && isFilterKind(f.kind));
}

/** One SVG filter primitive (possibly with child elements, e.g. feFuncR). Attribute values are
 *  raw strings — string emitters must escape them. */
export interface FilterPrimitive {
  tag: string;
  attrs: Record<string, string>;
  children?: FilterPrimitive[];
}

/** SVG primitives for a resolved filter stack, chained: the first reads SourceGraphic, each later
 *  filter reads the previous one's result. The STRUCTURE depends only on the kinds (never on
 *  animated values), so per-frame updates and SMIL can address primitives by index. */
export function filterPrimitives(filters: ResolvedFilter[]): FilterPrimitive[] {
  const prims: FilterPrimitive[] = [];
  let input = 'SourceGraphic';
  filters.forEach((f, k) => {
    const r = (s: string) => `f${k}${s}`;
    const p = f.params;
    switch (f.kind) {
      case 'blur':
        prims.push({ tag: 'feGaussianBlur', attrs: { in: input, stdDeviation: fmt(p.blur), result: r('') } });
        break;
      case 'dropShadow':
        prims.push({
          tag: 'feDropShadow',
          attrs: { in: input, dx: fmt(p.dx), dy: fmt(p.dy), stdDeviation: fmt(p.blur), 'flood-color': f.color ?? '#000000', 'flood-opacity': fmt(p.opacity), result: r('') },
        });
        break;
      case 'glow':
        prims.push(
          { tag: 'feGaussianBlur', attrs: { in: input, stdDeviation: fmt(p.blur), result: r('b') } },
          { tag: 'feFlood', attrs: { 'flood-color': f.color ?? '#ffcc00', 'flood-opacity': fmt(p.opacity), result: r('c') } },
          { tag: 'feComposite', attrs: { in: r('c'), in2: r('b'), operator: 'in', result: r('g') } },
          { tag: 'feComponentTransfer', attrs: { in: r('g'), result: r('s') }, children: [{ tag: 'feFuncA', attrs: { type: 'linear', slope: fmt(p.strength) } }] },
          { tag: 'feMerge', attrs: { result: r('') }, children: [{ tag: 'feMergeNode', attrs: { in: r('s') } }, { tag: 'feMergeNode', attrs: { in: input } }] },
        );
        break;
      case 'adjustColor': {
        const slope = 1 + p.contrast;
        const intercept = 0.5 * (1 - slope) + p.brightness;
        const lin = { type: 'linear', slope: fmt(slope), intercept: fmt(intercept) };
        prims.push(
          { tag: 'feColorMatrix', attrs: { in: input, type: 'hueRotate', values: fmt(p.hue), result: r('h') } },
          { tag: 'feColorMatrix', attrs: { in: r('h'), type: 'saturate', values: fmt(1 + p.saturation), result: r('s') } },
          {
            tag: 'feComponentTransfer',
            attrs: { in: r('s'), result: r('') },
            children: [{ tag: 'feFuncR', attrs: lin }, { tag: 'feFuncG', attrs: lin }, { tag: 'feFuncB', attrs: lin }],
          },
        );
        break;
      }
    }
    input = r('');
  });
  return prims;
}

/** Def id of an object's filter: unique per instance path (like mask def ids). */
export function filterDefId(idPrefix: string, objectId: string): string {
  return `savig-filter-${idPrefix ? `${idPrefix}/` : ''}${objectId}`;
}

/** Attributes of the `<filter>` element itself (region generous enough for blur + offsets). */
export const FILTER_ELEMENT_ATTRS: Record<string, string> = {
  x: '-50%',
  y: '-50%',
  width: '200%',
  height: '200%',
  'color-interpolation-filters': 'sRGB',
};

/** A new filter entry with defaults for `kind`. */
export function createFilter(kind: FilterKind, id: string, overrides: Partial<Omit<ObjectFilter, 'id' | 'kind'>> = {}): ObjectFilter {
  const params: Record<string, number> = {};
  for (const [name, spec] of Object.entries(FILTER_PARAMS[kind])) params[name] = spec.def;
  const color = FILTER_DEFAULT_COLOR[kind];
  return { id, kind, params: { ...params, ...(overrides.params ?? {}) }, ...(color ? { color: overrides.color ?? color } : {}), ...(overrides.enabled === false ? { enabled: false } : {}) };
}

/** True iff any object in `asset`'s subtree (through nested symbols) has active filters. */
export function symbolUsesFilters(
  asset: { id: string; objects: SceneObject[] },
  assetsById: Map<string, { id: string; kind: string; objects?: SceneObject[] }>,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(asset.id)) return false;
  visited.add(asset.id);
  for (const o of asset.objects) {
    if (hasActiveFilters(o)) return true;
    const child = assetsById.get(o.assetId);
    if (child && child.kind === 'symbol' && child.objects && symbolUsesFilters({ id: child.id, objects: child.objects }, assetsById, visited)) return true;
  }
  return false;
}

/** One wrapper around a drawn leaf (outermost first in `InstanceLeaf.wrapChain`): a mask, or an
 *  object's filter. A filter ref carries its owner and the owner's LOCAL sample time so any
 *  renderer can build the `<filter>` def (`filterPrimitives(sampleFilters(owner, time))`). */
export type WrapRef =
  | { kind: 'mask'; id: string }
  | { kind: 'filter'; id: string; owner: SceneObject; time: number };

/** The wrappers `obj` contributes within its own object list, OUTERMOST first: walking from the
 *  outermost group ancestor down to `obj`, each node adds its honoured mask and then its filter
 *  (a masked, filtered node is filtered first, then masked). Mask content contributes nothing. */
export function ownWrapChain(
  obj: SceneObject,
  objectsById: Map<string, SceneObject>,
  idPrefix: string,
  time: number,
): WrapRef[] {
  if (maskContentRoot(obj, objectsById)) return [];
  const out: WrapRef[] = [];
  for (const node of [...groupAncestors(obj, objectsById).reverse(), obj]) {
    const m = resolveMaskTarget(node, objectsById);
    if (m) out.push({ kind: 'mask', id: maskDefId(idPrefix, m.id) });
    if (hasActiveFilters(node)) out.push({ kind: 'filter', id: filterDefId(idPrefix, node.id), owner: node, time });
  }
  return out;
}

/** True iff the ref lists name the same wrappers (by kind + id) in the same order. */
export function sameWrapChain(a: readonly WrapRef[] | undefined, b: readonly WrapRef[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((r, k) => r.kind === y[k].kind && r.id === y[k].id);
}

/** A leaf's effective wrapper list: `wrapChain` when present (some filter applies), otherwise its
 *  mask chain as mask refs. */
export function leafWrapChain(leaf: { wrapChain?: WrapRef[]; maskChain?: string[] }): WrapRef[] {
  return leaf.wrapChain ?? (leaf.maskChain ?? []).map((id) => ({ kind: 'mask' as const, id }));
}
