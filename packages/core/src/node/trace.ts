/** Trace Bitmap for agents (spec 2026-11-18-trace-bitmap, slice 2): decode an image asset's pixels
 *  with resvg (PNG / JPEG / GIF / WebP, no browser needed) and trace it with the same engine
 *  `traceBitmap` + `applyTrace` the editor uses. Root scene, fail loud. */
import { Resvg } from '@resvg/resvg-js';
import { applyTrace, traceBitmap } from '@savig/engine';
import type { ImageAsset, Project, RasterImage, TraceOptions } from '@savig/engine';

/** Longest traced side in pixels (larger pictures are traced from a scaled copy). */
export const TRACE_MAX_SIDE = 1024;

/** Decode `asset` to RGBA, scaled down so its longest side is at most `maxSide`. */
export function decodeImageAsset(asset: ImageAsset, maxSide = TRACE_MAX_SIDE): RasterImage {
  const k = Math.min(1, maxSide / Math.max(asset.width, asset.height));
  const w = Math.max(1, Math.round(asset.width * k));
  const h = Math.max(1, Math.round(asset.height * k));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${asset.width} ${asset.height}">` +
    `<image width="${asset.width}" height="${asset.height}" preserveAspectRatio="none" xlink:href="${asset.dataUrl}"/></svg>`;
  const img = new Resvg(svg, { fitTo: { mode: 'original' } }).render();
  return { width: img.width, height: img.height, data: new Uint8Array(img.pixels) };
}

/** Replace image object `id` with its trace: a same-id group of filled drawings, one per color. */
export function traceImageObject(project: Project, id: string, options: TraceOptions = {}): Project {
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`savig/core: no object "${id}"`);
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (obj.isGroup || asset?.kind !== 'image') throw new Error(`savig/core: "${id}" is not an imported picture`);
  if (options.colors !== undefined && !(Number.isFinite(options.colors) && options.colors >= 2 && options.colors <= 64)) {
    throw new Error(`savig/core: colors must be 2–64 (got ${options.colors})`);
  }
  if (options.minArea !== undefined && !(Number.isFinite(options.minArea) && options.minArea >= 0)) {
    throw new Error(`savig/core: minArea must be 0 or more pixels (got ${options.minArea})`);
  }
  const raster = decodeImageAsset(asset);
  const regions = traceBitmap(raster, { ...options, pixelSize: asset.width / raster.width });
  const r = applyTrace(project.objects, project.assets, id, regions);
  if ('refused' in r) {
    const why = { 'not-an-image': 'is not an imported picture', locked: 'is locked', empty: 'traced to nothing (empty or fully transparent)' }[r.refused];
    throw new Error(`savig/core: "${id}" ${why}`);
  }
  return { ...project, objects: r.objects, assets: r.assets };
}
