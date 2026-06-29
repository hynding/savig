/** A compact, token-cheap textual summary of a Project, for an agent to reason over instead of
 *  parsing raw JSON. Pure; root + symbol assets covered. */
import { computeProjectDuration } from '../engine';
import type { Asset, Project, SceneObject } from '../engine';

function assetKind(project: Project, o: SceneObject): string {
  if (o.isGroup) return 'group';
  const a = project.assets.find((x) => x.id === o.assetId);
  return a ? a.kind : 'unknown';
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function describeObject(project: Project, o: SceneObject): string {
  const kind = assetKind(project, o);
  const tracks = Object.entries(o.tracks)
    .filter(([, kf]) => kf && kf.length > 0)
    .map(([prop, kf]) => `${prop}@[${kf!.map((k) => round(k.time)).join(',')}]`);
  const parts = [`#${o.zOrder} ${o.id} "${o.name}" (${kind})`];
  parts.push(`base x=${round(o.base.x)} y=${round(o.base.y)} s=${round(o.base.scaleX)}×${round(o.base.scaleY)} r=${round(o.base.rotation)}° op=${round(o.base.opacity)}`);
  if (o.parentId) parts.push(`parent=${o.parentId}`);
  if (o.shapeBase) parts.push(`shape ${Object.entries(o.shapeBase).map(([k, v]) => `${k}=${round(v as number)}`).join(' ')}`);
  if (tracks.length) parts.push(`tracks: ${tracks.join(' ')}`);
  if (o.shapeTrack?.length) parts.push(`morph@[${o.shapeTrack.map((k) => round(k.time)).join(',')}]`);
  if (o.motionPath) parts.push('motion-path');
  if (o.symbolTime || o.symbolTimeTrack?.length) parts.push('time-remapped');
  return '  ' + parts.join(' | ');
}

function assetCounts(assets: Asset[]): string {
  const by: Record<string, number> = {};
  for (const a of assets) by[a.kind] = (by[a.kind] ?? 0) + 1;
  return Object.entries(by)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ') || 'none';
}

/** Human/agent-readable one-screen summary: meta, computed duration, assets, and every object
 *  (z-ordered) with its base transform + animated track times. */
export function describeProject(project: Project): string {
  const { meta } = project;
  const duration = computeProjectDuration(project);
  const lines: string[] = [];
  lines.push(`Short "${meta.name}" — ${meta.width}×${meta.height} @ ${meta.fps}fps · duration ${round(duration)}s (${meta.durationMode})${meta.loop ? ' · loop' : ''}`);
  lines.push(`Assets (${project.assets.length}): ${assetCounts(project.assets)}`);
  if (project.audioClips.length) lines.push(`Audio clips: ${project.audioClips.length}`);
  lines.push(`Objects (${project.objects.length}):`);
  for (const o of [...project.objects].sort((a, b) => a.zOrder - b.zOrder)) {
    lines.push(describeObject(project, o));
  }
  return lines.join('\n');
}
