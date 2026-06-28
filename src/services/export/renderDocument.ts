import {
  buildTransform,
  flattenInstances,
  fmt,
  gradientToSvg,
  pathBounds,
  renderShapeToSvg,
  resolveAnchor,
  resolveBooleanRings,
  sampleObject,
} from '../../engine';
import type { Project, SvgAsset } from '../../engine';
import { MissingAssetError } from '../errors';
import { sanitizeSvgElement } from '../import/sanitizeSvg';

// SVG assets are defined once in <defs> and instanced via <use>, so multiple
// instances never duplicate (already-namespaced) internal ids. Vector shapes are
// inlined per object (their geometry animates per-frame, so a static def cannot
// capture them); the runtime updates the inner shape's attributes each frame.
export function renderSvgDocument(project: Project, opts?: { viewBox?: string }): string {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));

  // flattenInstances is the single scene-walker (shared with computeFrame, so export == preview):
  // it already excludes hidden objects + group containers and expands symbol instances into
  // composite-id leaves with their composed transform/opacity. Each leaf becomes one body node.
  const leaves = flattenInstances(project, 0);

  // Only VISIBLE, actually-drawn svg-asset leaves keep their symbol def — a def referenced
  // solely by hidden objects (incl. children of a hidden group, 45c) would be orphaned in
  // <defs>. Instanced svg-asset leaves are deduped by asset id.
  const usedSvgIds = Array.from(
    new Set(leaves.map((l) => l.object.assetId).filter((id) => assetsById.get(id)?.kind === 'svg')),
  ).sort();
  const defs = usedSvgIds
    .map((assetId) => defineSymbol(assetsById.get(assetId) as SvgAsset))
    .join('');

  const gradientDefs: string[] = [];
  const body = leaves
    .map((leaf) => {
      const obj = leaf.object;
      const state = sampleObject(obj, leaf.localTime);
      const groupPrefix = leaf.transformPrefix; // composed: ancestor instances + in-scene groups
      const opacity = fmt(state.opacity * leaf.opacityFactor);
      const asset = assetsById.get(obj.assetId);
      if (!asset) {
        throw new MissingAssetError(`Missing asset "${obj.assetId}" referenced by object "${obj.id}".`);
      }
      if (asset.kind === 'vector') {
        // A gradient paint is a <defs> element referenced via fill/stroke="url(#id)".
        // Emit it into the top-level <defs> (the shape stays the <g>'s only child,
        // so the runtime's firstElementChild lookup is unaffected). An animated
        // gradient track's t=0 sample wins over the static asset gradient (export-at-0,
        // like shapeTrack/colorTracks); the runtime then animates the def. Ids are keyed
        // by renderId so two instances of one symbol never collide.
        const fillGrad = state.fillGradient ?? asset.style.fillGradient;
        const strokeGrad = state.strokeGradient ?? asset.style.strokeGradient;
        if (fillGrad) {
          gradientDefs.push(gradientToSvg(`savig-grad-${leaf.renderId}-fill`, fillGrad));
        }
        if (strokeGrad) {
          gradientDefs.push(gradientToSvg(`savig-grad-${leaf.renderId}-stroke`, strokeGrad));
        }
        // For a morphed path, the initial DOM must be frame 0 of the morph (the runtime then
        // animates `d`); a LIVE boolean is the time-0 clip of its operands; else the static base.
        const boolRings = obj.boolean ? resolveBooleanRings(project, obj, 0) : null;
        const framePath = obj.boolean
          ? boolRings![0]
          : asset.shapeType === 'path' ? state.path ?? asset.path : undefined;
        const pathBox = framePath ? pathBounds(framePath) : undefined;
        const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
        const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
        let shape = renderShapeToSvg(
          asset.shapeType,
          state.geometry ?? {},
          asset.style,
          framePath,
          leaf.renderId,
          { fill: !!fillGrad, stroke: !!strokeGrad },
          state.strokeDashoffset,
          obj.boolean ? boolRings!.slice(1) : asset.shapeType === 'path' ? asset.compoundRings : undefined,
          !!obj.boolean, // forceEvenOdd: a boolean's path always carries evenodd (holes may appear mid-animation)
        );
        // A boolean (or morphed) path whose initial shape is empty still needs a <path> child so
        // the runtime can animate `d` once the clip is non-empty (the runtime updates
        // firstElementChild). Static empty paths keep rendering nothing.
        if (!shape && asset.shapeType === 'path' && (obj.boolean || (obj.shapeTrack && obj.shapeTrack.length > 0))) {
          shape = obj.boolean ? '<path fill-rule="evenodd" d=""/>' : '<path d=""/>';
        }
        return `<g data-savig-object="${leaf.renderId}" transform="${transform}" opacity="${opacity}">${shape}</g>`;
      }
      if (asset.kind !== 'svg') {
        throw new MissingAssetError(`Object "${obj.id}" references non-visual asset "${obj.assetId}".`);
      }
      const { anchorX, anchorY } = resolveAnchor(obj, state, undefined);
      const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
      return `<use data-savig-object="${leaf.renderId}" href="#savig-asset-${obj.assetId}" transform="${transform}" opacity="${opacity}"/>`;
    })
    .join('');

  const viewBox = opts?.viewBox ?? `0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
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
