// Trace Bitmap (spec 2026-11-18-trace-bitmap), browser side: decode an image asset's pixels with a
// canvas (downscaled so the longest side is at most TRACE_MAX_SIDE) and run the engine tracer.
import { traceBitmap, type ImageAsset, type TraceOptions, type TracedRegion } from '@savig/engine';

export const TRACE_MAX_SIDE = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The picture could not be decoded.'));
    img.src = src;
  });
}

export async function traceImageAsset(asset: ImageAsset, options: TraceOptions): Promise<TracedRegion[]> {
  const img = await loadImage(asset.dataUrl);
  const k = Math.min(1, TRACE_MAX_SIDE / Math.max(asset.width, asset.height));
  const w = Math.max(1, Math.round(asset.width * k));
  const h = Math.max(1, Math.round(asset.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read picture pixels.');
  ctx.imageSmoothingEnabled = k < 1;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return traceBitmap({ width: w, height: h, data }, { ...options, pixelSize: asset.width / w });
}
