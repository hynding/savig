import { describe, expect, it } from 'vitest';
import { boneTipWorld, createProject, pathToD, skinnedPath, resolveAnchor, sampleObject, worldChain, worldTransformNode } from '@savig/engine';
import type { Project } from '@savig/engine';
import { addRect } from './build';
import { addBone, attachToBone, bindSkin, poseIK, setBoneRotation, unbindSkin } from './bones';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { describeProject } from './describe';

/** World centre of rect `id` at `t` through its bone chain. */
function centre(project: Project, id: string, t = 0) {
  const o = project.objects.find((x) => x.id === id)!;
  const s = sampleObject(o, t);
  const { anchorX, anchorY } = resolveAnchor(o, s, 'rect');
  const chain = worldChain(project, o, anchorX, anchorY, t);
  return worldTransformNode(chain, { anchor: { x: s.geometry!.width! / 2, y: s.geometry!.height! / 2 } }).anchor;
}

/** Upper (100,100)→(200,100), lower snapped to its tip →(280,100), a hand rect on the lower. */
function arm(): Project {
  let p = createProject({ fps: 10, duration: 2, durationMode: 'manual' });
  p = addBone(p, { id: 'upper', x: 100, y: 100, length: 100 }).project;
  p = addBone(p, { id: 'lower', parentId: 'upper', length: 80 }).project;
  p = addRect(p, { id: 'hand', x: 270, y: 90, width: 20, height: 20 }).project;
  return attachToBone(p, 'lower', ['hand']);
}

describe('addBone', () => {
  it('creates root and child bones; a child snaps to its parent tip', () => {
    const p = arm();
    const lower = p.objects.find((o) => o.id === 'lower')!;
    expect(lower).toMatchObject({ isGroup: true, parentId: 'upper', anchorX: 200, anchorY: 100, bone: { length: 80, angle: 0 } });
    expect(p.objects.find((o) => o.id === 'upper')!.name).toBe('Bone 1');
    const angled = addBone(p, { id: 'f', parentId: 'lower', x: 280, y: 100, length: 10, angle: 90, min: -20, max: 20, pinned: true }).project;
    expect(angled.objects.find((o) => o.id === 'f')!.bone).toEqual({ length: 10, angle: 90, min: -20, max: 20, pinned: true });
  });

  it('fails loud on bad input', () => {
    const p = arm();
    expect(() => addBone(p, { length: 10 })).toThrow(/root bone needs x and y/);
    expect(() => addBone(p, { x: 0, y: 0, length: 0 })).toThrow(/positive length/);
    expect(() => addBone(p, { parentId: 'hand', length: 10 })).toThrow(/not a bone/);
    expect(() => addBone(p, { x: 0, y: 0, length: 5, min: 10, max: 0 })).toThrow(/min must not exceed/);
    expect(() => addBone(p, { id: 'upper', x: 0, y: 0, length: 5 })).toThrow(/already in use/);
  });
});

describe('attachToBone', () => {
  it('keeps the drawing in place and makes it follow the bone', () => {
    const p = arm();
    expect(p.objects.find((o) => o.id === 'hand')!.parentId).toBe('lower');
    expect(centre(p, 'hand').x).toBeCloseTo(280);
    expect(centre(p, 'hand').y).toBeCloseTo(100);
    const bent = setBoneRotation(p, 'lower', 90);
    // swung 90° about the elbow (200,100): (280,100) → (200,180)
    expect(centre(bent, 'hand').x).toBeCloseTo(200);
    expect(centre(bent, 'hand').y).toBeCloseTo(180);
  });

  it('bakes into a posed bone (no jump)', () => {
    let p = setBoneRotation(arm(), 'upper', 90);
    p = addRect(p, { id: 'cuff', x: 90, y: 140, width: 20, height: 20 }).project; // centre (100,150)
    p = attachToBone(p, 'upper', ['cuff']);
    expect(centre(p, 'cuff').x).toBeCloseTo(100);
    expect(centre(p, 'cuff').y).toBeCloseTo(150);
  });

  it('refuses bones, the bone itself and missing ids', () => {
    const p = arm();
    expect(() => attachToBone(p, 'lower', ['upper'])).toThrow(/is a bone/);
    expect(() => attachToBone(p, 'hand', ['upper'])).toThrow(/not a bone/);
    expect(() => attachToBone(p, 'lower', ['nope'])).toThrow(/no object/);
    expect(() => attachToBone(p, 'lower', [])).toThrow(/at least one/);
  });
});

describe('poseIK / setBoneRotation', () => {
  it('keyframes the whole chain at the time; the tip reaches the target', () => {
    let p = poseIK(arm(), 'lower', { x: 160, y: 200 }, { time: 1, easing: 'easeInOut' });
    const upper = p.objects.find((o) => o.id === 'upper')!;
    const lower = p.objects.find((o) => o.id === 'lower')!;
    expect(upper.tracks.rotation).toHaveLength(1);
    expect(lower.tracks.rotation![0]).toMatchObject({ time: 1, easing: 'easeInOut' });
    const tip = boneTipWorld(p.objects, 'lower', 1);
    expect(Math.hypot(tip.x - 160, tip.y - 200)).toBeLessThan(0.5);
    // A rest key at 0 plus the pose at 1 = an animation; the hand moves with it.
    p = setBoneRotation(setBoneRotation(p, 'upper', 0, { time: 0 }), 'lower', 0, { time: 0 });
    expect(centre(p, 'hand', 0).x).toBeCloseTo(280);
    expect(centre(p, 'hand', 1).y).toBeGreaterThan(150);
  });

  it('keys bones that need no change too (the pose holds)', () => {
    const p = poseIK(arm(), 'lower', { x: 280, y: 100 }, { time: 0.5 });
    expect(p.objects.find((o) => o.id === 'upper')!.tracks.rotation).toEqual([{ time: 0.5, value: 0, easing: 'linear' }]);
  });

  it('stops at pinned bones and refuses a pinned tip', () => {
    let p = createProject({});
    p = addBone(p, { id: 'a', x: 0, y: 0, length: 100, pinned: true }).project;
    p = addBone(p, { id: 'b', parentId: 'a', length: 50 }).project;
    const posed = poseIK(p, 'b', { x: 100, y: 50 }, { time: 0 });
    expect(posed.objects.find((o) => o.id === 'a')!.tracks.rotation).toBeUndefined();
    expect(() => poseIK(p, 'a', { x: 0, y: 50 }, { time: 0 })).toThrow(/pinned/);
  });

  it('setBoneRotation clamps to limits; base without time, keyframe with', () => {
    let p = createProject({});
    p = addBone(p, { id: 'a', x: 0, y: 0, length: 100, min: -30, max: 30 }).project;
    expect(setBoneRotation(p, 'a', 80).objects[0].base.rotation).toBe(30);
    p = setBoneRotation(p, 'a', -10, { time: 1 });
    expect(p.objects[0].tracks.rotation).toEqual([{ time: 1, value: -10, easing: 'linear' }]);
    expect(() => setBoneRotation(p, 'a', NaN)).toThrow();
  });
});

describe('DSL bone trees', () => {
  const doc: ShortDoc = {
    meta: { fps: 10, duration: 2, durationMode: 'manual' },
    objects: [
      { type: 'rect', id: 'bg', x: 0, y: 0, width: 400, height: 300 },
      {
        type: 'bone',
        id: 'upper',
        x: 100,
        y: 100,
        length: 100,
        animate: { rotation: [{ t: 0, value: 0 }, { t: 1, value: -30, easing: 'easeInOut' }] },
        children: [
          { type: 'rect', id: 'sleeve', x: 100, y: 95, width: 100, height: 10 },
          {
            type: 'bone',
            id: 'lower',
            length: 80,
            min: -90,
            max: 10,
            base: { rotation: -20 },
            children: [{ type: 'rect', id: 'hand', x: 270, y: 90, width: 20, height: 20 }],
          },
        ],
      },
    ],
  };

  it('compiles a nested tree: child joints snap to tips, drawings attach in rest coordinates', () => {
    const p = compileShort(doc);
    const byId = (id: string) => p.objects.find((o) => o.id === id)!;
    expect(byId('lower')).toMatchObject({ parentId: 'upper', anchorX: 200, anchorY: 100, bone: { min: -90, max: 10 } });
    expect(byId('hand').parentId).toBe('lower');
    expect(byId('sleeve').parentId).toBe('upper');
    expect(byId('upper').tracks.rotation).toHaveLength(2);
    expect(byId('lower').base.rotation).toBe(-20);
    // At rest the hand would be at (280,100); with lower at -20° it swings up about (200,100).
    const c = centre(p, 'hand', 0);
    expect(c.x).toBeCloseTo(200 + 80 * Math.cos((-20 * Math.PI) / 180));
    expect(c.y).toBeCloseTo(100 + 80 * Math.sin((-20 * Math.PI) / 180));
  });

  it('round-trips through decompile', () => {
    const p = compileShort(doc);
    const out = decompileProject(p);
    expect(out.objects!.map((o) => o.type)).toEqual(['rect', 'bone']); // attached drawings live in the tree
    const again = compileShort(out);
    expect(again.objects).toEqual(p.objects);
    expect(decompileProject(again)).toEqual(out);
  });

  it('rejects a frames layer inside a bone', () => {
    expect(() =>
      compileShort({ objects: [{ type: 'bone', x: 0, y: 0, length: 10, children: [{ type: 'frames', keys: [{ time: 0, objects: [] }] } as never] }] }),
    ).toThrow(/frames layer cannot be attached/);
  });

  it('describe prints bone lines', () => {
    const text = describeProject(compileShort(doc));
    expect(text).toMatch(/upper "Bone 1" \(bone\).*bone len=100 angle=0°.*→ sleeve, lower/);
    expect(text).toMatch(/lower "Bone 2" \(bone\).*bone len=80 angle=0° joint=\(200,100\) limits -90°\.\.10°.*→ hand/);
  });
});

describe('skinning (spec 2026-11-14-bone-skinning)', () => {
  function tail(): Project {
    let p = createProject({ fps: 10, duration: 2, durationMode: 'manual' });
    p = addBone(p, { id: 'b1', x: 100, y: 100, length: 100 }).project;
    p = addBone(p, { id: 'b2', parentId: 'b1', length: 100 }).project;
    return addRect(p, { id: 'bar', x: 100, y: 95, width: 200, height: 10 }).project;
  }
  const drawn = (p: Project, t: number) => {
    const o = p.objects.find((x) => x.id === 'bar')!;
    const a = p.assets.find((x) => x.id === o.assetId) as { path: import('@savig/engine').PathData };
    return pathToD(skinnedPath(p.objects, o, a.path, t));
  };

  it('bindSkin converts the rect to a path; posing bends it; unbindSkin removes the skin', () => {
    let p = bindSkin(tail(), 'bar', ['b1', 'b2']);
    const bar = p.objects.find((o) => o.id === 'bar')!;
    expect(bar.skin!.bones).toEqual(['b1', 'b2']);
    expect(p.assets.find((a) => a.id === bar.assetId)).toMatchObject({ shapeType: 'path' });
    const rest = drawn(p, 0);
    p = setBoneRotation(p, 'b2', 60, { time: 1 });
    p = setBoneRotation(p, 'b2', 0, { time: 0 });
    expect(drawn(p, 0)).toBe(rest);
    expect(drawn(p, 1)).not.toBe(rest);
    expect(unbindSkin(p, 'bar').objects.find((o) => o.id === 'bar')!.skin).toBeUndefined();
  });

  it('atRest binds against rotation 0 even when the bones are already animated', () => {
    let p = setBoneRotation(tail(), 'b2', 45, { time: 0 });
    p = bindSkin(p, 'bar', ['b1', 'b2'], { atRest: true });
    const posed = drawn(p, 0);
    const restProject = { ...p, objects: p.objects.map((o) => (o.id === 'b2' ? { ...o, tracks: {} } : o)) };
    expect(posed).not.toBe(drawn(restProject, 0));
  });

  it('fails loud', () => {
    expect(() => bindSkin(tail(), 'bar', [])).toThrow(/at least one bone/);
    expect(() => bindSkin(tail(), 'bar', ['bar'])).toThrow(/not a bone/);
    expect(() => bindSkin(tail(), 'b1', ['b1'])).toThrow(/Pick one shape/);
    expect(() => unbindSkin(tail(), 'bar')).toThrow(/not skinned/);
  });

  it('DSL: skin on a top-level shape binds at rest; decompile round-trips; describe shows it', () => {
    const doc: ShortDoc = {
      meta: { fps: 10, duration: 2, durationMode: 'manual' },
      objects: [
        { type: 'rect', id: 'bar', x: 100, y: 95, width: 200, height: 10, skin: ['b1', 'b2'] },
        {
          type: 'bone',
          id: 'b1',
          x: 100,
          y: 100,
          length: 100,
          children: [{ type: 'bone', id: 'b2', length: 100, animate: { rotation: [{ t: 0, value: 30 }, { t: 1, value: -30 }] } }],
        },
      ],
    };
    const p = compileShort(doc);
    expect(p.objects.find((o) => o.id === 'bar')!.skin!.bones).toEqual(['b1', 'b2']);
    const out = decompileProject(p);
    expect(out.objects![0]).toMatchObject({ type: 'path', id: 'bar', skin: ['b1', 'b2'] });
    const again = compileShort(out);
    expect(again.objects).toEqual(p.objects);
    expect(describeProject(p)).toMatch(/bar .*skin → b1, b2/);
    expect(() => compileShort({ objects: [{ type: 'rect', x: 0, y: 0, width: 5, height: 5, skin: ['x'] }] })).toThrow(/needs an id/);
  });
});
