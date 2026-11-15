// Motion presets (spec 2026-11-15-motion-presets): the store verb.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, sampleObject, type SceneObject } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const byId = (id: string): SceneObject => selectActiveObjects(st()).find((o) => o.id === id)!;
const rect = (x: number): string => {
  st().addVectorShape('rect', { x, y: 0, width: 10, height: 10 });
  return st().selectedObjectId!;
};

beforeEach(() => st().setProject(createProject({ fps: 10 })));

describe('applyMotionPreset', () => {
  it('animates every selected object from the playhead in one undo step', () => {
    const a = rect(0);
    const b = rect(100);
    st().selectObjects([a, b]);
    st().seek(0);
    const before = st().history.past.length;
    expect(st().applyMotionPreset('slide-in-left')).toBe(2);
    expect(st().history.past.length).toBe(before + 1);
    for (const id of [a, b]) {
      const o = byId(id);
      expect(sampleObject(o, 0).x).toBeCloseTo(o.base.x - 200, 6);
      expect(sampleObject(o, 0.6).x).toBeCloseTo(o.base.x, 6);
    }
    st().undo();
    expect(byId(a).tracks.x).toBeUndefined();
  });

  it('honours a custom duration; skips locked objects; unknown preset or no selection is a no-op', () => {
    const a = rect(0);
    st().applyMotionPreset('fade-in', { duration: 2 });
    expect(byId(a).tracks.opacity!.at(-1)!.time).toBe(2);
    const b = rect(50);
    st().toggleObjectLock(b);
    st().selectObjects([b]);
    st().selectObject(b);
    expect(st().applyMotionPreset('pulse')).toBe(0);
    expect(st().applyMotionPreset('no-such-preset')).toBe(0);
    st().selectObjects([]);
    expect(st().applyMotionPreset('pulse')).toBe(0);
  });
});

describe('custom motion presets', () => {
  const animate = (id: string) => {
    st().selectObject(id);
    st().seek(0);
    st().setProperty('x', 0);
    st().seek(1, { pastEnd: true });
    st().setProperty('x', 80);
  };

  it('save → apply to another object → rename → delete, each one undo step', () => {
    const a = rect(0);
    animate(a);
    const n0 = st().history.past.length;
    const id = st().saveMotionPreset('  Glide  ')!;
    expect(id).toMatch(/^custom-/);
    expect(st().history.past.length).toBe(n0 + 1);
    expect(st().history.present.motionPresets).toEqual([expect.objectContaining({ id, name: 'Glide', category: 'custom', duration: 1 })]);

    const b = rect(300);
    st().selectObject(b);
    st().seek(0);
    expect(st().applyMotionPreset(id)).toBe(1);
    expect(sampleObject(byId(b), 1).x).toBeCloseTo(byId(b).base.x + 80, 6);

    st().renameMotionPreset(id, 'Slide');
    expect(st().history.present.motionPresets![0].name).toBe('Slide');
    st().renameMotionPreset(id, '   '); // blank: ignored
    expect(st().history.present.motionPresets![0].name).toBe('Slide');
    st().deleteMotionPreset(id);
    expect('motionPresets' in st().history.present).toBe(false);
    st().undo();
    expect(st().history.present.motionPresets![0].name).toBe('Slide');
  });

  it('an object without transform motion cannot be saved', () => {
    rect(0);
    expect(st().saveMotionPreset('x')).toBeNull();
    expect(st().history.present.motionPresets).toBeUndefined();
  });
});
