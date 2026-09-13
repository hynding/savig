// Frame pipeline for browser video export (spec §3/§4). The export markup is parsed ONCE into
// a DETACHED document (never inserted into the live DOM); applyProjectFrame — the SAME
// frame-baker the node rasterizer, exported player, and editor use — bakes each master time
// onto it (multi-scene + crossfade/dip transitions correct by construction), then the
// serialized string round-trips through <img> onto a canvas.
// Documented caveat (spec §4): SVG loaded via <img> never fetches external subresources —
// identical to the node resvg raster; native SVG filters (tint) DO rasterize here.
import type { Project } from '@savig/engine';
import { renderProjectDocument } from '@savig/services/export/renderDocument';
import { applyProjectFrame } from '@savig/runtime/frame';

export interface FrameSource {
  frameSvg(t: number): string;
}

export function createFrameSource(project: Project): FrameSource {
  const markup = renderProjectDocument(project);
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  // The node-raster recipe (core/node/render.ts): every [data-savig-object] element by id.
  const nodes = new Map<string, Element>();
  for (const el of Array.from(doc.querySelectorAll('[data-savig-object]'))) {
    const id = el.getAttribute('data-savig-object');
    if (id) nodes.set(id, el);
  }
  const serializer = new XMLSerializer();
  return {
    frameSvg(t: number): string {
      applyProjectFrame(svg, nodes, project, t);
      return serializer.serializeToString(svg);
    },
  };
}

/** Browser-only half (canvas + <img>; exercised by the e2e — jsdom has neither). The blob URL
 *  is ALWAYS revoked (spec §8 hygiene). Background is filled first: JPEG has no alpha. */
export function rasterizeSvgFrame(svg: string, width: number, height: number, background: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', 0.92);
      } catch (err) {
        reject(err as Error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('frame SVG failed to decode'));
    };
    img.src = url;
  });
}
