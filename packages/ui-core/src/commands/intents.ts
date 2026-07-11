import type { EditorState } from '@savig/editor-state';

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
