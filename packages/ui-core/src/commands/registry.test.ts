import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { COMMANDS, findMatchingCommand } from './registry';
import type { KeyChord, KeyEvent } from './types';

const ev = (o: Partial<KeyEvent> & { key: string }): KeyEvent => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...o,
});

const sig = (c: KeyChord): string =>
  JSON.stringify({
    mod: !!c.mod,
    shift: !!c.shift,
    alt: !!c.alt,
    keys: [...(c.keys ?? []), ...(c.key ? [c.key] : [])].map((k) => k.toLowerCase()).sort(),
  });

beforeEach(() => {
  store.getState().newProject();
});

describe('command registry integrity', () => {
  it('command ids are unique', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('commands sharing a chord all have a `when` gate (no always-on duplicate binding)', () => {
    const groups = new Map<string, typeof COMMANDS>();
    for (const c of COMMANDS) {
      if (!c.chord) continue;
      const k = sig(c.chord);
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    for (const [, group] of groups) {
      if (group.length > 1) {
        for (const c of group) {
          expect(c.when, `${c.id} shares a chord and must be gated by \`when\``).toBeTypeOf('function');
        }
      }
    }
  });

  it('anyMod chords own their key exclusively (anyMod waives every modifier, so a shared key would collide)', () => {
    const keysOf = (c: (typeof COMMANDS)[number]): string[] =>
      [...(c.chord?.keys ?? []), ...(c.chord?.key ? [c.chord.key] : [])].map((k) => k.toLowerCase());
    const anyModKeys = new Set(COMMANDS.filter((c) => c.chord?.anyMod).flatMap(keysOf));
    for (const c of COMMANDS) {
      if (c.chord?.anyMod) continue;
      for (const k of keysOf(c)) {
        expect(anyModKeys.has(k), `${c.id} shares key "${k}" with an anyMod command`).toBe(false);
      }
    }
  });

  it('Delete resolves to node → keyframe → object by context (mutually exclusive)', () => {
    // Object only.
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(findMatchingCommand(store.getState(), ev({ key: 'Backspace' }))?.id).toBe('edit.deleteObject');
  });
});

describe('findMatchingCommand', () => {
  it('Cmd+Z → undo', () => {
    expect(findMatchingCommand(store.getState(), ev({ key: 'z', metaKey: true }))?.id).toBe('edit.undo');
  });

  it('Cmd+C picks copyKeyframe when a keyframe is selected, else copyObject', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    // Object selected, no keyframe → copyObject.
    expect(findMatchingCommand(store.getState(), ev({ key: 'c', metaKey: true }))?.id).toBe('edit.copyObject');
    // Now select a keyframe.
    store.getState().seek(0);
    store.getState().setProperty('x', 10);
    const id = store.getState().selectedObjectId!;
    store.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    expect(findMatchingCommand(store.getState(), ev({ key: 'c', metaKey: true }))?.id).toBe('edit.copyKeyframe');
  });

  it('a bare tool letter does NOT match while a modifier is held (quirk fix)', () => {
    expect(findMatchingCommand(store.getState(), ev({ key: 's' }))?.id).toBe('tool.star');
    expect(findMatchingCommand(store.getState(), ev({ key: 's', metaKey: true }))?.id).toBe('file.save');
  });

  it('file.templates opens the template gallery via the host', () => {
    const calls: string[] = [];
    const host = {
      newProject: () => {}, openProject: () => {}, saveProject: () => {}, exportProject: () => {},
      openPalette: () => {}, openShortcuts: () => {}, openTemplates: () => calls.push('openTemplates'), closeOverlay: () => {},
    };
    const cmd = COMMANDS.find((c) => c.id === 'file.templates')!;
    cmd.run({ state: store.getState(), host });
    expect(calls).toEqual(['openTemplates']);
  });
});
