import type { EditorState } from '@savig/editor-state';
import type { CommandCategory } from '../commands/types';
import { COMMANDS } from '../commands/registry';
import { formatChord } from '../commands/chord';

export interface PaletteResult {
  id: string;
  title: string;
  category: CommandCategory;
  shortcutLabel?: string;
  enabled: boolean;
  unavailableHint?: string;
}

function matchesQuery(title: string, category: string, keywords: string[] | undefined, q: string): boolean {
  const hay = [title, category, ...(keywords ?? [])].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/** The command-palette list for a query: every matching command, enabled ones first (stable),
 *  each annotated with its shortcut label + availability. */
export function commandPaletteViewModel(state: EditorState, query: string, isMac: boolean): PaletteResult[] {
  const results: PaletteResult[] = COMMANDS.filter((c) =>
    matchesQuery(c.title, c.category, c.keywords, query),
  ).map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    shortcutLabel: c.chord ? formatChord(c.chord, isMac) : undefined,
    enabled: !c.when || c.when(state),
    unavailableHint: c.unavailableHint,
  }));
  // Stable enabled-first sort (preserve registry order within each group).
  return results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.enabled === b.r.enabled ? a.i - b.i : a.r.enabled ? -1 : 1))
    .map(({ r }) => r);
}
