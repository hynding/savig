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
