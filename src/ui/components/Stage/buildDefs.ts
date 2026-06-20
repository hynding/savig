import { fmt } from '../../../engine';
import type { Asset, SvgAsset } from '../../../engine';
import { sanitizeSvgElement } from '../../../services';

// Mirrors services/export/renderDocument.defineSymbol so the editor stage and
// the exported bundle share one symbol-wrapping convention.
function innerMarkup(svgMarkup: string): string {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  // Defense-in-depth: a .savig loaded from disk could carry unsanitized
  // normalizedContent, so re-sanitize before inlining into the live editor DOM
  // (which uses dangerouslySetInnerHTML) — same guard as the HTML exporter.
  sanitizeSvgElement(doc.documentElement);
  return Array.from(doc.documentElement.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join('');
}

function defineSymbol(asset: SvgAsset): string {
  return (
    `<svg id="savig-asset-${asset.id}" viewBox="${asset.viewBox}" width="${fmt(asset.width)}" height="${fmt(asset.height)}" overflow="visible">` +
    `${innerMarkup(asset.normalizedContent)}</svg>`
  );
}

export function buildDefs(assets: Asset[], usedIds: string[]): string {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  return usedIds
    .map((id) => byId.get(id))
    .filter((a): a is SvgAsset => !!a && a.kind === 'svg')
    .map(defineSymbol)
    .join('');
}
