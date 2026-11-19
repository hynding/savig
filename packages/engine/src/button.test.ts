import { describe, expect, it, vi } from 'vitest';
import { buttonInstanceIds, buttonStatesOf, buttonVisibility, DEFAULT_BUTTON_STATES, isButtonState } from './button';
import { flattenInstances } from './symbol';
import { createSession } from './script/session';
import { createGroupObject, createProject, createSceneObject, createSymbolAsset, createVectorAsset } from './project';
import type { ButtonState, Project, SceneObject } from './types';

function leaf(id: string, z: number, states?: ButtonState[]): SceneObject {
  const o = createSceneObject(`asset-${id}`, { id, name: id, zOrder: z });
  if (states) o.buttonStates = states;
  return o;
}

/** A button symbol with a face (default states), an over-only glow, a down-only shadow and a
 *  hit-only pad; one top-level instance `btn`. */
function buttonProject(button = true): Project {
  const p = createProject();
  const face = leaf('face', 1);
  const glow = leaf('glow', 2, ['over']);
  const shadow = leaf('shadow', 3, ['down']);
  const pad = leaf('pad', 4, ['hit']);
  p.assets = [
    ...['face', 'glow', 'shadow', 'pad'].map((id) => createVectorAsset('rect', { id: `asset-${id}` })),
    { ...createSymbolAsset({ id: 'sym-btn', objects: [face, glow, shadow, pad] }), button },
  ];
  p.objects = [createSceneObject('sym-btn', { id: 'btn', name: 'btn', zOrder: 1 })];
  return p;
}

function view(p: Project, states?: Map<string, ButtonState>) {
  return Object.fromEntries(
    flattenInstances(p, 0, states ? { buttonStates: states } : undefined).map((l) => [
      l.object.id,
      { exposed: l.exposed, opacity: l.opacityFactor, buttonOf: l.buttonOf },
    ]),
  );
}

describe('button rules', () => {
  it('objects default to Up, Over and Down; groups pass their states to their subtree', () => {
    const g = createGroupObject({ id: 'g', name: 'g', zOrder: 1, anchorX: 0, anchorY: 0 });
    g.buttonStates = ['over'];
    const child = leaf('c', 1);
    child.parentId = 'g';
    const byId = new Map([g, child].map((o) => [o.id, o] as const));
    expect(buttonStatesOf(leaf('x', 1), byId)).toEqual(DEFAULT_BUTTON_STATES);
    expect(buttonStatesOf(child, byId)).toEqual(['over']);
    expect(buttonVisibility(['up', 'hit'], 'over')).toBe('hit');
    expect(buttonVisibility(['up'], 'over')).toBe('hide');
    expect(buttonVisibility(['over'], 'over')).toBe('show');
    expect(isButtonState('hit')).toBe(true);
    expect(isButtonState('hover')).toBe(false);
  });

  it('lists instances of button symbols only', () => {
    expect([...buttonInstanceIds(buttonProject())]).toEqual(['btn']);
    expect(buttonInstanceIds(buttonProject(false)).size).toBe(0);
  });
});

describe('flattenInstances with button symbols', () => {
  it('draws the Up state by default: Over/Down content unexposed, hit content transparent', () => {
    const v = view(buttonProject());
    expect(v.face).toEqual({ exposed: true, opacity: 1, buttonOf: 'btn' });
    expect(v.glow.exposed).toBe(false);
    expect(v.shadow.exposed).toBe(false);
    expect(v.pad).toEqual({ exposed: true, opacity: 0, buttonOf: 'btn' });
  });

  it('shows the state the player passes for that instance', () => {
    const over = view(buttonProject(), new Map([['btn', 'over' as const]]));
    expect(over.glow.exposed).toBe(true);
    expect(over.shadow.exposed).toBe(false);
    const down = view(buttonProject(), new Map([['btn', 'down' as const]]));
    expect(down.glow.exposed).toBe(false);
    expect(down.shadow.exposed).toBe(true);
    expect(down.face.exposed).toBe(true);
  });

  it('keeps the same leaves in every state (time-invariant skeleton)', () => {
    const ids = (s?: Map<string, ButtonState>) => flattenInstances(buttonProject(), 0, s && { buttonStates: s }).map((l) => l.renderId);
    expect(ids(new Map([['btn', 'down']]))).toEqual(ids());
  });

  it('an ordinary symbol ignores buttonStates (parity)', () => {
    const v = view(buttonProject(false));
    expect(v.glow).toEqual({ exposed: undefined, opacity: 1, buttonOf: undefined });
    expect(v.pad.opacity).toBe(1);
  });

  it('nested symbols inside a button inherit the state of the object holding them', () => {
    const p = buttonProject();
    p.assets.push(createVectorAsset('rect', { id: 'asset-deep' }));
    p.assets.push(createSymbolAsset({ id: 'sym-inner', objects: [leaf('deep', 1)] }));
    const btn = p.assets.find((a) => a.id === 'sym-btn');
    if (btn?.kind !== 'symbol') throw new Error('no button');
    const holder = createSceneObject('sym-inner', { id: 'holder', name: 'holder', zOrder: 5 });
    holder.buttonStates = ['down'];
    btn.objects.push(holder);
    expect(view(p).deep.exposed).toBe(false);
    expect(view(p, new Map([['btn', 'down']])).deep.exposed).toBe(true);
    expect(view(p).deep.buttonOf).toBe('btn');
  });
});

describe('interactive session button states', () => {
  const host = () => ({ play: vi.fn(), pause: vi.fn(), seek: vi.fn(), now: () => 0, random: () => 0.5, warn: vi.fn() });

  it('goes Over on hover, Down on press, back to Over on release and Up on leave', () => {
    const s = createSession(buttonProject(), host());
    const changes = vi.fn();
    s.onChange(changes);
    expect(s.buttonStates().size).toBe(0);
    s.pointerAt(['btn']);
    expect(s.buttonStates().get('btn')).toBe('over');
    s.firePointer('pointerdown', ['btn']);
    expect(s.buttonStates().get('btn')).toBe('down');
    s.firePointer('pointerup', []);
    expect(s.buttonStates().get('btn')).toBe('over');
    s.pointerAt(null);
    expect(s.buttonStates().has('btn')).toBe(false);
    expect(changes).toHaveBeenCalledTimes(4);
  });

  it('a press dragged off the button shows Up until the pointer returns', () => {
    const s = createSession(buttonProject(), host());
    s.pointerAt(['btn']);
    s.firePointer('pointerdown', ['btn']);
    s.pointerAt(null);
    expect(s.buttonStates().has('btn')).toBe(false);
    s.pointerAt(['btn']);
    expect(s.buttonStates().get('btn')).toBe('down');
  });

  it('ignores hovering objects that are not buttons, and reset clears states', () => {
    const p = buttonProject();
    p.objects.push(leaf('plain', 2));
    const s = createSession(p, host());
    s.pointerAt(['plain']);
    expect(s.buttonStates().size).toBe(0);
    s.pointerAt(['btn']);
    s.reset();
    expect(s.buttonStates().size).toBe(0);
  });
});

describe('static-symbol export optimization', () => {
  it('a button symbol is never treated as a static snapshot', async () => {
    const { isStaticSymbol } = await import('./duration');
    const p = buttonProject();
    const byId = new Map(p.assets.map((a) => [a.id, a] as const));
    const sym = byId.get('sym-btn');
    if (sym?.kind !== 'symbol') throw new Error('no button');
    expect(isStaticSymbol(sym, byId)).toBe(false);
    expect(isStaticSymbol({ ...sym, button: undefined }, byId)).toBe(true);
  });
});

describe('rootButtonState (editing inside a button)', () => {
  it('treats the root list as button content in the previewed state', () => {
    const p = createProject();
    p.assets = ['face', 'glow', 'pad'].map((id) => createVectorAsset('rect', { id: `asset-${id}` }));
    p.objects = [leaf('face', 1), leaf('glow', 2, ['over']), leaf('pad', 3, ['hit'])];
    const at = (state?: ButtonState | 'all') =>
      Object.fromEntries(flattenInstances(p, 0, { rootButtonState: state }).map((l) => [l.object.id, [l.exposed, l.opacityFactor]]));
    expect(at()).toEqual({ face: [undefined, 1], glow: [undefined, 1], pad: [undefined, 1] }); // no preview: all, parity
    expect(at('up')).toEqual({ face: [true, 1], glow: [false, 1], pad: [true, 0] });
    expect(at('all')).toEqual({ face: [true, 1], glow: [true, 1], pad: [true, 1] });
    expect(at('hit')).toEqual({ face: [false, 1], glow: [false, 1], pad: [true, 1] }); // Hit preview draws the hit area
  });
});
