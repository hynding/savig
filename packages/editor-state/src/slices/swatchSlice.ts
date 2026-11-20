// Color swatches and global colors (roadmap 12): thin store wrappers over the engine's pure
// swatch operations. The palette lives on the root project, so every scene and symbol shares it.
import {
  addSwatch, applySwatchToAssets, isLockedInTree, moveSwatch, newId, projectSwatches, removeSwatch,
  snapToFrame, swatchColor, updateSwatch, upsertColorKeyframe,
} from '@savig/engine';
import type { Project, SceneObject } from '@savig/engine';
import { selectActiveObjects, selectActiveScope } from '../selectors';
import { replaceObjectInScene } from '../store-internals';
import type { EditorState, SliceCreator, StoreGet } from '../store-internals';

type SwatchKeys = 'addSwatch' | 'updateSwatch' | 'removeSwatch' | 'moveSwatch' | 'applySwatch';

function commitIfChanged(get: StoreGet, next: Project): void {
  if (next !== get().history.present) get().commit(next);
}

/** The selected objects that hold a paintable (vector or text) asset and are not locked. */
function paintTargets(s: EditorState): SceneObject[] {
  const objects = selectActiveObjects(s);
  const lockById = new Map(objects.map((o) => [o.id, o] as const));
  const ids = s.selectedObjectIds.length > 0 ? s.selectedObjectIds : s.selectedObjectId ? [s.selectedObjectId] : [];
  const assets = new Map(s.history.present.assets.map((a) => [a.id, a] as const));
  return ids
    .map((id) => lockById.get(id))
    .filter((o): o is SceneObject => {
      if (!o || isLockedInTree(o, lockById)) return false;
      const k = o.assetId ? assets.get(o.assetId)?.kind : undefined;
      return k === 'vector' || k === 'text';
    });
}

/** The selected object's current solid fill, when it is a hex color (seed for "+ Add"). */
function selectedFill(s: EditorState): string | null {
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
  const a = obj?.assetId ? s.history.present.assets.find((x) => x.id === obj.assetId) : undefined;
  if (a?.kind === 'vector') return swatchColor(a.style.fill);
  if (a?.kind === 'text') return swatchColor(a.fill);
  return null;
}

export const createSwatchSlice: SliceCreator<SwatchKeys> = (_set, get) => ({
  addSwatch(color, opts) {
    const s = get();
    const c = (color !== undefined ? swatchColor(color) : null) ?? selectedFill(s) ?? '#888888';
    const id = newId();
    get().commit(addSwatch(s.history.present, { id, color: c, name: opts?.name, global: opts?.global }));
    return id;
  },

  updateSwatch(swatchId, patch) {
    if (patch.color !== undefined && !swatchColor(patch.color)) return;
    commitIfChanged(get, updateSwatch(get().history.present, swatchId, patch));
  },

  removeSwatch(swatchId) {
    commitIfChanged(get, removeSwatch(get().history.present, swatchId));
  },

  moveSwatch(swatchId, index) {
    commitIfChanged(get, moveSwatch(get().history.present, swatchId, index));
  },

  applySwatch(swatchId, paint) {
    const s = get();
    let project = s.history.present;
    const sw = projectSwatches(project).find((x) => x.id === swatchId);
    if (!sw) return;
    const targets = paintTargets(s);
    if (targets.length === 0) {
      if (s.selectedObjectId) get().pushToast('error', 'Select an unlocked shape or text to paint.');
      return;
    }
    project = applySwatchToAssets(project, swatchId, paint, targets.map((o) => o.assetId!));
    // An object whose colour is keyed would hide the static paint: key the swatch colour at the
    // playhead instead (the setVectorColor auto-key precedent), keeping the static link too.
    const time = snapToFrame(s.time, project.meta.fps);
    const scope = selectActiveScope(s);
    for (const o of targets) {
      const track = o.colorTracks?.[paint];
      if (!track?.length) continue;
      const colorTracks = { ...o.colorTracks, [paint]: upsertColorKeyframe(track, { time, value: sw.color, easing: 'linear' }) };
      project = replaceObjectInScene(project, scope, { ...o, colorTracks });
    }
    commitIfChanged(get, project);
  },
});
