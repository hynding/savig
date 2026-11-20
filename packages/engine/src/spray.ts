// Spray brush (roadmap 12): scatter copies of a symbol (or plain dots) around a stroke, as Flash's
// Spray Brush does. Pure and deterministic: the same stroke, settings and seed always give the
// same particles, so the editor's live preview is exactly what it commits.

export interface SprayPoint {
  x: number;
  y: number;
}

export interface SpraySettings {
  /** Spray radius around the pointer (px, > 0). */
  radius: number;
  /** Particles sprayed per `radius` of pointer travel (and on a single click), 1..SPRAY_DENSITY_MAX. */
  density: number;
  /** Random scale range, as fractions (1 = 100%). min <= max, both > 0. */
  scaleMin: number;
  scaleMax: number;
  /** Random rotation in degrees, 0..360 (0 = every particle upright). */
  rotation: number;
  /** Pattern seed. */
  seed: number;
}

export interface SprayParticle {
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
}

export const SPRAY_DENSITY_MAX = 50;
/** Hard cap on particles in one stroke (keeps the scene and the undo step sane). */
export const SPRAY_MAX_PARTICLES = 400;
export const SPRAY_DEFAULTS: Omit<SpraySettings, 'seed'> = { radius: 40, density: 5, scaleMin: 0.6, scaleMax: 1.2, rotation: 360 };

/** mulberry32: tiny, fast, good-enough deterministic PRNG in [0, 1). */
export function sprayRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp settings into their legal ranges (non-finite values take the defaults). */
export function normalizeSpraySettings(s: Partial<SpraySettings>): SpraySettings {
  const fin = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const radius = Math.max(1, fin(s.radius, SPRAY_DEFAULTS.radius));
  const density = Math.max(1, Math.min(SPRAY_DENSITY_MAX, Math.round(fin(s.density, SPRAY_DEFAULTS.density))));
  let scaleMin = Math.max(0.01, fin(s.scaleMin, SPRAY_DEFAULTS.scaleMin));
  let scaleMax = Math.max(0.01, fin(s.scaleMax, SPRAY_DEFAULTS.scaleMax));
  if (scaleMin > scaleMax) [scaleMin, scaleMax] = [scaleMax, scaleMin];
  const rotation = Math.max(0, Math.min(360, fin(s.rotation, SPRAY_DEFAULTS.rotation)));
  return { radius, density, scaleMin, scaleMax, rotation, seed: Math.floor(fin(s.seed, 1)) };
}

/** The particles a stroke through `points` sprays. A click (one point, or no travel) sprays one
 *  burst of `density`; after that, another burst for every `radius` of travel, centred on the
 *  point reached along the stroke. Each particle sits uniformly inside the spray disc. */
export function sprayParticles(points: readonly SprayPoint[], settings: Partial<SpraySettings>): SprayParticle[] {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return [];
  const s = normalizeSpraySettings(settings);
  const rnd = sprayRandom(s.seed);
  const out: SprayParticle[] = [];
  const burst = (c: SprayPoint) => {
    for (let i = 0; i < s.density && out.length < SPRAY_MAX_PARTICLES; i++) {
      const r = s.radius * Math.sqrt(rnd());
      const a = rnd() * Math.PI * 2;
      const scale = s.scaleMin + (s.scaleMax - s.scaleMin) * rnd();
      const rotation = s.rotation > 0 ? (rnd() - 0.5) * s.rotation : 0;
      out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), scale, rotation });
    }
  };
  burst(pts[0]);
  const step = s.radius;
  let carried = 0; // distance travelled since the last burst
  for (let i = 1; i < pts.length && out.length < SPRAY_MAX_PARTICLES; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    let t = step - carried; // distance into this segment of the next burst
    while (t <= len && out.length < SPRAY_MAX_PARTICLES) {
      burst({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      t += step;
    }
    carried = (carried + len) % step;
  }
  return out;
}
