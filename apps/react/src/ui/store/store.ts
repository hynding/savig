import { create } from 'zustand';
import {
  createProject,
  createHistory,
  pushHistory,
  createSceneObject,
  createVectorAsset,
  duplicateObject,
  collectReferencedAssetIds,
  reorderObjects,
  moveObjectToTarget as moveObjectToTargetPure,
  createKeyframe,
  DEFAULT_TRANSFORM,
  snapToFrame,
  upsertKeyframe,
  removeKeyframeAt,
  sampleObject,
  samplePath,
  upsertShapeKeyframe,
  removeShapeKeyframeAt,
  upsertColorKeyframe,
  removeColorKeyframeAt,
  upsertGradientKeyframe,
  removeGradientKeyframeAt,
  newId,
  undo as undoHistory,
  redo as redoHistory,
} from '@savig/engine';
import { pathBounds, identityCorrespondence, primitivePathFromSpec, symbolContains, isLockedInTree, symbolEffectiveDuration } from '@savig/engine';
import type {
  AnimatableProperty,
  Asset,
  PrimitiveSpec,
  Easing,
  PathData,
  SceneObject,
  SymbolTiming,
  ShapeKeyframe,
  VectorAsset,
} from '@savig/engine';
import { deleteNodeAt, insertNodeAt, toggleSmooth, joinHandle, spliceNodeEasings, spliceCorrespondence } from '@savig/interaction';
import { objectAABB, groupBBox, isSymbolInstance, type AABB } from '@savig/interaction';
import { getStageCursor } from '@savig/interaction';
import { computeAlign, computeAlignToFrame, computeDistribute, computeDistributeSpacing, computeDistributeCenters, computeCenterOnFrame } from '@savig/interaction';
import { selectEditablePath, selectEditedShapeKeyframe, selectActiveObjects, selectEditableRings, selectActiveRingPath, selectActiveScope } from './selectors';
import {
  KF_EPS,
  DUP_OFFSET,
  PATH_DEFAULT_STYLE,
  TRANSIENT_DEFAULTS,
  NO_KEYFRAME_SELECTION,
  replaceObjectInScene,
  sceneObjectsOf,
  appendToScene,
  appendObjectToScene,
  withSceneObjects,
  nextZOrder,
  clearStaleSelection,
  applyObjectTransform,
  lockedInScene,
  activeSceneDims,
  alignItemsUpdates,
  selectedPathCtx,
} from './store-internals';
import type { EditorState, KeyframeClip } from './store-internals';
import { createTransportPrefsSlice } from './slices/transportPrefsSlice';
import { createGroupSymbolSlice } from './slices/groupSymbolSlice';
import { createScenesSlice } from './slices/scenesSlice';

// Re-export the store's public types so existing consumers keep importing them from './store'.
export type {
  EditorState,
  Theme,
  ToolMode,
  KeyframeRef,
  ShapeKeyframeRef,
  ColorKeyframeRef,
  GradientKeyframeRef,
  DashKeyframeRef,
  ProgressKeyframeRef,
  RemapKeyframeRef,
  KeyframeClip,
  Toast,
} from './store-internals';

export const useEditor = create<EditorState>((set, get) => ({
  history: createHistory(createProject()),
  theme: 'dark',
  // A persistent view preference (like theme) — survives newProject/setProject.
  onionSkin: false,
  // Snapping is a persistent editing preference — survives newProject too.
  snapEnabled: true,
  // Snap-to-grid: off by default; 20px lattice. Persistent prefs (survive newProject).
  gridEnabled: false,
  gridSize: 20,
  // The object clipboard also survives newProject (enables cross-project paste). A LIST
  // (slice 39): null or a non-empty array of {object, asset} snapshots.
  clipboard: null as { object: SceneObject; asset?: Asset }[] | null,
  // The keyframe clipboard also survives newProject (mutually exclusive with `clipboard`).
  keyframeClipboard: null as KeyframeClip | null,
  ...TRANSIENT_DEFAULTS,

  setProject(project, binaries = {}) {
    set({ history: createHistory(project), ...TRANSIENT_DEFAULTS, binaries });
  },
  newProject() {
    set({ history: createHistory(createProject()), ...TRANSIENT_DEFAULTS });
  },
  enterSymbol(assetId) {
    const a = get().history.present.assets.find((x) => x.id === assetId);
    if (!a || a.kind !== 'symbol') return; // only symbols are editable scenes
    set({ editPath: [...get().editPath, assetId], activeTool: 'select' });
    get().selectObject(null); // selection ids are scene-local
  },
  exitSymbol() {
    if (get().editPath.length === 0) return;
    set({ editPath: get().editPath.slice(0, -1) });
    get().selectObject(null);
  },
  exitToDepth(depth) {
    if (depth < 0 || depth >= get().editPath.length) return;
    set({ editPath: get().editPath.slice(0, depth) });
    get().selectObject(null);
  },
  commitActiveScene(nextObjects) {
    const s = get();
    get().commit(withSceneObjects(s.history.present, selectActiveScope(s), nextObjects));
  },
  commit(next) {
    set({ history: pushHistory(get().history, next) });
  },
  undo() {
    const history = undoHistory(get().history);
    set({ history, ...clearStaleSelection(history, get().editPath, get().selectedSceneId, get().selectedObjectIds) });
  },
  redo() {
    const history = redoHistory(get().history);
    set({ history, ...clearStaleSelection(history, get().editPath, get().selectedSceneId, get().selectedObjectIds) });
  },

  addAsset(asset, bytes) {
    const project = get().history.present;
    if (!project.assets.some((a) => a.id === asset.id)) {
      get().commit({ ...project, assets: [...project.assets, asset] });
    }
    if (bytes) set({ binaries: { ...get().binaries, [asset.id]: bytes } });
  },
  addObject(assetId) {
    const s = get();
    const project = s.history.present;
    const asset = project.assets.find((a) => a.id === assetId);
    const anchorX = asset && asset.kind === 'svg' ? asset.width / 2 : 0;
    const anchorY = asset && asset.kind === 'svg' ? asset.height / 2 : 0;
    const active = selectActiveObjects(s);
    const obj = createSceneObject(assetId, {
      name: `${asset?.name ?? 'Object'} ${nextZOrder(active) + 1}`,
      zOrder: nextZOrder(active),
      anchorX,
      anchorY,
    });
    get().commitActiveScene([...active, obj]);
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null });
  },
  duplicateSelected() {
    const s = get();
    let objects = selectActiveObjects(s);
    const scope = selectActiveScope(s);
    let assets = s.history.present.assets;
    // Bulk: duplicate every selected non-locked object in one commit (slice 36). Lock cascades
    // from a parent group, so build the lock map once.
    const dupLockById = new Map(objects.map((o) => [o.id, o]));
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    // Expand the selection to a selected group's DESCENDANTS (recursive) so duplicating a group
    // DEEP-clones its children (relinked below) rather than producing an empty shallow clone.
    const ids = new Set<string>();
    const addWithDescendants = (id: string) => {
      if (ids.has(id)) return;
      const o = byId.get(id);
      if (!o || isLockedInTree(o, dupLockById)) return; // never duplicate a locked subtree
      ids.add(id);
      for (const c of objects) if (c.parentId === id) addWithDescendants(c.id);
    };
    for (const id of s.selectedObjectIds) addWithDescendants(id);
    const sources = [...ids].map((id) => byId.get(id)!);
    if (sources.length === 0) return;
    // Old-id → new-id map so a duplicated group's children relink to the fresh group, not the original.
    const idMap = new Map<string, string>();
    for (const o of sources) idMap.set(o.id, newId());
    const cloneIds: string[] = [];
    for (const obj of sources) {
      const asset = assets.find((a) => a.id === obj.assetId);
      // A duplicate ROOT (parent not also duplicated) gets the offset; a child keeps its
      // group-relative base (the moved root carries it) and relinks parentId via idMap.
      const isRoot = !obj.parentId || !idMap.has(obj.parentId);
      const newParentId = obj.parentId && idMap.has(obj.parentId) ? idMap.get(obj.parentId) : undefined;
      const { object, clonedAsset } = duplicateObject(obj, asset, { objectId: idMap.get(obj.id)!, assetId: newId() }, isRoot ? DUP_OFFSET : 0);
      const withParent = newParentId !== undefined ? { ...object, parentId: newParentId } : object;
      const placed = { ...withParent, zOrder: nextZOrder(objects) };
      if (clonedAsset) assets = [...assets, clonedAsset];
      objects = [...objects, placed];
      if (isRoot) cloneIds.push(placed.id); // select duplicate ROOTS only (a group, not its children)
    }
    get().commit(withSceneObjects({ ...s.history.present, assets }, scope, objects));
    get().selectObjects(cloneIds);
  },
  copySelected() {
    const s = get();
    const project = s.history.present;
    // Snapshot EVERY selected object (+ its asset), zOrder-sorted for stable paste
    // stacking (slice 39). Immutable snapshots; clears the keyframe clipboard.
    const objects = selectActiveObjects(s);
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    // Expand the selection to include the DESCENDANTS of any selected group (recursive), so copying
    // a group brings its children along — paste then recreates the group with relinked parentId.
    const ids = new Set<string>();
    const addWithDescendants = (id: string) => {
      if (ids.has(id) || !byId.has(id)) return;
      ids.add(id);
      for (const o of objects) if (o.parentId === id) addWithDescendants(o.id);
    };
    for (const id of s.selectedObjectIds) addWithDescendants(id);
    const entries = [...ids]
      .map((id) => byId.get(id)!)
      .sort((x, y) => x.zOrder - y.zOrder)
      .map((obj) => ({ object: obj, asset: project.assets.find((a) => a.id === obj.assetId) }));
    if (entries.length === 0) return; // nothing selected -> leave the clipboard untouched
    set({ clipboard: entries, keyframeClipboard: null });
  },
  cut() {
    get().copySelected();
    get().deleteSelectedObject(); // both bulk; cutting a locked member copies but does not remove it
  },
  paste() {
    const s = get();
    const clip = s.clipboard;
    if (!clip || clip.length === 0) return;
    const scope = selectActiveScope(s);
    const activeAssetId = scope.assetId; // active scene: null at root, symbol id in edit mode (cycle guard)
    let project = s.history.present;
    // Paste-at-cursor: when the pointer is over the Stage, shift the paste so the clipboard's
    // combined bbox CENTRE lands at the cursor (active-scene coords); else the fixed diagonal offset.
    const cursor = getStageCursor();
    let delta: { x: number; y: number } | null = null;
    if (cursor) {
      const time = snapToFrame(s.time, project.meta.fps);
      const boxes = clip.map((e) => objectAABB(e.object, e.asset, time)).filter((a): a is AABB => !!a);
      const bb = groupBBox(boxes);
      if (bb) delta = { x: cursor.x - (bb.minX + bb.maxX) / 2, y: cursor.y - (bb.minY + bb.maxY) / 2 };
    }
    // Old-id → new-id map across ALL clipboard entries, so a copied group's children relink to the
    // freshly-pasted group (not the original). Built up-front; consumed per entry below.
    const idMap = new Map<string, string>();
    for (const entry of clip) idMap.set(entry.object.id, newId());
    const selectIds: string[] = [];
    let pasted = false;
    let skippedCyclic = false;
    for (const entry of clip) {
      // Cycle guard: pasting a symbol INSTANCE into a symbol that it would (transitively) contain
      // authors a cycle — same rejection as placeSymbolInstance/swapSymbol (47d cycle guard #2).
      if (
        activeAssetId &&
        isSymbolInstance(entry.object, project.assets) &&
        (entry.object.assetId === activeAssetId || symbolContains(entry.object.assetId, activeAssetId, project.assets))
      ) {
        skippedCyclic = true;
        continue;
      }
      // A paste ROOT = an entry whose parent isn't also being pasted; only roots get the cursor delta
      // or DUP_OFFSET. A copied child keeps its group-relative base (the moved root carries it) and
      // relinks parentId to the freshly-pasted group via idMap.
      const isRoot = !entry.object.parentId || !idMap.has(entry.object.parentId);
      const offset = isRoot ? (delta ? 0 : DUP_OFFSET) : 0;
      const newParentId = entry.object.parentId && idMap.has(entry.object.parentId) ? idMap.get(entry.object.parentId) : undefined;
      const { object, clonedAsset } = duplicateObject(entry.object, entry.asset, { objectId: idMap.get(entry.object.id)!, assetId: newId() }, offset);
      // Re-attach to the freshly-pasted group; a root stays parent-less (duplicateObject deleted
      // parentId, so leave the property ABSENT rather than setting `undefined`).
      const withParent = newParentId !== undefined ? { ...object, parentId: newParentId } : object;
      const placed = delta && isRoot
        ? { ...withParent, zOrder: nextZOrder(sceneObjectsOf(project, scope)), base: { ...withParent.base, x: withParent.base.x + delta.x, y: withParent.base.y + delta.y } }
        : { ...withParent, zOrder: nextZOrder(sceneObjectsOf(project, scope)) };
      // Ensure the referenced asset exists: clonedAsset for a vector asset; otherwise re-add the
      // clipboard's shared/svg/symbol asset if the project no longer has it (cross-project paste).
      let withAssets = project;
      if (clonedAsset) withAssets = { ...project, assets: [...project.assets, clonedAsset] };
      else if (entry.asset && !project.assets.some((a) => a.id === placed.assetId)) withAssets = { ...project, assets: [...project.assets, entry.asset] };
      project = appendToScene(withAssets, scope, placed); // object -> active scene; assets stay global
      pasted = true;
      if (!placed.locked && isRoot) selectIds.push(placed.id); // select paste ROOTS only (a group, not its children); skip locked (Slice-19)
    }
    if (skippedCyclic) get().pushToast('error', "Can't paste a symbol into itself — skipped.");
    if (!pasted) return; // every entry cyclic-skipped -> no commit (avoid an empty undo step) / no select clobber
    get().commit(project);
    get().selectObjects(selectIds);
  },
  copyKeyframe() {
    const s = get();
    const kfSelected =
      s.selectedKeyframe ||
      s.selectedShapeKeyframe ||
      s.selectedColorKeyframe ||
      s.selectedGradientKeyframe ||
      s.selectedDashKeyframe ||
      s.selectedProgressKeyframe ||
      s.selectedRemapKeyframe;
    if (!kfSelected) return; // nothing selected -> don't touch either clipboard
    // A keyframe copy always clears the object clipboard (mutual exclusion). Reset the
    // keyframe clipboard too: a stale/unresolvable ref leaves it null -> paste is a no-op.
    set({ clipboard: null, keyframeClipboard: null });
    const find = <K extends { time: number }>(track: K[] | undefined, time: number) =>
      track?.find((k) => Math.abs(k.time - time) < KF_EPS);
    if (s.selectedKeyframe) {
      const r = s.selectedKeyframe;
      const kf = find(selectActiveObjects(s).find((o) => o.id === r.objectId)?.tracks[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'scalar', objectId: r.objectId, property: r.property, keyframe: kf } });
      return;
    }
    if (s.selectedShapeKeyframe) {
      const r = s.selectedShapeKeyframe;
      const kf = find(selectActiveObjects(s).find((o) => o.id === r.objectId)?.shapeTrack, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'shape', objectId: r.objectId, keyframe: kf } });
      return;
    }
    if (s.selectedColorKeyframe) {
      const r = s.selectedColorKeyframe;
      const kf = find(selectActiveObjects(s).find((o) => o.id === r.objectId)?.colorTracks?.[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'color', objectId: r.objectId, property: r.property, keyframe: kf } });
      return;
    }
    if (s.selectedGradientKeyframe) {
      const r = s.selectedGradientKeyframe;
      const kf = find(selectActiveObjects(s).find((o) => o.id === r.objectId)?.gradientTracks?.[r.property], r.time);
      if (kf) set({ keyframeClipboard: { kind: 'gradient', objectId: r.objectId, property: r.property, keyframe: kf } });
      return;
    }
    if (s.selectedDashKeyframe) {
      const r = s.selectedDashKeyframe;
      const kf = find(selectActiveObjects(s).find((o) => o.id === r.objectId)?.dashOffsetTrack, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'dash', objectId: r.objectId, keyframe: kf } });
      return;
    }
    if (s.selectedRemapKeyframe) {
      const r = s.selectedRemapKeyframe;
      const kf = find(selectActiveObjects(s).find((o) => o.id === r.objectId)?.symbolTimeTrack, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'remap', objectId: r.objectId, keyframe: kf } });
      return;
    }
    if (s.selectedProgressKeyframe) {
      const r = s.selectedProgressKeyframe;
      // Motion progress keyframes can live inside a symbol (phase 8) -> resolve the active scene.
      const kf = find(selectActiveObjects(s).find((o) => o.id === r.objectId)?.motionPath?.progress, r.time);
      if (kf) set({ keyframeClipboard: { kind: 'progress', objectId: r.objectId, keyframe: kf } });
      return;
    }
  },
  pasteKeyframe() {
    const s = get();
    const clip = s.keyframeClipboard;
    if (!clip) return;
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
    if (clip.kind === 'progress') {
      // Motion progress keyframes can live inside a symbol (phase 8) -> route to the active scene.
      const active = selectActiveObjects(s).find((o) => o.id === clip.objectId);
      if (!active?.motionPath) return;
      const next = upsertKeyframe(active.motionPath.progress, { ...clip.keyframe, time });
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...active, motionPath: { ...active.motionPath, progress: next } }));
      get().selectProgressKeyframe({ objectId: active.id, time });
      return;
    }
    const obj = selectActiveObjects(s).find((o) => o.id === clip.objectId);
    if (!obj) return;
    const aid = selectActiveScope(s);
    switch (clip.kind) {
      case 'scalar': {
        const next = upsertKeyframe(obj.tracks[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, tracks: { ...obj.tracks, [clip.property]: next } }));
        get().selectKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'dash': {
        const next = upsertKeyframe(obj.dashOffsetTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, dashOffsetTrack: next }));
        get().selectDashKeyframe({ objectId: obj.id, time });
        return;
      }
      case 'remap': {
        const next = upsertKeyframe(obj.symbolTimeTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, symbolTimeTrack: next }));
        get().selectRemapKeyframe({ objectId: obj.id, time });
        return;
      }
      case 'color': {
        const next = upsertColorKeyframe(obj.colorTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, colorTracks: { ...obj.colorTracks, [clip.property]: next } }));
        get().selectColorKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'gradient': {
        const next = upsertGradientKeyframe(obj.gradientTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, gradientTracks: { ...obj.gradientTracks, [clip.property]: next } }));
        get().selectGradientKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'shape': {
        const next = upsertShapeKeyframe(obj.shapeTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, shapeTrack: next }));
        get().selectShapeKeyframe({ objectId: obj.id, time });
        return;
      }
    }
  },
  deleteSelectedKeyframe() {
    const s = get();
    if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
    else if (s.selectedGradientKeyframe) s.removeSelectedGradientKeyframe();
    else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
    else if (s.selectedDashKeyframe) s.removeSelectedDashKeyframe();
    else if (s.selectedRemapKeyframe) s.removeSelectedRemapKeyframe();
    else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
    else if (s.selectedKeyframe) s.removeSelectedKeyframe();
  },
  cutKeyframe() {
    get().copyKeyframe(); // snapshot into keyframeClipboard (S24); no commit
    get().deleteSelectedKeyframe(); // then remove it (one commit)
  },
  retimeSelectedKeyframe(newTime) {
    const s = get();
    const project = s.history.present;
    const t = Math.max(0, snapToFrame(newTime, project.meta.fps));
    const find = <K extends { time: number }>(track: K[] | undefined, time: number) =>
      track?.find((k) => Math.abs(k.time - time) < KF_EPS);
    if (s.selectedKeyframe) {
      const r = s.selectedKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === r.objectId);
      const track = obj && obj.tracks[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, tracks: { ...obj.tracks, [r.property]: next } }));
      get().selectKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedShapeKeyframe) {
      const r = s.selectedShapeKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === r.objectId);
      const kf = find(obj?.shapeTrack, r.time);
      if (!obj || !obj.shapeTrack || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertShapeKeyframe(obj.shapeTrack.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack: next }));
      get().selectShapeKeyframe({ objectId: obj.id, time: t });
      return;
    }
    if (s.selectedColorKeyframe) {
      const r = s.selectedColorKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === r.objectId);
      const track = obj?.colorTracks?.[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertColorKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, colorTracks: { ...obj.colorTracks, [r.property]: next } }));
      get().selectColorKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedGradientKeyframe) {
      const r = s.selectedGradientKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === r.objectId);
      const track = obj?.gradientTracks?.[r.property];
      const kf = find(track, r.time);
      if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertGradientKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, gradientTracks: { ...obj.gradientTracks, [r.property]: next } }));
      get().selectGradientKeyframe({ objectId: obj.id, property: r.property, time: t });
      return;
    }
    if (s.selectedDashKeyframe) {
      const r = s.selectedDashKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === r.objectId);
      const kf = find(obj?.dashOffsetTrack, r.time);
      if (!obj || !obj.dashOffsetTrack || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(obj.dashOffsetTrack.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, dashOffsetTrack: next }));
      get().selectDashKeyframe({ objectId: obj.id, time: t });
      return;
    }
    if (s.selectedRemapKeyframe) {
      const r = s.selectedRemapKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === r.objectId);
      const kf = find(obj?.symbolTimeTrack, r.time);
      if (!obj || !obj.symbolTimeTrack || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(obj.symbolTimeTrack.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, symbolTimeTrack: next }));
      get().selectRemapKeyframe({ objectId: obj.id, time: t });
      return;
    }
    if (s.selectedProgressKeyframe) {
      const r = s.selectedProgressKeyframe;
      // Motion progress keyframes can live inside a symbol (phase 8) -> route to the active scene.
      const obj = selectActiveObjects(s).find((o) => o.id === r.objectId);
      const kf = find(obj?.motionPath?.progress, r.time);
      if (!obj || !obj.motionPath || !kf || Math.abs(t - r.time) < KF_EPS) return;
      const next = upsertKeyframe(obj.motionPath.progress.filter((k) => k !== kf), { ...kf, time: t });
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, motionPath: { ...obj.motionPath, progress: next } }));
      get().selectProgressKeyframe({ objectId: obj.id, time: t });
      return;
    }
  },
  deleteSelectedObject() {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s); // root, or the edited symbol's scene (47-edit)
    // Selected, non-locked ids that live in the ACTIVE scene (slice 36 bulk); lock cascades
    // from a parent group.
    const delLockById = new Map(objects.map((o) => [o.id, o]));
    const ids = s.selectedObjectIds.filter((id) => {
      const o = objects.find((x) => x.id === id);
      return !!o && !isLockedInTree(o, delLockById);
    });
    if (ids.length === 0) return;
    // Cascade: deleting a group CONTAINER removes its whole subtree (recursively for NESTED groups,
    // 45e) so descendants aren't orphaned with a dangling parentId.
    const toDelete = new Set(ids);
    for (let changed = true; changed; ) {
      changed = false;
      for (const o of objects) {
        if (o.parentId && toDelete.has(o.parentId) && !toDelete.has(o.id)) {
          toDelete.add(o.id);
          changed = true;
        }
      }
    }
    const candidateAssetIds = new Set<string>();
    for (const o of objects) if (toDelete.has(o.id) && o.assetId) candidateAssetIds.add(o.assetId);
    const nextObjects = objects.filter((o) => !toDelete.has(o.id));
    if (nextObjects.length === objects.length) return; // nothing removed -> no commit
    // Write the active scene back (root project.objects, the edited symbol asset, or a scene).
    let nextProject = withSceneObjects(project, selectActiveScope(s), nextObjects);
    // Cross-scene, symbol-preserving prune: drop a deleted object's vector/svg asset only when it
    // is referenced nowhere in the post-delete project; never prune symbol (library) / audio assets.
    const referenced = collectReferencedAssetIds(nextProject);
    const prunedAssets = nextProject.assets.filter((a) => {
      if (!candidateAssetIds.has(a.id)) return true;
      if (a.kind === 'symbol' || a.kind === 'audio') return true;
      return referenced.has(a.id);
    });
    nextProject = { ...nextProject, assets: prunedAssets };
    get().commit(nextProject);
    get().selectObject(null);
  },
  reorderSelected(op) {
    const s = get();
    const id = s.selectedObjectId;
    if (id == null) return;
    const cur = selectActiveObjects(s);
    const objects = reorderObjects(cur, id, op);
    if (objects === cur) return; // no-op -> no commit
    get().commitActiveScene(objects);
  },
  moveObjectToTarget(draggedId, targetId) {
    const s = get();
    const cur = selectActiveObjects(s);
    const objects = moveObjectToTargetPure(cur, draggedId, targetId);
    if (objects === cur) return; // no-op -> no commit
    get().commitActiveScene(objects);
  },
  toggleObjectVisibility(id) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === id);
    if (!obj) return;
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, hidden: !obj.hidden }));
  },
  toggleObjectLock(id) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === id);
    if (!obj) return; // unknown id -> no-op
    const locking = !obj.locked;
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, locked: locking }));
    // Drop a freshly-locked object from the selection (it can't be edited/deleted).
    if (locking && get().selectedObjectIds.includes(id)) {
      const next = get().selectedObjectIds.filter((x) => x !== id);
      set({ selectedObjectIds: next, selectedObjectId: next.at(-1) ?? null });
    }
  },
  renameObject(id, name) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === id);
    if (!obj || obj.name === name) return; // unknown / unchanged -> no-op
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, name }));
  },
  addVectorShape(shapeType, bounds) {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const activeId = selectActiveScope(s);
    const asset = createVectorAsset(shapeType);
    const shapeBase =
      shapeType === 'ellipse'
        ? { radiusX: bounds.width / 2, radiusY: bounds.height / 2 }
        : { width: bounds.width, height: bounds.height };
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: bounds.x, y: bounds.y },
      shapeBase,
    });
    get().commit(appendObjectToScene(project, activeId, asset, obj));
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, activeTool: 'select' });
  },
  addVectorPath(path, styleSeed) {
    if (path.nodes.length < 2) return;
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const activeId = selectActiveScope(s);
    const box = pathBounds(path);
    // Normalize so the bbox top-left sits at local origin; the object transform places it.
    const normalized: PathData = {
      closed: path.closed,
      nodes: path.nodes.map((n) => ({
        anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
        ...(n.in ? { in: n.in } : {}),
        ...(n.out ? { out: n.out } : {}),
      })),
    };
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE, ...styleSeed } });
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
    });
    get().commit(appendObjectToScene(project, activeId, asset, obj));
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null, activeTool: 'node' });
  },
  addPrimitive(spec) {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const activeId = selectActiveScope(s);
    const path = primitivePathFromSpec(spec); // stage frame
    if (path.nodes.length < 2) return;
    const box = pathBounds(path);
    // Normalize like addVectorPath; store the spec in the SAME local frame so a later
    // re-edit regenerates around the same centre (base + (cx,cy) stays put).
    const normalized: PathData = {
      closed: path.closed,
      nodes: path.nodes.map((n) => ({
        anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
        ...(n.in ? { in: n.in } : {}),
        ...(n.out ? { out: n.out } : {}),
      })),
    };
    const local: PrimitiveSpec = { ...spec, cx: spec.cx - box.x, cy: spec.cy - box.y };
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE }, primitive: local });
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
    });
    get().commit(appendObjectToScene(project, activeId, asset, obj));
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null, activeTool: 'node' });
  },
  setPrimitiveParam(param, value) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    const asset = obj ? project.assets.find((a) => a.id === obj.assetId) : undefined;
    if (!asset || asset.kind !== 'vector' || !asset.primitive) return;
    // Guard kind-specific params so a mismatched call can't write a stale field
    // (e.g. 'sides' onto a star). cornerRadius applies to both kinds.
    if (param === 'sides' && asset.primitive.kind !== 'polygon') return;
    if ((param === 'points' || param === 'innerRatio') && asset.primitive.kind !== 'star') return;
    const clamped =
      param === 'sides'
        ? Math.max(3, Math.floor(value))
        : param === 'points'
          ? Math.max(2, Math.floor(value))
          : param === 'innerRatio'
            ? Math.min(0.99, Math.max(0.01, value))
            : Math.max(0, value); // cornerRadius
    const next: PrimitiveSpec = { ...asset.primitive, [param]: clamped };
    const nextAsset: VectorAsset = { ...asset, primitive: next, path: primitivePathFromSpec(next) };
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? nextAsset : a)) });
  },
  setPathData(path, structural) {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj, asset } = ctx;
    // Route to a shape keyframe at the playhead once a morph track exists; otherwise
    // edit the static base (Slice 2 behavior). "Add shape keyframe" is the opt-in.
    if (obj.shapeTrack && obj.shapeTrack.length > 0) {
      const time = snapToFrame(s.time, project.meta.fps);
      const existing = obj.shapeTrack.find((k) => Math.abs(k.time - time) < KF_EPS);
      // Preserve the existing keyframe's fields; only replace the path (and realign
      // nodeEasings on a structural count change). New keyframes default to linear.
      const nodeEasings = structural
        ? spliceNodeEasings(existing?.nodeEasings, structural.index, structural.op)
        : existing?.nodeEasings;
      const correspondence = structural
        ? spliceCorrespondence(existing?.correspondence, structural.index, structural.op)
        : existing?.correspondence;
      const merged: ShapeKeyframe = existing
        ? { ...existing, path, nodeEasings, correspondence }
        : { time, path, easing: 'linear' };
      const shapeTrack = upsertShapeKeyframe(obj.shapeTrack, merged);
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack }));
    } else {
      // A node edit detaches any parametric primitive spec — it becomes a free path.
      const next = { ...asset, path, primitive: undefined };
      get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
    }
  },
  setRingPathData(ring, path, structural) {
    // Ring 0 = primary path: reuse setPathData (morph-aware, primitive-detach). Rings >=1
    // are static boolean compoundRings: write the addressed ring directly (no shapeTrack).
    if (ring === 0) {
      get().setPathData(path, structural);
      return;
    }
    const s = get();
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { asset } = ctx;
    const rings = (asset.compoundRings ?? []).slice();
    const k = ring - 1;
    if (k >= rings.length) return; // ring >= 1 guaranteed above, so k >= 0
    rings[k] = path;
    const next = { ...asset, compoundRings: rings };
    const project = s.history.present;
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
  },
  addShapeKeyframe() {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj } = ctx;
    const time = snapToFrame(s.time, project.meta.fps);
    // Seed from the shape currently shown/edited (shared resolver), so the keyframe
    // captures exactly what the overlay displays.
    const current = selectEditablePath(s) ?? { nodes: [], closed: false };
    const shapeTrack = upsertShapeKeyframe(obj.shapeTrack ?? [], { time, path: current, easing: 'linear' });
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack }));
  },
  removeShapeKeyframe() {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj, asset } = ctx;
    const track = obj.shapeTrack;
    if (!track || track.length === 0) return;
    const time =
      s.selectedShapeKeyframe && s.selectedShapeKeyframe.objectId === obj.id
        ? s.selectedShapeKeyframe.time
        : snapToFrame(s.time, project.meta.fps);
    const remaining = removeShapeKeyframeAt(track, time);
    if (remaining.length === track.length) {
      // Nothing at that time (e.g. a stale selection after undo) — clear it so the
      // timeline stops highlighting a keyframe that no longer matches.
      if (s.selectedShapeKeyframe) set({ selectedShapeKeyframe: null });
      return;
    }
    if (remaining.length === 0) {
      // Write the currently-shown shape back into the base so it does not jump.
      const snapshot = samplePath(track, time);
      const nextAsset = { ...asset, path: snapshot };
      const withAsset = { ...project, assets: project.assets.map((a) => (a.id === asset.id ? nextAsset : a)) };
      get().commit(replaceObjectInScene(withAsset, selectActiveScope(s), { ...obj, shapeTrack: undefined }));
    } else {
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack: remaining }));
    }
    set({ selectedShapeKeyframe: null });
  },
  removeSelectedColorKeyframe() {
    const s = get();
    const ref = s.selectedColorKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    const track = obj?.colorTracks?.[ref.property];
    if (!obj || !track) return;
    const next = removeColorKeyframeAt(track, ref.time);
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, colorTracks: { ...obj.colorTracks, [ref.property]: next } }));
    set({ selectedColorKeyframe: null });
  },
  selectGradientKeyframe(ref) {
    set({
      ...NO_KEYFRAME_SELECTION,
      selectedGradientKeyframe: ref,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  removeSelectedGradientKeyframe() {
    const s = get();
    const ref = s.selectedGradientKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    const track = obj?.gradientTracks?.[ref.property];
    if (!obj || !track) return;
    const next = removeGradientKeyframeAt(track, ref.time);
    // Collapse an emptied track to absent so the static gradient takes over again
    // (matches setVectorGradient's clear-both branch and the spec's track-absence rule).
    const gradientTracks = { ...obj.gradientTracks, [ref.property]: next };
    if (next.length === 0) delete gradientTracks[ref.property];
    get().commit(
      replaceObjectInScene(project, selectActiveScope(s), {
        ...obj,
        gradientTracks: Object.keys(gradientTracks).length > 0 ? gradientTracks : undefined,
      }),
    );
    set({ selectedGradientKeyframe: null });
  },
  setStrokeDasharray(dasharray) {
    if (dasharray !== undefined) {
      get().setVectorStyle({ strokeDasharray: dasharray });
      return;
    }
    // Clearing the dash also clears the (now-meaningless) offset animation, so an
    // orphan dashOffsetTrack can't keep inflating computeProjectDuration.
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const withAssets = {
      ...project,
      assets: project.assets.map((a) =>
        a.id === asset.id ? { ...asset, style: { ...asset.style, strokeDasharray: undefined } } : a,
      ),
    };
    get().commit(replaceObjectInScene(withAssets, selectActiveScope(s), { ...obj, dashOffsetTrack: undefined }));
    set({ selectedDashKeyframe: null });
  },
  setStrokeDashoffset(value) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    if (!s.autoKey) {
      get().setVectorStyle({ strokeDashoffset: value });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const existing = obj.dashOffsetTrack ?? [];
    // Preserve an existing keyframe's easing so editing the offset doesn't reset it.
    const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
    const next = upsertKeyframe(existing, createKeyframe(time, value, { easing: priorEasing }));
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, dashOffsetTrack: next }));
  },
  drawOn() {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const t0 = snapToFrame(s.time, project.meta.fps);
    const t1 = snapToFrame(s.time + 1, project.meta.fps);
    // Atomic: dasharray on the asset (global) + the 1->0 offset track on the object (scene-local).
    const nextAssets = project.assets.map((a) =>
      a.id === asset.id ? { ...asset, style: { ...asset.style, strokeDasharray: [1, 1] } } : a,
    );
    const dashOffsetTrack = [createKeyframe(t0, 1), createKeyframe(t1, 0)];
    const withAssets = { ...project, assets: nextAssets };
    get().commit(replaceObjectInScene(withAssets, selectActiveScope(s), { ...obj, dashOffsetTrack }));
  },
  selectDashKeyframe(ref) {
    set({
      ...NO_KEYFRAME_SELECTION,
      selectedDashKeyframe: ref,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  removeSelectedDashKeyframe() {
    const s = get();
    const ref = s.selectedDashKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.dashOffsetTrack) return;
    const next = removeKeyframeAt(obj.dashOffsetTrack, ref.time);
    get().commit(
      replaceObjectInScene(project, selectActiveScope(s), { ...obj, dashOffsetTrack: next.length > 0 ? next : undefined }),
    );
    set({ selectedDashKeyframe: null });
  },
  selectRemapKeyframe(ref) {
    set({
      ...NO_KEYFRAME_SELECTION,
      selectedRemapKeyframe: ref,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  removeSelectedRemapKeyframe() {
    const s = get();
    const ref = s.selectedRemapKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.symbolTimeTrack) return;
    const next = removeKeyframeAt(obj.symbolTimeTrack, ref.time);
    get().commit(
      replaceObjectInScene(project, selectActiveScope(s), { ...obj, symbolTimeTrack: next.length > 0 ? next : undefined }),
    );
    set({ selectedRemapKeyframe: null });
  },
  addMotionPath(objectId, path) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === objectId);
    if (!obj) return;
    const t0 = snapToFrame(s.time, project.meta.fps);
    const t1 = snapToFrame(s.time + 1, project.meta.fps);
    const progress = [createKeyframe(t0, 0), createKeyframe(t1, 1)];
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, motionPath: { path, orient: false, progress } }));
  },
  removeMotionPath(objectId) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, motionPath: undefined }));
  },
  setMotionPathOrient(objectId, orient) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, motionPath: { ...obj.motionPath, orient } }));
  },
  setMotionProgress(value) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj?.motionPath || !s.autoKey) return;
    const time = snapToFrame(s.time, project.meta.fps);
    const progress = upsertKeyframe(obj.motionPath.progress, createKeyframe(time, value));
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, motionPath: { ...obj.motionPath, progress } }));
  },
  selectProgressKeyframe(ref) {
    set({
      ...NO_KEYFRAME_SELECTION,
      selectedProgressKeyframe: ref,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  removeSelectedProgressKeyframe() {
    const s = get();
    const ref = s.selectedProgressKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.motionPath) return;
    const progress = removeKeyframeAt(obj.motionPath.progress, ref.time);
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, motionPath: { ...obj.motionPath, progress } }));
    set({ selectedProgressKeyframe: null });
  },
  selectShapeKeyframe(ref) {
    set({
      ...NO_KEYFRAME_SELECTION,
      selectedShapeKeyframe: ref,
      // Selecting a keyframe focuses its object; clear any stale node selection
      // (consistent with selectObject), since it may belong to a different object.
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId], selectedNodeIndex: null } : {}),
    });
  },
  selectColorKeyframe(ref) {
    set({
      ...NO_KEYFRAME_SELECTION,
      selectedColorKeyframe: ref,
      selectedNodeIndex: null,
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId] } : {}),
    });
  },
  deleteSelectedNode() {
    const s = get();
    const idx = s.selectedNodeIndex;
    if (idx == null) return;
    const path = selectActiveRingPath(s);
    if (!path) return;
    const next = deleteNodeAt(path, idx);
    if (next === path) return; // 2-node floor: nothing removed -> don't desync nodeEasings or commit a no-op
    get().setRingPathData(s.selectedNodeRing, next, { index: idx, op: 'delete' });
    set({ selectedNodeIndex: null });
  },
  insertNode(ring, segmentIndex, t) {
    const s = get();
    const path = selectEditableRings(s)[ring];
    if (!path) return;
    get().setRingPathData(ring, insertNodeAt(path, segmentIndex, t), { index: segmentIndex + 1, op: 'insert' });
    set({ selectedNodeIndex: segmentIndex + 1, selectedNodeRing: ring });
  },
  toggleSelectedNodeSmooth() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const path = selectActiveRingPath(s);
    if (!path) return;
    get().setRingPathData(s.selectedNodeRing, toggleSmooth(path, s.selectedNodeIndex));
  },
  joinSelectedNode() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const path = selectActiveRingPath(s);
    if (!path) return;
    get().setRingPathData(s.selectedNodeRing, joinHandle(path, s.selectedNodeIndex));
  },
  breakSelectedNode() {
    // Handles are independent in the data model; "break" makes future handle drags
    // non-mirrored. The mirror choice is decided at drag time by handle collinearity
    // (see usePathTools), so no path mutation is needed here.
  },
  selectNode(index, ring = 0) {
    set({ selectedNodeIndex: index, selectedNodeRing: ring });
  },
  selectObject(id) {
    set({ selectedObjectId: id, selectedObjectIds: id ? [id] : [], ...NO_KEYFRAME_SELECTION, selectedNodeIndex: null });
  },
  toggleObjectSelection(id) {
    const ids = get().selectedObjectIds;
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    set({ selectedObjectIds: next, selectedObjectId: next.at(-1) ?? null, ...NO_KEYFRAME_SELECTION, selectedNodeIndex: null });
  },
  selectObjects(ids) {
    set({ selectedObjectIds: [...ids], selectedObjectId: ids.at(-1) ?? null, ...NO_KEYFRAME_SELECTION, selectedNodeIndex: null });
  },

  // Grouping, nested symbols, asset library & boolean ops (./slices/groupSymbolSlice).
  ...createGroupSymbolSlice(set, get),

  setProperty(property, value) {
    get().setProperties({ [property]: value });
  },
  setProperties(updates) {
    const s = get();
    const objects = selectActiveObjects(s); // root, or the symbol scene in edit mode (slice 47 edit-mode)
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj || lockedInScene(objects, obj)) return; // lock cascades from a parent group
    if (!obj.isGroup && !s.autoKey) return; // normal objects edit through keyframes (auto-key); a group: keyframe when auto-key on, base when off (45d)
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    get().commitActiveScene(objects.map((o) => (o.id === obj.id ? applyObjectTransform(obj, updates, time, s.autoKey) : o)));
  },
  setSymbolTiming(partial) {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const cur = obj.symbolTime ?? { startOffset: 0, loop: false, speed: 1 };
    const pc = partial.playCount !== undefined ? Math.max(0, Math.floor(partial.playCount)) : cur.playCount;
    const ph = partial.phase !== undefined ? Math.max(0, partial.phase) : cur.phase;
    const next: SymbolTiming = {
      startOffset: Math.max(0, partial.startOffset ?? cur.startOffset),
      loop: partial.loop ?? cur.loop,
      speed: Math.max(1e-3, partial.speed ?? cur.speed),
      // Only carry pingPong when truthy so the field stays absent by default (set false turns it off,
      // since `false ?? cur` is false); keeps existing symbolTime objects byte-clean.
      ...((partial.pingPong ?? cur.pingPong) ? { pingPong: true } : {}),
      // Only carry playCount when > 0 so the field stays absent by default (0 clears -> loop forever).
      ...(pc && pc > 0 ? { playCount: pc } : {}),
      // Only carry phase when > 0 so the field stays absent by default (0 clears -> start at frame 0).
      ...(ph && ph > 0 ? { phase: ph } : {}),
    };
    get().commitActiveScene(objects.map((o) => (o.id === obj.id ? { ...o, symbolTime: next } : o)));
  },
  toggleSymbolTimeRemap() {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    let next: SceneObject;
    if (obj.symbolTimeTrack && obj.symbolTimeTrack.length > 0) {
      next = { ...obj };
      delete next.symbolTimeTrack; // disable -> back to the constant remap (or identity)
    } else {
      const asset = s.history.present.assets.find((a) => a.id === obj.assetId);
      const d = asset && asset.kind === 'symbol' ? symbolEffectiveDuration(asset) : 0;
      const track = d > 0 ? [createKeyframe(0, 0), createKeyframe(d, d)] : [createKeyframe(0, 0)];
      next = { ...obj, symbolTimeTrack: track };
    }
    get().commit(replaceObjectInScene(s.history.present, selectActiveScope(s), next));
  },
  setSymbolTimeRemap(value) {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const t = snapToFrame(s.time, s.history.present.meta.fps);
    const track = upsertKeyframe(obj.symbolTimeTrack ?? [], createKeyframe(t, value));
    get().commit(replaceObjectInScene(s.history.present, selectActiveScope(s), { ...obj, symbolTimeTrack: track }));
  },
  setSymbolDuration(symId, duration) {
    const s = get();
    const project = s.history.present;
    const sym = project.assets.find((a) => a.id === symId);
    if (!sym || sym.kind !== 'symbol') return;
    const d = Math.max(0, duration); // 0 = auto/intrinsic; negatives clamp to 0
    if (sym.duration === d) return; // no-op -> no spurious commit
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === symId ? { ...a, duration: d } : a)) });
  },
  setSymbolClip(symId, clip) {
    const s = get();
    const project = s.history.present;
    const sym = project.assets.find((a) => a.id === symId);
    if (!sym || sym.kind !== 'symbol') return;
    if ((sym.clip ?? false) === clip) return; // no-op -> no spurious commit
    // When disabling, set clip to undefined (JSON.stringify omits undefined-valued properties,
    // so the serialized project is byte-identical to one that never had the field).
    const next = clip ? { ...sym, clip: true as const } : { ...sym, clip: undefined };
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === symId ? next : a)) });
  },
  setInstanceFreeze(freeze) {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    // Clear the field entirely when false (keep serialized JSON byte-clean).
    const next: SceneObject = freeze
      ? { ...obj, freezeFirstFrame: true }
      : { ...obj, freezeFirstFrame: undefined };
    get().commit(replaceObjectInScene(s.history.present, selectActiveScope(s), next));
  },
  setInstanceTint(tint) {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    // Clear the field entirely when undefined (keep serialized JSON byte-clean).
    const next: SceneObject = tint !== undefined
      ? { ...obj, tint }
      : { ...obj, tint: undefined };
    get().commit(replaceObjectInScene(s.history.present, selectActiveScope(s), next));
  },
  setAnchor(anchorX, anchorY) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, anchorX, anchorY }));
  },
  setVectorStyle(updates) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const next = { ...asset, style: { ...asset.style, ...updates } };
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
  },
  setVectorGradient(property, gradient) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const styleKey = property === 'fill' ? 'fillGradient' : 'strokeGradient';

    if (gradient === undefined) {
      // Switch to solid paint: clear BOTH the static gradient (asset) and any animated track (object).
      const nextStyle = { ...asset.style, [styleKey]: undefined };
      const withAssets = {
        ...project,
        assets: project.assets.map((a) => (a.id === asset.id ? { ...asset, style: nextStyle } : a)),
      };
      const gradientTracks = { ...obj.gradientTracks };
      delete gradientTracks[property];
      const nextObj = {
        ...obj,
        gradientTracks: Object.keys(gradientTracks).length > 0 ? gradientTracks : undefined,
      };
      get().commit(replaceObjectInScene(withAssets, selectActiveScope(s), nextObj));
      set({ selectedGradientKeyframe: null });
      return;
    }

    if (!s.autoKey) {
      get().setVectorStyle({ [styleKey]: gradient });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const existing = obj.gradientTracks?.[property] ?? [];
    // Preserve the easing already on a keyframe at this time: a stop edit fires
    // setVectorGradient on every change, and hardcoding 'linear' would silently
    // wipe an easing the user set via the EasingEditor.
    const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
    const next = upsertGradientKeyframe(existing, { time, gradient, easing: priorEasing });
    const gradientTracks = { ...obj.gradientTracks, [property]: next };
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, gradientTracks }));
  },
  setVectorColor(property, value) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    if (!s.autoKey) {
      get().setVectorStyle({ [property]: value });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const next = upsertColorKeyframe(obj.colorTracks?.[property] ?? [], { time, value, easing: 'linear' });
    const colorTracks = { ...obj.colorTracks, [property]: next };
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, colorTracks }));
  },
  nudgeSelected(dx, dy) {
    if (!dx && !dy) return;
    const s = get();
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    // Move EVERY selected non-locked object by (dx,dy) in a SINGLE commit (slice 37). A
    // a group keyframes when auto-key is on (animatable, 45d), else writes base; a normal
    // object keyframes at the playhead (needs auto-key). Writes the ACTIVE scene (edit mode).
    let objects = selectActiveObjects(s);
    const nudgeLockById = new Map(objects.map((o) => [o.id, o])); // lock topology is loop-invariant
    let changed = false;
    for (const id of s.selectedObjectIds) {
      const obj = objects.find((o) => o.id === id);
      if (!obj || isLockedInTree(obj, nudgeLockById)) continue; // lock cascades from a parent group
      if (!obj.isGroup && !s.autoKey) continue;
      const state = sampleObject(obj, time);
      const partial: Partial<Record<AnimatableProperty, number>> = {};
      if (dx) partial.x = state.x + dx;
      if (dy) partial.y = state.y + dy;
      objects = objects.map((o) => (o.id === id ? applyObjectTransform(obj, partial, time, s.autoKey) : o));
      changed = true;
    }
    if (changed) get().commitActiveScene(objects);
  },
  setObjectsTransforms(updates) {
    const s = get();
    if (updates.length === 0) return;
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    // Write x/y/scaleX/scaleY/rotation for several objects in ONE commit (group transform;
    // slice 40/41). A group keyframes when auto-key is on (45d), else writes base; a normal
    // object keyframes (needs auto-key). Writes the ACTIVE scene (edit mode).
    let objects = selectActiveObjects(s);
    const xfLockById = new Map(objects.map((o) => [o.id, o])); // lock topology is loop-invariant
    let changed = false;
    for (const u of updates) {
      const obj = objects.find((o) => o.id === u.id);
      if (!obj || isLockedInTree(obj, xfLockById)) continue; // lock cascades from a parent group
      if (!obj.isGroup && !s.autoKey) continue;
      const partial: Partial<Record<AnimatableProperty, number>> = {};
      if (u.x !== undefined) partial.x = u.x;
      if (u.y !== undefined) partial.y = u.y;
      if (u.scaleX !== undefined) partial.scaleX = u.scaleX;
      if (u.scaleY !== undefined) partial.scaleY = u.scaleY;
      if (u.rotation !== undefined) partial.rotation = u.rotation;
      objects = objects.map((o) => (o.id === u.id ? applyObjectTransform(obj, partial, time, s.autoKey) : o));
      changed = true;
    }
    if (changed) get().commitActiveScene(objects);
  },
  alignSelected(edge) {
    const updates = alignItemsUpdates(get(), (items) => computeAlign(items, edge));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  distributeSelected(axis) {
    const updates = alignItemsUpdates(get(), (items) => computeDistribute(items, axis));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  distributeCentersSelected(axis) {
    const updates = alignItemsUpdates(get(), (items) => computeDistributeCenters(items, axis));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  distributeSpacingSelected(axis, gap) {
    const updates = alignItemsUpdates(get(), (items) => computeDistributeSpacing(items, axis, gap));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  centerOnCanvas() {
    const { width, height } = activeSceneDims(get());
    const updates = alignItemsUpdates(get(), (items) => computeCenterOnFrame(items, width, height));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  alignToCanvas(edge) {
    const { width, height } = activeSceneDims(get());
    const updates = alignItemsUpdates(get(), (items) => computeAlignToFrame(items, edge, width, height));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  selectKeyframe(ref) {
    set({
      ...NO_KEYFRAME_SELECTION,
      selectedKeyframe: ref,
      // See selectShapeKeyframe: focus the keyframe's object, drop stale node selection.
      ...(ref ? { selectedObjectId: ref.objectId, selectedObjectIds: [ref.objectId], selectedNodeIndex: null } : {}),
    });
  },
  removeSelectedKeyframe() {
    const s = get();
    const ref = s.selectedKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj) return;
    const track = obj.tracks[ref.property] ?? [];
    const next = removeKeyframeAt(track, ref.time);
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, tracks: { ...obj.tracks, [ref.property]: next } }));
    set({ selectedKeyframe: null });
  },
  setSelectedKeyframeEasing(easing) {
    const s = get();
    const project = s.history.present;
    if (s.selectedProgressKeyframe) {
      const ref = s.selectedProgressKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
      if (!obj?.motionPath) return;
      const progress = obj.motionPath.progress.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, motionPath: { ...obj.motionPath, progress } }));
      return;
    }
    if (s.selectedColorKeyframe) {
      const ref = s.selectedColorKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
      const track = obj?.colorTracks?.[ref.property];
      if (!obj || !track) return;
      const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k));
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, colorTracks: { ...obj.colorTracks, [ref.property]: next } }));
      return;
    }
    if (s.selectedGradientKeyframe) {
      const ref = s.selectedGradientKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
      const track = obj?.gradientTracks?.[ref.property];
      if (!obj || !track) return;
      const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k));
      get().commit(
        replaceObjectInScene(project, selectActiveScope(s), { ...obj, gradientTracks: { ...obj.gradientTracks, [ref.property]: next } }),
      );
      return;
    }
    if (s.selectedDashKeyframe) {
      const ref = s.selectedDashKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
      if (!obj?.dashOffsetTrack) return;
      const next = obj.dashOffsetTrack.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, dashOffsetTrack: next }));
      return;
    }
    if (s.selectedRemapKeyframe) {
      const ref = s.selectedRemapKeyframe;
      const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
      if (!obj?.symbolTimeTrack) return;
      const next = obj.symbolTimeTrack.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, symbolTimeTrack: next }));
      return;
    }
    if (s.selectedShapeKeyframe) {
      const ref = s.selectedShapeKeyframe;
      // Every branch of this function routes to the active scene (the shape branch since phase 9;
      // the progress/scalar/color/gradient/dash branches since the in-symbol timeline-keyframe slice).
      const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
      if (!obj?.shapeTrack) return;
      const shapeTrack = obj.shapeTrack.map((k) =>
        Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack }));
      return;
    }
    const ref = s.selectedKeyframe;
    if (!ref) return;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    const track = obj?.tracks[ref.property];
    if (!obj || !track) return;
    const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, easing } : k));
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, tracks: { ...obj.tracks, [ref.property]: next } }));
  },
  setSelectedKeyframeRotationMode(mode) {
    const s = get();
    const ref = s.selectedKeyframe;
    if (!ref || ref.property !== 'rotation') return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    const track = obj?.tracks.rotation;
    if (!obj || !track) return;
    const next = track.map((k) => (Math.abs(k.time - ref.time) < KF_EPS ? { ...k, rotationMode: mode } : k));
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, tracks: { ...obj.tracks, rotation: next } }));
  },
  setSelectedShapeKeyframeMorph(mode) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, morph: mode } : k,
    );
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack }));
  },
  setSelectedShapeKeyframeCorrespondence(correspondence) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, correspondence } : k,
    );
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack }));
  },
  setSelectedNodeEasing(easing) {
    const s = get();
    if (s.selectedNodeRing !== 0) return; // compound rings have no per-node easings
    const idx = s.selectedNodeIndex;
    if (idx == null) return;
    const edited = selectEditedShapeKeyframe(s);
    if (!edited || idx >= edited.kf.path.nodes.length) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj?.shapeTrack) return;
    const arr = (edited.kf.nodeEasings ?? []).slice();
    arr[idx] = easing as Easing;
    const nodeEasings = arr.some((e) => e != null) ? arr : undefined;
    const shapeTrack = obj.shapeTrack.map((k, i) => (i === edited.index ? { ...k, nodeEasings } : k));
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack }));
  },
  enterCorrespondenceEdit() {
    set({ correspondenceEditing: true });
  },
  exitCorrespondenceEdit() {
    set({ correspondenceEditing: false });
  },
  setCorrespondenceLink(aIndex, bIndex) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const idx = obj.shapeTrack.findIndex((k) => Math.abs(k.time - ref.time) < KF_EPS);
    if (idx < 0 || idx >= obj.shapeTrack.length - 1) return;
    const from = obj.shapeTrack[idx].path;
    const to = obj.shapeTrack[idx + 1].path;
    if (aIndex < 0 || aIndex >= from.nodes.length || bIndex < 0 || bIndex >= to.nodes.length) return;
    const cur =
      obj.shapeTrack[idx].correspondence ??
      identityCorrespondence(from.nodes.length, to.nodes.length);
    const next = cur.slice();
    next[aIndex] = bIndex;
    const shapeTrack = obj.shapeTrack.map((k, i) =>
      i === idx ? { ...k, correspondence: next } : k,
    );
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, shapeTrack }));
  },
  addAudioClip(assetId) {
    const project = get().history.present;
    const clip = { id: newId(), assetId, startTime: get().time, inPoint: 0, outPoint: 0, volume: 1 };
    get().commit({ ...project, audioClips: [...project.audioClips, clip] });
  },

  // Scene lifecycle actions (./slices/scenesSlice).
  ...createScenesSlice(set, get),

  // Transport, view & tool preferences, and toasts (./slices/transportPrefsSlice).
  ...createTransportPrefsSlice(set, get),
}));
