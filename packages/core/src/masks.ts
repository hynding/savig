/** Headless mask-layer builders (spec 2026-11-13 §DSL / MCP / macros, slice 3) — the agent path to
 *  Flash-style masks. Same contract as build.ts: pure, id-addressed, root-scene only (MCP wraps
 *  them in `withScene`), fail loud on bad references. A mask is an `isMask` object that is never
 *  drawn; its filled area reveals every object whose `maskedBy` names it. */
import { operandWorldRings, pathBounds } from '@savig/engine';
import type { Easing, Project, SceneObject } from '@savig/engine';
import { addEllipse, addRect, setAnchor, setKeyframe } from './build';

function requireObject(project: Project, id: string): SceneObject {
  const o = project.objects.find((x) => x.id === id);
  if (!o) throw new Error(`savig/core: no object with id "${id}"`);
  return o;
}

function withoutLink(o: SceneObject): SceneObject {
  if (o.maskedBy === undefined) return o;
  const out = { ...o };
  delete out.maskedBy;
  return out;
}

/** Make `maskId` a mask and link each of `targetIds` to it. The mask's own link (if any) is
 *  dropped; a target may not be the mask itself or another mask. */
export function createMask(project: Project, maskId: string, targetIds: string[]): Project {
  requireObject(project, maskId);
  if (targetIds.length === 0) throw new Error('savig/core: createMask needs at least one target');
  for (const id of targetIds) {
    const t = requireObject(project, id);
    if (id === maskId) throw new Error(`savig/core: "${id}" cannot mask itself`);
    if (t.isMask) throw new Error(`savig/core: "${id}" is a mask and cannot be masked`);
  }
  const targets = new Set(targetIds);
  return {
    ...project,
    objects: project.objects.map((o) =>
      o.id === maskId ? { ...withoutLink(o), isMask: true } : targets.has(o.id) ? { ...o, maskedBy: maskId } : o,
    ),
  };
}

/** Turn `maskId` back into an ordinary (drawn) object and unlink everything it masked. */
export function releaseMask(project: Project, maskId: string): Project {
  const m = requireObject(project, maskId);
  if (!m.isMask) throw new Error(`savig/core: "${maskId}" is not a mask`);
  return {
    ...project,
    objects: project.objects.map((o) => {
      if (o.id === maskId) {
        const out = { ...o };
        delete out.isMask;
        return out;
      }
      return o.maskedBy === maskId ? withoutLink(o) : o;
    }),
  };
}

/** Unlink `ids` from whatever masks them (they render unmasked). */
export function unmask(project: Project, ids: string[]): Project {
  for (const id of ids) requireObject(project, id);
  const set = new Set(ids);
  return { ...project, objects: project.objects.map((o) => (set.has(o.id) ? withoutLink(o) : o)) };
}

export type RevealStyle = 'wipe' | 'iris';
export type RevealFrom = 'left' | 'right' | 'top' | 'bottom';

export interface RevealOpts {
  /** Objects to reveal (each gets `maskedBy` = the new mask). */
  targetIds: string[];
  /** 'wipe' (default): a rectangle grows from one side. 'iris': a circle grows from the centre. */
  style?: RevealStyle;
  /** Wipe only: the side the reveal starts from (default 'left'). */
  from?: RevealFrom;
  /** Start time in seconds (default 0). */
  start?: number;
  /** Duration in seconds (default 1). */
  duration?: number;
  /** Easing of the end keyframe (default 'easeInOut'). */
  easing?: Easing;
  /** Area to reveal. Defaults to the union of the targets' world bounds at `start` (vector shapes
   *  and groups of them); required when a target has no measurable outline (svg/text/symbol). */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Id for the mask object (default: generated). */
  id?: string;
}

/** World bounds union of the targets at `time`, padded 1 unit so antialiased edges aren't clipped. */
function targetBounds(project: Project, ids: string[], time: number): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    for (const ring of operandWorldRings(project, requireObject(project, id), time)) {
      const b = pathBounds(ring);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
  }
  if (!Number.isFinite(minX)) {
    throw new Error('savig/core: reveal could not measure the targets (svg/text/symbol?) — pass `bounds`');
  }
  return { x: minX - 1, y: minY - 1, width: maxX - minX + 2, height: maxY - minY + 2 };
}

/** Macro: reveal `targetIds` with an animated mask in one call. A wipe is a rectangle covering the
 *  targets whose scale grows 0 → 1 from the `from` side; an iris is a circle circumscribing them
 *  that grows from the centre. Returns the new mask's id. */
export function reveal(project: Project, opts: RevealOpts): { project: Project; maskId: string } {
  if (!opts.targetIds?.length) throw new Error('savig/core: reveal needs at least one target');
  const start = opts.start ?? 0;
  const duration = opts.duration ?? 1;
  if (!(duration > 0)) throw new Error('savig/core: reveal duration must be > 0');
  const box = opts.bounds ?? targetBounds(project, opts.targetIds, start);
  const style = { fill: '#000000', stroke: 'none', strokeWidth: 0 };
  let p = project;
  let maskId: string;
  const ramp = (prop: 'scaleX' | 'scaleY') => {
    p = setKeyframe(p, { objectId: maskId, property: prop, time: start, value: 0 });
    p = setKeyframe(p, { objectId: maskId, property: prop, time: start + duration, value: 1, easing: opts.easing ?? 'easeInOut' });
  };
  if ((opts.style ?? 'wipe') === 'iris') {
    const d = Math.hypot(box.width, box.height);
    ({ project: p, id: maskId } = addEllipse(p, {
      x: box.x + box.width / 2 - d / 2, y: box.y + box.height / 2 - d / 2, width: d, height: d,
      id: opts.id, name: 'Iris mask', style,
    }));
    ramp('scaleX');
    ramp('scaleY');
  } else {
    const from = opts.from ?? 'left';
    ({ project: p, id: maskId } = addRect(p, { ...box, id: opts.id, name: `Wipe mask (${from})`, style }));
    const anchor = { left: { x: 0, y: 0.5 }, right: { x: 1, y: 0.5 }, top: { x: 0.5, y: 0 }, bottom: { x: 0.5, y: 1 } }[from];
    p = setAnchor(p, maskId, anchor);
    ramp(from === 'left' || from === 'right' ? 'scaleX' : 'scaleY');
  }
  return { project: createMask(p, maskId, opts.targetIds), maskId };
}
