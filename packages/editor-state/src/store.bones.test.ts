// Bone tool slice 1 (spec 2026-11-13-bone-tool): addBone / attach / detach / pose (IK + FK) /
// setBoneSpec / resetBonePose store verbs.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { boneTipWorld, createProject, resolveAnchor, sampleObject, worldChain, worldTransformNode } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const obj = (id: string) => objects().find((o) => o.id === id)!;
/** World centre of rect `id` at `t` (through its bone chain). */
const centre = (id: string, t = 0) => {
  const o = obj(id);
  const g = sampleObject(o, t).geometry!;
  const { anchorX, anchorY } = resolveAnchor(o, sampleObject(o, t), 'rect');
  const chain = worldChain({ ...st().history.present, objects: objects() }, o, anchorX, anchorY, t);
  return worldTransformNode(chain, { anchor: { x: g.width! / 2, y: g.height! / 2 } }).anchor;
};
const setAutoKey = (on: boolean) => {
  if (st().autoKey !== on) st().toggleAutoKey();
};

beforeEach(() => {
  st().setProject(createProject({ fps: 10, duration: 2, durationMode: 'manual' }));
  setAutoKey(true);
});

/** Upper (0,0)→(100,0) and lower (100,0)→(180,0). */
function arm(): { upper: string; lower: string } {
  const upper = st().addBone({ x: 0, y: 0 }, { x: 100, y: 0 })!;
  const lower = st().addBone({ x: 100, y: 0 }, { x: 180, y: 0 }, upper)!;
  return { upper, lower };
}

describe('addBone', () => {
  it('creates a selected bone group, a child under its parent', () => {
    const { upper, lower } = arm();
    expect(obj(upper)).toMatchObject({ isGroup: true, anchorX: 0, anchorY: 0, bone: { length: 100, angle: 0 } });
    expect(obj(lower)).toMatchObject({ parentId: upper, anchorX: 100, bone: { length: 80 } });
    expect(st().selectedObjectId).toBe(lower);
  });

  it('measures a child inside a posed parent in its local space', () => {
    const upper = st().addBone({ x: 0, y: 0 }, { x: 100, y: 0 })!;
    setAutoKey(false);
    st().poseBoneTip(upper, { x: 0, y: 100 }, { fk: true });
    const lower = st().addBone({ x: 0, y: 100 }, { x: 0, y: 150 }, upper)!;
    expect(obj(lower).anchorX).toBeCloseTo(100);
    expect(obj(lower).bone!.angle).toBeCloseTo(0);
  });

  it('refuses a non-bone parent and ignores zero-length drags', () => {
    st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const rect = st().selectedObjectId!;
    expect(st().addBone({ x: 0, y: 0 }, { x: 5, y: 0 }, rect)).toBeNull();
    expect(st().toasts.at(-1)?.message).toMatch(/start on a bone/);
    expect(st().addBone({ x: 0, y: 0 }, { x: 0.2, y: 0 })).toBeNull();
  });
});

describe('attach / detach', () => {
  it('attaching keeps the drawing in place and makes it follow the bone', () => {
    const { lower } = arm();
    st().addVectorShape('rect', { x: 150, y: -5, width: 20, height: 10 });
    const rect = st().selectedObjectId!;
    const before = centre(rect);
    st().attachToBone(lower, [rect]);
    expect(obj(rect).parentId).toBe(lower);
    expect(centre(rect).x).toBeCloseTo(before.x);
    expect(centre(rect).y).toBeCloseTo(before.y);
    setAutoKey(false);
    st().poseBoneTip(lower, { x: 100, y: 80 }, { fk: true });
    // swung 90° about the elbow (100,0): (160,0) → (100,60)
    expect(centre(rect).x).toBeCloseTo(100);
    expect(centre(rect).y).toBeCloseTo(60);
    st().detachFromBone([rect]);
    expect(obj(rect).parentId).toBeUndefined();
    expect(centre(rect).y).toBeCloseTo(60);
  });

  it('refuses bones and nothing-to-attach', () => {
    const { upper, lower } = arm();
    st().attachToBone(lower, [upper]);
    expect(st().toasts.at(-1)?.message).toMatch(/Select the drawings/);
  });
});

describe('poseBoneTip', () => {
  it('IK keyframes the chain at the playhead with auto-key on; one undo step', () => {
    const { upper, lower } = arm();
    st().seek(1);
    const before = st().history.present;
    st().poseBoneTip(lower, { x: 60, y: 120 });
    expect(obj(upper).tracks.rotation?.map((k) => k.time)).toEqual([1]);
    expect(obj(lower).tracks.rotation?.map((k) => k.time)).toEqual([1]);
    const tip = boneTipWorld(objects(), lower, 1);
    expect(Math.hypot(tip.x - 60, tip.y - 120)).toBeLessThan(0.5);
    st().undo();
    expect(st().history.present).toBe(before);
  });

  it('writes the static base with auto-key off', () => {
    const { lower } = arm();
    setAutoKey(false);
    st().poseBoneTip(lower, { x: 100, y: 80 }, { fk: true });
    expect(obj(lower).base.rotation).toBeCloseTo(90);
    expect(obj(lower).tracks.rotation).toBeUndefined();
  });

  it('respects limits and pinned bones', () => {
    const { upper, lower } = arm();
    st().setBoneSpec(lower, { min: -20, max: 20 });
    st().setBoneSpec(upper, { pinned: true });
    st().poseBoneTip(lower, { x: 100, y: 80 });
    expect(obj(upper).tracks.rotation).toBeUndefined();
    expect(obj(lower).tracks.rotation![0].value).toBeCloseTo(20);
  });
});

describe('setBoneSpec / resetBonePose', () => {
  it('edits and clears fields, refusing inverted limits', () => {
    const { lower } = arm();
    st().setBoneSpec(lower, { length: 50, min: -10, max: 10, pinned: true });
    expect(obj(lower).bone).toEqual({ length: 50, angle: 0, min: -10, max: 10, pinned: true });
    st().setBoneSpec(lower, { min: undefined, pinned: false });
    expect(obj(lower).bone).toEqual({ length: 50, angle: 0, max: 10 });
    st().setBoneSpec(lower, { min: 30 });
    expect(st().toasts.at(-1)?.message).toMatch(/minimum/);
  });

  it('reset clears the pose', () => {
    const { lower } = arm();
    st().poseBoneTip(lower, { x: 100, y: 80 }, { fk: true });
    st().resetBonePose(lower);
    expect(obj(lower).tracks.rotation).toBeUndefined();
    expect(obj(lower).base.rotation).toBe(0);
  });
});
