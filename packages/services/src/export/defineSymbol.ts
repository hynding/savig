import { fmt, escapeAttr } from '@savig/engine';
import type { BoxAsset } from '@savig/engine';
import { isSafeImageDataUrl } from '../persistence/sanitizeImages';
import { sanitizeSvgElement } from '../import/sanitizeSvg';

/** The ONE symbol-wrapping convention shared by the editor Stage's `<defs>` (buildDefs) and the
 *  HTML exporter (renderDocument): the asset's root svg is re-wrapped in an identified nested
 *  `<svg>` so its intrinsic viewBox survives `<use>` referencing. Extracting it here closes the
 *  long-standing "two mirrored defineSymbol copies" dup — any change lands on both surfaces. */
export function defineSymbol(asset: BoxAsset): string {
  if (asset.kind === 'image') {
    // Bitmap (spec 2026-11-15-bitmap-import): the same identified nested <svg> wrapper around one
    // <image> stretched to the asset box, so the body's <use> path is shared with SVG assets.
    // Defense-in-depth: an unsafe href (hand-edited file that skipped the load sanitizer) renders
    // an empty box rather than reaching the DOM.
    const href = isSafeImageDataUrl(asset.dataUrl) ? asset.dataUrl : '';
    return (
      `<svg id="savig-asset-${escapeAttr(asset.id)}" viewBox="0 0 ${fmt(asset.width)} ${fmt(asset.height)}" width="${fmt(asset.width)}" height="${fmt(asset.height)}" overflow="visible">` +
      (href ? `<image href="${escapeAttr(href)}" x="0" y="0" width="${fmt(asset.width)}" height="${fmt(asset.height)}" preserveAspectRatio="none"/>` : '') +
      `</svg>`
    );
  }
  return (
    `<svg id="savig-asset-${escapeAttr(asset.id)}" viewBox="${escapeAttr(asset.viewBox)}" width="${fmt(asset.width)}" height="${fmt(asset.height)}" overflow="visible">` +
    `${innerMarkup(asset.normalizedContent)}</svg>`
  );
}

function innerMarkup(svgMarkup: string): string {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  // Defense-in-depth: a .savig loaded from disk could carry unsanitized normalizedContent, so
  // re-sanitize before inlining — into the live editor DOM (dangerouslySetInnerHTML) and into
  // exported HTML alike.
  sanitizeSvgElement(doc.documentElement);
  return Array.from(doc.documentElement.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join('');
}
