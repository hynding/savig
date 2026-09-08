import { applyFrameToNodes, computeFrame } from '@savig/runtime/frame';
import type { Project } from '@savig/engine';
import { previewBridge } from '../preview/previewBridge';

// The editor's imperative paint path. Delegates to the SAME computeFrame +
// applyFrameToNodes the standalone runtime uses, so the live preview matches the
// exported bundle byte-for-byte — including animated geometry and fractional anchors.
export function applyFrame(
  nodes: Map<string, SVGGraphicsElement>,
  project: Project,
  time: number,
): void {
  applyFrameToNodes(nodes, computeFrame(project, time));
  // M9 interactivity post-pass: no-op outside preview (previewBridge.postApply short-circuits
  // when no session is set), so this costs nothing for the common (non-preview) paint path.
  previewBridge.postApply(nodes, project, time);
}
