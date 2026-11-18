// Standalone animated SVG (SMIL) exporter. Samples the SAME frame engine the runtime plays
// (computeFrame) at project fps and bakes each animated FrameItem property into SMIL
// <animate>/<animateTransform> children, injected at the exact node applyFrameToNodes
// writes at play time (wrapper <g> vs inner shape vs def). Export == preview by construction.
// Spec: docs/superpowers/specs/2026-08-04-animated-svg-export-design.md
import { fmt, gradientAttrs, gradientStopAttrs } from '@savig/engine';
import type { FilterPrimitive, Gradient, Project } from '@savig/engine';
import type { FrameItem } from '@savig/runtime/frame';
import type { AssetBinaries } from './buildBundle';
import { renderProjectDocument } from './renderDocument';
import {
  appendDipOverlay, embedProjectMetadata, frameLayerVisibility, isConstant, parseRenderedDocument,
  rootCameraSeries, sampleProject, sceneSeries, seriesFor, SVG_NS, type DomEnv, type Sampled,
} from './sampling';
import { decompose, parseTransform, unwrapDegrees } from './smilTransform';

export type { DomEnv } from './sampling';

/** Attrs to merge in whenever an <animate> uses calcMode="discrete" — see Sampled.discreteKeyTimes. */
function discreteAttrs(s: Sampled): Record<string, string> {
  return { calcMode: 'discrete', keyTimes: s.discreteKeyTimes };
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

/** Scenes, camera and dip overlay as SMIL (series from `sceneSeries`, which replicates
 *  applyProjectFrame's decisions). */
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
      const series = rootCameraSeries(project, sampled);
      if (!isConstant(series)) appendTransformAnims(cam, series, timing);
    }
    return;
  }
  const { perScene, dip, anyDip } = sceneSeries(project, sampled);

  doc.querySelectorAll('[data-savig-scene]').forEach((g) => {
    const st = perScene.get(g.getAttribute('data-savig-scene')!);
    if (!st) return;
    // SMIL animates the display ATTRIBUTE; strip the renderer's inline style (which would
    // outrank the base attribute) and re-express frame-0 visibility as an attribute.
    g.removeAttribute('style');
    g.setAttribute('display', st.display[0]);
    if (!isConstant(st.display)) {
      appendAnim(g, 'animate', { attributeName: 'display', values: st.display.join(';'), ...discreteAttrs(sampled), ...timing });
    }
    if (!isConstant(st.opacity)) {
      appendAnim(g, 'animate', { attributeName: 'opacity', values: st.opacity.join(';'), ...timing });
    }
    const camEl = g.querySelector('[data-savig-camera]');
    if (camEl && !isConstant(st.camera)) appendTransformAnims(camEl, st.camera, timing);
  });

  if (anyDip) {
    const rect = appendDipOverlay(doc, project, dip.fill[0]);
    appendAnim(rect, 'animate', { attributeName: 'display', values: dip.display.join(';'), ...discreteAttrs(sampled), ...timing });
    appendAnim(rect, 'animate', { attributeName: 'opacity', values: dip.opacity.join(';'), ...timing });
    if (!isConstant(dip.fill)) {
      appendAnim(rect, 'animate', { attributeName: 'fill', values: dip.fill.join(';'), ...discreteAttrs(sampled), ...timing });
    }
  }
}

/** Filters: the `<filter>` def's primitive structure is time-invariant, so primitive elements
 *  (depth-first, children included) line up by index with each frame's `filterPrims`. Every
 *  attribute whose value changes gets one `<animate>` on its primitive. */
function appendFilterAnims(def: Element, frames: FrameItem[][], objectId: string, timing: Record<string, string>): void {
  const flat = (list: FilterPrimitive[]): FilterPrimitive[] => list.flatMap((p) => [p, ...flat(p.children ?? [])]);
  const elems: Element[] = [];
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      elems.push(c);
      walk(c);
    }
  };
  walk(def);
  const perFrame = frames.map((frame) => {
    const item = frame.find((it) => it.objectId === objectId);
    return item?.filterPrims ? flat(item.filterPrims) : undefined;
  });
  elems.forEach((el, j) => {
    const keys = new Set<string>();
    for (const f of perFrame) if (f?.[j]) for (const k of Object.keys(f[j].attrs)) keys.add(k);
    for (const key of keys) {
      if (key === 'in' || key === 'in2' || key === 'result') continue;
      const vals = seriesFor(frames, objectId, (it) => (it.filterPrims ? flat(it.filterPrims)[j]?.attrs[key] : undefined));
      if (vals[0] !== undefined && !isConstant(vals)) {
        appendAnim(el, 'animate', { attributeName: key, values: (vals as string[]).join(';'), ...timing });
      }
    }
  });
}

/** Render the project as ONE self-contained SMIL-animated SVG document string. */
export function renderAnimatedSvgDocument(project: Project, env?: DomEnv, binaries?: AssetBinaries): string {
  const Parser = env?.DOMParser ?? globalThis.DOMParser;
  const Serializer = env?.XMLSerializer ?? globalThis.XMLSerializer;
  const markup = renderProjectDocument(project);
  const sampled = sampleProject(project);

  const doc = parseRenderedDocument(markup, Parser);
  embedProjectMetadata(doc, project, binaries);

  if (sampled) {
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
      if (wrapper.tagName === 'filter') {
        appendFilterAnims(wrapper, sampled.frames, objectId, timing);
        continue;
      }
      // Read BEFORE any wrapper-level animates are appended — for `<g>` wrappers firstElementChild
      // stays the shape regardless (appends land at the end), but for `<use>` wrappers with an
      // animated transform, reading this after appendTransformAnims would return the just-appended
      // animateTransform instead of the shape.
      const shape = wrapper.firstElementChild;
      const transforms = seriesFor(sampled.frames, objectId, (it) => it.transform) as string[];
      if (!isConstant(transforms)) appendTransformAnims(wrapper, transforms, timing);
      const opacity = seriesFor(sampled.frames, objectId, (it) => it.opacity) as string[];
      if (!isConstant(opacity)) {
        appendAnim(wrapper, 'animate', { attributeName: 'opacity', values: opacity.join(';'), ...timing });
      }
      // Frame-by-frame exposure (spec 2026-11-07 §Render & export, slice 5): one discrete
      // visibility animate per frame-layer leaf, frame-exact via the shared keyTimes grid.
      // renderDocument already set the frame-0 `visibility` attribute; the animate outranks it.
      const visibility = frameLayerVisibility(sampled.frames, objectId);
      if (visibility) {
        appendAnim(wrapper, 'animate', { attributeName: 'visibility', values: visibility.join(';'), ...discreteAttrs(sampled), ...timing });
      }

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
            ...(stable ? {} : discreteAttrs(sampled)), ...timing,
          });
        }

        // Color tracks (computeFrame already suppresses these when a gradient paint owns the attr).
        for (const attr of ['fill', 'stroke'] as const) {
          const vals = seriesFor(sampled.frames, objectId, (it) => it[attr]);
          if (vals[0] !== undefined && !isConstant(vals)) {
            appendAnim(shape, 'animate', { attributeName: attr, values: (vals as string[]).join(';'), ...timing });
          }
        }

        // Variable-width stroke outline (spec 2026-11-18-variable-width): its `d` follows the
        // path (vertex counts vary with the outline, so a changing skeleton steps per frame) and
        // its fill carries an animated stroke colour.
        const outline = wrapper.querySelector('[data-savig-width]');
        if (outline) {
          const wVals = seriesFor(sampled.frames, objectId, (it) => it.widthD);
          if (wVals[0] !== undefined && !isConstant(wVals)) {
            const skeleton = (d: string) => d.replace(/[^A-Za-z]+/g, '');
            const stable = (wVals as string[]).every((d) => skeleton(d) === skeleton(wVals[0] as string));
            appendAnim(outline, 'animate', {
              attributeName: 'd', values: (wVals as string[]).join(';'),
              ...(stable ? {} : discreteAttrs(sampled)), ...timing,
            });
          }
          const wFill = seriesFor(sampled.frames, objectId, (it) => it.widthFill);
          if (wFill[0] !== undefined && !isConstant(wFill)) {
            appendAnim(outline, 'animate', { attributeName: 'fill', values: (wFill as string[]).join(';'), ...timing });
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
            ...(uniform ? {} : discreteAttrs(sampled)), ...timing,
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

      // Per-character text animation (spec 2026-11-16-text-animator): each unit's tspan attrs.
      wrapper.querySelectorAll('tspan[data-savig-unit]').forEach((span, i) => {
        for (const [key, attrs] of [['dx', ['dx']], ['dy', ['dy']], ['rotate', ['rotate']], ['opacity', ['fill-opacity', 'stroke-opacity']]] as const) {
          const vals = seriesFor(sampled.frames, objectId, (it) => it.textUnits?.[i]?.[key]);
          if (vals[0] === undefined || isConstant(vals)) continue;
          for (const attributeName of attrs) appendAnim(span, 'animate', { attributeName, values: (vals as string[]).join(';'), ...timing });
        }
      });

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
  }

  return new Serializer().serializeToString(doc.documentElement);
}
