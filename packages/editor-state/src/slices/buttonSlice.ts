// Button-symbol authoring verbs (spec 2026-11-19-button-symbols). A button is a symbol with
// `button: true`; each object inside it picks the states it shows in via `buttonStates`.
import { BUTTON_STATES, DEFAULT_BUTTON_STATES, isButtonState, isLockedInTree } from '@savig/engine';
import type { ButtonState, SceneObject } from '@savig/engine';
import { selectActiveObjects, selectActiveSymbolAsset } from '../selectors';
import type { SliceCreator } from '../store-internals';

type ButtonKeys = 'setSymbolButton' | 'setButtonStates' | 'setButtonPreviewState';

/** Canonical order, no duplicates; `undefined` when the set is the default (Up, Over, Down). */
export function normalizeButtonStates(states: readonly ButtonState[]): ButtonState[] | undefined {
  const picked = BUTTON_STATES.filter((st) => states.includes(st));
  const isDefault = picked.length === DEFAULT_BUTTON_STATES.length && DEFAULT_BUTTON_STATES.every((st) => picked.includes(st));
  return isDefault ? undefined : picked;
}

export const createButtonSlice: SliceCreator<ButtonKeys> = (set, get) => ({
  setButtonPreviewState(state) {
    set({ buttonPreviewState: state && selectActiveSymbolAsset(get())?.button ? state : null });
  },

  setSymbolButton(symId, button) {
    const project = get().history.present;
    const sym = project.assets.find((a) => a.id === symId);
    if (!sym || sym.kind !== 'symbol') return;
    if ((sym.button ?? false) === button) return; // no-op -> no spurious commit
    const next = { ...sym };
    if (button) next.button = true;
    else delete next.button;
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === symId ? next : a)) });
  },

  setButtonStates(states) {
    const s = get();
    if (!selectActiveSymbolAsset(s)?.button) {
      s.pushToast('error', 'Button states apply inside a button symbol. Double-click a button to edit it.');
      return;
    }
    const objects = selectActiveObjects(s);
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    const targets = s.selectedObjectIds
      .map((id) => byId.get(id))
      .filter((o): o is SceneObject => !!o && !isLockedInTree(o, byId));
    if (targets.length === 0) return;
    const normalized = normalizeButtonStates(states.filter(isButtonState));
    const same = (o: SceneObject) => JSON.stringify(o.buttonStates) === JSON.stringify(normalized);
    if (targets.every(same)) return;
    const ids = new Set(targets.map((o) => o.id));
    const next = objects.map((o) => {
      if (!ids.has(o.id)) return o;
      const copy = { ...o };
      if (normalized) copy.buttonStates = normalized;
      else delete copy.buttonStates;
      return copy;
    });
    get().commitActiveScene(next);
  },
});
