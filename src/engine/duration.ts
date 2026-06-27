import type { Asset, Project, SceneObject, SymbolAsset } from './types';

/** The latest keyframe time across an objects[] list (transform/shape/color/gradient/dash/motion).
 *  Shared by computeProjectDuration (root) and the symbol intrinsic-duration lookup (slice 47c). */
export function objectsMaxKeyframeTime(objects: SceneObject[]): number {
  let max = 0;
  for (const obj of objects) {
    for (const track of Object.values(obj.tracks)) {
      if (!track) continue;
      for (const keyframe of track) if (keyframe.time > max) max = keyframe.time;
    }
    for (const keyframe of obj.shapeTrack ?? []) if (keyframe.time > max) max = keyframe.time;
    for (const track of Object.values(obj.colorTracks ?? {})) {
      for (const keyframe of track ?? []) if (keyframe.time > max) max = keyframe.time;
    }
    for (const track of Object.values(obj.gradientTracks ?? {})) {
      for (const keyframe of track ?? []) if (keyframe.time > max) max = keyframe.time;
    }
    for (const keyframe of obj.dashOffsetTrack ?? []) if (keyframe.time > max) max = keyframe.time;
    for (const keyframe of obj.motionPath?.progress ?? []) if (keyframe.time > max) max = keyframe.time;
  }
  return max;
}

/** A symbol's effective timeline length: the manual `duration` override when set (> 0), else the
 *  intrinsic length from its objects' keyframes. Read by flattenInstances' time remap (so the override
 *  flows to preview AND export) and by computeProjectDuration. (47c) */
export function symbolEffectiveDuration(asset: SymbolAsset): number {
  return asset.duration > 0 ? asset.duration : objectsMaxKeyframeTime(asset.objects);
}

/** Parent-timeline end of a symbol instance's INTERNAL animation (47c): startOffset + the active
 *  internal length (one-shot once; loop+playCount N cycles; infinite loop one cycle) / speed. 0 for a
 *  non-instance or a 0-length (static) symbol. v1: does NOT recurse into a symbol's own nested
 *  instances (matches the renderer's effective duration, keeping timeline and render consistent). */
export function instanceTimelineEnd(obj: SceneObject, assetsById: Map<string, Asset>): number {
  const asset = assetsById.get(obj.assetId);
  if (!asset || asset.kind !== 'symbol') return 0;
  // A keyframed time-remap (47c) authors the instance's parent-timeline extent directly: the
  // curve's last keyframe time. Supersedes the constant-remap math below (tracks are sorted asc).
  if (obj.symbolTimeTrack && obj.symbolTimeTrack.length > 0) {
    return obj.symbolTimeTrack[obj.symbolTimeTrack.length - 1].time;
  }
  const internal = symbolEffectiveDuration(asset);
  if (internal <= 0) return 0;
  const t = obj.symbolTime;
  const speed = t && t.speed > 0 ? t.speed : 1;
  const startOffset = t?.startOffset ?? 0;
  const cycle = t?.pingPong ? 2 * internal : internal;
  const active = !t?.loop ? internal : t.playCount && t.playCount > 0 ? t.playCount * cycle : cycle;
  return startOffset + active / speed;
}

export function computeProjectDuration(project: Project): number {
  if (project.meta.durationMode === 'manual') {
    return project.meta.duration;
  }
  let max = objectsMaxKeyframeTime(project.objects);
  // A symbol instance's INTERNAL animation extends the timeline too (47c): fold each instance's
  // parent-timeline end. Grouped instances carry parentId but are still in project.objects.
  const byId = new Map(project.assets.map((a) => [a.id, a] as const));
  for (const obj of project.objects) {
    const end = instanceTimelineEnd(obj, byId);
    if (end > max) max = end;
  }
  for (const clip of project.audioClips) {
    const end = clip.startTime + (clip.outPoint - clip.inPoint);
    if (end > max) max = end;
  }
  return max;
}
