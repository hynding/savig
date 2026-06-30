import { computeProjectDuration, samplePath, snapToFrame } from '../../engine';
import type { Camera, PathData, Project, SceneObject, ShapeKeyframe } from '../../engine';
import type { EditorState, SceneScope } from './store-internals';

/** The duration the editor transport/playback spans: the SELECTED scene's duration in multi-scene
 *  (per-scene local time model), else the single-scene project duration. */
export function selectEditDuration(s: EditorState): number {
  const present = s.history.present;
  if (present.scenes) {
    const id = selectActiveSceneId(s);
    return present.scenes.find((sc) => sc.id === id)?.duration ?? 0;
  }
  return computeProjectDuration(present);
}

const EDITED_KF_EPS = 1e-6;

// The shape keyframe whose time matches the snapped playhead (the one node edits target),
// with its index in the track — or null when the playhead is not on a keyframe.
export function selectEditedShapeKeyframe(s: EditorState): { kf: ShapeKeyframe; index: number } | null {
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
  if (!obj?.shapeTrack || obj.shapeTrack.length === 0) return null;
  const t = snapToFrame(s.time, s.history.present.meta.fps);
  const index = obj.shapeTrack.findIndex((k) => Math.abs(k.time - t) < EDITED_KF_EPS);
  return index >= 0 ? { kf: obj.shapeTrack[index], index } : null;
}

export const selectProject = (s: EditorState): Project => s.history.present;

export const selectDuration = (s: EditorState): number =>
  computeProjectDuration(s.history.present);

// --- Symbol edit mode (the "active scene") ---------------------------------------------------
// A symbol is a GLOBAL asset, so the scene being edited is one flat array: the root
// project.objects, or one SymbolAsset.objects. editPath's LAST entry is the write target; earlier
// entries are breadcrumb context. A missing active asset (e.g. after an undo) falls back to root.

export function selectActiveAssetId(s: EditorState): string | null {
  return s.editPath.at(-1) ?? null;
}

/** The selected scene id in multi-scene mode (defaulting to scene 0 when `selectedSceneId` is
 *  null or stale), or null for single-scene projects. */
export function selectActiveSceneId(s: EditorState): string | null {
  const scenes = s.history.present.scenes;
  if (!scenes) return null;
  return scenes.some((sc) => sc.id === s.selectedSceneId) ? s.selectedSceneId : (scenes[0]?.id ?? null);
}

export function selectActiveScope(s: EditorState): SceneScope {
  return { sceneId: selectActiveSceneId(s), assetId: selectActiveAssetId(s) };
}

/** The camera governing the active edit view: the selected scene's camera at the scene base,
 *  else the project camera (parity: single-scene & symbol-edit keep project.camera). */
export function selectActiveSceneCamera(s: EditorState): Camera | undefined {
  const present = s.history.present;
  if (selectActiveAssetId(s) == null && present.scenes) {
    const id = selectActiveSceneId(s);
    return present.scenes.find((sc) => sc.id === id)?.camera;
  }
  return present.camera;
}

export function selectActiveObjects(s: EditorState): SceneObject[] {
  const present = s.history.present;
  const assetId = selectActiveAssetId(s);
  if (assetId) {
    const a = present.assets.find((x) => x.id === assetId);
    if (a && a.kind === 'symbol') return a.objects; // symbol axis (project-global, scene-independent)
  }
  if (present.scenes) {
    const id = selectActiveSceneId(s);
    const sc = present.scenes.find((x) => x.id === id);
    if (sc) return sc.objects; // scene base
  }
  return present.objects; // single-scene root (parity) / missing-asset fallback
}

// Focused project for the active edit view. Single-scene root => the SAME present ref (no
// spurious rerender, parity). A focused sub-scene (symbol or scene) => a single-scene VIEW:
// objects swapped, scenes stripped, camera resolved — so the render/compute path samples THESE
// objects at the local `time` (mirrors 8b-1b's computeFrameForScene scene-view).
export function selectEditProject(s: EditorState): Project {
  const present = s.history.present;
  const objs = selectActiveObjects(s);
  if (objs === present.objects) return present;
  return { ...present, objects: objs, camera: selectActiveSceneCamera(s), scenes: undefined };
}

export const selectSelectedObject = (s: EditorState): SceneObject | null =>
  selectActiveObjects(s).find((o) => o.id === s.selectedObjectId) ?? null;

// The path currently being edited at the playhead: the sampled morph shape when
// the object has a shapeTrack, else the static base (asset.path). The single
// resolver shared by the store's node-edit actions, addShapeKeyframe, the Stage
// node overlay, and usePathTools — so all four agree on the shape being edited.
//
// Samples at the RAW `time` (not snapToFrame): the canvas paints the morph at raw
// time via computeFrame, so the overlay/seed must use the same time or the node
// handles would float off the rendered curve at sub-frame times. Keyframe-commit
// times are still frame-snapped by the store actions.
export function selectEditablePath(s: EditorState): PathData | null {
  const project = s.history.present;
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
  if (!obj) return null;
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    return samplePath(obj.shapeTrack, s.time);
  }
  return asset.path ?? null;
}

// All editable rings of the selected path: ring 0 = the primary (morph-sampled) path,
// rings >=1 = the asset's static compoundRings (boolean-result holes / disjoint pieces).
// [] when there is no editable primary; non-boolean paths return just [primary].
export function selectEditableRings(s: EditorState): PathData[] {
  const primary = selectEditablePath(s);
  if (!primary) return [];
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
  const asset = s.history.present.assets.find((a) => a.id === obj?.assetId);
  const rings = asset && asset.kind === 'vector' ? asset.compoundRings ?? [] : [];
  return [primary, ...rings];
}

// The ring currently addressed by `selectedNodeRing`, or null.
export function selectActiveRingPath(s: EditorState): PathData | null {
  const rings = selectEditableRings(s);
  return rings[s.selectedNodeRing] ?? null;
}
