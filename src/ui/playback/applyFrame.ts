import { buildTransform, fmt, sampleProject } from '../../engine';
import type { Project } from '../../engine';

// The editor's imperative 60fps write path. Uses the same engine functions
// (sampleProject + buildTransform + fmt) as the exporter and standalone
// runtime, so the live preview matches the exported bundle byte-for-byte.
export function applyFrame(
  nodes: Map<string, SVGGraphicsElement>,
  project: Project,
  time: number,
): void {
  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  for (const state of sampleProject(project, time)) {
    const node = nodes.get(state.objectId);
    const obj = objectsById.get(state.objectId);
    if (!node || !obj) continue;
    node.setAttribute('transform', buildTransform(state, obj.anchorX, obj.anchorY));
    node.setAttribute('opacity', fmt(state.opacity));
  }
}
