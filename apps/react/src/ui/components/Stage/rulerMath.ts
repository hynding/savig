// Rulers and guides (spec 2026-11-19-rulers-guides): the mapping from root Stage coordinates to
// pixels inside the Stage's drawing area, and the tick marks a ruler shows. Pure.

export interface StageViewMap {
  /** Screen pixels per Stage unit. */
  k: number;
  /** Pixel offset of Stage x = 0 / y = 0 inside the drawing area. */
  ox: number;
  oy: number;
}

/** The Stage <svg> fits the artboard with `viewBox` (xMidYMid meet), then pans and zooms its
 *  content group, so local = offset + scale * (pan + zoom * stage). */
export function stageViewMap(
  size: { w: number; h: number },
  artboard: { width: number; height: number },
  pan: { x: number; y: number },
  zoom: number,
): StageViewMap {
  if (!(size.w > 0 && size.h > 0 && artboard.width > 0 && artboard.height > 0)) return { k: zoom || 1, ox: 0, oy: 0 };
  const s = Math.min(size.w / artboard.width, size.h / artboard.height);
  return {
    k: s * zoom,
    ox: (size.w - artboard.width * s) / 2 + s * pan.x,
    oy: (size.h - artboard.height * s) / 2 + s * pan.y,
  };
}

const NICE = [1, 2, 5];

/** Ticks for a ruler covering pixels [0, length) with `offset` and `k` from the view map. Labelled
 *  major ticks are at least ~60px apart; minor ticks split each major step. */
export function rulerTicks(length: number, offset: number, k: number): { major: { px: number; value: number }[]; minor: number[] } {
  if (!(k > 0) || !(length > 0)) return { major: [], minor: [] };
  let step = 1;
  for (let exp = -2; exp < 8; exp++) {
    const hit = NICE.map((n) => n * 10 ** exp).find((v) => v * k >= 60);
    if (hit !== undefined) {
      step = hit;
      break;
    }
  }
  const sub = step * k >= 100 ? 10 : 5;
  const minorStep = step / sub;
  const from = (0 - offset) / k;
  const to = (length - offset) / k;
  const major: { px: number; value: number }[] = [];
  const minor: number[] = [];
  const first = Math.floor(from / minorStep);
  const last = Math.ceil(to / minorStep);
  for (let i = first; i <= last && minor.length + major.length < 2000; i++) {
    const value = i * minorStep;
    const px = offset + value * k;
    if (i % sub === 0) major.push({ px, value: Math.round(value * 100) / 100 });
    else minor.push(px);
  }
  return { major, minor };
}
