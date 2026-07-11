import { describe, it, expect } from 'vitest';
import {
  createProject,
  createGroupObject,
  createSceneObject,
  createSymbolAsset,
  createVectorAsset,
  outlineStroke as outlineStrokeEngine,
  primitivePathFromSpec,
  defaultGradient,
} from '@savig/engine';
import type { PathData, PrimitiveSpec, Project, VectorAsset } from '@savig/engine';
import { createIdFactory } from './ids';
import { addRect, addEllipse, addPath, setKeyframe, setBaseTransform, removeObjects, setTrim, setTrimKeyframe, setRepeat, outlineStrokePath, blendPaths } from './build';

describe('core/ids', () => {
  it('createIdFactory yields deterministic sequential ids', () => {
    const id = createIdFactory();
    expect([id(), id(), id()]).toEqual(['o1', 'o2', 'o3']);
    const t = createIdFactory('rect');
    expect([t(), t()]).toEqual(['rect1', 'rect2']);
  });
});

describe('core/build addRect', () => {
  it('adds a rect object + vector asset with shapeBase and fractional centre anchor', () => {
    const { project, id } = addRect(createProject(), { x: 10, y: 20, width: 100, height: 50, id: 'r1' });
    expect(id).toBe('r1');
    const obj = project.objects.find((o) => o.id === 'r1')!;
    expect(obj.shapeBase).toEqual({ width: 100, height: 50 });
    expect(obj.base.x).toBe(10);
    expect(obj.base.y).toBe(20);
    expect(obj.anchorMode).toBe('fraction');
    // deterministic, derived asset id
    expect(obj.assetId).toBe('r1-asset');
    const asset = project.assets.find((a) => a.id === 'r1-asset')!;
    expect(asset.kind).toBe('vector');
  });

  it('respects an explicit style and appends with increasing zOrder', () => {
    let p = createProject();
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'a', style: { fill: '#f00' } }));
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'b' }));
    expect(p.objects.map((o) => o.zOrder)).toEqual([0, 1]);
    const a = p.assets.find((x) => x.id === 'a-asset')!;
    expect(a.kind === 'vector' && a.style.fill).toBe('#f00');
  });

  it('is pure — does not mutate the input project', () => {
    const p0 = createProject();
    addRect(p0, { x: 0, y: 0, width: 5, height: 5, id: 'x' });
    expect(p0.objects).toHaveLength(0);
    expect(p0.assets).toHaveLength(0);
  });
});

describe('core/build addEllipse', () => {
  it('stores radiusX/radiusY from the bounding box', () => {
    const { project } = addEllipse(createProject(), { x: 0, y: 0, width: 80, height: 40, id: 'e1' });
    const obj = project.objects.find((o) => o.id === 'e1')!;
    expect(obj.shapeBase).toEqual({ radiusX: 40, radiusY: 20 });
  });
});

describe('core/build addPath', () => {
  it('normalizes the path to bbox origin and places base at the bbox top-left', () => {
    const path = { closed: false, nodes: [{ anchor: { x: 30, y: 40 } }, { anchor: { x: 50, y: 90 } }] };
    const { project, id } = addPath(createProject(), { path, id: 'p1' });
    const obj = project.objects.find((o) => o.id === id)!;
    expect(obj.base.x).toBe(30);
    expect(obj.base.y).toBe(40);
    const asset = project.assets.find((a) => a.id === 'p1-asset')!;
    const nodes = asset.kind === 'vector' ? asset.path!.nodes : [];
    expect(nodes[0].anchor).toEqual({ x: 0, y: 0 });
    expect(nodes[1].anchor).toEqual({ x: 20, y: 50 });
  });

  it('throws on a degenerate (<2 node) path', () => {
    expect(() => addPath(createProject(), { path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }] } })).toThrow();
  });
});

describe('core/build setKeyframe / setBaseTransform', () => {
  it('upserts a keyframe on the named track, sorted by time', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 1, value: 100 });
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 0, easing: 'easeInOut' });
    const track = p.objects[0].tracks.x!;
    expect(track.map((k) => k.time)).toEqual([0, 1]);
    expect(track[0].easing).toBe('easeInOut');
  });

  it('throws on an unknown object id (fail-loud for a programmatic caller)', () => {
    expect(() => setKeyframe(createProject(), { objectId: 'nope', property: 'x', time: 0, value: 0 })).toThrow(/no object/);
  });

  it('setBaseTransform merges fields', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setBaseTransform(p, 'r', { rotation: 45, scaleX: 2 });
    expect(p.objects[0].base.rotation).toBe(45);
    expect(p.objects[0].base.scaleX).toBe(2);
    expect(p.objects[0].base.x).toBe(0); // untouched
  });
});

describe('core/build removeObjects', () => {
  it('removes objects and prunes their now-orphaned vector assets', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    expect(p.assets).toHaveLength(1);
    p = removeObjects(p, ['r']);
    expect(p.objects).toHaveLength(0);
    expect(p.assets).toHaveLength(0); // orphaned asset pruned
  });

  it('keeps a vector asset still referenced by another object', () => {
    let p = createProject();
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'a' }));
    // second object reusing the first's asset
    const shared = { ...p.objects[0], id: 'b' };
    p = { ...p, objects: [...p.objects, shared] };
    p = removeObjects(p, ['a']);
    expect(p.objects.map((o) => o.id)).toEqual(['b']);
    expect(p.assets).toHaveLength(1); // still referenced by b
  });
});

describe('core/build setTrim / setTrimKeyframe', () => {
  it('sets base trim values, clamped', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setTrim(p, 'r', { end: 0.5 });
    expect(p.objects[0].trim).toEqual({ start: 0, end: 0.5, offset: 0 });
  });

  it('normalizes back to identity (undefined) when set back to defaults', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setTrim(p, 'r', { end: 0.5 });
    p = setTrim(p, 'r', { end: 1 });
    expect(p.objects[0].trim).toBeUndefined();
  });

  it('clamps out-of-range values to 0..1', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setTrim(p, 'r', { start: 2, offset: -0.5 });
    expect(p.objects[0].trim).toEqual({ start: 1, end: 1, offset: 0 });
  });

  it('throws on an unknown object id', () => {
    expect(() => setTrim(createProject(), 'nope', { end: 0.5 })).toThrow(/no object/);
  });

  it('setTrimKeyframe upserts into the right track, creating trim at identity if absent', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setTrimKeyframe(p, { objectId: 'r', prop: 'end', time: 0, value: 0 });
    expect(p.objects[0].trim?.endTrack).toEqual([{ time: 0, value: 0, easing: 'linear' }]);
    expect(p.objects[0].trim?.start).toBe(0);
    expect(p.objects[0].trim?.offset).toBe(0);
  });

  it('setTrimKeyframe twice at the same time replaces rather than appends', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setTrimKeyframe(p, { objectId: 'r', prop: 'end', time: 0, value: 0 });
    p = setTrimKeyframe(p, { objectId: 'r', prop: 'end', time: 0, value: 0.3, easing: 'easeInOut' });
    const track = p.objects[0].trim!.endTrack!;
    expect(track).toHaveLength(1);
    expect(track[0]).toEqual({ time: 0, value: 0.3, easing: 'easeInOut' });
  });

  it('throws on an unknown object id', () => {
    expect(() =>
      setTrimKeyframe(createProject(), { objectId: 'nope', prop: 'end', time: 0, value: 0 }),
    ).toThrow(/no object/);
  });
});

describe('core/build setRepeat', () => {
  it('merges partial spec over defaults when the object has no repeat', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setRepeat(p, 'r', { count: 3, dx: 10 });
    expect(p.objects[0].repeat).toEqual({ count: 3, dx: 10, dy: 0, rotate: 0, scale: 1, stagger: 0 });
  });

  it('merges a partial spec over the existing repeat on a second call', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setRepeat(p, 'r', { count: 4, dx: 5, dy: 2 });
    p = setRepeat(p, 'r', { rotate: 30 });
    expect(p.objects[0].repeat).toEqual({ count: 4, dx: 5, dy: 2, rotate: 30, scale: 1, stagger: 0 });
  });

  it('writes go through normalizeRepeat — count <= 1 clears the field', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setRepeat(p, 'r', { count: 3 });
    expect(p.objects[0].repeat).toBeDefined();
    p = setRepeat(p, 'r', { count: 1 });
    expect(p.objects[0].repeat).toBeUndefined();
  });

  it('writes go through normalizeRepeat — count/scale/stagger are clamped', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setRepeat(p, 'r', { count: 200, scale: -3, stagger: -2 });
    expect(p.objects[0].repeat).toEqual({ count: 64, dx: 0, dy: 0, rotate: 0, scale: 0.01, stagger: 0 });
  });

  it('throws on an unknown object id', () => {
    expect(() => setRepeat(createProject(), 'nope', { count: 2 })).toThrow(/no object/);
  });

  it('throws when the target is a group', () => {
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const p = { ...createProject(), objects: [group] };
    expect(() => setRepeat(p, 'g', { count: 2 })).toThrow(/group/);
  });

  it('throws when the target is a symbol instance', () => {
    const sym = createSymbolAsset({ id: 'sym-1', objects: [createSceneObject('inner', { id: 'inner' })] });
    const inner = createVectorAsset('rect', { id: 'inner' });
    const instance = createSceneObject('sym-1', { id: 'inst', zOrder: 0 });
    const p = { ...createProject(), assets: [inner, sym], objects: [instance] };
    expect(() => setRepeat(p, 'inst', { count: 2 })).toThrow(/instance/);
  });
});

// Straight open 2-node line (0,0)-(100,0) — matches store.outline.test.ts's / strokeOutline.test.ts's
// `line()` fixture so the expected rings can be recomputed with the engine directly. addPath
// normalizes to bbox top-left, which is already (0,0) for this fixture, so it round-trips unchanged.
function seedOpenPath(style?: Partial<VectorAsset['style']>): { project: Project; id: string } {
  const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
  return addPath(createProject(), { id: 'p', path, style: { fill: 'none', stroke: '#000000', strokeWidth: 2, ...style } });
}

// Closed 100x100 square centerline — matches strokeOutline.test.ts's `square(100)` fixture (width 10
// produces an annulus: 2 rings, opposite-signed areas).
function seedClosedSquare(strokeWidth = 10): { project: Project; id: string } {
  const path: PathData = {
    closed: true,
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 100, y: 0 } },
      { anchor: { x: 100, y: 100 } },
      { anchor: { x: 0, y: 100 } },
    ],
  };
  return addPath(createProject(), { id: 'sq', path, style: { fill: 'none', stroke: '#000000', strokeWidth } });
}

const objIn = (project: Project, id: string) => project.objects.find((o) => o.id === id)!;
const assetOf = (project: Project, id: string): VectorAsset =>
  project.assets.find((a) => a.id === objIn(project, id).assetId) as VectorAsset;

describe('core/build outlineStrokePath — gates', () => {
  it('throws on an unknown object id', () => {
    expect(() => outlineStrokePath(createProject(), 'nope')).toThrow(/no object/);
  });

  it('throws on a non-path shapeType target (rect)', () => {
    const { project } = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    expect(() => outlineStrokePath(project, 'r')).toThrow(/not a path/);
  });

  it('throws when stroke is none', () => {
    const { project, id } = seedOpenPath({ stroke: 'none' });
    expect(() => outlineStrokePath(project, id)).toThrow(/no visible stroke/);
  });

  it('throws when strokeWidth <= 0', () => {
    const { project, id } = seedOpenPath({ strokeWidth: 0 });
    expect(() => outlineStrokePath(project, id)).toThrow(/no visible stroke/);
  });

  it('throws when shapeTrack is present (a morphing path)', () => {
    const { project, id } = seedOpenPath();
    const asset = assetOf(project, id);
    const withTrack: Project = {
      ...project,
      objects: project.objects.map((o) =>
        o.id === id ? { ...o, shapeTrack: [{ time: 0, path: asset.path!, easing: 'linear' as const }] } : o,
      ),
    };
    expect(() => outlineStrokePath(withTrack, id)).toThrow(/morphing/);
  });

  it('throws when compoundRings is present', () => {
    const { project, id } = seedClosedSquare();
    const holeRing: PathData = {
      closed: true,
      nodes: [{ anchor: { x: 2, y: 2 } }, { anchor: { x: 4, y: 2 } }, { anchor: { x: 4, y: 4 } }, { anchor: { x: 2, y: 4 } }],
    };
    const withHole: Project = {
      ...project,
      assets: project.assets.map((a) => (a.id === objIn(project, id).assetId ? { ...(a as VectorAsset), compoundRings: [holeRing] } : a)),
    };
    expect(() => outlineStrokePath(withHole, id)).toThrow(/compound shapes/);
  });

  it('throws when the target is a live-boolean result', () => {
    const { project, id } = seedOpenPath();
    const withBool: Project = {
      ...project,
      objects: project.objects.map((o) => (o.id === id ? { ...o, boolean: { op: 'union' as const, operandIds: [] } } : o)),
    };
    expect(() => outlineStrokePath(withBool, id)).toThrow(/boolean result/);
  });

  it('throws when the target is a live-boolean operand', () => {
    let p = createProject();
    ({ project: p } = addPath(p, {
      id: 'a',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
      style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
    }));
    ({ project: p } = addPath(p, {
      id: 'b',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
      style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
    }));
    p = { ...p, objects: p.objects.map((o) => (o.id === 'a' ? { ...o, boolean: { op: 'union' as const, operandIds: ['b'] } } : o)) };
    expect(() => outlineStrokePath(p, 'b')).toThrow(/operand/);
  });
});

describe('core/build outlineStrokePath — effects', () => {
  it('same object id; path/compoundRings match the engine result exactly; style swapped; byte-clean removals', () => {
    const { project, id } = seedOpenPath();
    const beforeAsset = assetOf(project, id);
    const expectedRings = outlineStrokeEngine(beforeAsset.path!, beforeAsset.style.strokeWidth, 'butt', 'miter');
    expect(expectedRings.length).toBe(1); // sanity: a straight open line -> one ring, no holes

    const next = outlineStrokePath(project, id);

    const after = objIn(next, id);
    expect(after.id).toBe(id); // identity kept
    const afterAsset = assetOf(next, id);
    expect(afterAsset.path).toEqual(expectedRings[0]);
    expect(afterAsset.compoundRings).toBeUndefined();
    expect('compoundRings' in afterAsset).toBe(false); // byte-clean: omitted, not present-as-undefined

    // style: fill <- old stroke; stroke -> none/0; linecap/linejoin/dasharray/dashoffset absent.
    expect(afterAsset.style.fill).toBe('#000000');
    expect(afterAsset.style.stroke).toBe('none');
    expect(afterAsset.style.strokeWidth).toBe(0);
    expect('strokeLinecap' in afterAsset.style).toBe(false);
    expect('strokeLinejoin' in afterAsset.style).toBe(false);
    expect('strokeDasharray' in afterAsset.style).toBe(false);
    expect('strokeDashoffset' in afterAsset.style).toBe(false);
    expect('fillGradient' in afterAsset.style).toBe(false); // no strokeGradient carried (absent source)

    // primitive-detach (setPathData's rule, inherited): plain path has none to begin with.
    expect(afterAsset.primitive).toBeUndefined();
  });

  it('closed square (annulus) -> path = outer ring, compoundRings = [inner ring]', () => {
    const { project, id } = seedClosedSquare(10);
    const beforeAsset = assetOf(project, id);
    const expectedRings = outlineStrokeEngine(beforeAsset.path!, 10, 'butt', 'miter');
    expect(expectedRings.length).toBe(2); // sanity: annulus

    const next = outlineStrokePath(project, id);

    const afterAsset = assetOf(next, id);
    expect(afterAsset.path).toEqual(expectedRings[0]);
    expect(afterAsset.compoundRings).toEqual([expectedRings[1]]);
  });

  it('strokeGradient present -> carried to fillGradient; strokeGradient key absent after', () => {
    const { project, id } = seedOpenPath();
    const grad = defaultGradient('linear', '#ff0000');
    const withGrad: Project = {
      ...project,
      assets: project.assets.map((a) =>
        a.id === objIn(project, id).assetId ? { ...(a as VectorAsset), style: { ...(a as VectorAsset).style, strokeGradient: grad } } : a,
      ),
    };

    const next = outlineStrokePath(withGrad, id);

    const afterAsset = assetOf(next, id);
    expect(afterAsset.style.fillGradient).toEqual(grad);
    expect('strokeGradient' in afterAsset.style).toBe(false);
  });

  it('sampled paint — a colorTracks.stroke keyframe at t=0 drives the outline fill, not the static style', () => {
    const { project, id } = seedOpenPath(); // static style.stroke stays '#000000'
    const seeded: Project = {
      ...project,
      objects: project.objects.map((o) =>
        o.id === id ? { ...o, colorTracks: { stroke: [{ time: 0, value: '#ff0000', easing: 'linear' as const }] } } : o,
      ),
    };

    const next = outlineStrokePath(seeded, id); // builder relies on the default time=0

    expect(assetOf(next, id).style.fill).toBe('#ff0000'); // sampled keyframe value, not the stale static '#000000'
  });

  it('honors non-default cap/join/width from the asset style', () => {
    const { project, id } = seedOpenPath({ strokeWidth: 20, strokeLinecap: 'round', strokeLinejoin: 'round' });
    const beforeAsset = assetOf(project, id);
    const expected = outlineStrokeEngine(beforeAsset.path!, 20, 'round', 'round');

    const next = outlineStrokePath(project, id);

    expect(assetOf(next, id).path).toEqual(expected[0]);
  });

  it('drops trim/dashOffsetTrack/colorTracks/gradientTracks; keeps tracks/motionPath/repeat', () => {
    const { project, id } = seedOpenPath();
    const motion: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 5, y: 5 } }] };
    const seeded: Project = {
      ...project,
      objects: project.objects.map((o) =>
        o.id === id
          ? {
              ...o,
              tracks: { x: [{ time: 0, value: 0, easing: 'linear' as const }, { time: 1, value: 5, easing: 'linear' as const }] },
              trim: { start: 0, end: 1, offset: 0 },
              dashOffsetTrack: [{ time: 0, value: 0, easing: 'linear' as const }],
              colorTracks: { fill: [{ time: 0, value: '#f00', easing: 'linear' as const }] },
              gradientTracks: { stroke: [{ time: 0, gradient: defaultGradient('linear'), easing: 'linear' as const }] },
              motionPath: {
                path: motion,
                orient: false,
                progress: [{ time: 0, value: 0, easing: 'linear' as const }, { time: 1, value: 1, easing: 'linear' as const }],
              },
              repeat: { count: 3, dx: 5, dy: 0, rotate: 0, scale: 1, stagger: 0 },
            }
          : o,
      ),
    };
    const originalObj = objIn(seeded, id);

    const next = outlineStrokePath(seeded, id);

    const after = objIn(next, id);
    expect('trim' in after).toBe(false);
    expect('dashOffsetTrack' in after).toBe(false);
    expect('colorTracks' in after).toBe(false);
    expect('gradientTracks' in after).toBe(false);
    // kept verbatim
    expect(after.tracks.x).toEqual(originalObj.tracks.x);
    expect(after.motionPath).toEqual(originalObj.motionPath);
    expect(after.repeat).toEqual(originalObj.repeat);
  });

  it('anchorMode fraction -> pinned absolute at the pre-op resolved point', () => {
    const { project, id } = seedOpenPath(); // anchorMode 'fraction', anchorX/Y 0.5/0.5; path bbox (0,0)-(100,0)
    const next = outlineStrokePath(project, id);
    const after = objIn(next, id);
    expect(after.anchorMode).toBe('absolute');
    expect(after.anchorX).toBe(50);
    expect(after.anchorY).toBe(0);
  });

  it('anchorMode absolute -> value untouched, mode stays absolute', () => {
    const { project, id } = seedOpenPath();
    const withAbs: Project = {
      ...project,
      objects: project.objects.map((o) => (o.id === id ? { ...o, anchorMode: 'absolute' as const, anchorX: 7, anchorY: 9 } : o)),
    };
    const next = outlineStrokePath(withAbs, id);
    const after = objIn(next, id);
    expect(after.anchorMode).toBe('absolute');
    expect(after.anchorX).toBe(7);
    expect(after.anchorY).toBe(9);
  });

  it('primitive-detach — a stamped star with a stroke detaches its spec + strips primitive param tracks', () => {
    const spec: PrimitiveSpec = { kind: 'star', cx: 50, cy: 50, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 };
    const starAsset = createVectorAsset('path', {
      id: 'star-asset',
      shapeType: 'path',
      path: primitivePathFromSpec(spec),
      primitive: spec,
      style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
    });
    const starObj = createSceneObject('star-asset', {
      id: 'star',
      zOrder: 0,
      anchorMode: 'absolute',
      anchorX: 0,
      anchorY: 0,
      tracks: { cornerRadius: [{ time: 0, value: 5, easing: 'linear' as const }] },
    });
    const project: Project = { ...createProject(), assets: [starAsset], objects: [starObj] };
    expect(assetOf(project, 'star').primitive).toBeDefined();

    const next = outlineStrokePath(project, 'star');

    expect(assetOf(next, 'star').primitive).toBeUndefined();
    expect(objIn(next, 'star').tracks.cornerRadius).toBeUndefined();
  });

  it('a degenerate offset (engine returns no rings) is a silent no-op — returns the project unchanged', () => {
    // Two coincident nodes flatten to a single point -> the engine's outlineStroke returns [].
    const path: PathData = { closed: false, nodes: [{ anchor: { x: 5, y: 5 } }, { anchor: { x: 5, y: 5 } }] };
    const { project, id } = addPath(createProject(), { id: 'zero', path, style: { fill: 'none', stroke: '#000000', strokeWidth: 2 } });

    const next = outlineStrokePath(project, id);

    expect(next).toBe(project); // same reference — a true no-op
  });

  it('is pure — does not mutate the input project', () => {
    const { project, id } = seedOpenPath();
    const before = structuredClone(project);
    outlineStrokePath(project, id);
    expect(project).toEqual(before);
  });
});

// Straight open 2-node horizontal line at height `y` — (0,y)-(100,y). addPath's bbox-normalize
// is a no-op for a y>=0 line (top-left is already at the line itself), so the object's world
// path at time 0 (base translate only, no rotation/scale) reproduces these exact coordinates.
function line(y: number): PathData {
  return { closed: false, nodes: [{ anchor: { x: 0, y } }, { anchor: { x: 100, y } }] };
}
const openStyle = { fill: 'none', stroke: '#000000', strokeWidth: 1 };

describe('core/build blendPaths — gates', () => {
  it('throws distinctly on an unknown A id', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'b', path: line(0), style: openStyle }));
    expect(() => blendPaths(p, 'nope', 'b', 2)).toThrow(/target A not found/);
  });

  it('throws distinctly on an unknown B id', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    expect(() => blendPaths(p, 'a', 'nope', 2)).toThrow(/target B not found/);
  });

  it('throws distinctly on count < 1', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    expect(() => blendPaths(p, 'a', 'b', 0)).toThrow(/count must be >= 1/);
  });

  it('throws distinctly when a target is a group', () => {
    let p = createProject();
    ({ project: p } = addRect(p, { id: 'r1', x: 0, y: 0, width: 10, height: 10 }));
    ({ project: p } = addRect(p, { id: 'r2', x: 20, y: 0, width: 10, height: 10 }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    const group = createGroupObject({ id: 'g', anchorX: 0.5, anchorY: 0.5, zOrder: 99 });
    p = { ...p, objects: [...p.objects, group] };
    expect(() => blendPaths(p, 'g', 'b', 2)).toThrow(/is a group/);
  });

  it('throws distinctly when a target is a live-boolean result', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    p = { ...p, objects: p.objects.map((o) => (o.id === 'a' ? { ...o, boolean: { op: 'union' as const, operandIds: [] } } : o)) };
    expect(() => blendPaths(p, 'a', 'b', 2)).toThrow(/boolean result/);
  });

  it('throws distinctly when a target is a live-boolean operand', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    // 'a' is the live-boolean CONTAINER naming 'b' as an operand — 'b' itself has no `.boolean`,
    // it's only reachable via 'a's operandIds, so target 'b' (as A here) must hit the operand gate.
    p = { ...p, objects: p.objects.map((o) => (o.id === 'a' ? { ...o, boolean: { op: 'union' as const, operandIds: ['b'] } } : o)) };
    expect(() => blendPaths(p, 'b', 'a', 2)).toThrow(/boolean operand/);
  });

  it('throws distinctly when a target has a repeater', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    p = { ...p, objects: p.objects.map((o) => (o.id === 'b' ? { ...o, repeat: { count: 2, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: 0 } } : o)) };
    expect(() => blendPaths(p, 'a', 'b', 2)).toThrow(/repeater/);
  });

  it('throws distinctly when a target has a shapeTrack (already morphing)', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    const asset = assetOf(p, 'a');
    p = { ...p, objects: p.objects.map((o) => (o.id === 'a' ? { ...o, shapeTrack: [{ time: 0, path: asset.path!, easing: 'linear' as const }] } : o)) };
    expect(() => blendPaths(p, 'a', 'b', 2)).toThrow(/morphing/);
  });

  it('throws distinctly when a target is not a vector path (rect)', () => {
    let p = createProject();
    ({ project: p } = addRect(p, { id: 'r', x: 0, y: 0, width: 10, height: 10 }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    expect(() => blendPaths(p, 'r', 'b', 2)).toThrow(/not a vector path/);
  });

  it('throws distinctly when a target has compoundRings', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    const holeRing: PathData = {
      closed: true,
      nodes: [{ anchor: { x: 2, y: 2 } }, { anchor: { x: 4, y: 2 } }, { anchor: { x: 4, y: 4 } }, { anchor: { x: 2, y: 4 } }],
    };
    p = { ...p, assets: p.assets.map((a) => (a.id === objIn(p, 'a').assetId ? { ...(a as VectorAsset), compoundRings: [holeRing] } : a)) };
    expect(() => blendPaths(p, 'a', 'b', 2)).toThrow(/compound shapes/);
  });
});

describe('core/build blendPaths — effects', () => {
  it('returns count new ids; each intermediate matches blendSelected\'s normalization (fraction anchor, base placement, sequential zOrder, "Blend i" name)', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));

    const { project, ids } = blendPaths(p, 'a', 'b', 2);

    expect(ids).toHaveLength(2);
    ids.forEach((id, i) => {
      const obj = objIn(project, id);
      expect(obj.name).toBe(`Blend ${i + 1}`);
      expect(obj.anchorMode).toBe('fraction');
      expect(obj.anchorX).toBe(0.5);
      expect(obj.anchorY).toBe(0.5);
      const asset = assetOf(project, id);
      expect(asset.kind).toBe('vector');
      expect(asset.shapeType).toBe('path');
      // the stored path is bbox-normalized (anchor-only shift, bbox-shift precedent) — its own
      // top-left sits at local origin; the ORIGINAL world position is carried by `base.x`/`base.y`
      // instead (asserted below via the explicit interpolated-y checks).
      expect(Math.min(...asset.path!.nodes.map((n) => n.anchor.x))).toBeCloseTo(0);
      expect(Math.min(...asset.path!.nodes.map((n) => n.anchor.y))).toBeCloseTo(0);
    });
    // sequential zOrder continuing from the existing objects.
    expect(objIn(project, ids[0]).zOrder).toBe(2);
    expect(objIn(project, ids[1]).zOrder).toBe(3);
    // interpolated between the two endpoints (0 and 40): step 1 of 2 at t=1/3, step 2 at t=2/3.
    expect(objIn(project, ids[0]).base.y).toBeCloseTo(40 / 3);
    expect(objIn(project, ids[1]).base.y).toBeCloseTo(80 / 3);
  });

  it('caller-order (aId/bId) determines the A->B blend direction, NOT zOrder — a deliberate DSL difference from blendSelected', () => {
    let p = createProject();
    // 'hi' is added FIRST (lower zOrder) but is the semantic "high" endpoint (y=100); 'lo' is
    // added second (higher zOrder) but is the "low" endpoint (y=0). Calling with aId='hi' must
    // blend FROM 100, regardless of either object's stacking position.
    ({ project: p } = addPath(p, { id: 'hi', path: line(100), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'lo', path: line(0), style: openStyle }));

    const { project, ids } = blendPaths(p, 'hi', 'lo', 3);
    // the stored path is bbox-normalized to local origin, so the world y is read off `base.y`
    // (the bbox-shift precedent) rather than the (now-zeroed) node anchors.
    const firstY = objIn(project, ids[0]).base.y;
    // t = 1/(3+1) = 0.25 of the way from A(hi=100) to B(lo=0) -> 100 + (0-100)*0.25 = 75.
    expect(firstY).toBeCloseTo(75);
  });

  it('is pure — does not mutate the input project', () => {
    let p = createProject();
    ({ project: p } = addPath(p, { id: 'a', path: line(0), style: openStyle }));
    ({ project: p } = addPath(p, { id: 'b', path: line(40), style: openStyle }));
    const before = structuredClone(p);
    blendPaths(p, 'a', 'b', 2);
    expect(p).toEqual(before);
  });
});
