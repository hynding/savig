/** Headless frame-by-frame builders (spec 2026-11-07 §DSL / MCP / macros, slice 6) — the agent
 *  path to cel animation. Same contract as build.ts: pure, id-addressed, root-scene only (MCP wraps
 *  them in `withScene`), fail loud on bad references. Key math goes through the engine's pure ops
 *  (frameLayer.ts), so an agent-built layer obeys exactly the editor's F5/F6/F7 rules.
 *
 *  Coordinates: objects filed under a key are in the LAYER's local space. A layer created here sits
 *  at (x, y) with no rotation/scale, so a drawing's coordinates are simply offset by the layer
 *  position (0,0 by default = artboard space). */
import {
  bakeShapeTween,
  MAX_SHAPE_HINTS,
  collectReferencedAssetIds,
  createFrameLayer,
  exposedFrameKeyId,
  freezeTweenedDrawing,
  rebakeLayerTweens,
  removeShapeTween as removeTweenOp,
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
import type { Easing, FrameLayer, PathPoint, Project, SceneObject, ShapeHint, VectorAsset } from '@savig/engine';
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

/** Drop vector/svg/text assets `before` referenced that nothing references any more. */
function pruneOrphans(before: Project, next: Project): Project {
  const was = collectReferencedAssetIds(before);
  const now = collectReferencedAssetIds(next);
  const assets = next.assets.filter((a) => a.kind === 'symbol' || a.kind === 'audio' || now.has(a.id) || !was.has(a.id));
  return assets.length === next.assets.length ? next : { ...next, assets };
}

/** Reproducible ids for what a shape tween mints (path assets, grown drawings): `<layer>-tw<n>`,
 *  skipping every id already in the project, so an agent-built short is byte-stable. */
function tweenIds(project: Project, layerId: string): () => string {
  const used = new Set<string>([...project.objects.map((o) => o.id), ...project.assets.map((a) => a.id)]);
  let n = 0;
  return () => {
    let id: string;
    do id = `${layerId}-tw${++n}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
}

/** Re-derive `layerId`'s shape tweens for its current key timing (spec 2026-11-13-shape-tween). */
function rebaked(project: Project, layerId: string): Project {
  const r = rebakeLayerTweens(project.objects, project.assets, layerId, tweenIds(project, layerId));
  if (r.objects === project.objects && r.assets === project.assets) return project;
  return pruneOrphans(project, { ...project, objects: r.objects, assets: r.assets });
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
  // F6 inside a shape tween splits it: the copy starts from the in-between drawing, still tweened.
  const srcTween = source ? layer.frames.keys.find((k) => k.id === source.id)?.tween : undefined;
  const tween = srcTween ? { kind: 'shape' as const, ...(srcTween.easing ? { easing: srcTween.easing } : {}) } : undefined;
  let next = withFrames(project, layer, insertFrameKey(layer.frames, { id, time: t, ...(label ? { label } : {}), ...(tween ? { tween } : {}) }, fps));
  if (source) {
    const ids = keyDrawingIds(next, layer.id, source.id);
    const sources = next.objects.filter((o) => ids.has(o.id));
    const idMap = new Map(sources.map((o) => [o.id, newId()] as const));
    let assets = next.assets;
    const copies: SceneObject[] = [];
    for (const o of sources) {
      const asset = assets.find((a) => a.id === o.assetId);
      const dup = duplicateObject(o, asset, { objectId: idMap.get(o.id)!, assetId: newId() }, 0);
      let object = dup.object;
      let clonedAsset = dup.clonedAsset;
      const frozen = tween ? freezeTweenedDrawing(object, clonedAsset as VectorAsset | undefined, t) : null;
      if (frozen) ({ object, asset: clonedAsset } = frozen);
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
  return { project: rebaked(next, layer.id), id };
}

/** F5: hold the drawing at `time` for `count` more frames (later keys and the end shift right). */
export function insertFrames(project: Project, layerId: string, time: number, count = 1): Project {
  const layer = requireLayer(project, layerId);
  const fps = project.meta.fps;
  return rebaked(withFrames(project, layer, insertFramesAt(layer.frames, snapToFrame(time, fps), Math.max(1, Math.round(count)), fps)), layer.id);
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
  return rebaked(next, layer.id);
}

/** Shift+F6: drop key `keyId` and its drawing (the previous key then holds across its span). The
 *  only key is kept but emptied. */
export function clearFrameKey(project: Project, layerId: string, keyId: string): Project {
  const layer = requireLayer(project, layerId);
  if (!layer.frames.keys.some((k) => k.id === keyId)) throw new Error(`savig/core: layer "${layerId}" has no key "${keyId}"`);
  const frames = removeFrameKey(layer.frames, keyId) ?? layer.frames;
  return rebaked(removeObjects(withFrames(project, layer, frames), [...keyDrawingIds(project, layer.id, keyId)]), layer.id);
}

/** A key of `layerId` by id, or by a time inside its span. */
function resolveKey(project: Project, layer: Layer, key: string | number): string {
  if (typeof key === 'string') {
    if (!layer.frames.keys.some((k) => k.id === key)) throw new Error(`savig/core: layer "${layer.id}" has no key "${key}"`);
    return key;
  }
  const id = exposedFrameKeyId(layer.frames, snapToFrame(key, project.meta.fps));
  if (!id) throw new Error(`savig/core: no key of "${layer.id}" spans ${key}s`);
  return id;
}

/** Create Shape Tween (spec 2026-11-13): the drawing of `key` (an id, or a time inside its span)
 *  morphs into the next key's drawing — outline, solid fill/stroke colour, opacity. Re-running
 *  re-derives it from the current drawings (keeping its easing and hints unless given). `hints`
 *  (spec 2026-11-14-shape-hints): `{ a, b }` layer-space points — the start outline's spot
 *  nearest `a` morphs to the end outline's spot nearest `b`; `[]` clears them. Fails loud on the
 *  last key or nothing tweenable. */
export function shapeTween(project: Project, layerId: string, key: string | number, opts: { easing?: Easing; hints?: ShapeHint[] } = {}): Project {
  const layer = requireLayer(project, layerId);
  const keyId = resolveKey(project, layer, key);
  const prior = layer.frames.keys.find((k) => k.id === keyId)?.tween;
  if (opts.hints !== undefined) {
    if (!Array.isArray(opts.hints)) throw new Error('savig/core: hints must be an array of { a: {x,y}, b: {x,y} }');
    const pt = (p: unknown) => !!p && typeof p === 'object' && Number.isFinite((p as PathPoint).x) && Number.isFinite((p as PathPoint).y);
    if (!opts.hints.every((h) => h && pt(h.a) && pt(h.b))) throw new Error('savig/core: each hint needs finite a: {x,y} and b: {x,y}');
    if (opts.hints.length > MAX_SHAPE_HINTS) throw new Error(`savig/core: at most ${MAX_SHAPE_HINTS} shape hints`);
  }
  const hints = opts.hints ?? prior?.hints;
  const r = bakeShapeTween(project.objects, project.assets, layerId, keyId, { easing: opts.easing ?? prior?.easing, newId: tweenIds(project, layerId), ...(hints?.length ? { hints } : {}) });
  if ('error' in r) throw new Error(`savig/core: ${r.error}`);
  return pruneOrphans(project, { ...project, objects: r.objects, assets: r.assets });
}

/** Remove the shape tween of `key`: its drawing holds again (as it was at the key's start). */
export function removeShapeTween(project: Project, layerId: string, key: string | number): Project {
  const layer = requireLayer(project, layerId);
  const keyId = resolveKey(project, layer, key);
  if (!layer.frames.keys.find((k) => k.id === keyId)?.tween) throw new Error(`savig/core: key "${keyId}" has no shape tween`);
  const r = removeTweenOp(project.objects, project.assets, layerId, keyId);
  return pruneOrphans(project, { ...project, objects: r.objects, assets: r.assets });
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
