import { fmt } from './transform';
import type { Keyframe, TrimPath, TrimProperty, TrimValues } from './types';

export const TRIM_TRACK_KEYS = {
  start: 'startTrack',
  end: 'endTrack',
  offset: 'offsetTrack',
} as const satisfies Record<TrimProperty, keyof TrimPath>;

/** Trim -> pathLength-normalized dash attributes. The ONE definition of the trim
 *  formula, shared by the static exporter (styleToSvgAttrs), the per-frame runtime
 *  (computeFrame), and the editor Stage — parity by construction. */
export function trimToDashAttrs(trim: TrimValues): {
  'stroke-dasharray': string;
  'stroke-dashoffset': string;
  pathLength: string;
} {
  const visible = Math.min(1, Math.max(0, trim.end - trim.start));
  // Negative dashoffset shifts the dash forward so the window begins at `start`;
  // double-mod keeps the phase in [0,1) even for defensive out-of-range offsets.
  const phase = (((trim.start + trim.offset) % 1) + 1) % 1;
  return {
    'stroke-dasharray': `${fmt(visible)} ${fmt(1 - visible)}`,
    'stroke-dashoffset': fmt(phase === 0 ? 0 : -phase),
    pathLength: '1',
  };
}

/** Identity trim ({0,1,0}) with no keyframes collapses to `undefined` so the field
 *  never persists at rest (parity: absent renders byte-identical). Every write site
 *  (store setters, core builders) funnels through this. */
export function normalizeTrim(t: TrimPath): TrimPath | undefined {
  const tracks = (['startTrack', 'endTrack', 'offsetTrack'] as const)
    .map((k) => t[k] as Keyframe[] | undefined)
    .filter((arr) => arr && arr.length > 0);
  if (tracks.length === 0 && t.start === 0 && t.end === 1 && t.offset === 0) return undefined;
  return t;
}
