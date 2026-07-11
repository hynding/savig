// Framework-neutral keyboard-shortcut controller. Dispatches via the COMMAND REGISTRY (the single
// source of truth): `handleKey` finds the first registry command whose chord matches AND whose
// `when` passes, runs it, and returns whether the caller should `preventDefault`. The `window`
// listener and the `isEditable(e.target)` guard (which inspect the DOM) stay in the app adapter.
//
// `Escape` (exit symbol level / cancel pen draft) is not a registry command — it is a multi-effect,
// selection/draft-context action with no palette value, kept here as a special case.
import type { ControllerStore } from './store';
import type { KeyEvent, CommandHost } from '../commands/types';
import { COMMANDS, findMatchingCommand } from '../commands/registry';
import { chordMatches } from '../commands/chord';

export function makeKeymapController(store: ControllerStore, host: CommandHost) {
  /** Dispatch a keydown. Returns true if the caller should preventDefault. */
  const handleKey = (e: KeyEvent): boolean => {
    const state = store.getState();

    // Escape: exit Shape Builder mode (checked FIRST — it's an overlay mode, not a symbol-edit
    // level or a tool draft), else exit a symbol edit level, else cancel any pen draft and drop to
    // the select tool. Fires regardless of modifiers (parity with the old keymap's `case 'Escape'`).
    if (e.key === 'Escape') {
      if (state.shapeBuilder) {
        state.exitShapeBuilder();
      } else if (state.editPath.length > 0 && !state.penDrafting) {
        state.exitSymbol();
      } else {
        state.requestCancelPen();
        state.setActiveTool('select');
      }
      return false;
    }

    const cmd = findMatchingCommand(state, e);
    if (cmd) {
      cmd.run({ state, host }, e);
      return cmd.preventDefault ?? false;
    }
    // No runnable command for this chord, but if the chord is "owned" by a preventDefault binding
    // (e.g. Cmd+D with nothing selected), still block the browser default — matching the old keymap,
    // which called self-gating no-op actions and preventDefaulted these keys unconditionally.
    return COMMANDS.some((c) => !!c.chord && !!c.preventDefault && chordMatches(c.chord, e));
  };

  return { handleKey };
}

export type KeymapController = ReturnType<typeof makeKeymapController>;
