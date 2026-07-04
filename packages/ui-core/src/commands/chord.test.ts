import { describe, it, expect } from 'vitest';
import { chordMatches, formatChord } from './chord';
import type { KeyEvent } from './types';

const ev = (o: Partial<KeyEvent> & { key: string }): KeyEvent => ({
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

  it('keys[] alternates (Delete/Backspace)', () => {
    expect(chordMatches({ keys: ['Delete', 'Backspace'] }, ev({ key: 'Backspace' }))).toBe(true);
    expect(chordMatches({ keys: ['Delete', 'Backspace'] }, ev({ key: 'Delete' }))).toBe(true);
    expect(chordMatches({ keys: ['Delete', 'Backspace'] }, ev({ key: 'x' }))).toBe(false);
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
  });
});
