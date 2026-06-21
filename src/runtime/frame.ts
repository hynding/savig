import {
  buildTransform,
  fmt,
  geometryToSvgAttrs,
  gradientAttrs,
  gradientStopAttrs,
  pathBounds,
  pathToD,
  resolveAnchor,
  sampleProject,
} from '../engine';
import type { Gradient, Project } from '../engine';

export interface FrameItem {
  objectId: string;
  transform: string;
  opacity: string;
  /** Present only for vector objects: SVG attribute name -> value for the inner shape. */
  geometry?: Record<string, string>;
  /** Present only for MORPHED path objects: the inner <path>'s `d` for this frame. */
  pathD?: string;
  /** Present only for vector objects with an animated fill/stroke color track. */
  fill?: string;
  stroke?: string;
  /** Present only for vector objects with an animated fill/stroke gradient track. */
  fillGradient?: Gradient;
  strokeGradient?: Gradient;
}

// Single definition of "sampled state -> SVG attributes", shared by the editor
// Stage and the export runtime. The parity test locks these consumers to identical
// output, guaranteeing preview == export — now including animated geometry.
export function computeFrame(project: Project, time: number): FrameItem[] {
  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));
  return sampleProject(project, time).map((state) => {
    const obj = objectsById.get(state.objectId)!;
    const asset = assetsById.get(obj.assetId);
    const shapeType = asset && asset.kind === 'vector' ? asset.shapeType : undefined;
    const pathBox =
      asset && asset.kind === 'vector' && asset.shapeType === 'path'
        ? pathBounds(state.path ?? asset.path ?? { nodes: [], closed: false })
        : undefined;
    const { anchorX, anchorY } = resolveAnchor(obj, state, shapeType, pathBox);
    const item: FrameItem = {
      objectId: state.objectId,
      transform: buildTransform(state, anchorX, anchorY),
      opacity: fmt(state.opacity),
    };
    if (shapeType && shapeType !== 'path' && state.geometry) {
      item.geometry = geometryToSvgAttrs(shapeType, state.geometry);
    }
    if (state.path) {
      item.pathD = pathToD(state.path);
    }
    // A gradient paint (baked into the initial markup as url(#…)) wins over a
    // color track: emitting a per-frame hex here would clobber the gradient ref
    // via applyFrameToNodes.
    const hasFillGradient =
      (asset?.kind === 'vector' && !!asset.style.fillGradient) || state.fillGradient !== undefined;
    const hasStrokeGradient =
      (asset?.kind === 'vector' && !!asset.style.strokeGradient) || state.strokeGradient !== undefined;
    if (state.fill !== undefined && !hasFillGradient) item.fill = state.fill;
    if (state.stroke !== undefined && !hasStrokeGradient) item.stroke = state.stroke;
    if (state.fillGradient !== undefined) item.fillGradient = state.fillGradient;
    if (state.strokeGradient !== undefined) item.strokeGradient = state.strokeGradient;
    return item;
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Mutate a gradient <defs> element in place: imperative coordinate attrs + fully
// rebuilt <stop> children (robust to stop-count changes across keyframes). Stops
// are built via createElementNS (NOT innerHTML — SVG-namespaced innerHTML is
// unreliable in jsdom) and share gradientStopAttrs with the string emitter, so
// runtime == export == Stage by construction.
function applyGradientToElement(node: Element, id: string, g: Gradient): void {
  const owner = (node as SVGElement).ownerSVGElement;
  const root = owner ?? (node.getRootNode() as Document | null);
  const def = root && 'querySelector' in root ? root.querySelector(`#${CSS.escape(id)}`) : null;
  if (!def) return; // defensive: never throw mid-frame if the def is missing
  for (const [attr, value] of Object.entries(gradientAttrs(g))) {
    def.setAttribute(attr, value);
  }
  while (def.firstChild) def.removeChild(def.firstChild);
  const doc = def.ownerDocument;
  for (const s of g.stops) {
    const stop = doc.createElementNS(SVG_NS, 'stop');
    for (const [attr, value] of Object.entries(gradientStopAttrs(s))) {
      stop.setAttribute(attr, value);
    }
    def.appendChild(stop);
  }
}

// Applies a computed frame to live SVG nodes. Wrapper nodes
// (`[data-savig-object]`) take transform/opacity; vector objects also update the
// inner shape element (the wrapper's only child) with the geometry attributes.
// Shared by the standalone runtime player AND the editor's imperative painter.
export function applyFrameToNodes(nodes: Map<string, Element>, items: FrameItem[]): void {
  for (const item of items) {
    const node = nodes.get(item.objectId);
    if (!node) continue;
    node.setAttribute('transform', item.transform);
    node.setAttribute('opacity', item.opacity);
    if (item.geometry) {
      const shape = node.firstElementChild;
      if (shape) {
        for (const [attr, value] of Object.entries(item.geometry)) {
          shape.setAttribute(attr, value);
        }
      }
    }
    if (item.pathD !== undefined) {
      const shape = node.firstElementChild;
      if (shape) shape.setAttribute('d', item.pathD);
    }
    if (item.fill !== undefined || item.stroke !== undefined) {
      const shape = node.firstElementChild;
      if (shape) {
        if (item.fill !== undefined) shape.setAttribute('fill', item.fill);
        if (item.stroke !== undefined) shape.setAttribute('stroke', item.stroke);
      }
    }
    if (item.fillGradient) applyGradientToElement(node, `savig-grad-${item.objectId}-fill`, item.fillGradient);
    if (item.strokeGradient) applyGradientToElement(node, `savig-grad-${item.objectId}-stroke`, item.strokeGradient);
  }
}
