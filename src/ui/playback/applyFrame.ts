import { applyFrameToNodes, computeFrame } from '../../runtime/frame';
import type { Project } from '../../engine';

// The editor's imperative paint path. Delegates to the SAME computeFrame +
// applyFrameToNodes the standalone runtime uses, so the live preview matches the
// exported bundle byte-for-byte — including animated geometry and fractional anchors.
export function applyFrame(
  nodes: Map<string, SVGGraphicsElement>,
  project: Project,
  time: number,
): void {
  applyFrameToNodes(nodes, computeFrame(project, time));
}
