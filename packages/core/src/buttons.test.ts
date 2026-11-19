import { describe, expect, it } from 'vitest';
import { createProject, flattenInstances } from '@savig/engine';
import type { Project, SymbolAsset } from '@savig/engine';
import { addRect } from './build';
import { createButton, setButtonStates, setSymbolButton } from './buttons';
import { describeProject } from './describe';
import { validateProject } from './validate';

function scene(): Project {
  let p = createProject({ width: 200, height: 100 });
  ({ project: p } = addRect(p, { id: 'face', x: 10, y: 10, width: 80, height: 40 }));
  ({ project: p } = addRect(p, { id: 'glow', x: 10, y: 10, width: 80, height: 40 }));
  return p;
}
const sym = (p: Project, id = 'b') => p.assets.find((a) => a.id === id) as SymbolAsset;

describe('createButton', () => {
  it('wraps the objects into a button symbol and places one instance; Up draws as before', () => {
    const before = scene();
    const p = createButton(before, ['face', 'glow'], { symbolId: 'b', instanceId: 'btn', states: { glow: ['over', 'down'] } });
    expect(sym(p).button).toBe(true);
    expect(sym(p).objects.map((o) => o.id)).toEqual(['face', 'glow']);
    expect(sym(p).objects[1].buttonStates).toEqual(['over', 'down']);
    expect(p.objects.map((o) => o.id)).toEqual(['btn']);
    expect([p.objects[0].anchorX, p.objects[0].anchorY]).toEqual([50, 30]);
    const leaves = flattenInstances(p, 0);
    expect(leaves.map((l) => [l.renderId, l.exposed])).toEqual([['btn/face', true], ['btn/glow', false]]);
    expect(validateProject(p)).toEqual([]);
    expect(describeProject(p)).toContain('BUTTON states: glow=over/down');
  });

  it('fails loud on bad input', () => {
    expect(() => createButton(scene(), [])).toThrow(/at least one/);
    expect(() => createButton(scene(), ['nope'])).toThrow(/no object/);
    expect(() => createButton(scene(), ['face'], { states: { glow: ['up'] } })).toThrow(/not a button member/);
    expect(() => createButton(scene(), ['face'], { states: { face: ['hover'] } })).toThrow(/unknown button state/);
  });
});

describe('setButtonStates / setSymbolButton', () => {
  it('sets, normalizes and clears states; toggles the button flag', () => {
    let p = createButton(scene(), ['face', 'glow'], { symbolId: 'b' });
    p = setButtonStates(p, 'b', 'face', ['hit', 'up', 'up']);
    expect(sym(p).objects[0].buttonStates).toEqual(['up', 'hit']);
    p = setButtonStates(p, 'b', 'face', ['down', 'up', 'over']);
    expect('buttonStates' in sym(p).objects[0]).toBe(false);
    expect(() => setButtonStates(p, 'b', 'nope', ['up'])).toThrow(/has no object/);
    p = setButtonStates(p, 'b', 'face', ['over']);
    p = setSymbolButton(p, 'b', false);
    expect('button' in sym(p)).toBe(false);
    expect(validateProject(p).map((i) => i.code)).toEqual(['button-states-ignored']);
  });

  it('validate flags unknown states', () => {
    const p = createButton(scene(), ['face'], { symbolId: 'b' });
    const bad = { ...p, assets: p.assets.map((a) => (a.id === 'b' && a.kind === 'symbol' ? { ...a, objects: [{ ...a.objects[0], buttonStates: ['hover'] as never }] } : a)) };
    expect(validateProject(bad).map((i) => i.code)).toEqual(['button-state-unknown']);
  });
});
