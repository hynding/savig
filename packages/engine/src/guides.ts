// Ruler guides (spec 2026-11-19-rulers-guides): draggable straight lines on the Stage that objects
// snap to. Editor chrome saved with the project; never rendered or exported.
import type { RulerGuide } from './types';

/** True for a well-formed guide: axis 'x' (a vertical line at x = pos) or 'y' (a horizontal line
 *  at y = pos), with a finite position. */
export function isRulerGuide(g: unknown): g is RulerGuide {
  if (!g || typeof g !== 'object') return false;
  const o = g as Record<string, unknown>;
  return (o.axis === 'x' || o.axis === 'y') && typeof o.pos === 'number' && Number.isFinite(o.pos);
}

/** Guide positions are whole stage pixels. */
export function guidePos(pos: number): number {
  return Math.round(pos);
}
