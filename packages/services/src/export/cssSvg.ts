// CSS-only animated SVG exporter (spec docs/superpowers/specs/2026-11-14-css-export-design.md).
// Same sampling as the SMIL exporter (computeFrame at project fps — export == preview by
// construction), but every animated property becomes a CSS `@keyframes` block in one <style>:
// no SMIL elements, no script. Properties CSS can't animate (gradient geometry/offsets, filter
// primitive attributes, textPath startOffset) hold their frame-0 value; per-character text
// offsets/rotation hold their LAST value (the settled pose) while unit opacity animates.
import { fmt, gradientStopAttrs } from '@savig/engine';
import type { Gradient, Project } from '@savig/engine';
import type { AssetBinaries } from './buildBundle';
import { renderProjectDocument } from './renderDocument';
import {
  appendDipOverlay, embedProjectMetadata, frameLayerVisibility, isConstant, parseRenderedDocument,
  rootCameraSeries, sampleProject, sceneSeries, seriesFor, SVG_NS, type DomEnv, type Sampled,
} from './sampling';
import { decompose, parseTransform, unwrapDegrees } from './smilTransform';

/** Keyframe offset nudge for an instant switch inside a linear track (a pair of keyframes this
 *  far apart, in percent — below one frame at any sane fps × duration). */
const JUMP_PCT = 0.001;

type Mode = 'linear' | 'step';

/** Collects @keyframes and per-element animation lists, then writes one <style>. */
class Sheet {
  private next = 0;
  private readonly keyframes: string[] = [];
  private readonly perElement = new Map<Element, { cls: string; anims: string[]; transform: boolean }>();

  constructor(private readonly s: Sampled) {}

  /** Animate CSS `prop` on `el` through `values` (one per sample). `jumps[i]` marks an instant
   *  switch at sample i inside a linear track. */
  animate(el: Element, prop: string, values: string[], mode: Mode, jumps?: boolean[]): void {
    const n = values.length - 1;
    const pct = (i: number) => (n > 0 ? (i / n) * 100 : 0);
    const frames: string[] = [];
    const push = (p: number, v: string) => frames.push(`${fmt(p)}%{${prop}:${v}}`);
    for (let i = 0; i <= n; i++) {
      const v = values[i];
      if (mode === 'step') {
        if (i === 0 || i === n || v !== values[i - 1]) push(pct(i), v);
        continue;
      }
      if (jumps?.[i] && i > 0 && v !== values[i - 1]) {
        push(Math.max(pct(i - 1), pct(i) - JUMP_PCT), values[i - 1]);
        push(pct(i), v);
        continue;
      }
      if (i > 0 && i < n && v === values[i - 1] && v === values[i + 1]) continue;
      push(pct(i), v);
    }
    const name = `savig-k${this.next++}`;
    this.keyframes.push(`@keyframes ${name}{${frames.join('')}}`);
    const entry = this.entry(el);
    const timing = this.s.loop ? 'infinite' : '1 forwards';
    entry.anims.push(`${name} ${fmt(this.s.duration)}s ${mode === 'step' ? 'step-end' : 'linear'} 0s ${timing}`);
    if (prop === 'transform') entry.transform = true;
  }

  private entry(el: Element) {
    let e = this.perElement.get(el);
    if (!e) {
      e = { cls: `savig-a${this.perElement.size}`, anims: [], transform: false };
      const prev = el.getAttribute('class');
      el.setAttribute('class', prev ? `${prev} ${e.cls}` : e.cls);
      this.perElement.set(el, e);
    }
    return e;
  }

  get empty(): boolean {
    return this.keyframes.length === 0;
  }

  css(): string {
    const rules = [...this.perElement.values()].map(
      (e) => `.${e.cls}{animation:${e.anims.join(',')}${e.transform ? ';transform-box:view-box;transform-origin:0 0' : ''}}`,
    );
    return [...this.keyframes, ...rules].join('\n');
  }
}

/** A transform-attribute series as matching CSS transform lists (unwrapped rotation, so the
 *  interpolation turns the short/right way exactly like the SMIL export). */
function cssTransforms(transforms: string[]): string[] {
  const dec = transforms.map((t) => decompose(parseTransform(t)));
  const rotation = unwrapDegrees(dec.map((d) => d.rotation));
  const skewX = unwrapDegrees(dec.map((d) => d.skewX));
  return dec.map(
    (d, i) => `translate(${fmt(d.tx)}px,${fmt(d.ty)}px) rotate(${fmt(rotation[i])}deg) skewX(${fmt(skewX[i])}deg) scale(${fmt(d.scaleX)},${fmt(d.scaleY)})`,
  );
}

const cssPath = (d: string) => `path("${d.replace(/"/g, '')}")`;

function sceneAndCameraCss(doc: Document, project: Project, sampled: Sampled, sheet: Sheet): void {
  if (!project.scenes) {
    const cam = doc.querySelector('[data-savig-camera]');
    if (cam) {
      const series = rootCameraSeries(project, sampled);
      if (!isConstant(series)) sheet.animate(cam, 'transform', cssTransforms(series), 'linear');
    }
    return;
  }
  const { perScene, dip, anyDip } = sceneSeries(project, sampled);
  doc.querySelectorAll('[data-savig-scene]').forEach((g) => {
    const st = perScene.get(g.getAttribute('data-savig-scene')!);
    if (!st) return;
    // CSS can't reliably animate `display`: a hidden scene is opacity 0 instead (its leaves'
    // own `visibility` attributes would defeat an inherited visibility:hidden).
    const opacity = st.display.map((d, i) => (d === 'none' ? '0' : st.opacity[i]));
    g.removeAttribute('style');
    g.removeAttribute('display');
    g.setAttribute('opacity', opacity[0]);
    if (!isConstant(opacity)) sheet.animate(g, 'opacity', opacity, 'linear', st.display.map((d, i) => i > 0 && d !== st.display[i - 1]));
    const camEl = g.querySelector('[data-savig-camera]');
    if (camEl && !isConstant(st.camera)) sheet.animate(camEl, 'transform', cssTransforms(st.camera), 'linear');
  });
  if (anyDip) {
    const rect = appendDipOverlay(doc, project, dip.fill[0]);
    rect.removeAttribute('display');
    const opacity = dip.display.map((d, i) => (d === 'none' ? '0' : dip.opacity[i]));
    sheet.animate(rect, 'opacity', opacity, 'linear', dip.display.map((d, i) => i > 0 && d !== dip.display[i - 1]));
    if (!isConstant(dip.fill)) sheet.animate(rect, 'fill', dip.fill, 'step');
  }
}

/** Render the project as ONE self-contained SVG animated purely by CSS @keyframes. */
export function renderCssSvgDocument(project: Project, env?: DomEnv, binaries?: AssetBinaries): string {
  const Parser = env?.DOMParser ?? globalThis.DOMParser;
  const Serializer = env?.XMLSerializer ?? globalThis.XMLSerializer;
  const doc = parseRenderedDocument(renderProjectDocument(project), Parser);
  embedProjectMetadata(doc, project, binaries);
  const sampled = sampleProject(project);
  if (!sampled) return new Serializer().serializeToString(doc.documentElement);
  const sheet = new Sheet(sampled);

  const nodes = new Map<string, Element>();
  doc.querySelectorAll('[data-savig-object]').forEach((el) => nodes.set(el.getAttribute('data-savig-object')!, el));
  const defsById = new Map<string, Element>();
  doc.querySelectorAll('[id]').forEach((el) => defsById.set(el.getAttribute('id')!, el));
  const objectIds = new Set<string>();
  for (const frame of sampled.frames) for (const it of frame) objectIds.add(it.objectId);

  for (const objectId of objectIds) {
    const wrapper = nodes.get(objectId);
    if (!wrapper || wrapper.tagName === 'filter') continue; // filter primitive attrs aren't CSS
    const shape = wrapper.firstElementChild;
    const series = (pick: Parameters<typeof seriesFor>[2]) => seriesFor(sampled.frames, objectId, pick);

    const transforms = series((it) => it.transform) as string[];
    if (!isConstant(transforms)) sheet.animate(wrapper, 'transform', cssTransforms(transforms), 'linear');
    const opacity = series((it) => it.opacity) as string[];
    if (!isConstant(opacity)) sheet.animate(wrapper, 'opacity', opacity, 'linear');
    const visibility = frameLayerVisibility(sampled.frames, objectId);
    if (visibility) sheet.animate(wrapper, 'visibility', visibility, 'step');

    if (shape) {
      const geomKeys = new Set<string>();
      for (const frame of sampled.frames) {
        const item = frame.find((it) => it.objectId === objectId);
        if (item?.geometry) for (const k of Object.keys(item.geometry)) geomKeys.add(k);
      }
      for (const key of geomKeys) {
        const vals = series((it) => it.geometry?.[key]);
        if (vals[0] !== undefined && !isConstant(vals)) sheet.animate(shape, key, (vals as string[]).map((v) => `${v}px`), 'linear');
      }
      const dVals = series((it) => it.pathD);
      if (dVals[0] !== undefined && !isConstant(dVals)) {
        const skeleton = (d: string) => d.replace(/[^A-Za-z]+/g, '');
        const stable = (dVals as string[]).every((d) => skeleton(d) === skeleton(dVals[0] as string));
        sheet.animate(shape, 'd', (dVals as string[]).map(cssPath), stable ? 'linear' : 'step');
      }
      for (const attr of ['fill', 'stroke'] as const) {
        const vals = series((it) => it[attr]);
        if (vals[0] !== undefined && !isConstant(vals)) sheet.animate(shape, attr, vals as string[], 'linear');
      }
      const dashoffset = series((it) => it.strokeDashoffset);
      if (dashoffset[0] !== undefined && !isConstant(dashoffset)) sheet.animate(shape, 'stroke-dashoffset', dashoffset as string[], 'linear');
      const dasharray = series((it) => it.strokeDasharray);
      if (dasharray[0] !== undefined && !isConstant(dasharray)) {
        const counts = (dasharray as string[]).map((v) => v.trim().split(/[\s,]+/).length);
        sheet.animate(shape, 'stroke-dasharray', dasharray as string[], counts.every((c) => c === counts[0]) ? 'linear' : 'step');
        shape.setAttribute('pathLength', '1'); // same pin as applyFrameToNodes
      }
    }

    // Per-character text animation (spec 2026-11-16-text-animator): unit opacity animates as
    // fill-/stroke-opacity; a tspan's dx/dy/rotate aren't CSS, so they hold the LAST frame (the
    // settled pose of an entrance).
    wrapper.querySelectorAll('tspan[data-savig-unit]').forEach((span, i) => {
      const opacity = series((it) => it.textUnits?.[i]?.opacity);
      if (opacity[0] !== undefined && !isConstant(opacity)) {
        sheet.animate(span, 'fill-opacity', opacity as string[], 'linear');
        sheet.animate(span, 'stroke-opacity', opacity as string[], 'linear');
      }
      for (const key of ['dx', 'dy', 'rotate'] as const) {
        const vals = series((it) => it.textUnits?.[i]?.[key]);
        const last = vals[vals.length - 1];
        if (last !== undefined) span.setAttribute(key, last);
      }
    });

    // Text-on-path outline: `d` on the savig-textpath-<id> def (startOffset isn't CSS: holds).
    const tpD = series((it) => it.textPathD);
    if (tpD[0] !== undefined && !isConstant(tpD)) {
      const def = defsById.get(`savig-textpath-${objectId}`);
      if (def) sheet.animate(def, 'd', (tpD as string[]).map(cssPath), 'linear');
    }

    // Gradient stop colour/opacity (stop offsets and gradient geometry aren't CSS: they hold).
    for (const paint of ['fill', 'stroke'] as const) {
      const grads = sampled.frames.map((frame) => {
        const item = frame.find((it) => it.objectId === objectId);
        return item ? (paint === 'fill' ? item.fillGradient : item.strokeGradient) : undefined;
      });
      let prev: Gradient | undefined;
      const held = grads.map((g) => (g === undefined ? prev : ((prev = g), g)));
      const firstIdx = held.findIndex((g) => g !== undefined);
      const def = defsById.get(`savig-grad-${objectId}-${paint}`);
      if (firstIdx === -1 || !def) continue;
      const filled = held.map((g) => g ?? held[firstIdx]!) as Gradient[];
      Array.from(def.children)
        .filter((c) => c.tagName === 'stop')
        .forEach((stopEl, j) => {
          for (const key of ['stop-color', 'stop-opacity']) {
            const vals = filled.map((g) => gradientStopAttrs(g.stops[Math.min(j, g.stops.length - 1)])[key] ?? (key === 'stop-opacity' ? '1' : undefined));
            if (vals.every((v) => v !== undefined) && !isConstant(vals)) sheet.animate(stopEl, key, vals as string[], 'linear');
          }
        });
    }
  }
  sceneAndCameraCss(doc, project, sampled, sheet);

  if (!sheet.empty) {
    const style = doc.createElementNS(SVG_NS, 'style');
    style.textContent = sheet.css();
    const root = doc.documentElement;
    const meta = root.querySelector('metadata[data-savig-source]');
    root.insertBefore(style, meta ? meta.nextSibling : root.firstChild);
  }
  return new Serializer().serializeToString(doc.documentElement);
}
