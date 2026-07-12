import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { COMMANDS, findMatchingCommand } from './registry';
import type { KeyChord, KeyEvent } from './types';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';

const ev = (o: Partial<KeyEvent> & { key: string }): KeyEvent => ({
  code: '',
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

  it('Delete resolves to edit.deleteKeyframe (not edit.deleteObject) when a trim keyframe is selected (Task 6)', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = store.getState().selectedObjectId!;
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5);
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    expect(findMatchingCommand(store.getState(), ev({ key: 'Backspace' }))?.id).toBe('edit.deleteKeyframe');
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
      newProject: () => {}, openProject: () => {}, saveProject: () => {}, exportProject: () => {}, exportSvg: () => {},
      openPalette: () => {}, openShortcuts: () => {}, openTemplates: () => calls.push('openTemplates'), openGettingStarted: () => {}, closeOverlay: () => {},
    };
    const cmd = COMMANDS.find((c) => c.id === 'file.templates')!;
    cmd.run({ state: store.getState(), host });
    expect(calls).toEqual(['openTemplates']);
  });

  it('file.exportSvg exports via the host', () => {
    const calls: string[] = [];
    const host = {
      newProject: () => {}, openProject: () => {}, saveProject: () => {}, exportProject: () => {},
      exportSvg: () => calls.push('exportSvg'), openPalette: () => {}, openShortcuts: () => {},
      openTemplates: () => {}, openGettingStarted: () => {}, closeOverlay: () => {},
    };
    COMMANDS.find((c) => c.id === 'file.exportSvg')!.run({ state: store.getState(), host });
    expect(calls).toEqual(['exportSvg']);
  });
});

describe('style tools commands (Task 2)', () => {
  it('tool.eyedropper has the "i" chord and activates the eyedropper tool', () => {
    const cmd = COMMANDS.find((c) => c.id === 'tool.eyedropper')!;
    expect(cmd.chord).toMatchObject({ key: 'i' });
    expect(findMatchingCommand(store.getState(), ev({ key: 'i' }))?.id).toBe('tool.eyedropper');
  });

  it('tool.scissors has the "c" chord and activates the scissors tool (Task 3)', () => {
    const cmd = COMMANDS.find((c) => c.id === 'tool.scissors')!;
    expect(cmd.chord).toMatchObject({ key: 'c' });
    expect(findMatchingCommand(store.getState(), ev({ key: 'c' }))?.id).toBe('tool.scissors');
  });

  it('tool.text has the "t" chord and activates the text tool', () => {
    const cmd = COMMANDS.find((c) => c.id === 'tool.text')!;
    expect(cmd.chord).toMatchObject({ key: 't' });
    expect(findMatchingCommand(store.getState(), ev({ key: 't' }))?.id).toBe('tool.text');
    cmd.run({ state: store.getState(), host: {} as never });
    expect(store.getState().activeTool).toBe('text');
  });

  it('edit.copyStyle is bound to mod+alt+c and does not collide with edit.copyObject (mod+c)', () => {
    const cmd = COMMANDS.find((c) => c.id === 'edit.copyStyle')!;
    expect(cmd.chord).toMatchObject({ mod: true, alt: true, key: 'c' });
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(findMatchingCommand(store.getState(), ev({ key: 'c', metaKey: true, altKey: true }))?.id).toBe(
      'edit.copyStyle',
    );
    expect(findMatchingCommand(store.getState(), ev({ key: 'c', metaKey: true }))?.id).toBe('edit.copyObject');
  });

  it('edit.pasteStyle is bound to mod+alt+v and does not collide with edit.pasteObject (mod+v)', () => {
    const cmd = COMMANDS.find((c) => c.id === 'edit.pasteStyle')!;
    expect(cmd.chord).toMatchObject({ mod: true, alt: true, key: 'v' });
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    store.getState().copyStyle();
    expect(findMatchingCommand(store.getState(), ev({ key: 'v', metaKey: true, altKey: true }))?.id).toBe(
      'edit.pasteStyle',
    );
  });

  it('edit.copyStyle requires a selection; edit.pasteStyle requires a styleClipboard + a selection', () => {
    // No selection: neither style command should be the match (falls through to undefined for that chord).
    expect(findMatchingCommand(store.getState(), ev({ key: 'c', metaKey: true, altKey: true }))?.id).toBeUndefined();
    expect(findMatchingCommand(store.getState(), ev({ key: 'v', metaKey: true, altKey: true }))?.id).toBeUndefined();
  });

  it('edit.copyStyle resolves via the PHYSICAL key on a simulated macOS event, where Option composes `key` into "ç"', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(
      findMatchingCommand(store.getState(), ev({ key: 'ç', code: 'KeyC', metaKey: true, altKey: true }))?.id,
    ).toBe('edit.copyStyle');
    // No regression: a plain mod+c (no alt) still resolves edit.copyObject even with `code` set.
    expect(findMatchingCommand(store.getState(), ev({ key: 'c', code: 'KeyC', metaKey: true }))?.id).toBe(
      'edit.copyObject',
    );
  });

  it('edit.copyStyle is unavailable when a group (non-vector) is the primary selection (Fix 3: vectorSelected predicate)', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id1 = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id2 = store.getState().selectedObjectId!;
    store.getState().selectObjects([id1, id2]);
    store.getState().groupSelected();
    const cmd = COMMANDS.find((c) => c.id === 'edit.copyStyle')!;
    expect(cmd.when?.(store.getState())).toBe(false);
  });
});

describe('path.outlineStroke command (Task 2, outline-stroke)', () => {
  it('has no chord, is gated by canOutlineStroke, and runs state.outlineStroke()', () => {
    const cmd = COMMANDS.find((c) => c.id === 'path.outlineStroke')!;
    expect(cmd.chord).toBeUndefined();

    // Unavailable: nothing selected.
    expect(cmd.when?.(store.getState())).toBe(false);

    // Available: a single stroked path selected.
    store.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] });
    expect(cmd.when?.(store.getState())).toBe(true);

    const pastLen = store.getState().history.past.length;
    cmd.run({ state: store.getState(), host: {} as never });
    expect(store.getState().history.past.length).toBe(pastLen + 1); // op actually ran
  });
});

describe('path.shapeBuilder command (art-tools #7)', () => {
  it('has no chord, toggles enter/exit, and stays available to exit even off its own entry gate', () => {
    const cmd = COMMANDS.find((c) => c.id === 'path.shapeBuilder')!;
    expect(cmd.chord).toBeUndefined();

    // Unavailable: nothing selected.
    expect(cmd.when?.(store.getState())).toBe(false);

    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    expect(cmd.when?.(store.getState())).toBe(true);

    // Running it ENTERS the mode.
    cmd.run({ state: store.getState(), host: {} as never });
    expect(store.getState().shapeBuilder).toEqual({ ids: [a, b] });

    // Selection changing to something ineligible would normally fail canShapeBuilder, but the
    // command must stay available to EXIT while active (the `|| !!s.shapeBuilder` OR).
    store.getState().selectObject(null);
    expect(cmd.when?.(store.getState())).toBe(true);

    // Running it again EXITS the mode (toggle).
    cmd.run({ state: store.getState(), host: {} as never });
    expect(store.getState().shapeBuilder).toBeNull();
  });
});

describe('remap-keyframe commands routing (task 3: kfSelected must include selectedRemapKeyframe)', () => {
  function symbolInstanceProject() {
    const inner = createVectorAsset('rect', { id: 'inner-asset' });
    const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0, shapeBase: { width: 10, height: 10 } });
    const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10, duration: 2 });
    const inst = createSceneObject('sym', { id: 'inst', zOrder: 0 });
    const project = createProject();
    project.assets = [inner, sym];
    project.objects = [inst];
    return project;
  }

  it('Delete resolves to edit.deleteKeyframe (NOT edit.deleteObject) when only a remap keyframe is selected; invoking it removes the keyframe and the object SURVIVES', () => {
    store.getState().commit(symbolInstanceProject());
    store.getState().selectObject('inst');
    store.getState().toggleSymbolTimeRemap(); // seeds a symbolTimeTrack (duration=2 > 0 -> 2 keyframes)
    const track = store.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTimeTrack!;
    expect(track.length).toBeGreaterThan(0);
    store.getState().selectRemapKeyframe({ objectId: 'inst', time: track[0].time });

    // The bug: without selectedRemapKeyframe in kfSelected, Delete fell through to edit.deleteObject
    // and deleted the whole instance.
    expect(findMatchingCommand(store.getState(), ev({ key: 'Backspace' }))?.id).toBe('edit.deleteKeyframe');

    const cmd = findMatchingCommand(store.getState(), ev({ key: 'Backspace' }))!;
    cmd.run({ state: store.getState(), host: {} as never });

    const obj = store.getState().history.present.objects.find((o) => o.id === 'inst');
    expect(obj).toBeDefined(); // the object survives
    expect((obj?.symbolTimeTrack ?? []).some((k) => k.time === track[0].time)).toBe(false); // the keyframe is gone
  });

  it('Cmd+C / Cmd+X resolve to the keyframe commands (not the object commands) when only a remap keyframe is selected', () => {
    store.getState().commit(symbolInstanceProject());
    store.getState().selectObject('inst');
    store.getState().toggleSymbolTimeRemap();
    const track = store.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTimeTrack!;
    store.getState().selectRemapKeyframe({ objectId: 'inst', time: track[0].time });

    expect(findMatchingCommand(store.getState(), ev({ key: 'c', metaKey: true }))?.id).toBe('edit.copyKeyframe');
    expect(findMatchingCommand(store.getState(), ev({ key: 'x', metaKey: true }))?.id).toBe('edit.cutKeyframe');

    // Invoking copy snapshots the remap keyframe into the keyframe clipboard (not the object clipboard).
    const copyCmd = COMMANDS.find((c) => c.id === 'edit.copyKeyframe')!;
    copyCmd.run({ state: store.getState(), host: {} as never });
    expect(store.getState().clipboard).toBeNull();
    expect(store.getState().keyframeClipboard).toMatchObject({ kind: 'remap', objectId: 'inst' });
  });
});

describe('path.blend command (art-tools #9)', () => {
  it('has no chord, is gated by canBlend, and runs state.blendSelected(3)', () => {
    const cmd = COMMANDS.find((c) => c.id === 'path.blend')!;
    expect(cmd.chord).toBeUndefined();

    // Unavailable: nothing selected.
    expect(cmd.when?.(store.getState())).toBe(false);

    // Available: exactly 2 vector paths selected.
    store.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 40 } }, { anchor: { x: 100, y: 40 } }] });
    const b = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    expect(cmd.when?.(store.getState())).toBe(true);

    const pastLen = store.getState().history.past.length;
    cmd.run({ state: store.getState(), host: {} as never });
    expect(store.getState().history.past.length).toBe(pastLen + 1); // op actually ran
    expect(store.getState().selectedObjectIds).toHaveLength(3); // blendSelected(3) -> 3 intermediates
  });
});
