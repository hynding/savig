import type { VectorStyle, WidthStop } from '../types';

// Variable-width strokes (spec 2026-11-18-variable-width). A path's stroke can carry a width
// profile: stations along the stroke (t = arc-length fraction 0..1) that scale strokeWidth. A
// profiled stroke is drawn as a FILLED outline (the ink ring(s) from outlineStroke) painted with
// the stroke paint, so every renderer (Stage, runtime, SMIL, CSS, Lottie, raster) shows the same
// shape. Dashes and trim do not apply to a profiled stroke. The outline itself (widthStrokeRings /
// widthStrokeD) lives in strokeOutline.ts beside outlineStroke, so that module's own
// outline-stroke command can honour a profile without an import cycle.

/** Largest multiplier a station may carry (8× strokeWidth). */
export const MAX_WIDTH_SCALE = 8;
/** Stations kept per profile; more are thinned on load. */
export const MAX_WIDTH_STOPS = 32;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Preset profiles offered by the Width tool and agent surfaces. */
export const WIDTH_PRESETS = {
  uniform: [],
  'taper-end': [
    { t: 0, w: 1 },
    { t: 1, w: 0 },
  ],
  'taper-start': [
    { t: 0, w: 0 },
    { t: 1, w: 1 },
  ],
  'taper-both': [
    { t: 0, w: 0 },
    { t: 0.5, w: 1 },
    { t: 1, w: 0 },
  ],
  bulge: [
    { t: 0, w: 0.5 },
    { t: 0.5, w: 2 },
    { t: 1, w: 0.5 },
  ],
  pinch: [
    { t: 0, w: 1.5 },
    { t: 0.5, w: 0.25 },
    { t: 1, w: 1.5 },
  ],
} as const satisfies Record<string, readonly WidthStop[]>;
export type WidthPreset = keyof typeof WIDTH_PRESETS;
export const WIDTH_PRESET_IDS = Object.keys(WIDTH_PRESETS) as WidthPreset[];

/** Normalize a profile: finite numbers only, t and w clamped, sorted by t, one station per t
 *  (the later one wins), at most MAX_WIDTH_STOPS. Returns undefined when nothing usable is left
 *  or every station is 1 (a uniform stroke, so the document stays as if it never had one). */
export function normalizeWidthProfile(raw: unknown): WidthStop[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byT = new Map<number, number>();
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const { t, w } = s as Record<string, unknown>;
    if (typeof t !== 'number' || typeof w !== 'number' || !Number.isFinite(t) || !Number.isFinite(w)) continue;
    const tk = Math.round(clamp01(t) * 1e4) / 1e4;
    byT.set(tk, Math.max(0, Math.min(MAX_WIDTH_SCALE, w)));
  }
  let stops = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, w]) => ({ t, w }));
  if (stops.length > MAX_WIDTH_STOPS) {
    const step = (stops.length - 1) / (MAX_WIDTH_STOPS - 1);
    stops = Array.from({ length: MAX_WIDTH_STOPS }, (_, i) => stops[Math.round(i * step)]);
  }
  if (stops.length === 0 || stops.every((s) => s.w === 1)) return undefined;
  return stops;
}

/** True when this style draws its stroke through a width profile. */
export function hasWidthProfile(style: VectorStyle | undefined): boolean {
  return !!style?.widthProfile && style.widthProfile.length > 0 && style.stroke !== 'none' && style.strokeWidth > 0;
}

/** The profile's multiplier at arc fraction `t`: held flat before the first and after the last
 *  station, eased (smoothstep) between neighbours so the outline swells smoothly. */
export function widthScaleAt(profile: readonly WidthStop[], t: number): number {
  if (profile.length === 0) return 1;
  if (t <= profile[0].t) return profile[0].w;
  const last = profile[profile.length - 1];
  if (t >= last.t) return last.w;
  let i = 1;
  while (i < profile.length && profile[i].t < t) i++;
  const a = profile[i - 1];
  const b = profile[i];
  const span = b.t - a.t;
  const u = span <= 0 ? 1 : (t - a.t) / span;
  const s = u * u * (3 - 2 * u);
  return a.w + (b.w - a.w) * s;
}
