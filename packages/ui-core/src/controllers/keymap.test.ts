// Pure unit tests for `makeKeymapController` — no React. Drives the real vanilla
// `@savig/editor-state` store; asserts the store dispatch + the preventDefault-return contract.
// Dispatch now flows through the command registry; these tests are the behavior-parity net for that
// refactor (plus the intentional mod+letter quirk fixes).
import { store } from '@savig/editor-state';
import { makeKeymapController } from './keymap';
import type { KeyEvent, CommandHost } from '../commands/types';

const key = (over: Partial<KeyEvent> & { key: string }): KeyEvent => ({
  code: '',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...over,
});

const makeStubHost = () => {
  const calls: string[] = [];
  const host: CommandHost = {
    newProject: () => calls.push('newProject'),
    openProject: () => calls.push('openProject'),
    saveProject: () => calls.push('saveProject'),
    exportProject: () => calls.push('exportProject'),
    exportSvg: () => calls.push('exportSvg'),
    openPalette: () => calls.push('openPalette'),
    openShortcuts: () => calls.push('openShortcuts'),
    openTemplates: () => calls.push('openTemplates'),
    openGettingStarted: () => calls.push('openGettingStarted'),
    closeOverlay: () => calls.push('closeOverlay'),
  };
  return { host, calls };
};

const ctrl = () => makeKeymapController(store, makeStubHost().host);

beforeEach(() => {
  store.getState().newProject();
});

describe('makeKeymapController — preventDefault contract', () => {
  it('mod-combos and space/arrows request preventDefault (even when the action no-ops)', () => {
    const c = ctrl();
    expect(c.handleKey(key({ key: 'z', metaKey: true }))).toBe(true); // undo
    expect(c.handleKey(key({ key: ' ' }))).toBe(true); // play/pause
    expect(c.handleKey(key({ key: 'ArrowLeft' }))).toBe(true); // nudge (owned-chord fallback)
    expect(c.handleKey(key({ key: 'd', metaKey: true }))).toBe(true); // duplicate, nothing selected
  });

  it('plain tool keys, comma/period, and unmapped keys do NOT request preventDefault', () => {
    const c = ctrl();
    expect(c.handleKey(key({ key: 'r' }))).toBe(false); // rect tool
    expect(c.handleKey(key({ key: ',' }))).toBe(false); // step back
    expect(c.handleKey(key({ key: 'q' }))).toBe(false); // unmapped
  });
});

describe('makeKeymapController — dispatch', () => {
  it('space toggles playing', () => {
    const c = ctrl();
    expect(store.getState().playing).toBe(false);
    c.handleKey(key({ key: ' ' }));
    expect(store.getState().playing).toBe(true);
    c.handleKey(key({ key: ' ' }));
    expect(store.getState().playing).toBe(false);
  });

  it('tool keys set the active tool', () => {
    const c = ctrl();
    c.handleKey(key({ key: 'p' }));
    expect(store.getState().activeTool).toBe('pen');
    c.handleKey(key({ key: 'n' }));
    expect(store.getState().activeTool).toBe('node');
    c.handleKey(key({ key: 'v' }));
    expect(store.getState().activeTool).toBe('select');
  });

  it('mod+Z undoes and mod+Shift+Z redoes the last commit', () => {
    const c = ctrl();
    const p = store.getState().history.present;
    store.getState().commit({ ...p, meta: { ...p.meta, loop: true } });
    expect(store.getState().history.present.meta.loop).toBe(true);
    c.handleKey(key({ key: 'z', metaKey: true }));
    expect(store.getState().history.present.meta.loop).toBe(false);
    c.handleKey(key({ key: 'z', metaKey: true, shiftKey: true }));
    expect(store.getState().history.present.meta.loop).toBe(true);
  });

  it('Escape drops to the select tool', () => {
    const c = ctrl();
    store.getState().setActiveTool('rect');
    c.handleKey(key({ key: 'Escape' }));
    expect(store.getState().activeTool).toBe('select');
  });
});

describe('makeKeymapController — intentional mod+letter quirk fixes', () => {
  it('Cmd+S saves the project and does NOT select the star tool', () => {
    const { host, calls } = makeStubHost();
    const c = makeKeymapController(store, host);
    store.getState().setActiveTool('select');
    expect(c.handleKey(key({ key: 's', metaKey: true }))).toBe(true); // preventDefault (block browser save)
    expect(store.getState().activeTool).toBe('select'); // NOT 'star'
    expect(calls).toContain('saveProject');
  });

  it('Cmd+B / Cmd+R do NOT switch tools', () => {
    const c = ctrl();
    store.getState().setActiveTool('select');
    c.handleKey(key({ key: 'b', metaKey: true }));
    c.handleKey(key({ key: 'r', metaKey: true }));
    expect(store.getState().activeTool).toBe('select');
  });

  it('Alt/Cmd+Arrow still nudge AND block the browser default (no back-nav data loss)', () => {
    const c = ctrl();
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // selected
    expect(c.handleKey(key({ key: 'ArrowLeft', altKey: true }))).toBe(true);
    expect(c.handleKey(key({ key: 'ArrowLeft', metaKey: true }))).toBe(true);
  });

  it('Shift+letter still selects the tool (uppercase e.key)', () => {
    const c = ctrl();
    c.handleKey(key({ key: 'R', shiftKey: true }));
    expect(store.getState().activeTool).toBe('rect');
    c.handleKey(key({ key: 'V', shiftKey: true }));
    expect(store.getState().activeTool).toBe('select');
  });

  it('Cmd+K opens the palette; Shift+? opens the shortcuts sheet', () => {
    const { host, calls } = makeStubHost();
    const c = makeKeymapController(store, host);
    c.handleKey(key({ key: 'k', metaKey: true }));
    c.handleKey(key({ key: '?', shiftKey: true }));
    expect(calls).toEqual(['openPalette', 'openShortcuts']);
  });
});
