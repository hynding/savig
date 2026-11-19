// Button symbols (spec 2026-11-19-button-symbols): the pure rules shared by the scene walker
// (`flattenInstances`), the interactive session and the authoring surfaces.
import type { Asset, ButtonState, Project, SceneObject } from './types';
import { projectScenes } from './scenes';

/** The states an object inside a button symbol shows in when it carries no `buttonStates`. */
export const DEFAULT_BUTTON_STATES: readonly ButtonState[] = ['up', 'over', 'down'];

export const BUTTON_STATES: readonly ButtonState[] = ['up', 'over', 'down', 'hit'];

export function isButtonState(v: unknown): v is ButtonState {
  return typeof v === 'string' && (BUTTON_STATES as readonly string[]).includes(v);
}

/** The states `obj` (an object inside a button symbol) shows in: its own `buttonStates`, else the
 *  nearest ancestor group's, else the default (Up, Over, Down). */
export function buttonStatesOf(obj: SceneObject, objectsById: Map<string, SceneObject>): readonly ButtonState[] {
  if (obj.buttonStates) return obj.buttonStates;
  const seen = new Set<string>();
  let pid = obj.parentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid); // cycle guard
    const p = objectsById.get(pid);
    if (!p?.isGroup) break;
    if (p.buttonStates) return p.buttonStates;
    pid = p.parentId;
  }
  return DEFAULT_BUTTON_STATES;
}

/** How an object inside a button symbol renders while the instance is in `state`:
 *  'show' = drawn; 'hit' = drawn fully transparent so it still catches the pointer;
 *  'hide' = not on screen at all. */
export function buttonVisibility(states: readonly ButtonState[], state: ButtonState): 'show' | 'hit' | 'hide' {
  if (states.includes(state)) return 'show';
  if (states.includes('hit')) return 'hit';
  return 'hide';
}

/** Is `assetId` a button symbol? */
export function isButtonAsset(asset: Asset | undefined): boolean {
  return !!asset && asset.kind === 'symbol' && asset.button === true;
}

/** Ids of every authored object (in any scene) that is an instance of a button symbol. Only these
 *  get Over/Down states in interactive players (v1: top-level instances; a button nested inside
 *  another symbol stays in its Up state). */
export function buttonInstanceIds(project: Project): Set<string> {
  const buttons = new Set(project.assets.filter((a) => isButtonAsset(a)).map((a) => a.id));
  const ids = new Set<string>();
  if (buttons.size === 0) return ids;
  for (const scene of projectScenes(project)) {
    for (const o of scene.objects) if (buttons.has(o.assetId)) ids.add(o.id);
  }
  return ids;
}
