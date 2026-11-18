import { applyCamera, applyFrameToNodes, computeFrame } from '@savig/runtime/frame';
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
  // Camera view (spec 2026-11-18-camera-tool): the Stage's [data-savig-camera] group, when it is
  // looking through the camera, follows the camera exactly as the exported player does.
  const svg = nodes.values().next().value?.ownerSVGElement;
  if (svg && typeof svg.querySelector === 'function') applyCamera(svg, project, time);
  // M9 interactivity post-pass: no-op outside preview (previewBridge.postApply short-circuits
  // when no session is set), so this costs nothing for the common (non-preview) paint path.
  previewBridge.postApply(nodes, project, time);
}
