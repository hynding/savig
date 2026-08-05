// Standalone animated SVG (SMIL) exporter. Samples the SAME frame engine the runtime plays
// (computeFrame) at project fps and bakes each animated FrameItem property into SMIL
// <animate>/<animateTransform> children, injected at the exact node applyFrameToNodes
// writes at play time (wrapper <g> vs inner shape vs def). Export == preview by construction.
// Spec: docs/superpowers/specs/2026-08-04-animated-svg-export-design.md
import {
  computeCameraTransform, computeProjectDuration, computeSceneCameraTransform, fmt,
  gradientAttrs, gradientStopAttrs, projectScenes, sceneAtTime,
} from '@savig/engine';
import type { Gradient, Project } from '@savig/engine';
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

/** Per-frame scene/camera state, replicating applyProjectFrame's decisions (packages/runtime/src/
 *  frame.ts:271) exactly: crossfade fades IN the incoming (primary) group while the outgoing stays
 *  full opacity; dip shows the outgoing group in the first half of the overlap and the incoming in
 *  the second half, with a full-frame overlay ramping opacity 0→1→0 (triangle) in the dip color. */
function appendCameraAndSceneAnims(
  doc: Document,
  project: Project,
  sampled: Sampled,
  timing: Record<string, string>,
): void {
  if (!project.scenes) {
    // Single-scene root camera.
    const cam = doc.querySelector('[data-savig-camera]');
    if (cam) {
      const series = sampled.times.map((t) => computeCameraTransform(project, t) ?? '');
      if (!isConstant(series)) appendTransformAnims(cam, series, timing);
    }
    return;
  }

  const scenes = projectScenes(project);
  const perScene = new Map<string, { display: string[]; opacity: string[]; camera: string[] }>();
  for (const s of scenes) perScene.set(s.id, { display: [], opacity: [], camera: [] });
  const dip = { display: [] as string[], opacity: [] as string[], fill: [] as string[] };
  let anyDip = false;
  const lastCamera = new Map<string, string>();

  for (const t of sampled.times) {
    const { primary, outgoing } = sceneAtTime(project, t);
    const transition = outgoing ? primary.scene.transitionIn : undefined;
    const dipT = transition && transition.kind === 'dip' ? transition : null;
    const crossfade = !!(transition && transition.kind === 'crossfade');
    const second = outgoing ? outgoing.progress >= 0.5 : false;

    for (const s of scenes) {
      const st = perScene.get(s.id)!;
      let visible = false;
      let opacity = '1';
      let localTime: number | null = null;
      if (s.id === primary.scene.id) {
        visible = dipT ? second : true;
        if (outgoing && crossfade) opacity = fmt(outgoing.progress);
        localTime = primary.localTime;
      } else if (outgoing && s.id === outgoing.scene.id) {
        visible = dipT ? !second : true;
        localTime = outgoing.localTime;
      }
      st.display.push(visible ? 'inline' : 'none');
      st.opacity.push(opacity);
      const camT = localTime !== null
        ? computeSceneCameraTransform(s.camera, project.meta.width, project.meta.height, localTime)
        : null;
      const held = camT ?? lastCamera.get(s.id) ?? '';
      lastCamera.set(s.id, held);
      st.camera.push(held);
    }

    if (outgoing && dipT) {
      anyDip = true;
      const pgs = outgoing.progress;
      dip.display.push('inline');
      dip.opacity.push(fmt(pgs < 0.5 ? pgs / 0.5 : (1 - pgs) / 0.5));
      dip.fill.push(dipT.color);
    } else {
      dip.display.push('none');
      dip.opacity.push('0');
      dip.fill.push(dip.fill[dip.fill.length - 1] ?? '#000000');
    }
  }

  doc.querySelectorAll('[data-savig-scene]').forEach((g) => {
    const st = perScene.get(g.getAttribute('data-savig-scene')!);
    if (!st) return;
    // SMIL animates the display ATTRIBUTE; strip the renderer's inline style (which would
    // outrank the base attribute) and re-express frame-0 visibility as an attribute.
    g.removeAttribute('style');
    g.setAttribute('display', st.display[0]);
    if (!isConstant(st.display)) {
      appendAnim(g, 'animate', { attributeName: 'display', values: st.display.join(';'), calcMode: 'discrete', ...timing });
    }
    if (!isConstant(st.opacity)) {
      appendAnim(g, 'animate', { attributeName: 'opacity', values: st.opacity.join(';'), ...timing });
    }
    const camEl = g.querySelector('[data-savig-camera]');
    if (camEl && !isConstant(st.camera)) appendTransformAnims(camEl, st.camera, timing);
  });

  if (anyDip) {
    // Eager dip overlay — same geometry as the runtime's lazy ensureDipOverlay, last child = top z.
    const root = doc.documentElement;
    const rect = doc.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('data-savig-dip', '');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', fmt(project.meta.width));
    rect.setAttribute('height', fmt(project.meta.height));
    rect.setAttribute('opacity', '0');
    rect.setAttribute('display', 'none');
    rect.setAttribute('fill', dip.fill[0]);
    root.appendChild(rect);
    appendAnim(rect, 'animate', { attributeName: 'display', values: dip.display.join(';'), calcMode: 'discrete', ...timing });
    appendAnim(rect, 'animate', { attributeName: 'opacity', values: dip.opacity.join(';'), ...timing });
    if (!isConstant(dip.fill)) {
      appendAnim(rect, 'animate', { attributeName: 'fill', values: dip.fill.join(';'), calcMode: 'discrete', ...timing });
    }
  }
}

/** Render the project as ONE self-contained SMIL-animated SVG document string. */
export function renderAnimatedSvgDocument(project: Project, env?: DomEnv): string {
  const Parser = env?.DOMParser ?? globalThis.DOMParser;
  const Serializer = env?.XMLSerializer ?? globalThis.XMLSerializer;
  const markup = renderProjectDocument(project);
  const sampled = sampleProject(project);
  if (!sampled) return markup; // zero duration -> static document as-is

  // renderDocument's camera wrap emits a bare `data-savig-camera` (no value) — a valid HTML
  // boolean attribute, but strict-XML `image/svg+xml` parsing rejects it ("attribute without
  // value"). Normalize to an explicit empty value before parsing; renderDocument's own output
  // (and every other exporter reading it) is untouched — only this exporter's re-parse sees it.
  const doc = new Parser().parseFromString(markup.replace(/data-savig-camera(?!=)/g, 'data-savig-camera=""'), 'image/svg+xml');
  const timing = timingAttrs(sampled);

  // Wrapper map — identical construction to the runtime player's create().
  const nodes = new Map<string, Element>();
  doc.querySelectorAll('[data-savig-object]').forEach((el) => {
    nodes.set(el.getAttribute('data-savig-object')!, el);
  });
  // Def map by id (gradients, textpath defs) — no CSS.escape (absent in bare Node).
  const defsById = new Map<string, Element>();
  doc.querySelectorAll('[id]').forEach((el) => defsById.set(el.getAttribute('id')!, el));

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
    const shape = wrapper.firstElementChild;

    // Geometry attributes (rect/ellipse/polygon/etc.). Union of keys across frames; each key
    // becomes one <animate> on the inner shape.
    if (shape) {
      const geomKeys = new Set<string>();
      for (const frame of sampled.frames) {
        const item = frame.find((it) => it.objectId === objectId);
        if (item?.geometry) for (const k of Object.keys(item.geometry)) geomKeys.add(k);
      }
      for (const key of geomKeys) {
        const vals = seriesFor(sampled.frames, objectId, (it) => it.geometry?.[key]);
        if (!isConstant(vals) && vals[0] !== undefined) {
          appendAnim(shape, 'animate', { attributeName: key, values: (vals as string[]).join(';'), ...timing });
        }
      }

      // Path morphs / live booleans. Linear interpolation requires an identical command
      // skeleton in every sample; topology changes (booleans) fall back to discrete.
      const dVals = seriesFor(sampled.frames, objectId, (it) => it.pathD);
      if (dVals[0] !== undefined && !isConstant(dVals)) {
        const skeleton = (d: string) => d.replace(/[^A-Za-z]+/g, '');
        const stable = (dVals as string[]).every((d) => skeleton(d) === skeleton(dVals[0] as string));
        appendAnim(shape, 'animate', {
          attributeName: 'd', values: (dVals as string[]).join(';'),
          ...(stable ? {} : { calcMode: 'discrete' }), ...timing,
        });
      }

      // Color tracks (computeFrame already suppresses these when a gradient paint owns the attr).
      for (const attr of ['fill', 'stroke'] as const) {
        const vals = seriesFor(sampled.frames, objectId, (it) => it[attr]);
        if (vals[0] !== undefined && !isConstant(vals)) {
          appendAnim(shape, 'animate', { attributeName: attr, values: (vals as string[]).join(';'), ...timing });
        }
      }

      // Dash offset (dashOffsetTrack) and trim window (dasharray width animates too).
      const dashoffset = seriesFor(sampled.frames, objectId, (it) => it.strokeDashoffset);
      if (dashoffset[0] !== undefined && !isConstant(dashoffset)) {
        appendAnim(shape, 'animate', { attributeName: 'stroke-dashoffset', values: (dashoffset as string[]).join(';'), ...timing });
      }
      const dasharray = seriesFor(sampled.frames, objectId, (it) => it.strokeDasharray);
      if (dasharray[0] !== undefined && !isConstant(dasharray)) {
        const counts = (dasharray as string[]).map((v) => v.trim().split(/[\s,]+/).length);
        const uniform = counts.every((c) => c === counts[0]);
        appendAnim(shape, 'animate', {
          attributeName: 'stroke-dasharray', values: (dasharray as string[]).join(';'),
          ...(uniform ? {} : { calcMode: 'discrete' }), ...timing,
        });
        shape.setAttribute('pathLength', '1'); // idempotent; same pin as applyFrameToNodes
      }
    }

    // Text-on-path: d lives on the savig-textpath-<id> def; startOffset on the <textPath> child.
    const tpD = seriesFor(sampled.frames, objectId, (it) => it.textPathD);
    if (tpD[0] !== undefined && !isConstant(tpD)) {
      const def = defsById.get(`savig-textpath-${objectId}`);
      if (def) appendAnim(def, 'animate', { attributeName: 'd', values: (tpD as string[]).join(';'), ...timing });
    }
    const tpOff = seriesFor(sampled.frames, objectId, (it) => it.textPathStartOffset);
    if (tpOff[0] !== undefined && !isConstant(tpOff)) {
      const tp = wrapper.querySelector('textPath');
      if (tp) appendAnim(tp, 'animate', { attributeName: 'startOffset', values: (tpOff as string[]).join(';'), ...timing });
    }

    // Animated gradients: bake onto the existing savig-grad-<id> def — geometry attrs on the
    // gradient element, stop attrs per <stop> child. Baseline stops = the frame-0 def's
    // children; frames with a different stop count clamp by index (SMIL cannot add/remove
    // stops — known approximation, mirrored on both paints).
    for (const paint of ['fill', 'stroke'] as const) {
      const grads = sampled.frames.map((frame) => {
        const item = frame.find((it) => it.objectId === objectId);
        return item ? (paint === 'fill' ? item.fillGradient : item.strokeGradient) : undefined;
      });
      if (!grads.some((g) => g !== undefined)) continue;
      // Hold gaps like seriesFor (inactive scene frames).
      let prev: Gradient | undefined;
      const held = grads.map((g) => (g === undefined ? prev : ((prev = g), g)));
      const firstIdx = held.findIndex((g) => g !== undefined);
      if (firstIdx === -1) continue;
      const filled = held.map((g) => g ?? held[firstIdx]!) as Gradient[];
      const def = defsById.get(`savig-grad-${objectId}-${paint}`);
      if (!def) continue;

      // Gradient geometry attributes (x1/y1/x2/y2 | cx/cy/r/fx/fy).
      const attrKeys = new Set<string>();
      for (const g of filled) for (const k of Object.keys(gradientAttrs(g))) attrKeys.add(k);
      for (const key of attrKeys) {
        const vals = filled.map((g) => gradientAttrs(g)[key] ?? '0');
        if (!isConstant(vals)) appendAnim(def, 'animate', { attributeName: key, values: vals.join(';'), ...timing });
      }

      // Per-stop attributes, clamped by index against each frame's stop list.
      const stops = Array.from(def.children).filter((c) => c.tagName === 'stop');
      stops.forEach((stopEl, j) => {
        for (const key of ['offset', 'stop-color', 'stop-opacity']) {
          const vals = filled.map((g) => {
            const s = g.stops[Math.min(j, g.stops.length - 1)];
            return gradientStopAttrs(s)[key] ?? (key === 'stop-opacity' ? '1' : undefined);
          });
          if (vals.every((v) => v !== undefined) && !isConstant(vals)) {
            appendAnim(stopEl, 'animate', { attributeName: key, values: (vals as string[]).join(';'), ...timing });
          }
        }
      });
    }
  }
  appendCameraAndSceneAnims(doc, project, sampled, timing);

  return new Serializer().serializeToString(doc.documentElement);
}
