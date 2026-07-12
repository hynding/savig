import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { computeProjectDuration, createProject, createSceneObject, createVectorAsset, createSymbolAsset } from '@savig/engine';
import type { PathData, VectorAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

function seedStar(): string {
  const s = store.getState();
  s.addPrimitive({ kind: 'star', cx: 50, cy: 50, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
  return store.getState().selectedObjectId!;
}

const obj = (id: string) => store.getState().history.present.objects.find((o) => o.id === id)!;
const asset = (id: string): VectorAsset => {
  const a = store.getState().history.present.assets.find((x) => x.id === obj(id).assetId)!;
  if (a.kind !== 'vector') throw new Error('not vector');
  return a;
};

describe('setPrimitiveParam', () => {
  it('case 1: autoKey OFF overwrites the spec value and regenerates the path; no track written', () => {
    const id = seedStar();
    store.getState().toggleAutoKey(); // OFF
    const prevPath = asset(id).path;
    store.getState().setPrimitiveParam('points', 7);
    expect(asset(id).primitive!.points).toBe(7);
    expect(asset(id).path).not.toEqual(prevPath); // regenerated
    expect(obj(id).tracks.starPoints).toBeUndefined();
  });

  it('case 2: autoKey ON keyframes the MAPPED track at the snapped playhead; spec untouched', () => {
    const id = seedStar();
    const specBefore = asset(id).primitive;
    store.getState().seek(1);
    store.getState().setPrimitiveParam('points', 7);
    expect(obj(id).tracks.starPoints).toEqual([{ time: 1, value: 7, easing: 'linear' }]);
    expect(asset(id).primitive).toEqual(specBefore); // unchanged

    // Second call at the same time preserves the first keyframe's easing.
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === id ? { ...o, tracks: { ...o.tracks, starPoints: [{ time: 1, value: 7, easing: 'easeIn' as const }] } } : o,
      ),
    });
    store.getState().setPrimitiveParam('points', 9);
    expect(obj(id).tracks.starPoints).toEqual([{ time: 1, value: 9, easing: 'easeIn' }]);
  });

  it('case 3: rotation maps to tracks.primitiveRotation in degrees; autoKey OFF converts degrees -> radians onto spec.rotation', () => {
    const id = seedStar();
    store.getState().seek(2);
    store.getState().setPrimitiveParam('rotation', 90);
    expect(obj(id).tracks.primitiveRotation).toEqual([{ time: 2, value: 90, easing: 'linear' }]);
    expect(asset(id).primitive!.rotation).toBe(0); // autoKey ON path: spec untouched

    store.getState().toggleAutoKey(); // OFF
    const prevPath = asset(id).path;
    store.getState().setPrimitiveParam('rotation', 90);
    expect(asset(id).primitive!.rotation).toBeCloseTo(Math.PI / 2);
    expect(asset(id).path).not.toEqual(prevPath); // regenerated
  });

  it('case 4: kind guards no-op in both autoKey modes; clamps apply in both modes', () => {
    const id = seedStar(); // a star: 'sides' is a polygon-only param
    // autoKey ON: guard no-ops (no track written).
    store.getState().seek(1);
    store.getState().setPrimitiveParam('sides', 6);
    expect(obj(id).tracks.sides).toBeUndefined();
    // autoKey OFF: guard still no-ops (spec untouched).
    store.getState().toggleAutoKey(); // OFF
    store.getState().setPrimitiveParam('sides', 6);
    expect(asset(id).primitive!.sides).toBeUndefined();

    // Clamps, autoKey OFF: points >= 2 int, innerRatio in [0.01, 0.99], cornerRadius >= 0.
    store.getState().setPrimitiveParam('points', 1.9);
    expect(asset(id).primitive!.points).toBe(2);
    store.getState().setPrimitiveParam('innerRatio', 5);
    expect(asset(id).primitive!.innerRatio).toBe(0.99);
    store.getState().setPrimitiveParam('innerRatio', -1);
    expect(asset(id).primitive!.innerRatio).toBe(0.01);
    store.getState().setPrimitiveParam('cornerRadius', -5);
    expect(asset(id).primitive!.cornerRadius).toBe(0);

    // Clamps, autoKey ON: same clamps apply to the keyframe value.
    store.getState().toggleAutoKey(); // ON
    store.getState().seek(3);
    store.getState().setPrimitiveParam('points', 1.9);
    expect(obj(id).tracks.starPoints!.find((k) => k.time === 3)?.value).toBe(2);
    store.getState().setPrimitiveParam('innerRatio', 5);
    expect(obj(id).tracks.innerRatio!.find((k) => k.time === 3)?.value).toBe(0.99);
  });

  it('case 4b: sides/points ROUND to the nearest int (not floor) — matches sample.ts (final-review fix 3)', () => {
    const id = seedStar();
    store.getState().toggleAutoKey(); // OFF
    store.getState().setPrimitiveParam('points', 6.7);
    expect(asset(id).primitive!.points).toBe(7); // round(6.7) = 7; floor(6.7) would be 6

    store.getState().toggleAutoKey(); // ON
    store.getState().seek(4);
    store.getState().setPrimitiveParam('points', 6.7);
    expect(obj(id).tracks.starPoints!.find((k) => k.time === 4)?.value).toBe(7);

    // 'sides' rounds the same way (polygon-only param).
    store.getState().toggleAutoKey(); // OFF
    store.getState().addPrimitive({ kind: 'polygon', cx: 50, cy: 50, radius: 40, rotation: 0, sides: 5, cornerRadius: 0 });
    const polyId = store.getState().selectedObjectId!; // fresh read: addPrimitive above mutated state
    store.getState().setPrimitiveParam('sides', 6.7);
    expect(asset(polyId).primitive!.sides).toBe(7);
  });

  it('case 4c: Number.isFinite guard rejects NaN/Infinity for every param, both autoKey modes (final-review fix 3)', () => {
    const id = seedStar();
    store.getState().toggleAutoKey(); // OFF
    const before = asset(id).primitive;
    store.getState().setPrimitiveParam('points', NaN);
    expect(asset(id).primitive).toEqual(before);
    store.getState().setPrimitiveParam('innerRatio', Infinity);
    expect(asset(id).primitive).toEqual(before);
    store.getState().setPrimitiveParam('rotation', -Infinity);
    expect(asset(id).primitive).toEqual(before);
    store.getState().setPrimitiveParam('cornerRadius', NaN);
    expect(asset(id).primitive).toEqual(before);

    store.getState().toggleAutoKey(); // ON
    store.getState().seek(2);
    store.getState().setPrimitiveParam('points', NaN);
    expect(obj(id).tracks.starPoints).toBeUndefined();
    store.getState().setPrimitiveParam('rotation', Infinity);
    expect(obj(id).tracks.primitiveRotation).toBeUndefined();
  });

  // Task 3 (follow-ups batch 2): a non-empty shapeTrack permanently shadows primitive param
  // tracks (sample.ts's morph-wins branch) — writing one here would just recreate the orphan
  // track that the shapeTrack-add strip (addShapeKeyframe / setPathData) removes. Guards BEFORE
  // the finite/kind/clamp checks, both autoKey modes, silent no-op (no track, no commit).
  it('case 4d: shapeTrack present -> setPrimitiveParam is a silent no-op (shadowed-write guard)', () => {
    const id = seedStar();
    store.getState().addShapeKeyframe(); // establishes a non-empty shapeTrack
    const pastLength = store.getState().history.past.length;
    const specBefore = asset(id).primitive;

    store.getState().seek(2);
    store.getState().setPrimitiveParam('points', 8); // autoKey ON — would otherwise keyframe starPoints
    expect(obj(id).tracks.starPoints).toBeUndefined();
    expect(asset(id).primitive).toEqual(specBefore);
    expect(store.getState().history.past.length).toBe(pastLength); // no commit

    store.getState().toggleAutoKey(); // OFF — would otherwise overwrite the spec
    store.getState().setPrimitiveParam('points', 9);
    expect(asset(id).primitive).toEqual(specBefore);
    expect(store.getState().history.past.length).toBe(pastLength); // still no commit
  });

  it('case 4e: shapeTrack absent -> setPrimitiveParam is unchanged (parity)', () => {
    const id = seedStar();
    expect(obj(id).shapeTrack ?? []).toHaveLength(0);
    store.getState().seek(1);
    store.getState().setPrimitiveParam('points', 8);
    expect(obj(id).tracks.starPoints).toEqual([{ time: 1, value: 8, easing: 'linear' }]);
  });

  it('case 5: node-edit detach strips all five primitive track keys in the same commit; other tracks survive', () => {
    const id = seedStar();
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === id
          ? {
              ...o,
              tracks: {
                x: [{ time: 0, value: 5, easing: 'linear' as const }],
                sides: [{ time: 0, value: 3, easing: 'linear' as const }],
                starPoints: [{ time: 0, value: 5, easing: 'linear' as const }],
                innerRatio: [{ time: 0, value: 0.5, easing: 'linear' as const }],
                primitiveRotation: [{ time: 0, value: 10, easing: 'linear' as const }],
                cornerRadius: [{ time: 0, value: 1, easing: 'linear' as const }],
              },
            }
          : o,
      ),
    });
    const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 10 } }] };
    const pastLength = store.getState().history.past.length;
    store.getState().setPathData(path);
    expect(asset(id).primitive).toBeUndefined();
    const tracks = obj(id).tracks;
    expect(tracks.sides).toBeUndefined();
    expect(tracks.starPoints).toBeUndefined();
    expect(tracks.innerRatio).toBeUndefined();
    expect(tracks.primitiveRotation).toBeUndefined();
    expect(tracks.cornerRadius).toBeUndefined();
    expect(tracks.x).toEqual([{ time: 0, value: 5, easing: 'linear' }]); // untouched
    // One commit for both the asset detach and the track strip.
    expect(store.getState().history.past.length).toBe(pastLength + 1);
  });

  it('case 6: in-symbol scope — autoKey keyframe lands on the SYMBOL object, not root', () => {
    const s = store.getState();
    const starAsset = createVectorAsset('path', {
      id: 'star-asset',
      path: { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 10 } }] },
      primitive: { kind: 'star', cx: 5, cy: 5, radius: 5, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 },
    });
    const starObj = createSceneObject('star-asset', { id: 'star1', zOrder: 0 });
    const sym = createSymbolAsset({ id: 'sym', objects: [starObj], width: 10, height: 10 });
    const p = createProject();
    p.assets = [starAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('star1');
    store.getState().seek(1);
    store.getState().setPrimitiveParam('points', 8);
    const symObj0 = () =>
      (store.getState().history.present.assets.find((a) => a.id === 'sym') as unknown as { objects: ReturnType<typeof createSceneObject>[] })
        .objects[0];
    expect(symObj0().tracks.starPoints).toEqual([{ time: 1, value: 8, easing: 'linear' }]);
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1']); // root untouched
  });
});

// Task 3 (follow-ups batch 1): a shapeTrack (once non-empty) permanently shadows any primitive
// param track in sampleObject's morph-wins branch (sample.ts:64) — orphaned dead weight that
// silently inflates computeProjectDuration. addShapeKeyframe (the FIRST shape keyframe) and
// setPathData's shapeTrack-present branch (every keyframe edit thereafter) both now self-heal
// via omitPrimitiveTracks in the same commit.
describe('addShapeKeyframe / setPathData — primitive-track shadow strip (task 3)', () => {
  it('addShapeKeyframe strips the 5 primitive keys and deflates computeProjectDuration', () => {
    const id = seedStar();
    store.getState().seek(5);
    store.getState().setPrimitiveParam('points', 8); // autoKey ON -> tracks.starPoints kf @ t=5
    expect(obj(id).tracks.starPoints).toEqual([{ time: 5, value: 8, easing: 'linear' }]);
    const durationBefore = computeProjectDuration(store.getState().history.present);
    expect(durationBefore).toBeGreaterThanOrEqual(5); // the starPoints kf @5 drives duration

    store.getState().seek(0);
    store.getState().addShapeKeyframe(); // first shape keyframe, seeded from the CURRENT (regenerated) shape @ t=0

    expect(obj(id).shapeTrack).toHaveLength(1);
    expect(obj(id).tracks.starPoints).toBeUndefined(); // shadowed track stripped
    expect(obj(id).tracks.sides).toBeUndefined();
    expect(obj(id).tracks.innerRatio).toBeUndefined();
    expect(obj(id).tracks.primitiveRotation).toBeUndefined();
    expect(obj(id).tracks.cornerRadius).toBeUndefined();

    const durationAfter = computeProjectDuration(store.getState().history.present);
    expect(durationAfter).toBeLessThan(durationBefore); // deflated: the orphaned kf@5 no longer counts
  });

  it("setPathData's shapeTrack-present branch strips a lingering primitive track (self-heal on every subsequent edit, not just the first)", () => {
    const id = seedStar();
    store.getState().addShapeKeyframe(); // establish a shapeTrack (no primitive tracks yet -> no-op strip)
    // Simulate a lingering primitive track that predates this fix (e.g. from an older commit/import):
    // write it back directly, bypassing setPrimitiveParam, so the store's own guards don't block it.
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === id ? { ...o, tracks: { ...o.tracks, starPoints: [{ time: 0, value: 7, easing: 'linear' as const }] } } : o,
      ),
    });
    expect(obj(id).tracks.starPoints).toBeDefined();

    const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 5, y: 5 } }] };
    store.getState().setPathData(path); // shapeTrack already non-empty -> the shapeTrack-present branch
    expect(obj(id).tracks.starPoints).toBeUndefined();
    expect(obj(id).shapeTrack).toHaveLength(1);
    expect(obj(id).shapeTrack![0].path).toEqual(path);
  });

  it('object without primitive tracks is unaffected (parity): addShapeKeyframe / setPathData leave unrelated tracks untouched', () => {
    const id = seedStar();
    // An unrelated (non-primitive) track survives both calls unchanged.
    const project0 = store.getState().history.present;
    store.getState().commit({
      ...project0,
      objects: project0.objects.map((o) =>
        o.id === id ? { ...o, tracks: { ...o.tracks, x: [{ time: 0, value: 5, easing: 'linear' as const }] } } : o,
      ),
    });
    store.getState().addShapeKeyframe();
    expect(obj(id).tracks.x).toEqual([{ time: 0, value: 5, easing: 'linear' }]);
    expect(obj(id).shapeTrack).toHaveLength(1);

    const path: PathData = { closed: false, nodes: [{ anchor: { x: 1, y: 1 } }, { anchor: { x: 9, y: 9 } }] };
    store.getState().setPathData(path);
    expect(obj(id).tracks.x).toEqual([{ time: 0, value: 5, easing: 'linear' }]); // untouched
    expect(obj(id).shapeTrack![0].path).toEqual(path);
  });
});
