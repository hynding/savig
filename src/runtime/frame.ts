import { buildTransform, fmt, sampleProject } from '../engine';
import type { Project } from '../engine';

export interface FrameItem {
  objectId: string;
  transform: string;
  opacity: string;
}

// Single definition of "sampled state -> SVG attributes", shared by the
// editor Stage (Plan 3) and the export runtime. The parity test locks these
// two consumers to identical output, guaranteeing preview == export.
export function computeFrame(project: Project, time: number): FrameItem[] {
  const objectsById = new Map(project.objects.map((o) => [o.id, o] as const));
  return sampleProject(project, time).map((state) => {
    const obj = objectsById.get(state.objectId)!;
    return {
      objectId: state.objectId,
      transform: buildTransform(state, obj.anchorX, obj.anchorY),
      opacity: fmt(state.opacity),
    };
  });
}
