import { computeProjectDuration, samplePath, snapToFrame } from '../../engine';
import type { PathData, Project, SceneObject } from '../../engine';
import type { EditorState } from './store';

export const selectProject = (s: EditorState): Project => s.history.present;

export const selectDuration = (s: EditorState): number =>
  computeProjectDuration(s.history.present);

export const selectSelectedObject = (s: EditorState): SceneObject | null =>
  s.history.present.objects.find((o) => o.id === s.selectedObjectId) ?? null;

// The path currently being edited at the playhead: the sampled morph shape when
// the object has a shapeTrack, else the static base (asset.path). Used by the
// store's node-edit actions and the Stage node overlay so editing follows the
// shape shown at the current time.
export function selectEditablePath(s: EditorState): PathData | null {
  const project = s.history.present;
  const obj = project.objects.find((o) => o.id === s.selectedObjectId);
  if (!obj) return null;
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    return samplePath(obj.shapeTrack, snapToFrame(s.time, project.meta.fps));
  }
  return asset.path ?? null;
}
