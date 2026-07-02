import type { Project, SceneObject, Transform2D } from '@savig/engine';
import type { ContainerPreview, NodeTransform } from '@savig/ui-core';
import { selectEditProject } from '../../store/selectors';
import { useEditor } from '../../store/store';

/** The Stage-owned imperative-preview closures the transform-drag controllers' descriptors are
 *  applied through — the DOM part the neutral controllers can't do (W5). */
export interface PreviewClosures {
  nodes: Map<string, SVGGraphicsElement>;
  previewGroupChildren: (proj: Project, group: SceneObject, time: number, base: Transform2D) => void;
  previewInstanceChildren: (proj: Project, instance: SceneObject, time: number, base: Transform2D) => void;
}

/** Apply an object/rotate/scale controller's transform-preview descriptor to the DOM: write each
 *  leaf node's transform (no-op if it isn't mounted), and repaint each node-less container's
 *  subtree via the Stage's frame-preview closures. Resolves the project/time once, fresh — the
 *  same read the controller used to compute the descriptor this synchronous move. */
export function applyTransformPreview(
  nodeTransforms: NodeTransform[],
  containerPreviews: ContainerPreview[],
  ctx: PreviewClosures,
): void {
  for (const nt of nodeTransforms) ctx.nodes.get(nt.id)?.setAttribute('transform', nt.transform);
  if (containerPreviews.length) {
    const proj = selectEditProject(useEditor.getState());
    const time = useEditor.getState().time;
    for (const cp of containerPreviews) {
      const obj = proj.objects.find((o) => o.id === cp.objId);
      if (!obj) continue;
      if (cp.kind === 'group') ctx.previewGroupChildren(proj, obj, time, cp.base);
      else ctx.previewInstanceChildren(proj, obj, time, cp.base);
    }
  }
}
