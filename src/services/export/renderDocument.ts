import { buildTransform, fmt, sampleProject } from '../../engine';
import type { Project, SvgAsset } from '../../engine';
import { MissingAssetError } from '../errors';
import { sanitizeSvgElement } from '../import/sanitizeSvg';

// Each asset is defined once in <defs> and instanced via <use>, so multiple
// instances never duplicate (already-namespaced) internal ids. The <use>
// carries the per-instance transform + opacity and a data id the runtime maps.
export function renderSvgDocument(project: Project): string {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));

  const usedIds = Array.from(new Set(project.objects.map((o) => o.assetId))).sort();
  const defs = usedIds
    .map((assetId) => {
      const asset = assetsById.get(assetId);
      if (!asset || asset.kind !== 'svg') {
        throw new MissingAssetError(`Missing SVG asset "${assetId}" referenced by an object.`);
      }
      return defineSymbol(asset);
    })
    .join('');

  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  const body = sampleProject(project, 0)
    .map((state) => {
      const obj = objectsById.get(state.objectId)!;
      if (!assetsById.has(obj.assetId)) {
        throw new MissingAssetError(`Missing SVG asset "${obj.assetId}" referenced by object "${obj.id}".`);
      }
      const transform = buildTransform(state, obj.anchorX, obj.anchorY);
      return `<use data-savig-object="${obj.id}" href="#savig-asset-${obj.assetId}" transform="${transform}" opacity="${fmt(state.opacity)}"/>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}">` +
    `<defs>${defs}</defs>${body}</svg>`
  );
}

function defineSymbol(asset: SvgAsset): string {
  // Wrap the asset's own root svg in an identified nested <svg> so its
  // intrinsic viewBox is preserved when referenced by <use>.
  const inner = innerMarkup(asset.normalizedContent);
  return (
    `<svg id="savig-asset-${asset.id}" viewBox="${asset.viewBox}" width="${fmt(asset.width)}" height="${fmt(asset.height)}" overflow="visible">` +
    `${inner}</svg>`
  );
}

function innerMarkup(svgMarkup: string): string {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  // Defense-in-depth: a .savig loaded from disk could carry unsanitized
  // normalizedContent, so re-sanitize before inlining into exported HTML.
  sanitizeSvgElement(doc.documentElement);
  return Array.from(doc.documentElement.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join('');
}
