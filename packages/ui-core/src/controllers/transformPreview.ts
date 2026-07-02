// Shared transform-preview descriptor for the object/rotate/scale drag controllers (slice 5,
// group C). These drags paint a live 60fps preview WITHOUT committing: leaf objects that own a
// DOM node get their `transform` attribute written directly; node-less containers (groups,
// symbol instances) are repainted by re-running the frame over their subtree. Neutral controllers
// can't touch the DOM (W5), so instead of doing those writes they classify each dragged object and
// RETURN this descriptor; the app adapter applies it (setAttribute for nodes, its
// previewGroupChildren/previewInstanceChildren closures for containers).
//
// Which branch an object takes is decided by its TYPE — exactly as the original hooks did: a leaf
// has a DOM node, a group/instance does not (`ctx.nodes.get(id)` was undefined for them, so the
// `else if isGroup / else if isInstance` branches ran). `isSymbolInstance` needs the asset list.
import { isSymbolInstance } from '@savig/interaction';
import type { Asset, SceneObject, Transform2D } from '@savig/engine';

/** A leaf object's node to write `transform=` onto (the adapter no-ops if the node isn't mounted). */
export interface NodeTransform {
  id: string;
  transform: string;
}

/** A node-less container to repaint via the adapter's frame-preview closures. */
export interface ContainerPreview {
  kind: 'group' | 'instance';
  objId: string;
  base: Transform2D;
}

/** Classify one dragged object into the right preview bucket, mirroring the originals'
 *  `if (node) setAttribute; else if isGroup previewGroup; else if isInstance previewInstance`.
 *  `transform` is used for the leaf-node branch, `base` for the container branch. */
export function pushPreview(
  obj: SceneObject,
  assets: Asset[],
  id: string,
  transform: string,
  base: Transform2D,
  nodeTransforms: NodeTransform[],
  containerPreviews: ContainerPreview[],
): void {
  if (obj.isGroup) {
    containerPreviews.push({ kind: 'group', objId: id, base });
  } else if (isSymbolInstance(obj, assets)) {
    containerPreviews.push({ kind: 'instance', objId: id, base });
  } else {
    nodeTransforms.push({ id, transform });
  }
}
