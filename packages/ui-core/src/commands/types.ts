import type { EditorState } from '@savig/editor-state';

/** Neutral keyboard event descriptor (no DOM). The app adapter maps a real KeyboardEvent to this. */
export interface KeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Neutral key descriptor. `mod` = meta OR ctrl. Matching is EXACT on modifiers and
 *  case-insensitive on the key. `key` uses DOM KeyboardEvent.key values ('v', 'z', ']',
 *  'ArrowLeft', ' '); `keys` lists alternates (e.g. Delete/Backspace). */
export interface KeyChord {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  key?: string;
  keys?: string[];
  /** Skip the exact-shift check — for keys where Shift is a magnitude modifier, not a distinct
   *  binding (e.g. arrow nudge: Shift = 10px step, read from the event in `run`). */
  ignoreShift?: boolean;
}

export type CommandCategory =
  | 'Tools'
  | 'Edit'
  | 'Arrange'
  | 'Boolean'
  | 'Animation'
  | 'Symbols'
  | 'Scenes'
  | 'View'
  | 'File';

/** App-provided boundary for effects a neutral store action cannot perform (browser file pickers,
 *  overlay visibility). apps/react implements it; Svelte can implement the same interface later. */
export interface CommandHost {
  newProject(): void;
  openProject(): void;
  saveProject(): void;
  exportProject(): void;
  openPalette(): void;
  openShortcuts(): void;
  closeOverlay(): void;
}

/** Context a command runs against: the live store snapshot + the app host. */
export interface CommandContext {
  state: EditorState;
  host: CommandHost;
}

export interface Command {
  id: string;
  title: string;
  category: CommandCategory;
  /** Absent = palette-only (no keyboard shortcut). */
  chord?: KeyChord;
  run: (ctx: CommandContext, e?: KeyEvent) => void;
  /** Availability; absent = always enabled. State-only (never needs the host). */
  when?: (s: EditorState) => boolean;
  /** Shown greyed in the palette when `when` is false. */
  unavailableHint?: string;
  /** Extra search terms for the palette. */
  keywords?: string[];
  /** Whether the key adapter should preventDefault when this command fires. */
  preventDefault?: boolean;
}
