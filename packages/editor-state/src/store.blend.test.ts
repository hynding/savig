import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import {
  createProject,
  createSceneObject,
  createGroupObject,
  createVectorAsset,
  createSymbolAsset,
  createKeyframe,
} from '@savig/engine';
import type { PathData, SceneObject, VectorAsset, SvgAsset, TextAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

const obj = (id: string): SceneObject => store.getState().history.present.objects.find((o) => o.id === id)!;
const assetOf = (o: SceneObject): VectorAsset => {
  const a = store.getState().history.present.assets.find((x) => x.id === o.assetId)!;
  if (a.kind !== 'vector') throw new Error('not vector');
  return a;
};

/** Axis-aligned closed square ring, world-space corners (offX,offY)-(offX+s,offY+s) — same
 *  fixture shape as store.shapeBuilder.test.ts's `square`, so blend has two equal-node-count
 *  paths that reconcile 'corresponded' (no resample) for exact assertions. */
function square(s: number, offX: number, offY: number): PathData {
  return {
    closed: true,
    nodes: [
      { anchor: { x: offX, y: offY } },
      { anchor: { x: offX + s, y: offY } },
      { anchor: { x: offX + s, y: offY + s } },
      { anchor: { x: offX, y: offY + s } },
    ],
  };
}

function addSquare(s: number, offX: number, offY: number, styleSeed?: Partial<VectorAsset['style']>): string {
  store.getState().addVectorPath(square(s, offX, offY), styleSeed);
  return store.getState().selectedObjectId!;
}

function addRect(offX = 0): string {
  store.getState().addVectorShape('rect', { x: offX, y: 0, width: 10, height: 10 });
  return store.getState().selectedObjectId!;
}

function addSvgObject(): string {
  const asset: SvgAsset = { id: 'svg-1', kind: 'svg', name: 'SVG', normalizedContent: '<g></g>', viewBox: '0 0 10 10', width: 10, height: 10 };
  store.getState().addAsset(asset);
  store.getState().addObject(asset.id);
  return store.getState().selectedObjectId!;
}

function addTextObject(): string {
  const asset: TextAsset = { id: 'text-1', kind: 'text', name: 'Text', content: 'hi', fontSize: 12, fill: '#000000' };
  store.getState().addAsset(asset);
  store.getState().addObject(asset.id);
  return store.getState().selectedObjectId!;
}

describe('blendSelected — gates', () => {
  it('case 1a: exactly-1 selected -> toast + no commit', () => {
    const a = addSquare(10, 0, 0);
    store.getState().selectObjects([a]);
    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].kind).toBe('error');
    expect(store.getState().toasts[0].message).toBe('Select 2 vector paths to blend.');
  });

  it('case 1b: 3 selected -> toast + no commit', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 20, 0);
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, b, c]);
    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe('Select 2 vector paths to blend.');
  });

  it('case 1c: a directly-locked selected object -> blocked (lock checked FIRST)', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 20, 0);
    store.getState().toggleObjectLock(a);
    store.getState().selectObjects([a, b]);
    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe('Select 2 vector paths to blend.');
  });

  it('case 1d: a path inside a locked group (lock cascade) -> blocked', () => {
    const pathAsset = createVectorAsset('path', { id: 'pa-locked', shapeType: 'path', path: square(10, 0, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const otherAsset = createVectorAsset('path', { id: 'pa-other', shapeType: 'path', path: square(10, 40, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    group.locked = true;
    const inGroup = createSceneObject('pa-locked', { id: 'p-in-group', zOrder: 1, parentId: 'g', anchorMode: 'fraction' });
    const standalone = createSceneObject('pa-other', { id: 'p-standalone', zOrder: 2, anchorMode: 'fraction' });
    const p = createProject();
    p.assets = [pathAsset, otherAsset];
    p.objects = [group, inGroup, standalone];
    store.getState().commit(p);
    store.getState().selectObjects(['p-in-group', 'p-standalone']);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe('Select 2 vector paths to blend.');
  });

  it('case 1e: a group container selected -> blocked', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 20, 0);
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const g = store.getState().selectedObjectId!;
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([g, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1f: a symbol instance selected -> blocked', () => {
    const a = addSquare(10, 0, 0);
    store.getState().selectObjects([a]);
    store.getState().createSymbol();
    const inst = store.getState().selectedObjectId!;
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([inst, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1g: a direct SVG-asset object selected -> blocked', () => {
    const svg = addSvgObject();
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([svg, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1h: a text object selected -> blocked', () => {
    const text = addTextObject();
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([text, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1i: a rect (non-path vector shape) selected -> blocked (unlike Shape Builder, blend requires shapeType path)', () => {
    const r = addRect(0);
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([r, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1j: a live-boolean RESULT (obj.boolean present) selected -> blocked', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().booleanOp('union', { live: true });
    const liveResult = store.getState().selectedObjectId!;
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([liveResult, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1k: a live-boolean OPERAND selected -> blocked', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().booleanOp('union', { live: true }); // a, b are now operands
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1l: a morphing (shapeTrack) path selected -> blocked', () => {
    const a = addSquare(10, 0, 0);
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === a ? { ...o, shapeTrack: [{ time: 0, path: assetOf(o).path!, easing: 'linear' as const }] } : o,
      ),
    });
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1m: a repeater object selected -> blocked', () => {
    const a = addSquare(10, 0, 0);
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === a ? { ...o, repeat: { count: 2, dx: 5, dy: 0, rotate: 0, scale: 1, stagger: 0 } } : o,
      ),
    });
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1n: compoundRings present -> blocked', () => {
    const a = addSquare(10, 0, 0);
    const project = store.getState().history.present;
    const hole: PathData = { closed: true, nodes: [{ anchor: { x: 2, y: 2 } }, { anchor: { x: 4, y: 2 } }, { anchor: { x: 4, y: 4 } }, { anchor: { x: 2, y: 4 } }] };
    store.getState().commit({
      ...project,
      assets: project.assets.map((x) => (x.id === obj(a).assetId ? { ...(x as VectorAsset), compoundRings: [hole] } : x)),
    });
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1o: an empty static path -> blocked', () => {
    const emptyAsset = createVectorAsset('path', { id: 'pa-empty', shapeType: 'path', path: { nodes: [], closed: false } });
    const emptyObj = createSceneObject('pa-empty', { id: 'p-empty', zOrder: 0, anchorMode: 'fraction' });
    const project = store.getState().history.present;
    store.getState().commit({ ...project, assets: [...project.assets, emptyAsset], objects: [...project.objects, emptyObj] });
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects(['p-empty', c]);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 1p: engine-side null (count < 1) -> distinct toast, no commit', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 40, 0);
    store.getState().selectObjects([a, b]);
    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(0);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].message).toBe("Can't blend these paths.");
  });

  it('case 1q: a path inside an UNLOCKED group -> ALLOWED (grouped leaves are eligible)', () => {
    const groupedAsset = createVectorAsset('path', { id: 'pa-grouped', shapeType: 'path', path: square(10, 0, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const otherAsset = createVectorAsset('path', { id: 'pa-grouped-other', shapeType: 'path', path: square(10, 40, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const group = createGroupObject({ id: 'g2', anchorX: 0, anchorY: 0, zOrder: 0 });
    const inGroup = createSceneObject('pa-grouped', { id: 'p-in-group2', zOrder: 1, parentId: 'g2', anchorMode: 'fraction' });
    const standalone = createSceneObject('pa-grouped-other', { id: 'p-standalone2', zOrder: 2, anchorMode: 'fraction' });
    const p = createProject();
    p.assets = [groupedAsset, otherAsset];
    p.objects = [group, inGroup, standalone];
    store.getState().commit(p);
    store.getState().selectObjects(['p-in-group2', 'p-standalone2']);

    const pastLen = store.getState().history.past.length;
    store.getState().blendSelected(1);
    expect(store.getState().history.past.length).toBe(pastLen + 1); // committed
    expect(store.getState().toasts).toHaveLength(0);
    // group membership of A/B untouched; the new intermediate lands at the scope ROOT (ungrouped).
    expect(obj('p-in-group2').parentId).toBe('g2');
    const created = store.getState().selectedObjectIds;
    expect(created).toHaveLength(1);
    expect(obj(created[0]).parentId).toBeUndefined();
  });
});

describe('blendSelected — effects', () => {
  it('case 2: n intermediates at the scope root — names, sequential zOrder, fraction anchors', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 40, 0);
    store.getState().selectObjects([a, b]);
    const zBefore = Math.max(obj(a).zOrder, obj(b).zOrder);

    store.getState().blendSelected(3);

    const created = store.getState().selectedObjectIds;
    expect(created).toHaveLength(3);
    created.forEach((id, i) => {
      const o = obj(id);
      expect(o.name).toBe(`Blend ${i + 1}`);
      expect(o.zOrder).toBe(zBefore + 1 + i);
      expect(o.anchorMode).toBe('fraction');
      expect(o.parentId).toBeUndefined();
      expect(o.tracks).toEqual({});
      expect(assetOf(o).primitive).toBeUndefined();
    });
  });

  it('case 3: base.opacity is interpolated from the step (A opacity 1, B opacity 0.4, count 1 -> 0.7)', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 40, 0);
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) => (o.id === b ? { ...o, base: { ...o.base, opacity: 0.4 } } : o)),
    });
    store.getState().selectObjects([a, b]);

    store.getState().blendSelected(1);

    const created = store.getState().selectedObjectIds;
    expect(created).toHaveLength(1);
    expect(obj(created[0]).base.opacity).toBeCloseTo(0.7, 9);
  });

  it('case 4: A and B are left untouched (not consumed) — unlike booleanOp', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 40, 0);
    const beforeA = structuredClone(obj(a));
    const beforeB = structuredClone(obj(b));
    store.getState().selectObjects([a, b]);

    store.getState().blendSelected(2);

    expect(obj(a)).toEqual(beforeA);
    expect(obj(b)).toEqual(beforeB);
  });

  it('case 5: selection after blend = exactly the created intermediates', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 40, 0);
    store.getState().selectObjects([a, b]);

    store.getState().blendSelected(2);

    const ids = store.getState().selectedObjectIds;
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
  });

  it('case 6: ONE commit / single undo restores the pre-blend project', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 40, 0);
    store.getState().selectObjects([a, b]);
    const objectCountBefore = store.getState().history.present.objects.length;
    const assetCountBefore = store.getState().history.present.assets.length;
    const pastLen = store.getState().history.past.length;

    store.getState().blendSelected(3);
    expect(store.getState().history.past.length).toBe(pastLen + 1); // ONE history entry
    expect(store.getState().history.present.objects.length).toBe(objectCountBefore + 3);
    expect(store.getState().history.present.assets.length).toBe(assetCountBefore + 3);

    store.getState().undo();
    expect(store.getState().history.present.objects.length).toBe(objectCountBefore);
    expect(store.getState().history.present.assets.length).toBe(assetCountBefore);
  });

  it('case 7: A = lower zOrder, B = higher zOrder — independent of selection click order', () => {
    const seed = () => {
      const a = addSquare(10, 0, 0, { fill: '#ff0000' }); // zOrder 0
      const b = addSquare(10, 40, 0, { fill: '#0000ff' }); // zOrder 1
      return { a, b };
    };

    store.getState().newProject();
    const first = seed();
    store.getState().selectObjects([first.a, first.b]); // click order == zOrder order
    store.getState().blendSelected(2);
    const fills1 = store.getState().selectedObjectIds.map((id) => assetOf(obj(id)).style.fill);

    store.getState().newProject();
    const second = seed();
    store.getState().selectObjects([second.b, second.a]); // REVERSED click order
    store.getState().blendSelected(2);
    const fills2 = store.getState().selectedObjectIds.map((id) => assetOf(obj(id)).style.fill);

    expect(fills2).toEqual(fills1);
  });
});

describe('blendSelected — in-symbol scope', () => {
  it('case 8: blending inside an entered symbol lands the new objects on the symbol scene, not root', () => {
    const s = store.getState();
    s.newProject();
    const assetA = createVectorAsset('path', { id: 'sym-pa', shapeType: 'path', path: square(10, 0, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const assetB = createVectorAsset('path', { id: 'sym-pb', shapeType: 'path', path: square(10, 40, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const objA = createSceneObject('sym-pa', { id: 'sa', zOrder: 0, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const objB = createSceneObject('sym-pb', { id: 'sb', zOrder: 1, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym', objects: [objA, objB], width: 100, height: 100 });
    const p = createProject();
    p.assets = [assetA, assetB, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObjects(['sa', 'sb']);

    s.blendSelected(1);

    const symAsset = store.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: SceneObject[] };
    expect(symAsset.objects.map((o) => o.id)).toContain('sa');
    expect(symAsset.objects.map((o) => o.id)).toContain('sb');
    expect(symAsset.objects).toHaveLength(3); // 2 originals + 1 new intermediate
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1']); // root untouched
  });
});

describe('blendSelected — time wiring (task 1 hardening)', () => {
  it('a transform-animated source blended at a non-zero playhead reflects the sampled position, differing from time 0', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 40, 0);
    const project = store.getState().history.present;
    // A's x is keyframed 0 -> 100 over t=[0,2]; blending at different playheads must sample A
    // at THAT time (computeBlendSteps' opts.time), not always at t=0.
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) => (o.id === a ? { ...o, tracks: { x: [createKeyframe(0, 0), createKeyframe(2, 100)] } } : o)),
    });

    store.getState().selectObjects([a, b]);
    store.getState().seek(0);
    store.getState().blendSelected(1);
    const idAt0 = store.getState().selectedObjectIds[0];
    const xAt0 = obj(idAt0).base.x;

    store.getState().selectObjects([a, b]);
    store.getState().seek(2);
    store.getState().blendSelected(1);
    const idAt2 = store.getState().selectedObjectIds[0];
    const xAt2 = obj(idAt2).base.x;

    expect(xAt2).not.toBeCloseTo(xAt0, 6);
  });
});

describe('blendSelected — grouped-source world transform (C1 regression)', () => {
  // A wrapping group with a NON-IDENTITY transform (base.x = 100) around source A, blended
  // against an ungrouped sibling B at local x 0..10. worldChain must resolve the group's
  // transform against the ACTIVE scene's objects, not root project.objects — inside a symbol
  // edit session the group lives in the symbol asset's objects[] only. With the bug, A's
  // group offset is silently dropped and both operands are treated as local x 0..10, so the
  // count-1 intermediate's box.x sits at ~0. Fixed, A's world x range is 100..110 and the
  // count-1 (t=0.5) intermediate's box.x sits at ~50 — the true world midpoint.
  it('case 9: inside a symbol edit session, a grouped source (non-identity group transform) blends in world space', () => {
    const s = store.getState();
    s.newProject();
    const assetA = createVectorAsset('path', { id: 'sym-pa2', shapeType: 'path', path: square(10, 0, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const assetB = createVectorAsset('path', { id: 'sym-pb2', shapeType: 'path', path: square(10, 0, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const group = createGroupObject({ id: 'sym-g', anchorX: 0, anchorY: 0, zOrder: 0 });
    group.base = { ...group.base, x: 100 };
    const objA = createSceneObject('sym-pa2', { id: 'sym-a', zOrder: 1, parentId: 'sym-g', anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const objB = createSceneObject('sym-pb2', { id: 'sym-b', zOrder: 2, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const sym = createSymbolAsset({ id: 'sym2', objects: [group, objA, objB], width: 200, height: 100 });
    const p = createProject();
    p.assets = [assetA, assetB, sym];
    p.objects = [createSceneObject('sym2', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym2');
    s.selectObjects(['sym-a', 'sym-b']);

    s.blendSelected(1);

    const created = store.getState().selectedObjectIds;
    expect(created).toHaveLength(1);
    const symAsset = store.getState().history.present.assets.find((x) => x.id === 'sym2') as { objects: SceneObject[] };
    const intermediate = symAsset.objects.find((o) => o.id === created[0])!;
    expect(intermediate.base.x).toBeCloseTo(50, 6); // world midpoint of [100,110] and [0,10]
  });

  it('case 10: at the scope root, a grouped source (non-identity group transform) blends in world space', () => {
    const s = store.getState();
    s.newProject();
    const groupedAsset = createVectorAsset('path', { id: 'pa-grouped3', shapeType: 'path', path: square(10, 0, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const otherAsset = createVectorAsset('path', { id: 'pa-grouped-other3', shapeType: 'path', path: square(10, 0, 0), style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } });
    const group = createGroupObject({ id: 'g3', anchorX: 0, anchorY: 0, zOrder: 0 });
    group.base = { ...group.base, x: 100 };
    const inGroup = createSceneObject('pa-grouped3', { id: 'p-in-group3', zOrder: 1, parentId: 'g3', anchorMode: 'fraction' });
    const standalone = createSceneObject('pa-grouped-other3', { id: 'p-standalone3', zOrder: 2, anchorMode: 'fraction' });
    const p = createProject();
    p.assets = [groupedAsset, otherAsset];
    p.objects = [group, inGroup, standalone];
    s.commit(p);
    s.selectObjects(['p-in-group3', 'p-standalone3']);

    s.blendSelected(1);

    const created = store.getState().selectedObjectIds;
    expect(created).toHaveLength(1);
    expect(obj(created[0]).base.x).toBeCloseTo(50, 6); // world midpoint of [100,110] and [0,10]
  });
});
