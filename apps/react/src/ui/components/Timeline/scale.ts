import { createContext, useContext } from 'react';

/** Base scale at 100% timeline zoom. */
export const PX_PER_SECOND = 100;
export const TRACK_LABEL_WIDTH = 96;

// Frame ticks are only drawn when a single frame is at least this wide on screen;
// below it (e.g. 60fps at 100% → 1.67px) the minor ticks would smear into a solid band, so
// the ruler degrades to second-ticks only. 30fps (3.33px) and 24fps (4.17px) pass at 100%.
export const MIN_FRAME_TICK_PX = 3;

// Ruler labels stay at least this far apart; when whole seconds get closer (zoomed out), the
// ruler labels every 2nd / 5th / 10th … second instead.
export const MIN_LABEL_GAP_PX = 40;
const LABEL_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];

// Frame numbers appear on the ruler once a frame cell is this wide (zoomed in far enough that
// frame-by-frame work happens cell by cell).
export const MIN_FRAME_LABEL_PX = 18;

// Builds the ruler's tick background: a layered repeating-linear-gradient with a bold
// tick every second (always) and a faint tick every frame (only when readable — see
// MIN_FRAME_TICK_PX). Colours are CSS custom properties, so the gradient is theme-aware.
// Anchored at x=0, the ruler's own origin, so ticks line up with the playhead and scrub.
export function frameTickBackground(fps: number, pxPerSecond: number = PX_PER_SECOND): string {
  const second = `repeating-linear-gradient(90deg, var(--color-text-dim) 0 1px, transparent 1px, transparent ${pxPerSecond}px)`;
  const frameWidth = fps > 0 ? pxPerSecond / fps : 0;
  if (frameWidth < MIN_FRAME_TICK_PX) return second; // seconds only (high fps / invalid)
  const frame = `repeating-linear-gradient(90deg, var(--color-border) 0 1px, transparent 1px, transparent ${frameWidth}px)`;
  return `${second}, ${frame}`; // second layer first so majors paint over minors
}

/** Seconds between ruler labels at this scale (1 unless zoomed out). */
export function rulerLabelStep(pxPerSecond: number): number {
  return LABEL_STEPS.find((s) => s * pxPerSecond >= MIN_LABEL_GAP_PX) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
}

/** The time↔pixel mapping at one zoom level. Every timeline surface (ruler, rows, frame strips,
 *  audio lanes, playhead) reads the same instance from TimelineScaleContext, so they stay aligned. */
export interface TimelineScale {
  zoom: number;
  pxPerSecond: number;
  timeToX(time: number): number;
  xToTime(x: number): number;
  frameTickBackground(fps: number): string;
}

export function makeTimelineScale(zoom = 1): TimelineScale {
  const pxPerSecond = PX_PER_SECOND * zoom;
  return {
    zoom,
    pxPerSecond,
    timeToX: (time) => time * pxPerSecond,
    xToTime: (x) => x / pxPerSecond,
    frameTickBackground: (fps) => frameTickBackground(fps, pxPerSecond),
  };
}

const DEFAULT_SCALE = makeTimelineScale(1);

// 100% mappings, kept for callers outside a Timeline (and the tests' pixel math).
export const timeToX = DEFAULT_SCALE.timeToX;
export const xToTime = DEFAULT_SCALE.xToTime;

export const TimelineScaleContext = createContext<TimelineScale>(DEFAULT_SCALE);
export const useTimelineScale = (): TimelineScale => useContext(TimelineScaleContext);
