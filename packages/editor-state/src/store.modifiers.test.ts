// Property modifiers (spec 2026-11-16-property-modifiers): editing a wiggling property.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, sampleObject, withModifier, type SceneObject } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const byId = (id: string): SceneObject => selectActiveObjects(st()).find((o) => o.id === id)!;

beforeEach(() => st().setProject(createProject({ fps: 10 })));

describe('editing a property that wiggles', () => {
  it('stores the value without the wiggle, so the object lands where the user put it', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = st().selectedObjectId!;
    const p = st().history.present;
    st().setProject({ ...p, objects: p.objects.map((o) => (o.id === id ? withModifier(o, 'x', { wiggle: { amplitude: 30, frequency: 1, seed: 2 } }) : o)) });
    st().selectObjects([id]);
    if (!st().autoKey) st().toggleAutoKey();
    st().seek(0.7);
    expect(Math.abs(sampleObject(byId(id), 0.7).x - byId(id).base.x)).toBeGreaterThan(1); // it really wiggles here
    st().setProperty('x', 120);
    expect(sampleObject(byId(id), 0.7).x).toBeCloseTo(120, 6);
    st().nudgeSelected(5, 0);
    expect(sampleObject(byId(id), 0.7).x).toBeCloseTo(125, 6);
  });
});

describe('setPropertyModifier', () => {
  it('adds, merges and removes a modifier in single undo steps', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = st().selectedObjectId!;
    st().setPropertyModifier('rotation', { wiggle: { amplitude: 10, frequency: 2 } });
    expect(byId(id).modifiers).toEqual({ rotation: { wiggle: { amplitude: 10, frequency: 2 } } });
    // nothing else animated -> the project gets a 2 s manual duration in the same step
    expect(st().history.present.meta).toMatchObject({ durationMode: 'manual', duration: 2 });
    st().setPropertyModifier('rotation', { loop: 'cycle' });
    expect(byId(id).modifiers!.rotation).toEqual({ wiggle: { amplitude: 10, frequency: 2 }, loop: 'cycle' });
    const before = st().history.past.length;
    st().setPropertyModifier('rotation', { loop: 'cycle' }); // unchanged: no commit
    expect(st().history.past.length).toBe(before);
    st().setPropertyModifier('rotation', null);
    expect('modifiers' in byId(id)).toBe(false);
    st().undo();
    expect(byId(id).modifiers!.rotation!.loop).toBe('cycle');
    st().undo();
    st().undo();
    expect('modifiers' in byId(id)).toBe(false);
    expect(st().history.present.meta.durationMode).toBe('auto');
  });

  it('keeps an existing duration when something else already animates', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    if (!st().autoKey) st().toggleAutoKey();
    st().seek(0);
    st().setProperty('x', 0);
    st().seek(1);
    st().setProperty('x', 50);
    st().setPropertyModifier('y', { wiggle: { amplitude: 5, frequency: 1 } });
    expect(st().history.present.meta.durationMode).toBe('auto');
  });
});
