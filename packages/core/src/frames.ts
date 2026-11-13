/** Headless frame-by-frame builders (spec 2026-11-07 §DSL / MCP / macros, slice 6) — the agent
 *  path to cel animation. Same contract as build.ts: pure, id-addressed, root-scene only (MCP wraps
 *  them in `withScene`), fail loud on bad references. Key math goes through the engine's pure ops
 *  (frameLayer.ts), so an agent-built layer obeys exactly the editor's F5/F6/F7 rules.
 *
 *  Coordinates: objects filed under a key are in the LAYER's local space. A layer created here sits
 *  at (x, y) with no rotation/scale, so a drawing's coordinates are simply offset by the layer
 *  position (0,0 by default = artboard space). */
import {
  createFrameLayer,
  duplicateObject,
  frameKeyAt,
  frameKeySpans,
  insertFrameKey,
  insertFramesAt,
  newId,
  removeFrameKey,
  removeFramesAt,
  snapToFrame,
} from '@savig/engine';
import type { FrameLayer, Project, SceneObject } from '@savig/engine';
import { removeObjects } from './build';

type Layer = SceneObject & { frames: FrameLayer };

function requireLayer(project: Project, layerId: string): Layer {
  const o = project.objects.find((x) => x.id === layerId);
  if (!o) throw new Error(`savig/core: no object with id "${layerId}"`);
  if (!o.isGroup || !o.frames) throw new Error(`savig/core: "${layerId}" is not a frame-by-frame layer`);
  return o as Layer;
}

function withFrames(project: Project, layer: Layer, frames: FrameLayer): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === layer.id ? { ...o, frames } : o)) };
}

function nextZ(objects: SceneObject[]): number {
  return objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
}

/** Direct children of `layer` filed under `keyId`, plus all their descendants. */
function keyDrawingIds(project: Project, layerId: string, keyId: string): Set<string> {
  const ids = new Set(project.objects.filter((o) => o.parentId === layerId && o.frameKeyId === keyId).map((o) => o.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const o of project.objects) {
      if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) {
        ids.add(o.id);
        changed = true;
      }
    }
  }
  return ids;
}

export interface FrameLayerOpts {
  id?: string;
  name?: string;
  /** Layer position (its children are drawn relative to it). Default 0,0. */
  x?: number;
  y?: number;
  /** Key start times (seconds, frame-snapped). Default one key at 0. Label/id optional per key. */
  keys?: Array<{ time: number; label?: string; id?: string }>;
  /** Exclusive end of the last key (seconds). Default: one frame past the last key. */
  end?: number;
}

/** Add an empty frame-by-frame layer. */
export function addFrameLayer(project: Project, opts: FrameLayerOpts = {}): { project: Project; id: string } {
  const fps = project.meta.fps;
  const id = opts.id ?? newId();
  if (project.objects.some((o) => o.id === id)) throw new Error(`savig/core: an object with id "${id}" already exists`);
  const raw = opts.keys && opts.keys.length > 0 ? opts.keys : [{ time: 0 }];
  const keys = raw
    .map((k) => ({ id: k.id ?? newId(), time: snapToFrame(Math.max(0, k.time), fps), ...(k.label?.trim() ? { label: k.label.trim() } : {}) }))
    .sort((a, b) => a.time - b.time);
  for (let i = 1; i < keys.length; i++) {
    if (Math.abs(keys[i].time - keys[i - 1].time) < 1e-6) throw new Error(`savig/core: two keys start at ${keys[i].time}s`);
  }
  const last = keys[keys.length - 1].time;
  const minEnd = snapToFrame(last + 1 / fps, fps);
  const end = opts.end === undefined ? minEnd : snapToFrame(opts.end, fps);
  if (end < minEnd - 1e-6) throw new Error(`savig/core: end ${opts.end}s must be after the last key (${last}s)`);
  const layer = createFrameLayer({ id, name: opts.name, zOrder: nextZ(project.objects), keys, end });
  const placed = { ...layer, base: { ...layer.base, x: opts.x ?? 0, y: opts.y ?? 0 } };
  return { project: { ...project, objects: [...project.objects, placed] }, id };
}

/** File existing top-level object `objectId` under `layerId`'s key `keyId` (its coordinates are
 *  then read in the layer's space). */
export function putInFrameKey(project: Project, objectId: string, layerId: string, keyId: string): Project {
  const layer = requireLayer(project, layerId);
  if (!layer.frames.keys.some((k) => k.id === keyId)) throw new Error(`savig/core: layer "${layerId}" has no key "${keyId}"`);
  const o = project.objects.find((x) => x.id === objectId);
  if (!o) throw new Error(`savig/core: no object with id "${objectId}"`);
  if (o.id === layerId) throw new Error('savig/core: a layer cannot go into its own key');
  if (o.parentId) throw new Error(`savig/core: "${objectId}" is not a top-level object`);
  return { ...project, objects: project.objects.map((x) => (x.id === objectId ? { ...x, parentId: layerId, frameKeyId: keyId } : x)) };
}

/** The key that STARTS at `time` on `layerId`, created (blank) if none does — the agent-friendly
 *  "draw on frame N" target. Returns its id. */
export function frameKeyAtTime(project: Project, layerId: string, time: number): { project: Project; id: string } {
  const layer = requireLayer(project, layerId);
  const fps = project.meta.fps;
  const t = snapToFrame(Math.max(0, time), fps);
  const existing = frameKeyAt(layer.frames, t);
  if (existing) return { project, id: existing.id };
  const id = newId();
  return { project: withFrames(project, layer, insertFrameKey(layer.frames, { id, time: t }, fps)), id };
}

/** Add a key at `time` (F7 = blank; `copyPrevious` = F6, deep-copying the drawing of the key
 *  shown just before — or the last key past the end). Errors if a key already starts there. */
export function addFrameKey(
  project: Project,
  layerId: string,
  opts: { time: number; label?: string; id?: string; copyPrevious?: boolean },
): { project: Project; id: string } {
  const layer = requireLayer(project, layerId);
  const fps = project.meta.fps;
  const t = snapToFrame(Math.max(0, opts.time), fps);
  if (frameKeyAt(layer.frames, t)) throw new Error(`savig/core: layer "${layerId}" already has a key at ${t}s`);
  const id = opts.id ?? newId();
  const source = opts.copyPrevious
    ? [...frameKeySpans(layer.frames)].reverse().find((s) => s.start < t - 1e-6)
    : undefined;
  const label = opts.label?.trim();
  let next = withFrames(project, layer, insertFrameKey(layer.frames, { id, time: t, ...(label ? { label } : {}) }, fps));
  if (source) {
    const ids = keyDrawingIds(next, layer.id, source.id);
    const sources = next.objects.filter((o) => ids.has(o.id));
    const idMap = new Map(sources.map((o) => [o.id, newId()] as const));
    let assets = next.assets;
    const copies: SceneObject[] = [];
    for (const o of sources) {
      const asset = assets.find((a) => a.id === o.assetId);
      const { object, clonedAsset } = duplicateObject(o, asset, { objectId: idMap.get(o.id)!, assetId: newId() }, 0);
      if (clonedAsset) assets = [...assets, clonedAsset];
      const isRoot = o.parentId === layer.id;
      copies.push({
        ...object,
        name: o.name,
        parentId: isRoot ? layer.id : idMap.get(o.parentId!) ?? o.parentId,
        ...(isRoot ? { frameKeyId: id } : {}),
      });
    }
    next = { ...next, assets, objects: [...next.objects, ...copies] };
  }
  return { project: next, id };
}

/** F5: hold the drawing at `time` for `count` more frames (later keys and the end shift right). */
export function insertFrames(project: Project, layerId: string, time: number, count = 1): Project {
  const layer = requireLayer(project, layerId);
  const fps = project.meta.fps;
  return withFrames(project, layer, insertFramesAt(layer.frames, snapToFrame(time, fps), Math.max(1, Math.round(count)), fps));
}

/** Shift+F5: remove `count` frames at `time`; a key whose span collapses is dropped with its
 *  drawing. Fails loud when impossible (past the end, too few empty frames, the only key). */
export function removeFrames(project: Project, layerId: string, time: number, count = 1): Project {
  const layer = requireLayer(project, layerId);
  const fps = project.meta.fps;
  const r = removeFramesAt(layer.frames, snapToFrame(time, fps), Math.max(1, Math.round(count)), fps);
  if (!r) throw new Error(`savig/core: cannot remove ${count} frame(s) at ${time}s on "${layerId}"`);
  let next = withFrames(project, layer, r.layer);
  if (r.clearedKeyId) next = removeObjects(next, [...keyDrawingIds(project, layer.id, r.clearedKeyId)]);
  return next;
}

/** Shift+F6: drop key `keyId` and its drawing (the previous key then holds across its span). The
 *  only key is kept but emptied. */
export function clearFrameKey(project: Project, layerId: string, keyId: string): Project {
  const layer = requireLayer(project, layerId);
  if (!layer.frames.keys.some((k) => k.id === keyId)) throw new Error(`savig/core: layer "${layerId}" has no key "${keyId}"`);
  const frames = removeFrameKey(layer.frames, keyId) ?? layer.frames;
  return removeObjects(withFrames(project, layer, frames), [...keyDrawingIds(project, layer.id, keyId)]);
}

/** Flipbook: lay `drawings` (each a list of existing top-level object ids) out as consecutive keys
 *  on `layerId`, `hold` frames apiece (hold 2 = "on twos"), starting at `start`. The layer's keys
 *  are replaced (ids `<layerId>-k<i>`, reproducible), so it must not hold any drawing yet; its end
 *  becomes the last drawing's end. */
export function flipbook(
  project: Project,
  layerId: string,
  drawings: string[][],
  opts: { start?: number; hold?: number } = {},
): Project {
  const layer = requireLayer(project, layerId);
  if (drawings.length === 0) throw new Error('savig/core: flipbook needs at least one drawing');
  if (project.objects.some((o) => o.parentId === layerId)) throw new Error(`savig/core: layer "${layerId}" already has drawings`);
  const fps = project.meta.fps;
  const hold = Math.max(1, Math.round(opts.hold ?? 1));
  const start = snapToFrame(Math.max(0, opts.start ?? 0), fps);
  const keys = drawings.map((_, i) => ({ id: `${layerId}-k${i}`, time: snapToFrame(start + (i * hold) / fps, fps) }));
  const end = snapToFrame(start + (drawings.length * hold) / fps, fps);
  let next = withFrames(project, layer, { ...layer.frames, keys, end });
  drawings.forEach((ids, i) => {
    for (const id of ids) {
      next = putInFrameKey(next, id, layerId, keys[i].id);
    }
  });
  return next;
}
