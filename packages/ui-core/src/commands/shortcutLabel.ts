import { COMMANDS } from './registry';
import { formatChord } from './chord';

/** The formatted keyboard-shortcut label for a command id (e.g. 'tool.rect' → 'R', 'file.save' →
 *  '⌘S'/'Ctrl+S'), or undefined when the command has no chord / does not exist. Lets the toolbar
 *  build hover-tooltip hints straight from the registry, so they never drift from the real bindings. */
export function commandShortcutLabel(commandId: string, isMac: boolean): string | undefined {
  const cmd = COMMANDS.find((c) => c.id === commandId);
  return cmd?.chord ? formatChord(cmd.chord, isMac) : undefined;
}
