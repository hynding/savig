// Button symbols (spec 2026-11-19-button-symbols): store verbs.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import type { SymbolAsset } from '@savig/engine';
import { selectActiveObjects } from './selectors';
import { normalizeButtonStates } from './slices/buttonSlice';

const st = () => store.getState();
const sym = () => st().history.present.assets.find((a) => a.id === 'S') as SymbolAsset;
const inner = (id: string) => selectActiveObjects(st()).find((o) => o.id === id)!;

beforeEach(() => {
  st().setProject(createProject());
  st().addAsset(createVectorAsset('rect', { id: 'va' }));
  st().addAsset(
    createSymbolAsset({ id: 'S', objects: [createSceneObject('va', { id: 'face' }), createSceneObject('va', { id: 'glow' })] }),
  );
});

describe('button verbs', () => {
  it('setSymbolButton toggles the flag in one undo step and clears it when off', () => {
    st().setSymbolButton('S', true);
    expect(sym().button).toBe(true);
    st().setSymbolButton('S', true); // no-op
    st().undo();
    expect(sym().button).toBeUndefined();
    st().setSymbolButton('S', true);
    st().setSymbolButton('S', false);
    expect('button' in sym()).toBe(false);
  });

  it('setButtonStates sets the selected objects inside a button; the default set clears it', () => {
    st().setSymbolButton('S', true);
    st().enterSymbol('S');
    st().selectObject('glow');
    st().setButtonStates(['over', 'up', 'over']);
    expect(inner('glow').buttonStates).toEqual(['up', 'over']);
    expect(inner('face').buttonStates).toBeUndefined();
    st().setButtonStates(['down', 'over', 'up']);
    expect('buttonStates' in inner('glow')).toBe(false);
    st().undo();
    expect(inner('glow').buttonStates).toEqual(['up', 'over']);
  });

  it('refuses outside a button symbol', () => {
    st().enterSymbol('S'); // not a button
    st().selectObject('glow');
    st().setButtonStates(['hit']);
    expect(inner('glow').buttonStates).toBeUndefined();
    expect(st().toasts[0]?.message).toMatch(/inside a button symbol/);
  });

  it('normalizeButtonStates orders and dedupes', () => {
    expect(normalizeButtonStates(['hit', 'up', 'hit'])).toEqual(['up', 'hit']);
    expect(normalizeButtonStates(['up', 'over', 'down'])).toBeUndefined();
    expect(normalizeButtonStates([])).toEqual([]);
  });
});

describe('Convert to button and state preview', () => {
  it('createSymbol({ button }) makes a button symbol named Button', () => {
    st().setProject(createProject());
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    st().createSymbol({ button: true });
    const made = st().history.present.assets.find((a) => a.kind === 'symbol') as SymbolAsset;
    expect(made.button).toBe(true);
    expect(made.name).toBe('Button');
    expect(st().history.present.objects[0].name).toBe('Button');
  });

  it('the preview state only sticks inside a button and clears on leaving', () => {
    st().enterSymbol('S'); // not a button
    st().setButtonPreviewState('over');
    expect(st().buttonPreviewState).toBeNull();
    st().exitSymbol();
    st().setSymbolButton('S', true);
    st().enterSymbol('S');
    st().setButtonPreviewState('over');
    expect(st().buttonPreviewState).toBe('over');
    st().exitSymbol();
    expect(st().buttonPreviewState).toBeNull();
  });
});
