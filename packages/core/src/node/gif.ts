/** Animated GIF export — gives an agent (or a chat) a single self-playing artifact to view,
 *  vs. a contact sheet of stills. Renders the project's frames to raw RGBA via resvg (slice 2) and
 *  encodes them with the pure-JS `gifenc` (per-frame 256-colour quantization). */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { computeProjectDuration } from '@savig/engine';
import type { Project } from '@savig/engine';
import { renderFrameRgba } from './render';

export interface GifOpts {
  /** Frames per second of the GIF (default = min(project fps, 25), clamped 1..50). */
  fps?: number;
  /** Output width in px (height scales to preserve aspect; default = artboard width). */
  width?: number;
  /** Background paint (default 'white'). */
  background?: string;
  /** Hard cap on the number of frames (safety for long shorts). */
  maxFrames?: number;
}

/** Encode the project as a looping animated GIF (Uint8Array). Frame `i` shows the project at
 *  `i / fps` seconds, spanning [0, duration]. */
export function renderGif(project: Project, opts: GifOpts = {}): Uint8Array {
  const fps = Math.max(1, Math.min(50, opts.fps ?? Math.min(project.meta.fps, 25)));
  const duration = computeProjectDuration(project);
  const total = duration > 0 ? Math.max(1, Math.round(duration * fps)) : 1;
  const frameCount = opts.maxFrames ? Math.min(total, opts.maxFrames) : total;
  const delay = Math.round(1000 / fps); // ms per frame

  const gif = GIFEncoder();
  for (let i = 0; i < frameCount; i++) {
    const t = i / fps;
    const { width, height, pixels } = renderFrameRgba(project, t, { width: opts.width, background: opts.background });
    const palette = quantize(pixels, 256);
    const index = applyPalette(pixels, palette);
    gif.writeFrame(index, width, height, { palette, delay, repeat: 0 }); // repeat: 0 = loop forever (frame 0 only)
  }
  gif.finish();
  return gif.bytes();
}
