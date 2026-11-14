import { describe, expect, it } from 'vitest';
import {
  armatureBones,
  armatureRoot,
  boneChain,
  boneFromDrag,
  worldToGroupLocal,
  boneJointWorld,
  boneLocalTip,
  boneTipWorld,
  isBone,
  rotateBoneToward,
  solveIK,
  type BoneObject,
} from './bones';
import { createGroupObject } from './project';
import type { BoneSpec, SceneObject } from './types';

function bone(id: string, x: number, y: number, spec: Partial<BoneSpec> & { length: number }, parentId?: string, extra: Partial<SceneObject> = {}): BoneObject {
  return {
    ...createGroupObject({ id, anchorX: x, anchorY: y, zOrder: 0 }),
    bone: { angle: 0, ...spec },
    ...(parentId ? { parentId } : {}),
    ...extra,
  } as BoneObject;
}

/** A horizontal two-bone arm: upper (0,0)→(100,0), lower (100,0)→(180,0). */
const arm = (lowerSpec: Partial<BoneSpec> = {}, upperSpec: Partial<BoneSpec> = {}) => [
  bone('upper', 0, 0, { length: 100, ...upperSpec }),
  bone('lower', 100, 0, { length: 80, ...lowerSpec }, 'upper'),
];

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('bone geometry', () => {
  it('identifies bones and walks armatures', () => {
    const objs = [...arm(), bone('hand', 180, 0, { length: 20 }, 'lower'), bone('other', 0, 50, { length: 10 }, 'upper')];
    expect(isBone(objs[0])).toBe(true);
    expect(isBone(createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }))).toBe(false);
    expect(armatureRoot(objs, 'hand')!.id).toBe('upper');
    expect(armatureBones(objs, 'upper').map((b) => b.id).sort()).toEqual(['hand', 'lower', 'other', 'upper']);
    expect(boneChain(objs, 'hand').map((b) => b.id)).toEqual(['hand', 'lower', 'upper']);
  });

  it('stops the chain before a pinned bone', () => {
    const objs = arm({}, { pinned: true });
    expect(boneChain(objs, 'lower').map((b) => b.id)).toEqual(['lower']);
    expect(boneChain(arm({ pinned: true }), 'lower')).toEqual([]);
  });

  it('places tips through rotated ancestors', () => {
    const objs = arm();
    expect(boneLocalTip(objs[1])).toEqual({ x: 180, y: 0 });
    const posed = [{ ...objs[0], base: { ...objs[0].base, rotation: 90 } }, objs[1]];
    const tip = boneTipWorld(posed, 'lower', 0);
    expect(tip.x).toBeCloseTo(0);
    expect(tip.y).toBeCloseTo(180);
    expect(boneJointWorld(posed, 'lower', 0).y).toBeCloseTo(100);
  });

  it('honours an angled rest direction', () => {
    const b = bone('b', 10, 10, { length: 10, angle: 90 });
    const tip = boneLocalTip(b);
    expect(tip.x).toBeCloseTo(10);
    expect(tip.y).toBeCloseTo(20);
  });
});

describe('solveIK', () => {
  it('brings a reachable tip onto the target', () => {
    const objs = arm();
    const target = { x: 60, y: 120 };
    const pose = solveIK(objs, 'lower', target, 0);
    expect(pose.size).toBe(2);
    expect(dist(boneTipWorld(objs, 'lower', 0, pose), target)).toBeLessThan(0.1);
  });

  it('points the chain straight at an unreachable target', () => {
    const objs = arm();
    const pose = solveIK(objs, 'lower', { x: 0, y: 1000 }, 0);
    const tip = boneTipWorld(objs, 'lower', 0, pose);
    expect(tip.x).toBeCloseTo(0, 0);
    expect(tip.y).toBeCloseTo(180, 0);
  });

  it('respects joint limits', () => {
    const objs = arm({ min: -10, max: 10 });
    const pose = solveIK(objs, 'lower', { x: 60, y: 120 }, 0);
    const lower = pose.get('lower') ?? 0;
    expect(lower).toBeGreaterThanOrEqual(-10);
    expect(lower).toBeLessThanOrEqual(10);
  });

  it('never rotates pinned bones or what is above them', () => {
    const objs = arm({}, { pinned: true });
    const pose = solveIK(objs, 'lower', { x: 100, y: 80 }, 0);
    expect(pose.has('upper')).toBe(false);
    const tip = boneTipWorld(objs, 'lower', 0, pose);
    expect(tip.x).toBeCloseTo(100);
    expect(tip.y).toBeCloseTo(80);
  });

  it('is deterministic and returns nothing when already there', () => {
    const objs = arm();
    expect([...solveIK(objs, 'lower', { x: 60, y: 120 }, 0)]).toEqual([...solveIK(objs, 'lower', { x: 60, y: 120 }, 0)]);
    expect(solveIK(objs, 'lower', { x: 180, y: 0 }, 0).size).toBe(0);
  });

  it('keeps rotations near the current pose (no long-way spins)', () => {
    const objs = arm();
    const near = [{ ...objs[0], base: { ...objs[0].base, rotation: 350 } }, objs[1]];
    const pose = solveIK(near, 'lower', { x: 170, y: 20 }, 0);
    expect(Math.abs((pose.get('upper') ?? 350) - 350)).toBeLessThan(30);
  });

  it('works under a mirrored ancestor', () => {
    const flip = { ...createGroupObject({ id: 'flip', anchorX: 0, anchorY: 0, zOrder: 0 }), base: { x: 0, y: 0, scaleX: -1, scaleY: 1, rotation: 0, opacity: 1 } };
    const objs = [flip, ...arm().map((b) => (b.id === 'upper' ? { ...b, parentId: 'flip' } : b))];
    const target = { x: -60, y: 120 };
    const pose = solveIK(objs, 'lower', target, 0);
    expect(dist(boneTipWorld(objs, 'lower', 0, pose), target)).toBeLessThan(0.1);
  });

  it('reads the pose at the given time (rotation tracks)', () => {
    const objs = arm();
    const animated = [{ ...objs[0], tracks: { rotation: [{ time: 0, value: 0, easing: 'linear' as const }, { time: 1, value: 90, easing: 'linear' as const }] } }, objs[1]];
    expect(boneTipWorld(animated, 'lower', 1).y).toBeCloseTo(180);
  });
});

describe('rotateBoneToward (FK)', () => {
  it('swings one bone to point at the target', () => {
    const objs = arm();
    expect(rotateBoneToward(objs, 'lower', { x: 100, y: 50 }, 0)).toBeCloseTo(90);
    expect(rotateBoneToward(arm({ pinned: true }), 'lower', { x: 100, y: 50 }, 0)).toBe(0);
    expect(rotateBoneToward(arm({ max: 45 }), 'lower', { x: 100, y: 50 }, 0)).toBe(45);
  });
});

describe('worldToGroupLocal / boneFromDrag', () => {
  it('round-trips through a posed parent', () => {
    const objs = [{ ...arm()[0], base: { ...arm()[0].base, rotation: 90 } }, arm()[1]];
    // world tip of upper = (0,100); a child dragged from there straight down (world +y) is, in
    // upper's local space, a bone along +x from (100,0).
    const spec = boneFromDrag(objs, 'upper', { x: 0, y: 100 }, { x: 0, y: 150 }, 0);
    expect(spec.anchorX).toBeCloseTo(100);
    expect(spec.anchorY).toBeCloseTo(0);
    expect(spec.length).toBeCloseTo(50);
    expect(spec.angle).toBeCloseTo(0);
    expect(worldToGroupLocal(objs, undefined, { x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
  });
});
