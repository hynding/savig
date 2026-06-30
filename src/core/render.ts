/** Headless raster rendering — the agent's *eyes*. Renders a Project at an arbitrary time to a
 *  static SVG / PNG, so an agent can see what it authored and iterate.
 *
 *  Faithful BY CONSTRUCTION: it renders the real export markup (`renderSvgDocument`) and then bakes
 *  a single frame with the SAME `applyFrameToNodes(computeFrame(project, t))` the editor and the
 *  exported runtime use — no parallel render logic to drift. The frame is baked in jsdom (the exact
 *  DOM the whole test suite already validates `applyFrameToNodes` against), then rasterized by resvg.
 *
 *  NOTE: resvg covers shapes/paths/gradients/clipPaths; SVG filter effects (the per-instance `tint`
 *  overlay, slice 47f) may not rasterize — composition is still faithful, only the tint tint may be
 *  absent in the raster. */
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { computeProjectDuration } from '../engine';
import type { Project } from '../engine';
import { renderSvgDocument, renderProjectDocument } from '../services/export/renderDocument';
import { applyProjectFrame } from '../runtime/frame';

export interface RasterOpts {
  /** Fit the PNG to this width in px (height scales to preserve aspect). */
  width?: number;
  /** Fit to this height instead (ignored when `width` is set). */
  height?: number;
  /** Background paint behind the artboard. Default 'white' (clearest for an agent); pass
   *  'transparent' for an alpha PNG. */
  background?: string;
}

/** A static SVG string of the project frozen at `time` (seconds). The embedded animation runtime
 *  is stripped and every animated node is set to its value at `time`. */
export function renderFrameSvg(project: Project, time: number, opts?: { viewBox?: string }): string {
  const markup = project.scenes ? renderProjectDocument(project, opts) : renderSvgDocument(project, opts);
  const dom = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`);
  const svg = dom.window.document.querySelector('svg');
  if (!svg) throw new Error('savig/core: renderSvgDocument produced no <svg> root');
  // Drop the embedded runtime — we bake one static frame instead of animating.
  svg.querySelectorAll('script').forEach((s) => s.remove());
  // Map every animated leaf by its data-savig-object id, then apply the computed frame via the
  // SAME function the editor + runtime use, so the raster matches preview/export exactly.
  // For multi-scene, this collects all scenes' prefixed nodes; applyProjectFrame updates only the active scene.
  const nodes = new Map<string, Element>();
  svg.querySelectorAll('[data-savig-object]').forEach((el) => {
    const id = el.getAttribute('data-savig-object');
    if (id) nodes.set(id, el);
  });
  applyProjectFrame(svg, nodes, project, time);
  return svg.outerHTML;
}

function renderImage(svg: string, opts?: RasterOpts) {
  const fitTo = opts?.width
    ? ({ mode: 'width', value: opts.width } as const)
    : opts?.height
      ? ({ mode: 'height', value: opts.height } as const)
      : ({ mode: 'original' } as const);
  return new Resvg(svg, { fitTo, background: opts?.background ?? 'white' }).render();
}

/** Render the project at `time` (seconds) to a PNG. */
export function renderFramePng(project: Project, time: number, opts?: RasterOpts): Uint8Array {
  return renderImage(renderFrameSvg(project, time), opts).asPng();
}

/** Render the project at `time` to raw RGBA pixels (+ dimensions) — used by the GIF encoder. */
export function renderFrameRgba(project: Project, time: number, opts?: RasterOpts): { width: number; height: number; pixels: Uint8Array } {
  const img = renderImage(renderFrameSvg(project, time), opts);
  return { width: img.width, height: img.height, pixels: new Uint8Array(img.pixels) };
}

/** A small poster PNG (default: first frame, 320px wide) — a cheap thumbnail for libraries/previews. */
export function renderThumbnail(project: Project, opts?: { time?: number; width?: number; background?: string }): Uint8Array {
  return renderFramePng(project, opts?.time ?? 0, { width: opts?.width ?? 320, background: opts?.background });
}

/** Render `count` PNGs evenly spaced across the project's duration (default 9), returned as an
 *  array of `{ time, png }`. The caller (e.g. an MCP tool) can show them as a contact sheet. A
 *  single stitched sprite-sheet image is deferred — combining frames into one SVG would collide the
 *  export's def ids (gradients/clipPaths/symbol defs) across cells. */
export function renderFrames(project: Project, opts?: { count?: number } & RasterOpts): { time: number; png: Uint8Array }[] {
  const count = Math.max(1, opts?.count ?? 9);
  const duration = computeProjectDuration(project);
  const times = Array.from({ length: count }, (_, i) => (count === 1 ? 0 : (i / (count - 1)) * duration));
  return times.map((time) => ({ time, png: renderFramePng(project, time, opts) }));
}
