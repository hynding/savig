import type { EditorState } from '@savig/editor-state';
import type { SceneObject } from '@savig/engine';

export interface GettingStartedItem {
  id: string;
  label: string;
  done: boolean;
}
export interface GettingStartedVM {
  items: GettingStartedItem[];
  doneCount: number;
  total: number;
  allDone: boolean;
}

/** True when the object carries at least one keyframe on any animatable track. */
function hasKeyframe(o: SceneObject): boolean {
  if (Object.values(o.tracks).some((t) => t && t.length > 0)) return true;
  if (o.shapeTrack && o.shapeTrack.length > 0) return true;
  if (o.dashOffsetTrack && o.dashOffsetTrack.length > 0) return true;
  if (o.symbolTimeTrack && o.symbolTimeTrack.length > 0) return true;
  if (o.colorTracks && Object.values(o.colorTracks).some((t) => t && t.length > 0)) return true;
  if (o.gradientTracks && Object.values(o.gradientTracks).some((t) => t && t.length > 0)) return true;
  if (o.motionPath && o.motionPath.progress.length > 0) return true;
  return false;
}

/** The first-run checklist: each milestone is derived purely from the current document, so the card
 *  checks items off live as the user works. Objects are unioned across ALL scenes (a multi-scene
 *  project keeps `objects` empty and holds shapes in `scenes[].objects`), so milestones don't blank
 *  out when the user adds a scene. */
export function gettingStartedViewModel(s: EditorState): GettingStartedVM {
  const project = s.history.present;
  const objects = project.scenes ? project.scenes.flatMap((sc) => sc.objects) : project.objects;
  const shapes = objects.filter((o) => !o.isGroup); // a group container is not itself a "shape"
  const items: GettingStartedItem[] = [
    { id: 'draw', label: 'Draw a shape', done: shapes.length >= 1 },
    { id: 'animate', label: 'Animate it (add a keyframe)', done: objects.some(hasKeyframe) },
    { id: 'second', label: 'Add a second shape', done: shapes.length >= 2 },
    {
      id: 'reuse',
      label: 'Group shapes or make a symbol',
      done: objects.some((o) => o.isGroup) || project.assets.some((a) => a.kind === 'symbol'),
    },
  ];
  const doneCount = items.filter((i) => i.done).length;
  return { items, doneCount, total: items.length, allDone: doneCount === items.length };
}
