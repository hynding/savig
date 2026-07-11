// Repeater (art-tools #3) helpers. `RepeatSpec` lives in ./types (next to SceneObject.repeat);
// this module normalizes an authored/hand-built spec and computes the per-copy transform delta
// consumed by the flattenInstances walker's plain-leaf expansion loop.
import { fmt } from './transform';
import type { RepeatSpec } from './types';

export type { RepeatSpec };

/** Validate + clamp a RepeatSpec for use by the walker. `count <= 1` (a no-op repeat) or any
 *  non-finite field makes the whole spec invalid -> undefined (the walker then falls back to a
 *  single, unmodified copy — byte-identical parity). Otherwise: count rounds to the nearest
 *  integer and clamps to [2,64]; scale clamps to [0.01,100]; stagger clamps to >= 0. dx/dy/rotate
 *  pass through unchanged (any finite value is a valid offset). */
export function normalizeRepeat(r: RepeatSpec): RepeatSpec | undefined {
  const { count, dx, dy, rotate, scale, stagger } = r;
  if (![count, dx, dy, rotate, scale, stagger].every(Number.isFinite)) return undefined;
  if (count <= 1) return undefined;
  return {
    count: Math.min(64, Math.max(2, Math.round(count))),
    dx,
    dy,
    rotate,
    scale: Math.min(100, Math.max(0.01, scale)),
    stagger: Math.max(0, stagger),
  };
}

/** The transform STRING for copy `k` of a repeated leaf, composed the same way as
 *  `buildTransform` (space-joined `translate(x, y)` / `rotate(deg)` / `scale(s)` terms, each
 *  formatted with `fmt`): `translate(k·dx, k·dy) rotate(k·rotate) scale(scale^k)`. `k=0` is always
 *  `''` (the walker's k=0 copy stays byte-identical to the unrepeated leaf). Identity components
 *  (zero translate, zero rotate, scale 1) are omitted so an all-identity, k>0 delta is also `''`. */
export function repeatDeltaTransform(r: RepeatSpec, k: number): string {
  if (k === 0) return '';
  const dx = r.dx * k;
  const dy = r.dy * k;
  const rotate = r.rotate * k;
  const scale = Math.pow(r.scale, k);
  const parts: string[] = [];
  if (dx !== 0 || dy !== 0) parts.push(`translate(${fmt(dx)}, ${fmt(dy)})`);
  if (rotate !== 0) parts.push(`rotate(${fmt(rotate)})`);
  if (scale !== 1) parts.push(`scale(${fmt(scale)})`);
  return parts.join(' ');
}
