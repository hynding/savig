// Pure unit tests for `makeKeymapController` — no React. Drives the real vanilla
// `@savig/editor-state` store; asserts the store dispatch + the preventDefault-return contract
// (the new seam: the controller returns whether the adapter should call e.preventDefault). The
// full keyboard behavior is also covered end-to-end by useKeyboard.test.ts through the hook.
import { store } from '@savig/editor-state';
import { makeKeymapController } from './keymap';
import type { KeyEvent } from '../commands/types';

const key = (over: Partial<KeyEvent> & { key: string }): KeyEvent => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...over,
});

beforeEach(() => {
  store.getState().newProject();
});

describe('makeKeymapController — preventDefault contract', () => {
  it('mod-combos and space/arrows request preventDefault', () => {
    const c = makeKeymapController(store);
    expect(c.handleKey(key({ key: 'z', metaKey: true }))).toBe(true); // undo
    expect(c.handleKey(key({ key: ' ' }))).toBe(true); // play/pause
    expect(c.handleKey(key({ key: 'ArrowLeft' }))).toBe(true); // nudge
  });

  it('plain tool keys, comma/period, and unmapped keys do NOT request preventDefault', () => {
    const c = makeKeymapController(store);
    expect(c.handleKey(key({ key: 'r' }))).toBe(false); // rect tool
    expect(c.handleKey(key({ key: ',' }))).toBe(false); // step back
    expect(c.handleKey(key({ key: 'q' }))).toBe(false); // unmapped
  });
});

describe('makeKeymapController — dispatch', () => {
  it('space toggles playing', () => {
    const c = makeKeymapController(store);
    expect(store.getState().playing).toBe(false);
    c.handleKey(key({ key: ' ' }));
    expect(store.getState().playing).toBe(true);
    c.handleKey(key({ key: ' ' }));
    expect(store.getState().playing).toBe(false);
  });

  it('tool keys set the active tool', () => {
    const c = makeKeymapController(store);
    c.handleKey(key({ key: 'p' }));
    expect(store.getState().activeTool).toBe('pen');
    c.handleKey(key({ key: 'n' }));
    expect(store.getState().activeTool).toBe('node');
    c.handleKey(key({ key: 'v' }));
    expect(store.getState().activeTool).toBe('select');
  });

  it('mod+Z undoes and mod+Shift+Z redoes the last commit', () => {
    const c = makeKeymapController(store);
    const p = store.getState().history.present;
    store.getState().commit({ ...p, meta: { ...p.meta, loop: true } }); // a change to undo
    expect(store.getState().history.present.meta.loop).toBe(true);
    c.handleKey(key({ key: 'z', metaKey: true }));
    expect(store.getState().history.present.meta.loop).toBe(false);
    c.handleKey(key({ key: 'z', metaKey: true, shiftKey: true }));
    expect(store.getState().history.present.meta.loop).toBe(true);
  });
});
