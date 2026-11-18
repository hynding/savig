// Variable-width strokes (spec 2026-11-18-variable-width, slice 2): put a width profile on a
// drawing. Shared by the editor store and @savig/core so both refuse and convert the same way.
import { GEOMETRY_PROPERTIES } from '../project';
import { isLockedInTree } from '../groupTransform';
import { resolveAnchor, sampleObject } from '../sample';
import { normalizeWidthProfile } from './widthStroke';
import { warpSource } from './warp';
import type { Asset, SceneObject, VectorAsset, VectorStyle, WidthStop } from '../types';

export type WidthRefusal = 'not-a-drawing' | 'locked' | 'live-boolean' | 'no-stroke' | 'animated-shape';

function withoutProfile({ widthProfile: _widthProfile, ...rest }: VectorStyle): VectorStyle {
  return rest;
}

/** Set (or with an empty / uniform profile, clear) object `objectId`'s width profile. A path just
 *  takes it on its asset style. A rect or ellipse becomes a path first (its outline at `time`, the
 *  pivot pinned absolute so nothing moves, a shared asset copied), since only paths draw a
 *  profile; one with an animated size is refused. Clearing never converts. */
export function applyWidthProfile(
  objects: SceneObject[],
  assets: Asset[],
  objectId: string,
  profile: readonly WidthStop[] | null,
  time: number,
): { objects: SceneObject[]; assets: Asset[] } | { refused: WidthRefusal } {
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const obj = byId.get(objectId);
  const asset = obj ? assets.find((a) => a.id === obj.assetId) : undefined;
  if (!obj || obj.isGroup || asset?.kind !== 'vector') return { refused: 'not-a-drawing' };
  if (isLockedInTree(obj, byId)) return { refused: 'locked' };
  if (obj.boolean) return { refused: 'live-boolean' };
  const next = normalizeWidthProfile(profile ?? []);
  if (!next) {
    if (!asset.style.widthProfile) return { objects, assets };
    const cleared: VectorAsset = { ...asset, style: withoutProfile(asset.style) };
    return { objects, assets: assets.map((a) => (a.id === asset.id ? cleared : a)) };
  }
  if (asset.style.stroke === 'none' || asset.style.strokeWidth <= 0) return { refused: 'no-stroke' };
  const style: VectorStyle = { ...asset.style, widthProfile: next };
  if (asset.shapeType === 'path') {
    return { objects, assets: assets.map((a) => (a.id === asset.id ? { ...asset, style } : a)) };
  }
  if (GEOMETRY_PROPERTIES.some((k) => obj.tracks[k]?.length)) return { refused: 'animated-shape' };
  const src = warpSource(obj, asset, time);
  const state = sampleObject(obj, time, asset.primitive);
  const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType);
  const shared = objects.some((o) => o.id !== obj.id && o.assetId === asset.id);
  const assetId = shared ? `${asset.id}-${obj.id}` : asset.id;
  const { primitive: _p, compoundRings: _r, ...rest } = asset;
  void _p;
  void _r;
  const nextAsset: VectorAsset = { ...rest, id: assetId, shapeType: 'path', path: src.path, style };
  const tracks = { ...obj.tracks };
  for (const k of GEOMETRY_PROPERTIES) delete tracks[k];
  const nextObj: SceneObject = { ...obj, assetId, tracks, anchorMode: 'absolute', anchorX, anchorY };
  delete nextObj.shapeBase;
  return {
    objects: objects.map((o) => (o.id === obj.id ? nextObj : o)),
    assets: shared ? [...assets, nextAsset] : assets.map((a) => (a.id === asset.id ? nextAsset : a)),
  };
}
