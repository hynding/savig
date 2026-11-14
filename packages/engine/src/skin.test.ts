import { describe, expect, it } from 'vitest';
import { createGroupObject } from './project';
import { pathBounds, pathToD } from './path';
import { autoSkinWeights, computeSkin, densifyPath, matApply, matInv, matMul, skinnedPath } from './skin';
import type { Mat2D, PathData, SceneObject } from './types';

function bone(id: string, x: number, y: number, length: number, parentId?: string, rotation = 0): SceneObject {
  return {
    ...createGroupObject({ id, anchorX: x, anchorY: y, zOrder: 0 }),
    bone: { length, angle: 0 },
    base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation, opacity: 1 },
    ...(parentId ? { parentId } : {}),
  };
}

/** A path drawing at (x, y) whose outline is `path` (local coords). */
function drawing(_path: PathData, x = 0, y = 0): SceneObject {
  return {
    id: 'skin',
    name: 'Skin',
    assetId: 'a',
    zOrder: 1,
    anchorX: 0.5,
    anchorY: 0.5,
    anchorMode: 'fraction',
    base: { x, y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    tracks: {},
  } as SceneObject;
}

/** A 200×20 bar from x=0..200 (local), drawn at (0, -10): spans world x 0..200, y -10..10. */
const bar: PathData = {
  closed: true,
  nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 200, y: 0 } }, { anchor: { x: 200, y: 20 } }, { anchor: { x: 0, y: 20 } }],
};

function rig(lowerRotation = 0, upperRotation = 0) {
  return [bone('upper', 0, 0, 100, undefined, upperRotation), bone('lower', 100, 0, 100, 'upper', lowerRotation)];
}

describe('matrices', () => {
  it('multiply and invert', () => {
    const m: Mat2D = [0, 1, -1, 0, 5, 7]; // rotate 90° then translate
    const inv = matInv(m)!;
    const p = { x: 3, y: 4 };
    const q = matApply(matMul(inv, m), p);
    expect(q.x).toBeCloseTo(3);
    expect(q.y).toBeCloseTo(4);
    expect(matInv([0, 0, 0, 0, 1, 1])).toBeNull();
  });
});

describe('densifyPath', () => {
  it('splits long lines and curves without changing the outline', () => {
    const d = densifyPath(bar, 24);
    expect(d.nodes.length).toBe(4 + 2 * 8 + 0); // 200-long sides → 9 pieces (8 inserts each); 20-long sides stay
    expect(pathBounds(d)).toEqual(pathBounds(bar));
    const curve: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 }, out: { x: 0, y: -100 } }, { anchor: { x: 100, y: 0 }, in: { x: 100, y: -100 } }] };
    const dc = densifyPath(curve, 24);
    expect(dc.nodes.length).toBeGreaterThan(5);
    // The midpoint of the original cubic (t=0.5) is (50, -75); it is on the densified outline.
    const near = dc.nodes.some((n) => Math.hypot(n.anchor.x - 50, n.anchor.y + 75) < 1e-9);
    const evenPieces = (dc.nodes.length - 1) % 2 === 0;
    if (evenPieces) expect(near).toBe(true);
    expect(dc.nodes[0].anchor).toEqual({ x: 0, y: 0 });
    expect(dc.nodes[dc.nodes.length - 1].anchor).toEqual({ x: 100, y: 0 });
  });

  it('leaves short paths alone', () => {
    const short: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] };
    expect(densifyPath(short, 24)).toEqual(short);
  });
});

describe('autoSkinWeights', () => {
  it('the nearest bone dominates and rows sum to 1', () => {
    const segs = [{ joint: { x: 0, y: 0 }, tip: { x: 100, y: 0 } }, { joint: { x: 100, y: 0 }, tip: { x: 200, y: 0 } }, { joint: { x: 500, y: 500 }, tip: { x: 600, y: 500 } }];
    const [a, b, mid] = autoSkinWeights([{ x: 10, y: 5 }, { x: 190, y: -5 }, { x: 100, y: 0 }], segs);
    expect(a[0]).toBeGreaterThan(0.9);
    expect(b[1]).toBeGreaterThan(0.9);
    expect(mid[0]).toBeCloseTo(0.5);
    for (const row of [a, b, mid]) {
      expect(row.reduce((s, w) => s + w, 0)).toBeCloseTo(1);
      expect(row[2]).toBe(0); // only the two strongest are kept
    }
  });
});

describe('computeSkin / skinnedPath', () => {
  const bind = (objects: SceneObject[], obj = drawing(bar, 0, -10)) => {
    const r = computeSkin(objects, obj, bar, ['upper', 'lower'], 0);
    if ('error' in r) throw new Error(r.error);
    return { obj: { ...obj, skin: r.skin }, path: r.path };
  };

  it('rest pose = no deformation', () => {
    const objects = rig();
    const { obj, path } = bind(objects);
    expect(pathToD(skinnedPath(objects, obj, path, 0))).toBe(pathToD(path));
  });

  it('bending the lower bone 90° swings the far end about the elbow and blends near it', () => {
    const { obj, path } = bind(rig());
    const bent = rig(90);
    const out = skinnedPath(bent, obj, path, 0);
    // Far end: local (200,0)/(200,20) = world (200,-10)/(200,10) → about (100,0) by 90° → (110,100)/(90,100).
    const far = out.nodes.filter((_, i) => path.nodes[i].anchor.x === 200).map((n) => n.anchor);
    for (const p of far) expect(p.y + -10).toBeGreaterThan(80); // world y ≈ 100 (local y = world y + 10)
    // Near the shoulder nothing moves.
    const near = out.nodes.filter((_, i) => path.nodes[i].anchor.x === 0);
    for (const [k, p] of near.entries()) {
      const was = path.nodes.filter((n) => n.anchor.x === 0)[k].anchor;
      expect(Math.hypot(p.anchor.x - was.x, p.anchor.y - was.y)).toBeLessThan(0.05);
    }
  });

  it('follows the pose override (live preview) and the bone track at time t', () => {
    const objects = rig();
    const { obj, path } = bind(objects);
    const viaPose = skinnedPath(objects, obj, path, 0, new Map([['lower', 90]]));
    expect(pathToD(viaPose)).toBe(pathToD(skinnedPath(rig(90), obj, path, 0)));
    const animated = objects.map((b) => (b.id === 'lower' ? { ...b, tracks: { rotation: [{ time: 0, value: 0, easing: 'linear' as const }, { time: 1, value: 90, easing: 'linear' as const }] } } : b));
    expect(pathToD(skinnedPath(animated, obj, path, 1))).toBe(pathToD(viaPose));
  });

  it('the drawing’s own transform is cancelled (the skin belongs to the armature)', () => {
    const { obj, path } = bind(rig());
    const moved = { ...obj, base: { ...obj.base, x: 50 } };
    const a = skinnedPath(rig(45), obj, path, 0).nodes[5].anchor;
    const b = skinnedPath(rig(45), moved, path, 0).nodes[5].anchor;
    // Same world point: local differs by exactly the moved offset.
    expect(b.x + 50).toBeCloseTo(a.x + 0);
    expect(b.y).toBeCloseTo(a.y);
  });

  it('falls back to the undeformed path on a mismatch or a missing bone', () => {
    const { obj, path } = bind(rig());
    expect(skinnedPath(rig(90), obj, bar, 0)).toBe(bar); // node count ≠ weights
    expect(skinnedPath([rig(90)[0]], obj, path, 0)).toBe(path); // a bone is gone
  });

  it('refuses non-bones, a drawing inside a bone and degenerate paths', () => {
    const objects = rig();
    expect(computeSkin(objects, drawing(bar), bar, [], 0)).toEqual({ error: 'Pick at least one bone.' });
    expect('error' in computeSkin(objects, drawing(bar), bar, ['nope'], 0)).toBe(true);
    expect('error' in computeSkin(objects, { ...drawing(bar), parentId: 'lower' }, bar, ['lower'], 0)).toBe(true);
    expect('error' in computeSkin(objects, drawing(bar), { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }] }, ['upper'], 0)).toBe(true);
  });

  it('binds correctly under a posed armature (bind pose ≠ rest)', () => {
    const posed = rig(30, 20);
    const { obj, path } = bind(posed);
    expect(pathToD(skinnedPath(posed, obj, path, 0))).toBe(pathToD(path)); // nothing moves at the bind pose
  });
});
