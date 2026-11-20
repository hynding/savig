// Color swatches and global colors (roadmap 12). The project palette is editor/agent bookkeeping:
// fills and strokes always hold their concrete color, so rendering and every exporter are
// untouched. A paint painted from a GLOBAL swatch also records the swatch id (`fillSwatch` /
// `strokeSwatch`); the link is live only while the paint still equals the swatch color, so any
// other way of recoloring the object (Inspector, paint bucket, paste style…) simply unlinks it.
// Pure Project -> Project operations shared by the editor store and @savig/core.
import { formatHex, parseHex } from './color';
import type { Asset, Project, Swatch, TextAsset, VectorAsset } from './types';

export type SwatchPaint = 'fill' | 'stroke';

/** '#ABC' / '#aabbcc' -> '#aabbcc'; null for anything that is not a hex color. */
export function swatchColor(color: string): string | null {
  const rgb = typeof color === 'string' ? parseHex(color) : null;
  return rgb ? formatHex(rgb) : null;
}

export function projectSwatches(project: Project): Swatch[] {
  return project.swatches ?? [];
}

/** Swatch names are trimmed; an empty name becomes the color itself. */
export function swatchName(name: string | undefined, color: string): string {
  return (name ?? '').trim() || color;
}

function withSwatches(project: Project, swatches: Swatch[]): Project {
  const out: Project = { ...project, swatches };
  if (swatches.length === 0) delete out.swatches;
  return out;
}

type Paintable = VectorAsset | TextAsset;
const LINK_KEY = { fill: 'fillSwatch', stroke: 'strokeSwatch' } as const;

function paintOf(a: Paintable, paint: SwatchPaint): string | undefined {
  return a.kind === 'vector' ? a.style[paint] : a[paint];
}
function linkOf(a: Paintable, paint: SwatchPaint): string | undefined {
  return a.kind === 'vector' ? a.style[LINK_KEY[paint]] : a[LINK_KEY[paint]];
}

/** Return `a` with `paint` set to `color` (undefined = leave the color) and its link set to
 *  `link` (undefined = remove the link). Returns `a` itself when nothing changes. */
function setPaint<T extends Paintable>(a: T, paint: SwatchPaint, color: string | undefined, link: string | undefined): T {
  const key = LINK_KEY[paint];
  const curColor = paintOf(a, paint);
  const curLink = linkOf(a, paint);
  const nextColor = color ?? curColor;
  if (nextColor === curColor && link === curLink) return a;
  if (a.kind === 'vector') {
    const style = { ...a.style, [paint]: nextColor } as VectorAsset['style'];
    if (link === undefined) delete style[key];
    else style[key] = link;
    return { ...a, style } as T;
  }
  const next = (nextColor === undefined ? { ...a } : { ...a, [paint]: nextColor }) as TextAsset;
  if (link === undefined) delete next[key];
  else next[key] = link;
  return next as T;
}

function isPaintable(a: Asset): a is Paintable {
  return a.kind === 'vector' || a.kind === 'text';
}

/** True when `asset`'s `paint` is live-linked to `swatch` (link id matches AND colors agree). */
export function isSwatchLinked(asset: Asset, paint: SwatchPaint, swatch: Swatch): boolean {
  if (!isPaintable(asset) || !swatch.global) return false;
  if (linkOf(asset, paint) !== swatch.id) return false;
  const c = paintOf(asset, paint);
  return c !== undefined && swatchColor(c) === swatch.color;
}

/** The global swatch `asset`'s `paint` is live-linked to, if any. */
export function linkedSwatch(project: Project, asset: Asset, paint: SwatchPaint): Swatch | undefined {
  if (!isPaintable(asset)) return undefined;
  const id = linkOf(asset, paint);
  if (id === undefined) return undefined;
  const sw = projectSwatches(project).find((s) => s.id === id);
  return sw && isSwatchLinked(asset, paint, sw) ? sw : undefined;
}

/** How many fills/strokes are live-linked to the swatch (shown in the panel). */
export function swatchUsage(project: Project, swatchId: string): number {
  const sw = projectSwatches(project).find((s) => s.id === swatchId);
  if (!sw) return 0;
  let n = 0;
  for (const a of project.assets) {
    if (isSwatchLinked(a, 'fill', sw)) n++;
    if (isSwatchLinked(a, 'stroke', sw)) n++;
  }
  return n;
}

export interface NewSwatch {
  id: string;
  color: string;
  name?: string;
  global?: boolean;
}

export function addSwatch(project: Project, input: NewSwatch): Project {
  const swatches = projectSwatches(project);
  if (swatches.some((s) => s.id === input.id)) throw new Error(`savig: swatch "${input.id}" already exists`);
  const color = swatchColor(input.color);
  if (!color) throw new Error(`savig: swatch color must be a hex color like #ff8800, got "${input.color}"`);
  const sw: Swatch = { id: input.id, name: swatchName(input.name, color), color };
  if (input.global) sw.global = true;
  return withSwatches(project, [...swatches, sw]);
}

/** Remove every link (live or stale) to `swatchId` from the project's assets. */
function unlinkAll(project: Project, swatchId: string): Asset[] {
  return project.assets.map((a) => {
    if (!isPaintable(a)) return a;
    let next: Paintable = a;
    for (const p of ['fill', 'stroke'] as const) if (linkOf(next, p) === swatchId) next = setPaint(next, p, undefined, undefined);
    return next;
  });
}

export interface SwatchPatch {
  name?: string;
  color?: string;
  global?: boolean;
}

/** Edit a swatch. Changing a GLOBAL swatch's color recolors every live-linked fill/stroke (and
 *  drops stale links to it); turning `global` off unlinks everything. Unknown id -> unchanged. */
export function updateSwatch(project: Project, swatchId: string, patch: SwatchPatch): Project {
  const swatches = projectSwatches(project);
  const sw = swatches.find((s) => s.id === swatchId);
  if (!sw) return project;
  const next: Swatch = { ...sw };
  if (patch.color !== undefined) {
    const c = swatchColor(patch.color);
    if (!c) throw new Error(`savig: swatch color must be a hex color like #ff8800, got "${patch.color}"`);
    next.color = c;
  }
  if (patch.name !== undefined) next.name = swatchName(patch.name, next.color);
  if (patch.global !== undefined) {
    if (patch.global) next.global = true;
    else delete next.global;
  }
  if (next.name === sw.name && next.color === sw.color && !!next.global === !!sw.global) return project;

  let assets = project.assets;
  if (sw.global && !next.global) {
    assets = unlinkAll(project, swatchId);
  } else if (sw.global && next.color !== sw.color) {
    assets = project.assets.map((a) => {
      if (!isPaintable(a)) return a;
      let out: Paintable = a;
      for (const p of ['fill', 'stroke'] as const) {
        if (linkOf(out, p) !== swatchId) continue;
        out = isSwatchLinked(a, p, sw) ? setPaint(out, p, next.color, swatchId) : setPaint(out, p, undefined, undefined);
      }
      return out;
    });
  }
  return { ...withSwatches(project, swatches.map((s) => (s.id === swatchId ? next : s))), assets };
}

/** Delete a swatch; its links are removed and the colors stay as they are. */
export function removeSwatch(project: Project, swatchId: string): Project {
  const swatches = projectSwatches(project);
  if (!swatches.some((s) => s.id === swatchId)) return project;
  return { ...withSwatches(project, swatches.filter((s) => s.id !== swatchId)), assets: unlinkAll(project, swatchId) };
}

/** Move a swatch to `index` in the palette (clamped). */
export function moveSwatch(project: Project, swatchId: string, index: number): Project {
  const swatches = projectSwatches(project);
  const from = swatches.findIndex((s) => s.id === swatchId);
  if (from < 0) return project;
  const to = Math.max(0, Math.min(swatches.length - 1, Math.round(index)));
  if (to === from) return project;
  const out = swatches.slice();
  const [sw] = out.splice(from, 1);
  out.splice(to, 0, sw);
  return withSwatches(project, out);
}

/** Paint `assetIds` (vector or text assets; others are skipped) with the swatch's color, linking
 *  them when the swatch is global and replacing a static gradient on that paint. Unknown swatch -> unchanged. */
export function applySwatchToAssets(project: Project, swatchId: string, paint: SwatchPaint, assetIds: Iterable<string>): Project {
  const sw = projectSwatches(project).find((s) => s.id === swatchId);
  if (!sw) return project;
  const want = new Set(assetIds);
  let changed = false;
  const assets = project.assets.map((a) => {
    if (!want.has(a.id) || !isPaintable(a)) return a;
    let next: Paintable = setPaint(a, paint, sw.color, sw.global ? sw.id : undefined);
    // A solid swatch replaces a static gradient on that paint (Flash's fill swatch does too).
    const gKey = paint === 'fill' ? 'fillGradient' : 'strokeGradient';
    if (next.kind === 'vector' && next.style[gKey]) {
      const style = { ...next.style };
      delete style[gKey];
      next = { ...next, style };
    }
    if (next !== a) changed = true;
    return next;
  });
  return changed ? { ...project, assets } : project;
}

/** Load-time repair: drop malformed/duplicate swatches, normalize colors, and clear links that
 *  name no swatch (or a swatch that is not global). */
export function sanitizeSwatches(project: Project): Project {
  if (!Array.isArray(project.assets)) return project;
  const hasField = 'swatches' in project;
  const raw: unknown = project.swatches;
  const seen = new Set<string>();
  const swatches: Swatch[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
    const color = typeof o.color === 'string' ? swatchColor(o.color) : null;
    if (!color) continue;
    seen.add(o.id);
    const sw: Swatch = { id: o.id, name: swatchName(typeof o.name === 'string' ? o.name : '', color), color };
    if (o.global === true) sw.global = true;
    swatches.push(sw);
  }
  const globals = new Set(swatches.filter((s) => s.global).map((s) => s.id));
  const badLink = (a: Asset, p: SwatchPaint) => {
    if (!isPaintable(a) || (a.kind === 'vector' && (!a.style || typeof a.style !== 'object'))) return false;
    const l = linkOf(a, p);
    return l !== undefined && (typeof l !== 'string' || !globals.has(l));
  };
  const needsFix = project.assets.some((a) => badLink(a, 'fill') || badLink(a, 'stroke'));
  if (!hasField && !needsFix) return project;
  const assets = needsFix
    ? project.assets.map((a) => {
        if (!isPaintable(a)) return a;
        let next: Paintable = a;
        for (const p of ['fill', 'stroke'] as const) if (badLink(next, p)) next = setPaint(next, p, undefined, undefined);
        return next;
      })
    : project.assets;
  return { ...withSwatches(project, swatches), assets };
}
