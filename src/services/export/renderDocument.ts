import {
  buildTransform,
  fmt,
  gradientToSvg,
  groupTransformPrefix,
  isRenderHidden,
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

  // Only VISIBLE objects keep their svg-asset symbol def — a def referenced solely by
  // hidden objects would be orphaned in <defs> (the <use> body is skipped below).
  const usedSvgIds = Array.from(
    new Set(
      project.objects
        .filter((o) => !o.hidden)
        .map((o) => o.assetId)
        .filter((id) => assetsById.get(id)?.kind === 'svg'),
    ),
  ).sort();
  const defs = usedSvgIds
    .map((assetId) => defineSymbol(assetsById.get(assetId) as SvgAsset))
    .join('');

  const gradientDefs: string[] = [];
  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  const body = sampleProject(project, 0)
    .map((state) => {
      const obj = objectsById.get(state.objectId)!;
      if (isRenderHidden(obj, objectsById)) return ''; // self-hidden OR child of a hidden group (45c)
      // A group container (slice 45) has no element — its transform composes onto its
      // children via `groupPrefix` below. Skip BEFORE the asset lookup (assetId is '').
      if (obj.isGroup) return '';
      const groupPrefix = groupTransformPrefix(project, obj, 0);
      const asset = assetsById.get(obj.assetId);
      if (!asset) {
        throw new MissingAssetError(`Missing asset "${obj.assetId}" referenced by object "${obj.id}".`);
      }
      if (asset.kind === 'vector') {
        // A gradient paint is a <defs> element referenced via fill/stroke="url(#id)".
        // Emit it into the top-level <defs> (the shape stays the <g>'s only child,
        // so the runtime's firstElementChild lookup is unaffected). An animated
        // gradient track's t=0 sample wins over the static asset gradient (export-at-0,
        // like shapeTrack/colorTracks); the runtime then animates the def.
        const fillGrad = state.fillGradient ?? asset.style.fillGradient;
        const strokeGrad = state.strokeGradient ?? asset.style.strokeGradient;
        if (fillGrad) {
          gradientDefs.push(gradientToSvg(`savig-grad-${obj.id}-fill`, fillGrad));
        }
        if (strokeGrad) {
          gradientDefs.push(gradientToSvg(`savig-grad-${obj.id}-stroke`, strokeGrad));
        }
        // For a morphed path, the initial DOM must be frame 0 of the morph (the
        // runtime then animates `d`); fall back to the static base otherwise.
        const framePath = asset.shapeType === 'path' ? state.path ?? asset.path : undefined;
        const pathBox = framePath ? pathBounds(framePath) : undefined;
        const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
        const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
        let shape = renderShapeToSvg(
          asset.shapeType,
          state.geometry ?? {},
          asset.style,
          framePath,
          obj.id,
          { fill: !!fillGrad, stroke: !!strokeGrad },
          state.strokeDashoffset,
        );
        // A morphed path whose frame-0 shape is empty still needs a <path> child so
        // the runtime can animate `d` once later keyframes have nodes (the runtime
        // updates firstElementChild). Static empty paths keep rendering nothing.
        if (!shape && asset.shapeType === 'path' && obj.shapeTrack && obj.shapeTrack.length > 0) {
          shape = '<path d=""/>';
        }
        return `<g data-savig-object="${obj.id}" transform="${transform}" opacity="${fmt(state.opacity)}">${shape}</g>`;
      }
      if (asset.kind !== 'svg') {
        throw new MissingAssetError(`Object "${obj.id}" references non-visual asset "${obj.assetId}".`);
      }
      const { anchorX, anchorY } = resolveAnchor(obj, state, undefined);
      const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
      return `<use data-savig-object="${obj.id}" href="#savig-asset-${obj.assetId}" transform="${transform}" opacity="${fmt(state.opacity)}"/>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}">` +
    `<defs>${defs}${gradientDefs.join('')}</defs>${body}</svg>`
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
