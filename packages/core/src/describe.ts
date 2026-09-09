/** A compact, token-cheap textual summary of a Project, for an agent to reason over instead of
 *  parsing raw JSON. Pure; root + symbol assets covered. */
import { computeProjectDuration, projectScenes } from '@savig/engine';
import type { Asset, Project, SceneObject } from '@savig/engine';

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
  if (o.trim) {
    const tracks = (['start', 'end', 'offset'] as const)
      .map((p) => ({ p, track: o.trim![`${p}Track` as const] }))
      .filter((x) => x.track?.length)
      .map((x) => `${x.p}@[${x.track!.map((k) => round(k.time)).join(',')}]`);
    parts.push(`trim ${round(o.trim.start)}..${round(o.trim.end)}${tracks.length ? ' ' + tracks.join(' ') : ''}`);
  }
  if (o.repeat) {
    const r = o.repeat;
    const bits: string[] = [];
    if (r.dx !== 0 || r.dy !== 0) bits.push(`${round(r.dx)},${round(r.dy)}`);
    if (r.rotate !== 0) bits.push(`${round(r.rotate)}°`);
    if (r.scale !== 1) bits.push(`×${round(r.scale)}`);
    if (r.stagger !== 0) bits.push(`stagger ${round(r.stagger)}s`);
    parts.push(`repeat ×${r.count}${bits.length ? ` (${bits.join(', ')})` : ''}`);
  }
  return '  ' + parts.join(' | ');
}

function assetCounts(assets: Asset[]): string {
  const by: Record<string, number> = {};
  for (const a of assets) by[a.kind] = (by[a.kind] ?? 0) + 1;
  return Object.entries(by)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ') || 'none';
}

/** Interactions block (M9): variable list, then a summary line per object behavior and per global
 *  handler. Cross-scene (behaviors are project-wide, not per-scene) via `projectScenes`, which also
 *  covers the no-`scenes` single-scene case uniformly. Omitted entirely when there is no
 *  `interactions` model — mirrors the audio block's "only when non-empty" convention. */
function describeInteractions(project: Project): string[] {
  const model = project.interactions;
  const variables = model?.variables ?? [];
  const handlers = model?.handlers ?? [];
  // Object `.behaviors` is a SEPARATE field from `project.interactions` (SceneObject, not
  // InteractionModel) — a project can have object behaviors with no `interactions` model at all,
  // so the block's presence is gated on ANY interactivity, not just a truthy model.
  const objectLines: string[] = [];
  for (const scene of projectScenes(project)) {
    for (const o of scene.objects) {
      for (const b of o.behaviors ?? []) {
        objectLines.push(`  - "${o.name}": ${b.event} → ${b.actions.length} action(s)`);
      }
    }
  }
  if (variables.length === 0 && handlers.length === 0 && objectLines.length === 0) return [];
  const lines: string[] = [`Interactions: ${variables.length} variable(s), ${handlers.length} handler(s)`];
  for (const v of variables) lines.push(`  - ${v.name} = ${v.initial}`);
  lines.push(...objectLines);
  for (const b of handlers) {
    const qualifier = b.key ?? b.sceneId;
    lines.push(`  - ${b.event}${qualifier ? `[${qualifier}]` : ''} → ${b.actions.length} action(s)`);
  }
  return lines;
}

/** Human/agent-readable one-screen summary: meta, computed duration, assets, and every object
 *  (z-ordered) with its base transform + animated track times. */
export function describeProject(project: Project): string {
  const { meta } = project;
  const duration = computeProjectDuration(project);
  const lines: string[] = [];
  lines.push(`Short "${meta.name}" — ${meta.width}×${meta.height} @ ${meta.fps}fps · duration ${round(duration)}s (${meta.durationMode})${meta.loop ? ' · loop' : ''}`);
  lines.push(`Assets (${project.assets.length}): ${assetCounts(project.assets)}`);
  if (project.audioClips.length || project.audioTracks?.length) {
    const tracks = project.audioTracks ?? [];
    const trackIds = new Set(tracks.map((t) => t.id));
    const untracked = project.audioClips.filter((c) => !c.trackId || !trackIds.has(c.trackId));
    lines.push(`Audio: ${project.audioClips.length} clip(s), ${tracks.length} track(s)`);
    if (untracked.length) lines.push(`  - [default lane] ${untracked.length} clip(s)`);
    for (const t of tracks) {
      const n = project.audioClips.filter((c) => c.trackId === t.id).length;
      const flags = [t.muted ? 'muted' : '', t.solo ? 'solo' : ''].filter(Boolean).join(' ');
      const fx = [t.pan ? `pan ${t.pan}` : '', t.filter ? `${t.filter.kind}@${t.filter.frequency}Hz` : ''].filter(Boolean).join(' · ');
      lines.push(`  - "${t.name}" ${n} clip(s) · gain ${t.gain}${flags ? ' · ' + flags : ''}${fx ? ' · ' + fx : ''}`);
    }
  }
  lines.push(...describeInteractions(project));
  if (project.scenes) {
    lines.push(`Scenes (${project.scenes.length}):`);
    for (const s of project.scenes) {
      lines.push(`  - "${s.name}" ${s.duration}s, ${s.objects.length} objs`);
    }
  } else {
    lines.push(`Objects (${project.objects.length}):`);
    for (const o of [...project.objects].sort((a, b) => a.zOrder - b.zOrder)) {
      lines.push(describeObject(project, o));
    }
  }
  return lines.join('\n');
}
