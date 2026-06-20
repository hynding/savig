import { computeProjectDuration } from '../../engine';
import type { Project, SceneObject } from '../../engine';
import type { EditorState } from './store';

export const selectProject = (s: EditorState): Project => s.history.present;

export const selectDuration = (s: EditorState): number =>
  computeProjectDuration(s.history.present);

export const selectSelectedObject = (s: EditorState): SceneObject | null =>
  s.history.present.objects.find((o) => o.id === s.selectedObjectId) ?? null;
