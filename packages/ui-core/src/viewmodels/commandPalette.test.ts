import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { commandPaletteViewModel } from './commandPalette';
import { shortcutsSheetViewModel } from './shortcutsSheet';

beforeEach(() => {
  store.getState().newProject();
});

describe('commandPaletteViewModel', () => {
  it('empty query lists all commands, enabled first', () => {
    const vm = commandPaletteViewModel(store.getState(), '', true);
    expect(vm.length).toBeGreaterThan(40);
    const firstDisabled = vm.findIndex((r) => !r.enabled);
    const lastEnabled = vm.map((r) => r.enabled).lastIndexOf(true);
    if (firstDisabled !== -1) expect(firstDisabled).toBeGreaterThan(lastEnabled);
  });

  it('filters by query across title/category/keywords', () => {
    const vm = commandPaletteViewModel(store.getState(), 'align', true);
    expect(vm.length).toBeGreaterThan(0);
    expect(vm.every((r) => /align/i.test(r.title + r.category))).toBe(true);
  });

  it('marks unavailable commands disabled with a hint', () => {
    const vm = commandPaletteViewModel(store.getState(), 'align left', true);
    const alignLeft = vm.find((r) => r.id === 'arrange.align.left')!;
    expect(alignLeft.enabled).toBe(false); // nothing selected
    expect(alignLeft.unavailableHint).toBe('Select 2+ objects');
  });

  it('formats shortcut labels per platform', () => {
    const mac = commandPaletteViewModel(store.getState(), 'undo', true).find((r) => r.id === 'edit.undo')!;
    const win = commandPaletteViewModel(store.getState(), 'undo', false).find((r) => r.id === 'edit.undo')!;
    expect(mac.shortcutLabel).toBe('⌘Z');
    expect(win.shortcutLabel).toBe('Ctrl+Z');
  });
});

describe('shortcutsSheetViewModel', () => {
  it('groups chord-bearing commands by category with formatted labels', () => {
    const groups = shortcutsSheetViewModel(true);
    const edit = groups.find((g) => g.category === 'Edit')!;
    expect(edit.items.some((i) => i.title === 'Undo' && i.shortcutLabel === '⌘Z')).toBe(true);
    // Every listed item has a non-empty shortcut label.
    expect(groups.every((g) => g.items.every((i) => i.shortcutLabel.length > 0))).toBe(true);
  });
});
