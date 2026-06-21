import {
  buildTransform,
  fmt,
  geometryToSvgAttrs,
  pathBounds,
  pathToD,
  resolveAnchor,
  sampleProject,
} from '../engine';
import type { Project } from '../engine';

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
    if (state.fill !== undefined) item.fill = state.fill;
    if (state.stroke !== undefined) item.stroke = state.stroke;
    return item;
  });
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
  }
}
