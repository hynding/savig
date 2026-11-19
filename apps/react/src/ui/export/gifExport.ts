// Browser animated-GIF export (roadmap 11). Same frame pipeline as video export (createFrameSource:
// the shared applyProjectFrame baker over a detached document), rasterized to RGBA on a canvas and
// encoded with the pure-JS `gifenc` (per-frame 256-colour quantization) — no ffmpeg.wasm needed.
// The MCP path renders GIFs the same way from resvg pixels (packages/core/src/node/gif.ts).
// Operates on a SNAPSHOT of the project taken at Export-click; cancel resolves null (no partial file).
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { computeProjectDuration } from '@savig/engine';
import type { Project } from '@savig/engine';
import { createFrameSource, type FrameSource } from './frameSource';

/** GIF frame delays are stored in hundredths of a second, so 50 fps (2 cs) is the fastest rate
 *  that browsers play as written. */
export const GIF_MAX_FPS = 50;
/** Wider GIFs balloon in size and encode time; video export goes to 3840. */
export const GIF_MAX_WIDTH = 1920;

export interface GifExportOptions {
  fps: number;
  width: number;
  /** true = loop forever (the GIF default), false = play once. */
  loop: boolean;
  /** Paint behind the artboard (GIF has 1-bit alpha at best, so frames are flattened). */
  background?: string;
}

export interface GifExportResult {
  bytes: Uint8Array;
  filename: string;
  mime: 'image/gif';
}

export interface RgbaFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface GifExportDeps {
  makeFrameSource: (project: Project) => FrameSource;
  rasterizeRgba: (svg: string, width: number, height: number, background: string) => Promise<RgbaFrame>;
}

const DEFAULT_DEPS: GifExportDeps = {
  makeFrameSource: createFrameSource,
  rasterizeRgba: rasterizeSvgFrameRgba,
};

/** The whole-number frame rate a GIF is encoded at (1..GIF_MAX_FPS). */
export function gifFps(fps: number): number {
  return Math.max(1, Math.min(GIF_MAX_FPS, Math.round(fps)));
}

/** The frame plan for a GIF: clamped fps/size, frame count, and the per-frame delay gifenc
 *  writes (ms; gifenc rounds to centiseconds). Pure, so the dialog readout and the encoder agree. */
export function gifFramePlan(project: Project, opts: Pick<GifExportOptions, 'fps' | 'width'>) {
  const fps = gifFps(Number.isFinite(opts.fps) ? opts.fps : project.meta.fps);
  const rawWidth = Number.isFinite(opts.width) ? opts.width : project.meta.width;
  const width = Math.max(16, Math.min(GIF_MAX_WIDTH, Math.round(rawWidth)));
  const height = Math.max(1, Math.round((width * project.meta.height) / project.meta.width));
  const duration = computeProjectDuration(project);
  const frameCount = duration > 0 ? Math.max(1, Math.round(duration * fps)) : 1;
  return { fps, width, height, frameCount, duration, delayMs: Math.round(1000 / fps) };
}

export async function exportGif(
  project: Project,
  opts: GifExportOptions,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  deps: Partial<GifExportDeps> = {},
): Promise<GifExportResult | null> {
  const d = { ...DEFAULT_DEPS, ...deps };
  const plan = gifFramePlan(project, opts);
  if (plan.duration <= 0) throw new Error('Nothing to export: the project has zero duration.');
  const background = opts.background ?? 'white';
  const src = d.makeFrameSource(project);
  const gif = GIFEncoder();
  onProgress(0);
  for (let i = 0; i < plan.frameCount; i++) {
    if (signal.aborted) return null;
    const frame = await d.rasterizeRgba(src.frameSvg(i / plan.fps), plan.width, plan.height, background);
    if (signal.aborted) return null;
    const palette = quantize(frame.pixels, 256);
    const index = applyPalette(frame.pixels, palette);
    // `repeat` is only read on the first frame: 0 = loop forever, -1 = play once (no NETSCAPE block).
    gif.writeFrame(index, frame.width, frame.height, { palette, delay: plan.delayMs, repeat: opts.loop ? 0 : -1 });
    onProgress((i + 1) / plan.frameCount);
  }
  gif.finish();
  return { bytes: gif.bytes(), filename: `${project.meta.name}.gif`, mime: 'image/gif' };
}

/** Browser-only half (canvas + <img>; exercised by the e2e — jsdom has neither): draw one frame's
 *  SVG over the background and read its pixels back. The blob URL is always revoked. */
export function rasterizeSvgFrameRgba(svg: string, width: number, height: number, background: string): Promise<RgbaFrame> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  return new Promise<RgbaFrame>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        resolve({ width, height, pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
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
