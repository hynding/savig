import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import {
  createProject,
  createSceneObject,
  createGroupObject,
  createVectorAsset,
  createSymbolAsset,
  outlineStroke as outlineStrokeEngine,
  defaultGradient,
} from '@savig/engine';
import type { PathData, SceneObject, VectorAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

const obj = (id: string) => store.getState().history.present.objects.find((o) => o.id === id)!;
const assetOf = (o: SceneObject): VectorAsset => {
  const a = store.getState().history.present.assets.find((x) => x.id === o.assetId)!;
  if (a.kind !== 'vector') throw new Error('not vector');
  return a;
};

/** Straight open 2-node line (0,0)-(100,0), default PATH_DEFAULT_STYLE (stroke '#000000',
 *  strokeWidth 2) unless `styleSeed` overrides it — matches strokeOutline.test.ts's `line()`
 *  fixture so the expected rings can be recomputed with the engine directly. */
function seedOpenPath(styleSeed?: Partial<VectorAsset['style']>): string {
  const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
  store.getState().addVectorPath(path, styleSeed);
  return store.getState().selectedObjectId!;
}

/** Closed 100x100 square centerline, default stroke — matches strokeOutline.test.ts's `square(100)`
 *  fixture (width 10 there produces an annulus: 2 rings, opposite-signed areas). */
function seedClosedSquare(strokeWidth = 10): string {
  const path: PathData = {
    closed: true,
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 100, y: 0 } },
      { anchor: { x: 100, y: 100 } },
      { anchor: { x: 0, y: 100 } },
    ],
  };
  store.getState().addVectorPath(path, { strokeWidth });
  return store.getState().selectedObjectId!;
}

function seedStar(): string {
  store.getState().addPrimitive({ kind: 'star', cx: 50, cy: 50, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
  return store.getState().selectedObjectId!;
}

function seedRect(): string {
  store.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  return store.getState().selectedObjectId!;
}

describe('outlineStroke — gates', () => {
  it('case 1a: non-vector-path target (rect) -> toast + no commit', () => {
    seedRect();
    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].kind).toBe('error');
    expect(store.getState().toasts[0].message).toBe('Select a path to outline.');
  });

  it('case 1b: stroke === none -> blocked (toast + no commit)', () => {
    seedOpenPath({ stroke: 'none' });
    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe('Add a stroke to outline.');
  });

  it('case 1c: strokeWidth <= 0 -> blocked (toast + no commit)', () => {
    seedOpenPath({ strokeWidth: 0 });
    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe('Add a stroke to outline.');
  });

  it('case 1d: shapeTrack present -> blocked (toast + no commit)', () => {
    const id = seedOpenPath();
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === id ? { ...o, shapeTrack: [{ time: 0, path: assetOf(o).path!, easing: 'linear' as const }] } : o,
      ),
    });
    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe("Can't outline a morphing path.");
  });

  it('case 1e: compoundRings present -> blocked (toast + no commit)', () => {
    const id = seedClosedSquare();
    const project = store.getState().history.present;
    const holeRing: PathData = {
      closed: true,
      nodes: [{ anchor: { x: 2, y: 2 } }, { anchor: { x: 4, y: 2 } }, { anchor: { x: 4, y: 4 } }, { anchor: { x: 2, y: 4 } }],
    };
    store.getState().commit({
      ...project,
      assets: project.assets.map((a) => (a.id === obj(id).assetId ? { ...(a as VectorAsset), compoundRings: [holeRing] } : a)),
    });
    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe('Release compound shapes before outlining.');
  });

  it('case 1f: obj.boolean present (live boolean result) -> blocked (toast + no commit)', () => {
    const id = seedOpenPath();
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) => (o.id === id ? { ...o, boolean: { op: 'union' as const, operandIds: [] } } : o)),
    });
    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe("Can't outline a boolean result.");
  });

  it('case 1g: target is a live-boolean operand -> blocked (toast + no commit)', () => {
    const a = seedOpenPath();
    const b = seedOpenPath();
    store.getState().selectObjects([a, b]);
    store.getState().booleanOp('union', { live: true });
    store.getState().selectObject(b); // select the operand directly, not the live-boolean result

    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe('Release the boolean before outlining.');
  });

  it('case 1h: directly-locked path -> blocked (toast + no commit)', () => {
    const id = seedOpenPath();
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) => (o.id === id ? { ...o, locked: true } : o)),
    });
    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe("Can't outline a locked path.");
  });

  it('case 1i: path inside a locked group (lock cascade) -> blocked (toast + no commit)', () => {
    const pathAsset = createVectorAsset('path', {
      id: 'path-asset-locked-group',
      shapeType: 'path',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
      style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
    });
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    group.locked = true;
    const pathObj = createSceneObject('path-asset-locked-group', { id: 'p2', zOrder: 1, parentId: 'g' });
    const p = createProject();
    p.assets = [pathAsset];
    p.objects = [group, pathObj];
    store.getState().commit(p);
    store.getState().selectObject('p2');

    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe("Can't outline a locked path.");
  });

  it('case 1k: path that is BOTH locked AND stroke-less -> lock message wins', () => {
    const id = seedOpenPath({ stroke: 'none' });
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) => (o.id === id ? { ...o, locked: true } : o)),
    });
    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe("Can't outline a locked path.");
  });

  it('case 1j: path inside an UNLOCKED group -> ALLOWED (unlike scissors — identity is preserved, no split)', () => {
    const pathAsset = createVectorAsset('path', {
      id: 'path-asset-unlocked-group',
      shapeType: 'path',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
      style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
    });
    const group = createGroupObject({ id: 'g2', anchorX: 0, anchorY: 0, zOrder: 0 });
    const pathObj = createSceneObject('path-asset-unlocked-group', { id: 'p3', zOrder: 1, parentId: 'g2' });
    const p = createProject();
    p.assets = [pathAsset];
    p.objects = [group, pathObj];
    store.getState().commit(p);
    store.getState().selectObject('p3');

    const pastLen = store.getState().history.past.length;
    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen + 1); // committed
    expect(store.getState().toasts).toHaveLength(0);
    const after = obj('p3');
    expect(after.parentId).toBe('g2'); // group membership untouched
    expect(assetOf(after).style.fill).toBe('#000000'); // outline succeeded
  });
});

describe('outlineStroke — effects', () => {
  it('case 2: same object id; path/compoundRings match the engine result exactly; style swapped; byte-clean removals', () => {
    const id = seedOpenPath();
    const before = obj(id);
    const beforeAsset = assetOf(before);
    const expectedRings = outlineStrokeEngine(beforeAsset.path!, beforeAsset.style.strokeWidth, 'butt', 'miter');
    expect(expectedRings.length).toBe(1); // sanity: a straight open line -> one ring, no holes

    store.getState().outlineStroke();

    const after = obj(id);
    expect(after.id).toBe(id); // identity kept
    const afterAsset = assetOf(after);
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

  it('case 3: closed square (annulus) -> path = outer ring, compoundRings = [inner ring]', () => {
    const id = seedClosedSquare(10);
    const before = obj(id);
    const beforeAsset = assetOf(before);
    const expectedRings = outlineStrokeEngine(beforeAsset.path!, 10, 'butt', 'miter');
    expect(expectedRings.length).toBe(2); // sanity: annulus

    store.getState().outlineStroke();

    const after = obj(id);
    const afterAsset = assetOf(after);
    expect(afterAsset.path).toEqual(expectedRings[0]);
    expect(afterAsset.compoundRings).toEqual([expectedRings[1]]);
  });

  it('case 4: strokeGradient present -> carried to fillGradient; strokeGradient key absent after', () => {
    const id = seedOpenPath();
    const grad = defaultGradient('linear', '#ff0000');
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      assets: project.assets.map((a) =>
        a.id === obj(id).assetId ? { ...(a as VectorAsset), style: { ...(a as VectorAsset).style, strokeGradient: grad } } : a,
      ),
    });

    store.getState().outlineStroke();

    const afterAsset = assetOf(obj(id));
    expect(afterAsset.style.fillGradient).toEqual(grad);
    expect('strokeGradient' in afterAsset.style).toBe(false);
  });

  it('case 5: honors non-default cap/join/width from the asset style', () => {
    const id = seedOpenPath({ strokeWidth: 20, strokeLinecap: 'round', strokeLinejoin: 'round' });
    const beforeAsset = assetOf(obj(id));
    const expected = outlineStrokeEngine(beforeAsset.path!, 20, 'round', 'round');

    store.getState().outlineStroke();

    expect(assetOf(obj(id)).path).toEqual(expected[0]);
  });

  it('case 6a: object with trim/dashOffsetTrack/colorTracks/gradientTracks -> all dropped, tracks/motionPath/repeat kept, ONE info toast', () => {
    const id = seedOpenPath();
    const project = store.getState().history.present;
    const motion: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 5, y: 5 } }] };
    store.getState().commit({
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
              motionPath: { path: motion, orient: false, progress: [{ time: 0, value: 0, easing: 'linear' as const }, { time: 1, value: 1, easing: 'linear' as const }] },
              repeat: { count: 3, dx: 5, dy: 0, rotate: 0, scale: 1, stagger: 0 },
            }
          : o,
      ),
    });
    const originalObj = obj(id);

    store.getState().outlineStroke();

    const after = obj(id);
    expect('trim' in after).toBe(false);
    expect('dashOffsetTrack' in after).toBe(false);
    expect('colorTracks' in after).toBe(false);
    expect('gradientTracks' in after).toBe(false);
    // kept verbatim
    expect(after.tracks.x).toEqual(originalObj.tracks.x);
    expect(after.motionPath).toEqual(originalObj.motionPath);
    expect(after.repeat).toEqual(originalObj.repeat);

    const infoToasts = store.getState().toasts.filter((t) => t.kind === 'info');
    expect(infoToasts).toHaveLength(1);
    expect(infoToasts[0].message).toBe('Stroke/fill animation removed — converted to a filled shape.');
  });

  it('case 6b: object with none of trim/dash/color/gradient tracks -> no info toast', () => {
    seedOpenPath();
    store.getState().outlineStroke();
    expect(store.getState().toasts).toHaveLength(0);
  });

  it('case 7a: anchorMode fraction -> pinned absolute at the pre-op resolved point', () => {
    const id = seedOpenPath(); // anchorMode 'fraction', anchorX/Y 0.5/0.5; path bbox (0,0)-(100,0)
    store.getState().outlineStroke();
    const after = obj(id);
    expect(after.anchorMode).toBe('absolute');
    expect(after.anchorX).toBe(50);
    expect(after.anchorY).toBe(0);
  });

  it('case 7b: anchorMode absolute -> value untouched, mode stays absolute', () => {
    const id = seedOpenPath();
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) => (o.id === id ? { ...o, anchorMode: 'absolute' as const, anchorX: 7, anchorY: 9 } : o)),
    });
    store.getState().outlineStroke();
    const after = obj(id);
    expect(after.anchorMode).toBe('absolute');
    expect(after.anchorX).toBe(7);
    expect(after.anchorY).toBe(9);
  });

  it('case 8: primitive-detach — a stamped star with a stroke detaches its spec + strips primitive param tracks', () => {
    const id = seedStar();
    const before = obj(id);
    expect(assetOf(before).primitive).toBeDefined();
    // Seed a primitive param track (cornerRadius) — must be stripped alongside the spec.
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === id ? { ...o, tracks: { ...o.tracks, cornerRadius: [{ time: 0, value: 5, easing: 'linear' as const }] } } : o,
      ),
    });
    expect(obj(id).tracks.cornerRadius).toBeDefined();

    store.getState().outlineStroke();

    const after = obj(id);
    expect(assetOf(after).primitive).toBeUndefined();
    expect(after.tracks.cornerRadius).toBeUndefined();
  });

  it('case 9: ONE commit / single undo restores the pre-outline path+style', () => {
    const id = seedOpenPath();
    const originalAsset = structuredClone(assetOf(obj(id)));
    const pastLen = store.getState().history.past.length;

    store.getState().outlineStroke();
    expect(store.getState().history.past.length).toBe(pastLen + 1); // ONE history entry

    store.getState().undo();
    expect(assetOf(obj(id))).toEqual(originalAsset);
  });

  it('case 13: sampled paint — a colorTracks.stroke recolor (autoKey ON) drives the outline fill, not the stale static style', () => {
    const id = seedOpenPath(); // static style.stroke stays '#000000'
    store.getState().selectObject(id);
    store.getState().setVectorColor('stroke', '#ff0000'); // autoKey ON (default) -> colorTracks.stroke keyframe at t=0, static style untouched
    expect(assetOf(obj(id)).style.stroke).toBe('#000000'); // sanity: the static style did NOT change
    expect(obj(id).colorTracks?.stroke?.[0]?.value).toBe('#ff0000');

    store.getState().outlineStroke();

    // WYSIWYG: fill = the sampled (live) color, not the stale static '#000000'.
    expect(assetOf(obj(id)).style.fill).toBe('#ff0000');
  });
});

describe('outlineStroke — noop', () => {
  it('case 10: a degenerate path (engine returns no rings) is a silent no-op — no commit, no toast', () => {
    // A single-point-length-zero closed path collapses to < 3 flattened points -> outlineStroke
    // (engine) returns []. addVectorPath requires >=2 nodes, but two coincident points flatten
    // to a single point, producing an empty ring set.
    const path: PathData = { closed: false, nodes: [{ anchor: { x: 5, y: 5 } }, { anchor: { x: 5, y: 5 } }] };
    store.getState().addVectorPath(path);
    const id = store.getState().selectedObjectId!;
    const pastLen = store.getState().history.past.length;
    const toastsBefore = store.getState().toasts.length;

    store.getState().outlineStroke();

    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts.length).toBe(toastsBefore);
    expect(assetOf(obj(id)).style.stroke).toBe('#000000'); // unchanged — the op never ran
  });
});

describe('outlineStroke — in-symbol scope', () => {
  it('case 11: outlining inside an entered symbol lands the swap on the symbol objects, not root', () => {
    const s = store.getState();
    s.newProject();
    const pathAsset = createVectorAsset('path', {
      id: 'path-asset',
      shapeType: 'path',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
      style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
    });
    const pathObj = createSceneObject('path-asset', { id: 'p', zOrder: 0, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym', objects: [pathObj], width: 100, height: 0 });
    const p = createProject();
    p.assets = [pathAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('p');

    s.outlineStroke();

    const symAsset = store.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: SceneObject[] };
    const symPathObj = symAsset.objects.find((o) => o.id === 'p')!;
    const symPathAsset = store.getState().history.present.assets.find((a) => a.id === 'path-asset') as VectorAsset;
    expect(symPathAsset.style.fill).toBe('#000000'); // outline landed on the symbol-scoped asset
    expect(symPathObj.anchorMode).toBe('absolute'); // op ran inside the symbol scope
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1']); // root untouched
  });
});
