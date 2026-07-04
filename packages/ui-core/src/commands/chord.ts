import type { KeyChord, KeyEvent } from './types';

function chordKeys(chord: KeyChord): string[] {
  const ks = chord.keys ? [...chord.keys] : [];
  if (chord.key) ks.push(chord.key);
  return ks.map((k) => k.toLowerCase());
}

/** True when the event matches the chord: modifiers match EXACTLY (`mod` = meta OR ctrl) and the
 *  key (case-insensitive) is one of the chord's keys. Exact-modifier matching is what stops a bare
 *  tool letter from firing while Cmd/Ctrl is held. */
export function chordMatches(chord: KeyChord, e: KeyEvent): boolean {
  if ((chord.mod ?? false) !== (e.metaKey || e.ctrlKey)) return false;
  if (!chord.ignoreShift && (chord.shift ?? false) !== e.shiftKey) return false;
  if ((chord.alt ?? false) !== e.altKey) return false;
  return chordKeys(chord).includes(e.key.toLowerCase());
}

const MAC_MODS: Array<[keyof KeyChord, string]> = [
  ['mod', '⌘'],
  ['shift', '⇧'],
  ['alt', '⌥'],
];
const WIN_MODS: Array<[keyof KeyChord, string]> = [
  ['mod', 'Ctrl'],
  ['shift', 'Shift'],
  ['alt', 'Alt'],
];

const SPECIAL_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Delete: '⌦',
  Backspace: '⌫',
  Escape: 'Esc',
};

function keyLabel(chord: KeyChord): string {
  const k = chord.key ?? chord.keys?.[0] ?? '';
  if (k in SPECIAL_LABELS) return SPECIAL_LABELS[k];
  return k.length === 1 ? k.toUpperCase() : k;
}

/** Human-readable shortcut label: '⌘Z' on mac, 'Ctrl+Z' elsewhere. */
export function formatChord(chord: KeyChord, isMac: boolean): string {
  const label = keyLabel(chord);
  if (isMac) {
    const prefix = MAC_MODS.filter(([m]) => chord[m]).map(([, sym]) => sym).join('');
    return prefix + label;
  }
  const parts = WIN_MODS.filter(([m]) => chord[m]).map(([, word]) => word);
  parts.push(label);
  return parts.join('+');
}
