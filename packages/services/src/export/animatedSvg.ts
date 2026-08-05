// Standalone animated SVG (SMIL) exporter. Samples the SAME frame engine the runtime plays
// (computeFrame) at project fps and bakes each animated FrameItem property into SMIL
// <animate>/<animateTransform> children, injected at the exact node applyFrameToNodes
// writes at play time (wrapper <g> vs inner shape vs def). Export == preview by construction.
// Spec: docs/superpowers/specs/2026-08-04-animated-svg-export-design.md
import { computeProjectDuration, fmt } from '@savig/engine';
import type { Project } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import type { FrameItem } from '@savig/runtime/frame';
import { renderProjectDocument } from './renderDocument';
import { decompose, parseTransform, unwrapDegrees } from './smilTransform';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** DOM constructors, injectable for the Node/MCP path (jsdom). Defaults to globals. */
export interface DomEnv {
  DOMParser: typeof DOMParser;
  XMLSerializer: typeof XMLSerializer;
}

interface Sampled {
  /** Uniform sample times 0..duration (N+1 entries) — keyTimes is omittable. */
  times: number[];
  /** frames[i] = computeFrame(project, times[i]) */
  frames: FrameItem[][];
  duration: number;
  loop: boolean;
}

function sampleProject(project: Project): Sampled | null {
  const duration = computeProjectDuration(project);
  if (!(duration > 0)) return null;
  const n = Math.max(1, Math.round(duration * project.meta.fps));
  const times: number[] = [];
  const frames: FrameItem[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i * duration) / n;
    times.push(t);
    frames.push(computeFrame(project, t));
  }
  return { times, frames, duration, loop: project.meta.loop };
}

/** Shared SMIL timing attributes. fill="freeze" is mandatory for non-loop (default
 *  fill="remove" snaps back to frame 0 when the animation ends). */
function timingAttrs(s: Sampled): Record<string, string> {
  return {
    begin: '0s',
    dur: `${fmt(s.duration)}s`,
    ...(s.loop ? { repeatCount: 'indefinite' } : { fill: 'freeze' }),
  };
}

/** Per-object per-frame series. Multi-scene computeFrame omits inactive scenes' objects, so
 *  gaps hold the last seen value (leading gaps take the first seen) — the scene group is
 *  hidden during a gap, so held values are invisible but keep list lengths uniform. */
function seriesFor(
  frames: FrameItem[][],
  objectId: string,
  pick: (it: FrameItem) => string | undefined,
): (string | undefined)[] {
  const raw = frames.map((frame) => {
    const item = frame.find((it) => it.objectId === objectId);
    return item ? pick(item) : undefined;
  });
  let first: string | undefined;
  for (const v of raw) if (v !== undefined) { first = v; break; }
  let prev = first;
  return raw.map((v) => (v === undefined ? prev : ((prev = v), v)));
}

function isConstant(values: (string | undefined)[]): boolean {
  return values.every((v) => v === values[0]);
}

/** Append one animation element as the LAST child of `target` (the shape stays
 *  firstElementChild — the runtime/raster contract). */
function appendAnim(
  target: Element,
  tag: 'animate' | 'animateTransform',
  attrs: Record<string, string>,
): void {
  const el = target.ownerDocument!.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  target.appendChild(el);
}

/** Bake a transform-string series into stacked animateTransforms: translate (replaces the
 *  static transform attr) then rotate/skewX/scale with additive="sum" — exactly T·R·SkX·S,
 *  the Task-1 decomposition order. Components that stay at identity are omitted EXCEPT
 *  translate, which anchors the replace semantics whenever the set is emitted at all. */
function appendTransformAnims(target: Element, transforms: string[], timing: Record<string, string>): void {
  const dec = transforms.map((t) => decompose(parseTransform(t)));
  const rotation = unwrapDegrees(dec.map((d) => d.rotation));
  const skewX = unwrapDegrees(dec.map((d) => d.skewX));
  const join = (vals: string[]) => vals.join(';');
  appendAnim(target, 'animateTransform', {
    attributeName: 'transform', type: 'translate',
    values: join(dec.map((d) => `${fmt(d.tx)},${fmt(d.ty)}`)), ...timing,
  });
  if (rotation.some((r) => Math.abs(r) > 1e-4)) {
    appendAnim(target, 'animateTransform', {
      attributeName: 'transform', type: 'rotate', additive: 'sum',
      values: join(rotation.map((r) => fmt(r))), ...timing,
    });
  }
  if (skewX.some((k) => Math.abs(k) > 1e-4)) {
    appendAnim(target, 'animateTransform', {
      attributeName: 'transform', type: 'skewX', additive: 'sum',
      values: join(skewX.map((k) => fmt(k))), ...timing,
    });
  }
  if (dec.some((d) => Math.abs(d.scaleX - 1) > 1e-4 || Math.abs(d.scaleY - 1) > 1e-4)) {
    appendAnim(target, 'animateTransform', {
      attributeName: 'transform', type: 'scale', additive: 'sum',
      values: join(dec.map((d) => `${fmt(d.scaleX)},${fmt(d.scaleY)}`)), ...timing,
    });
  }
}

/** Render the project as ONE self-contained SMIL-animated SVG document string. */
export function renderAnimatedSvgDocument(project: Project, env?: DomEnv): string {
  const Parser = env?.DOMParser ?? globalThis.DOMParser;
  const Serializer = env?.XMLSerializer ?? globalThis.XMLSerializer;
  const markup = renderProjectDocument(project);
  const sampled = sampleProject(project);
  if (!sampled) return markup; // zero duration -> static document as-is

  const doc = new Parser().parseFromString(markup, 'image/svg+xml');
  const timing = timingAttrs(sampled);

  // Wrapper map — identical construction to the runtime player's create().
  const nodes = new Map<string, Element>();
  doc.querySelectorAll('[data-savig-object]').forEach((el) => {
    nodes.set(el.getAttribute('data-savig-object')!, el);
  });
  // Def map by id (gradients, textpath defs) — no CSS.escape (absent in bare Node).
  const defsById = new Map<string, Element>();
  doc.querySelectorAll('[id]').forEach((el) => defsById.set(el.getAttribute('id')!, el));
  void defsById; // Tasks 3–4 extend here: shape attributes, gradients, textPath (using `defsById`).

  const objectIds = new Set<string>();
  for (const frame of sampled.frames) for (const it of frame) objectIds.add(it.objectId);

  for (const objectId of objectIds) {
    const wrapper = nodes.get(objectId);
    if (!wrapper) continue;
    const transforms = seriesFor(sampled.frames, objectId, (it) => it.transform) as string[];
    if (!isConstant(transforms)) appendTransformAnims(wrapper, transforms, timing);
    const opacity = seriesFor(sampled.frames, objectId, (it) => it.opacity) as string[];
    if (!isConstant(opacity)) {
      appendAnim(wrapper, 'animate', { attributeName: 'opacity', values: opacity.join(';'), ...timing });
    }
    // Tasks 3–4 extend here: shape attributes, gradients, textPath (using `defsById`).
  }
  // Task 5 extends here: scenes / cameras / dip overlay.

  return new Serializer().serializeToString(doc.documentElement);
}
