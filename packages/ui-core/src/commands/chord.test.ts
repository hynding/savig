import { describe, it, expect } from 'vitest';
import { chordMatches, formatChord } from './chord';
import type { KeyEvent } from './types';

const ev = (o: Partial<KeyEvent> & { key: string }): KeyEvent => ({
  code: '',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...o,
});

describe('chordMatches', () => {
  it('exact modifier match: a mod chord needs meta OR ctrl', () => {
    expect(chordMatches({ mod: true, key: 'z' }, ev({ key: 'z', metaKey: true }))).toBe(true);
    expect(chordMatches({ mod: true, key: 'z' }, ev({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(chordMatches({ mod: true, key: 'z' }, ev({ key: 'z' }))).toBe(false);
  });

  it('a no-mod chord must NOT fire under a modifier (the quirk fix)', () => {
    expect(chordMatches({ key: 's' }, ev({ key: 's' }))).toBe(true);
    expect(chordMatches({ key: 's' }, ev({ key: 's', metaKey: true }))).toBe(false);
    expect(chordMatches({ key: 's' }, ev({ key: 's', ctrlKey: true }))).toBe(false);
  });

  it('case-insensitive key + shift exactness', () => {
    expect(chordMatches({ key: 'v' }, ev({ key: 'V' }))).toBe(true);
    expect(chordMatches({ mod: true, shift: true, key: 'u' }, ev({ key: 'U', metaKey: true, shiftKey: true }))).toBe(true);
    expect(chordMatches({ key: 'v' }, ev({ key: 'v', shiftKey: true }))).toBe(false);
  });

  it('alt exactness', () => {
    expect(chordMatches({ mod: true, shift: true, key: 'u' }, ev({ key: 'u', metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(chordMatches({ mod: true, shift: true, alt: true, key: 'u' }, ev({ key: 'u', metaKey: true, shiftKey: true, altKey: true }))).toBe(true);
  });

  it('ignoreShift matches regardless of shift (arrow nudge magnitude)', () => {
    expect(chordMatches({ key: 'ArrowLeft', ignoreShift: true }, ev({ key: 'ArrowLeft' }))).toBe(true);
    expect(chordMatches({ key: 'ArrowLeft', ignoreShift: true }, ev({ key: 'ArrowLeft', shiftKey: true }))).toBe(true);
    expect(chordMatches({ key: 'ArrowLeft', ignoreShift: true }, ev({ key: 'ArrowLeft', metaKey: true }))).toBe(false);
  });

  it('anyMod matches regardless of any modifier (arrows/space)', () => {
    expect(chordMatches({ key: 'ArrowLeft', anyMod: true }, ev({ key: 'ArrowLeft', altKey: true }))).toBe(true);
    expect(chordMatches({ key: 'ArrowLeft', anyMod: true }, ev({ key: 'ArrowLeft', metaKey: true }))).toBe(true);
    expect(chordMatches({ key: ' ', anyMod: true }, ev({ key: ' ', ctrlKey: true }))).toBe(true);
    expect(chordMatches({ key: 'ArrowLeft', anyMod: true }, ev({ key: 'x', metaKey: true }))).toBe(false); // wrong key
  });

  it('keys[] alternates (Delete/Backspace)', () => {
    expect(chordMatches({ keys: ['Delete', 'Backspace'] }, ev({ key: 'Backspace' }))).toBe(true);
    expect(chordMatches({ keys: ['Delete', 'Backspace'] }, ev({ key: 'Delete' }))).toBe(true);
    expect(chordMatches({ keys: ['Delete', 'Backspace'] }, ev({ key: 'x' }))).toBe(false);
  });

  it('macOS alt-chord: physical `code` matches when Option composes `key` into a different character', () => {
    // Cmd+Option+C on macOS delivers key:'ç' (Option composes), so a `key`-only match would never
    // fire; e.code is layout/composition-independent and must be accepted as an alternate.
    expect(
      chordMatches({ mod: true, alt: true, key: 'c' }, ev({ key: 'ç', code: 'KeyC', metaKey: true, altKey: true })),
    ).toBe(true);
  });

  it('plain mod+letter still resolves by `key` (no regression from the `code` alternate)', () => {
    expect(chordMatches({ mod: true, key: 'c' }, ev({ key: 'c', code: 'KeyC', metaKey: true }))).toBe(true);
  });

  it('a `code`-only match must NOT fire when modifiers mismatch', () => {
    // Same physical key as the alt-chord case, but WITHOUT alt held — must not match.
    expect(chordMatches({ mod: true, alt: true, key: 'c' }, ev({ key: 'c', code: 'KeyC', metaKey: true }))).toBe(false);
  });
});

describe('formatChord', () => {
  it('mac uses symbols; non-mac uses words', () => {
    expect(formatChord({ mod: true, key: 'z' }, true)).toBe('⌘Z');
    expect(formatChord({ mod: true, key: 'z' }, false)).toBe('Ctrl+Z');
    expect(formatChord({ mod: true, shift: true, key: 's' }, true)).toBe('⌘⇧S');
    expect(formatChord({ mod: true, shift: true, key: 's' }, false)).toBe('Ctrl+Shift+S');
  });

  it('formats special keys', () => {
    expect(formatChord({ key: ' ' }, false)).toBe('Space');
    expect(formatChord({ key: 'ArrowLeft' }, true)).toBe('←');
    expect(formatChord({ keys: ['Delete', 'Backspace'] }, true)).toBe('⌦');
    expect(formatChord({ keys: ['Delete', 'Backspace'] }, false)).toBe('Del'); // words on non-mac
  });
});
