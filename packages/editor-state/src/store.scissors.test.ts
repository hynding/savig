import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createVectorAsset, createSymbolAsset } from '@savig/engine';
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

/** 3-node open straight path: (0,0)-(10,0)-(20,0). Cutting segment 0 at t=0.5 lands the cut
 *  at (5,0) — a clean split with no handles anywhere (matches cutPath.test.ts case 1). */
function seedOpenPath(): string {
  const path: PathData = {
    closed: false,
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
  };
  store.getState().addVectorPath(path);
  return store.getState().selectedObjectId!;
}

/** 4-node closed square: (0,0)-(10,0)-(10,10)-(0,10). Any interior cut opens it. */
function seedClosedSquare(): string {
  const path: PathData = {
    closed: true,
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
      { anchor: { x: 10, y: 10 } },
      { anchor: { x: 0, y: 10 } },
    ],
  };
  store.getState().addVectorPath(path);
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

describe('cutSelectedPathAt — gates', () => {
  it('case 1a: non-vector-path target (rect) -> toast + no commit', () => {
    seedRect();
    const pastLen = store.getState().history.past.length;
    store.getState().cutSelectedPathAt(0, 0.5);
    expect(store.getState().history.past.length).toBe(pastLen);
    const toasts = store.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('error');
  });

  it('case 1b: shapeTrack present -> blocked (toast + no commit)', () => {
    const id = seedOpenPath();
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === id ? { ...o, shapeTrack: [{ time: 0, path: assetOf(o).path!, easing: 'linear' as const }] } : o,
      ),
    });
    const pastLen = store.getState().history.past.length;
    store.getState().cutSelectedPathAt(0, 0.5);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe("Can't cut a morphing path");
  });

  it('case 1c: compoundRings present -> blocked (toast + no commit)', () => {
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
    store.getState().cutSelectedPathAt(0, 0.5);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe('Release compound shapes before cutting');
  });

  it('case 1d: obj.boolean present (live boolean result) -> blocked (toast + no commit)', () => {
    const id = seedOpenPath();
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) => (o.id === id ? { ...o, boolean: { op: 'union' as const, operandIds: [] } } : o)),
    });
    const pastLen = store.getState().history.past.length;
    store.getState().cutSelectedPathAt(0, 0.5);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });
});

describe('cutSelectedPathAt — closed path -> opened', () => {
  it('case 2: same object id, closed becomes false, node count +2, anchor untouched; primitive-detach fires', () => {
    const id = seedStar();
    const before = obj(id);
    const beforeNodeCount = assetOf(before).path!.nodes.length;
    expect(assetOf(before).primitive).toBeDefined();

    store.getState().cutSelectedPathAt(0, 0.5);

    const after = obj(id);
    expect(after.id).toBe(id); // same object identity
    expect(assetOf(after).path!.closed).toBe(false);
    expect(assetOf(after).path!.nodes.length).toBe(beforeNodeCount + 2);
    expect(after.anchorMode).toBe(before.anchorMode); // untouched
    expect(after.anchorX).toBe(before.anchorX);
    expect(after.anchorY).toBe(before.anchorY);

    // Primitive-detach (setPathData's rule, inherited): spec gone, param tracks stripped.
    expect(assetOf(after).primitive).toBeUndefined();
  });

  it('case 2b: pins a plain closed path (no primitive) — asset.primitive stays absent, no crash', () => {
    const id = seedClosedSquare();
    store.getState().cutSelectedPathAt(2, 0.25); // wrap-adjacent segment, matches engine test 3b
    const after = obj(id);
    expect(assetOf(after).path!.closed).toBe(false);
    expect(assetOf(after).path!.nodes.length).toBe(6); // 4 + 2
  });
});

describe('cutSelectedPathAt — open path -> split', () => {
  function seedOpenPathWithExtras(): string {
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
              motionPath: { path: motion, orient: false, progress: [{ time: 0, value: 0, easing: 'linear' as const }, { time: 1, value: 1, easing: 'linear' as const }] },
              repeat: { count: 3, dx: 5, dy: 0, rotate: 0, scale: 1, stagger: 0 },
            }
          : o,
      ),
    });
    return id;
  }

  it('case 3+4: piece a keeps id/path truncated; piece b new asset/object; fields copied/dropped correctly; ONE commit; selection [aId,bId]', () => {
    const aId = seedOpenPathWithExtras();
    const originalObj = obj(aId);
    const originalAsset = assetOf(originalObj);
    const pastLen = store.getState().history.past.length;

    store.getState().cutSelectedPathAt(0, 0.5);

    const project = store.getState().history.present;
    expect(project.objects.length).toBe(2); // one commit produced both pieces
    expect(store.getState().history.past.length).toBe(pastLen + 1); // ONE history entry

    const pieceA = obj(aId);
    expect(pieceA.id).toBe(aId); // identity kept
    const assetA = assetOf(pieceA);
    expect(assetA.path).toEqual({
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 5, y: 0 } }],
    });

    const bId = project.objects.find((o) => o.id !== aId)!.id;
    const pieceB = obj(bId);
    const assetB = assetOf(pieceB);
    expect(assetB.path).toEqual({
      closed: false,
      nodes: [{ anchor: { x: 5, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    });

    // style deep-equal but not the same reference
    expect(assetB.style).toEqual(assetA.style);
    expect(assetB.style).not.toBe(assetA.style);

    // base copied verbatim
    expect(pieceB.base).toEqual(originalObj.base);

    // transform tracks copied
    expect(pieceB.tracks.x).toEqual(originalObj.tracks.x);

    // trim/dashOffsetTrack ABSENT on both
    expect(pieceA.trim).toBeUndefined();
    expect('trim' in pieceA).toBe(false);
    expect(pieceA.dashOffsetTrack).toBeUndefined();
    expect('dashOffsetTrack' in pieceA).toBe(false);
    expect(pieceB.trim).toBeUndefined();
    expect(pieceB.dashOffsetTrack).toBeUndefined();

    // motionPath / repeat copied verbatim
    expect(pieceB.motionPath).toEqual(originalObj.motionPath);
    expect(pieceB.repeat).toEqual(originalObj.repeat);

    // BOTH pieces anchorMode 'absolute' at the pre-cut resolved anchor point:
    // box = pathBounds([(0,0),(10,0),(20,0)]) = {x:0,y:0,width:20,height:0};
    // anchor fraction (0.5,0.5) -> point (10, 0).
    expect(pieceA.anchorMode).toBe('absolute');
    expect(pieceA.anchorX).toBe(10);
    expect(pieceA.anchorY).toBe(0);
    expect(pieceB.anchorMode).toBe('absolute');
    expect(pieceB.anchorX).toBe(10);
    expect(pieceB.anchorY).toBe(0);

    // zOrder: b on top
    expect(pieceB.zOrder).toBeGreaterThan(pieceA.zOrder);

    // name
    expect(pieceB.name).toBe(`${originalObj.name} cut`);

    // selection convention
    expect(store.getState().selectedObjectIds).toEqual([aId, bId]);
    expect(store.getState().selectedObjectId).toBe(bId);

    // single undo restores the original single-object project
    store.getState().undo();
    expect(store.getState().history.present.objects.length).toBe(1);
    expect(assetOf(obj(aId)).path).toEqual(originalAsset.path);
  });
});

describe('cutSelectedPathAt — noop', () => {
  it('case 5: degenerate cut (t=0 on segment 0 of an open path) -> no commit, no toast (silent)', () => {
    const id = seedOpenPath();
    const pastLen = store.getState().history.past.length;
    const toastsBefore = store.getState().toasts.length;
    store.getState().cutSelectedPathAt(0, 0);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts.length).toBe(toastsBefore);
    expect(store.getState().history.present.objects.length).toBe(1);
    void id;
  });
});

describe('cutSelectedPathAt — in-symbol scope', () => {
  it('case 6: cutting inside an entered symbol lands the split on the symbol objects, not root', () => {
    const s = store.getState();
    s.newProject();
    const pathAsset = createVectorAsset('path', {
      id: 'path-asset',
      shapeType: 'path',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }] },
      style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
    });
    const pathObj = createSceneObject('path-asset', { id: 'p', zOrder: 0, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym', objects: [pathObj], width: 20, height: 0 });
    const p = createProject();
    p.assets = [pathAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('p');

    s.cutSelectedPathAt(0, 0.5);

    const symAsset = store.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: SceneObject[] };
    expect(symAsset.objects.length).toBe(2); // split landed inside the symbol
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1']); // root untouched
  });
});
