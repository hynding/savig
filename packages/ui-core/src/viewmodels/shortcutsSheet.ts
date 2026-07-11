import type { CommandCategory } from '../commands/types';
import { COMMANDS } from '../commands/registry';
import { formatChord } from '../commands/chord';

export interface ShortcutRow {
  title: string;
  shortcutLabel: string;
}
export interface ShortcutGroup {
  category: CommandCategory;
  items: ShortcutRow[];
}

const CATEGORY_ORDER: CommandCategory[] = [
  'Tools',
  'Edit',
  'Arrange',
  'Boolean',
  'Path',
  'Animation',
  'Symbols',
  'Scenes',
  'View',
  'File',
];

/** The shortcuts cheat-sheet: chord-bearing commands grouped by category (fixed order), each with a
 *  formatted key label. Empty groups are omitted. */
export function shortcutsSheetViewModel(isMac: boolean): ShortcutGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: COMMANDS.filter((c) => c.category === category && c.chord).map((c) => ({
      title: c.title,
      shortcutLabel: formatChord(c.chord!, isMac),
    })),
  })).filter((g) => g.items.length > 0);
}
