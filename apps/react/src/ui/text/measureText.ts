import type { LocalRect } from '@savig/engine';
import type { TextMeasureInput } from '@savig/interaction';

// Real glyph metrics for editor-chrome text bboxes (selection outline, marquee, snap, align).
// A single hidden <svg><text> is kept off-screen and re-styled per query; getBBox returns the
// ink box in the element's OWN local units — exactly the LocalRect resolveObjectAnchor wants
// (the Stage renders text at x=0 y=0 with dominant-baseline text-before-edge, mirrored here).
// Results are LRU-cached; the cache clears once webfonts finish loading (metrics can shift).
const MEASURE_CACHE_MAX = 256;
const cache = new Map<string, LocalRect | null>();

let host: SVGSVGElement | null = null;
let textEl: SVGTextElement | null = null;

function ensureHost(): SVGTextElement {
  if (textEl && host && host.isConnected) return textEl;
  const NS = 'http://www.w3.org/2000/svg';
  host = document.createElementNS(NS, 'svg');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'absolute';
  host.style.width = '0';
  host.style.height = '0';
  host.style.overflow = 'hidden';
  host.style.visibility = 'hidden';
  textEl = document.createElementNS(NS, 'text');
  textEl.setAttribute('x', '0');
  textEl.setAttribute('y', '0');
  textEl.setAttribute('dominant-baseline', 'text-before-edge');
  host.appendChild(textEl);
  document.body.appendChild(host);
  return textEl;
}

// Webfont arrival changes glyph metrics — drop memoized boxes once fonts settle.
let fontsHooked = false;
function hookFontReady(): void {
  if (fontsHooked) return;
  fontsHooked = true;
  (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(() => cache.clear());
}

/** App-layer `TextMeasurer` for `setTextMeasurer`. Null (→ estimate fallback) whenever real
 *  measurement is unavailable: no getBBox (jsdom), a degenerate all-zero box, or any throw. */
export function domTextMeasurer(t: TextMeasureInput): LocalRect | null {
  const key = `${t.fontSize}|${t.fontFamily ?? ''}|${t.textAnchor ?? 'start'}|${t.content}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit); // refresh recency
    return hit;
  }
  let rect: LocalRect | null = null;
  try {
    hookFontReady();
    const el = ensureHost();
    el.setAttribute('font-size', String(t.fontSize));
    if (t.fontFamily) el.setAttribute('font-family', t.fontFamily);
    else el.removeAttribute('font-family');
    el.setAttribute('text-anchor', t.textAnchor ?? 'start');
    el.textContent = t.content;
    const b = (el as { getBBox?: () => { x: number; y: number; width: number; height: number } }).getBBox?.();
    if (b && Number.isFinite(b.width) && Number.isFinite(b.height) && (b.width > 0 || t.content.trim() === '')) {
      rect = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
  } catch {
    rect = null;
  }
  cache.set(key, rect);
  if (cache.size > MEASURE_CACHE_MAX) cache.delete(cache.keys().next().value!);
  return rect;
}
