import {
  buildTransform,
  fmt,
  geometryToSvgAttrs,
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
    const { anchorX, anchorY } = resolveAnchor(obj, state, shapeType);
    const item: FrameItem = {
      objectId: state.objectId,
      transform: buildTransform(state, anchorX, anchorY),
      opacity: fmt(state.opacity),
    };
    if (shapeType && state.geometry) {
      item.geometry = geometryToSvgAttrs(shapeType, state.geometry);
    }
    return item;
  });
}
