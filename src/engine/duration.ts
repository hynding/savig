import type { Asset, Project, SceneObject, SymbolAsset } from './types';
import { computeProjectDurationMulti } from './scenes';

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

/** Returns true iff the SymbolAsset's content is fully static (no animation of any kind).
 *  A symbol is static when its effective animated duration is 0 AND every nested symbol
 *  instance inside it is also static. Cycle-guarded with a visited Set (mirrors symbolContains).
 *
 *  Note: we check nested assets but NOT per-instance symbolTime/symbolTimeTrack on nested
 *  SceneObject instances inside the symbol. This is safe because `remapLocalTime` returns 0
 *  immediately when symbolDuration <= 0 (zero-duration symbol stays at frame 0 regardless of
 *  any remap), so a symbolTime override on a nested instance of a zero-duration symbol has no
 *  visual effect. The optimization is therefore correct-by-invariant. */
export function isStaticSymbol(asset: SymbolAsset, assetsById: Map<string, Asset>, visited = new Set<string>()): boolean {
  if (visited.has(asset.id)) return true; // cycle: treat as static to avoid infinite loop
  if (symbolEffectiveDuration(asset) > 0) return false; // content has animation
  const next = new Set(visited);
  next.add(asset.id);
  // Check each nested symbol instance inside this symbol's own objects
  for (const obj of asset.objects) {
    if (!obj.isGroup && !obj.hidden) {
      const child = assetsById.get(obj.assetId);
      if (child && child.kind === 'symbol') {
        if (!isStaticSymbol(child, assetsById, next)) return false;
      }
    }
  }
  return true;
}

/** Returns true iff the SceneObject instance carries NO per-instance overrides that would
 *  make it differ visually from a pure static snapshot.
 *
 *  Conservative exclusions (v1):
 *  - Any `symbolTimeTrack` (even empty arrays are fine; non-empty = animated remap)
 *  - Any `symbolTime` field (could produce a remap even on a static symbol; excluded for clarity)
 *  - Any `tint` override (v1 deferral: tinted+`<use>` composition not yet supported)
 *  - `freezeFirstFrame` = true (excluded conservatively; no-op on static but avoids reasoning)
 */
export function isStaticInstance(instance: SceneObject): boolean {
  if (instance.symbolTimeTrack && instance.symbolTimeTrack.length > 0) return false;
  if (instance.symbolTime) return false;
  if (instance.tint) return false;
  if (instance.freezeFirstFrame) return false;
  return true;
}

export function computeProjectDuration(project: Project): number {
  if (project.scenes) return computeProjectDurationMulti(project);
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
