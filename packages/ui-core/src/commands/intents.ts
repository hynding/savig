import { armatureBones, armatureRoot, isBone } from '@savig/engine';
import type { EditorState } from '@savig/editor-state';
import { selectActiveObjects } from '@savig/editor-state';

/** Small mutating "intents" that commands/viewmodels invoke — kept OUT of `predicates.ts` (a
 *  predicates-ONLY contract: pure `(state) => boolean` reads for command/button availability, no
 *  side effects) so that file's contract stays honest. This file is for the inverse: thin,
 *  reusable command actions, still small enough to keep in one place rather than a file each. */

/** Enter Shape Builder when inactive, exit when active — the exact toggle the `path.shapeBuilder`
 *  command's `run` performs. Exported (not inlined in registry.ts) so the Inspector button's
 *  intent can call the SAME logic instead of re-deriving the ternary, keeping the command palette
 *  and the button from ever drifting apart. */
export const toggleShapeBuilder = (s: EditorState): void => {
  if (s.shapeBuilder) s.exitShapeBuilder();
  else s.enterShapeBuilder();
};

/** Bind to Bones from the selection: the one selected drawing is skinned to the selected bones —
 *  or, when a single bone is selected, to its whole armature. */
export function bindSelectedSkin(s: EditorState): void {
  const objects = selectActiveObjects(s);
  const picked = s.selectedObjectIds.map((id) => objects.find((o) => o.id === id)).filter((o) => !!o);
  const bones = picked.filter((o) => isBone(o));
  const drawings = picked.filter((o) => !isBone(o));
  if (bones.length === 0 || drawings.length !== 1) {
    s.pushToast('error', 'Select one drawing together with the bones to bind it to.');
    return;
  }
  const boneIds = bones.length === 1 ? armatureBones(objects, armatureRoot(objects, bones[0].id)!.id).map((b) => b.id) : bones.map((b) => b.id);
  s.bindSkin(drawings[0].id, boneIds);
}

/** Attach to Bone from the selection: the one selected bone takes every other selected object. */
export function attachSelectedToBone(s: EditorState): void {
  const objects = selectActiveObjects(s);
  const bone = s.selectedObjectIds.map((id) => objects.find((o) => o.id === id)).find((o) => isBone(o));
  if (!bone) {
    s.pushToast('error', 'Select a bone together with the drawings to attach.');
    return;
  }
  s.attachToBone(bone.id, s.selectedObjectIds.filter((id) => id !== bone.id));
}
