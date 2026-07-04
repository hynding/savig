export const PX_PER_SECOND = 100;
export const timeToX = (time: number): number => time * PX_PER_SECOND;
export const xToTime = (x: number): number => x / PX_PER_SECOND;
export const TRACK_LABEL_WIDTH = 96;

// Frame ticks are only drawn when a single frame is at least this wide on screen;
// below it (e.g. 60fps → 1.67px) the minor ticks would smear into a solid band, so
// the ruler degrades to second-ticks only. 30fps (3.33px) and 24fps (4.17px) pass.
export const MIN_FRAME_TICK_PX = 3;

// Builds the ruler's tick background: a layered repeating-linear-gradient with a bold
// tick every second (always) and a faint tick every frame (only when readable — see
// MIN_FRAME_TICK_PX). Colours are CSS custom properties, so the gradient is theme-aware.
// Anchored at x=0, the ruler's own origin, so ticks line up with the playhead and scrub.
export function frameTickBackground(fps: number): string {
  const second = `repeating-linear-gradient(90deg, var(--color-text-dim) 0 1px, transparent 1px, transparent ${PX_PER_SECOND}px)`;
  const frameWidth = fps > 0 ? PX_PER_SECOND / fps : 0;
  if (frameWidth < MIN_FRAME_TICK_PX) return second; // seconds only (high fps / invalid)
  const frame = `repeating-linear-gradient(90deg, var(--color-border) 0 1px, transparent 1px, transparent ${frameWidth}px)`;
  return `${second}, ${frame}`; // second layer first so majors paint over minors
}
