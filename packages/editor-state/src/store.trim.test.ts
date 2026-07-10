import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createVectorAsset, createSymbolAsset } from '@savig/engine';
import type { VectorAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

function seedRect(): string {
  const s = store.getState();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  return store.getState().selectedObjectId!;
}

const obj = (id: string) => store.getState().history.present.objects.find((o) => o.id === id)!;
const asset = (id: string): VectorAsset => {
  const a = store.getState().history.present.assets.find((x) => x.id === obj(id).assetId)!;
  if (a.kind !== 'vector') throw new Error('not vector');
  return a;
};

describe('setTrim', () => {
  it('case 1: autoKey OFF sets the base trim value', () => {
    const id = seedRect();
    store.getState().toggleAutoKey(); // OFF
    store.getState().setTrim('end', 0.5);
    expect(obj(id).trim).toEqual({ start: 0, end: 0.5, offset: 0 });
  });

  it('case 2: autoKey OFF back to identity normalizes trim to undefined', () => {
    const id = seedRect();
    store.getState().toggleAutoKey(); // OFF
    store.getState().setTrim('end', 0.5);
    store.getState().setTrim('end', 1);
    expect(obj(id).trim).toBeUndefined();
  });

  it('case 3: setTrim clamps values to [0, 1]', () => {
    const id = seedRect();
    store.getState().toggleAutoKey(); // OFF
    // Establish a non-identity base first so a clamped write can't collapse back to
    // undefined via normalizeTrim, which would mask whether the clamp actually ran.
    store.getState().setTrim('end', 0.9);
    store.getState().setTrim('start', 1.7);
    expect(obj(id).trim!.start).toBe(1);
    store.getState().setTrim('start', -0.3);
    expect(obj(id).trim!.start).toBe(0);
  });

  it('case 4: autoKey ON creates a frame-snapped endTrack keyframe at the playhead', () => {
    const id = seedRect();
    store.getState().seek(1);
    store.getState().setTrim('end', 0.5);
    expect(obj(id).trim!.endTrack).toEqual([{ time: 1, value: 0.5, easing: 'linear' }]);
  });

  it('case 4: a second setTrim at the same time preserves the keyframe\'s prior easing', () => {
    const id = seedRect();
    // Seed a project where the endTrack keyframe at t=1 already has a non-default easing —
    // setSelectedKeyframeEasing has no trim branch (out of scope for this task), so we seed
    // the easing directly to exercise setTrim's priorEasing lookup in isolation.
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === id
          ? { ...o, trim: { start: 0, end: 1, offset: 0, endTrack: [{ time: 1, value: 0.5, easing: 'easeIn' }] } }
          : o,
      ),
    });
    store.getState().seek(1);
    store.getState().setTrim('end', 0.8); // edit value at the same time
    expect(obj(id).trim!.endTrack).toEqual([{ time: 1, value: 0.8, easing: 'easeIn' }]);
  });

  it('case 5: no-op when the asset has an active stroke-dasharray (dash wins)', () => {
    const id = seedRect();
    store.getState().setStrokeDasharray([1, 1]);
    store.getState().toggleAutoKey(); // OFF
    store.getState().setTrim('end', 0.5);
    expect(obj(id).trim).toBeUndefined();
  });
});

describe('trim keyframe selection', () => {
  it('case 6a: selectTrimKeyframe stores the ref and clears other keyframe selections', () => {
    const id = seedRect();
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5);
    store.getState().selectDashKeyframe({ objectId: id, time: 0 }); // an unrelated prior selection
    const ref = { objectId: id, prop: 'end' as const, time: 0 };
    store.getState().selectTrimKeyframe(ref);
    expect(store.getState().selectedTrimKeyframe).toEqual(ref);
    expect(store.getState().selectedDashKeyframe).toBeNull();
  });

  it('case 6b: removeSelectedTrimKeyframe deletes the keyframe and drops the emptied track', () => {
    const id = seedRect();
    store.getState().toggleAutoKey(); // OFF
    store.getState().setTrim('start', 0.2); // non-identity base, so trim survives normalization
    store.getState().toggleAutoKey(); // ON
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5);
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    store.getState().removeSelectedTrimKeyframe();
    expect(obj(id).trim!.endTrack).toBeUndefined();
    expect(obj(id).trim!.start).toBe(0.2);
    expect(store.getState().selectedTrimKeyframe).toBeNull();
  });

  it('case 6c: removeSelectedTrimKeyframe normalizes an identity-and-trackless trim back to undefined', () => {
    const id = seedRect();
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5); // base stays identity {0,1,0}; only endTrack is written
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    store.getState().removeSelectedTrimKeyframe();
    expect(obj(id).trim).toBeUndefined();
  });
});

describe('drawOn (trim-based)', () => {
  it('case 7: seeds trim {0,1,0} with a 0->1 endTrack over [playhead, +1s]; clears any dashOffsetTrack', () => {
    const id = seedRect();
    store.getState().seek(0);
    store.getState().setStrokeDashoffset(1); // a stale dash-offset track that must be cleared
    store.getState().drawOn();
    expect(obj(id).trim).toEqual({
      start: 0,
      end: 1,
      offset: 0,
      endTrack: [
        { time: 0, value: 0, easing: 'linear' },
        { time: 1, value: 1, easing: 'linear' },
      ],
    });
    expect(asset(id).style.strokeDasharray).toBeUndefined(); // was unset; untouched
    expect(obj(id).dashOffsetTrack).toBeUndefined();
  });

  it('case 8: with a pre-existing dash pattern, clears strokeDasharray AND strokeDashoffset in one commit', () => {
    const id = seedRect();
    store.getState().setStrokeDasharray([2, 2]);
    store.getState().toggleAutoKey(); // OFF, so setStrokeDashoffset writes the static style
    store.getState().setStrokeDashoffset(0.4);
    store.getState().toggleAutoKey(); // ON

    expect(asset(id).style.strokeDasharray).toEqual([2, 2]);
    expect(asset(id).style.strokeDashoffset).toBe(0.4);

    store.getState().seek(0);
    store.getState().drawOn();
    expect(asset(id).style.strokeDasharray).toBeUndefined();
    expect(asset(id).style.strokeDashoffset).toBeUndefined();
    expect(obj(id).trim).toBeDefined();

    store.getState().undo(); // a single undo step restores BOTH style fields
    expect(asset(id).style.strokeDasharray).toEqual([2, 2]);
    expect(asset(id).style.strokeDashoffset).toBe(0.4);
  });
});

describe('trim inside a symbol scope', () => {
  function symbolWithRect() {
    const s = store.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const rectObj = createSceneObject('rect-asset', { id: 'r', zOrder: 0 });
    rectObj.shapeBase = { width: 10, height: 10 };
    const sym = createSymbolAsset({ id: 'sym', objects: [rectObj], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('r');
  }
  const symObj0 = () =>
    (store.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('@savig/engine').SceneObject[] })
      .objects[0];

  it('case 9: setTrim (autoKey off) writes the base trim onto the SYMBOL object, not root', () => {
    symbolWithRect();
    store.getState().toggleAutoKey(); // OFF
    store.getState().setTrim('end', 0.5);
    expect(symObj0().trim).toEqual({ start: 0, end: 0.5, offset: 0 });
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('case 9: drawOn() writes the trim window onto the SYMBOL object, not root', () => {
    symbolWithRect();
    store.getState().seek(0);
    store.getState().drawOn();
    expect(symObj0().trim!.endTrack).toEqual([
      { time: 0, value: 0, easing: 'linear' },
      { time: 1, value: 1, easing: 'linear' },
    ]);
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });
});

describe('trim keyframe copy/paste/retime/easing (Task 6, mirrors dash)', () => {
  it('case 10: copyKeyframe() on a selected trim keyframe populates the clipboard with kind "trim" + prop', () => {
    const id = seedRect();
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5);
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    store.getState().copyKeyframe();
    expect(store.getState().keyframeClipboard).toEqual({
      kind: 'trim',
      objectId: id,
      prop: 'end',
      keyframe: { time: 0, value: 0.5, easing: 'linear' },
    });
  });

  it('case 11: pasteKeyframe() upserts on the same prop track at the snapped playhead; selection follows', () => {
    const id = seedRect();
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5);
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    store.getState().copyKeyframe();
    store.getState().seek(1);
    store.getState().pasteKeyframe();
    const track = obj(id).trim!.endTrack!;
    expect(track).toHaveLength(2);
    const pasted = track.find((k) => Math.abs(k.time - 1) < 1e-6);
    expect(pasted?.value).toBe(0.5);
    expect(store.getState().selectedTrimKeyframe).toEqual({ objectId: id, prop: 'end', time: 1 });
  });

  it('case 12: retimeSelectedKeyframe moves the keyframe (value preserved, reselected); no-ops when the target collides with its own time within KF_EPS', () => {
    const id = seedRect();
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5);
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    store.getState().retimeSelectedKeyframe(1);
    const track = obj(id).trim!.endTrack!;
    expect(track.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false); // old time gone
    const moved = track.find((k) => Math.abs(k.time - 1) < 1e-6)!;
    expect(moved.value).toBe(0.5);
    expect(store.getState().selectedTrimKeyframe).toEqual({ objectId: id, prop: 'end', time: 1 });

    const past = store.getState().history.past.length;
    store.getState().retimeSelectedKeyframe(1); // target === current time -> no-op (no history entry)
    expect(store.getState().history.past.length).toBe(past);
  });

  it('case 13: setSelectedKeyframeEasing rewrites only the selected trim keyframe\'s easing', () => {
    const id = seedRect();
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5);
    store.getState().seek(1);
    store.getState().setTrim('end', 0.8);
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    store.getState().setSelectedKeyframeEasing('easeIn');
    const track = obj(id).trim!.endTrack!;
    expect(track.find((k) => Math.abs(k.time - 0) < 1e-6)?.easing).toBe('easeIn');
    expect(track.find((k) => Math.abs(k.time - 1) < 1e-6)?.easing).toBe('linear'); // unaffected
  });

  it('case 14: deleteSelectedKeyframe() dispatches to removeSelectedTrimKeyframe for a selected trim keyframe', () => {
    const id = seedRect();
    store.getState().seek(0);
    store.getState().setTrim('end', 0.5);
    store.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    store.getState().deleteSelectedKeyframe();
    expect(obj(id).trim).toBeUndefined();
    expect(store.getState().selectedTrimKeyframe).toBeNull();
  });
});
