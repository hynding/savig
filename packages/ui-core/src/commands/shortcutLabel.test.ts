import { describe, it, expect } from 'vitest';
import { commandShortcutLabel } from './shortcutLabel';

describe('commandShortcutLabel', () => {
  it('returns the formatted chord for a bound command', () => {
    expect(commandShortcutLabel('tool.rect', true)).toBe('R');
    expect(commandShortcutLabel('tool.select', false)).toBe('V');
  });

  it('formats modifiers per platform', () => {
    expect(commandShortcutLabel('file.save', true)).toBe('⌘S');
    expect(commandShortcutLabel('file.save', false)).toBe('Ctrl+S');
  });

  it('returns undefined for a chord-less command', () => {
    expect(commandShortcutLabel('file.new', true)).toBeUndefined();
    expect(commandShortcutLabel('file.exportSvg', true)).toBeUndefined();
  });

  it('returns undefined for an unknown command id', () => {
    expect(commandShortcutLabel('nope.nope', true)).toBeUndefined();
  });
});
