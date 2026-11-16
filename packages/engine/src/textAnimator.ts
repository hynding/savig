// Per-character text animation (spec 2026-11-16-text-animator). A text object's content splits
// into units (characters or words); each unit gets its own opacity / offset / rotation at a time.
// ONE sampler + ONE markup builder are shared by the export string, the editor Stage and the
// runtime DOM update, so preview, export and raster can't drift.
//
// SVG mapping: every unit is a <tspan data-savig-unit>. `dx`/`dy` on a tspan shift it AND
// everything after it, so the attributes carry the DIFFERENCE from the previous unit's offset,
// which leaves each unit displaced by exactly its own offset. `rotate` turns each glyph about its
// own origin. Opacity is fill-opacity + stroke-opacity (a tspan has no `opacity`).
import { applyEasing } from './easing';
import { fmt } from './transform';
import type { TextAnimator } from './types';

export const TEXT_ANIMATOR_ORDERS = ['forward', 'reverse', 'center', 'random'] as const;

/** Split `content` into animation units. Words keep their trailing whitespace, so the units
 *  always join back to the content exactly. */
export function textUnits(content: string, by: TextAnimator['by']): string[] {
  if (by === 'word') return content.match(/\s*\S+\s*|\s+/g) ?? [];
  return Array.from(content);
}

/** One unit's pose at a time. */
export interface TextUnitPose {
  opacity: number;
  dx: number;
  dy: number;
  rotation: number;
}

function hash01(seed: number, i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 0xffffffff;
}

/** The start rank of each unit (0 = first) for an order. */
export function unitRanks(n: number, order: TextAnimator['order'], seed = 0): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  switch (order) {
    case 'reverse':
      return idx.map((i) => n - 1 - i);
    case 'center': {
      const mid = (n - 1) / 2;
      // Equal distance from the middle starts together.
      const min = n % 2 === 0 ? 0.5 : 0;
      return idx.map((i) => Math.round(Math.abs(i - mid) - min) + 0);
    }
    case 'random': {
      const sorted = [...idx].sort((a, b) => hash01(seed, a) - hash01(seed, b) || a - b);
      const rank = new Array<number>(n);
      sorted.forEach((unit, r) => (rank[unit] = r));
      return rank;
    }
    default:
      return idx;
  }
}

/** Seconds from the animator's start until its last unit is done (0 for no units). */
export function textAnimatorSpan(anim: TextAnimator, unitCount: number): number {
  if (unitCount === 0) return 0;
  const ranks = unitRanks(unitCount, anim.order, anim.seed);
  const last = Math.max(...ranks);
  return Math.max(0, anim.stagger) * last + Math.max(0, anim.duration);
}

/** When the animator is done (seconds on the object's timeline). */
export function textAnimatorEnd(anim: TextAnimator, content: string): number {
  return anim.start + textAnimatorSpan(anim, textUnits(content, anim.by).length);
}

/** Every unit's pose at `time`. */
export function sampleTextAnimator(anim: TextAnimator, content: string, time: number): TextUnitPose[] {
  const units = textUnits(content, anim.by);
  const ranks = unitRanks(units.length, anim.order, anim.seed);
  const from = {
    opacity: anim.from.opacity ?? 1,
    dx: anim.from.dx ?? 0,
    dy: anim.from.dy ?? 0,
    rotation: anim.from.rotation ?? 0,
  };
  const stagger = Math.max(0, anim.stagger);
  const duration = Math.max(0, anim.duration);
  return units.map((_, i) => {
    const t0 = anim.start + ranks[i] * stagger;
    const raw = duration > 0 ? (time - t0) / duration : time >= t0 ? 1 : 0;
    const u = applyEasing(anim.easing ?? 'easeOut', Math.min(1, Math.max(0, raw)));
    // amount of `from` still showing: 1 at the start of an "in", 0 at its end.
    const k = anim.direction === 'out' ? u : 1 - u;
    return {
      opacity: Math.min(1, Math.max(0, 1 + (from.opacity - 1) * k)),
      dx: from.dx * k,
      dy: from.dy * k,
      rotation: from.rotation * k,
    };
  });
}

/** Per-unit SVG attributes (string values) for the poses — the tspan contract. */
export interface TextUnitAttrs {
  dx: string;
  dy: string;
  rotate: string;
  opacity: string;
}

export function textUnitAttrs(poses: TextUnitPose[]): TextUnitAttrs[] {
  let px = 0;
  let py = 0;
  return poses.map((p) => {
    const a = { dx: fmt(p.dx - px), dy: fmt(p.dy - py), rotate: fmt(p.rotation), opacity: fmt(p.opacity) };
    px = p.dx;
    py = p.dy;
    return a;
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The tspans for a text object at `time` (markup string, for exports). */
export function textAnimatorMarkup(anim: TextAnimator, content: string, time: number): string {
  const units = textUnits(content, anim.by);
  const attrs = textUnitAttrs(sampleTextAnimator(anim, content, time));
  return units
    .map((u, i) => {
      const a = attrs[i];
      return `<tspan data-savig-unit="${i}" dx="${a.dx}" dy="${a.dy}" rotate="${a.rotate}" fill-opacity="${a.opacity}" stroke-opacity="${a.opacity}">${escapeXml(u)}</tspan>`;
    })
    .join('');
}

/** Ready-made animators (editor picker, MCP `preset`). */
export const TEXT_ANIMATOR_PRESETS: Record<string, { label: string; animator: Omit<TextAnimator, 'start'> }> = {
  typewriter: { label: 'Typewriter', animator: { by: 'char', stagger: 0.06, duration: 0, easing: 'linear', from: { opacity: 0 } } },
  fadeUp: { label: 'Fade up', animator: { by: 'char', stagger: 0.04, duration: 0.4, easing: 'easeOut', from: { opacity: 0, dy: 20 } } },
  dropIn: { label: 'Drop in', animator: { by: 'char', stagger: 0.05, duration: 0.5, easing: 'easeOut', from: { opacity: 0, dy: -40, rotation: -30 } } },
  wordsUp: { label: 'Words rise', animator: { by: 'word', stagger: 0.15, duration: 0.5, easing: 'easeOut', from: { opacity: 0, dy: 24 } } },
  scatter: { label: 'Scatter in', animator: { by: 'char', stagger: 0.03, duration: 0.6, easing: 'easeOut', order: 'random', from: { opacity: 0, dy: 30, rotation: 45 } } },
  fadeOut: { label: 'Fade out', animator: { by: 'char', stagger: 0.04, duration: 0.3, easing: 'easeIn', direction: 'out', from: { opacity: 0, dy: -12 } } },
};

/** True for a well-formed animator (load sanitizer + validate). */
export function isTextAnimator(v: unknown): v is TextAnimator {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  if (a.by !== 'char' && a.by !== 'word') return false;
  if (!num(a.start) || !num(a.stagger) || (a.stagger as number) < 0 || !num(a.duration) || (a.duration as number) < 0) return false;
  if (a.easing !== undefined && !['linear', 'easeIn', 'easeOut', 'easeInOut'].includes(a.easing as string)) return false;
  if (a.order !== undefined && !(TEXT_ANIMATOR_ORDERS as readonly string[]).includes(a.order as string)) return false;
  if (a.seed !== undefined && (!num(a.seed) || !Number.isInteger(a.seed))) return false;
  if (a.direction !== undefined && a.direction !== 'in' && a.direction !== 'out') return false;
  const f = a.from as Record<string, unknown> | undefined;
  if (!f || typeof f !== 'object') return false;
  for (const k of ['opacity', 'dx', 'dy', 'rotation']) if (f[k] !== undefined && !num(f[k])) return false;
  return true;
}
