import { applyEasing } from './easing';
import type { ColorKeyframe } from './types';

interface RGB {
  r: number;
  g: number;
  b: number;
}

// Parse '#rgb' / '#rrggbb' (case-insensitive). Null for 'none', named colors, malformed.
export function parseHex(c: string): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function formatHex({ r, g, b }: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// RGB lerp. Steps (holds `a` until t===1) when either endpoint is unparseable, so a
// color<->none boundary holds cleanly rather than producing garbage.
export function interpolateColor(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return t >= 1 ? b : a;
  return formatHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

// Resolve a color track to a hex string at `time`. Mirrors `interpolate`'s bracket/clamp/
// per-keyframe-easing.
export function sampleColor(track: ColorKeyframe[], time: number): string {
  if (track.length === 0) {
    throw new Error('sampleColor: track must contain at least one keyframe');
  }
  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;
  let a = first;
  let b = last;
  for (let i = 0; i < track.length - 1; i++) {
    if (time >= track[i].time && time < track[i + 1].time) {
      a = track[i];
      b = track[i + 1];
      break;
    }
  }
  const span = b.time - a.time;
  const rawProgress = span === 0 ? 0 : (time - a.time) / span;
  return interpolateColor(a.value, b.value, applyEasing(a.easing, rawProgress));
}
