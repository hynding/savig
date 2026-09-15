import type { EditorState } from '@savig/editor-state';

/** Neutral keyboard event descriptor (no DOM). The app adapter maps a real KeyboardEvent to this.
 *  `code` is the PHYSICAL key (DOM KeyboardEvent.code, e.g. 'KeyC') — layout/composition-independent,
 *  unlike `key` which macOS Option-composes into a different character (Alt+C -> key:'ç', code:'KeyC'). */
export interface KeyEvent {
  key: string;
  code: string;
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
  /** Match this key regardless of ANY modifier — for keys the old keymap dispatched on key alone
   *  (arrows, Space). Ensures e.g. Alt/Cmd+Arrow still nudges AND still blocks the browser's
   *  back-navigation gesture (which would discard unsaved state in this no-backend app). */
  anyMod?: boolean;
}

export type CommandCategory =
  | 'Tools'
  | 'Edit'
  | 'Arrange'
  | 'Boolean'
  | 'Path'
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
  exportSvg(): void;
  exportAnimatedSvg(): void;
  /** Open the Export Video dialog (browser ffmpeg.wasm export — spec 2026-09-12). */
  openExportVideo(): void;
  openPalette(): void;
  openShortcuts(): void;
  openTemplates(): void;
  openGettingStarted(): void;
  closeOverlay(): void;
  /** Push the current project to the user's cloud account (M10). */
  saveToCloud(): void;
  /** Open the "browse my cloud projects" dialog (M10). */
  openCloudProjects(): void;
  /** Open the cloud sign-in/sign-out account dialog (M10). */
  openCloudAccount(): void;
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
  /** Visibility; absent = always visible. Host/env-independent-of-state — hides the command
   *  entirely from BOTH the palette and the keymap (unlike `when`, which only greys it in the
   *  palette). Gate on capabilities the host environment provides, e.g. `commandCapabilities()`. */
  visible?: () => boolean;
  /** Shown greyed in the palette when `when` is false. */
  unavailableHint?: string;
  /** Extra search terms for the palette. */
  keywords?: string[];
  /** Whether the key adapter should preventDefault when this command fires. */
  preventDefault?: boolean;
}
