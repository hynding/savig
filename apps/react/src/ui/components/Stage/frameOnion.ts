// Frame-by-frame onion skin (spec 2026-11-07 §Onion skin, slice 4). When a frame layer is the
// target, the ghosts are the WHOLE drawings of the neighbouring keys — each sampled at its own
// key's start time — instead of one object's interpolated poses. Pure: Project in, ghost shape
// descriptors out; Stage.tsx only maps them to tinted SVG. Editor-only chrome, never exported.
import { flattenInstances, frameOnionKeys, geometryToSvgAttrs, isInFrameKey, pathToDRings, sampleObject } from '@savig/engine';
import type { Project, SceneObject } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';

export interface FrameGhostShape {
  /** Render id of the drawn leaf (stable React key within its ghost). */
  id: string;
  /** Full world transform of the leaf at the ghost's time (instance + group prefix + own). */
  transform: string;
  tag: 'path' | 'rect' | 'ellipse';
  /** Geometry attributes: `d` (+ `fillRule`) for a path, x/y/width/height/rx/… otherwise. */
  attrs: Record<string, string>;
}

export interface FrameGhost {
  keyId: string;
  /** The key's start time — the instant the ghost is drawn at. */
  time: number;
  side: 'before' | 'after';
  /** 0 = the nearest key on its side. Drives the falling opacity. */
  rank: number;
  shapes: FrameGhostShape[];
}

/** Repeater copies carry "@n" and instance leaves "inst/…": the scene object that owns a leaf. */
const sceneObjectId = (renderId: string): string => renderId.split('/')[0].replace(/@\d+$/, '');

export function frameOnionGhosts(project: Project, layer: SceneObject, time: number, count: number): FrameGhost[] {
  if (!layer.isGroup || !layer.frames) return [];
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));
  const filled = new Set(project.objects.filter((o) => o.parentId === layer.id && o.frameKeyId).map((o) => o.frameKeyId!));
  const { before, after } = frameOnionKeys(layer.frames, time, count, (id) => filled.has(id));

  const ghostAt = (keyId: string, at: number, side: FrameGhost['side'], rank: number): FrameGhost => {
    const items = new Map(computeFrame(project, at).map((it) => [it.objectId, it] as const));
    const shapes: FrameGhostShape[] = [];
    for (const leaf of flattenInstances(project, at)) {
      const owner = byId.get(sceneObjectId(leaf.renderId));
      if (!owner || !isInFrameKey(owner, byId, layer.id, keyId)) continue;
      const asset = assetsById.get(leaf.object.assetId);
      const item = items.get(leaf.renderId);
      // Vector drawings only (brush/pen/shapes — what frame-by-frame is drawn with); an svg or
      // text leaf has no cheap outline, so it simply isn't ghosted.
      if (!item || asset?.kind !== 'vector' || leaf.object.hidden) continue;
      if (asset.shapeType === 'path') {
        const d = item.pathD ?? (asset.path ? pathToDRings(asset.path, asset.compoundRings) : '');
        if (!d) continue;
        const evenodd = !!leaf.object.boolean || (asset.compoundRings?.length ?? 0) > 0;
        shapes.push({ id: leaf.renderId, transform: item.transform, tag: 'path', attrs: evenodd ? { d, fillRule: 'evenodd' } : { d } });
      } else {
        const geometry = sampleObject(leaf.object, leaf.localTime, asset.primitive).geometry ?? {};
        shapes.push({ id: leaf.renderId, transform: item.transform, tag: asset.shapeType, attrs: geometryToSvgAttrs(asset.shapeType, geometry) });
      }
    }
    return { keyId, time: at, side, rank, shapes };
  };

  return [
    ...before.map((s, i) => ghostAt(s.id, s.start, 'before', i)),
    ...after.map((s, i) => ghostAt(s.id, s.start, 'after', i)),
  ];
}
