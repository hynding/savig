// Frame-by-frame authoring verbs (spec 2026-11-07-frame-by-frame-design.md, slice 2). A frame
// layer is an `isGroup` container carrying `frames`; its direct children carry the `frameKeyId`
// of the key whose drawing they belong to. These actions are active-scene aware (root, a scene,
// or an edited symbol), frame-snap the playhead, commit one undoable step each, and route the key
// math through the pure engine ops in `@savig/engine` (frameLayer.ts).
import {
  collectReferencedAssetIds,
  duplicateObject,
  exposedFrameKeyId,
  frameKeyAt,
  frameKeyForCopy,
  frameKeySpans,
  insertFrameKey,
  insertFramesAt,
  isLockedInTree,
  moveFrameKey,
  newId,
  removeFrameKey,
  removeFramesAt,
  sampleObject,
  setFrameKeyLabel,
  snapToFrame,
  unbakeGroupFromChild,
  createFrameLayer,
} from '@savig/engine';
import type { Asset, FrameLayer, Project, SceneObject } from '@savig/engine';
import { resolveObjectAnchor } from '@savig/interaction';
import { selectActiveObjects, selectActiveScope, selectEditDuration, selectTargetFrameLayer } from '../selectors';
import { nextZOrder, withSceneObjects, type EditorState, type SceneScope, type SliceCreator, type StoreGet } from '../store-internals';

type FrameLayerKeys =
  | 'newFrameLayer' | 'convertToFrameLayer' | 'insertFrameKeyframe' | 'insertBlankFrameKeyframe'
  | 'insertFrames' | 'removeFrames' | 'clearFrameKeyframe' | 'moveFrameKeyTo' | 'setFrameKeyLabel'
  | 'stepFrameKey';

/** `ids` plus every descendant (parentId chain) within `objects`. */
function withDescendants(objects: SceneObject[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  for (let changed = true; changed; ) {
    changed = false;
    for (const o of objects) {
      if (o.parentId && out.has(o.parentId) && !out.has(o.id)) {
        out.add(o.id);
        changed = true;
      }
    }
  }
  return out;
}

/** Remove `ids` (+ descendants) from the scene objects and prune their vector/svg/text assets
 *  that nothing references any more (mirrors deleteSelectedObject's cross-scene prune; symbol
 *  and audio assets are library items and never pruned). */
function deleteAndPrune(project: Project, scope: SceneScope, objects: SceneObject[], ids: Iterable<string>): { project: Project; objects: SceneObject[] } {
  const doomed = withDescendants(objects, ids);
  if (doomed.size === 0) return { project, objects };
  const candidates = new Set(objects.filter((o) => doomed.has(o.id) && o.assetId).map((o) => o.assetId));
  const nextObjects = objects.filter((o) => !doomed.has(o.id));
  let next = withSceneObjects(project, scope, nextObjects);
  const referenced = collectReferencedAssetIds(next);
  next = {
    ...next,
    assets: next.assets.filter((a) => !candidates.has(a.id) || a.kind === 'symbol' || a.kind === 'audio' || referenced.has(a.id)),
  };
  return { project: next, objects: nextObjects };
}

/** The target layer + context every verb needs, or null after a toast explaining why not. */
function target(s: EditorState): { layer: SceneObject & { frames: FrameLayer }; objects: SceneObject[]; scope: SceneScope; time: number; fps: number } | null {
  const layer = selectTargetFrameLayer(s);
  if (!layer || !layer.frames) {
    s.pushToast('error', 'Select a frame-by-frame layer (or a drawing in one) first.');
    return null;
  }
  const objects = selectActiveObjects(s);
  if (isLockedInTree(layer, new Map(objects.map((o) => [o.id, o] as const)))) {
    s.pushToast('error', `"${layer.name}" is locked.`);
    return null;
  }
  const fps = s.history.present.meta.fps;
  return { layer: layer as SceneObject & { frames: FrameLayer }, objects, scope: selectActiveScope(s), time: snapToFrame(s.time, fps), fps };
}

const replaceLayer = (objects: SceneObject[], layer: SceneObject, frames: FrameLayer): SceneObject[] =>
  objects.map((o) => (o.id === layer.id ? { ...o, frames } : o));

/** Drawing-tool hook (spec §Drawing into keys): when a frame layer is targeted, place the freshly
 *  created `obj` into the key under the playhead — auto-creating a blank key there when none
 *  covers it — converting its position into the layer's local space (exact for an identity layer,
 *  which is the default). Returns the inputs unchanged when there is no unlocked target layer.
 *  `project` must not yet contain `obj`; the caller appends the returned object. */
export function placeInTargetFrameKey(
  s: EditorState,
  project: Project,
  scope: SceneScope,
  asset: Asset | undefined,
  obj: SceneObject,
): { project: Project; obj: SceneObject } {
  const layer = selectTargetFrameLayer(s);
  if (!layer?.frames) return { project, obj };
  const objects = selectActiveObjects(s);
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  if (isLockedInTree(layer, byId)) return { project, obj };
  const fps = project.meta.fps;
  const time = snapToFrame(s.time, fps);
  let frames = layer.frames;
  let keyId = exposedFrameKeyId(frames, time);
  if (!keyId) {
    keyId = newId();
    frames = insertFrameKey(frames, { id: keyId, time }, fps);
  }
  // Bake into the layer's (and its ancestors') local space, outermost first — reparentObject's
  // unbake chain, so a moved/rotated layer still receives the stroke where it was drawn.
  const r = resolveObjectAnchor(obj, asset, sampleObject(obj, time, asset?.kind === 'vector' ? asset.primitive : undefined));
  const ax = r ? r.anchorX : obj.anchorX;
  const ay = r ? r.anchorY : obj.anchorY;
  const chain: SceneObject[] = [];
  const seen = new Set<string>();
  for (let g: SceneObject | undefined = layer; g && g.isGroup && !seen.has(g.id); g = g.parentId ? byId.get(g.parentId) : undefined) {
    seen.add(g.id);
    chain.push(g);
  }
  let placed = obj;
  for (const g of chain.reverse()) placed = unbakeGroupFromChild(g, placed, ax, ay);
  placed = { ...placed, parentId: layer.id, frameKeyId: keyId };
  const nextProject = frames === layer.frames ? project : withSceneObjects(project, scope, replaceLayer(objects, layer, frames));
  return { project: nextProject, obj: placed };
}

export const createFrameLayerSlice: SliceCreator<FrameLayerKeys> = (_set, get) => ({
  newFrameLayer() {
    const s = get();
    const project = s.history.present;
    const fps = project.meta.fps;
    const time = snapToFrame(s.time, fps);
    const objects = selectActiveObjects(s);
    const n = objects.filter((o) => o.frames).length + 1;
    const layer = createFrameLayer({
      name: `Frame Layer ${n}`,
      zOrder: nextZOrder(objects),
      keys: [{ id: newId(), time }],
      end: Math.max(snapToFrame(selectEditDuration(s), fps), snapToFrame(time + 1 / fps, fps)),
    });
    get().commit(withSceneObjects(project, selectActiveScope(s), [...objects, layer]));
    get().selectObject(layer.id);
  },

  convertToFrameLayer() {
    const s = get();
    const project = s.history.present;
    const fps = project.meta.fps;
    const time = snapToFrame(s.time, fps);
    const objects = selectActiveObjects(s);
    // Same eligibility as groupSelected: top-level, unlocked (a top-level layer is a group, so a
    // frame layer can itself go into another layer's first key).
    const targets = s.selectedObjectIds
      .map((id) => objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked && !o.parentId);
    if (targets.length === 0) {
      get().pushToast('error', 'Select top-level, unlocked objects to make a frame layer.');
      return;
    }
    const keyId = newId();
    const layer = createFrameLayer({
      name: `Frame Layer ${objects.filter((o) => o.frames).length + 1}`,
      zOrder: Math.max(...targets.map((o) => o.zOrder)) + 1,
      keys: [{ id: keyId, time }],
      end: Math.max(snapToFrame(selectEditDuration(s), fps), snapToFrame(time + 1 / fps, fps)),
    });
    const ids = new Set(targets.map((o) => o.id));
    const next = [...objects.map((o) => (ids.has(o.id) ? { ...o, parentId: layer.id, frameKeyId: keyId } : o)), layer];
    get().commit(withSceneObjects(project, selectActiveScope(s), next));
    get().selectObject(layer.id);
  },

  insertFrameKeyframe() {
    const s = get();
    const t = target(s);
    if (!t) return;
    const { layer, objects, scope, time, fps } = t;
    if (frameKeyAt(layer.frames, time)) return; // already a key here (Flash: F6 on a key is a no-op)
    const source = frameKeyForCopy(layer.frames, time);
    if (!source) {
      get().insertBlankFrameKeyframe(); // before the first key: nothing to copy
      return;
    }
    const keyId = newId();
    const frames = insertFrameKey(layer.frames, { id: keyId, time }, fps);
    // Deep-copy the source key's drawing (direct children + their descendants). duplicateObject
    // clones vector/text assets, so editing the new drawing never touches the old one; parentId
    // relinks through idMap; direct children are re-tagged with the new key. zOrder is kept so
    // the copy stacks exactly where the original did relative to other layers.
    const roots = objects.filter((o) => o.parentId === layer.id && o.frameKeyId === source.id);
    const sources = objects.filter((o) => withDescendants(objects, roots.map((r) => r.id)).has(o.id));
    const idMap = new Map(sources.map((o) => [o.id, newId()] as const));
    let assets = s.history.present.assets;
    const copies: SceneObject[] = [];
    for (const o of sources) {
      const asset = assets.find((a) => a.id === o.assetId);
      const { object, clonedAsset } = duplicateObject(o, asset, { objectId: idMap.get(o.id)!, assetId: newId() }, 0);
      if (clonedAsset) assets = [...assets, clonedAsset];
      const isRoot = o.parentId === layer.id;
      copies.push({
        ...object,
        name: o.name,
        zOrder: o.zOrder,
        parentId: isRoot ? layer.id : idMap.get(o.parentId!) ?? o.parentId,
        ...(isRoot ? { frameKeyId: keyId } : {}),
      });
    }
    const next = [...replaceLayer(objects, layer, frames), ...copies];
    get().commit(withSceneObjects({ ...s.history.present, assets }, scope, next));
    const rootCopies = copies.filter((c) => c.parentId === layer.id).map((c) => c.id);
    if (rootCopies.length > 0) get().selectObjects(rootCopies);
    else get().selectObject(layer.id);
  },

  insertBlankFrameKeyframe() {
    const s = get();
    const t = target(s);
    if (!t) return;
    const { layer, objects, scope, time, fps } = t;
    if (frameKeyAt(layer.frames, time)) return;
    const frames = insertFrameKey(layer.frames, { id: newId(), time }, fps);
    get().commit(withSceneObjects(s.history.present, scope, replaceLayer(objects, layer, frames)));
    get().selectObject(layer.id); // keep the layer targeted so the next stroke lands in the new key
  },

  insertFrames(n = 1) {
    const s = get();
    const t = target(s);
    if (!t) return;
    const { layer, objects, scope, time, fps } = t;
    const frames = insertFramesAt(layer.frames, time, Math.max(1, Math.round(n)), fps);
    get().commit(withSceneObjects(s.history.present, scope, replaceLayer(objects, layer, frames)));
  },

  removeFrames(n = 1) {
    const s = get();
    const t = target(s);
    if (!t) return;
    const { layer, objects, scope, time, fps } = t;
    const r = removeFramesAt(layer.frames, time, Math.max(1, Math.round(n)), fps);
    if (!r) {
      get().pushToast('error', 'No frames to remove here.');
      return;
    }
    let project = withSceneObjects(s.history.present, scope, replaceLayer(objects, layer, r.layer));
    if (r.clearedKeyId) {
      const after = sceneAfter(objects, layer, r.layer);
      const drawing = after.filter((o) => o.parentId === layer.id && o.frameKeyId === r.clearedKeyId).map((o) => o.id);
      project = deleteAndPrune(project, scope, after, drawing).project;
    }
    get().commit(project);
    reselectLayerIfGone(get, layer.id);
  },

  clearFrameKeyframe() {
    const s = get();
    const t = target(s);
    if (!t) return;
    const { layer, objects, scope, time } = t;
    const key = frameKeyAt(layer.frames, time);
    if (!key) {
      get().pushToast('error', 'No keyframe at the playhead.');
      return;
    }
    // The only key keeps existing (a layer always has one) but loses its drawing.
    const frames = removeFrameKey(layer.frames, key.id) ?? layer.frames;
    const drawing = objects.filter((o) => o.parentId === layer.id && o.frameKeyId === key.id).map((o) => o.id);
    if (frames === layer.frames && drawing.length === 0) return; // the only key, already blank
    const after = sceneAfter(objects, layer, frames);
    const { project } = deleteAndPrune(withSceneObjects(s.history.present, scope, after), scope, after, drawing);
    get().commit(project);
    get().selectObject(layer.id);
  },

  moveFrameKeyTo(keyId, time) {
    const s = get();
    const t = target(s);
    if (!t) return;
    const { layer, objects, scope, fps } = t;
    const frames = moveFrameKey(layer.frames, keyId, time, fps);
    const was = layer.frames.keys.find((k) => k.id === keyId)?.time;
    const now = frames.keys.find((k) => k.id === keyId)?.time;
    if (was === undefined || was === now) return; // unknown key, or clamped to where it already is
    get().commit(withSceneObjects(s.history.present, scope, replaceLayer(objects, layer, frames)));
  },

  setFrameKeyLabel(keyId, label) {
    const s = get();
    const t = target(s);
    if (!t) return;
    const { layer, objects, scope } = t;
    if (!layer.frames.keys.some((k) => k.id === keyId)) return;
    const frames = setFrameKeyLabel(layer.frames, keyId, label);
    get().commit(withSceneObjects(s.history.present, scope, replaceLayer(objects, layer, frames)));
  },

  stepFrameKey(direction) {
    const s = get();
    const layer = selectTargetFrameLayer(s);
    if (!layer?.frames) return;
    const fps = s.history.present.meta.fps;
    const now = snapToFrame(s.time, fps);
    const starts = frameKeySpans(layer.frames).map((sp) => sp.start);
    const next = direction > 0 ? starts.find((x) => x > now + 1e-6) : [...starts].reverse().find((x) => x < now - 1e-6);
    if (next !== undefined) get().seek(next);
  },
});

/** The scene objects with `layer`'s frames replaced (pure; for follow-up edits in one commit). */
function sceneAfter(objects: SceneObject[], layer: SceneObject, frames: FrameLayer): SceneObject[] {
  return replaceLayer(objects, layer, frames);
}

/** After a delete that may have removed the selected drawing, keep the layer targeted. */
function reselectLayerIfGone(get: StoreGet, layerId: string): void {
  const s = get();
  const objects = selectActiveObjects(s);
  if (!s.selectedObjectIds.every((id) => objects.some((o) => o.id === id))) s.selectObject(layerId);
}
