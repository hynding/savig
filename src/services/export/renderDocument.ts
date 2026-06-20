import {
  buildTransform,
  fmt,
  pathBounds,
  renderShapeToSvg,
  resolveAnchor,
  sampleProject,
} from '../../engine';
import type { Project, SvgAsset } from '../../engine';
import { MissingAssetError } from '../errors';
import { sanitizeSvgElement } from '../import/sanitizeSvg';

// SVG assets are defined once in <defs> and instanced via <use>, so multiple
// instances never duplicate (already-namespaced) internal ids. Vector shapes are
// inlined per object (their geometry animates per-frame, so a static def cannot
// capture them); the runtime updates the inner shape's attributes each frame.
export function renderSvgDocument(project: Project): string {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));

  const usedSvgIds = Array.from(
    new Set(project.objects.map((o) => o.assetId).filter((id) => assetsById.get(id)?.kind === 'svg')),
  ).sort();
  const defs = usedSvgIds
    .map((assetId) => defineSymbol(assetsById.get(assetId) as SvgAsset))
    .join('');

  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  const body = sampleProject(project, 0)
    .map((state) => {
      const obj = objectsById.get(state.objectId)!;
      const asset = assetsById.get(obj.assetId);
      if (!asset) {
        throw new MissingAssetError(`Missing asset "${obj.assetId}" referenced by object "${obj.id}".`);
      }
      if (asset.kind === 'vector') {
        const pathBox = asset.shapeType === 'path' && asset.path ? pathBounds(asset.path) : undefined;
        const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
        const transform = buildTransform(state, anchorX, anchorY);
        const shape = renderShapeToSvg(asset.shapeType, state.geometry ?? {}, asset.style, asset.path);
        return `<g data-savig-object="${obj.id}" transform="${transform}" opacity="${fmt(state.opacity)}">${shape}</g>`;
      }
      if (asset.kind !== 'svg') {
        throw new MissingAssetError(`Object "${obj.id}" references non-visual asset "${obj.assetId}".`);
      }
      const { anchorX, anchorY } = resolveAnchor(obj, state, undefined);
      const transform = buildTransform(state, anchorX, anchorY);
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
