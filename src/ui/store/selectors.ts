import { computeProjectDuration, samplePath } from '../../engine';
import type { PathData, Project, SceneObject } from '../../engine';
import type { EditorState } from './store';

export const selectProject = (s: EditorState): Project => s.history.present;

export const selectDuration = (s: EditorState): number =>
  computeProjectDuration(s.history.present);

export const selectSelectedObject = (s: EditorState): SceneObject | null =>
  s.history.present.objects.find((o) => o.id === s.selectedObjectId) ?? null;

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
  const obj = project.objects.find((o) => o.id === s.selectedObjectId);
  if (!obj) return null;
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    return samplePath(obj.shapeTrack, s.time);
  }
  return asset.path ?? null;
}
